import { useState, useEffect } from "react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  XCircle,
  RefreshCw,
  AlertTriangle,
  FileSpreadsheet,
  ArrowUpRight,
  Loader2,
  ShieldCheck,
} from "lucide-react";

interface Invoice {
  id: number;
  vendor_name: string;
  amount: number;
  due_date: string;
  status: string;
  matched_ledger_id?: number | null;
  resolution_notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface BannerNotification {
  type: "success" | "destructive";
  message: string;
}

const API_BASE_URL = "http://localhost:8000";

export default function App() {
  const [exceptions, setExceptions] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [notification, setNotification] = useState<BannerNotification | null>(null);

  // Fetch pending exceptions from the backend API
  const fetchExceptions = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/exceptions/`);
      if (!response.ok) {
        throw new Error(`Failed to fetch exceptions: ${response.status} ${response.statusText}`);
      }
      const data: Invoice[] = await response.json();
      setExceptions(data);
      setError(null);
    } catch (err: unknown) {
      console.error("Error fetching exceptions:", err);
      const errorMessage =
        err instanceof Error ? err.message : "Failed to connect to AutoCFO backend server.";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleManualRefresh = () => {
    setLoading(true);
    fetchExceptions();
  };

  useEffect(() => {
    fetchExceptions();
  }, []);

  // Handle human review resolution (Approve as 'paid' or Reject as 'rejected')
  const handleResolve = async (id: number, action: "approve" | "reject") => {
    setProcessingId(id);
    const targetAction = action === "approve" ? "paid" : "rejected";
    const notes =
      targetAction === "paid"
        ? "Approved by CFO human reviewer via dashboard"
        : "Rejected by CFO human reviewer via dashboard";

    try {
      const response = await fetch(`${API_BASE_URL}/api/exceptions/${id}/resolve`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: targetAction,
          notes: notes,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Failed to resolve exception (${response.status})`);
      }

      // Optimistically update the UI by removing the resolved row
      setExceptions((prev) => prev.filter((item) => item.id !== id));

      // Show temporary notification
      setNotification({
        type: targetAction === "paid" ? "success" : "destructive",
        message: `Invoice #${id} has been marked as ${targetAction.toUpperCase()}.`,
      });

      setTimeout(() => {
        setNotification(null);
      }, 4000);
    } catch (err: unknown) {
      console.error("Resolution error:", err);
      const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred.";
      alert(`Error resolving invoice: ${errorMessage}`);
    } finally {
      setProcessingId(null);
    }
  };

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  // Format date
  const formatDate = (dateStr: string) => {
    if (!dateStr) return "N/A";
    const [year, month, day] = dateStr.split("-");
    return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Calculate total exception amount
  const totalExceptionAmount = exceptions.reduce((sum, inv) => sum + (inv.amount || 0), 0);

  return (
    <div className="min-h-screen bg-slate-50/60 dark:bg-zinc-950 p-4 sm:p-6 md:p-10 font-sans antialiased text-foreground">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Top Branding & Status Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
              <FileSpreadsheet className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight">AutoCFO</h1>
                <Badge variant="outline" className="text-[11px] font-semibold tracking-wide uppercase px-2 py-0.5">
                  Track 2: Autonomous Office of the CFO
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Autonomous Invoice Reconciliation & Human-in-the-Loop Co-pilot
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleManualRefresh}
              disabled={loading}
              className="gap-2 w-full sm:w-auto text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              Refresh Queue
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => window.open("http://localhost:8000/docs", "_blank")}
              className="gap-1.5 text-xs hidden sm:flex"
            >
              API Docs
              <ArrowUpRight className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Temporary Banner Notification */}
        {notification && (
          <div
            className={`p-3 rounded-lg text-xs font-medium flex items-center justify-between transition-all shadow-sm ${
              notification.type === "success"
                ? "bg-emerald-50 border border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-900/60 dark:text-emerald-300"
                : "bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/40 dark:border-red-900/60 dark:text-red-300"
            }`}
          >
            <div className="flex items-center gap-2">
              {notification.type === "success" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
              )}
              <span>{notification.message}</span>
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-xs hover:opacity-75 font-semibold px-1"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Metric Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="p-4 bg-white dark:bg-zinc-900 shadow-xs border-border/80">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Pending Exceptions
                </p>
                <h3 className="text-2xl font-bold mt-1 tracking-tight">
                  {loading ? "..." : exceptions.length}
                </h3>
              </div>
              <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-5 w-5" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Requires CFO / Human review intervention
            </p>
          </Card>

          <Card className="p-4 bg-white dark:bg-zinc-900 shadow-xs border-border/80">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Amount Under Review
                </p>
                <h3 className="text-2xl font-bold mt-1 tracking-tight">
                  {loading ? "..." : formatCurrency(totalExceptionAmount)}
                </h3>
              </div>
              <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Unmatched or partial payments held in escrow
            </p>
          </Card>

          <Card className="p-4 bg-white dark:bg-zinc-900 shadow-xs border-border/80">
            <div className="flex justify-between items-start">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Autonomous Reconciler
                </p>
                <h3 className="text-2xl font-bold mt-1 tracking-tight flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  Active
                </h3>
              </div>
              <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="h-5 w-5" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              Agent auto-routes high-confidence matches to Paid
            </p>
          </Card>
        </div>

        {/* Main Card: AutoCFO Exception Dashboard */}
        <Card className="bg-white dark:bg-zinc-900 shadow-sm border-border/80">
          <CardHeader className="border-b border-border/60 pb-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg font-semibold tracking-tight">
                    AutoCFO Exception Dashboard
                  </CardTitle>
                  <Badge variant="secondary" className="text-xs font-medium">
                    {exceptions.length} {exceptions.length === 1 ? "Item" : "Items"}
                  </Badge>
                </div>
                <CardDescription className="text-xs text-muted-foreground mt-1">
                  Invoices flagged by the AI Agent due to partial payments, missing bank ledger records,
                  or billing discrepancies.
                </CardDescription>
              </div>

              <div className="text-xs text-muted-foreground bg-muted/40 px-3 py-1.5 rounded-md border border-border/50 self-start sm:self-auto">
                Human-in-the-Loop Mode
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            {/* Loading State */}
            {loading && (
              <div className="p-12 flex flex-col items-center justify-center text-center space-y-3">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
                <p className="text-sm font-medium">Fetching pending exceptions from AutoCFO...</p>
                <p className="text-xs text-muted-foreground">Connecting to localhost:8000/api/exceptions/</p>
              </div>
            )}

            {/* Error State */}
            {!loading && error && (
              <div className="p-8 flex flex-col items-center justify-center text-center space-y-3">
                <div className="h-10 w-10 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold">Unable to Load Exceptions</h4>
                  <p className="text-xs text-muted-foreground max-w-md mt-1">{error}</p>
                </div>
                <Button size="sm" variant="outline" onClick={handleManualRefresh} className="gap-2 text-xs mt-2">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Try Again
                </Button>
              </div>
            )}

            {/* Empty State: No exceptions found */}
            {!loading && !error && exceptions.length === 0 && (
              <div className="p-12 flex flex-col items-center justify-center text-center space-y-3">
                <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <h4 className="text-base font-semibold">All Exceptions Cleared!</h4>
                  <p className="text-xs text-muted-foreground max-w-sm mt-1">
                    There are currently no invoices flagged for human intervention. All pending records have
                    been reconciled or resolved.
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={handleManualRefresh} className="gap-2 text-xs mt-2">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Check for New Invoices
                </Button>
              </div>
            )}

            {/* Exceptions Table */}
            {!loading && !error && exceptions.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b border-border/60">
                    <TableHead className="w-[120px] font-semibold text-xs uppercase tracking-wider">
                      Invoice ID
                    </TableHead>
                    <TableHead className="font-semibold text-xs uppercase tracking-wider">
                      Vendor
                    </TableHead>
                    <TableHead className="w-[140px] font-semibold text-xs uppercase tracking-wider">
                      Amount
                    </TableHead>
                    <TableHead className="w-[130px] font-semibold text-xs uppercase tracking-wider">
                      Due Date
                    </TableHead>
                    <TableHead className="w-[200px] font-semibold text-xs uppercase tracking-wider">
                      Status
                    </TableHead>
                    <TableHead className="w-[180px] text-right font-semibold text-xs uppercase tracking-wider pr-4">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {exceptions.map((invoice) => {
                    const isProcessing = processingId === invoice.id;
                    return (
                      <TableRow key={invoice.id} className="transition-colors hover:bg-muted/40">
                        {/* Invoice ID */}
                        <TableCell className="font-mono text-xs font-semibold text-foreground/90">
                          #INV-{String(invoice.id).padStart(4, "0")}
                        </TableCell>

                        {/* Vendor Name & AI Flag Diagnostic */}
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="font-medium text-sm text-foreground">
                              {invoice.vendor_name}
                            </span>
                            {invoice.resolution_notes && (
                              <span className="text-[11px] text-muted-foreground line-clamp-1 max-w-md">
                                {invoice.resolution_notes}
                              </span>
                            )}
                          </div>
                        </TableCell>

                        {/* Amount */}
                        <TableCell className="font-mono text-sm font-semibold text-foreground">
                          {formatCurrency(invoice.amount)}
                        </TableCell>

                        {/* Due Date */}
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(invoice.due_date)}
                        </TableCell>

                        {/* Status (shadcn Badge) */}
                        <TableCell>
                          <Badge
                            variant="destructive"
                            className="bg-amber-50 text-amber-700 border border-amber-200/80 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60 font-medium text-[11px] gap-1 px-2 py-0.5"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            {invoice.status === "exception_human_review"
                              ? "exception_human_review"
                              : invoice.status}
                          </Badge>
                        </TableCell>

                        {/* Actions (Approve / Reject Buttons) */}
                        <TableCell className="text-right pr-4">
                          <div className="flex items-center justify-end gap-2">
                            {/* Approve Button */}
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isProcessing}
                              onClick={() => handleResolve(invoice.id, "approve")}
                              className="h-7 text-xs gap-1 border-emerald-300 text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 dark:border-emerald-800 dark:text-emerald-400 dark:hover:bg-emerald-950/50"
                            >
                              {isProcessing ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                              )}
                              Approve
                            </Button>

                            {/* Reject Button (Destructive Variant) */}
                            <Button
                              variant="destructive"
                              size="sm"
                              disabled={isProcessing}
                              onClick={() => handleResolve(invoice.id, "reject")}
                              className="h-7 text-xs gap-1"
                            >
                              {isProcessing ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <XCircle className="h-3 w-3" />
                              )}
                              Reject
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>

          {/* Footer with helpful instructions */}
          <CardFooter className="border-t border-border/60 bg-muted/20 px-4 py-3 flex flex-col sm:flex-row items-center justify-between text-xs text-muted-foreground gap-2">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
              <span>
                {exceptions.length > 0
                  ? `${exceptions.length} invoice(s) awaiting CFO review`
                  : "Queue is fully synchronized"}
              </span>
            </div>
            <div className="text-[11px]">
              Click <strong className="text-foreground font-medium">Approve</strong> to mark as paid or{" "}
              <strong className="text-destructive font-medium">Reject</strong> to dispute.
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
