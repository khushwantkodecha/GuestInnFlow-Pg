import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Building2, Layers,
  MoreHorizontal, LogOut, X, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const NAV = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard'     },
  { to: '/owners',        icon: Users,           label: 'Owners'        },
  { to: '/properties',    icon: Building2,       label: 'Properties'    },
  { to: '/subscriptions', icon: Layers,          label: 'Subscriptions' },
]

export default function BottomNav() {
  const [moreOpen,       setMoreOpen]       = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const { admin, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => { logout(); navigate('/login') }
  const initials = admin?.name?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'S'

  return (
    <>
      {/* ── Floating bar ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-30 md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="mx-3 mb-3 flex items-center bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.10)] border border-slate-200/70 px-1 py-1.5">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} className="flex-1">
              {({ isActive }) => (
                <div className={`flex flex-col items-center gap-[3px] rounded-xl py-1.5 transition-all ${isActive ? 'bg-[rgba(96,195,173,0.10)]' : ''}`}>
                  <Icon
                    size={20}
                    strokeWidth={isActive ? 2.5 : 1.8}
                    className={isActive ? 'text-[#45a793]' : 'text-slate-400'}
                  />
                  <span className={`text-[9px] font-bold leading-none ${isActive ? 'text-[#45a793]' : 'text-slate-400'}`}>
                    {label}
                  </span>
                </div>
              )}
            </NavLink>
          ))}

          {/* More */}
          <button className="flex-1" onClick={() => setMoreOpen(true)}>
            <div className={`flex flex-col items-center gap-[3px] rounded-xl py-1.5 transition-all ${moreOpen ? 'bg-[rgba(96,195,173,0.10)]' : ''}`}>
              <MoreHorizontal
                size={20}
                strokeWidth={moreOpen ? 2.5 : 1.8}
                className={moreOpen ? 'text-[#45a793]' : 'text-slate-400'}
              />
              <span className={`text-[9px] font-bold leading-none ${moreOpen ? 'text-[#45a793]' : 'text-slate-400'}`}>
                More
              </span>
            </div>
          </button>
        </div>
      </nav>

      {/* ── More sheet ── */}
      {moreOpen && (
        <>
          <div
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(3px)' }}
            onClick={() => setMoreOpen(false)}
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
                <div className="flex h-8 w-8 items-center justify-center rounded-xl"
                  style={{ background: 'rgba(96,195,173,0.12)', border: '1px solid rgba(96,195,173,0.25)' }}>
                  <ShieldCheck size={15} style={{ color: '#60C3AD' }} />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800 leading-none">DormAxis</p>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mt-0.5">Superadmin</p>
                </div>
              </div>
              <button
                onClick={() => setMoreOpen(false)}
                className="h-8 w-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 transition-colors"
              >
                <X size={15} />
              </button>
            </div>

            {/* User card */}
            <div className="mx-4 mb-4 flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-white text-[11px] font-bold shrink-0">
                {initials}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate leading-none">{admin?.name || 'Superadmin'}</p>
                <p className="text-xs text-slate-400 truncate mt-0.5">{admin?.email}</p>
              </div>
            </div>

            {/* Sign out */}
            <div className="px-4 pb-4">
              <button
                onClick={() => { setMoreOpen(false); setConfirmSignOut(true) }}
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

      {/* ── Sign-out confirmation ── */}
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
}
