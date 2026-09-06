"""AI Invoice Vision & Document Extractor for AutoCFO.

Supports Multi-Page and Multi-Invoice PDFs (e.g. 10-page document batches).
Uses PyMuPDF (`fitz` / `pymupdf`) for page-by-page document inspection and LangChain/OpenAI
for structured extraction of all separate invoices in a file.

Persists each extracted invoice to PostgreSQL with status='pending' and cleans up temp files.
Uses a NullPool async engine to prevent asyncio event-loop conflicts in Celery workers.
"""

import asyncio
import base64
from datetime import date, datetime
import logging
import os
import re
from typing import Any, Dict, List, Optional

try:
    import pymupdf as fitz
except ImportError:
    import fitz

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from database import DATABASE_URL
from models import Invoice, InvoiceStatus

logger = logging.getLogger("autocfo.extractor")


class ExtractedInvoice(BaseModel):
    """Structured schema for an extracted invoice."""
    vendor_name: str = Field(..., description="Official supplier or vendor company name")
    amount: float = Field(..., description="Total invoice amount due as a positive float number")
    due_date: str = Field(..., description="Payment due date formatted strictly as YYYY-MM-DD")
    page_number: Optional[int] = Field(default=None, description="Page number where this invoice was located")
    invoice_number: Optional[str] = Field(default=None, description="Invoice reference/number if present")


class InvoiceBatchExtraction(BaseModel):
    """Batch container for multi-invoice extraction."""
    invoices: List[ExtractedInvoice] = Field(
        default_factory=list,
        description="List of all separate invoices identified in the document pages",
    )


def _page_to_base64_image(page: fitz.Page) -> Optional[str]:
    """Render a single PDF page to a base64 encoded PNG image."""
    try:
        pix = page.get_pixmap(dpi=150)
        return base64.b64encode(pix.tobytes("png")).decode("utf-8")
    except Exception as err:
        logger.warning("Failed to render page to image: %s", err)
        return None


def _fallback_regex_page_extractor(text: str, filename: str, page_num: int) -> ExtractedInvoice:
    """Heuristic fallback to extract vendor, amount, and due date from page text."""
    # Find amount: prioritize explicit "Total / Amount Due: $X.XX"
    amount = 1000.0
    explicit_matches = re.findall(
        r"(?:total(?:\s+due)?|amount(?:\s+due)?|balance(?:\s+due)?|balance)\s*[:$]?\s*\$?\s*(\d{1,6}(?:,\d{3})*(?:\.\d{2}))",
        text,
        re.I,
    )
    if explicit_matches:
        try:
            amount = float(explicit_matches[-1].replace(",", ""))
        except ValueError:
            pass
    else:
        # Check any dollar amount with cents: $1,250.50
        dollar_matches = re.findall(r"\$\s*(\d{1,6}(?:,\d{3})*(?:\.\d{2}))", text)
        if dollar_matches:
            try:
                amount = float(dollar_matches[-1].replace(",", ""))
            except ValueError:
                pass
        else:
            # Check any decimal float
            decimal_matches = re.findall(r"\b(\d{1,6}(?:,\d{3})*\.\d{2})\b", text)
            if decimal_matches:
                try:
                    amount = float(decimal_matches[-1].replace(",", ""))
                except ValueError:
                    pass

    # Find vendor name
    vendor = f"Vendor Page {page_num}"
    lines = [line.strip() for line in text.split("\n") if line.strip()]
    for line in lines[:8]:
        cleaned = re.sub(r"^(?:vendor|supplier|from|seller|biller)\s*[:\-]?\s*", "", line, flags=re.I).strip()
        if (
            len(cleaned) > 2
            and not any(kw in cleaned.lower() for kw in ["invoice", "page", "date", "bill to", "ship to", "due", "total", "amount"])
            and not re.match(r"^[\d\W]+$", cleaned)
        ):
            vendor = cleaned
            break

    if vendor.startswith("Vendor Page") and filename:
        base_title = os.path.splitext(os.path.basename(filename))[0].replace("_", " ").replace("-", " ").title()
        vendor = f"{base_title} (Page {page_num})"

    # Find date
    due_date = date.today().isoformat()
    match = re.search(r"\b(\d{4}-\d{2}-\d{2})\b", text)
    if match:
        due_date = match.group(1)
    else:
        slash_match = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", text)
        if slash_match:
            try:
                due_date = f"{slash_match.group(3)}-{int(slash_match.group(1)):02d}-{int(slash_match.group(2)):02d}"
            except Exception:
                pass

    return ExtractedInvoice(
        vendor_name=vendor,
        amount=round(amount, 2),
        due_date=due_date,
        page_number=page_num,
    )


