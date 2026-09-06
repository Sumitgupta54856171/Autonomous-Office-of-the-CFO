import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  PlusCircle,
  FileText,
  Clock,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Search,
  Loader2,
  Filter,
} from 'lucide-react'
import { fetchInvoices, createInvoice } from '../services/api'
import type { Invoice, InvoiceStatusType } from '../types'
import { InvoiceUpload } from '../components/InvoiceUpload'
import { useLazyLoad } from '../hooks/useLazyLoad'

export function InvoicesPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')

  // Form states
  const [vendorName, setVendorName] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)

  const loadInvoices = useCallback(async () => {
    setLoading(true)
    try {
      const data = await fetchInvoices(statusFilter)
      setInvoices(data)
    } catch (err: unknown) {
      console.error('Failed to load invoices:', err)
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    loadInvoices()
  }, [loadInvoices])

  const handleCreateInvoice = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setFormSuccess(null)

    if (!vendorName.trim()) {
      setFormError('Please enter a vendor name.')
      return
    }
    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      setFormError('Please enter a valid invoice amount greater than $0.00.')
      return
    }
    if (!dueDate) {
      setFormError('Please select a due date.')
      return
    }

    setSubmitting(true)
    try {
      const newInvoice = await createInvoice({
        vendor_name: vendorName.trim(),
        amount: Math.round(numAmount * 100) / 100,
        due_date: dueDate,
      })

      setFormSuccess(`Successfully created Invoice #${newInvoice.id} for ${newInvoice.vendor_name}!`)
      setVendorName('')
      setAmount('')
      setDueDate('')
      await loadInvoices()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to create invoice.')
    } finally {
      setSubmitting(false)
    }
  }

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(val)
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A'
    const parts = dateStr.split('-')
    if (parts.length === 3) {
      return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    }
    return dateStr
  }

  const getStatusBadge = (status: InvoiceStatusType) => {
    switch (status) {
      case 'paid':
        return (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1 font-medium">
            <CheckCircle2 className="h-3 w-3" /> Paid
          </Badge>
        )
      case 'pending':
        return (
          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30 gap-1 font-medium">
            <Clock className="h-3 w-3" /> Pending
          </Badge>
        )
      case 'exception_human_review':
        return (
          <Badge variant="destructive" className="gap-1 font-medium">
            <AlertTriangle className="h-3 w-3" /> Exception
          </Badge>
        )
      case 'rejected':
        return (
          <Badge variant="outline" className="text-muted-foreground gap-1 font-medium">
            <XCircle className="h-3 w-3" /> Rejected
          </Badge>
        )
      default:
        return <Badge variant="secondary">{status}</Badge>
    }
  }

  const filteredInvoices = useMemo(() => {
    if (!searchTerm.trim()) return invoices
    const term = searchTerm.toLowerCase()
    return invoices.filter(
      (inv) =>
        inv.vendor_name.toLowerCase().includes(term) ||
        String(inv.id).includes(term) ||
        (inv.resolution_notes && inv.resolution_notes.toLowerCase().includes(term))
    )
  }, [invoices, searchTerm])

  // Scroll-based progressive lazy loading
  const {
    visibleItems: visibleInvoices,
    hasMore: hasMoreInvoices,
    isLoadingMore: loadingMoreInvoices,
    sentinelRef: invoicesSentinelRef,
    visibleCount: visibleInvoicesCount,
    totalCount: totalInvoicesCount,
  } = useLazyLoad(filteredInvoices, { batchSize: 15, stepSize: 10 })

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Vendor Invoices</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload invoice files for automated AI extraction or manually register vendor invoices into the autonomous pipeline.
        </p>
      </div>

      {/* AI Vision & Document Extraction Section */}
      <InvoiceUpload onUploadSuccess={loadInvoices} />

      {/* Form Card: Add New Invoice */}
      <Card className="shadow-sm border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary">
              <PlusCircle className="h-4 w-4" />
            </div>
            <CardTitle className="text-base font-bold">Add New Invoice</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Enter the vendor and billing details. Invoices will start in <strong className="text-foreground">pending</strong> status until matched by the AI reconciliation engine.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateInvoice} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Vendor Name <span className="text-rose-500">*</span>
                </label>
                <Input
                  type="text"
                  placeholder="e.g. AWS Cloud Services, Stripe, Datadog"
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Amount (USD) <span className="text-rose-500">*</span>
                </label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Due Date <span className="text-rose-500">*</span>
                </label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
            </div>

            {formError && (
              <p className="text-xs text-rose-600 dark:text-rose-400 font-medium">{formError}</p>
            )}
            {formSuccess && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">
                {formSuccess}
              </p>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={submitting} className="h-9 px-4 gap-2 text-xs font-semibold">
                {submitting ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Creating Invoice...
                  </>
                ) : (
                  <>
                    <PlusCircle className="h-3.5 w-3.5" />
                    Submit Invoice
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Invoices List Table */}
      <Card className="shadow-sm border-border">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-bold">All Invoices</CardTitle>
              <Badge variant="secondary" className="px-2 py-0.5 text-xs">
                {filteredInvoices.length} Total
              </Badge>
            </div>
            <CardDescription className="text-xs mt-0.5">
              Live ledger records fetched from <code className="text-[11px] bg-muted px-1 py-0.5 rounded">GET /api/invoices/</code>
            </CardDescription>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-full sm:w-48">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search vendor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>

            <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border">
              <Filter className="h-3 w-3 text-muted-foreground ml-1.5" />
              {['all', 'pending', 'paid', 'exception_human_review', 'rejected'].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`px-2 py-1 rounded-md text-[11px] font-medium transition ${
                    statusFilter === st
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {st === 'exception_human_review'
                    ? 'Exceptions'
                    : st.charAt(0).toUpperCase() + st.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin mb-2 text-primary" />
              <p className="text-sm font-medium">Loading invoices...</p>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="py-14 px-4 text-center">
              <FileText className="h-9 w-9 text-muted-foreground/50 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">No invoices found</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {searchTerm || statusFilter !== 'all'
                  ? 'Try clearing your search or status filter.'
                  : 'Add a new invoice above to get started.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>Vendor Name</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Matched Ledger</TableHead>
                    <TableHead className="min-w-[240px]">Audit / AI Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleInvoices.map((inv) => (
                    <TableRow key={inv.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-semibold">
                        #{String(inv.id).padStart(3, '0')}
                      </TableCell>
                      <TableCell className="font-medium text-foreground">
                        {inv.vendor_name}
                      </TableCell>
                      <TableCell className="font-semibold text-foreground">
                        {formatCurrency(inv.amount)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(inv.due_date)}
                      </TableCell>
                      <TableCell>{getStatusBadge(inv.status)}</TableCell>
                      <TableCell className="text-xs font-mono">
                        {inv.matched_ledger_id ? (
                          <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                            #LEDGER-{String(inv.matched_ledger_id).padStart(3, '0')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-sm truncate">
                        {inv.resolution_notes || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Lazy Loading Sentinel Bar */}
              <div
                ref={invoicesSentinelRef}
                className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground bg-muted/20"
              >
                <div className="flex items-center gap-2">
                  {loadingMoreInvoices && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                  <span>
                    Showing {visibleInvoicesCount} of {totalInvoicesCount}{' '}
                    {totalInvoicesCount === 1 ? 'invoice' : 'invoices'}
                  </span>
                </div>
                {hasMoreInvoices ? (
                  <span className="text-[11px] text-muted-foreground">Scroll down to load more</span>
                ) : totalInvoicesCount > 0 ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                    All invoices loaded
                  </span>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
