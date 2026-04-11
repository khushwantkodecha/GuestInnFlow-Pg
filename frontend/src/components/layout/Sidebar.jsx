import { useState, useRef, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Building2,
  BedDouble,
  Users,
  CreditCard,
  Receipt,
  BarChart3,
  Settings,
  LogOut,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  LayoutGrid,
  Home,
  BookOpen,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useProperty } from '../../context/PropertyContext'

// ── Nav structure ─────────────────────────────────────────────────────────────
const NAV_SECTIONS = [
  {
    label: 'Main',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    label: 'Management',
    items: [
      { to: '/properties', label: 'Properties',   icon: Building2  },
      { to: '/rooms',      label: 'Rooms & Beds', icon: BedDouble  },
      { to: '/tenants',    label: 'Tenants',       icon: Users      },
      { to: '/rent',       label: 'Rent Payments', icon: CreditCard },
      { to: '/expenses',   label: 'Expenses',      icon: Receipt    },
      { to: '/accounting', label: 'Accounting',    icon: BookOpen   },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/reports', label: 'Reports', icon: BarChart3 },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/settings', label: 'Settings', icon: Settings },
    ],
  },
]

// ── Dropdown items (shared between collapsed + expanded property selector) ────
const DropdownItems = ({ isAllProperties, selectedProperty, properties, setSelectedProperty, setOpen }) => (
  <>
    <button
      onClick={() => { setSelectedProperty(null); setOpen(false) }}
      className={`dd-item ${isAllProperties ? 'dd-item--active' : ''} border-b border-slate-100 flex items-center justify-between`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <LayoutGrid size={11} className="shrink-0 text-slate-400" />
        <span className="truncate italic">All Properties</span>
      </div>
      {isAllProperties && <Check size={12} className="shrink-0" style={{ color: '#60C3AD' }} />}
    </button>
    {properties.map((p) => {
      const active = !isAllProperties && selectedProperty?._id === p._id
      return (
        <button
          key={p._id}
          onClick={() => { setSelectedProperty(p); setOpen(false) }}
          className={`dd-item ${active ? 'dd-item--active' : ''} flex items-center justify-between`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${active ? 'bg-emerald-400' : 'bg-slate-300'}`} />
            <span className="truncate">{p.name}</span>
          </div>
          {active && <Check size={12} className="shrink-0" style={{ color: '#60C3AD' }} />}
        </button>
      )
    })}
  </>
)

// ── Property Selector ─────────────────────────────────────────────────────────
const PropertySelector = ({ collapsed }) => {
  const { properties, selectedProperty, isAllProperties, setSelectedProperty } = useProperty()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!properties.length) return null

  const displayName = isAllProperties ? 'All Properties' : (selectedProperty?.name ?? 'Select')

  if (collapsed) {
    return (
      <div ref={ref} className="relative px-2 py-3 flex justify-center">
        <button
          onClick={() => setOpen((v) => !v)}
          className="ps-icon-btn"
          title={displayName}
        >
          {isAllProperties ? <LayoutGrid size={14} /> : <Home size={14} />}
          {!isAllProperties && selectedProperty && (
            <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-white" />
          )}
        </button>

        {open && (
          <div className="absolute left-full top-0 z-50 ml-3 w-52 rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-[0_8px_30px_rgba(0,0,0,.10)] animate-scaleIn">
            <div className="px-3.5 py-2.5 border-b border-slate-100">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Switch Property</p>
            </div>
            <DropdownItems
              isAllProperties={isAllProperties}
              selectedProperty={selectedProperty}
              properties={properties}
              setSelectedProperty={setSelectedProperty}
              setOpen={setOpen}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative px-3 py-3">
      <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
        Property
      </p>

      <button onClick={() => setOpen((v) => !v)} className="ps-trigger" data-open={open || undefined}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="ps-trigger-icon">
            {isAllProperties ? <LayoutGrid size={11} /> : <Home size={11} />}
            {!isAllProperties && selectedProperty && (
              <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-400 ring-1 ring-white" />
            )}
          </div>
          <span className="truncate text-[12.5px] font-semibold text-slate-700">{displayName}</span>
        </div>
        <ChevronDown
          size={13}
          className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full z-50 mt-1.5 rounded-2xl overflow-hidden bg-white border border-slate-200 shadow-[0_8px_30px_rgba(0,0,0,.10)] animate-scaleIn">
          <DropdownItems
            isAllProperties={isAllProperties}
            selectedProperty={selectedProperty}
            properties={properties}
            setSelectedProperty={setSelectedProperty}
            setOpen={setOpen}
          />
        </div>
      )}
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
const Sidebar = ({ open, onClose, collapsed, onToggleCollapse }) => {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const handleLogout   = () => { logout(); navigate('/login') }
  const handleNavClick = () => { if (onClose) onClose() }


  return (
    <>
      <aside className={`
        fixed inset-y-0 left-0 z-30 flex flex-col
        transform transition-all duration-300 ease-in-out
        ${open ? 'translate-x-0' : '-translate-x-full'}
        md:translate-x-0
        ${collapsed ? 'md:w-[68px]' : 'md:w-60'}
        w-64 sb-root
      `}>

        {/* ── Logo ─────────────────────────────────────────────────────────── */}
        <div className={`flex h-16 items-center sb-divider-b ${collapsed ? 'justify-center px-2' : 'px-4'}`}>
          <div className="sb-logo-icon shrink-0">
            <Building2 size={15} style={{ color: '#60C3AD' }} />
          </div>
          {!collapsed && (
            <div className="ml-3">
              <p className="text-[14px] font-bold tracking-tight leading-none" style={{ color: '#334155' }}>
                GuestInnFlow
              </p>
              <p className="text-[9px] font-semibold uppercase tracking-widest leading-tight mt-0.5 text-slate-400">
                PG Management
              </p>
            </div>
          )}
        </div>

        {/* ── Collapse toggle — right border, desktop only ───────────────────── */}
        <button
          onClick={onToggleCollapse}
          className="sb-toggle-btn hidden md:flex"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>

        {/* ── Property selector ─────────────────────────────────────────────── */}
        <div className="sb-divider-b">
          <PropertySelector collapsed={collapsed} />
        </div>

        {/* ── Nav ──────────────────────────────────────────────────────────── */}
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3 scrollbar-none">
          {NAV_SECTIONS.map(({ label, items }, sIdx) => (
            <div key={label} className={sIdx > 0 ? 'mt-5' : ''}>

              {/* Section label */}
              {collapsed ? (
                <div className="mx-auto w-6 h-px my-2.5 bg-slate-200" />
              ) : (
                <p className="mb-1 px-4 text-[10px] font-semibold uppercase tracking-widest select-none text-slate-400">
                  {label}
                </p>
              )}

              {/* Items */}
              <div className="px-2 space-y-0.5">
                {items.map(({ to, label: itemLabel, icon: Icon }) => (
                  <NavLink
                    key={to}
                    to={to}
                    onClick={handleNavClick}
                    title={collapsed ? itemLabel : undefined}
                    className={({ isActive }) =>
                      `sb-nav ${isActive ? 'sb-nav--active' : 'sb-nav--default'} ${collapsed ? 'sb-nav--collapsed' : ''}`
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span className={`sb-nav-icon-wrap ${isActive ? 'sb-nav-icon-wrap--active' : ''}`}>
                          <Icon size={16} />
                        </span>
                        {!collapsed && (
                          <span className="truncate text-[13px] font-medium">{itemLabel}</span>
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* ── User footer ───────────────────────────────────────────────────── */}
        <div className={`sb-divider-t ${collapsed ? 'px-2 py-3 flex justify-center' : 'px-3 py-3'}`}>
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

      {/* ── Sign-out confirmation ─────────────────────────────────────────── */}
      {confirmSignOut && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}>
          <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-xl p-6 space-y-4 animate-pageIn">
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

      {/* ── Scoped styles ────────────────────────────────────────────────────── */}
      <style>{`
        /* ── Root ── */
        .sb-root {
          background: #FFFFFF;
          border-right: 1px solid #E2E8F0;
        }

        /* ── Dividers ── */
        .sb-divider-b { border-bottom: 1px solid #E2E8F0; }
        .sb-divider-t { border-top:    1px solid #E2E8F0; }

        /* ── Logo icon ── */
        .sb-logo-icon {
          display:flex; height:32px; width:32px;
          align-items:center; justify-content:center;
          border-radius:9px; flex-shrink:0;
          background: rgba(96,195,173,0.12);
          border: 1px solid rgba(96,195,173,0.25);
        }

        /* ── Collapse toggle on right border ── */
        .sb-toggle-btn {
          position: absolute;
          top: 20px;
          right: -12px;
          z-index: 40;
          height: 24px;
          width: 24px;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: #ffffff;
          border: 1px solid #E2E8F0;
          color: #94A3B8;
          box-shadow: 0 2px 6px rgba(0,0,0,0.08);
          cursor: pointer;
          transition: all .18s ease;
        }
        .sb-toggle-btn:hover {
          background: #f1f5f9;
          color: #334155;
          border-color: #CBD5E1;
        }

        /* ── Generic icon button ── */
        .sb-icon-btn {
          display:flex; align-items:center; justify-content:center;
          height:30px; width:30px; border-radius:8px;
          color: #94A3B8;
          transition: all .18s ease; cursor:pointer; flex-shrink:0;
        }
        .sb-icon-btn:hover {
          background: #F8FAFC;
          color: #334155;
        }

        /* ── Property selector trigger ── */
        .ps-trigger {
          display:flex; width:100%; align-items:center; justify-content:space-between;
          gap:8px; border-radius:12px; padding:9px 11px;
          cursor:pointer;
          background: #FFFFFF;
          border: 1px solid #E2E8F0;
          transition: all .2s ease;
        }
        .ps-trigger:hover, .ps-trigger[data-open] {
          background: #F8FAFC;
          border-color: #CBD5E1;
        }
        .ps-trigger-icon {
          position:relative; display:flex;
          height:22px; width:22px; align-items:center; justify-content:center;
          border-radius:6px; flex-shrink:0;
          background: rgba(96,195,173,0.10);
          color: #60C3AD;
        }

        /* ── Collapsed property selector icon button ── */
        .ps-icon-btn {
          position:relative; display:flex;
          height:34px; width:34px;
          align-items:center; justify-content:center;
          border-radius:10px; cursor:pointer;
          background: #F8FAFC;
          border: 1px solid #E2E8F0;
          color: #60C3AD;
          transition: all .18s ease;
        }
        .ps-icon-btn:hover {
          background: rgba(96,195,173,0.08);
          border-color: rgba(96,195,173,0.3);
        }

        /* ── Dropdown items ── */
        .dd-item {
          display:flex; width:100%; align-items:center; gap:10px;
          padding:10px 14px; text-align:left;
          font-size:12.5px; font-weight:500;
          color:#475569; cursor:pointer;
          transition: background .12s ease;
        }
        .dd-item:hover { background:#F8FAFC; color:#1e293b; }
        .dd-item--active {
          background:rgba(96,195,173,.08) !important;
          color:#45a793 !important;
          font-weight:600;
        }

        /* ── Nav items ── */
        .sb-nav {
          display:flex; align-items:center; gap:10px;
          border-radius:10px; padding:8px 10px;
          text-decoration:none; position:relative;
          transition: all .18s cubic-bezier(.4,0,.2,1);
        }
        .sb-nav--collapsed { justify-content:center; padding:9px; box-shadow:none !important; border-radius:10px; }

        /* Default state */
        .sb-nav--default { color: #64748B; }
        .sb-nav--default:hover {
          background: #F8FAFC;
          color: #334155;
        }
        .sb-nav--default:hover .sb-nav-icon-wrap {
          color: #334155;
        }

        /* Active state */
        .sb-nav--active {
          background: rgba(96,195,173,0.10) !important;
          color: #45a793 !important;
          box-shadow: inset 3px 0 0 #60C3AD;
        }
        .sb-nav--active:hover { background: rgba(96,195,173,0.14) !important; }

        /* ── Nav icon wrapper ── */
        .sb-nav-icon-wrap {
          display:flex; align-items:center; justify-content:center;
          height:26px; width:26px; border-radius:7px;
          color: #94A3B8;
          flex-shrink:0;
          transition: color .18s ease;
        }
        .sb-nav-icon-wrap--active {
          color: #60C3AD !important;
        }

        /* ── User card ── */
        .sb-user-card {
          display:flex; align-items:center; gap:10px;
          padding:10px 11px; border-radius:12px;
          background: #F8FAFC;
          border: 1px solid #E2E8F0;
        }
        .sb-avatar {
          display:flex; height:30px; width:30px;
          align-items:center; justify-content:center;
          border-radius:50%; font-size:11px; font-weight:700;
          text-transform:uppercase; color:#fff;
          background: #334155;
          flex-shrink:0;
        }

        /* ── Logout button ── */
        .sb-logout-btn {
          display:flex; width:100%; align-items:center; gap:9px;
          border-radius:9px; padding:7px 10px;
          font-size:12.5px; font-weight:500;
          color: #94A3B8;
          transition: all .18s ease; cursor:pointer;
        }
        .sb-logout-btn:hover {
          color: #EF4444;
          background: rgba(239,68,68,0.06);
        }

        /* ── Hide scrollbar ── */
        .scrollbar-none::-webkit-scrollbar { display:none; }
        .scrollbar-none { -ms-overflow-style:none; scrollbar-width:none; }
      `}</style>
    </>
  )
}

export default Sidebar
