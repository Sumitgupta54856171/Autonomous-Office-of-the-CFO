"""Automated integration tests for AutoCFO API and AI Agent reconciliation."""

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from main import app
from database import engine, init_db


@pytest.fixture(autouse=True)
async def setup_database():
    """Reset database tables before each test."""
    await init_db()
    async with engine.begin() as conn:
        await conn.execute(text("TRUNCATE TABLE invoices, bank_ledger RESTART IDENTITY CASCADE;"))
    yield


@pytest.mark.asyncio
async def test_health_check():
    """Verify health endpoint."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["database"] == "connected"


@pytest.mark.asyncio
async def test_create_invoice():
    """Test POST /api/invoices/ endpoint."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        payload = {
            "vendor_name": "AWS Cloud Services",
            "amount": 1250.50,
            "due_date": "2026-09-30",
        }
        response = await client.post("/api/invoices/", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["id"] == 1
        assert data["vendor_name"] == "AWS Cloud Services"
        assert data["amount"] == 1250.50
        assert data["status"] == "pending"


@pytest.mark.asyncio
async def test_create_bank_ledger():
    """Test POST /api/ledger/ endpoint."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        payload = {
            "transaction_date": "2026-09-15",
            "received_amount": 1250.50,
            "description": "ACH DEP: AWS Cloud Services INV-001",
        }
        response = await client.post("/api/ledger/", json=payload)
        assert response.status_code == 201
        data = response.json()
        assert data["id"] == 1
        assert data["received_amount"] == 1250.50
        assert data["is_matched"] is False


@pytest.mark.asyncio
async def test_agent_reconciliation_exact_match():
    """Test exact match transitions pending invoice to 'paid'."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create pending invoice
        await client.post(
            "/api/invoices/",
            json={"vendor_name": "Datadog", "amount": 800.00, "due_date": "2026-10-01"},
        )
        # Create matching bank transaction
        await client.post(
            "/api/ledger/",
            json={
                "transaction_date": "2026-09-20",
                "received_amount": 800.00,
                "description": "Wire from Datadog",
            },
        )

        # Trigger AI agent reconciliation
        recon_resp = await client.post("/api/agent/run-reconciliation")
        assert recon_resp.status_code == 200
        recon_data = recon_resp.json()
        assert recon_data["total_processed"] == 1
        assert recon_data["reconciled_paid_count"] == 1
        assert recon_data["flagged_exception_count"] == 0

        # Verify invoice is now paid
        inv_resp = await client.get("/api/invoices/1")
        assert inv_resp.status_code == 200
        invoice = inv_resp.json()
        assert invoice["status"] == "paid"
        assert invoice["matched_ledger_id"] == 1


@pytest.mark.asyncio
async def test_agent_reconciliation_partial_and_no_match():
    """Test partial match and no match trigger 'exception_human_review'."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # 1. Invoice with partial payment in ledger
        await client.post(
            "/api/invoices/",
            json={"vendor_name": "Snowflake Inc", "amount": 3000.00, "due_date": "2026-09-25"},
        )
        # Add partial ledger entry mentioning Snowflake
        await client.post(
            "/api/ledger/",
            json={
                "transaction_date": "2026-09-18",
                "received_amount": 1000.00,
                "description": "Part pymt from Snowflake Inc",
            },
        )

        # 2. Invoice with NO match in ledger
        await client.post(
            "/api/invoices/",
            json={"vendor_name": "Stripe Payments", "amount": 450.00, "due_date": "2026-09-28"},
        )

        # Trigger AI agent
        recon_resp = await client.post("/api/agent/run-reconciliation")
        assert recon_resp.status_code == 200
        recon_data = recon_resp.json()
        assert recon_data["total_processed"] == 2
        assert recon_data["reconciled_paid_count"] == 0
        assert recon_data["flagged_exception_count"] == 2

        # Verify Snowflake invoice is exception_human_review with partial note
        snow_inv = (await client.get("/api/invoices/1")).json()
        assert snow_inv["status"] == "exception_human_review"
        assert "Partial payment detected" in snow_inv["resolution_notes"]

        # Verify Stripe invoice is exception_human_review with no match note
        stripe_inv = (await client.get("/api/invoices/2")).json()
        assert stripe_inv["status"] == "exception_human_review"
        assert "No matching bank ledger transaction found" in stripe_inv["resolution_notes"]


@pytest.mark.asyncio
async def test_get_exceptions_and_resolve():
    """Test GET /api/exceptions/ and POST /api/exceptions/{id}/resolve."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create two invoices with no matches
        await client.post(
            "/api/invoices/",
            json={"vendor_name": "Vendor A", "amount": 100.0, "due_date": "2026-10-10"},
        )
        await client.post(
            "/api/invoices/",
            json={"vendor_name": "Vendor B", "amount": 200.0, "due_date": "2026-10-12"},
        )

        # Run reconciliation to flag them as exceptions
        await client.post("/api/agent/run-reconciliation")

        # Fetch exceptions endpoint (used by React frontend)
        exc_resp = await client.get("/api/exceptions/")
        assert exc_resp.status_code == 200
        exceptions = exc_resp.json()
        assert len(exceptions) == 2

        # Human resolves Vendor A as PAID
        resolve_a = await client.post(
            f"/api/exceptions/{exceptions[0]['id']}/resolve",
            json={"action": "paid", "notes": "Approved: payment verified via escrow account."},
        )
        assert resolve_a.status_code == 200
        assert resolve_a.json()["status"] == "paid"

        # Human resolves Vendor B as REJECTED
        resolve_b = await client.post(
            f"/api/exceptions/{exceptions[1]['id']}/resolve",
            json={"action": "rejected", "notes": "Duplicate billing rejected by CFO."},
        )
        assert resolve_b.status_code == 200
        assert resolve_b.json()["status"] == "rejected"

        # Exceptions queue should now be empty
        exc_after = await client.get("/api/exceptions/")
        assert exc_after.status_code == 200
        assert len(exc_after.json()) == 0


@pytest.mark.asyncio
async def test_resolve_invalid_action():
    """Test error handling when human enters an invalid resolution action."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        await client.post(
            "/api/invoices/",
            json={"vendor_name": "Vendor C", "amount": 500.0, "due_date": "2026-10-15"},
        )
        # Try invalid action
        resp = await client.post(
            "/api/exceptions/1/resolve",
            json={"action": "invalid_action"},
        )
        # Pydantic validator returns 422 or 400
        assert resp.status_code in (400, 422)


@pytest.mark.asyncio
async def test_resolve_non_existent_invoice():
    """Test resolving non-existent invoice returns 404."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/api/exceptions/99999/resolve",
            json={"action": "paid"},
        )
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_dashboard_stats():
    """Test /api/stats calculation."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Create 1 paid and 1 pending invoice
        await client.post("/api/invoices/", json={"vendor_name": "V1", "amount": 100.0, "due_date": "2026-10-01"})
        await client.post("/api/invoices/", json={"vendor_name": "V2", "amount": 200.0, "due_date": "2026-10-02"})
        await client.post("/api/ledger/", json={"transaction_date": "2026-09-01", "received_amount": 100.0, "description": "V1 payment"})

        await client.post("/api/agent/run-reconciliation")

        stats_resp = await client.get("/api/stats")
        assert stats_resp.status_code == 200
        stats = stats_resp.json()
        assert stats["total_invoices"] == 2
        assert stats["paid_count"] == 1
        assert stats["exception_count"] == 1
        assert stats["reconciliation_rate_percent"] == 50.0


@pytest.mark.asyncio
async def test_prevent_double_matching():
    """Verify that a single bank transaction is not matched to multiple invoices."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        # Two invoices with identical amounts
        await client.post("/api/invoices/", json={"vendor_name": "Vendor A", "amount": 500.0, "due_date": "2026-10-01"})
        await client.post("/api/invoices/", json={"vendor_name": "Vendor B", "amount": 500.0, "due_date": "2026-10-01"})

        # Only ONE bank transaction for 500.0
        await client.post("/api/ledger/", json={"transaction_date": "2026-09-01", "received_amount": 500.0, "description": "Single payment of 500"})

        recon_resp = await client.post("/api/agent/run-reconciliation")
        assert recon_resp.status_code == 200
        data = recon_resp.json()

        assert data["total_processed"] == 2
        assert data["reconciled_paid_count"] == 1
        assert data["flagged_exception_count"] == 1

