import { useLocation } from 'react-router-dom'

const TITLES = {
  '/dashboard':     'Dashboard',
  '/owners':        'Property Owners',
  '/properties':    'All Properties',
  '/subscriptions': 'Subscription Plans',
}

export default function Topbar() {
  const { pathname } = useLocation()
  const title = Object.entries(TITLES).find(([k]) => pathname.startsWith(k))?.[1] ?? 'DormAxis'

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center px-6 shrink-0">
      <h1 className="text-[14px] font-semibold text-slate-700">{title}</h1>
    </header>
  )
}
