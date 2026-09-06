"""AI Agent Core Logic for AutoCFO.

Implements the autonomous reconciliation pipeline:
- Scans pending invoices
- Evaluates bank ledger transactions
- Auto-reconciles exact matches to 'paid'
- Flags unmatched invoices and partial payments to 'exception_human_review'
"""

import logging
from typing import Any, Dict, List, Optional
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from database import AsyncSessionLocal
from models import BankLedger, Invoice, InvoiceStatus

logger = logging.getLogger("autocfo.agent")


async def reconcile_invoices(db: Optional[AsyncSession] = None) -> Dict[str, Any]:
    """Execute autonomous AI agent reconciliation.

    Fetches all 'pending' invoices and matches them against available bank ledger records.
    - Exact amount match -> Invoice status updated to 'paid' and ledger marked matched.
    - Partial payment or no match -> Invoice status updated to 'exception_human_review'.

    Args:
        db: Optional AsyncSession. If not provided, a managed session will be created.

    Returns:
        Dict summarizing reconciliation results with itemized outcomes.
    """
    if db is None:
        async with AsyncSessionLocal() as session:
            result = await _reconcile_invoices_impl(session)
            await session.commit()
            return result
    else:
        result = await _reconcile_invoices_impl(db)
        await db.commit()
        return result


