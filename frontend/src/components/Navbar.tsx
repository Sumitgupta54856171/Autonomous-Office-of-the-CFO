import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  FileSpreadsheet,
  LayoutDashboard,
  FileText,
  Landmark,
  History,
  Menu,
  X,
  CircleDot,
} from 'lucide-react'
import { UserButton } from '@clerk/clerk-react'
import { checkHealth } from '../services/api'
import { Badge } from '@/components/ui/badge'

interface NavbarProps {
  showUserButton?: boolean
}

export function Navbar({ showUserButton = false }: NavbarProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null)

  useEffect(() => {
    let mounted = true
    async function verifyBackend() {
      try {
        const health = await checkHealth()
        if (mounted) setBackendOnline(health.status === 'ok')
      } catch {
        if (mounted) setBackendOnline(false)
      }
    }
    verifyBackend()
    const interval = setInterval(verifyBackend, 15000)
    return () => {
      mounted = false
      clearInterval(interval)
    }
  }, [])

  const navLinks = [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/invoices', label: 'Invoices', icon: FileText },
    { to: '/ledger', label: 'Bank Ledger', icon: Landmark },
    { to: '/history', label: 'History', icon: History },
  ]

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 bg-background/95 backdrop-blur-md supports-backdrop-filter:bg-background/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Brand Logo & Name */}
          <div className="flex items-center gap-3">
            <NavLink to="/" className="flex items-center gap-2.5 transition hover:opacity-90">
              <div className="h-9 w-9 rounded-xl bg-primary flex items-center justify-center text-primary-foreground shadow-sm">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold tracking-tight text-foreground">AutoCFO</span>
                  <Badge variant="outline" className="hidden sm:inline-flex text-[10px] uppercase tracking-wider py-0 px-1.5 font-semibold">
                    Autonomous CFO
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground hidden md:block">
                  AI Autonomous Reconciliation & Co-pilot
                </p>
              </div>
            </NavLink>
          </div>

          {/* Desktop Navigation Links */}
          <nav className="hidden md:flex items-center gap-1.5">
            {navLinks.map((link) => {
              const Icon = link.icon
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-primary text-primary-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/70'
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </NavLink>
              )
            })}
          </nav>

          {/* Right Section: System Status & Mobile Trigger */}
          <div className="flex items-center gap-2.5">
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-border bg-muted/40">
              <CircleDot
                className={`h-3 w-3 ${
                  backendOnline === true
                    ? 'text-emerald-500 animate-pulse'
                    : backendOnline === false
                    ? 'text-rose-500'
                    : 'text-amber-500'
                }`}
              />
              <span className="text-muted-foreground">
                {backendOnline === true
                  ? 'FastAPI Connected'
                  : backendOnline === false
                  ? 'API Disconnected'
                  : 'Checking...'}
              </span>
            </div>

            {showUserButton && (
              <div className="flex items-center ml-1">
                <UserButton />
              </div>
            )}

            {/* Mobile Hamburger Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted focus:outline-none"
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Nav Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-border/50 py-3 space-y-1">
            {navLinks.map((link) => {
              const Icon = link.icon
              return (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition ${
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                    }`
                  }
                >
                  <Icon className="h-4 w-4" />
                  {link.label}
                </NavLink>
              )
            })}
            <div className="pt-2 px-3 flex items-center gap-1.5 text-xs text-muted-foreground sm:hidden">
              <CircleDot
                className={`h-3 w-3 ${
                  backendOnline ? 'text-emerald-500' : 'text-rose-500'
                }`}
              />
              <span>{backendOnline ? 'FastAPI Connected' : 'API Disconnected'}</span>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
