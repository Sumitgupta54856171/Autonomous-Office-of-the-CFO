"""Autonomous LangGraph ReAct AI Agent for AutoCFO Invoice Reconciliation.

Architecture:
- Pattern: ReAct (Reasoning + Acting) Agent using LangGraph & ChatOpenAI (Fireworks AI).
- Tools:
  1. `get_pending_invoices`: Queries PostgreSQL for all invoices with status='pending'.
  2. `search_ledger`: Searches unmatched BankLedger transactions by vendor keyword and approximate amount.
  3. `update_status`: Updates invoice status ('paid' or 'exception_human_review'), links matched ledger,
     and records the AI's detailed fuzzy-matching reasoning in the database.
- AI Reasoning:
  The LLM performs fuzzy matching across vendor abbreviations (e.g., 'TechCorp' vs 'TC-Inc'),
  wire transfer fee deductions (e.g., $1000 invoice with $980 wire less $20 fee), and flags
  unmatched transactions as exceptions for human review.
"""

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional
from dotenv import load_dotenv
from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent
from sqlalchemy import func, select

from database import AsyncSessionLocal
from models import BankLedger, Invoice, InvoiceStatus

load_dotenv()

logger = logging.getLogger("autocfo.agent")


# ---------------------------------------------------------------------------
# 1. Fireworks AI LLM Configuration
# ---------------------------------------------------------------------------
def get_react_llm() -> Optional[ChatOpenAI]:
    """Initialize ChatOpenAI configured with Fireworks AI endpoint."""
    api_key = os.getenv("FIREWORKS_API_KEY")
    if not api_key or api_key.strip() in ("", "your_fireworks_api_key_here"):
        logger.warning("FIREWORKS_API_KEY not configured. Falling back to rule-based reconciliation.")
        return None

    model_name = os.getenv("FIREWORKS_MODEL", "accounts/fireworks/models/minimax-m3").strip()
    return ChatOpenAI(
        api_key=api_key.strip(),
        base_url="https://api.fireworks.ai/inference/v1",
        model=model_name,
        temperature=0.0,
        timeout=60,
    )


# ---------------------------------------------------------------------------
# 2. ReAct Agent Tools
# ---------------------------------------------------------------------------
@tool
async def get_pending_invoices() -> str:
    """Returns a JSON string containing all pending invoices awaiting reconciliation."""
    async with AsyncSessionLocal() as session:
        query = (
            select(Invoice)
            .where(Invoice.status == InvoiceStatus.PENDING.value)
            .order_by(Invoice.id.asc())
        )
        res = await session.execute(query)
        invoices = res.scalars().all()

        data = [
            {
                "id": inv.id,
                "vendor_name": inv.vendor_name,
                "amount": round(float(inv.amount), 2),
                "due_date": str(inv.due_date),
            }
            for inv in invoices
        ]
        logger.info("🛠️ [Tool: get_pending_invoices] Retrieved %d pending invoice(s).", len(data))
        return json.dumps(data)


@tool
async def search_ledger(vendor_keyword: str = "", approximate_amount: float = 0.0) -> str:
    """Search bank records for unmatched transactions.

    Args:
        vendor_keyword: Substring or acronym to search in transaction description memo.
        approximate_amount: Expected invoice amount. The search looks within +/- $50
                            to detect potential bank wire transfer fees or deductions.
    Returns:
        JSON string of matching unmatched bank transactions.
    """
    async with AsyncSessionLocal() as session:
        query = select(BankLedger).where(BankLedger.is_matched.is_(False)).order_by(BankLedger.id.asc())
        res = await session.execute(query)
        all_unmatched = list(res.scalars().all())

        matched_entries = []
        kw = vendor_keyword.strip().lower() if vendor_keyword else ""
        amt = float(approximate_amount) if approximate_amount else 0.0

        for ledger in all_unmatched:
            desc_lower = ledger.description.lower()
            vendor_match = bool(
                kw and (kw in desc_lower or any(part in desc_lower for part in re.split(r"[\s\-_]+", kw) if len(part) >= 2))
            )
            amt_match = bool(amt > 0 and abs(round(ledger.received_amount, 2) - amt) <= 50.01)

            if vendor_match or amt_match or (not kw and amt == 0.0):
                matched_entries.append({
                    "id": ledger.id,
                    "transaction_date": str(ledger.transaction_date),
                    "received_amount": round(float(ledger.received_amount), 2),
                    "description": ledger.description,
                })

        # If strict filter returned nothing, return top unmatched entries for visibility
        if not matched_entries and all_unmatched:
            matched_entries = [
                {
                    "id": ledger.id,
                    "transaction_date": str(ledger.transaction_date),
                    "received_amount": round(float(ledger.received_amount), 2),
                    "description": ledger.description,
                }
                for ledger in all_unmatched[:10]
            ]

        logger.info(
            "🛠️ [Tool: search_ledger] kw='%s', amt=%.2f -> returned %d record(s).",
            vendor_keyword,
            approximate_amount,
            len(matched_entries),
        )
        return json.dumps(matched_entries)


