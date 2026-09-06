import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { SignedIn, SignedOut, SignInButton, useAuth } from '@clerk/clerk-react'
import { Navbar } from './components/Navbar'
import { DashboardPage } from './pages/DashboardPage'
import { InvoicesPage } from './pages/InvoicesPage'
import { LedgerPage } from './pages/LedgerPage'
import { HistoryPage } from './pages/HistoryPage'
import { Button } from './components/ui/button'
import { Badge } from './components/ui/badge'
import { FileSpreadsheet, Lock, ShieldCheck, ArrowRight, Sparkles } from 'lucide-react'
import { setAuthTokenGetter } from './services/api'

interface AppProps {
  isClerkConfigured?: boolean
}

// Authenticated layout shared by SignedIn or Standalone mode
function AuthenticatedLayout({ showUserButton }: { showUserButton: boolean }) {
  return (
    <div className="min-h-screen bg-slate-50/70 dark:bg-zinc-950 font-sans antialiased text-foreground flex flex-col selection:bg-indigo-500 selection:text-white">
      {/* Modern Navigation Bar */}
      <Navbar showUserButton={showUserButton} />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/invoices" element={<InvoicesPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* CFO Footer */}
      <footer className="border-t border-border/60 bg-background/50 py-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-foreground">AutoCFO</span>
            <span>•</span>
            <span>Autonomous Office of the CFO</span>
            <span>•</span>
            <span className="text-primary font-medium">Syndicate Hackathon Track 2</span>
          </div>
          <div>
            <span>Backend API: </span>
            <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-[11px] text-foreground">
              http://localhost:8000
            </code>
          </div>
        </div>
      </footer>
    </div>
  )
}

// Unauthenticated landing page with Clerk Sign In Trigger
function UnauthenticatedView() {
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Subtle background glow */}
      <div className="absolute -top-40 -left-40 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />

      <div className="max-w-md w-full text-center space-y-6 relative z-10">
        <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-indigo-600 text-white shadow-xl shadow-indigo-500/30">
          <FileSpreadsheet className="h-8 w-8" />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Badge variant="outline" className="border-indigo-400/40 text-indigo-300 text-xs py-0.5 px-2">
              Track 2: Autonomous Office of the CFO
            </Badge>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight">AutoCFO Enterprise</h1>
          <p className="text-sm text-slate-400">
            Autonomous invoice reconciliation, AI vision extraction, and human-in-the-loop exception handling.
          </p>
        </div>

        <div className="p-6 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-2xl backdrop-blur-md space-y-4">
          <div className="flex items-center justify-center gap-2 text-xs text-indigo-300 font-medium">
            <Lock className="h-4 w-4" />
            <span>Protected by Clerk Enterprise Authentication</span>
          </div>

          <SignInButton mode="modal">
            <Button className="w-full h-11 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm shadow-lg shadow-indigo-600/30 gap-2">
              <span>Sign In to Access Dashboard</span>
              <ArrowRight className="h-4 w-4" />
            </Button>
          </SignInButton>

          <div className="flex items-center justify-center gap-4 text-[11px] text-slate-500 pt-2 border-t border-slate-800">
            <span className="flex items-center gap-1">
              <ShieldCheck className="h-3 w-3 text-emerald-400" /> RS256 JWT
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-amber-400" /> RabbitMQ Celery
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// Clerk Authentication Hook bridge
function ClerkAuthBridge() {
  const { getToken } = useAuth()

  useEffect(() => {
    setAuthTokenGetter(getToken)
  }, [getToken])

  return (
    <>
      <SignedIn>
        <AuthenticatedLayout showUserButton={true} />
      </SignedIn>
      <SignedOut>
        <UnauthenticatedView />
      </SignedOut>
    </>
  )
}

export default function App({ isClerkConfigured = false }: AppProps) {
  return (
    <BrowserRouter>
      {isClerkConfigured ? (
        <ClerkAuthBridge />
      ) : (
        <AuthenticatedLayout showUserButton={false} />
      )}
    </BrowserRouter>
  )
}
