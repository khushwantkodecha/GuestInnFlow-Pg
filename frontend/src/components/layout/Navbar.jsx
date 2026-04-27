import { useState, useRef, useEffect, useMemo, memo } from 'react'
import { Menu, Settings, ChevronRight } from 'lucide-react'
import { useAuth }     from '../../context/AuthContext'
import { useNavigate } from 'react-router-dom'

const Navbar = memo(({ title, onOpenSidebar, sidebarCollapsed }) => {
  const { user }   = useAuth()
  const navigate   = useNavigate()

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

  const initials = useMemo(() =>
    user?.name?.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2),
    [user?.name]
  )

  return (
    <header
      className={`fixed right-0 top-0 z-20 flex h-16 items-center justify-between px-4 sm:px-6 transition-all duration-300 bg-white/95 backdrop-blur-md border-b border-slate-200 left-0 ${sidebarCollapsed ? 'md:left-[68px]' : 'md:left-60'}`}
    >

      {/* Left: page title */}
      <div className="flex items-center gap-3">
        <h1 className="text-base font-bold text-slate-800 tracking-tight">{title}</h1>
      </div>


{/* Right */}
      <div className="flex items-center gap-2 sm:gap-3">

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
})

export default Navbar
