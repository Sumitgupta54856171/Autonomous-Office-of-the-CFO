import { useEffect, useState, useCallback } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Sparkles,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Clock,
  TrendingUp,
  RefreshCw,
  Loader2,
  ShieldAlert,
  Bot,
  Mail,
  Send,
  AlertCircle,
} from 'lucide-react'
import {
  fetchEmailStatus,
  fetchStats,
  fetchExceptions,
  resolveException,
  runReconciliation,
  sendVendorEmail,
} from '../services/api'
import type { DashboardStats, EmailConfigStatus, Invoice, BannerNotification, ReconciliationResponse } from '../types'
import { useLazyLoad } from '../hooks/useLazyLoad'

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [exceptions, setExceptions] = useState<Invoice[]>([])
  const [emailConfig, setEmailConfig] = useState<EmailConfigStatus | null>(null)
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingExceptions, setLoadingExceptions] = useState(true)
  const [reconciling, setReconciling] = useState(false)
  const [processingId, setProcessingId] = useState<number | null>(null)
  const [notification, setNotification] = useState<BannerNotification | null>(null)
  const [lastReconResult, setLastReconResult] = useState<ReconciliationResponse | null>(null)

  // Autonomous Vendor Follow-up (Auto-Email) Dialog State
  const [reviewingEmailInvoice, setReviewingEmailInvoice] = useState<Invoice | null>(null)
  const [emailRecipient, setEmailRecipient] = useState('')
  const [emailDraftText, setEmailDraftText] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)

  // Modal / prompt state for custom resolution note (optional)
  const [resolvingItem, setResolvingItem] = useState<{
    invoice: Invoice
    action: 'paid' | 'rejected'
  } | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')

  const loadData = useCallback(async () => {
    setLoadingStats(true)
    setLoadingExceptions(true)
    try {
      const [statsData, exceptionsData, emailStatus] = await Promise.all([
        fetchStats(),
        fetchExceptions(),
        fetchEmailStatus().catch(() => null),
      ])
      setStats(statsData)
      setExceptions(exceptionsData)
      if (emailStatus) setEmailConfig(emailStatus)
      setExceptions(exceptionsData)
    } catch (err: unknown) {
      console.error('Failed to load dashboard data:', err)
      setNotification({
        type: 'destructive',
        message: err instanceof Error ? err.message : 'Could not fetch dashboard metrics',
      })
    } finally {
      setLoadingStats(false)
      setLoadingExceptions(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Execute AI Agent Reconciliation
  const handleRunReconciliation = async () => {
    setReconciling(true)
    setNotification(null)
    setLastReconResult(null)
    try {
      const result = await runReconciliation()
      setLastReconResult(result)
      setNotification({
        type: 'success',
        message: 'AI Reconciliation engine completed successfully!',
        subMessage: `Processed: ${result.total_processed} | Auto-paid: ${result.reconciled_paid_count} | Flagged for review: ${result.flagged_exception_count}`,
      })
      // Refresh dashboard stats and exceptions queue
      await loadData()
    } catch (err: unknown) {
      console.error('Reconciliation execution error:', err)
      setNotification({
        type: 'destructive',
        message: err instanceof Error ? err.message : 'AI Reconciliation execution failed.',
      })
    } finally {
      setReconciling(false)
    }
  }

  // Open resolution dialog
  const openResolveDialog = (invoice: Invoice, action: 'paid' | 'rejected') => {
    setResolvingItem({ invoice, action })
    setResolutionNote(
      action === 'paid'
        ? 'Verified payment record manually via bank portal.'
        : 'Disputed amount / duplicate invoice rejected by CFO.'
    )
  }

  // Confirm resolution action
  const confirmResolve = async () => {
    if (!resolvingItem) return
    const { invoice, action } = resolvingItem
    setProcessingId(invoice.id)
    try {
      await resolveException(invoice.id, action, resolutionNote.trim())
      setExceptions((prev) => prev.filter((item) => item.id !== invoice.id))
      setNotification({
        type: action === 'paid' ? 'success' : 'destructive',
        message: `Invoice #${invoice.id} (${invoice.vendor_name}) marked as ${action.toUpperCase()}.`,
      })
      setResolvingItem(null)
      // Refresh statistics
      const updatedStats = await fetchStats().catch(() => null)
      if (updatedStats) setStats(updatedStats)
    } catch (err: unknown) {
      alert(`Error resolving exception: ${err instanceof Error ? err.message : 'Failed to resolve'}`)
    } finally {
      setProcessingId(null)
    }
  }

  // Helper to remove any markdown ** asterisks and formatting symbols from email drafts
  const cleanEmailContent = (text: string): string => {
    if (!text) return ''
    return text
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/__([^_]+)__/g, '$1')
      .replace(/_([^_]+)_/g, '$1')
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/^\s*\*\s+/gm, ' - ')
      .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '')
      .replace(/\*\*/g, '')
      .replace(/`/g, '')
      .trim()
  }

  // Progressive scroll-based lazy loading for exceptions queue
  const {
    visibleItems: visibleExceptions,
    hasMore: hasMoreExceptions,
    isLoadingMore: loadingMoreExceptions,
    sentinelRef: exceptionsSentinelRef,
    visibleCount: visibleExceptionsCount,
    totalCount: totalExceptionsCount,
    loadMore: loadMoreExceptions,
  } = useLazyLoad(exceptions, { batchSize: 10, stepSize: 10, resetKey: exceptions.length })

  // Open Autonomous Vendor Email Dialog
  const openEmailDialog = (invoice: Invoice) => {
    setReviewingEmailInvoice(invoice)
    const fallbackEmail = `billing@${invoice.vendor_name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`
    setEmailRecipient(invoice.vendor_email || fallbackEmail)

    if (invoice.draft_email_content && invoice.draft_email_content.trim()) {
      setEmailDraftText(cleanEmailContent(invoice.draft_email_content))
    } else {
      setEmailDraftText(
        `Subject: Payment Discrepancy Notice – Invoice #INV-${invoice.id} [${invoice.vendor_name}]

Dear ${invoice.vendor_name} Accounts Receivable Team,

I hope this message finds you well. I am writing on behalf of the AutoCFO Finance Team regarding Invoice #INV-${invoice.id} for ${formatCurrency(invoice.amount)} due on ${formatDate(invoice.due_date)}.

During our autonomous financial reconciliation process, our system identified an unresolved payment discrepancy:
 - Invoiced Amount: ${formatCurrency(invoice.amount)}
 - Ledger Record: No matching deposit identified in our bank ledger
 - Discrepancy Reason: ${cleanEmailContent(invoice.resolution_notes || 'Flagged for human review')}

To ensure accurate accounting and maintain up-to-date ledger balances, could you kindly review your records and provide updated remittance advice or an account statement?

Thank you for your prompt assistance.

Sincerely,

AutoCFO Autonomous Finance Team
accounts@autocfo.com`
      )
    }
  }

  // Dispatch Email to Vendor (Simulated SMTP for Hackathon Demo)
  const handleSendEmail = async () => {
    if (!reviewingEmailInvoice) return
    setSendingEmail(true)
    try {
      const response = await sendVendorEmail(reviewingEmailInvoice.id, {
        vendor_email: emailRecipient.trim(),
        email_content: emailDraftText.trim(),
      })

      setNotification({
        type: 'success',
        message: response.is_real_email
          ? `Real email sent via Gmail (${response.sender_email || emailConfig?.sender_email || 'SMTP'})!`
          : 'Vendor email simulated and logged!',
        subMessage: `Dispatched to ${response.vendor_email} for Invoice #INV-${reviewingEmailInvoice.id}.`,
      })

      // Update local invoice state
      setExceptions((prev) =>
        prev.map((item) =>
          item.id === reviewingEmailInvoice.id
            ? {
                ...item,
                vendor_email: response.vendor_email,
                draft_email_content: response.email_content,
                resolution_notes: `${item.resolution_notes || ''} | Dispatched follow-up email to ${response.vendor_email}`,
              }
            : item
        )
      )

      setReviewingEmailInvoice(null)
    } catch (err: unknown) {
      alert(`Error sending email: ${err instanceof Error ? err.message : 'Failed to dispatch email'}`)
    } finally {
      setSendingEmail(false)
    }
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount)
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

  return (
    <div className="space-y-8">
      {/* Top Banner & AI Reconciliation Trigger Bar */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-950 text-white shadow-xl">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <span className="p-1.5 rounded-lg bg-indigo-500/20 text-indigo-300 ring-1 ring-indigo-400/30">
              <Bot className="h-5 w-5" />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              Autonomous CFO Command Center
            </h1>
          </div>
          <p className="text-sm text-slate-300 max-w-2xl">
            Autonomous multi-way matching for vendor invoices and bank transactions. Ambiguities and anomalies are routed into the Human-in-the-Loop review queue.
          </p>
        </div>

        {/* Prominent Run Reconciliation Button */}
        <div className="flex items-center gap-3">
          <Button
            onClick={loadData}
            variant="outline"
            className="border-slate-700 bg-slate-800/80 text-slate-200 hover:bg-slate-700 hover:text-white"
            title="Refresh dashboard data"
          >
            <RefreshCw className={`h-4 w-4 ${loadingStats || loadingExceptions ? 'animate-spin' : ''}`} />
          </Button>

          <Button
            onClick={handleRunReconciliation}
            disabled={reconciling}
            className="bg-indigo-500 hover:bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 px-5 py-2.5 font-semibold text-sm h-11 transition-all"
          >
            {reconciling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Matching Invoices...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-amber-300" />
                Run AI Reconciliation
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Notification Toast / Banner */}
      {notification && (
        <div
          className={`p-4 rounded-xl border transition-all ${
            notification.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200'
              : notification.type === 'destructive'
              ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200'
              : 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              {notification.type === 'success' ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              ) : notification.type === 'destructive' ? (
                <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
              ) : (
                <Sparkles className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-semibold text-sm">{notification.message}</p>
                {notification.subMessage && (
                  <p className="text-xs opacity-90 mt-0.5">{notification.subMessage}</p>
                )}
              </div>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-xs opacity-60 hover:opacity-100 p-1"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Latest AI Reconciliation Run Breakdown */}
      {lastReconResult && lastReconResult.details && lastReconResult.details.length > 0 && (
        <Card className="border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/30 dark:bg-indigo-950/20 shadow-xs">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                <CardTitle className="text-xs font-bold uppercase tracking-wider text-indigo-900 dark:text-indigo-200">
                  Latest AI Reconciliation Outcome Details
                </CardTitle>
              </div>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setLastReconResult(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Dismiss
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-1.5">
              {lastReconResult.details.map((item) => (
                <div
                  key={item.invoice_id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between text-xs p-2.5 rounded-lg bg-background/90 border border-border/60 gap-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold">
                      #INV-{String(item.invoice_id).padStart(3, '0')}
                    </span>
                    <span className="font-medium text-foreground">{item.vendor_name}</span>
                    <span className="text-foreground font-semibold">
                      {formatCurrency(item.amount)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 justify-between sm:justify-end">
                    <span className="text-[11px] text-muted-foreground truncate max-w-xs">
                      {item.notes}
                    </span>
                    <Badge
                      className={
                        item.status === 'paid'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                      }
                    >
                      {item.status === 'paid' ? 'Auto-Paid' : 'Flagged Exception'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* High-Level CFO Statistics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Invoices */}
        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Invoices
            </CardTitle>
            <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600">
              <FileText className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {loadingStats ? '—' : stats?.total_invoices ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Volume: {stats ? formatCurrency(stats.total_invoice_amount) : '$0.00'}
            </p>
          </CardContent>
        </Card>

        {/* Pending Invoices */}
        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pending Matching
            </CardTitle>
            <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600">
              <Clock className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {loadingStats ? '—' : stats?.pending_count ?? 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Awaiting next AI reconciliation run
            </p>
          </CardContent>
        </Card>

        {/* Action Required: Exceptions */}
        <Card className="shadow-xs border-rose-200 dark:border-rose-900/60 bg-rose-50/20 dark:bg-rose-950/10">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-rose-700 dark:text-rose-400">
              Human Review Needed
            </CardTitle>
            <div className="p-2 rounded-lg bg-rose-100 dark:bg-rose-900/50 text-rose-600">
              <ShieldAlert className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
              {loadingExceptions ? '—' : exceptions.length}
            </div>
            <p className="text-xs text-rose-600/80 dark:text-rose-300 mt-1 font-medium">
              Exceptions requiring CFO action below
            </p>
          </CardContent>
        </Card>

        {/* Reconciliation Success Rate */}
        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Auto-Match Rate
            </CardTitle>
            <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600">
              <TrendingUp className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {loadingStats ? '—' : `${stats?.reconciliation_rate_percent.toFixed(1) ?? 0}%`}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {stats?.paid_count ?? 0} invoices paid & reconciled
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Human-in-the-Loop Exceptions Table Section */}
      <Card className="shadow-sm border-border">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 gap-2">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-lg font-bold">Exceptions Review Queue</CardTitle>
              <Badge variant={exceptions.length > 0 ? 'destructive' : 'secondary'} className="px-2 py-0.5">
                {exceptions.length} {exceptions.length === 1 ? 'Exception' : 'Exceptions'}
              </Badge>
            </div>
            <CardDescription className="text-xs mt-1">
              Invoices with partial payments or unmatched bank ledger entries flagged by AutoCFO for human sign-off.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loadingExceptions ? (
            <div className="py-12 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin mb-2 text-primary" />
              <p className="text-sm font-medium">Loading exception queue...</p>
            </div>
          ) : exceptions.length === 0 ? (
            <div className="py-16 px-4 flex flex-col items-center justify-center text-center">
              <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center mb-3">
                <CheckCircle2 className="h-6 w-6" />
              </div>
              <h3 className="text-base font-semibold text-foreground">Zero Exceptions Pending</h3>
              <p className="text-xs text-muted-foreground max-w-md mt-1">
                All invoices have either been automatically reconciled or resolved. Trigger reconciliation or add new invoices to evaluate more transactions.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-20">ID</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead className="min-w-[280px]">AI Discrepancy Note</TableHead>
                    <TableHead className="text-right">Human Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleExceptions.map((inv) => (
                    <TableRow key={inv.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-semibold">
                        #INV-{String(inv.id).padStart(3, '0')}
                      </TableCell>
                      <TableCell>
                        <span className="font-medium text-foreground">{inv.vendor_name}</span>
                      </TableCell>
                      <TableCell className="font-semibold text-foreground">
                        {formatCurrency(inv.amount)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(inv.due_date)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-start gap-1.5 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 text-xs">
                          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                          <span>{inv.resolution_notes || 'Flagged for human review'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEmailDialog(inv)}
                            className="border-indigo-300 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 gap-1.5 text-xs h-8"
                            title="Review and dispatch autonomous vendor follow-up email"
                          >
                            <Mail className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
                            Review Email
                          </Button>
                          <Button
                            size="sm"
                            disabled={processingId === inv.id}
                            onClick={() => openResolveDialog(inv, 'paid')}
                            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 text-xs h-8"
                          >
                            {processingId === inv.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={processingId === inv.id}
                            onClick={() => openResolveDialog(inv, 'rejected')}
                            className="gap-1 text-xs h-8"
                          >
                            {processingId === inv.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <XCircle className="h-3.5 w-3.5" />
                            )}
                            Reject
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Lazy Loading Sentinel Bar */}
              {totalExceptionsCount > 0 && (
                <div
                  ref={hasMoreExceptions ? exceptionsSentinelRef : undefined}
                  className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground bg-muted/20"
                >
                  <div className="flex items-center gap-2">
                    <span>
                      Showing {visibleExceptionsCount} of {totalExceptionsCount}{' '}
                      {totalExceptionsCount === 1 ? 'exception' : 'exceptions'}
                    </span>
                  </div>
                  {hasMoreExceptions ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground hidden sm:inline">
                        Scroll down to load more
                      </span>
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={loadingMoreExceptions}
                        onClick={loadMoreExceptions}
                        className="h-7 text-xs px-2.5"
                      >
                        {loadingMoreExceptions ? (
                          <>
                            <Loader2 className="h-3 w-3 animate-spin mr-1" />
                            Loading...
                          </>
                        ) : (
                          'Load More'
                        )}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      All exceptions loaded
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Autonomous Vendor Follow-up (Auto-Email) shadcn Dialog Modal */}
      <Dialog
        open={reviewingEmailInvoice !== null}
        onOpenChange={(open) => {
          if (!open) setReviewingEmailInvoice(null)
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="border-b pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
                  <Mail className="h-5 w-5" />
                </div>
                <div>
                  <DialogTitle className="text-base font-bold">
                    Autonomous Vendor Email Review
                  </DialogTitle>
                  <DialogDescription className="text-xs">
                    Review, edit, and dispatch the discrepancy follow-up email drafted autonomously by AutoCFO.
                  </DialogDescription>
                </div>
              </div>
              {emailConfig?.is_configured ? (
                <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-300 text-[10px] gap-1.5 py-0.5 self-start sm:self-center shrink-0">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live Gmail Active: {emailConfig.sender_email}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300 self-start sm:self-center shrink-0">
                  Simulated SMTP
                </Badge>
              )}
            </div>
          </DialogHeader>

          {reviewingEmailInvoice && (
            <div className="space-y-4 py-2 overflow-y-auto pr-1">
              {/* Recipient & Metadata Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-muted/40 border border-border/80 text-xs">
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                    From (Sender)
                  </label>
                  <Input
                    readOnly
                    value={emailConfig?.sender_email || 'guptaashish2531@gmail.com'}
                    className="h-8 text-xs bg-muted/50 font-mono text-muted-foreground cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                    To (Recipient Email)
                  </label>
                  <Input
                    value={emailRecipient}
                    onChange={(e) => setEmailRecipient(e.target.value)}
                    placeholder="billing@vendor.com"
                    className="h-8 text-xs bg-background font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                    Invoice Context
                  </label>
                  <div className="flex items-center gap-2 pt-1 font-medium text-foreground">
                    <Badge variant="outline" className="font-mono text-[11px]">
                      #INV-{reviewingEmailInvoice.id}
                    </Badge>
                    <span className="truncate max-w-[90px]">{reviewingEmailInvoice.vendor_name}</span>
                    <span className="font-bold text-emerald-600">
                      {formatCurrency(reviewingEmailInvoice.amount)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Exception Reasoning Context */}
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-900 dark:text-amber-200 text-xs flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">Detected Payment Discrepancy: </span>
                  <span>{reviewingEmailInvoice.resolution_notes || 'Unmatched ledger record requiring review.'}</span>
                </div>
              </div>

              {/* Editable Draft Email Content in Textarea */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-foreground flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-indigo-500" />
                    Autonomous Email Draft (Editable by CFO)
                  </label>
                  <span className="text-[11px] text-muted-foreground">
                    Editable email body
                  </span>
                </div>
                <Textarea
                  rows={11}
                  value={emailDraftText}
                  onChange={(e) => setEmailDraftText(e.target.value)}
                  placeholder="Draft email content..."
                  className="font-mono text-xs leading-relaxed resize-y bg-background"
                />
              </div>
            </div>
          )}

          <DialogFooter className="border-t pt-3 flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReviewingEmailInvoice(null)}
              disabled={sendingEmail}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSendEmail}
              disabled={sendingEmail || !emailDraftText.trim()}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5 text-xs font-semibold h-8"
            >
              {sendingEmail ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Dispatching...
                </>
              ) : (
                <>
                  <Send className="h-3.5 w-3.5" />
                  Send Email
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Resolution Confirmation Modal */}
      {resolvingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div className="w-full max-w-md bg-card rounded-xl border border-border p-6 shadow-2xl space-y-4">
            <div>
              <h3 className="text-base font-bold text-foreground">
                Confirm Human Review Resolution
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                You are about to mark Invoice #{resolvingItem.invoice.id} ({resolvingItem.invoice.vendor_name}) for{' '}
                <strong className="text-foreground">{formatCurrency(resolvingItem.invoice.amount)}</strong> as{' '}
                <span
                  className={`font-semibold uppercase ${
                    resolvingItem.action === 'paid' ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {resolvingItem.action}
                </span>
                .
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">
                CFO / Reviewer Audit Note:
              </label>
              <textarea
                rows={3}
                value={resolutionNote}
                onChange={(e) => setResolutionNote(e.target.value)}
                className="w-full rounded-lg border border-input bg-background p-2.5 text-xs text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Enter audit rationale for this decision..."
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setResolvingItem(null)}
                disabled={processingId !== null}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={confirmResolve}
                disabled={processingId !== null}
                className={
                  resolvingItem.action === 'paid'
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    : 'bg-rose-600 hover:bg-rose-700 text-white'
                }
              >
                {processingId !== null && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Confirm {resolvingItem.action === 'paid' ? 'Approval' : 'Rejection'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
