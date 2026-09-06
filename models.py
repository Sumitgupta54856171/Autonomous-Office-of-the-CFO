"""SQLAlchemy ORM models for AutoCFO: Invoice and BankLedger."""

from datetime import date, datetime
from enum import Enum
from typing import Optional
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from database import Base


class InvoiceStatus(str, Enum):
    """Permitted statuses for an Invoice."""
    PENDING = "pending"
    PAID = "paid"
    EXCEPTION_HUMAN_REVIEW = "exception_human_review"
    REJECTED = "rejected"


class Invoice(Base):
    """Represents a vendor invoice in the AutoCFO system."""

    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    vendor_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    amount: Mapped[float] = mapped_column(Float, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(
        String(50),
        default=InvoiceStatus.PENDING.value,
        nullable=False,
        index=True,
    )
    # Production audit fields
    matched_ledger_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("bank_ledger.id", ondelete="SET NULL"),
        nullable=True,
    )
    reasoning: Mapped[Optional[str]] = mapped_column(String(2000), nullable=True)
    resolution_notes: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    # Relationships
    matched_ledger: Mapped[Optional["BankLedger"]] = relationship(
        "BankLedger",
        foreign_keys=[matched_ledger_id],
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<Invoice(id={self.id}, vendor='{self.vendor_name}', amount={self.amount}, status='{self.status}')>"


class BankLedger(Base):
    """Represents a bank transaction record in the ledger."""

    __tablename__ = "bank_ledger"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True, autoincrement=True)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    received_amount: Mapped[float] = mapped_column(Float, nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    # Production audit fields
    is_matched: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    matched_invoice_id: Mapped[Optional[int]] = mapped_column(
        Integer,
        ForeignKey("invoices.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    matched_invoice: Mapped[Optional["Invoice"]] = relationship(
        "Invoice",
        foreign_keys=[matched_invoice_id],
        lazy="selectin",
    )

    def __repr__(self) -> str:
        return f"<BankLedger(id={self.id}, amount={self.received_amount}, desc='{self.description}', is_matched={self.is_matched})>"
