"""Seed script to populate sample invoices and bank ledger records for AutoCFO."""

import asyncio
from datetime import date, timedelta
from database import AsyncSessionLocal, init_db
from models import BankLedger, Invoice, InvoiceStatus


async def seed():
    print("🌱 Initializing database tables...")
    await init_db()

    today = date.today()

    async with AsyncSessionLocal() as session:
        print("🌱 Seeding realistic CFO sample data...")

        # Invoices
        sample_invoices = [
            # Exact matches
            Invoice(
                vendor_name="AWS Cloud Services",
                amount=1450.00,
                due_date=today + timedelta(days=14),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Monthly cloud infrastructure billing",
            ),
            Invoice(
                vendor_name="Figma Enterprise",
                amount=720.00,
                due_date=today + timedelta(days=10),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Product design team licenses",
            ),
            Invoice(
                vendor_name="Datadog APM",
                amount=2300.50,
                due_date=today + timedelta(days=7),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Observability & monitoring tier",
            ),

            # Partial payment case
            Invoice(
                vendor_name="Acme Hardware Logistics",
                amount=5000.00,
                due_date=today + timedelta(days=5),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Data center rack units & cabling",
            ),

            # No payment match case (missing transaction)
            Invoice(
                vendor_name="Salesforce CRM",
                amount=12800.00,
                due_date=today + timedelta(days=20),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Annual sales cloud subscription",
            ),
            Invoice(
                vendor_name="Gartner Advisory",
                amount=4500.00,
                due_date=today + timedelta(days=30),
                status=InvoiceStatus.PENDING.value,
                resolution_notes="Executive research subscription",
            ),
        ]

        # Bank Ledger entries
        sample_ledger = [
            # Exact match for AWS
            BankLedger(
                transaction_date=today - timedelta(days=2),
                received_amount=1450.00,
                description="ACH WIRE: AWS Cloud Services - INV-2026-09",
                is_matched=False,
            ),
            # Exact match for Figma
            BankLedger(
                transaction_date=today - timedelta(days=1),
                received_amount=720.00,
                description="DIRECT DEBIT: Figma Inc Design Licenses",
                is_matched=False,
            ),
            # Exact match for Datadog
            BankLedger(
                transaction_date=today,
                received_amount=2300.50,
                description="INCOMING WIRE: Datadog APM Services",
                is_matched=False,
            ),
            # Partial payment for Acme Hardware Logistics ($2,000 paid out of $5,000)
            BankLedger(
                transaction_date=today - timedelta(days=3),
                received_amount=2000.00,
                description="PARTIAL ACH: Acme Hardware Logistics Milestone 1",
                is_matched=False,
            ),
            # Unrelated incoming payment
            BankLedger(
                transaction_date=today - timedelta(days=4),
                received_amount=950.00,
                description="CLIENT RETAINER: Apex Global Consulting",
                is_matched=False,
            ),
        ]

        session.add_all(sample_invoices)
        session.add_all(sample_ledger)
        await session.commit()

        print(f"✅ Seeded {len(sample_invoices)} invoices and {len(sample_ledger)} bank ledger entries.")
        print("💡 You can now trigger /api/agent/run-reconciliation to see AutoCFO in action!")


if __name__ == "__main__":
    asyncio.run(seed())
