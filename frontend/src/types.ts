export type InvoiceStatusType = 'pending' | 'paid' | 'exception_human_review' | 'rejected'

export interface Invoice {
  id: number
  vendor_name: string
  amount: number
  due_date: string
  status: InvoiceStatusType
  vendor_email?: string | null
  draft_email_content?: string | null
  matched_ledger_id?: number | null
  reasoning?: string | null
  resolution_notes?: string | null
  created_at?: string
  updated_at?: string
}

export interface SendVendorEmailResponse {
  status: string
  message: string
  invoice_id: number
  vendor_email: string
  email_content: string
  is_real_email?: boolean
  sender_email?: string | null
}

export interface EmailConfigStatus {
  is_configured: boolean
  sender_email?: string | null
}

export interface BankLedger {
  id: number
  transaction_date: string
  received_amount: number
  description: string
  is_matched: boolean
  matched_invoice_id?: number | null
  created_at?: string
  updated_at?: string
}

export interface DashboardStats {
  total_invoices: number
  pending_count: number
  paid_count: number
  exception_count: number
  rejected_count: number
  total_invoice_amount: number
  total_ledger_amount: number
  reconciliation_rate_percent: number
}

export interface ReconciliationDetail {
  invoice_id: number
  vendor_name: string
  amount: number
  status: string
  notes?: string | null
  matched_ledger_id?: number | null
}

export interface ReconciliationResponse {
  status: string
  message: string
  total_processed: number
  reconciled_paid_count: number
  flagged_exception_count: number
  details: ReconciliationDetail[]
}

export interface BannerNotification {
  type: 'success' | 'destructive' | 'info'
  message: string
  subMessage?: string
}

export interface UploadInvoiceResponse {
  task_id: string
  status: string
  message: string
  filename: string
}

export interface ExtractedInvoiceSummary {
  invoice_id: number
  vendor_name: string
  amount: number
  due_date: string
  status: string
  reasoning?: string | null
}

export interface TaskStatusResponse {
  task_id: string
  status: 'PENDING' | 'STARTED' | 'PROGRESS' | 'SUCCESS' | 'FAILURE' | string
  message?: string | null
  result?: {
    total_extracted?: number
    invoices?: ExtractedInvoiceSummary[]
    invoice_id?: number
    vendor_name?: string
    amount?: number
    due_date?: string
    status?: string
    reasoning?: string | null
    message?: string
  } | null
  error?: string | null
}


