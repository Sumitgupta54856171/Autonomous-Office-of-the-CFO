# 🏛️ AutoCFO Backend — Autonomous Office of the CFO

> **Syndicate Hackathon (Track 2: Autonomous Office of the CFO)**  
> Production-ready FastAPI + PostgreSQL (SQLAlchemy 2.0 Async) backend for autonomous invoice reconciliation and human-in-the-loop exception management.

---

## 📋 Table of Contents
- [Overview & Architecture](#-overview--architecture)
- [Project Structure](#-project-structure)
- [Reconciliation Engine Logic](#-reconciliation-engine-logic)
- [API Reference](#-api-reference)
  - [Invoices](#1-invoices-api)
  - [Bank Ledger](#2-bank-ledger-api)
  - [AI Agent Reconciliation](#3-ai-agent-reconciliation-api)
  - [Human Review & Exceptions](#4-human-in-the-loop-exceptions-api)
  - [CFO Dashboard & Analytics](#5-cfo-dashboard-metrics)
- [Getting Started](#-getting-started)
  - [Option A: Docker Compose (Recommended)](#option-a-docker-compose-recommended)
  - [Option B: Local Virtualenv](#option-b-local-virtualenv)
- [Demo Data & Verification](#-demo-data--verification)
- [Running Automated Tests](#-running-automated-tests)
- [Frontend Integration (React / Next.js)](#-frontend-integration-react--nextjs)

---

## 🚀 Overview & Architecture

**AutoCFO** acts as an autonomous financial co-pilot for the Chief Financial Officer and accounting team. It eliminates repetitive manual invoice reconciliation by matching vendor invoices against incoming bank ledger transactions.

When invoices are ambiguous (partial payments, price discrepancies, or missing deposits), AutoCFO does not blindly make assumptions—instead, it safely flags them into an **Exception Queue** for human-in-the-loop review and approval.

```mermaid
flowchart TD
    A[Vendor Invoice Created / Received] --> B[Status: 'pending']
    C[Bank Ledger Transaction Recorded] --> D[(PostgreSQL DB)]
    B --> D
    
    subgraph AI Agent Reconciliation Engine
        E[Trigger /api/agent/run-reconciliation] --> F[Scan all 'pending' invoices]
        F --> G{Check Bank Ledger}
        G -->|Exact Amount Match| H[Update Status to 'paid' & Link Ledger Entry]
        G -->|Partial Payment Detected| I[Flag Status: 'exception_human_review']
        G -->|No Match Found| I
    end
    
    D --> E
    H --> J[(Updated Database)]
    I --> K[GET /api/exceptions/]
    
    subgraph Human-in-the-Loop Workflow
        K --> L[React / Web Frontend Dashboard]
        L --> M[Human Reviewer Evaluates Exception]
        M --> N[POST /api/exceptions/{id}/resolve]
        N -->|Approve| O[Status: 'paid' + Reviewer Notes]
        N -->|Reject| P[Status: 'rejected' + Reviewer Notes]
    end
```

---

## 📁 Project Structure

```
autonomous-o-orchestrator/
├── main.py                 # FastAPI application, CORS, lifespan, and REST routes
├── database.py             # SQLAlchemy 2.0 async engine, asyncpg pooling, and session injection
├── models.py               # SQLAlchemy ORM models: Invoice and BankLedger
├── schemas.py              # Pydantic v2 schemas for request validation and response formatting
├── agent_logic.py          # AutoCFO AI Agent autonomous matching engine
├── agent.py                # LangGraph stateful AI Agent workflow
├── seed_data.py            # CLI script to populate realistic CFO hackathon demo data
├── requirements.txt        # Production & testing dependencies
├── pytest.ini              # Pytest configuration for async test discovery
├── .env.example            # Sample environment variables
├── Dockerfile              # Multi-stage production container image
├── docker-compose.yml      # Orchestrates PostgreSQL 16 + FastAPI backend
└── tests/
    └── test_api.py         # 10 comprehensive async integration tests
```

---

## 🧠 Reconciliation Engine Logic

The core logic resides in [`agent_logic.py`](file:///home/ubuntu/.ao/data/worktrees/autonomous-office-of-the-cfo/orchestrator/autonomous-o-orchestrator/agent_logic.py) within `reconcile_invoices()`:

1. **Pending Scan**: Queries all invoices with status `pending`.
2. **Ledger Matching**:
   - **Exact Match**: Checks unmatched bank ledger transactions. If an entry matches `invoice.amount` (prioritizing entries where the vendor name appears in the description), it marks the invoice as `paid`, links the foreign key `matched_ledger_id`, marks `is_matched = True` on the bank entry (preventing double-matching), and writes an audit log.
   - **Partial Payment Match**: If a transaction mentions the vendor/invoice but the amount received is less than the invoice amount, it sets status to `exception_human_review` with a detailed audit explanation.
   - **No Match**: If no ledger transaction is found, it safely flags the invoice as `exception_human_review`.
3. **Audit Trail**: Every automated action records detailed notes in `resolution_notes`.

---

## 🔌 API Reference

Interactive Swagger docs are accessible at: `http://localhost:8000/docs`  
ReDoc is accessible at: `http://localhost:8000/redoc`

### 1. Invoices API

#### **Create Invoice**
- **Endpoint**: `POST /api/invoices/`
- **Status Code**: `201 Created`
- **Request Body**:
  ```json
  {
    "vendor_name": "Datadog APM",
    "amount": 2300.50,
    "due_date": "2026-10-01"
  }
  ```
- **Response**:
  ```json
  {
    "id": 1,
    "vendor_name": "Datadog APM",
    "amount": 2300.50,
    "due_date": "2026-10-01",
    "status": "pending",
    "matched_ledger_id": null,
    "resolution_notes": null,
    "created_at": "2026-09-06T03:00:00Z",
    "updated_at": "2026-09-06T03:00:00Z"
  }
  ```

#### **List Invoices**
- **Endpoint**: `GET /api/invoices/?status=pending&skip=0&limit=50`
- **Query Params**: `status` (optional: `pending`, `paid`, `exception_human_review`, `rejected`)

---

### 2. Bank Ledger API

#### **Add Bank Transaction**
- **Endpoint**: `POST /api/ledger/`
- **Status Code**: `201 Created`
- **Request Body**:
  ```json
  {
    "transaction_date": "2026-09-20",
    "received_amount": 2300.50,
    "description": "INCOMING WIRE: Datadog APM Services"
  }
  ```
- **Response**:
  ```json
  {
    "id": 1,
    "transaction_date": "2026-09-20",
    "received_amount": 2300.50,
    "description": "INCOMING WIRE: Datadog APM Services",
    "is_matched": false,
    "matched_invoice_id": null,
    "created_at": "2026-09-06T03:00:00Z"
  }
  ```

---

### 3. AI Agent Reconciliation API

#### **Trigger Autonomous Reconciliation**
- **Endpoint**: `POST /api/agent/run-reconciliation`
- **Description**: Triggers the `reconcile_invoices()` AI agent engine.
- **Response**:
  ```json
  {
    "status": "completed",
    "message": "Reconciliation completed. Processed 3 invoices: 1 paid, 2 flagged for human review.",
    "total_processed": 3,
    "reconciled_paid_count": 1,
    "flagged_exception_count": 2,
    "details": [
      {
        "invoice_id": 1,
        "vendor_name": "Datadog APM",
        "amount": 2300.50,
        "status": "paid",
        "notes": "AI Agent: Auto-reconciled. Exact match found with Bank Ledger #1 ($2300.50)...",
        "matched_ledger_id": 1
      },
      {
        "invoice_id": 2,
        "vendor_name": "Acme Hardware",
        "amount": 5000.00,
        "status": "exception_human_review",
        "notes": "AI Agent Flagged: Partial payment detected. Received $2000.00 of expected $5000.00...",
        "matched_ledger_id": 2
      }
    ]
  }
  ```

---

### 4. Human-in-the-Loop Exceptions API

#### **Fetch Exceptions for Human Review**
- **Endpoint**: `GET /api/exceptions/`
- **Description**: Consumed by the React frontend dashboard to display all flagged invoices requiring review.
- **Response**: List of `InvoiceResponse` objects with `status: "exception_human_review"`.

#### **Resolve Exception (Human Intervention)**
- **Endpoint**: `POST /api/exceptions/{invoice_id}/resolve`
- **Request Body**:
  ```json
  {
    "action": "paid",
    "notes": "Verified offline wire transfer receipt. Approved by CFO."
  }
  ```
  *(Supported actions: `"paid"` or `"rejected"`)*
- **Response**: Updated `InvoiceResponse` showing new status and updated resolution trail.

---

### 5. CFO Dashboard Metrics

#### **Get Summary KPI Stats**
- **Endpoint**: `GET /api/stats`
- **Response**:
  ```json
  {
    "total_invoices": 6,
    "pending_count": 0,
    "paid_count": 4,
    "exception_count": 1,
    "rejected_count": 1,
    "total_invoice_amount": 26770.50,
    "total_ledger_amount": 7420.50,
    "reconciliation_rate_percent": 66.67
  }
  ```

---

## 🛠️ Getting Started

### Option A: Docker Compose (Recommended)

1. Clone the repository and navigate into the folder:
   ```bash
   cd autonomous-o-orchestrator
   ```
2. Start PostgreSQL and the FastAPI application:
   ```bash
   docker compose up --build -d
   ```
3. Check API health:
   ```bash
   curl http://localhost:8000/health
   ```

### Option B: Local Virtualenv

1. Create and activate a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Set your environment variables (or copy `.env.example`):
   ```bash
   cp .env.example .env
   ```
4. Start the development server:
   ```bash
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

---

## 🧪 Demo Data & Verification

Populate the database with realistic CFO demonstration data:
```bash
python seed_data.py
```

Then trigger the agent:
```bash
curl -X POST http://localhost:8000/api/agent/run-reconciliation
```

Inspect the exceptions queue:
```bash
curl http://localhost:8000/api/exceptions/
```

Resolve an exception:
```bash
curl -X POST http://localhost:8000/api/exceptions/6/resolve \
  -H "Content-Type: application/json" \
  -d '{"action": "paid", "notes": "Approved remaining balance terms."}'
```

---

## 🔬 Running Automated Tests

Run the full async test suite covering all reconciliation logic and edge cases:
```bash
pytest -v
```

Test coverage includes:
- ✅ Health check and database connectivity
- ✅ Invoice creation with default `'pending'` status
- ✅ Bank transaction ledger recording
- ✅ AI Agent exact matching (`'pending'` -> `'paid'`)
- ✅ Partial payment exception detection (`'exception_human_review'`)
- ✅ Missing bank transaction detection (`'exception_human_review'`)
- ✅ Preventing double-matching of bank ledger records
- ✅ Human review resolution (`'paid'` and `'rejected'`)
- ✅ Error handling for invalid action states and 404s
- ✅ CFO Dashboard statistics calculation