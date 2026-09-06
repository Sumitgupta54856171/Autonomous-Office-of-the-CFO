"""FastAPI application for AutoCFO: Autonomous Office of the CFO.

Exposes RESTful endpoints for invoice management, bank ledger operations,
AI agent reconciliation, and human review exception resolution.
"""

import asyncio
import logging
import os
import shutil
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any, Dict, List, Optional
from celery.result import AsyncResult
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from file_extractor import extract_and_persist_invoice

from agent import (
    AgentState,
    agent_graph,
    generate_vendor_exception_email,
    infer_vendor_email,
    run_autonomous_agent,
)
from auth import verify_clerk_token
from celery_app import celery_app, extract_invoice_task
from database import close_db, get_db, init_db
from email_service import get_gmail_credentials, is_gmail_configured, send_real_gmail
from models import BankLedger, Invoice, InvoiceStatus
from schemas import (
    AgentSummaryResponse,
    BankLedgerCreate,
    BankLedgerResponse,
    DashboardStats,
    EmailConfigStatus,
    InvoiceCreate,
    InvoiceResponse,
    ResolveExceptionRequest,
    SendVendorEmailRequest,
    SendVendorEmailResponse,
    TaskResponse,
    UploadInvoiceResponse,
)

# Configure structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("autocfo.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan event handler to ensure DB tables are created on startup."""
    logger.info("Initializing AutoCFO database tables...")
    await init_db()
    logger.info("AutoCFO database ready.")
    yield
    logger.info("Disposing AutoCFO database connections...")
    await close_db()