def infer_vendor_email(vendor_name: str) -> str:
    """Derives a plausible corporate contact email from vendor name."""
    clean = re.sub(r"[^a-zA-Z0-9]+", "", vendor_name.lower())
    domain = f"{clean}.com" if clean else "vendor.com"
    return f"billing@{domain}"


def clean_email_content(raw: str) -> str:
    """Remove markdown bold asterisks (**), italics (*), headers, and divider lines.

    Produces clean, executive business plain text suitable for direct email transmission.
    """
    if not raw:
        return ""
    text = str(raw)
    # Remove bold markdown **word** or __word__
    text = re.sub(r"\*\*(.*?)\*\*", r"\1", text)
    text = re.sub(r"__(.*?)__", r"\1", text)
    # Remove italic markdown *word*
    text = re.sub(r"(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)", r"\1", text)
    # Remove markdown headers (# Title, ## Subtitle)
    text = re.sub(r"^#{1,6}\s*", "", text, flags=re.MULTILINE)
    # Remove horizontal rule lines (---, ***, ___)
    text = re.sub(r"^\s*[-*_]{3,}\s*$", "", text, flags=re.MULTILINE)
    # Convert markdown bullet points to clean indented dashes
    text = re.sub(r"^\s*[\*•]\s*", "  - ", text, flags=re.MULTILINE)
    # Remove trailing/leading spaces on lines and multiple consecutive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


async def generate_vendor_exception_email(
    vendor_name: str,
    invoice_amount: float,
    received_amount: Optional[float],
    reasoning: str,
    due_date: Optional[str] = None,
    invoice_id: Optional[int] = None,
) -> str:
    """Autonomously draft a polite, professional vendor follow-up email explaining discrepancy.

    Formats output cleanly without markdown bold asterisks or formatting symbols.
    """
    inv_str = f"${invoice_amount:,.2f}"
    rec_str = (
        f"${received_amount:,.2f}"
        if received_amount is not None and received_amount > 0
        else "$0.00 (No matching deposit identified in bank ledger)"
    )
    due_str = due_date or "Immediate"
    inv_tag = f"#{invoice_id}" if invoice_id else ""

    prompt = f"""You are the Autonomous CFO Agent for AutoCFO. Write a professional, polite, and clean plain-text email to the vendor regarding an invoice payment discrepancy.

Invoice Information:
- Vendor Name: {vendor_name}
- Invoice Reference: {inv_tag}
- Invoiced Amount: {inv_str}
- Received / Recorded Amount: {rec_str}
- Due Date: {due_str}
- Identified Discrepancy Reason: {reasoning}

CRITICAL FORMATTING INSTRUCTIONS:
1. Do NOT use markdown bold asterisks (NEVER use **text** or *text*). Output clean plain text.
2. Do NOT use markdown dividers like --- or ***.
3. Start directly with the Subject Line on line 1:
Subject: Payment Discrepancy Notice - Invoice {inv_tag} [{vendor_name}]
4. Cordially address the Accounts Receivable / Billing Department.
5. Reference the invoiced amount ({inv_str}), the amount identified in our ledger ({rec_str}), and explain the discrepancy reason ({reasoning}).
6. Request remittance advice, updated ledger statement, or payment verification.
7. Conclude with a professional sign-off from 'AutoCFO Autonomous Finance Team'.
"""

    llm = get_react_llm()
    if llm is not None:
        try:
            from langchain_core.messages import HumanMessage, SystemMessage
            response = await llm.ainvoke([
                SystemMessage(
                    content=(
                        "You are an enterprise CFO communications assistant specializing in vendor reconciliation emails. "
                        "Always write in clean business plain text. NEVER use markdown asterisks (no **bold** or *italics*)."
                    )
                ),
                HumanMessage(content=prompt),
            ])
            email_text = clean_email_content(str(response.content))
            if email_text:
                return email_text
        except Exception as err:
            logger.warning("LLM email drafting encountered error: %s. Using structured template.", err)

    # Deterministic high-quality fallback template without markdown asterisks
    return f"""Subject: Payment Discrepancy Notice - Invoice {inv_tag} [{vendor_name}]

Dear {vendor_name} Accounts Receivable Team,

I hope this message finds you well. I am writing on behalf of the AutoCFO Finance Team regarding Invoice {inv_tag} due on {due_str}.

During our autonomous financial reconciliation process, our system identified an unresolved payment discrepancy:
  - Invoiced Amount: {inv_str}
  - Amount Recorded in Bank Ledger: {rec_str}
  - Discrepancy Details: {reasoning}

To ensure timely reconciliation and maintain accurate accounting records, could you please review this transaction and provide updated remittance advice or an account statement?

If payment has already been initiated under an alternative wire reference or company memo, please let us know so we can update our records accordingly.

Thank you for your prompt assistance.

Sincerely,

AutoCFO Autonomous Finance Team
accounts@autocfo.com
"""


