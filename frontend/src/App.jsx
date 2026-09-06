import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Navbar } from './components/Navbar'
import { DashboardPage } from './pages/DashboardPage'
import { InvoicesPage } from './pages/InvoicesPage'
import { LedgerPage } from './pages/LedgerPage'
import { HistoryPage } from './pages/HistoryPage'

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50/70 dark:bg-zinc-950 font-sans antialiased text-foreground flex flex-col selection:bg-indigo-500 selection:text-white">
        {/* Navigation Bar */}
        <Navbar />

        {/* Main Content View */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/invoices" element={<InvoicesPage />} />
            <Route path="/ledger" element={<LedgerPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>

        {/* Footer */}
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
    </BrowserRouter>
  )
}