app = FastAPI(
    title="AutoCFO - Autonomous Office of the CFO API",
    description=(
        "Autonomous Agent backend that reconciles incoming vendor invoices with bank ledger "
        "records and routes exceptions to a human-in-the-loop review workflow."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for frontend integration (React, Next.js, Vite)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Hackathon & dev-friendly: allows localhost:3000, localhost:5173, etc.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------
# Health and Info Endpoints
# ---------------------------------------------------------
@app.get("/", tags=["System"])
async def root():
    """Root metadata endpoint."""
    return {
        "app": "AutoCFO Backend",
        "description": "Autonomous Invoice Reconciliation and Exception Management",
        "docs": "/docs",
        "redoc": "/redoc",
        "status": "operational",
    }


@app.get("/health", tags=["System"])
async def health_check(db: AsyncSession = Depends(get_db)):
    """Health check endpoint that verifies database connectivity."""
    try:
        await db.execute(select(1))
        db_status = "connected"
    except Exception as e:
        logger.error("Database health check failed: %s", e)
        db_status = f"unhealthy: {str(e)}"
    return {
        "status": "ok" if db_status == "connected" else "degraded",
        "database": db_status,
    }


# ---------------------------------------------------------
# Invoice Management Endpoints
# ---------------------------------------------------------
@app.post(
    "/api/invoices/",
    response_model=InvoiceResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Invoices"],
    summary="Create a new invoice",
)
async def create_invoice(invoice_in: InvoiceCreate, db: AsyncSession = Depends(get_db)):
    """Create a new vendor invoice with 'pending' status by default."""
    try:
        new_invoice = Invoice(
            vendor_name=invoice_in.vendor_name.strip(),
            amount=round(invoice_in.amount, 2),
            due_date=invoice_in.due_date,
            status=invoice_in.status.value if invoice_in.status else InvoiceStatus.PENDING.value,
            resolution_notes=invoice_in.resolution_notes,
        )
        db.add(new_invoice)
        await db.commit()
        await db.refresh(new_invoice)
        logger.info("Created Invoice #%d for '%s' ($%.2f)", new_invoice.id, new_invoice.vendor_name, new_invoice.amount)
        return new_invoice
    except Exception as e:
        await db.rollback()
        logger.error("Failed to create invoice: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create invoice: {str(e)}",
        )


@app.get(
    "/api/invoices/",
    response_model=List[InvoiceResponse],
    tags=["Invoices"],
    summary="List all invoices",
)
async def list_invoices(
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by status: pending, paid, exception_human_review, rejected"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve all invoices with optional status filtering and pagination."""
    query = select(Invoice)
    if status_filter:
        query = query.where(Invoice.status == status_filter.strip().lower())
    query = query.order_by(Invoice.id.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    return result.scalars().all()


@app.get(
    "/api/invoices/{invoice_id}",
    response_model=InvoiceResponse,
    tags=["Invoices"],
    summary="Get invoice by ID",
)
async def get_invoice(invoice_id: int, db: AsyncSession = Depends(get_db)):
    """Retrieve detailed information for a specific invoice."""
    query = select(Invoice).where(Invoice.id == invoice_id)
    result = await db.execute(query)
    invoice = result.scalar_one_or_none()
    if not invoice:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Invoice with ID {invoice_id} not found.",
        )
    return invoice


# ---------------------------------------------------------
# Invoice Document Upload & Asynchronous AI Extraction
# ---------------------------------------------------------
TEMP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "temp")
os.makedirs(TEMP_DIR, exist_ok=True)
ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg"}

# In-memory tracking for extraction tasks: provides self-healing when Celery worker is unavailable/stopped
IN_MEMORY_TASKS: Dict[str, Dict[str, Any]] = {}


def _run_local_extract(task_id: str, file_path: str):
    """Fallback local executor that processes extraction directly when Celery is inactive."""
    logger.info("Starting local async extraction for task [%s] on file: %s", task_id, file_path)
    try:
        if task_id in IN_MEMORY_TASKS:
            IN_MEMORY_TASKS[task_id]["status"] = "PROGRESS"
            IN_MEMORY_TASKS[task_id]["message"] = "Processing document with PyMuPDF and AI Vision..."
        result = extract_and_persist_invoice(file_path)
        if task_id in IN_MEMORY_TASKS:
            IN_MEMORY_TASKS[task_id]["status"] = "SUCCESS"
            IN_MEMORY_TASKS[task_id]["message"] = "Invoice extracted and persisted to database with status='pending'."
            IN_MEMORY_TASKS[task_id]["result"] = result
            IN_MEMORY_TASKS[task_id]["completed_at"] = time.time()
        logger.info("Local extraction completed successfully for task [%s]", task_id)
    except Exception as exc:
        logger.error("Local extraction failed for task [%s]: %s", task_id, exc, exc_info=True)
        if task_id in IN_MEMORY_TASKS:
            IN_MEMORY_TASKS[task_id]["status"] = "FAILURE"
            IN_MEMORY_TASKS[task_id]["message"] = "AI invoice extraction encountered an error."
            IN_MEMORY_TASKS[task_id]["error"] = str(exc)
            IN_MEMORY_TASKS[task_id]["completed_at"] = time.time()


@app.post(
    "/api/invoices/upload",
    response_model=UploadInvoiceResponse,
    status_code=status.HTTP_202_ACCEPTED,
    tags=["Invoices"],
    summary="Upload invoice file for async AI vision extraction",
)
async def upload_invoice(
    file: UploadFile = File(...),
    current_user: dict = Depends(verify_clerk_token),
):
    """Accepts an invoice document (PDF, PNG, JPG, JPEG), saves it to ./temp,
    triggers background extraction (via Celery if active, else direct thread pool runner),
    and returns 202 Accepted with a task_id.
    """
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported file format '{ext}'. Supported formats: PDF, PNG, JPG, JPEG.",
        )

    # Generate safe unique filename
    safe_name = f"{uuid.uuid4().hex}_{file.filename}"
    file_path = os.path.join(TEMP_DIR, safe_name)

    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error("Failed to save uploaded file: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to store uploaded file: {str(e)}",
        )

    task_id = str(uuid.uuid4())
    IN_MEMORY_TASKS[task_id] = {
        "task_id": task_id,
        "status": "PROGRESS",
        "message": "Invoice received. Extracting text and vision with AI...",
        "file_path": file_path,
        "filename": file.filename or "invoice",
        "created_at": time.time(),
        "dispatched_to_celery": False,
    }

    # Check if a Celery worker is active
    celery_ready = False
    try:
        insp = celery_app.control.inspect(timeout=0.25)
        workers = insp.ping()
        if workers:
            celery_ready = True
    except Exception:
        celery_ready = False

    if celery_ready:
        try:
            extract_invoice_task.apply_async(args=[file_path], task_id=task_id)
            IN_MEMORY_TASKS[task_id]["dispatched_to_celery"] = True
            logger.info("Enqueued Celery invoice extraction task [%s] for file: %s", task_id, file.filename)
        except Exception as exc:
            logger.warning("Failed to dispatch Celery task: %s. Falling back to local runner.", exc)
            celery_ready = False

    if not celery_ready:
        # Fallback: Run in background thread pool immediately
        loop = asyncio.get_running_loop()
        loop.run_in_executor(None, _run_local_extract, task_id, file_path)
        logger.info("Dispatched local background extraction task [%s] for file: %s", task_id, file.filename)

    return UploadInvoiceResponse(
        task_id=task_id,
        status="PENDING",
        message="Invoice upload received. Async AI vision extraction started.",
        filename=file.filename or "invoice",
    )


@app.get(
    "/api/tasks/{task_id}",
    response_model=TaskResponse,
    tags=["Async Tasks"],
    summary="Poll status of background extraction task",
)
async def get_task_status(
    task_id: str,
    current_user: dict = Depends(verify_clerk_token),
):
    """Returns the current state and result of the extraction task (PENDING, STARTED, PROGRESS, SUCCESS, FAILURE)."""
    # 1. Check in-memory task registry first
    mem_task = IN_MEMORY_TASKS.get(task_id)

    if mem_task:
        if mem_task.get("status") == "SUCCESS":
            return TaskResponse(
                task_id=task_id,
                status="SUCCESS",
                message=mem_task.get("message", "Invoice extracted and persisted to database with status='pending'."),
                result=mem_task.get("result"),
            )
        elif mem_task.get("status") == "FAILURE":
            return TaskResponse(
                task_id=task_id,
                status="FAILURE",
                message=mem_task.get("message", "AI invoice extraction encountered an error."),
                error=mem_task.get("error", "Task failed"),
            )

        # If it was dispatched to Celery, check Celery result
        if mem_task.get("dispatched_to_celery"):
            try:
                task = AsyncResult(task_id, app=celery_app)
                state = task.state
                if state == "SUCCESS":
                    mem_task["status"] = "SUCCESS"
                    mem_task["result"] = task.result
                    return TaskResponse(
                        task_id=task_id,
                        status="SUCCESS",
                        message="Invoice extracted and persisted to database with status='pending'.",
                        result=task.result,
                    )
                elif state == "FAILURE":
                    mem_task["status"] = "FAILURE"
                    mem_task["error"] = str(task.info or "Task failed")
                    return TaskResponse(
                        task_id=task_id,
                        status="FAILURE",
                        message="AI invoice extraction encountered an error.",
                        error=str(task.info or "Task failed"),
                    )
                elif state in ("STARTED", "PROGRESS"):
                    progress_meta = task.info if isinstance(task.info, dict) else {}
                    return TaskResponse(
                        task_id=task_id,
                        status="PROGRESS",
                        message=progress_meta.get("status", "PyMuPDF & AI Vision model extracting fields..."),
                    )
            except Exception as e:
                logger.warning("Celery status inspection error for task [%s]: %s", task_id, e)

        # Self-healing: If task is still pending/progressing and more than 3 seconds elapsed
        # and file_path still exists, it means Celery worker didn't pick it up or is stuck!
        elapsed = time.time() - mem_task.get("created_at", time.time())
        file_path = mem_task.get("file_path")
        if elapsed > 3.0 and file_path and os.path.exists(file_path) and not mem_task.get("local_running"):
            logger.warning(
                "Task [%s] has been waiting for %0.1fs. Triggering local self-healing execution.",
                task_id,
                elapsed,
            )
            mem_task["local_running"] = True
            mem_task["status"] = "PROGRESS"
            mem_task["message"] = "Extracting document data with PyMuPDF and AI Vision..."
            loop = asyncio.get_running_loop()
            loop.run_in_executor(None, _run_local_extract, task_id, file_path)

        return TaskResponse(
            task_id=task_id,
            status=mem_task.get("status", "PROGRESS"),
            message=mem_task.get("message", "Extracting document data with PyMuPDF and AI Vision..."),
        )

    # 2. Fall back to Celery AsyncResult (for older tasks or tasks started externally)
    try:
        task = AsyncResult(task_id, app=celery_app)
        state = task.state

        if state == "SUCCESS":
            return TaskResponse(
                task_id=task_id,
                status="SUCCESS",
                message="Invoice extracted and persisted to database with status='pending'.",
                result=task.result,
            )
        elif state == "FAILURE":
            return TaskResponse(
                task_id=task_id,
                status="FAILURE",
                message="AI invoice extraction encountered an error.",
                error=str(task.info or "Task failed"),
            )
        elif state in ("STARTED", "PROGRESS"):
            progress_meta = task.info if isinstance(task.info, dict) else {}
            return TaskResponse(
                task_id=task_id,
                status="PROGRESS",
                message=progress_meta.get("status", "PyMuPDF & AI Vision model extracting fields..."),
            )
        else:
            return TaskResponse(
                task_id=task_id,
                status="PROGRESS",
                message="Invoice task is queued and processing with PyMuPDF & AI Vision...",
            )
    except Exception as e:
        logger.error("Failed to fetch task status for %s: %s", task_id, e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error inspecting task: {str(e)}",
        )


# ---------------------------------------------------------
# Bank Ledger Endpoints
# ---------------------------------------------------------
@app.post(
    "/api/ledger/",
    response_model=BankLedgerResponse,
    status_code=status.HTTP_201_CREATED,
    tags=["Bank Ledger"],
    summary="Add a bank transaction record",
)
async def add_ledger_entry(entry_in: BankLedgerCreate, db: AsyncSession = Depends(get_db)):
    """Insert a dummy or real bank transaction into the BankLedger."""
    try:
        new_entry = BankLedger(
            transaction_date=entry_in.transaction_date,
            received_amount=round(entry_in.received_amount, 2),
            description=entry_in.description.strip(),
            is_matched=False,
        )
        db.add(new_entry)
        await db.commit()
        await db.refresh(new_entry)
        logger.info("Recorded BankLedger #%d: $%.2f - '%s'", new_entry.id, new_entry.received_amount, new_entry.description)
        return new_entry
    except Exception as e:
        await db.rollback()
        logger.error("Failed to add ledger entry: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to record bank transaction: {str(e)}",
        )


@app.get(
    "/api/ledger/",
    response_model=List[BankLedgerResponse],
    tags=["Bank Ledger"],
    summary="List all bank ledger transactions",
)
async def list_ledger_entries(
    is_matched: Optional[bool] = Query(None, description="Filter by matching status"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve bank ledger records with optional matching status filter."""
    query = select(BankLedger)
    if is_matched is not None:
        query = query.where(BankLedger.is_matched == is_matched)
    query = query.order_by(BankLedger.transaction_date.desc(), BankLedger.id.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    return result.scalars().all()


# ---------------------------------------------------------
# AI Agent Reconciliation Endpoint
# ---------------------------------------------------------



@app.post(
    "/api/agent/run-reconciliation",
    response_model=AgentSummaryResponse,
    tags=["AI Agent"],
    summary="Trigger autonomous LangGraph reconciliation agent",
)
async def trigger_langgraph_agent():
    """Autonomously executes the LangGraph ReAct reconciliation agent with NO manual input:

    1. Connects to PostgreSQL and fetches ALL invoices where status='pending'.
    2. Employs LangGraph ReAct agent powered by Fireworks AI LLM with tools:
       - `get_pending_invoices`: queries database for pending items.
       - `search_ledger`: queries bank ledger with fuzzy matching and wire fee support.
       - `update_status`: updates database status and records the LLM's reasoning.
    3. Automatically updates database: sets status to 'paid' if matched, or 'exception_human_review' if not matched/partial.
    4. Returns summary: {"processed": N, "paid": X, "exceptions": Y}.
    """
    try:
        summary = await run_autonomous_agent()
        logger.info("Autonomous LangGraph ReAct agent finished: %s", summary)
        return summary
    except Exception as e:
        logger.error("LangGraph agent execution failed: %s", e, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"LangGraph Agent execution failed: {str(e)}",
        )



# ---------------------------------------------------------
# Human-in-the-Loop Exceptions Endpoints
# ---------------------------------------------------------
@app.get(
    "/api/exceptions/",
    response_model=List[InvoiceResponse],
    tags=["Exceptions & Human Review"],
    summary="Fetch all invoices requiring human review",
)
async def get_exceptions(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    """Fetch all invoices currently in 'exception_human_review' status.

    Consumed by the React frontend dashboard for CFO / human intervention.
    """
    query = (
        select(Invoice)
        .where(Invoice.status == InvoiceStatus.EXCEPTION_HUMAN_REVIEW.value)
        .order_by(Invoice.due_date.asc(), Invoice.id.asc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(query)
    exceptions = result.scalars().all()
    logger.info("Retrieved %d exception(s) for human review.", len(exceptions))
    return exceptions


@app.post(
    "/api/exceptions/{invoice_id}/resolve",
    response_model=InvoiceResponse,
    tags=["Exceptions & Human Review"],
    summary="Manually resolve an exception invoice (paid or rejected)",
)
async def resolve_exception(
    invoice_id: int,
    payload: ResolveExceptionRequest,
    db: AsyncSession = Depends(get_db),
):
    """Allow a human operator to review and resolve an invoice exception.

    Updates the invoice status to either 'paid' or 'rejected' with human review notes.
    """
    query = select(Invoice).where(Invoice.id == invoice_id)
    result = await db.execute(query)
    invoice = result.scalar_one_or_none()

    if not invoice:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Invoice #{invoice_id} not found.",
        )

    # Validate target status
    target_status = payload.action
    if target_status not in (InvoiceStatus.PAID.value, InvoiceStatus.REJECTED.value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid action '{target_status}'. Must be 'paid' or 'rejected'.",
        )

    previous_status = invoice.status
    invoice.status = target_status

    # Record human intervention trail
    resolution_text = f"Human Review ({target_status.upper()})"
    if payload.notes:
        resolution_text += f": {payload.notes.strip()}"
    if invoice.resolution_notes:
        invoice.resolution_notes = f"{invoice.resolution_notes} | {resolution_text}"
    else:
        invoice.resolution_notes = resolution_text

    await db.commit()
    await db.refresh(invoice)

    logger.info(
        "Resolved Invoice #%d from '%s' to '%s' by human review.",
        invoice_id,
        previous_status,
        target_status,
    )
    return invoice


@app.post(
    "/api/exceptions/{invoice_id}/send-email",
    response_model=SendVendorEmailResponse,
    status_code=status.HTTP_200_OK,
    tags=["Exceptions & Human Review"],
    summary="Dispatch autonomous vendor follow-up email via Gmail SMTP",
)
async def send_vendor_email(
    invoice_id: int,
    payload: Optional[SendVendorEmailRequest] = None,
    db: AsyncSession = Depends(get_db),
):
    """Sends a polite, professional discrepancy follow-up email to the vendor.

    - Uses real Gmail SMTP if configured (`gmail` and `gmail_secret` in .env),
      or gracefully logs simulated delivery if credentials are unconfigured.
    - Updates recipient email and draft body if edited by the reviewer.
    - If `draft_email_content` is missing, dynamically generates it using the AI Agent.
    - Records audit trail in resolution notes and returns 200 OK.
    """
    query = select(Invoice).where(Invoice.id == invoice_id)
    result = await db.execute(query)
    invoice = result.scalar_one_or_none()

    if not invoice:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Invoice #{invoice_id} not found.",
        )

    # 1. Update vendor email if provided, or derive fallback
    recipient = (payload.vendor_email.strip() if payload and payload.vendor_email and payload.vendor_email.strip() else None) or invoice.vendor_email
    if not recipient:
        recipient = infer_vendor_email(invoice.vendor_name)
    invoice.vendor_email = recipient

    # 2. Update draft email content if provided, or generate if missing
    email_body = (payload.email_content.strip() if payload and payload.email_content and payload.email_content.strip() else None) or invoice.draft_email_content
    if not email_body:
        email_body = await generate_vendor_exception_email(
            vendor_name=invoice.vendor_name,
            invoice_amount=float(invoice.amount),
            received_amount=0.0,
            reasoning=invoice.reasoning or invoice.resolution_notes or "Discrepancy flagged during reconciliation.",
            due_date=str(invoice.due_date) if invoice.due_date else None,
            invoice_id=invoice.id,
        )
    invoice.draft_email_content = email_body

    # 3. Dispatch real email via Gmail SMTP (or fallback gracefully to simulated)
    timestamp_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    try:
        dispatch_result = send_real_gmail(
            recipient_email=recipient,
            raw_content=email_body,
            invoice_id=invoice.id,
            vendor_name=invoice.vendor_name,
        )
    except Exception as exc:
        logger.error("Failed to send real Gmail to %s: %s", recipient, exc, exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to dispatch email via Gmail: {str(exc)}",
        )

    # 4. Record follow-up audit trail
    mode_tag = "Live Gmail" if dispatch_result.get("is_real_email") else "Simulated"
    sender_tag = dispatch_result.get("sender_email") or "system"
    dispatch_note = f"Follow-up email dispatched via {mode_tag} ({sender_tag}) to {recipient} at {timestamp_str}"
    if invoice.resolution_notes:
        invoice.resolution_notes = f"{invoice.resolution_notes} | {dispatch_note}"
    else:
        invoice.resolution_notes = dispatch_note

    await db.commit()
    await db.refresh(invoice)

    return SendVendorEmailResponse(
        status="success",
        message=dispatch_result.get("message", f"Vendor follow-up email successfully dispatched to {recipient}."),
        invoice_id=invoice.id,
        vendor_email=recipient,
        email_content=email_body,
        is_real_email=dispatch_result.get("is_real_email", False),
        sender_email=dispatch_result.get("sender_email"),
    )


@app.get(
    "/api/email/status",
    response_model=EmailConfigStatus,
    tags=["Email"],
    summary="Check Gmail SMTP configuration status",
)
async def get_email_status():
    """Returns whether real Gmail SMTP delivery is configured and the sender email address."""
    user, _ = get_gmail_credentials()
    return EmailConfigStatus(
        is_configured=bool(user),
        sender_email=user,
    )


# ---------------------------------------------------------
# CFO Dashboard Statistics Endpoint
# ---------------------------------------------------------
@app.get(
    "/api/stats",
    response_model=DashboardStats,
    tags=["Dashboard & Analytics"],
    summary="Get high-level CFO dashboard metrics",
)
async def get_dashboard_stats(db: AsyncSession = Depends(get_db)):
    """Return aggregated metrics for the Autonomous Office of the CFO dashboard."""
    # Invoice count and amount totals
    inv_counts = await db.execute(
        select(Invoice.status, func.count(Invoice.id), func.coalesce(func.sum(Invoice.amount), 0.0))
        .group_by(Invoice.status)
    )
    status_map = {row[0]: (row[1], float(row[2])) for row in inv_counts.all()}

    pending_count, _ = status_map.get(InvoiceStatus.PENDING.value, (0, 0.0))
    paid_count, _ = status_map.get(InvoiceStatus.PAID.value, (0, 0.0))
    exception_count, _ = status_map.get(InvoiceStatus.EXCEPTION_HUMAN_REVIEW.value, (0, 0.0))
    rejected_count, _ = status_map.get(InvoiceStatus.REJECTED.value, (0, 0.0))

    total_invoices = pending_count + paid_count + exception_count + rejected_count
    total_invoice_amt = sum(amount for _, amount in status_map.values())

    # Bank ledger total received
    ledger_sum_res = await db.execute(select(func.coalesce(func.sum(BankLedger.received_amount), 0.0)))
    total_ledger_amt = float(ledger_sum_res.scalar_one())

    reconciliation_rate = (paid_count / total_invoices * 100.0) if total_invoices > 0 else 0.0

    return DashboardStats(
        total_invoices=total_invoices,
        pending_count=pending_count,
        paid_count=paid_count,
        exception_count=exception_count,
        rejected_count=rejected_count,
        total_invoice_amount=round(total_invoice_amt, 2),
        total_ledger_amount=round(total_ledger_amt, 2),
        reconciliation_rate_percent=round(reconciliation_rate, 2),
    )
