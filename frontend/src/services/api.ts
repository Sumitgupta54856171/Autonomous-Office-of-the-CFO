import type {
  BankLedger,
  DashboardStats,
  Invoice,
  ReconciliationResponse,
  TaskStatusResponse,
  UploadInvoiceResponse,
} from '../types'

export const API_BASE_URL = 'http://localhost:8000'

// Token getter injected from Clerk useAuth hook
let authTokenGetter: (() => Promise<string | null>) | null = null

export function setAuthTokenGetter(getter: () => Promise<string | null>) {
  authTokenGetter = getter
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {}
  if (authTokenGetter) {
    try {
      const token = await authTokenGetter()
      if (token) {
        headers['Authorization'] = `Bearer ${token}`
      }
    } catch {
      // Ignore token fetch failure in local dev/demo
    }
  }
  return headers
}

export async function checkHealth(): Promise<{ status: string; database: string }> {
  const res = await fetch(`${API_BASE_URL}/health`)
  if (!res.ok) throw new Error('Backend health check failed')
  return res.json()
}

export async function fetchStats(): Promise<DashboardStats> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/api/stats`, {
    headers: authHeaders,
  })
  if (!res.ok) throw new Error(`Failed to fetch stats: ${res.statusText}`)
  return res.json()
}

export async function fetchExceptions(): Promise<Invoice[]> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/api/exceptions/`, {
    headers: authHeaders,
  })
  if (!res.ok) throw new Error(`Failed to fetch exceptions: ${res.statusText}`)
  return res.json()
}

export async function resolveException(
  id: number,
  action: 'paid' | 'rejected',
  notes: string
): Promise<Invoice> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/api/exceptions/${id}/resolve`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, notes }),
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to resolve exception (${res.status})`)
  }
  return res.json()
}

export async function runReconciliation(): Promise<ReconciliationResponse> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/api/agent/run-reconciliation`, {
    method: 'POST',
    headers: authHeaders,
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Reconciliation failed (${res.status})`)
  }
  return res.json()
}

export async function fetchInvoices(status?: string): Promise<Invoice[]> {
  const authHeaders = await getAuthHeaders()
  const url = new URL(`${API_BASE_URL}/api/invoices/`)
  if (status && status !== 'all') {
    url.searchParams.set('status', status)
  }
  url.searchParams.set('limit', '200')
  const res = await fetch(url.toString(), {
    headers: authHeaders,
  })
  if (!res.ok) throw new Error(`Failed to fetch invoices: ${res.statusText}`)
  return res.json()
}

export async function createInvoice(data: {
  vendor_name: string
  amount: number
  due_date: string
  resolution_notes?: string
}): Promise<Invoice> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/api/invoices/`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to create invoice (${res.status})`)
  }
  return res.json()
}

export async function uploadInvoiceFile(file: File): Promise<UploadInvoiceResponse> {
  const authHeaders = await getAuthHeaders()
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(`${API_BASE_URL}/api/invoices/upload`, {
    method: 'POST',
    headers: authHeaders, // Browser automatically populates multipart/form-data boundary
    body: formData,
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Upload failed with status ${res.status}`)
  }
  return res.json()
}

export async function getTaskStatus(taskId: string): Promise<TaskStatusResponse> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/api/tasks/${taskId}`, {
    headers: authHeaders,
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to inspect task (${res.status})`)
  }
  return res.json()
}

export async function fetchLedger(isMatched?: boolean): Promise<BankLedger[]> {
  const authHeaders = await getAuthHeaders()
  const url = new URL(`${API_BASE_URL}/api/ledger/`)
  if (typeof isMatched === 'boolean') {
    url.searchParams.set('is_matched', String(isMatched))
  }
  url.searchParams.set('limit', '200')
  const res = await fetch(url.toString(), {
    headers: authHeaders,
  })
  if (!res.ok) throw new Error(`Failed to fetch bank ledger: ${res.statusText}`)
  return res.json()
}

export async function createLedgerEntry(data: {
  transaction_date: string
  received_amount: number
  description: string
}): Promise<BankLedger> {
  const authHeaders = await getAuthHeaders()
  const res = await fetch(`${API_BASE_URL}/api/ledger/`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || `Failed to add ledger entry (${res.status})`)
  }
  return res.json()
}
