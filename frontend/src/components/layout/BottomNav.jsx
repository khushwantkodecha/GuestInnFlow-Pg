import { useState, useCallback, memo } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, BedDouble, Users, CreditCard,
  MoreHorizontal, Building2, Settings,
  LogOut, X, Home, ChevronDown, Check,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useProperty } from '../../context/PropertyContext'

const BAR_ITEMS = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/rooms',     label: 'Rooms',     icon: BedDouble        },
  { to: '/tenants',   label: 'Tenants',   icon: Users            },
  { to: '/rent',      label: 'Rent',      icon: CreditCard       },
]

const MORE_ITEMS = [
  { to: '/properties', label: 'Properties', icon: Building2 },
  { to: '/settings',   label: 'Settings',   icon: Settings  },
]

// ── Property selector inside More sheet ───────────────────────────────────────
const SheetPropertySelector = () => {
  const { properties, selectedProperty, setSelectedProperty } = useProperty()
  const [open, setOpen] = useState(false)

  if (!properties.length) return null

  return (
    <div className="px-4 pb-3">
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Property</p>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 transition-colors active:bg-slate-100"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-6 w-6 items-center justify-center rounded-lg shrink-0 bg-primary-50">
            <Home size={12} className="text-primary-500" />
          </div>
          <span className="text-sm font-semibold text-slate-700 truncate">
            {selectedProperty?.name ?? 'Select property'}
          </span>
        </div>
        <ChevronDown size={13} className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-1.5 rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
          {properties.map(p => {
            const active = selectedProperty?._id === p._id
            return (
              <button
                key={p._id}
                onClick={() => { setSelectedProperty(p); setOpen(false) }}
                className={`w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
                  active ? 'text-primary-600 bg-primary-50/60' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-primary-400' : 'bg-slate-300'}`} />
                  <span className="truncate">{p.name}</span>
                </div>
                {active && <Check size={12} className="text-primary-500 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── BottomNav ─────────────────────────────────────────────────────────────────
const BottomNav = memo(() => {
  const [moreOpen,       setMoreOpen]       = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const { logout } = useAuth()
  const navigate   = useNavigate()

  const closeMore    = useCallback(() => setMoreOpen(false), [])
  const handleLogout = useCallback(() => { logout(); navigate('/login') }, [logout, navigate])

  return (
    <>
      {/* ── Floating bar ────────────────────────────────────────────────────── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-3 mb-3 flex items-center bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.10)] border border-slate-200/70 px-1 py-1.5">
          {BAR_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className="flex-1"
            >
              {({ isActive }) => (
                <div className={`flex flex-col items-center gap-[3px] rounded-xl py-1.5 transition-all ${
                  isActive ? 'bg-primary-50' : ''
                }`}>
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.5 : 1.8}
                    className={isActive ? 'text-primary-600' : 'text-slate-400'}
                  />
                  <span className={`text-[9px] font-bold leading-none ${
                    isActive ? 'text-primary-600' : 'text-slate-400'
                  }`}>{label}</span>
                </div>
              )}
            </NavLink>
          ))}

          {/* More */}
          <button className="flex-1" onClick={() => setMoreOpen(true)}>
            <div className={`flex flex-col items-center gap-[3px] rounded-xl py-1.5 transition-all ${
              moreOpen ? 'bg-primary-50' : ''
            }`}>
              <MoreHorizontal
                size={20}
                strokeWidth={moreOpen ? 2.5 : 1.8}
                className={moreOpen ? 'text-primary-600' : 'text-slate-400'}
              />
              <span className={`text-[9px] font-bold leading-none ${
                moreOpen ? 'text-primary-600' : 'text-slate-400'
              }`}>More</span>
            </div>
          </button>
        </div>
      </nav>

      {/* ── More sheet ──────────────────────────────────────────────────────── */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}
            onClick={closeMore}
          />
          <div
            className="fixed left-0 right-0 bottom-0 z-50 md:hidden bg-white rounded-t-2xl shadow-2xl bn-sheet"
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-[3px] w-9 rounded-full bg-slate-200" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-2 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-50 border border-primary-100">
                  <Building2 size={15} className="text-primary-500" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800 leading-none">DormAxis</p>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mt-0.5">PG · Hostel</p>
                </div>
              </div>
              <button
                onClick={closeMore}
                className="h-8 w-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* Property selector */}
            <SheetPropertySelector />

            {/* Nav items */}
            <div className="px-4 pb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">More</p>
              <div className="space-y-1">
                {MORE_ITEMS.map(({ to, label, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={closeMore}
                    className={({ isActive }) =>
                      `flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors ${
                        isActive
                          ? 'bg-primary-50 text-primary-600'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                          isActive ? 'bg-primary-100' : 'bg-slate-100'
                        }`}>
                          <Icon size={16} strokeWidth={isActive ? 2.5 : 1.8} />
                        </div>
                        <span className="text-sm font-semibold">{label}</span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>

            {/* Sign out */}
            <div className="px-4 py-3 mt-1 border-t border-slate-100">
              <button
                onClick={() => { closeMore(); setConfirmSignOut(true) }}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-slate-500 hover:bg-red-50 hover:text-red-500 transition-colors"
              >
                <div className="h-8 w-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <LogOut size={16} />
                </div>
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
          style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-xl p-5 space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3.5">
              <LogOut size={16} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-bold text-red-700">Sign out?</p>
                <p className="text-xs text-red-600/80 mt-0.5 leading-relaxed">You'll be returned to the login screen.</p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                onClick={() => setConfirmSignOut(false)}
              >
                Cancel
              </button>
              <button
                className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 transition-colors"
                onClick={handleLogout}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .bn-sheet {
          animation: bn-slide-up 0.22s cubic-bezier(0.32, 0.72, 0, 1) both;
        }
        @keyframes bn-slide-up {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </>
  )
})

export default BottomNav