@tool
async def update_status(
    invoice_id: int,
    status: str,
    reasoning: str,
    matched_ledger_id: Optional[int] = None,
) -> str:
    """Update the status of an invoice in the database along with the AI reasoning.

    When status is 'exception_human_review', triggers a new LLM call to draft a polite,
    professional email to the vendor explaining the discrepancy and persists it to
    the invoice's `draft_email_content` field.
    """
    clean_status = status.strip().lower()
    if clean_status not in (InvoiceStatus.PAID.value, InvoiceStatus.EXCEPTION_HUMAN_REVIEW.value):
        clean_status = InvoiceStatus.EXCEPTION_HUMAN_REVIEW.value

    async with AsyncSessionLocal() as session:
        invoice = await session.get(Invoice, invoice_id)
        if not invoice:
            return f"Error: Invoice #{invoice_id} not found in database."

        invoice.status = clean_status
        invoice.reasoning = reasoning.strip()
        invoice.resolution_notes = reasoning.strip()

        if clean_status == InvoiceStatus.PAID.value and matched_ledger_id:
            ledger = await session.get(BankLedger, matched_ledger_id)
            if ledger:
                ledger.is_matched = True
                ledger.matched_invoice_id = invoice.id
                invoice.matched_ledger_id = ledger.id

        elif clean_status == InvoiceStatus.EXCEPTION_HUMAN_REVIEW.value:
            # Autonomous Vendor Follow-up: trigger LLM call to draft professional email
            received_amt = None
            if matched_ledger_id:
                ledger = await session.get(BankLedger, matched_ledger_id)
                if ledger:
                    received_amt = float(ledger.received_amount)

            if not invoice.vendor_email:
                invoice.vendor_email = infer_vendor_email(invoice.vendor_name)

            draft_email = await generate_vendor_exception_email(
                vendor_name=invoice.vendor_name,
                invoice_amount=float(invoice.amount),
                received_amount=received_amt,
                reasoning=reasoning.strip(),
                due_date=str(invoice.due_date) if invoice.due_date else None,
                invoice_id=invoice.id,
            )
            invoice.draft_email_content = draft_email
            logger.info("Drafted autonomous vendor exception email for Invoice #%d.", invoice_id)

        await session.commit()
        logger.info("🛠️ [Tool: update_status] Updated Invoice #%d -> '%s'.", invoice_id, clean_status)
        return f"Successfully updated Invoice #{invoice_id} to status='{clean_status}'."


