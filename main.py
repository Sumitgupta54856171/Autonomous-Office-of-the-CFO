"""FastAPI application for AutoCFO: Autonomous Office of the CFO.

Exposes RESTful endpoints for invoice management, bank ledger operations,
AI agent reconciliation, and human review exception resolution.
"""

import logging
import os
import shutil
import uuid
from contextlib import asynccontextmanager
from typing import List, Optional
from celery.result import AsyncResult
from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from agent import AgentState, agent_graph, run_autonomous_agent
from auth import verify_clerk_token
from celery_app import celery_app, extract_invoice_task
from database import close_db, get_db, init_db
from models import BankLedger, Invoice, InvoiceStatus
from schemas import (
    AgentSummaryResponse,
    BankLedgerCreate,
    BankLedgerResponse,
    DashboardStats,
    InvoiceCreate,
    InvoiceResponse,
    ResolveExceptionRequest,
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
    """Accepts an invoice document (PDF or image), saves it to ./temp,
    triggers the background Celery task, and returns 202 Accepted with a task_id.
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

    # Enqueue background Celery task
    try:
        task = extract_invoice_task.delay(file_path)
        logger.info("Enqueued Celery invoice extraction task [%s] for file: %s", task.id, file.filename)
    except Exception as exc:
        if os.path.exists(file_path):
            os.remove(file_path)
        logger.error("Failed to dispatch Celery task: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Background task queue unavailable: {str(exc)}",
        )

    return UploadInvoiceResponse(
        task_id=task.id,
        status="PENDING",
        message="Invoice upload received. Async AI vision extraction enqueued.",
        filename=file.filename or "invoice",
    )


@app.get(
    "/api/tasks/{task_id}",
    response_model=TaskResponse,
    tags=["Async Tasks"],
    summary="Poll status of Celery background extraction task",
)
async def get_task_status(
    task_id: str,
    current_user: dict = Depends(verify_clerk_token),
):
    """Returns the current state and result of the Celery task (PENDING, STARTED, SUCCESS, FAILURE)."""
    try:
        task = AsyncResult(task_id, app=celery_app)
        state = task.state

        if state in ("PENDING", "RECEIVED"):
            return TaskResponse(
                task_id=task_id,
                status="PENDING",
                message="Invoice task is queued and waiting for an available worker...",
            )
        elif state in ("STARTED", "PROGRESS"):
            progress_meta = task.info if isinstance(task.info, dict) else {}
            return TaskResponse(
                task_id=task_id,
                status="PROGRESS",
                message=progress_meta.get("status", "PyMuPDF & AI Vision model extracting fields..."),
            )
        elif state == "SUCCESS":
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
        else:
            return TaskResponse(
                task_id=task_id,
                status=state,
                message=f"Current task status: {state}",
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
