"""Pydantic schemas for request validation and response serialization."""

from datetime import date, datetime
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field, model_validator
from models import InvoiceStatus


class InvoiceBase(BaseModel):
    vendor_name: str = Field(..., min_length=1, max_length=255, description="Vendor or supplier name")
    amount: float = Field(..., ge=0, description="Total invoice amount in currency units")
    due_date: date = Field(..., description="Invoice payment due date")
    vendor_email: Optional[str] = Field(default=None, description="Vendor contact email address")


class InvoiceCreate(InvoiceBase):
    status: Optional[InvoiceStatus] = Field(
        default=InvoiceStatus.PENDING,
        description="Initial invoice status (defaults to 'pending')",
    )
    resolution_notes: Optional[str] = Field(
        default=None,
        description="Optional initial notes or remarks",
    )


class InvoiceResponse(InvoiceBase):
    id: int
    status: str
    vendor_email: Optional[str] = None
    draft_email_content: Optional[str] = None
    matched_ledger_id: Optional[int] = None
    reasoning: Optional[str] = None
    resolution_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SendVendorEmailRequest(BaseModel):
    """Payload for reviewing, editing, and dispatching autonomous vendor email."""
    vendor_email: Optional[str] = Field(default=None, description="Recipient vendor email address")
    email_content: Optional[str] = Field(default=None, description="Updated or approved email body content")


class SendVendorEmailResponse(BaseModel):
    """Response confirmation after dispatching vendor email."""
    status: str = Field(..., description="Dispatch status, e.g., 'success'")
    message: str = Field(..., description="Confirmation message")
    invoice_id: int = Field(..., description="Associated Invoice ID")
    vendor_email: str = Field(..., description="Recipient email address")
    email_content: str = Field(..., description="Dispatched email body")
    is_real_email: bool = Field(default=False, description="True if dispatched via real Gmail SMTP")
    sender_email: Optional[str] = Field(default=None, description="Sender Gmail address")


class EmailConfigStatus(BaseModel):
    """Status indicating whether real Gmail SMTP delivery is active."""
    is_configured: bool = Field(..., description="True if Gmail credentials are provided")
    sender_email: Optional[str] = Field(default=None, description="Configured sender Gmail account")


class BankLedgerBase(BaseModel):
    transaction_date: date = Field(..., description="Date transaction was recorded by the bank")
    received_amount: float = Field(..., gt=0, description="Amount received in bank account")
    description: str = Field(..., min_length=1, max_length=500, description="Transaction memo or description")


class BankLedgerCreate(BankLedgerBase):
    pass


class BankLedgerResponse(BankLedgerBase):
    id: int
    is_matched: bool
    matched_invoice_id: Optional[int] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ResolveExceptionRequest(BaseModel):
    """Schema for human review resolution of an invoice exception."""

    action: Optional[str] = Field(
        default=None,
        description="Resolution action: 'paid' or 'rejected'",
    )
    status: Optional[str] = Field(
        default=None,
        description="Alternative key for resolution action: 'paid' or 'rejected'",
    )
    notes: Optional[str] = Field(
        default=None,
        description="Reviewer notes or reason for approval/rejection",
    )

    @model_validator(mode="after")
    def validate_action_or_status(self) -> "ResolveExceptionRequest":
        effective_action = (self.action or self.status or "").strip().lower()
        if effective_action not in (InvoiceStatus.PAID.value, InvoiceStatus.REJECTED.value):
            raise ValueError(
                f"Invalid resolution action '{effective_action}'. Allowed values are 'paid' or 'rejected'."
            )
        self.action = effective_action
        self.status = effective_action
        return self


class ReconciliationDetail(BaseModel):
    invoice_id: int
    vendor_name: str
    amount: float
    status: str
    notes: Optional[str] = None
    matched_ledger_id: Optional[int] = None


class ReconciliationResponse(BaseModel):
    status: str = Field(..., description="Execution status e.g. 'completed'")
    message: str = Field(..., description="Human-readable summary message")
    total_processed: int = Field(..., description="Number of pending invoices evaluated")
    reconciled_paid_count: int = Field(..., description="Number of invoices reconciled to paid")
    flagged_exception_count: int = Field(..., description="Number of invoices flagged for human review")
    details: List[ReconciliationDetail] = Field(default_factory=list, description="Itemized reconciliation outcomes")


class DashboardStats(BaseModel):
    total_invoices: int
    pending_count: int
    paid_count: int
    exception_count: int
    rejected_count: int
    total_invoice_amount: float
    total_ledger_amount: float
    reconciliation_rate_percent: float


class AgentSummaryResponse(BaseModel):
    """Summary response returned by the autonomous LangGraph agent."""
    processed: int = Field(..., description="Total pending invoices evaluated")
    paid: int = Field(..., description="Number of invoices reconciled and marked as paid")
    exceptions: int = Field(..., description="Number of invoices flagged for human review")


class UploadInvoiceResponse(BaseModel):
    """Response returned upon receiving an invoice document upload."""
    task_id: str = Field(..., description="Celery background task ID")
    status: str = Field(..., description="Initial task status (e.g. PENDING)")
    message: str = Field(..., description="Confirmation message")
    filename: str = Field(..., description="Uploaded original filename")


class TaskResponse(BaseModel):
    """Response returned when polling Celery task status."""
    task_id: str = Field(..., description="Celery background task ID")
    status: str = Field(..., description="Current task state (PENDING, STARTED, PROGRESS, SUCCESS, FAILURE)")
    message: Optional[str] = Field(default=None, description="Current progress or state description")
    result: Optional[dict] = Field(default=None, description="Extracted invoice data if completed")
    error: Optional[str] = Field(default=None, description="Error message if task failed")


