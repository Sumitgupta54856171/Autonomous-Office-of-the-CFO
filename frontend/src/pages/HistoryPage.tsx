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
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  History,
  CheckCircle2,
  XCircle,
  Search,
  Loader2,
  Bot,
  UserCheck,
  DollarSign,
  TrendingUp,
} from 'lucide-react'
import { fetchInvoices } from '../services/api'
import type { Invoice } from '../types'
import { useLazyLoad } from '../hooks/useLazyLoad'

export function HistoryPage() {
  const [historyInvoices, setHistoryInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<'all' | 'paid' | 'rejected'>('all')
  const [searchTerm, setSearchTerm] = useState('')

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      // Fetch both paid and rejected records
      const [paidInvoices, rejectedInvoices] = await Promise.all([
        fetchInvoices('paid'),
        fetchInvoices('rejected'),
      ])
      // Combine and sort by id descending
      const combined = [...paidInvoices, ...rejectedInvoices].sort((a, b) => b.id - a.id)
      setHistoryInvoices(combined)
    } catch (err: unknown) {
      console.error('Failed to load history:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadHistory()
  }, [loadHistory])

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

  const filteredInvoices = historyInvoices.filter((inv) => {
    if (filterType !== 'all' && inv.status !== filterType) {
      return false
    }
    if (!searchTerm.trim()) return true
    const term = searchTerm.toLowerCase()
    return (
      inv.vendor_name.toLowerCase().includes(term) ||
      String(inv.id).includes(term) ||
      (inv.resolution_notes && inv.resolution_notes.toLowerCase().includes(term))
    )
  })

  // Scroll-based progressive lazy loading
  const {
    visibleItems: visibleInvoices,
    hasMore: hasMoreInvoices,
    isLoadingMore: loadingMoreInvoices,
    sentinelRef: historySentinelRef,
    visibleCount: visibleInvoicesCount,
    totalCount: totalInvoicesCount,
  } = useLazyLoad(filteredInvoices, { batchSize: 15, stepSize: 10 })

  // Calculations
  const paidList = historyInvoices.filter((i) => i.status === 'paid')
  const totalPaidVolume = paidList.reduce((sum, i) => sum + (i.amount || 0), 0)
  const rejectedCount = historyInvoices.filter((i) => i.status === 'rejected').length

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          Reconciliation & Decision History
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Complete audit trail of all finalized invoices (Paid and Rejected) with explicit AI matching rationale and human reviewer notes.
        </p>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Resolved
            </CardTitle>
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600">
              <History className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {loading ? '—' : historyInvoices.length}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Finalized lifecycle invoices
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Paid Volume
            </CardTitle>
            <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600">
              <DollarSign className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {loading ? '—' : formatCurrency(totalPaidVolume)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {paidList.length} approved / auto-reconciled
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Rejected Invoices
            </CardTitle>
            <div className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600">
              <XCircle className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight text-rose-600 dark:text-rose-400">
              {loading ? '—' : rejectedCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Disputed or blocked by human review
            </p>
          </CardContent>
        </Card>
      </div>

      {/* History Table */}
      <Card className="shadow-sm border-border">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-bold">Audit History Records</CardTitle>
              <Badge variant="secondary" className="px-2 py-0.5 text-xs">
                {filteredInvoices.length} Invoices
              </Badge>
            </div>
            <CardDescription className="text-xs mt-0.5">
              Showing closed items with AI reasoning and reviewer notes
            </CardDescription>
          </div>

          {/* Search and Tabs */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search vendor or reason..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>

            <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border">
              {(['all', 'paid', 'rejected'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFilterType(tab)}
                  className={`px-3 py-1 rounded-md text-[11px] font-medium transition ${
                    filterType === tab
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab === 'all'
                    ? 'All'
                    : tab === 'paid'
                    ? 'Paid Only'
                    : 'Rejected Only'}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin mb-2 text-primary" />
              <p className="text-sm font-medium">Loading history logs...</p>
            </div>
          ) : filteredInvoices.length === 0 ? (
            <div className="py-14 px-4 text-center">
              <History className="h-9 w-9 text-muted-foreground/50 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">No resolved invoices found</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Invoices will appear here once they are marked as 'paid' via AI matching or approved/rejected via the Exception Queue.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Bank Record</TableHead>
                    <TableHead className="min-w-[320px]">AI Reasoning & Audit Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleInvoices.map((inv) => {
                    const isHumanAction =
                      inv.resolution_notes?.toLowerCase().includes('human review') ||
                      inv.resolution_notes?.toLowerCase().includes('cfo')
                    const isAIAction =
                      inv.resolution_notes?.toLowerCase().includes('ai agent') ||
                      inv.resolution_notes?.toLowerCase().includes('auto-reconciled')

                    return (
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
                        <TableCell>
                          {inv.status === 'paid' ? (
                            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1 font-medium">
                              <CheckCircle2 className="h-3 w-3" /> Paid
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-rose-600 dark:text-rose-400 border-rose-500/30 gap-1 font-medium bg-rose-500/10">
                              <XCircle className="h-3 w-3" /> Rejected
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {inv.matched_ledger_id ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                              #LEDGER-{String(inv.matched_ledger_id).padStart(3, '0')}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-start gap-2 p-2 rounded-lg bg-muted/60 border border-border/80 text-xs">
                            {isHumanAction ? (
                              <UserCheck className="h-4 w-4 text-indigo-500 shrink-0 mt-0.5" />
                            ) : isAIAction ? (
                              <Bot className="h-4 w-4 text-emerald-500 shrink-0 mt-0.5" />
                            ) : (
                              <TrendingUp className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                            )}
                            <span className="leading-relaxed text-foreground">
                              {inv.resolution_notes || 'No audit notes recorded'}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {/* Lazy Loading Sentinel Bar */}
              <div
                ref={historySentinelRef}
                className="p-3 border-t border-border flex items-center justify-between text-xs text-muted-foreground bg-muted/20"
              >
                <div className="flex items-center gap-2">
                  {loadingMoreInvoices && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                  <span>
                    Showing {visibleInvoicesCount} of {totalInvoicesCount}{' '}
                    {totalInvoicesCount === 1 ? 'record' : 'records'}
                  </span>
                </div>
                {hasMoreInvoices ? (
                  <span className="text-[11px] text-muted-foreground">Scroll down to load more</span>
                ) : totalInvoicesCount > 0 ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                    All history records loaded
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
