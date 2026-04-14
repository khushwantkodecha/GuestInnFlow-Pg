import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, BedDouble, Users, Wallet,
  MoreHorizontal, Building2, CreditCard, FileText,
  Bell, Receipt, BookOpen, BarChart3, Settings,
  LogOut, X, Home, LayoutGrid, ChevronDown, Check,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useProperty } from '../../context/PropertyContext'

// ── Primary tabs (always visible in bar) ──────────────────────────────────────
const BAR_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/rooms',     label: 'Rooms',     icon: BedDouble        },
  { to: '/tenants',   label: 'Tenants',   icon: Users            },
  { to: '/billing',   label: 'Payments',  icon: Wallet           },
]

// ── Secondary items (shown in the More sheet) ─────────────────────────────────
const MORE_ITEMS = [
  { to: '/properties', label: 'Properties', icon: Building2  },
  { to: '/rent',       label: 'Rent',       icon: CreditCard },
  { to: '/invoices',   label: 'Invoices',   icon: FileText   },
  { to: '/reminders',  label: 'Reminders',  icon: Bell       },
  { to: '/expenses',   label: 'Expenses',   icon: Receipt    },
  { to: '/accounting', label: 'Accounting', icon: BookOpen   },
  { to: '/reports',    label: 'Reports',    icon: BarChart3  },
  { to: '/settings',   label: 'Settings',   icon: Settings   },
]

// ── Property selector inside More sheet ───────────────────────────────────────
const SheetPropertySelector = ({ onClose }) => {
  const { properties, selectedProperty, isAllProperties, setSelectedProperty } = useProperty()
  const [open, setOpen] = useState(false)

  if (!properties.length) return null

  const displayName = isAllProperties ? 'All Properties' : (selectedProperty?.name ?? 'Select property')

  return (
    <div className="px-4 py-3 border-b border-slate-100">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Property</p>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 transition-colors hover:bg-slate-100"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-6 w-6 items-center justify-center rounded-md shrink-0" style={{ background: 'rgba(96,195,173,0.12)', color: '#60C3AD' }}>
            {isAllProperties ? <LayoutGrid size={11} /> : <Home size={11} />}
          </div>
          <span className="text-[13px] font-semibold text-slate-700 truncate">{displayName}</span>
        </div>
        <ChevronDown size={13} className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-1.5 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          <button
            onClick={() => { setSelectedProperty(null); setOpen(false) }}
            className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-[13px] font-medium border-b border-slate-100 transition-colors hover:bg-slate-50
              ${isAllProperties ? 'text-emerald-600 bg-emerald-50/60' : 'text-slate-600'}`}
          >
            <div className="flex items-center gap-2 min-w-0">
              <LayoutGrid size={12} className="shrink-0 text-slate-400" />
              <span className="truncate italic">All Properties</span>
            </div>
            {isAllProperties && <Check size={12} style={{ color: '#60C3AD' }} className="shrink-0" />}
          </button>
          {properties.map(p => {
            const active = !isAllProperties && selectedProperty?._id === p._id
            return (
              <button
                key={p._id}
                onClick={() => { setSelectedProperty(p); setOpen(false) }}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors hover:bg-slate-50
                  ${active ? 'text-emerald-600 bg-emerald-50/60' : 'text-slate-600'}`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                  <span className="truncate">{p.name}</span>
                </div>
                {active && <Check size={12} style={{ color: '#60C3AD' }} className="shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── BottomNav ─────────────────────────────────────────────────────────────────
const BottomNav = () => {
  const [moreOpen,       setMoreOpen]       = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const { logout } = useAuth()
  const navigate   = useNavigate()

  const closeMore   = ()  => setMoreOpen(false)
  const handleLogout = () => { logout(); navigate('/login') }

  return (
    <>
      {/* ── Bar ─────────────────────────────────────────────────────────────── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden flex items-stretch bg-white border-t border-slate-200"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {BAR_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-[3px] pt-2 pb-1.5 text-[10px] font-semibold transition-colors select-none ${
                isActive ? 'text-primary-600' : 'text-slate-400'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span className={`flex h-6 w-6 items-center justify-center rounded-lg transition-colors ${
                  isActive ? 'bg-primary-100' : ''
                }`}>
                  <Icon size={18} strokeWidth={isActive ? 2.5 : 1.8} />
                </span>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}

        {/* More tab */}
        <button
          onClick={() => setMoreOpen(true)}
          className={`flex-1 flex flex-col items-center justify-center gap-[3px] pt-2 pb-1.5 text-[10px] font-semibold transition-colors select-none ${
            moreOpen ? 'text-primary-600' : 'text-slate-400'
          }`}
        >
          <span className={`flex h-6 w-6 items-center justify-center rounded-lg transition-colors ${
            moreOpen ? 'bg-primary-100' : ''
          }`}>
            <MoreHorizontal size={18} strokeWidth={moreOpen ? 2.5 : 1.8} />
          </span>
          <span>More</span>
        </button>
      </nav>

      {/* ── More sheet ──────────────────────────────────────────────────────── */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
            onClick={closeMore}
          />
          <div
            className="fixed left-0 right-0 bottom-0 z-50 md:hidden bg-white rounded-t-2xl shadow-2xl bn-sheet"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* Handle + header */}
            <div className="flex items-center justify-between px-5 pt-3.5 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg shrink-0" style={{ background: 'rgba(96,195,173,0.12)', border: '1px solid rgba(96,195,173,0.22)' }}>
                  <Building2 size={13} style={{ color: '#60C3AD' }} />
                </div>
                <div>
                  <p className="text-[13px] font-bold text-slate-800 leading-none">GuestInnFlow</p>
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 mt-0.5">PG Management</p>
                </div>
              </div>
              <button
                onClick={closeMore}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* Property selector */}
            <SheetPropertySelector onClose={closeMore} />

            {/* Nav grid */}
            <div className="grid grid-cols-4 gap-1 px-3 py-3">
              {MORE_ITEMS.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  onClick={closeMore}
                  className={({ isActive }) =>
                    `flex flex-col items-center gap-1.5 rounded-xl px-1 py-3 transition-colors ${
                      isActive
                        ? 'bg-primary-50 text-primary-600'
                        : 'text-slate-500 active:bg-slate-100'
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={20} strokeWidth={isActive ? 2.5 : 1.8} />
                      <span className="text-[10px] font-semibold text-center leading-tight">{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>

            {/* Sign out */}
            <div className="px-4 pb-4 pt-1 border-t border-slate-100">
              <button
                onClick={() => { closeMore(); setConfirmSignOut(true) }}
                className="w-full flex items-center gap-3 rounded-xl px-4 py-3 text-slate-500 hover:bg-red-50 hover:text-red-500 transition-colors"
              >
                <LogOut size={17} />
                <span className="text-sm font-semibold">Sign out</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Sign-out confirmation ──────────────────────────────────────────── */}
      {confirmSignOut && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 md:hidden"
          style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-xl p-6 space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3.5">
              <LogOut size={18} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-red-700">Sign out?</p>
                <p className="text-xs text-red-600/80 mt-1 leading-relaxed">You'll be returned to the login screen.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                onClick={() => setConfirmSignOut(false)}
              >
                Cancel
              </button>
              <button
                className="flex-1 rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 transition-colors"
                onClick={handleLogout}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Scoped styles ─────────────────────────────────────────────────── */}
      <style>{`
        .bn-sheet {
          animation: bn-slide-up 0.22s cubic-bezier(0.32, 0.72, 0, 1) both;
        }
        @keyframes bn-slide-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0);    }
        }
      `}</style>
    </>
  )
}

export default BottomNav
