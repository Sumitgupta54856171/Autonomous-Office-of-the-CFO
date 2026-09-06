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
import {
  Landmark,
  PlusCircle,
  CheckCircle2,
  Clock,
  Search,
  Loader2,
  DollarSign,
} from 'lucide-react'
import { fetchLedger, createLedgerEntry } from '../services/api'
import type { BankLedger } from '../types'

export function LedgerPage() {
  const [ledgerEntries, setLedgerEntries] = useState<BankLedger[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [filterMatched, setFilterMatched] = useState<'all' | 'unmatched' | 'matched'>('all')
  const [searchTerm, setSearchTerm] = useState('')

  // Form states
  const [transactionDate, setTransactionDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [formSuccess, setFormSuccess] = useState<string | null>(null)

  const loadLedger = useCallback(async () => {
    setLoading(true)
    try {
      const isMatchedParam =
        filterMatched === 'all'
          ? undefined
          : filterMatched === 'matched'
          ? true
          : false
      const data = await fetchLedger(isMatchedParam)
      setLedgerEntries(data)
    } catch (err: unknown) {
      console.error('Failed to load bank ledger:', err)
    } finally {
      setLoading(false)
    }
  }, [filterMatched])

  useEffect(() => {
    loadLedger()
  }, [loadLedger])

  const handleCreateLedgerEntry = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)
    setFormSuccess(null)

    if (!transactionDate) {
      setFormError('Please choose a transaction date.')
      return
    }
    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      setFormError('Please enter a valid deposit amount greater than $0.00.')
      return
    }
    if (!description.trim()) {
      setFormError('Please enter a description or wire memo.')
      return
    }

    setSubmitting(true)
    try {
      const newEntry = await createLedgerEntry({
        transaction_date: transactionDate,
        received_amount: Math.round(numAmount * 100) / 100,
        description: description.trim(),
      })

      setFormSuccess(
        `Recorded Bank Transaction #${newEntry.id} for $${newEntry.received_amount.toFixed(2)}!`
      )
      setAmount('')
      setDescription('')
      await loadLedger()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Failed to record bank transaction.')
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

  const filteredEntries = ledgerEntries.filter((entry) => {
    if (!searchTerm.trim()) return true
    const term = searchTerm.toLowerCase()
    return (
      entry.description.toLowerCase().includes(term) ||
      String(entry.id).includes(term) ||
      String(entry.received_amount).includes(term)
    )
  })

  const totalDeposits = ledgerEntries.reduce((sum, e) => sum + (e.received_amount || 0), 0)
  const matchedCount = ledgerEntries.filter((e) => e.is_matched).length
  const unmatchedCount = ledgerEntries.length - matchedCount

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Bank Ledger</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Record bank deposits and view all incoming transaction records for AI invoice matching.
        </p>
      </div>

      {/* Summary Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Total Deposits
            </CardTitle>
            <div className="p-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600">
              <DollarSign className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight">
              {loading ? '—' : formatCurrency(totalDeposits)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {ledgerEntries.length} total bank transactions
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Available (Unmatched)
            </CardTitle>
            <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600">
              <Clock className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
              {loading ? '—' : unmatchedCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Eligible for autonomous agent matching
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/80">
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Reconciled (Matched)
            </CardTitle>
            <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
              {loading ? '—' : matchedCount}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Bound to specific vendor invoice IDs
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Form Card: Add Bank Transaction */}
      <Card className="shadow-sm border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-primary/10 text-primary">
              <PlusCircle className="h-4 w-4" />
            </div>
            <CardTitle className="text-base font-bold">Record Bank Transaction</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Add wire transfers, ACH deposits, or checks. The AI reconciliation agent compares these records against pending invoices.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateLedgerEntry} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Transaction Date <span className="text-rose-500">*</span>
                </label>
                <Input
                  type="date"
                  value={transactionDate}
                  onChange={(e) => setTransactionDate(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">
                  Received Amount (USD) <span className="text-rose-500">*</span>
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

              <div className="space-y-1.5 sm:col-span-1">
                <label className="text-xs font-semibold text-foreground">
                  Description / Wire Memo <span className="text-rose-500">*</span>
                </label>
                <Input
                  type="text"
                  placeholder="e.g. ACH DEP: Snowflake Inc INV-001"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
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
                    Recording...
                  </>
                ) : (
                  <>
                    <PlusCircle className="h-3.5 w-3.5" />
                    Add Transaction
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Ledger Table */}
      <Card className="shadow-sm border-border">
        <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between pb-4 gap-3">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-bold">Bank Records</CardTitle>
              <Badge variant="secondary" className="px-2 py-0.5 text-xs">
                {filteredEntries.length} Records
              </Badge>
            </div>
            <CardDescription className="text-xs mt-0.5">
              Live ledger entries fetched from <code className="text-[11px] bg-muted px-1 py-0.5 rounded">GET /api/ledger/</code>
            </CardDescription>
          </div>

          {/* Search and Filters */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="relative w-full sm:w-48">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search memo..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>

            <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-lg border border-border">
              {(['all', 'unmatched', 'matched'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setFilterMatched(tab)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition ${
                    filterMatched === tab
                      ? 'bg-background text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {tab === 'all'
                    ? 'All'
                    : tab === 'unmatched'
                    ? 'Available (Unmatched)'
                    : 'Matched'}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="py-12 flex flex-col items-center justify-center text-muted-foreground">
              <Loader2 className="h-7 w-7 animate-spin mb-2 text-primary" />
              <p className="text-sm font-medium">Loading ledger transactions...</p>
            </div>
          ) : filteredEntries.length === 0 ? (
            <div className="py-14 px-4 text-center">
              <Landmark className="h-9 w-9 text-muted-foreground/50 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground">No bank transactions found</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {searchTerm || filterMatched !== 'all'
                  ? 'Try clearing your filter or search query.'
                  : 'Add a new bank transaction above.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="w-16">ID</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Received Amount</TableHead>
                    <TableHead className="min-w-[220px]">Description / Memo</TableHead>
                    <TableHead>Matching Status</TableHead>
                    <TableHead>Matched Invoice</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((entry) => (
                    <TableRow key={entry.id} className="hover:bg-muted/30">
                      <TableCell className="font-mono text-xs font-semibold">
                        #{String(entry.id).padStart(3, '0')}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatDate(entry.transaction_date)}
                      </TableCell>
                      <TableCell className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(entry.received_amount)}
                      </TableCell>
                      <TableCell className="text-xs font-medium text-foreground">
                        {entry.description}
                      </TableCell>
                      <TableCell>
                        {entry.is_matched ? (
                          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30 gap-1 font-medium">
                            <CheckCircle2 className="h-3 w-3" /> Matched
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/30 gap-1 font-medium bg-amber-500/10">
                            <Clock className="h-3 w-3" /> Available
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        {entry.matched_invoice_id ? (
                          <span className="font-medium text-primary">
                            #INV-{String(entry.matched_invoice_id).padStart(3, '0')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