# ---------------------------------------------------------------------------
# 3. System Prompt & ReAct Agent Construction
# ---------------------------------------------------------------------------
AUTOCFO_SYSTEM_PROMPT = """You are AutoCFO, an autonomous AI CFO Agent specializing in intelligent invoice reconciliation and exception handling.

Your objective is to reconcile all pending vendor invoices against bank ledger records using your provided tools:
1. `get_pending_invoices`: Retrieve all pending invoices awaiting reconciliation.
2. `search_ledger`: Search unmatched bank ledger deposits by vendor keywords or approximate amounts (supports wire fee deductions).
3. `update_status`: Update the invoice status to 'paid' or 'exception_human_review' with your detailed reasoning and matched bank ledger ID.

### Workflow & Autonomous Policy:
1. Start by calling `get_pending_invoices()` to discover what needs processing. If no pending invoices exist, conclude with 0 processed.
2. For EACH pending invoice returned:
   - Call `search_ledger(vendor_keyword, approximate_amount)` with the vendor name or abbreviation and the invoice amount.
   - Examine the returned transactions and apply intelligent financial reasoning:
     * **Vendor Name Fuzzy Matching**: Recognize corporate abbreviations and variations (e.g., 'TechCorp Solutions' vs 'TC-INC', 'Acme Logistics' vs 'ACME', 'Datadog' vs 'Wire Datadog APM').
     * **Wire Transfer Fees & Deductions**: Outgoing or incoming wires frequently have standard bank transfer fees ($10 - $50) deducted. If an invoice is for $1,000.00 and a bank deposit is $980.00 with a memo mentioning wire fee deduction or matching vendor, this IS A VALID MATCH.
     * **Paid Match**: When a matching transaction is found, call `update_status(invoice_id, status='paid', reasoning='...', matched_ledger_id=<id>)`. Explicitly describe the fuzzy match and any fee adjustments in your reasoning.
     * **Exceptions / Human Review**: If no transaction matches, or there is an unexplained partial payment, call `update_status(invoice_id, status='exception_human_review', reasoning='...')`. When set to 'exception_human_review', the system automatically triggers an LLM call to draft a vendor follow-up email explaining the discrepancy.
3. Every pending invoice MUST have its status updated to either 'paid' or 'exception_human_review'.
4. Conclude with a clear summary table of total processed, paid, and exceptions.
"""


def build_react_agent():
    """Build compiled LangGraph ReAct agent bound to tools and Fireworks LLM."""
    llm = get_react_llm()
    if llm is None:
        return None
    tools = [get_pending_invoices, search_ledger, update_status]
    return create_react_agent(llm, tools=tools, prompt=AUTOCFO_SYSTEM_PROMPT)


# ReAct agent instance
agent_graph = build_react_agent()


# ---------------------------------------------------------------------------
# 4. Deterministic Fuzzy Reconciler (Fallback when LLM is unavailable)
# ---------------------------------------------------------------------------
async def _fallback_reconciliation(pending_invoices: List[Dict[str, Any]]) -> Dict[str, int]:
    """Graceful fallback performing fuzzy reconciliation when LLM is offline."""
    paid_count = 0
    exception_count = 0

    async with AsyncSessionLocal() as session:
        ledger_res = await session.execute(
            select(BankLedger).where(BankLedger.is_matched.is_(False)).order_by(BankLedger.id.asc())
        )
        available_ledgers = list(ledger_res.scalars().all())

        for item in pending_invoices:
            invoice = await session.get(Invoice, item["id"])
            if not invoice:
                continue

            inv_amt = round(float(invoice.amount), 2)
            vendor_tokens = [t.lower() for t in re.split(r"[\s\-_]+", invoice.vendor_name) if len(t) >= 2]
            acronym = "".join(t[0].lower() for t in vendor_tokens)

            match = None
            fee_note = ""

            # Check matching ledgers
            for ledger in available_ledgers:
                ledger_amt = round(float(ledger.received_amount), 2)
                desc_lower = ledger.description.lower()
                has_vendor = any(tok in desc_lower for tok in vendor_tokens) or (acronym and acronym in desc_lower)

                # Exact match
                if ledger_amt == inv_amt and (has_vendor or len(available_ledgers) == 1):
                    match = ledger
                    fee_note = "Exact amount match"
                    break

                # Fuzzy match with wire fee deduction ($10-$50)
                diff = round(inv_amt - ledger_amt, 2)
                if 0.0 < diff <= 50.0 and (has_vendor or "fee" in desc_lower or "wire" in desc_lower):
                    match = ledger
                    fee_note = f"Wire fee deduction of ${diff:.2f} identified"
                    break

            if match is not None:
                invoice.status = InvoiceStatus.PAID.value
                invoice.matched_ledger_id = match.id
                reasoning = (
                    f"Fuzzy Match: Matched with Bank Ledger #{match.id} (${match.received_amount:.2f}) "
                    f"on {match.transaction_date}. Memo: '{match.description}'. Rationale: {fee_note}."
                )
                invoice.reasoning = reasoning
                invoice.resolution_notes = reasoning
                match.is_matched = True
                match.matched_invoice_id = invoice.id
                available_ledgers.remove(match)
                paid_count += 1
            else:
                invoice.status = InvoiceStatus.EXCEPTION_HUMAN_REVIEW.value
                reasoning = (
                    f"Flagged for human review: No matching bank transaction found for "
                    f"${inv_amt:.2f} ({invoice.vendor_name})."
                )
                invoice.reasoning = reasoning
                invoice.resolution_notes = reasoning
                if not invoice.vendor_email:
                    invoice.vendor_email = infer_vendor_email(invoice.vendor_name)

                invoice.draft_email_content = await generate_vendor_exception_email(
                    vendor_name=invoice.vendor_name,
                    invoice_amount=inv_amt,
                    received_amount=0.0,
                    reasoning=reasoning,
                    due_date=str(invoice.due_date) if invoice.due_date else None,
                    invoice_id=invoice.id,
                )
                exception_count += 1

        await session.commit()

    return {
        "processed": len(pending_invoices),
        "paid": paid_count,
        "exceptions": exception_count,
    }


