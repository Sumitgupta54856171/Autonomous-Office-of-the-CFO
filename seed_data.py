"""Seed script to populate exactly 10 demo invoices and 10 bank ledger records for AutoCFO."""

import asyncio
from datetime import date, timedelta
from sqlalchemy import text
from database import AsyncSessionLocal, engine, init_db
from models import BankLedger, Invoice, InvoiceStatus


async def seed():
    print("🌱 Initializing database tables...")
    await init_db()

    # Reset tables cleanly for testing
    async with engine.begin() as conn:
        print("🧹 Truncating existing invoices and bank ledger records...")
        await conn.execute(text("TRUNCATE TABLE invoices, bank_ledger RESTART IDENTITY CASCADE;"))

    today = date.today()

    async with AsyncSessionLocal() as session:
        print("🌱 Seeding 10 demo invoices and 10 bank ledger transactions...")

        # Exactly 10 demo invoices
        sample_invoices = [
            # 1. Exact match
            Invoice(
                vendor_name="AWS Cloud Services",
                amount=1250.00,
                due_date=today + timedelta(days=14),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Monthly cloud infrastructure hosting",
            ),
            # 2. Fuzzy match: Abbreviation ('TC-INC') + $25 Wire fee deduction ($3400 -> $3375)
            Invoice(
                vendor_name="TechCorp Solutions",
                amount=3400.00,
                due_date=today + timedelta(days=10),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Custom enterprise software development",
            ),
            # 3. Exact amount with vendor variant ('Direct Debit DATADOG INC')
            Invoice(
                vendor_name="Datadog APM",
                amount=820.50,
                due_date=today + timedelta(days=7),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Observability & monitoring tier",
            ),
            # 4. Fuzzy match: Wire fee deduction ($30 fee, $4500 -> $4470)
            Invoice(
                vendor_name="Snowflake Computing",
                amount=4500.00,
                due_date=today + timedelta(days=12),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Data warehouse compute credits",
            ),
            # 5. Exact match: Stripe Payout
            Invoice(
                vendor_name="Stripe Payments",
                amount=650.00,
                due_date=today + timedelta(days=5),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Payment processing fees",
            ),
            # 6. Fuzzy match: Corporate name variant + $20 wire fee deduction ($1800 -> $1780)
            Invoice(
                vendor_name="Acme Logistics Inc",
                amount=1800.00,
                due_date=today + timedelta(days=8),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Warehouse freight and freight insurance",
            ),
            # 7. Exact match: Monthly SaaS
            Invoice(
                vendor_name="Slack Technologies",
                amount=940.00,
                due_date=today + timedelta(days=15),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Enterprise team messaging licenses",
            ),
            # 8. Partial payment: $600 paid out of $1,500 (Exception for human review)
            Invoice(
                vendor_name="HubSpot Inc",
                amount=1500.00,
                due_date=today + timedelta(days=18),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Marketing hub CRM licenses",
            ),
            # 9. No payment found in bank: Missing deposit (Exception for human review)
            Invoice(
                vendor_name="Salesforce Cloud",
                amount=5200.00,
                due_date=today + timedelta(days=20),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Sales Cloud CRM annual renewal",
            ),
            # 10. Exact match: Credit memo / bank statement format
            Invoice(
                vendor_name="Google Workspace",
                amount=360.00,
                due_date=today + timedelta(days=22),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Corporate email and storage licenses",
            ),
        ]

        # Exactly 10 demo bank ledger entries
        sample_ledger = [
            # 1. Matches AWS Cloud Services
            BankLedger(
                transaction_date=today - timedelta(days=2),
                received_amount=1250.00,
                description="ACH DEP: AWS Cloud Services - INV-1001",
                is_matched=False,
            ),
            # 2. Matches TechCorp Solutions with 'TC-INC' and $25 wire fee
            BankLedger(
                transaction_date=today - timedelta(days=3),
                received_amount=3375.00,
                description="WIRE FROM TC-INC (LESS $25 WIRE FEE)",
                is_matched=False,
            ),
            # 3. Matches Datadog APM
            BankLedger(
                transaction_date=today - timedelta(days=1),
                received_amount=820.50,
                description="Direct Debit DATADOG INC",
                is_matched=False,
            ),
            # 4. Matches Snowflake Computing with $30 wire fee
            BankLedger(
                transaction_date=today - timedelta(days=2),
                received_amount=4470.00,
                description="WIRE SNOWFLAKE CORP - FEE $30",
                is_matched=False,
            ),
            # 5. Matches Stripe Payments
            BankLedger(
                transaction_date=today - timedelta(days=4),
                received_amount=650.00,
                description="STRIPE PAYOUT INV-4491",
                is_matched=False,
            ),
            # 6. Matches Acme Logistics Inc with $20 wire fee
            BankLedger(
                transaction_date=today - timedelta(days=3),
                received_amount=1780.00,
                description="ACH ACME LOGISTICS INC WIRE LESS $20 FEE",
                is_matched=False,
            ),
            # 7. Matches Slack Technologies
            BankLedger(
                transaction_date=today - timedelta(days=1),
                received_amount=940.00,
                description="SLACK TECHNOLOGIES INC MONTHLY SUBSCRIPTION",
                is_matched=False,
            ),
            # 8. Partial payment for HubSpot Inc ($600 paid of $1500)
            BankLedger(
                transaction_date=today - timedelta(days=5),
                received_amount=600.00,
                description="PARTIAL ACH: HUBSPOT DEPOSIT",
                is_matched=False,
            ),
            # 9. Matches Google Workspace
            BankLedger(
                transaction_date=today,
                received_amount=360.00,
                description="GOOGLE *WORKSPACE GOOG.COM/CH",
                is_matched=False,
            ),
            # 10. Unmatched incoming deposit (Demonstrates unallocated cash detection)
            BankLedger(
                transaction_date=today - timedelta(days=6),
                received_amount=2100.00,
                description="CLIENT WIRE: UNIDENTIFIED ESCROW REF #99281",
                is_matched=False,
            ),
        ]

        session.add_all(sample_invoices)
        session.add_all(sample_ledger)
        await session.commit()

        print(f"✅ Successfully seeded {len(sample_invoices)} invoices and {len(sample_ledger)} bank ledger records.")
        print("💡 Test the API with:")
        print("   1. GET  http://localhost:8000/api/invoices/")
        print("   2. GET  http://localhost:8000/api/ledger/")
        print("   3. POST http://localhost:8000/api/agent/trigger")
        print("   4. GET  http://localhost:8000/api/exceptions/")


if __name__ == "__main__":
    asyncio.run(seed())

