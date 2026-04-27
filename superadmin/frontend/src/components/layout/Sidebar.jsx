import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Users, Building2, Layers,
  LogOut, ChevronLeft, ChevronRight, ShieldCheck,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'

const NAV = [
  { to: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard'     },
  { to: '/owners',        icon: Users,           label: 'Owners'        },
  { to: '/properties',   icon: Building2,        label: 'Properties'   },
  { to: '/subscriptions', icon: Layers,          label: 'Subscriptions' },
]

const Sidebar = ({ collapsed, onToggleCollapse }) => {
  const { admin, logout } = useAuth()
  const navigate = useNavigate()
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  const handleLogout  = () => { logout(); navigate('/login') }

  const initials = admin?.name?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'S'

  return (
    <>
      <aside className={`
        hidden md:flex flex-col sb-root
        fixed inset-y-0 left-0 z-30
        transition-all duration-300 ease-in-out
        ${collapsed ? 'w-[68px]' : 'w-60'}
      `}>

        {/* ── Logo ── */}
        <div className={`flex h-16 items-center sb-divider-b ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
          <div className="sb-logo-icon shrink-0">
            <ShieldCheck size={15} style={{ color: '#60C3AD' }} />
          </div>
          <div className={`ml-3 ${collapsed ? 'hidden' : ''}`}>
            <p className="text-[14px] font-bold tracking-tight leading-none" style={{ color: '#334155' }}>
              DormAxis
            </p>
            <p className="text-[9px] font-semibold uppercase tracking-widest leading-tight mt-0.5 text-slate-400">
              Superadmin
            </p>
          </div>
        </div>

        {/* ── Collapse toggle ── */}
        <button
          onClick={onToggleCollapse}
          className="sb-toggle-btn"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>

        {/* ── Nav ── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 scrollbar-none">
          <div className="px-2 space-y-0.5">
            {NAV.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  `sb-nav ${isActive ? 'sb-nav--active' : 'sb-nav--default'} ${collapsed ? 'sb-nav--collapsed' : ''}`
                }
              >
                {({ isActive }) => (
                  <>
                    <span className={`sb-nav-icon-wrap ${isActive ? 'sb-nav-icon-wrap--active' : ''}`}>
                      <Icon size={16} />
                    </span>
                    <span className={`truncate text-[13px] font-medium ${collapsed ? 'hidden' : ''}`}>{label}</span>
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </nav>

        {/* ── Footer ── */}
        <div className={`sb-divider-t ${collapsed ? 'px-2 py-3 flex justify-center' : 'px-3 py-3'}`}>
          <div className={`sb-user-card mb-2 ${collapsed ? 'hidden' : ''}`}>
            <div className="sb-avatar">{initials}</div>
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-semibold text-slate-700 truncate leading-none">{admin?.name || 'Superadmin'}</p>
              <p className="text-[10.5px] text-slate-400 truncate mt-0.5">{admin?.email}</p>
            </div>
          </div>
          {collapsed ? (
            <button onClick={() => setConfirmSignOut(true)} className="sb-icon-btn" title="Sign out">
              <LogOut size={14} />
            </button>
          ) : (
            <button onClick={() => setConfirmSignOut(true)} className="sb-logout-btn">
              <LogOut size={13} />
              <span>Sign out</span>
            </button>
          )}
        </div>
      </aside>

      {/* ── Sign-out confirmation ── */}
      {confirmSignOut && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
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
                onClick={() => setConfirmSignOut(false)}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleLogout}
                className="flex-1 rounded-xl bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 transition-colors"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .sb-root {
          background: #FFFFFF;
          border-right: 1px solid #E2E8F0;
        }
        .sb-divider-b { border-bottom: 1px solid #E2E8F0; }
        .sb-divider-t { border-top:    1px solid #E2E8F0; }

        .sb-logo-icon {
          display:flex; height:32px; width:32px;
          align-items:center; justify-content:center;
          border-radius:9px; flex-shrink:0;
          background: rgba(96,195,173,0.12);
          border: 1px solid rgba(96,195,173,0.25);
        }

        .sb-toggle-btn {
          position:absolute; top:20px; right:-12px; z-index:40;
          height:24px; width:24px;
          display:flex; align-items:center; justify-content:center;
          border-radius:50%;
          background:#ffffff; border:1px solid #E2E8F0;
          color:#94A3B8; box-shadow:0 2px 6px rgba(0,0,0,.08);
          cursor:pointer; transition:all .18s ease;
        }
        .sb-toggle-btn:hover { background:#f1f5f9; color:#334155; border-color:#CBD5E1; }

        .sb-icon-btn {
          display:flex; align-items:center; justify-content:center;
          height:30px; width:30px; border-radius:8px;
          color:#94A3B8; transition:all .18s ease; cursor:pointer;
        }
        .sb-icon-btn:hover { background:#F8FAFC; color:#334155; }

        .sb-nav {
          display:flex; align-items:center; gap:10px;
          border-radius:10px; padding:8px 10px;
          text-decoration:none; position:relative;
          transition:all .18s cubic-bezier(.4,0,.2,1);
        }
        .sb-nav--collapsed { justify-content:center; padding:9px; box-shadow:none !important; }
        .sb-nav--default { color:#64748B; }
        .sb-nav--default:hover { background:#F8FAFC; color:#334155; }
        .sb-nav--active {
          background:rgba(96,195,173,0.10) !important;
          color:#45a793 !important;
          box-shadow:inset 3px 0 0 #60C3AD;
        }
        .sb-nav--active:hover { background:rgba(96,195,173,0.14) !important; }

        .sb-nav-icon-wrap {
          display:flex; align-items:center; justify-content:center;
          height:26px; width:26px; border-radius:7px;
          color:#94A3B8; flex-shrink:0; transition:color .18s ease;
        }
        .sb-nav-icon-wrap--active { color:#60C3AD !important; }

        .sb-user-card {
          display:flex; align-items:center; gap:10px;
          padding:10px 11px; border-radius:12px;
          background:#F8FAFC; border:1px solid #E2E8F0;
        }
        .sb-avatar {
          display:flex; height:30px; width:30px;
          align-items:center; justify-content:center;
          border-radius:50%; font-size:11px; font-weight:700;
          text-transform:uppercase; color:#fff;
          background:#334155; flex-shrink:0;
        }

        .sb-logout-btn {
          display:flex; width:100%; align-items:center; gap:9px;
          border-radius:9px; padding:7px 10px;
          font-size:12.5px; font-weight:500; color:#94A3B8;
          transition:all .18s ease; cursor:pointer;
        }
        .sb-logout-btn:hover { color:#EF4444; background:rgba(239,68,68,0.06); }

        .scrollbar-none::-webkit-scrollbar { display:none; }
        .scrollbar-none { -ms-overflow-style:none; scrollbar-width:none; }
      `}</style>
    </>
  )
}

export default Sidebar
