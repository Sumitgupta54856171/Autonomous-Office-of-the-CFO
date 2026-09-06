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
} from 'lucide-react'
import {
  fetchStats,
  fetchExceptions,
  resolveException,
  runReconciliation,
} from '../services/api'
import type { DashboardStats, Invoice, BannerNotification, ReconciliationResponse } from '../types'

export function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [exceptions, setExceptions] = useState<Invoice[]>([])
  const [loadingStats, setLoadingStats] = useState(true)
  const [loadingExceptions, setLoadingExceptions] = useState(true)
  const [reconciling, setReconciling] = useState(false)
  const [processingId, setProcessingId] = useState<number | null>(null)
  const [notification, setNotification] = useState<BannerNotification | null>(null)
  const [lastReconResult, setLastReconResult] = useState<ReconciliationResponse | null>(null)

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
      const [statsData, exceptionsData] = await Promise.all([
        fetchStats(),
        fetchExceptions(),
      ])
      setStats(statsData)
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
                  {exceptions.map((inv) => (
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
            </div>
          )}
        </CardContent>
      </Card>

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