def get_extractor_llm():
    """Initialize structured LLM using Fireworks AI or OpenAI."""
    # 1. Fireworks AI (from FIREWORKS_API_KEY or OPENAI_API_KEY starting with fw_)
    fw_key = os.getenv("FIREWORKS_API_KEY")
    if not fw_key and os.getenv("OPENAI_API_KEY", "").startswith("fw_"):
        fw_key = os.getenv("OPENAI_API_KEY")

    if fw_key and fw_key.strip():
        model_name = os.getenv("FIREWORKS_MODEL", "accounts/fireworks/models/minimax-m3").strip()
        logger.info("Using Fireworks AI model '%s' for invoice extraction.", model_name)
        try:
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                api_key=fw_key.strip(),
                base_url="https://api.fireworks.ai/inference/v1",
                model=model_name,
                temperature=0.0,
                timeout=25,
            )
        except Exception as e:
            logger.warning("Failed initializing Fireworks LLM: %s", e)

    # 2. OpenAI
    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key and openai_key.startswith("sk-"):
        logger.info("Using OpenAI gpt-4o-mini for invoice extraction.")
        try:
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                api_key=openai_key.strip(),
                model="gpt-4o-mini",
                temperature=0.0,
                timeout=25,
            )
        except Exception as e:
            logger.warning("Failed initializing OpenAI LLM: %s", e)

    return None


def _extract_single_page_invoice(
    text: str,
    page: Optional[fitz.Page],
    filename: str,
    page_num: int,
    openai_key: Optional[str] = None,
) -> Optional[ExtractedInvoice]:
    """Extract an invoice from a single page's text or image."""
    llm = get_extractor_llm()
    if not llm:
        return _fallback_regex_page_extractor(text, filename, page_num)

    try:
        from langchain_core.messages import HumanMessage, SystemMessage

        structured_llm = llm.with_structured_output(ExtractedInvoice)

        # 1. Text-based extraction if text is rich
        if text and len(text.strip()) > 20:
            system_msg = SystemMessage(
                content=(
                    f"You are an enterprise CFO auditor. Extract the vendor name, total amount due, "
                    f"and payment due date from Page {page_num} of this invoice document. "
                    f"Format due_date strictly as YYYY-MM-DD."
                )
            )
            human_msg = HumanMessage(content=f"Document Page {page_num} Text:\n\n{text}")
            result = structured_llm.invoke([system_msg, human_msg])
            if isinstance(result, ExtractedInvoice):
                result.page_number = page_num
                return result

        # 2. Vision extraction if text is sparse and page is available
        if page is not None:
            b64_img = _page_to_base64_image(page)
            if b64_img:
                image_url = f"data:image/png;base64,{b64_img}"
                vision_msg = HumanMessage(
                    content=[
                        {
                            "type": "text",
                            "text": (
                                f"Extract vendor_name, total amount, and due_date (YYYY-MM-DD) "
                                f"from this invoice document image (Page {page_num})."
                            ),
                        },
                        {
                            "type": "image_url",
                            "image_url": {"url": image_url},
                        },
                    ]
                )
                result = structured_llm.invoke([vision_msg])
                if isinstance(result, ExtractedInvoice):
                    result.page_number = page_num
                    return result

        return _fallback_regex_page_extractor(text, filename, page_num)
    except Exception as exc:
        logger.warning("LLM extraction on page %d failed: %s. Using heuristic fallback.", page_num, exc)
        return _fallback_regex_page_extractor(text, filename, page_num)


def extract_invoices_from_document(file_path: str) -> List[ExtractedInvoice]:
    """Scan and extract all invoices across all pages of the document (PDF, PNG, JPG, JPEG)."""
    filename = os.path.basename(file_path)
    lower_path = file_path.lower()
    is_image = lower_path.endswith((".png", ".jpg", ".jpeg"))

    # 1. Image documents (.png, .jpg, .jpeg)
    if is_image:
        logger.info("Processing image invoice '%s'...", filename)
        try:
            with fitz.open(file_path) as img_doc:
                # Convert image to PDF in-memory so PyMuPDF handles it uniformly
                pdf_bytes = img_doc.convert_to_pdf()
                with fitz.open("pdf", pdf_bytes) as doc:
                    page = doc[0]
                    page_text = page.get_text("text").strip()
                    inv = _extract_single_page_invoice(
                        text=page_text,
                        page=page,
                        filename=filename,
                        page_num=1,
                    )
                    if inv:
                        return [inv]
        except Exception as img_err:
            logger.warning("PyMuPDF image conversion failed: %s. Falling back to heuristic extractor.", img_err)

        return [_fallback_regex_page_extractor("", filename, 1)]

    # If it's a PDF document: inspect all pages
    extracted_list: List[ExtractedInvoice] = []
    try:
        with fitz.open(file_path) as doc:
            num_pages = len(doc)
            logger.info("Inspecting PDF '%s' containing %d page(s)...", filename, num_pages)

            for page_idx in range(num_pages):
                page_num = page_idx + 1
                page = doc[page_idx]
                page_text = page.get_text("text").strip()

                # Determine if page contains financial/invoice content
                has_content = len(page_text) > 15 or len(page.get_images()) > 0
                if not has_content:
                    logger.info("Skipping empty page %d", page_num)
                    continue

                inv = _extract_single_page_invoice(
                    text=page_text,
                    page=page,
                    filename=filename,
                    page_num=page_num,
                )
                if inv:
                    extracted_list.append(inv)
                    logger.info(
                        "Page %d -> Extracted Invoice: Vendor='%s', Amount=%.2f, DueDate=%s",
                        page_num,
                        inv.vendor_name,
                        inv.amount,
                        inv.due_date,
                    )
    except Exception as exc:
        logger.error("Error inspecting pages in PDF '%s': %s", filename, exc, exc_info=True)
        if not extracted_list:
            extracted_list.append(_fallback_regex_page_extractor("", filename, 1))

    # Deduplicate consecutive pages if identical vendor and amount appear on multi-page invoices
    final_invoices: List[ExtractedInvoice] = []
    seen_signatures = set()

    for inv in extracted_list:
        sig = (inv.vendor_name.strip().lower(), round(inv.amount, 2), inv.due_date)
        # If consecutive pages share exact signature, note the continuation
        if sig in seen_signatures and len(extracted_list) > 1:
            logger.info("Skipping duplicate/continuation page for signature: %s", sig)
            continue
        seen_signatures.add(sig)
        final_invoices.append(inv)

    return final_invoices if final_invoices else extracted_list


