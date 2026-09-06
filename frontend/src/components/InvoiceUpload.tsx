import { useState, useRef, useEffect } from 'react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  UploadCloud,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Sparkles,
  Bot,
} from 'lucide-react'
import { uploadInvoiceFile, getTaskStatus } from '../services/api'
import type { TaskStatusResponse } from '../types'

interface InvoiceUploadProps {
  onUploadSuccess: () => void
}

export function InvoiceUpload({ onUploadSuccess }: InvoiceUploadProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null)
  const [taskState, setTaskState] = useState<TaskStatusResponse | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollCountRef = useRef<number>(0)

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current)
      }
    }
  }, [])

  // Poll task status every 2 seconds until terminal state with 80s safety timeout
  const startPolling = (taskId: string) => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current)
    pollCountRef.current = 0

    pollingIntervalRef.current = setInterval(async () => {
      pollCountRef.current += 1
      if (pollCountRef.current > 40) {
        // 80 seconds timeout reached
        if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current)
        setUploading(false)
        setErrorMessage('Extraction timed out. The document may still be processing in the background.')
        return
      }

      try {
        const status = await getTaskStatus(taskId)
        setTaskState(status)

        if (status.status === 'SUCCESS') {
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current)
          setUploading(false)
          // Trigger parent invoice list refresh
          onUploadSuccess()
        } else if (status.status === 'FAILURE') {
          if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current)
          setUploading(false)
          setErrorMessage(status.error || 'AI Extraction task failed.')
        }
      } catch (err: unknown) {
        console.error('Polling error:', err)
        // Keep polling for network blips unless timeout is reached
      }
    }, 2000)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      validateAndSetFile(e.target.files[0])
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      validateAndSetFile(e.dataTransfer.files[0])
    }
  }

  const validateAndSetFile = (file: File) => {
    setErrorMessage(null)
    setTaskState(null)
    const validExtensions = ['.pdf', '.png', '.jpg', '.jpeg']
    const ext = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!validExtensions.includes(ext)) {
      setErrorMessage('Please select a valid PDF, PNG, or JPG invoice document.')
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      setErrorMessage('File size exceeds 15MB limit.')
      return
    }
    setSelectedFile(file)
  }

  const handleUploadAndExtract = async () => {
    if (!selectedFile) return
    setUploading(true)
    setErrorMessage(null)
    setTaskState(null)

    try {
      const response = await uploadInvoiceFile(selectedFile)
      setActiveTaskId(response.task_id)
      setTaskState({
        task_id: response.task_id,
        status: 'PENDING',
        message: 'Invoice queued in RabbitMQ. Waiting for Celery worker...',
      })
      // Start polling status every 2 seconds
      startPolling(response.task_id)
    } catch (err: unknown) {
      setUploading(false)
      setErrorMessage(err instanceof Error ? err.message : 'Upload failed.')
    }
  }

  const resetUpload = () => {
    if (pollingIntervalRef.current) clearInterval(pollingIntervalRef.current)
    setSelectedFile(null)
    setActiveTaskId(null)
    setTaskState(null)
    setErrorMessage(null)
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <Card className="shadow-sm border-indigo-200/70 dark:border-indigo-900/50 bg-gradient-to-br from-indigo-50/20 via-background to-background">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-md bg-indigo-500/10 text-indigo-600 dark:text-indigo-400">
              <Sparkles className="h-4 w-4" />
            </div>
            <CardTitle className="text-base font-bold">
              Asynchronous AI Invoice Vision Extraction
            </CardTitle>
          </div>
          <Badge variant="outline" className="text-[10px] uppercase font-semibold text-indigo-700 dark:text-indigo-300 border-indigo-300">
            Celery + RabbitMQ + PyMuPDF
          </Badge>
        </div>
        <CardDescription className="text-xs">
          Upload any PDF invoice or image receipt. The document is queued in RabbitMQ, parsed with PyMuPDF, and structured by GPT-4o Vision into PostgreSQL with status <code className="text-[11px] font-semibold text-primary">'pending'</code>.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Upload Zone */}
        {!uploading && (!taskState || taskState.status !== 'SUCCESS') && (
          <div>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setDragOver(true)
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                dragOver
                  ? 'border-indigo-500 bg-indigo-50/50 dark:bg-indigo-950/30'
                  : selectedFile
                  ? 'border-indigo-300 bg-indigo-50/20 dark:bg-zinc-900/50'
                  : 'border-border/80 hover:border-indigo-400 hover:bg-muted/40'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={handleFileChange}
                className="hidden"
              />

              {selectedFile ? (
                <div className="flex items-center justify-between max-w-md mx-auto p-2 bg-background rounded-lg border border-border">
                  <div className="flex items-center gap-3 text-left">
                    <FileText className="h-7 w-7 text-indigo-500 shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-foreground truncate max-w-[220px]">
                        {selectedFile.name}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {(selectedFile.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      resetUpload()
                    }}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center space-y-2">
                  <div className="p-3 rounded-full bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400">
                    <UploadCloud className="h-6 w-6" />
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs font-semibold text-foreground">
                      Click to upload invoice or drag and drop
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Supports PDF, PNG, JPG (up to 15MB)
                    </p>
                  </div>
                </div>
              )}
            </div>

            {selectedFile && (
              <div className="flex justify-end mt-3">
                <Button
                  onClick={handleUploadAndExtract}
                  disabled={uploading}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 text-xs font-semibold h-9"
                >
                  <Bot className="h-4 w-4" />
                  Extract with AI Vision
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Polling & Processing State */}
        {uploading && (
          <div className="p-6 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/30 dark:bg-indigo-950/20 text-center space-y-3">
            <div className="flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-foreground">
                Asynchronous Extraction in Progress
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {taskState?.message || 'Queued in RabbitMQ and executing in Celery worker...'}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                Task ID: {activeTaskId}
              </Badge>
              <Badge className="bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-300 text-[10px] animate-pulse">
                {taskState?.status || 'PENDING'}
              </Badge>
            </div>
            <div className="pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={resetUpload}
                className="text-xs text-muted-foreground hover:text-foreground h-7"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Success State */}
        {taskState?.status === 'SUCCESS' && taskState.result && (
          <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-950/20 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                <div>
                  <h4 className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                    AI Vision Extraction Complete!
                  </h4>
                  <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80">
                    {(taskState.result.total_extracted && taskState.result.total_extracted > 1) || (taskState.result.invoices && taskState.result.invoices.length > 1)
                      ? `Detected and saved ${taskState.result.total_extracted || taskState.result.invoices?.length} invoices across all document pages into PostgreSQL with status='pending'.`
                      : "Invoice saved to PostgreSQL with status='pending'. Ready for reconciliation."}
                  </p>
                </div>
              </div>
              <Button size="xs" variant="outline" onClick={resetUpload} className="text-xs">
                Upload Another
              </Button>
            </div>

            {/* Multi-invoice Batch Table */}
            {taskState.result.invoices && taskState.result.invoices.length > 1 ? (
              <div className="border border-border/80 rounded-lg overflow-hidden bg-background">
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-muted/60 text-muted-foreground uppercase text-[10px] font-semibold sticky top-0">
                      <tr>
                        <th className="px-3 py-2">Invoice ID</th>
                        <th className="px-3 py-2">Vendor Name</th>
                        <th className="px-3 py-2">Amount</th>
                        <th className="px-3 py-2">Due Date</th>
                        <th className="px-3 py-2">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {taskState.result.invoices.map((inv) => (
                        <tr key={inv.invoice_id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-3 py-2 font-mono font-bold text-foreground">
                            #INV-{inv.invoice_id}
                          </td>
                          <td className="px-3 py-2 font-medium text-foreground truncate max-w-[180px]">
                            {inv.vendor_name}
                          </td>
                          <td className="px-3 py-2 font-bold text-emerald-600">
                            ${Number(inv.amount).toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{inv.due_date}</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-600 border-amber-300">
                              {inv.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="px-3 py-2 bg-muted/40 border-t border-border/60 flex items-center justify-between text-xs font-semibold">
                  <span className="text-muted-foreground">
                    Total Invoices Extracted: {taskState.result.invoices.length}
                  </span>
                  <span className="text-emerald-700 dark:text-emerald-400 font-bold">
                    Batch Total: $
                    {taskState.result.invoices
                      .reduce((sum, inv) => sum + Number(inv.amount || 0), 0)
                      .toFixed(2)}
                  </span>
                </div>
              </div>
            ) : (
              /* Single Invoice Summary Card */
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-1 text-xs">
                <div className="p-2 bg-background rounded-md border border-border">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">Invoice ID</span>
                  <p className="font-mono font-bold text-foreground">
                    #INV-{taskState.result.invoice_id ?? taskState.result.invoices?.[0]?.invoice_id ?? '—'}
                  </p>
                </div>
                <div className="p-2 bg-background rounded-md border border-border">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">Vendor Name</span>
                  <p className="font-bold text-foreground truncate">
                    {taskState.result.vendor_name ?? taskState.result.invoices?.[0]?.vendor_name ?? '—'}
                  </p>
                </div>
                <div className="p-2 bg-background rounded-md border border-border">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">Amount</span>
                  <p className="font-bold text-emerald-600">
                    ${Number(taskState.result.amount ?? taskState.result.invoices?.[0]?.amount ?? 0).toFixed(2)}
                  </p>
                </div>
                <div className="p-2 bg-background rounded-md border border-border">
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">Due Date</span>
                  <p className="font-bold text-foreground">
                    {taskState.result.due_date ?? taskState.result.invoices?.[0]?.due_date ?? '—'}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error State */}
        {errorMessage && (
          <div className="p-3 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-rose-50/40 dark:bg-rose-950/20 flex items-start justify-between gap-3 text-xs text-rose-800 dark:text-rose-200">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="text-xs opacity-70 hover:opacity-100">
              ✕
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
