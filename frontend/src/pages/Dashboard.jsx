import { useState, useEffect } from 'react'
import {
  Building2, BedDouble, Users, CreditCard, Clock,
  CheckCircle2, AlertTriangle, ArrowUpRight, LayoutGrid,
  RefreshCw, Zap, Droplets, UtensilsCrossed, Wrench,
  Wifi, UserCheck, Package, TrendingUp, TrendingDown,
  ChevronRight,
} from 'lucide-react'
import { getPropertyDashboard, getDashboard } from '../api/dashboard'
import { getRents } from '../api/rent'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import StatCard from '../components/ui/StatCard'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import { DashboardSkeleton } from '../components/ui/Skeleton'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt    = (n) => `₹${(n ?? 0).toLocaleString('en-IN')}`
const pct    = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtPeriod = (m, y) => `${MONTH_NAMES[(m ?? 1) - 1]} ${y ?? ''}`

// ── Section label ─────────────────────────────────────────────────────────────
const SectionLabel = ({ children }) => (
  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3 select-none">
    {children}
  </p>
)

// ── Donut chart (CSS conic-gradient) ──────────────────────────────────────────
const DonutChart = ({ occupied, reserved, vacant, total }) => {
  if (!total) return (
    <div className="relative h-32 w-32 shrink-0 flex items-center justify-center rounded-full bg-slate-100">
      <p className="text-[11px] text-slate-400 text-center leading-tight">No<br/>beds</p>
    </div>
  )

  const occDeg = (occupied / total) * 360
  const resDeg = (reserved / total) * 360
  const occRate = Math.round((occupied / total) * 100)

  const gradient = `conic-gradient(
    #3B82F6 0deg ${occDeg}deg,
    #F59E0B ${occDeg}deg ${occDeg + resDeg}deg,
    #22C55E ${occDeg + resDeg}deg 360deg
  )`

  return (
    <div className="relative h-32 w-32 shrink-0">
      <div className="h-full w-full rounded-full" style={{ background: gradient }} />
      <div className="absolute inset-[18%] rounded-full bg-white flex flex-col items-center justify-center"
        style={{ boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.06)' }}>
        <p className="text-[22px] font-bold text-slate-800 leading-none">{occRate}%</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Occupied</p>
      </div>
    </div>
  )
}

// ── Occupancy Overview card ───────────────────────────────────────────────────
const OccupancyCard = ({ beds }) => {
  const { total, occupied, vacant, reserved } = beds
  const items = [
    { label: 'Occupied', count: occupied, pct: pct(occupied, total), color: '#3B82F6', bg: 'bg-blue-50',    text: 'text-blue-600'    },
    { label: 'Reserved', count: reserved, pct: pct(reserved, total), color: '#F59E0B', bg: 'bg-amber-50',   text: 'text-amber-600'   },
    { label: 'Vacant',   count: vacant,   pct: pct(vacant, total),   color: '#22C55E', bg: 'bg-emerald-50', text: 'text-emerald-600' },
  ]

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm font-semibold text-slate-700">Occupancy Overview</p>
          <p className="text-xs text-slate-400 mt-0.5">{total} total beds</p>
        </div>
        <span className="text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 rounded-full px-3 py-1">
          Live
        </span>
      </div>

      <div className="flex items-center gap-6">
        {/* Donut */}
        <DonutChart occupied={occupied} reserved={reserved} vacant={vacant} total={total} />

        {/* Legend */}
        <div className="flex-1 space-y-3">
          {items.map(({ label, count, pct: p, color, bg, text }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                  <span className="text-xs font-medium text-slate-600">{label}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ${bg} ${text}`}>{count}</span>
                  <span className="text-xs text-slate-400 w-7 text-right">{p}%</span>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${p}%`, background: color }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Segmented bar */}
      {total > 0 && (
        <div className="mt-5 flex h-2 w-full rounded-full overflow-hidden gap-0.5">
          {occupied > 0 && <div className="h-full bg-blue-500 transition-all duration-700" style={{ width: `${pct(occupied, total)}%` }} />}
          {reserved > 0 && <div className="h-full bg-amber-400 transition-all duration-700" style={{ width: `${pct(reserved, total)}%` }} />}
          {vacant > 0   && <div className="h-full bg-emerald-400 flex-1" />}
        </div>
      )}
    </div>
  )
}

// ── Rent Collection card ──────────────────────────────────────────────────────
const RentCollectionCard = ({ financials }) => {
  const { collectionRate, collectedRent, pendingRent, breakdown } = financials
  const rateColor = collectionRate >= 80 ? 'text-emerald-600' : collectionRate >= 50 ? 'text-amber-600' : 'text-red-500'
  const barColor  = collectionRate >= 80 ? 'bg-emerald-500'  : collectionRate >= 50 ? 'bg-amber-400'   : 'bg-red-500'

  const segments = [
    {
      key: 'paid',
      label: 'Paid',
      amount: breakdown?.paid?.amount ?? 0,
      count: breakdown?.paid?.count ?? 0,
      bg: 'bg-emerald-50', border: 'border-emerald-200',
      dot: 'bg-emerald-500', text: 'text-emerald-700', sub: 'text-emerald-600',
    },
    {
      key: 'pending',
      label: 'Pending',
      amount: breakdown?.pending?.amount ?? 0,
      count: breakdown?.pending?.count ?? 0,
      bg: 'bg-amber-50', border: 'border-amber-200',
      dot: 'bg-amber-400', text: 'text-amber-700', sub: 'text-amber-600',
    },
    {
      key: 'overdue',
      label: 'Overdue',
      amount: breakdown?.overdue?.amount ?? 0,
      count: breakdown?.overdue?.count ?? 0,
      bg: 'bg-red-50', border: 'border-red-200',
      dot: 'bg-red-500', text: 'text-red-700', sub: 'text-red-600',
    },
  ]

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm font-semibold text-slate-700">Rent Collection</p>
          <p className="text-xs text-slate-400 mt-0.5">{fmt(collectedRent)} collected</p>
        </div>
        <span className={`text-lg font-bold ${rateColor}`}>{collectionRate}%</span>
      </div>

      {/* Collection rate bar */}
      <div className="mb-1">
        <div className="flex justify-between text-xs text-slate-400 mb-1.5">
          <span>Collection rate</span>
          <span className={`font-semibold ${rateColor}`}>{collectionRate}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-100">
          <div
            className={`h-2 rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${Math.min(collectionRate, 100)}%` }}
          />
        </div>
      </div>

      {/* Breakdown pills */}
      <div className="grid grid-cols-3 gap-2.5 mt-5">
        {segments.map(({ key, label, amount, count, bg, border, dot, text, sub }) => (
          <div key={key} className={`rounded-xl p-3 border ${bg} ${border}`}>
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />
              <span className={`text-[11px] font-semibold ${text}`}>{label}</span>
            </div>
            <p className={`text-base font-bold leading-tight ${text}`}>{fmt(amount)}</p>
            <p className={`text-[11px] mt-0.5 ${sub}`}>{count} tenant{count !== 1 ? 's' : ''}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────────────────────────
const StatusBadge = ({ status }) => {
  const cfg = {
    paid:    { label: 'Paid',    cls: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
    pending: { label: 'Pending', cls: 'bg-amber-50 border-amber-200 text-amber-700'       },
    overdue: { label: 'Overdue', cls: 'bg-red-50 border-red-200 text-red-600'             },
  }
  const { label, cls } = cfg[status] ?? cfg.pending
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>
      {label}
    </span>
  )
}

// ── Rent Payments Table ───────────────────────────────────────────────────────
const RentTable = ({ rents, loading, period }) => (
  <div className="card overflow-hidden">
    <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
      <div>
        <p className="text-sm font-semibold text-slate-700">Rent Payments</p>
        <p className="text-xs text-slate-400 mt-0.5">{period}</p>
      </div>
      {loading && <Spinner size={14} />}
    </div>

    {loading && rents.length === 0 ? (
      <div className="p-8 flex justify-center"><Spinner /></div>
    ) : rents.length === 0 ? (
      <div className="p-8 text-center">
        <p className="text-sm text-slate-400">No rent records for this period.</p>
        <p className="text-xs text-slate-300 mt-1">Generate rent from the Rent Payments page.</p>
      </div>
    ) : (
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/60">
              <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tenant</th>
              <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">Amount</th>
              <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400 hidden sm:table-cell">Paid</th>
              <th className="px-5 py-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">Status</th>
              <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400 hidden md:table-cell">Due Date</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rents.map((r) => (
              <tr key={r._id} className="hover:bg-slate-50 transition-colors duration-150">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="h-7 w-7 rounded-full bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
                      <span className="text-[10px] font-bold text-primary-600">
                        {(r.tenant?.name ?? '?').slice(0, 2).toUpperCase()}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-slate-700">{r.tenant?.name ?? 'Unknown'}</p>
                      <p className="text-[11px] text-slate-400">{r.tenant?.phone ?? ''}</p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-right text-sm font-semibold text-slate-700">{fmt(r.amount)}</td>
                <td className="px-5 py-3.5 text-right text-sm text-slate-500 hidden sm:table-cell">
                  {r.paidAmount > 0 ? fmt(r.paidAmount) : <span className="text-slate-300">—</span>}
                </td>
                <td className="px-5 py-3.5 text-center"><StatusBadge status={r.status} /></td>
                <td className="px-5 py-3.5 text-right text-sm text-slate-500 hidden md:table-cell">{fmtDate(r.dueDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
)

// ── Expense breakdown card ────────────────────────────────────────────────────
const EXPENSE_CONFIG = {
  electricity: { label: 'Electricity', icon: Zap,              color: '#F59E0B', bar: 'bg-amber-400',   text: 'text-amber-600'   },
  water:       { label: 'Water',       icon: Droplets,         color: '#3B82F6', bar: 'bg-blue-400',    text: 'text-blue-600'    },
  food:        { label: 'Food',        icon: UtensilsCrossed,  color: '#F97316', bar: 'bg-orange-400',  text: 'text-orange-600'  },
  maintenance: { label: 'Maintenance', icon: Wrench,           color: '#EF4444', bar: 'bg-red-400',     text: 'text-red-600'     },
  internet:    { label: 'Internet',    icon: Wifi,             color: '#8B5CF6', bar: 'bg-violet-400',  text: 'text-violet-600'  },
  salary:      { label: 'Salary',      icon: UserCheck,        color: '#22C55E', bar: 'bg-emerald-400', text: 'text-emerald-600' },
  other:       { label: 'Other',       icon: Package,          color: '#94A3B8', bar: 'bg-slate-300',   text: 'text-slate-500'   },
}

const ExpenseCard = ({ expenses }) => {
  const { total, breakdown } = expenses
  const entries = Object.entries(breakdown ?? {})
    .filter(([, v]) => v > 0)
    .sort(([, a], [, b]) => b - a)

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm font-semibold text-slate-700">Expenses</p>
          <p className="text-xs text-slate-400 mt-0.5">This month</p>
        </div>
        <p className="text-base font-bold text-slate-800">{fmt(total)}</p>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">No expenses recorded this month.</p>
      ) : (
        <div className="space-y-3.5">
          {entries.map(([type, amount]) => {
            const cfg = EXPENSE_CONFIG[type] ?? EXPENSE_CONFIG.other
            const IconEl = cfg.icon
            const share = pct(amount, total)
            return (
              <div key={type}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${cfg.color}18` }}>
                      <IconEl size={12} style={{ color: cfg.color }} />
                    </div>
                    <span className="text-xs font-medium text-slate-600">{cfg.label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">{fmt(amount)}</span>
                    <span className="text-[11px] text-slate-400 w-7 text-right">{share}%</span>
                  </div>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-100">
                  <div className={`h-1.5 rounded-full transition-all duration-700 ${cfg.bar}`}
                    style={{ width: `${share}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Tenant Activity card ──────────────────────────────────────────────────────
const TenantActivityCard = ({ tenants, financials, deposits }) => {
  const { active, onNotice, newCheckInsThisMonth } = tenants
  const { collectionRate } = financials

  const rateColor = collectionRate >= 80 ? 'text-emerald-600' : collectionRate >= 50 ? 'text-amber-600' : 'text-red-500'
  const rateBar   = collectionRate >= 80 ? 'bg-emerald-500'   : collectionRate >= 50 ? 'bg-amber-400'   : 'bg-red-500'

  const rows = [
    { label: 'Active Tenants',   value: active,               icon: Users,         color: 'text-primary-500',  bg: 'bg-primary-50'  },
    { label: 'On Notice',        value: onNotice,             icon: AlertTriangle, color: 'text-amber-500',   bg: 'bg-amber-50'    },
    { label: 'New This Month',   value: newCheckInsThisMonth, icon: TrendingUp,    color: 'text-blue-500',    bg: 'bg-blue-50'     },
  ]

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-5">
        <div>
          <p className="text-sm font-semibold text-slate-700">Tenant Activity</p>
          <p className="text-xs text-slate-400 mt-0.5">Current status</p>
        </div>
        <div className="h-8 w-8 rounded-xl bg-primary-50 flex items-center justify-center">
          <Users size={15} className="text-primary-500" />
        </div>
      </div>

      {/* Stat rows */}
      <div className="space-y-2 mb-5">
        {rows.map(({ label, value, icon: Icon, color, bg }) => (
          <div key={label} className="flex items-center justify-between rounded-xl px-3.5 py-2.5 bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-2.5">
              <div className={`h-6 w-6 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
                <Icon size={12} className={color} />
              </div>
              <span className="text-sm text-slate-600">{label}</span>
            </div>
            <span className="text-sm font-bold text-slate-800">{value}</span>
          </div>
        ))}
      </div>

      {/* Collection rate mini */}
      <div className="rounded-xl bg-slate-50 border border-slate-100 p-3.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-500 font-medium">Collection Rate</span>
          <span className={`text-xs font-bold ${rateColor}`}>{collectionRate}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-200">
          <div className={`h-1.5 rounded-full transition-all duration-700 ${rateBar}`}
            style={{ width: `${Math.min(collectionRate, 100)}%` }} />
        </div>
      </div>

      {/* Deposits */}
      {deposits && deposits.total > 0 && (
        <div className="mt-3 flex items-center justify-between rounded-xl px-3.5 py-2.5 bg-primary-50 border border-primary-100">
          <span className="text-xs font-medium text-primary-700">Deposits Collected</span>
          <span className="text-sm font-bold text-primary-600">{fmt(deposits.collected)}</span>
        </div>
      )}
    </div>
  )
}

// ── Financial Summary Banner ──────────────────────────────────────────────────
const FinancialBanner = ({ financials, period }) => {
  const { totalCollected, collectedRent, collectedDeposit, pendingRent, totalExpenses, netIncome, collectionRate } = financials
  const isPositive = (netIncome ?? 0) >= 0

  return (
    <div className="card overflow-hidden">
      {/* Top accent bar */}
      <div className="h-1 w-full bg-gradient-to-r from-primary-400 to-primary-500" />

      <div className="p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-5">
          {/* Left */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              Total Collected — {period}
            </p>
            <p className="text-3xl font-bold text-slate-800 leading-tight">{fmt(totalCollected)}</p>
            <p className="text-sm text-slate-400 mt-1.5">
              {fmt(collectedRent)} rent
              {collectedDeposit > 0 && ` · ${fmt(collectedDeposit)} deposits`}
            </p>
          </div>

          {/* Right: mini stat boxes */}
          <div className="flex flex-wrap gap-3">
            <div className="rounded-xl px-4 py-3 bg-amber-50 border border-amber-200 text-center min-w-[100px]">
              <p className="text-[11px] font-semibold text-amber-600 mb-1">Pending</p>
              <p className="text-base font-bold text-amber-700">{fmt(pendingRent)}</p>
            </div>
            <div className="rounded-xl px-4 py-3 bg-red-50 border border-red-200 text-center min-w-[100px]">
              <p className="text-[11px] font-semibold text-red-500 mb-1">Expenses</p>
              <p className="text-base font-bold text-red-600">{fmt(totalExpenses)}</p>
            </div>
            <div className={`rounded-xl px-4 py-3 border text-center min-w-[100px] ${isPositive ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
              <p className={`text-[11px] font-semibold mb-1 ${isPositive ? 'text-emerald-600' : 'text-red-500'}`}>Net Income</p>
              <div className="flex items-center justify-center gap-1">
                {isPositive
                  ? <TrendingUp size={13} className="text-emerald-500" />
                  : <TrendingDown size={13} className="text-red-500" />}
                <p className={`text-base font-bold ${isPositive ? 'text-emerald-700' : 'text-red-600'}`}>{fmt(netIncome)}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Collection progress */}
        <div className="mt-5">
          <div className="flex justify-between text-xs text-slate-400 mb-1.5">
            <span>Rent collection progress</span>
            <span className="font-semibold text-slate-600">{collectionRate}%</span>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100">
            <div
              className="h-2 rounded-full bg-primary-500 transition-all duration-700"
              style={{ width: `${Math.min(collectionRate, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Vacant Beds Widget ────────────────────────────────────────────────────────
const VacantBedsWidget = ({ beds }) => {
  const { vacant, reserved, total } = beds
  const vacancyRate = pct(vacant, total)

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-slate-700">Available Capacity</p>
          <p className="text-xs text-slate-400 mt-0.5">Beds ready to occupy</p>
        </div>
        <div className="h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center">
          <BedDouble size={16} className="text-emerald-500" />
        </div>
      </div>

      <div className="flex items-end gap-2 mb-4">
        <p className="text-4xl font-bold text-slate-800 leading-none">{vacant}</p>
        <p className="text-sm text-slate-400 mb-1">vacant bed{vacant !== 1 ? 's' : ''}</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-2.5 text-center">
          <p className="text-[11px] font-medium text-emerald-600 mb-0.5">Vacant</p>
          <p className="text-lg font-bold text-emerald-700">{vacant}</p>
        </div>
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-center">
          <p className="text-[11px] font-medium text-amber-600 mb-0.5">Reserved</p>
          <p className="text-lg font-bold text-amber-700">{reserved}</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-xs text-slate-400 mb-1.5">
          <span>Vacancy rate</span>
          <span className="font-semibold text-slate-600">{vacancyRate}%</span>
        </div>
        <div className="h-1.5 w-full rounded-full bg-slate-100">
          <div className="h-1.5 rounded-full bg-emerald-400 transition-all duration-700"
            style={{ width: `${vacancyRate}%` }} />
        </div>
      </div>
    </div>
  )
}

// ── Main Dashboard page ───────────────────────────────────────────────────────
const Dashboard = () => {
  const { selectedProperty, isAllProperties, properties } = useProperty()
  const propertyId = selectedProperty?._id ?? ''

  const { data, loading, error, refetch } = useApi(
    () => isAllProperties
      ? getDashboard()
      : propertyId
        ? getPropertyDashboard(propertyId)
        : Promise.resolve({ data: null }),
    [propertyId, isAllProperties]
  )

  // Secondary fetch — current-month rent payments (single-property only)
  const [recentRents, setRecentRents] = useState([])
  const [rentsLoading, setRentsLoading] = useState(false)

  useEffect(() => {
    if (!propertyId || isAllProperties) { setRecentRents([]); return }
    setRentsLoading(true)
    const now = new Date()
    getRents(propertyId, { month: now.getMonth() + 1, year: now.getFullYear() })
      .then((res) => setRecentRents(res.data?.data ?? []))
      .catch(() => setRecentRents([]))
      .finally(() => setRentsLoading(false))
  }, [propertyId, isAllProperties])

  // ── Guards ──
  if (!isAllProperties && !propertyId) return (
    <div className="card max-w-lg">
      <EmptyState message="No property selected. Choose one from the sidebar." />
    </div>
  )

  if (loading) return <DashboardSkeleton />

  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <div className="h-12 w-12 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center">
        <AlertTriangle className="text-red-500" size={22} />
      </div>
      <p className="text-sm text-slate-600 font-medium">Failed to load dashboard</p>
      <p className="text-xs text-red-500">{error}</p>
      <button className="btn-secondary text-xs" onClick={refetch}>
        <RefreshCw size={13} /> Retry
      </button>
    </div>
  )

  const d = data?.data
  if (!d) return null

  const now      = new Date()
  const period   = fmtPeriod(d.financials.month, d.financials.year)
  const heading  = isAllProperties
    ? `All Properties (${properties.length})`
    : (data?.data?.property?.name ?? selectedProperty?.name ?? '')

  return (
    <div className="space-y-6 max-w-7xl">

      {/* ── Page header ── */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            {isAllProperties && <LayoutGrid size={16} className="text-primary-500" />}
            <h1 className="text-lg font-bold text-slate-800">{heading}</h1>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{period} · Updated just now</p>
        </div>
        <button onClick={refetch} className="btn-secondary text-xs gap-1.5 py-2">
          <RefreshCw size={13} />
          Refresh
        </button>
      </div>

      {/* ── KPI Row 1 — Properties, Rooms, Beds ── */}
      <div>
        <SectionLabel>Overview</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="Total Properties"
            value={d.properties.total}
            icon={Building2}
            color="teal"
            sub={isAllProperties ? 'All active properties' : 'Current property'}
          />
          <StatCard
            label="Total Rooms"
            value={d.rooms.total}
            icon={BedDouble}
            color="blue"
            sub={`${d.beds.total} beds total`}
          />
          <div className="col-span-2 lg:col-span-1">
            <StatCard
              label="Active Tenants"
              value={d.tenants.active}
              icon={Users}
              color="green"
              sub={`${d.tenants.onNotice} on notice`}
              progress={pct(d.tenants.active, d.beds.total)}
              progressLabel="Bed occupancy"
            />
          </div>
        </div>
      </div>

      {/* ── KPI Row 2 — Occupancy + Financials ── */}
      <div>
        <SectionLabel>Beds & Financials</SectionLabel>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard
            label="Occupied Beds"
            value={d.beds.occupied}
            icon={BedDouble}
            color="blue"
            badge={`${d.beds.occupancyRate}%`}
            badgeColor="green"
            progress={d.beds.occupancyRate}
            progressLabel="Occupancy rate"
          />
          <StatCard
            label="Vacant Beds"
            value={d.beds.vacant}
            icon={BedDouble}
            color="green"
            sub={d.beds.reserved > 0 ? `${d.beds.reserved} reserved` : 'Available now'}
            badge={d.beds.reserved > 0 ? `${d.beds.reserved} reserved` : undefined}
            badgeColor="amber"
          />
          <div className="col-span-2 lg:col-span-1">
            <StatCard
              label="Pending Rent"
              value={fmt(d.financials.pendingRent)}
              icon={Clock}
              color="amber"
              sub={`Expected: ${fmt(d.financials.expectedRent)}`}
              badge={d.financials.breakdown?.overdue?.count > 0 ? `${d.financials.breakdown.overdue.count} overdue` : undefined}
              badgeColor="red"
            />
          </div>
        </div>
      </div>

      {/* ── Over-Capacity Alert ── */}
      {(d.rooms.overCapacity ?? 0) > 0 && (
        <div>
          <SectionLabel>Alerts</SectionLabel>
          <div className="rounded-2xl border border-red-200 bg-gradient-to-r from-red-50 to-red-50/40 p-5 flex items-start gap-4">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-red-100 border border-red-200 flex items-center justify-center">
              <AlertTriangle size={18} className="text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-red-700">
                {d.rooms.overCapacity} Over-Capacity Room{d.rooms.overCapacity > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-red-600/80 mt-1 leading-relaxed">
                {d.rooms.overCapacity > 1 ? 'These rooms have' : 'This room has'} more beds than stated capacity
                {(d.rooms.overCapacityBeds ?? 0) > 0 && ` (${d.rooms.overCapacityBeds} extra bed${d.rooms.overCapacityBeds > 1 ? 's' : ''})`}.
                Review extra beds or update the room capacity.
              </p>
            </div>
            <a href="/rooms"
              className="shrink-0 flex items-center gap-1 rounded-xl border border-red-200 bg-white/60 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-white hover:border-red-300 transition-all duration-150">
              View <ChevronRight size={12} />
            </a>
          </div>
        </div>
      )}

      {/* ── Occupancy Overview + Rent Collection ── */}
      <div>
        <SectionLabel>Occupancy & Collection</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-2">
          <OccupancyCard beds={d.beds} />
          <RentCollectionCard financials={d.financials} />
        </div>
      </div>

      {/* ── Rent Payments Table ── */}
      <div>
        <SectionLabel>Rent Payments — {period}</SectionLabel>
        {isAllProperties ? (
          <div className="card p-6 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Detailed payment records</p>
              <p className="text-xs text-slate-400 mt-0.5">Select a single property to view individual tenant payments.</p>
            </div>
            <ChevronRight size={16} className="text-slate-300 shrink-0" />
          </div>
        ) : (
          <RentTable rents={recentRents} loading={rentsLoading} period={period} />
        )}
      </div>

      {/* ── Financial Banner ── */}
      <div>
        <SectionLabel>Financial Summary</SectionLabel>
        <FinancialBanner financials={d.financials} period={period} />
      </div>

      {/* ── Expenses + Tenant Activity ── */}
      <div>
        <SectionLabel>Details</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-3 items-start">
          <div className="lg:col-span-2">
            <ExpenseCard expenses={d.expenses} />
          </div>
          <TenantActivityCard tenants={d.tenants} financials={d.financials} deposits={d.deposits} />
        </div>
      </div>

      {/* ── Vacant Beds Widget ── */}
      <div>
        <SectionLabel>Availability</SectionLabel>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <VacantBedsWidget beds={d.beds} />
          {/* New check-ins mini card */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-slate-700">New Check-ins</p>
              <div className="h-9 w-9 rounded-xl bg-blue-50 flex items-center justify-center">
                <TrendingUp size={16} className="text-blue-500" />
              </div>
            </div>
            <div className="flex items-end gap-2 mb-3">
              <p className="text-4xl font-bold text-slate-800 leading-none">{d.tenants.newCheckInsThisMonth}</p>
              <p className="text-sm text-slate-400 mb-1">this month</p>
            </div>
            <div className="rounded-xl bg-blue-50 border border-blue-200 px-3.5 py-2.5">
              <p className="text-xs text-blue-600 font-medium">
                {d.tenants.active} active · {d.tenants.onNotice} on notice
              </p>
            </div>
          </div>
          {/* Monthly rent expected mini card */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-slate-700">Expected Rent</p>
              <div className="h-9 w-9 rounded-xl bg-primary-50 flex items-center justify-center">
                <CreditCard size={16} className="text-primary-500" />
              </div>
            </div>
            <div className="flex items-end gap-2 mb-3">
              <p className="text-2xl font-bold text-slate-800 leading-none">{fmt(d.financials.expectedRent)}</p>
            </div>
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Collected</span>
                <span className="font-semibold text-emerald-600">{fmt(d.financials.collectedRent)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Pending</span>
                <span className="font-semibold text-amber-600">{fmt(d.financials.pendingRent)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}

export default Dashboard
