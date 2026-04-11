import { useState, useRef, useEffect } from 'react'
import { MapPin, LayoutGrid, Menu, Settings, ChevronRight } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useProperty } from '../../context/PropertyContext'
import { useNavigate } from 'react-router-dom'

const Navbar = ({ title, onOpenSidebar, sidebarCollapsed }) => {
  const { user }                               = useAuth()
  const { selectedProperty, isAllProperties }  = useProperty()
  const navigate                               = useNavigate()

  const [showUserMenu, setShowUserMenu] = useState(false)
  const menuRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setShowUserMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const initials = user?.name
    ?.split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <header
      className={`fixed right-0 top-0 z-20 flex h-16 items-center justify-between px-4 sm:px-6 transition-all duration-300 bg-white/95 backdrop-blur-md border-b border-slate-200 left-0 ${sidebarCollapsed ? 'md:left-[68px]' : 'md:left-60'}`}
    >

      {/* Left: hamburger + page title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenSidebar}
          className="md:hidden rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-base font-bold text-slate-800 tracking-tight">{title}</h1>
      </div>

      {/* Centre: active property pill */}
      {(selectedProperty || isAllProperties) && (
        <div className="absolute left-1/2 -translate-x-1/2 hidden sm:flex items-center gap-1.5 rounded-full px-3.5 py-1.5 bg-primary-50 border border-primary-100">
          {isAllProperties
            ? <LayoutGrid size={12} className="text-primary-500 shrink-0" />
            : <MapPin      size={12} className="text-primary-500 shrink-0" />
          }
          <span className="text-xs font-semibold text-primary-600 max-w-[160px] truncate">
            {isAllProperties ? 'All Properties' : selectedProperty.name}
          </span>
        </div>
      )}

      {/* Right */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* User info */}
        <div className="text-right hidden lg:block">
          <p className="text-sm font-medium text-slate-700 leading-tight">{user?.name}</p>
          <p className="text-xs text-slate-500">{user?.email}</p>
        </div>

        {/* Avatar + dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setShowUserMenu((v) => !v)}
            className="flex h-8 w-8 sm:h-9 sm:w-9 items-center justify-center rounded-full text-sm font-bold text-white shrink-0 bg-primary-500 hover:bg-primary-600 transition-colors ring-2 ring-transparent hover:ring-primary-200"
          >
            {initials}
          </button>

          {showUserMenu && (
            <div className="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-white border border-slate-200 shadow-xl overflow-hidden z-50">
              {/* User info */}
              <div className="px-4 py-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-500 text-white text-sm font-bold shrink-0">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{user?.name}</p>
                    <p className="text-xs text-slate-400 truncate">{user?.email}</p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="p-2">
                <button
                  onClick={() => { setShowUserMenu(false); navigate('/settings') }}
                  className="w-full flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors group"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 group-hover:bg-slate-200 transition-colors">
                      <Settings size={14} className="text-slate-500" />
                    </div>
                    <span className="font-medium">Account settings</span>
                  </div>
                  <ChevronRight size={14} className="text-slate-400" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

export default Navbar