async def _reconcile_invoices_impl(session: AsyncSession) -> Dict[str, Any]:
    logger.info("🤖 AutoCFO Agent: Starting autonomous invoice reconciliation run...")

    # 1. Fetch all pending invoices
    pending_query = (
        select(Invoice)
        .where(Invoice.status == InvoiceStatus.PENDING.value)
        .order_by(Invoice.id.asc())
    )
    pending_res = await session.execute(pending_query)
    pending_invoices = list(pending_res.scalars().all())

    total_pending = len(pending_invoices)
    logger.info("🤖 AutoCFO Agent: Found %d pending invoice(s) to reconcile.", total_pending)

    if total_pending == 0:
        return {
            "status": "completed",
            "message": "No pending invoices found to reconcile.",
            "total_processed": 0,
            "reconciled_paid_count": 0,
            "flagged_exception_count": 0,
            "details": [],
        }

    # 2. Fetch all available (unmatched) bank ledger entries
    ledger_query = (
        select(BankLedger)
        .where(BankLedger.is_matched.is_(False))
        .order_by(BankLedger.transaction_date.asc(), BankLedger.id.asc())
    )
    ledger_res = await session.execute(ledger_query)
    unmatched_ledgers = list(ledger_res.scalars().all())
    logger.info("🤖 AutoCFO Agent: Found %d unmatched bank ledger transaction(s).", len(unmatched_ledgers))

    reconciled_paid = 0
    flagged_exceptions = 0
    details: List[Dict[str, Any]] = []

    # 3. Process each pending invoice
    for invoice in pending_invoices:
        inv_amount = round(invoice.amount, 2)
        vendor_normalized = invoice.vendor_name.strip().lower()
        logger.info(
            "🔍 Inspecting Invoice #%d | Vendor: '%s' | Amount: $%.2f | Due: %s",
            invoice.id,
            invoice.vendor_name,
            inv_amount,
            invoice.due_date,
        )

        # Step 3a: Search for exact amount match in unmatched ledger
        exact_match: Optional[BankLedger] = None

        # First preference: exact amount AND vendor name mentioned in memo/description
        for entry in unmatched_ledgers:
            entry_amount = round(entry.received_amount, 2)
            if entry_amount == inv_amount and vendor_normalized in entry.description.lower():
                exact_match = entry
                break

        # Second preference: exact amount match
        if exact_match is None:
            for entry in unmatched_ledgers:
                entry_amount = round(entry.received_amount, 2)
                if entry_amount == inv_amount:
                    exact_match = entry
                    break

        if exact_match is not None:
            # Reconcile invoice as PAID
            invoice.status = InvoiceStatus.PAID.value
            invoice.matched_ledger_id = exact_match.id
            invoice.resolution_notes = (
                f"AI Agent: Auto-reconciled. Exact match found with Bank Ledger #{exact_match.id} "
                f"(${exact_match.received_amount:.2f}) on {exact_match.transaction_date}. "
                f"Memo: '{exact_match.description}'."
            )
            # Mark ledger entry as matched to prevent double matching
            exact_match.is_matched = True
            exact_match.matched_invoice_id = invoice.id
            unmatched_ledgers.remove(exact_match)

            reconciled_paid += 1
            logger.info("✅ Invoice #%d MATCHED with Ledger #%d ($%.2f) -> Status: PAID", invoice.id, exact_match.id, inv_amount)

            details.append({
                "invoice_id": invoice.id,
                "vendor_name": invoice.vendor_name,
                "amount": inv_amount,
                "status": invoice.status,
                "notes": invoice.resolution_notes,
                "matched_ledger_id": exact_match.id,
            })
            continue

        # Step 3b: Search for partial payment match
        # Check if any transaction description mentions the vendor/invoice but amount is lower
        partial_match: Optional[BankLedger] = None
        for entry in unmatched_ledgers:
            entry_amount = round(entry.received_amount, 2)
            desc_lower = entry.description.lower()
            if (vendor_normalized in desc_lower or f"inv-{invoice.id}" in desc_lower) and (0 < entry_amount < inv_amount):
                partial_match = entry
                break

        if partial_match is not None:
            # Partial payment detected -> flag for human review
            invoice.status = InvoiceStatus.EXCEPTION_HUMAN_REVIEW.value
            invoice.resolution_notes = (
                f"AI Agent Flagged: Partial payment detected. Received ${partial_match.received_amount:.2f} "
                f"of expected ${inv_amount:.2f} in Bank Ledger #{partial_match.id} ('{partial_match.description}'). "
                f"Requires human intervention."
            )
            flagged_exceptions += 1
            logger.warning("⚠️ Invoice #%d PARTIAL PAYMENT ($%.2f < $%.2f) -> Status: EXCEPTION_HUMAN_REVIEW", invoice.id, partial_match.received_amount, inv_amount)

            details.append({
                "invoice_id": invoice.id,
                "vendor_name": invoice.vendor_name,
                "amount": inv_amount,
                "status": invoice.status,
                "notes": invoice.resolution_notes,
                "matched_ledger_id": partial_match.id,
            })
            continue

        # Step 3c: No match found -> flag for human review
        invoice.status = InvoiceStatus.EXCEPTION_HUMAN_REVIEW.value
        invoice.resolution_notes = (
            f"AI Agent Flagged: No matching bank ledger transaction found for amount ${inv_amount:.2f}. "
            f"Requires human intervention."
        )
        flagged_exceptions += 1
        logger.warning("⚠️ Invoice #%d NO MATCH FOUND for $%.2f -> Status: EXCEPTION_HUMAN_REVIEW", invoice.id, inv_amount)

        details.append({
            "invoice_id": invoice.id,
            "vendor_name": invoice.vendor_name,
            "amount": inv_amount,
            "status": invoice.status,
            "notes": invoice.resolution_notes,
            "matched_ledger_id": None,
        })

    logger.info(
        "🤖 AutoCFO Agent: Reconciliation run finished. Processed: %d | Paid: %d | Exceptions: %d",
        total_pending,
        reconciled_paid,
        flagged_exceptions,
    )

    return {
        "status": "completed",
        "message": (
            f"Reconciliation completed. Processed {total_pending} invoices: "
            f"{reconciled_paid} paid, {flagged_exceptions} flagged for human review."
        ),
        "total_processed": total_pending,
        "reconciled_paid_count": reconciled_paid,
        "flagged_exception_count": flagged_exceptions,
        "details": details,
    }
