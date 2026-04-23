import { useEffect, useState } from 'react'
import { Users, Building2, BedDouble, IndianRupee, TrendingUp, UserCheck } from 'lucide-react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import StatCard from '../components/ui/StatCard'
import Spinner  from '../components/ui/Spinner'
import { getPlatformStats } from '../api/stats'

const FALLBACK = {
  totalOwners: 0, activeOwners: 0,
  totalProperties: 0, totalBeds: 0,
  totalTenants: 0, monthlyRevenue: 0,
  ownerGrowth: [],
}

export default function Dashboard() {
  const [stats,   setStats]   = useState(FALLBACK)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPlatformStats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Spinner size={32} />
    </div>
  )

  const cards = [
    { icon: Users,       label: 'Total Owners',      value: stats.totalOwners,    color: '#45a793' },
    { icon: UserCheck,   label: 'Active Owners',      value: stats.activeOwners,   color: '#10b981' },
    { icon: Building2,   label: 'Total Properties',   value: stats.totalProperties, color: '#6366f1' },
    { icon: BedDouble,   label: 'Total Beds',         value: stats.totalBeds,      color: '#f59e0b' },
    { icon: TrendingUp,  label: 'Total Tenants',      value: stats.totalTenants,   color: '#8b5cf6' },
    { icon: IndianRupee, label: 'Monthly Revenue',    value: `₹${(stats.monthlyRevenue / 100000).toFixed(1)}L`, color: '#ec4899' },
  ]

  return (
    <div className="space-y-6">

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map(c => <StatCard key={c.label} {...c} />)}
      </div>

      {/* Owner growth chart */}
      {stats.ownerGrowth?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Owner Signups — Last 12 Months</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={stats.ownerGrowth} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#45a793" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#45a793" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip
                contentStyle={{ borderRadius: 10, border: '1px solid #e2e8f0', fontSize: 12 }}
                cursor={{ stroke: '#45a793', strokeWidth: 1, strokeDasharray: '4 4' }}
              />
              <Area type="monotone" dataKey="count" stroke="#45a793" strokeWidth={2.5} fill="url(#grad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Empty state for chart */}
      {(!stats.ownerGrowth || stats.ownerGrowth.length === 0) && (
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center shadow-sm">
          <TrendingUp size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="text-sm text-slate-400">Growth data will appear as owners sign up.</p>
        </div>
      )}
    </div>
  )
}
