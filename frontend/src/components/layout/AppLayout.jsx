import { useState, useCallback } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Navbar from './Navbar'
import BottomNav from './BottomNav'
import CommandPalette from '../ui/CommandPalette'

const TITLES = {
  '/dashboard':  'Dashboard',
  '/properties': 'Properties',
  '/rooms':      'Rooms & Beds',
  '/tenants':    'Tenants',
  '/rent':       'Rent',
  '/expenses':   'Expenses',
  '/accounting': 'Accounting',
  '/reports':    'Reports',
  '/settings':   'Settings',
}

const AppLayout = () => {
  const { pathname } = useLocation()
  const title        = TITLES[pathname] ?? 'DormAxis'

  const [sidebarOpen,     setSidebarOpen]     = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const openSidebar        = useCallback(() => setSidebarOpen(true),  [])
  const closeSidebar       = useCallback(() => setSidebarOpen(false), [])
  const toggleCollapse     = useCallback(() => setSidebarCollapsed((v) => !v), [])

  // Desktop left offset: 68px when collapsed, 240px (md:w-60) when expanded
  const mainOffset = sidebarCollapsed ? 'md:ml-[68px]' : 'md:ml-60'

  return (
    <div className="min-h-screen bg-slate-50">

      {/* Sidebar */}
      <Sidebar
        open={sidebarOpen}
        onClose={closeSidebar}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleCollapse}
      />

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm md:hidden animate-fadeIn"
          onClick={closeSidebar}
        />
      )}

      {/* Top bar */}
      <Navbar
        title={title}
        onOpenSidebar={openSidebar}
        sidebarCollapsed={sidebarCollapsed}
      />

      {/* Page content */}
      <main className={`${mainOffset} pt-16 transition-all duration-300`}>
        {/* pb-24 on mobile reserves space above the bottom nav bar */}
        <div className="p-4 sm:p-6 pb-24 md:pb-6 animate-pageIn" key={pathname}>
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav — hidden on md+ */}
      <BottomNav />

      <CommandPalette />
    </div>
  )
}

export default AppLayout
