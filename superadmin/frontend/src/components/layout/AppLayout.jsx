import { useState, useCallback } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar   from './Sidebar'
import Topbar    from './Topbar'
import BottomNav from './BottomNav'

export default function AppLayout() {
  const [collapsed,    setCollapsed]    = useState(false)
  const toggleCollapse = useCallback(() => setCollapsed(c => !c), [])

  const mainOffset = collapsed ? 'md:ml-[68px]' : 'md:ml-60'

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} onToggleCollapse={toggleCollapse} />

      <div className={`flex flex-col flex-1 overflow-hidden transition-all duration-300 ${mainOffset}`}>
        <Topbar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-50 pb-24 md:pb-6">
          <Outlet />
        </main>
      </div>

      <BottomNav />
    </div>
  )
}