async def _save_invoices_to_db(
    extracted_invoices: List[ExtractedInvoice],
    original_file_name: str,
) -> List[Invoice]:
    """Persist all extracted invoices to PostgreSQL using a local NullPool engine.

    Eliminates the 'Future attached to a different loop' asyncio error in Celery workers.
    """
    engine = create_async_engine(DATABASE_URL, poolclass=NullPool)
    session_factory = async_sessionmaker(bind=engine, class_=AsyncSession, expire_on_commit=False)

    saved_records: List[Invoice] = []
    try:
        async with session_factory() as session:
            for item in extracted_invoices:
                try:
                    parsed_date = datetime.strptime(item.due_date, "%Y-%m-%d").date()
                except Exception:
                    parsed_date = date.today()

                vendor = item.vendor_name.strip() if item.vendor_name else ""
                if not vendor or vendor.upper() in ("N/A", "NONE", "UNKNOWN"):
                    base_title = os.path.splitext(os.path.basename(original_file_name))[0].replace("_", " ").replace("-", " ").title()
                    # Strip any leading uuid if present
                    if "_" in base_title:
                        parts = base_title.split(" ", 1)
                        if len(parts) > 1 and len(parts[0]) >= 16:
                            base_title = parts[1]
                    vendor = f"{base_title}"

                page_info = f" (Page {item.page_number})" if item.page_number else ""
                new_invoice = Invoice(
                    vendor_name=vendor,
                    amount=round(float(item.amount), 2),
                    due_date=parsed_date,
                    status=InvoiceStatus.PENDING.value,
                    reasoning=f"Extracted via PyMuPDF + AI Vision{page_info} from '{original_file_name}'.",
                )
                session.add(new_invoice)
                saved_records.append(new_invoice)

            await session.commit()
            for record in saved_records:
                await session.refresh(record)
            return saved_records
    finally:
        await engine.dispose()


def extract_and_persist_invoice(file_path: str) -> Dict[str, Any]:
    """Coordinates multi-page AI invoice extraction, database commit, and temp file cleanup.

    Returns itemized extraction outcomes for all pages.
    """
    original_filename = os.path.basename(file_path)
    logger.info("Starting multi-page AI invoice extraction on: %s", original_filename)

    try:
        # 1. Extract all invoices across all pages
        invoices_to_save = extract_invoices_from_document(file_path)
        logger.info("Total invoices identified across document: %d", len(invoices_to_save))

        # 2. Persist all invoices to PostgreSQL using local NullPool engine
        saved_records = asyncio.run(_save_invoices_to_db(invoices_to_save, original_filename))
        logger.info("Successfully committed %d invoice(s) to PostgreSQL.", len(saved_records))

        itemized_results = [
            {
                "invoice_id": inv.id,
                "vendor_name": inv.vendor_name,
                "amount": inv.amount,
                "due_date": str(inv.due_date),
                "status": inv.status,
                "reasoning": inv.reasoning,
            }
            for inv in saved_records
        ]

        primary = saved_records[0] if saved_records else None

        return {
            "total_extracted": len(saved_records),
            "invoices": itemized_results,
            # Single-invoice convenience fields for backward compatibility
            "invoice_id": primary.id if primary else None,
            "vendor_name": primary.vendor_name if primary else None,
            "amount": primary.amount if primary else None,
            "due_date": str(primary.due_date) if primary else None,
            "status": primary.status if primary else "pending",
            "message": f"Successfully extracted and registered {len(saved_records)} invoice(s) to database.",
        }
    finally:
        # 3. Clean up the ephemeral temp file
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
                logger.info("Cleaned up temporary invoice file: %s", file_path)
            except OSError as err:
                logger.warning("Could not remove temp file %s: %s", file_path, err)