# ---------------------------------------------------------------------------
# 5. Autonomous Execution Entry Point
# ---------------------------------------------------------------------------
async def run_autonomous_agent() -> Dict[str, int]:
    """Autonomously execute the ReAct agent to reconcile all pending invoices.

    Returns:
        Summary dict: {"processed": N, "paid": X, "exceptions": Y}
    """
    logger.info("🤖 Starting Autonomous AutoCFO ReAct Agent run...")

    # 1. Fetch current pending invoices count and IDs
    async with AsyncSessionLocal() as session:
        query = (
            select(Invoice)
            .where(Invoice.status == InvoiceStatus.PENDING.value)
            .order_by(Invoice.id.asc())
        )
        res = await session.execute(query)
        pending_invoices = [
            {"id": i.id, "vendor_name": i.vendor_name, "amount": float(i.amount), "due_date": str(i.due_date)}
            for i in res.scalars().all()
        ]

    total_pending = len(pending_invoices)
    if total_pending == 0:
        logger.info("🤖 No pending invoices found. Reconciliation complete.")
        return {"processed": 0, "paid": 0, "exceptions": 0}

    pending_ids = [p["id"] for p in pending_invoices]
    logger.info("🤖 Identified %d pending invoice(s) to reconcile: %s", total_pending, pending_ids)

    # 2. Execute via ReAct Agent if LLM configured, else fallback
    agent = build_react_agent()
    if agent is not None:
        try:
            logger.info("🤖 Invoking LangGraph ReAct Agent with Fireworks AI LLM...")
            prompt_msg = f"Reconcile all {total_pending} pending invoices autonomously now using your tools."
            await agent.ainvoke({"messages": [("user", prompt_msg)]})
            logger.info("🤖 LangGraph ReAct Agent completed execution.")
        except Exception as e:
            logger.error("🤖 ReAct agent invocation encountered error: %s. Engaging fallback.", e, exc_info=True)
            return await _fallback_reconciliation(pending_invoices)
    else:
        logger.info("🤖 Fireworks LLM not active; executing fuzzy reconciliation engine.")
        return await _fallback_reconciliation(pending_invoices)

    # 3. Check database results for the processed invoices
    async with AsyncSessionLocal() as session:
        res = await session.execute(select(Invoice).where(Invoice.id.in_(pending_ids)))
        processed_invoices = res.scalars().all()

        paid_count = 0
        exception_count = 0

        for inv in processed_invoices:
            # If the LLM somehow left an invoice in pending status, safely route to review
            if inv.status == InvoiceStatus.PENDING.value:
                inv.status = InvoiceStatus.EXCEPTION_HUMAN_REVIEW.value
                inv.reasoning = "Unresolved by agent: flagged for human review."
                inv.resolution_notes = inv.reasoning
                exception_count += 1
            elif inv.status == InvoiceStatus.PAID.value:
                paid_count += 1
            else:
                exception_count += 1

            # Ensure all exceptions have vendor email and drafted email content
            if inv.status == InvoiceStatus.EXCEPTION_HUMAN_REVIEW.value:
                if not inv.vendor_email:
                    inv.vendor_email = infer_vendor_email(inv.vendor_name)
                if not inv.draft_email_content:
                    inv.draft_email_content = await generate_vendor_exception_email(
                        vendor_name=inv.vendor_name,
                        invoice_amount=float(inv.amount),
                        received_amount=0.0,
                        reasoning=inv.reasoning or "Payment discrepancy flagged for review.",
                        due_date=str(inv.due_date) if inv.due_date else None,
                        invoice_id=inv.id,
                    )

        await session.commit()

    summary = {
        "processed": total_pending,
        "paid": paid_count,
        "exceptions": exception_count,
    }
    logger.info("🎯 Autonomous reconciliation finished: %s", summary)
    return summary


# For backwards compatibility with existing imports
AgentState = Dict[str, Any]

