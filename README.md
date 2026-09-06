# 🏛️ AutoCFO — Autonomous Office of the CFO

> **Syndicate Hackathon (Track 2: Autonomous Office of the CFO)**  
> Production-grade Autonomous Financial Operations Co-pilot built with FastAPI, PostgreSQL, LangGraph, Celery + RabbitMQ, PyMuPDF, Clerk Authentication, and React + Tailwind + shadcn/ui.

---

## 📋 Table of Contents
- [Overview & Core Value Proposition](#-overview--core-value-proposition)
- [Key Features](#-key-features)
  - [1. Asynchronous AI Invoice Vision Extraction](#1-asynchronous-ai-invoice-vision-extraction)
  - [2. Autonomous Reconciliation Engine (LangGraph)](#2-autonomous-reconciliation-engine-langgraph)
  - [3. Human-in-the-Loop Exception Management](#3-human-in-the-loop-exception-management)
  - [4. Autonomous Vendor Follow-up (Real Gmail SMTP)](#4-autonomous-vendor-follow-up-real-gmail-smtp)
  - [5. Executive React Dashboard with Lazy Loading](#5-executive-react-dashboard-with-lazy-loading)
- [System Architecture & Flow](#-system-architecture--flow)
- [Project Structure](#-project-structure)
- [API Reference](#-api-reference)
  - [Invoice Vision & Processing](#1-invoice-vision--processing)
  - [Invoices Management](#2-invoices-management)
  - [Bank Ledger Operations](#3-bank-ledger-operations)
  - [AI Agent Reconciliation](#4-ai-agent-reconciliation)
  - [Human Review & Vendor Follow-up Email](#5-human-review--vendor-follow-up-email)
  - [Dashboard Analytics](#6-dashboard-analytics)
- [Environment Variables Configuration](#-environment-variables-configuration)
- [Getting Started & Local Setup](#-getting-started--local-setup)
  - [1. Backend API Setup](#1-backend-api-setup)
  - [2. Background Task Worker (Celery + RabbitMQ)](#2-background-task-worker-celery--rabbitmq)
  - [3. Frontend Dashboard Setup (React + Vite)](#3-frontend-dashboard-setup-react--vite)
- [Running Automated Tests](#-running-automated-tests)
- [Seed Demonstration Data](#-seed-demonstration-data)

---

## 🚀 Overview & Core Value Proposition

Modern finance departments spend hundreds of hours manually cross-referencing vendor invoices against bank statements, keying PDF data into accounting ledgers, and chasing vendors for missing receipts or partial wire payments.

**AutoCFO** transforms this workflow into an autonomous, self-healing system:
1. **Intelligent Ingestion:** Ingests single or multi-page invoice PDFs via PyMuPDF and extracts structured invoice data with OpenAI GPT-4o-mini in background Celery worker queues.
2. **Autonomous Multi-Way Matching:** Uses a LangGraph AI workflow to compare invoices against bank transactions, automatically approving exact matches and preventing double-matching.
3. **Safe Exception Routing:** Detects anomalies (partial payments, vendor mismatches, missing bank deposits) and routes them to the CFO Exception Queue.
4. **Autonomous Vendor Communication:** Autonomously drafts discrepancy emails and dispatches them via Gmail SMTP with human sign-off.
5. **Enterprise Auditability:** Every decision, match, and edit is logged with an immutable audit trail.

---

## ✨ Key Features

### 1. Asynchronous AI Invoice Vision Extraction
- **Celery + RabbitMQ:** Non-blocking file upload architecture. Uploaded documents return immediately with a `task_id` for real-time polling.
- **PyMuPDF (`fitz`) Text & Layout Analysis:** Rapidly extracts raw text and positional layout information from single-page receipts and multi-page PDF packets.
- **Multi-Invoice Splitting:** LangChain and OpenAI structured outputs identify and split multiple distinct vendor invoices contained in a single multi-page PDF document.
- **Auto-Persistence:** Extracted invoices are validated and saved into PostgreSQL in `pending` status, ready for autonomous reconciliation.

### 2. Autonomous Reconciliation Engine (LangGraph)
- **Stateful Graph Execution:** Implemented in `agent.py` using LangGraph to evaluate invoice states through structured nodes and conditional edges.
- **Multi-Way Matching Logic:**
  - **Exact Match:** When an unmatched bank ledger deposit matches the invoice amount and description, the invoice is set to `paid`, linked to `#LEDGER-{id}`, and the ledger entry is marked `is_matched = True`.
  - **Partial Payment:** When a deposit is found with an amount lower than the invoice, it logs the discrepancy and routes to `exception_human_review`.
  - **Unmatched Deposit:** When no matching bank transaction exists, it routes to `exception_human_review`.

### 3. Human-in-the-Loop Exception Management
- Dedicated **Exceptions Review Queue** allows finance officers to inspect discrepancy notes, view invoice details, and take human action.
- One-click **Approve** (marks as paid with audit note) or **Reject** (marks as rejected with dispute rationale).

### 4. Autonomous Vendor Follow-up (Real Gmail SMTP)
- **Automatic Draft Generation:** When an invoice enters `exception_human_review`, the LangGraph agent autonomously drafts a personalized email to the vendor explaining the discrepancy.
- **Markdown-Free Plain Text Sanitization:** All raw markdown symbols (`**`, `###`, `---`, `*`) are automatically stripped, producing executive plain text.
- **Real Gmail Delivery:** Integrates with `smtp.gmail.com` via Google App Passwords on SSL (port 465) or STARTTLS (port 587) with live audit logging.
- **Human Review Dialog:** Review, customize, and edit the recipient and message before dispatching.

### 5. Executive React Dashboard with Lazy Loading
- Modern UI built with **React 18**, **Vite**, **Tailwind CSS**, and **shadcn/ui**.
- **Clerk Authentication:** Enterprise security with Clerk JWT verification on FastAPI endpoints.
- **Progressive Scroll Lazy Loading:** Custom `useLazyLoad` hook powered by `IntersectionObserver` across all four views (`Dashboard`, `Invoices`, `Ledger`, `History`) with throttle protection and instant batching.

---

## 🏗️ System Architecture & Flow

```mermaid
flowchart TD
    subgraph Ingestion["1. Document & Ingestion Pipeline"]
        A[Vendor PDF Upload] -->|POST /api/invoices/upload-async| B[FastAPI Endpoint]
        B -->|Enqueue Task| C[(RabbitMQ Broker)]
        C --> D[Celery Async Worker]
        D -->|PyMuPDF Text Extract| E[OpenAI GPT-4o Vision Extractor]
        E -->|Multi-Invoice Parsing| F[(PostgreSQL Database)]
    end

    subgraph Reconciliation["2. Autonomous LangGraph Reconciliation"]
        G[Manual or Scheduled Trigger] -->|POST /api/agent/run-reconciliation| H[LangGraph AI Agent]
        F -->|Fetch Pending Invoices & Ledger| H
        H --> I{Match Evaluation}
        I -->|Exact Match| J[Status: 'paid' + Link Ledger Record]
        I -->|Partial / Unmatched| K[Status: 'exception_human_review']
        K --> L[Autonomous Vendor Email Draft Node]
        L -->|Save Draft| F
        J --> F
    end

    subgraph HumanLoop["3. Human-in-the-Loop & Vendor Follow-up"]
        F -->|GET /api/exceptions/| M[React CFO Command Center]
        M --> N[Review Exception Queue]
        N -->|Inspect & Edit Draft| O[Vendor Email Review Dialog]
        O -->|POST /api/exceptions/{id}/send-email| P[Gmail SMTP Delivery Service]
        P -->|Real Delivery SSL/TLS| Q[Vendor Inbox]
        N -->|Approve or Reject| R[POST /api/exceptions/{id}/resolve]
        R -->|Update Audit Trail| F
    end
```

---

## 📁 Project Structure

```
autonomous-office-of-the-cfo/
├── main.py                     # FastAPI app, CORS, lifespan, routes & Clerk dependencies
├── agent.py                    # LangGraph autonomous multi-way matching & email agent
├── celery_app.py               # Celery application configuration for async tasks
├── file_extractor.py           # PyMuPDF + LangChain/OpenAI PDF invoice vision extractor
├── email_service.py            # Gmail SMTP delivery service (SSL/STARTTLS) with plain text cleaning
├── database.py                 # SQLAlchemy 2.0 async engine and session injection
├── models.py                   # ORM models (Invoice, BankLedger) with audit fields
├── schemas.py                  # Pydantic v2 schemas for request and response validation
├── auth.py                     # Clerk JWT verification middleware & dependencies
├── seed_data.py                # Database population script with realistic CFO demo data
├── requirements.txt            # Python dependencies (FastAPI, Celery, LangGraph, etc.)
├── Dockerfile                  # Container build instructions
├── docker-compose.yml          # PostgreSQL 16 + RabbitMQ + FastAPI orchestration
├── tests/
│   └── test_api.py             # Pytest async test suite
└── frontend/                   # React (Vite) + Tailwind + shadcn/ui Dashboard
    ├── index.html              # HTML entry point with fonts
    ├── vite.config.ts          # Vite configuration and path aliases
    ├── package.json            # Frontend dependencies
    └── src/
        ├── App.tsx             # Root component with ClerkProvider & navigation
        ├── main.tsx            # React DOM mounting
        ├── types.ts            # TypeScript interfaces & domain models
        ├── hooks/
        │   └── useLazyLoad.ts  # Throttled IntersectionObserver scroll lazy loading
        ├── services/
        │   └── api.ts          # Axios API client with Clerk token injection
        ├── pages/
        │   ├── DashboardPage.tsx  # KPI cards, AI trigger & Exceptions Review Queue
        │   ├── InvoicesPage.tsx   # PDF Uploader, manual entry & invoices list
        │   ├── LedgerPage.tsx     # Bank transactions and deposits management
        │   └── HistoryPage.tsx    # Complete audit trail of resolved decisions
        └── components/
            ├── Navbar.tsx         # Responsive navigation bar with Clerk user button
            ├── InvoiceUpload.tsx  # Drag-and-drop async PDF invoice uploader
            └── ui/                # shadcn/ui components (card, table, dialog, badge, button, etc.)
```

---

## 🔌 API Reference

Interactive Swagger documentation: `http://localhost:8000/docs`  
ReDoc documentation: `http://localhost:8000/redoc`

### 1. Invoice Vision & Processing

#### **Upload Invoice PDF (Async Celery Task)**
- **Endpoint**: `POST /api/invoices/upload-async`
- **Payload**: `multipart/form-data` with `file: <PDF Document>`
- **Response**:
  ```json
  {
    "task_id": "8f3b23e1-7cb4-4d89-9c56-42d8c36b13b1",
    "filename": "vendor_invoices_batch.pdf",
    "status": "processing",
    "message": "Invoice PDF queued for asynchronous AI vision extraction."
  }
  ```

#### **Check Upload Task Status**
- **Endpoint**: `GET /api/invoices/tasks/{task_id}`
- **Response (when completed)**:
  ```json
  {
    "task_id": "8f3b23e1-7cb4-4d89-9c56-42d8c36b13b1",
    "status": "completed",
    "invoices_extracted": 3,
    "invoice_ids": [14, 15, 16],
    "message": "Successfully extracted and recorded 3 invoices from document."
  }
  ```

---

### 2. Invoices Management

#### **Create Invoice (Manual)**
- **Endpoint**: `POST /api/invoices/`
- **Request Body**:
  ```json
  {
    "vendor_name": "Datadog APM",
    "amount": 2300.50,
    "due_date": "2026-10-01",
    "vendor_email": "billing@datadoghq.com"
  }
  ```

#### **List Invoices**
- **Endpoint**: `GET /api/invoices/?status=pending&skip=0&limit=50`
- **Filters**: `status` (`all`, `pending`, `paid`, `exception_human_review`, `rejected`).

---

### 3. Bank Ledger Operations

#### **Record Bank Transaction**
- **Endpoint**: `POST /api/ledger/`
- **Request Body**:
  ```json
  {
    "transaction_date": "2026-09-20",
    "received_amount": 2300.50,
    "description": "INCOMING WIRE: Datadog APM Services"
  }
  ```

#### **List Bank Ledger Records**
- **Endpoint**: `GET /api/ledger/?is_matched=false`

---

### 4. AI Agent Reconciliation

#### **Run Autonomous Reconciliation Engine**
- **Endpoint**: `POST /api/agent/run-reconciliation`
- **Response**:
  ```json
  {
    "status": "completed",
    "message": "Reconciliation completed. Processed 4 invoices: 2 paid, 2 flagged for human review.",
    "total_processed": 4,
    "reconciled_paid_count": 2,
    "flagged_exception_count": 2,
    "details": [
      {
        "invoice_id": 1,
        "vendor_name": "Datadog APM",
        "amount": 2300.50,
        "status": "paid",
        "notes": "AI Agent: Auto-reconciled. Exact match found with Bank Ledger #1 ($2300.50)",
        "matched_ledger_id": 1
      },
      {
        "invoice_id": 2,
        "vendor_name": "Acme Hardware",
        "amount": 5000.00,
        "status": "exception_human_review",
        "notes": "AI Agent Flagged: Partial payment detected. Received $2000.00 of expected $5000.00",
        "matched_ledger_id": 2
      }
    ]
  }
  ```

---

### 5. Human Review & Vendor Follow-up Email

#### **Fetch Exceptions Requiring Human Review**
- **Endpoint**: `GET /api/exceptions/`
- **Description**: Returns all invoices in `exception_human_review` status with their AI-drafted follow-up emails.

#### **Resolve Exception**
- **Endpoint**: `POST /api/exceptions/{invoice_id}/resolve`
- **Request Body**:
  ```json
  {
    "action": "paid",
    "notes": "Verified off-cycle wire transfer reference #WT-98211. Approved by CFO."
  }
  ```
  *(Supported actions: `"paid"` or `"rejected"`)*

#### **Dispatch Vendor Follow-up Email (Real Gmail SMTP)**
- **Endpoint**: `POST /api/exceptions/{invoice_id}/send-email`
- **Request Body**:
  ```json
  {
    "vendor_email": "billing@vendor.com",
    "email_content": "Subject: Payment Discrepancy Notice - Invoice #INV-2\n\nDear Vendor Team,\n..."
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "is_real_email": true,
    "sender_email": "guptaashish2531@gmail.com",
    "vendor_email": "billing@vendor.com",
    "email_content": "Subject: Payment Discrepancy Notice...",
    "message": "Real email successfully dispatched via Gmail to billing@vendor.com."
  }
  ```

#### **Get Email Configuration Status**
- **Endpoint**: `GET /api/email/status`
- **Response**:
  ```json
  {
    "is_configured": true,
    "sender_email": "guptaashish2531@gmail.com"
  }
  ```

---

### 6. Dashboard Analytics

#### **Get CFO Key Metrics**
- **Endpoint**: `GET /api/stats`
- **Response**:
  ```json
  {
    "total_invoices": 12,
    "pending_count": 2,
    "paid_count": 8,
    "exception_count": 2,
    "rejected_count": 0,
    "total_invoice_amount": 48250.00,
    "total_ledger_amount": 42100.00,
    "reconciliation_rate_percent": 80.0
  }
  ```

---

## ⚙️ Environment Variables Configuration

Create a `.env` file in the root directory (based on `.env.example`):

| Variable | Description | Example / Default |
|:---|:---|:---|
| `DATABASE_URL` | PostgreSQL async connection string | `postgresql+asyncpg://postgres:postgres@localhost:5432/autocfo` |
| `OPENAI_API_KEY` | OpenAI API key for GPT-4o Vision extraction & LangGraph agent | `sk-proj-...` |
| `CELERY_BROKER_URL` | RabbitMQ broker URL for async tasks | `amqp://guest:guest@localhost:5672//` |
| `CELERY_RESULT_BACKEND` | Celery result storage backend | `rpc://` |
| `CLERK_SECRET_KEY` | Clerk backend Secret Key for JWT token verification | `sk_test_...` |
| `gmail` | Gmail address for SMTP follow-up delivery | `guptaashish2531@gmail.com` |
| `gmail_secret` | 16-character Google App Password (without spaces) | `ipwhgumxffmlbyni` |
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk publishable key for frontend authentication | `pk_test_...` |

---

## 🛠️ Getting Started & Local Setup

### 1. Backend API Setup
```bash
# 1. Create and activate Python virtual environment
python3 -m venv venv
source venv/bin/activate

# 2. Install backend dependencies
pip install -r requirements.txt

# 3. Ensure PostgreSQL is running and initialize database
python -c "import asyncio, database; asyncio.run(database.init_db())"

# 4. Start the FastAPI server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### 2. Background Task Worker (Celery + RabbitMQ)
```bash
# Ensure RabbitMQ server is active (default port 5672)
# In a separate terminal, activate the virtual environment and start Celery:
source venv/bin/activate
celery -A celery_app.celery_app worker --loglevel=info -c 1
```

### 3. Frontend Dashboard Setup (React + Vite)
```bash
# Navigate to the frontend directory
cd frontend

# Install dependencies
npm install

# Start the development server
npm run dev
# Dashboard accessible at: http://localhost:5173
```

---

## 🔬 Running Automated Tests

Execute the comprehensive test suite to verify reconciliation logic and API endpoints:
```bash
pytest -v
```

Test coverage includes:
- ✅ Database lifecycle & asyncpg connection pooling
- ✅ Invoice creation & status initialization
- ✅ Bank transaction ledger recording
- ✅ Exact multi-way matching (`pending` -> `paid`)
- ✅ Partial payment exception detection (`exception_human_review`)
- ✅ Missing bank ledger deposit detection (`exception_human_review`)
- ✅ Double-matching protection on bank ledger entries
- ✅ Human review resolution workflow (`paid` & `rejected`)
- ✅ Real & simulated Gmail SMTP delivery verification
- ✅ CFO KPI metrics calculation

---

## 🧪 Seed Demonstration Data

Populate the database with realistic demo scenarios (exact matches, partial payments, unmatched invoices, and multi-vendor transactions):
```bash
python seed_data.py
```

Then visit the web dashboard at `http://localhost:5173` or trigger the AI reconciliation engine via the UI or cURL:
```bash
curl -X POST http://localhost:8000/api/agent/run-reconciliation
```