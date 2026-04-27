import { useState, useEffect } from 'react'
import {
  Building2, BedDouble, Users, CreditCard,
  AlertTriangle, ChevronRight, RefreshCw,
  TrendingUp, TrendingDown, Plus,
  IndianRupee,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getPropertyDashboard, getRecentActivity } from '../api/dashboard'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import { useAuth } from '../context/AuthContext'
import Spinner from '../components/ui/Spinner'
import { DashboardSkeleton } from '../components/ui/Skeleton'

const useGreeting = () => {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  const h = now.getHours()
  const greeting = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
  const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
  const date = now.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  return { greeting, time, date }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt     = (n) => `₹${(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`
const pct     = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtPeriod  = (m, y) => `${MONTH_NAMES[(m ?? 1) - 1]} ${y ?? ''}`

const METHOD_LABELS = {
  cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank', cheque: 'Cheque', deposit_adjustment: 'Deposit',
}

// ── Donut chart ───────────────────────────────────────────────────────────────
const DonutChart = ({ occupied, reserved, total }) => {
  if (!total) return (
    <div className="relative h-28 w-28 shrink-0 flex items-center justify-center rounded-full bg-slate-100">
      <p className="text-[11px] text-slate-400 text-center leading-tight">No<br/>beds</p>
    </div>
  )
  const occDeg  = (occupied / total) * 360
  const resDeg  = (reserved / total) * 360
  const occRate = Math.round((occupied / total) * 100)
  const gradient = `conic-gradient(#3B82F6 0deg ${occDeg}deg, #F59E0B ${occDeg}deg ${occDeg + resDeg}deg, #22C55E ${occDeg + resDeg}deg 360deg)`

  return (
    <div className="relative h-28 w-28 shrink-0">
      <div className="h-full w-full rounded-full" style={{ background: gradient }} />
      <div className="absolute inset-[18%] rounded-full bg-white flex flex-col items-center justify-center"
        style={{ boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.06)' }}>
        <p className="text-[20px] font-bold text-slate-800 leading-none">{occRate}%</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Occupied</p>
      </div>
    </div>
  )
}

// ── Stats Row ─────────────────────────────────────────────────────────────────
const StatsRow = ({ beds, tenants, financials, navigate }) => {
  const { total: totalBeds, occupied, vacant, reserved } = beds
  const { active, onNotice, newCheckInsThisMonth } = tenants
  const { collectedRent, pendingDues, collectionRate } = financials

  const allClear = pendingDues === 0

  const stats = [
    {
      icon: Users,
      label: 'Active Tenants',
      value: active,
      sub: onNotice > 0 ? `${onNotice} on notice` : `${newCheckInsThisMonth} new this month`,
      color: '#60C3AD',
      bg: 'rgba(96,195,173,0.10)',
      to: '/tenants',
    },
    {
      icon: BedDouble,
      label: 'Beds Occupied',
      value: `${occupied}/${totalBeds}`,
      sub: vacant > 0 ? `${vacant} vacant` : reserved > 0 ? `${reserved} reserved` : 'Fully occupied',
      color: '#3B82F6',
      bg: 'rgba(59,130,246,0.10)',
      to: '/rooms',
    },
    {
      icon: IndianRupee,
      label: 'Collected',
      value: fmt(collectedRent),
      sub: `${collectionRate}% collection rate`,
      color: '#10B981',
      bg: 'rgba(16,185,129,0.10)',
      to: '/rent',
    },
    {
      icon: CreditCard,
      label: 'Pending Dues',
      value: allClear ? 'Clear' : fmt(pendingDues),
      sub: allClear ? 'All rents collected' : 'Outstanding balance',
      color: allClear ? '#10B981' : '#F59E0B',
      bg: allClear ? 'rgba(16,185,129,0.10)' : 'rgba(245,158,11,0.10)',
      to: '/rent',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map(({ icon: Icon, label, value, sub, color, bg, to }) => (
        <button key={label} type="button" onClick={() => navigate(to)}
          className="flex flex-col gap-3 p-4 rounded-2xl bg-white border border-slate-100 hover:border-slate-200 hover:shadow-sm active:scale-95 transition-all text-left">
          <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: bg }}>
            <Icon size={16} style={{ color }} />
          </div>
          <div>
            <p className="text-lg font-bold text-slate-800 tabular-nums leading-tight">{value}</p>
            <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wide mt-1">{label}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
          </div>
        </button>
      ))}
    </div>
  )
}

// ── Alerts ────────────────────────────────────────────────────────────────────
const AlertsSection = ({ financials, beds, navigate }) => {
  const overdueCount   = financials.breakdown?.overdue?.count  ?? 0
  const overdueAmt     = financials.breakdown?.overdue?.amount ?? 0
  const pendingCount   = financials.breakdown?.pending?.count  ?? 0
  const pendingAmt     = financials.breakdown?.pending?.amount ?? 0
  const hasRentRecords = financials.hasRentRecords ?? false

  const { status: bedStatus, total: totalBeds, occupied: occupiedBeds,
          extraOccupants = 0, vacant: vacantBeds = 0 } = beds

  // Use explicit backend flag — do not infer from count combinations
  const noRentGenerated = occupiedBeds > 0 && !hasRentRecords

  const lowOccupancy = totalBeds >= 4
    && occupiedBeds > 0
    && (occupiedBeds / totalBeds) < 0.5

  const hasIssues = overdueCount > 0
    || bedStatus === 'over_capacity'
    || bedStatus === 'invalid_state'
    || occupiedBeds === 0
    || totalBeds === 0
    || noRentGenerated

  // Only pending is suppressed in overdue mode — all other cards remain
  const overdueMode = overdueCount > 0

  if (!hasIssues) return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
        <p className="text-[12px] font-medium text-emerald-700">All rents collected · operations normal</p>
      </div>
      {/* Single insight in all-clear path: low occupancy takes priority over vacant */}
      {lowOccupancy ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <BedDouble size={13} className="text-slate-400 shrink-0" />
          <p className="text-[12px] font-medium text-slate-500">
            Low occupancy — {vacantBeds} {vacantBeds === 1 ? 'bed' : 'beds'} still vacant
          </p>
        </div>
      ) : vacantBeds > 0 ? (
        <div className="flex items-center gap-2.5 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
          <BedDouble size={13} className="text-blue-400 shrink-0" />
          <p className="text-[12px] font-medium text-blue-600">
            {vacantBeds} bed{vacantBeds !== 1 ? 's' : ''} available
          </p>
        </div>
      ) : null}
    </div>
  )

  // Isolated path: no beds configured — show nothing else
  if (totalBeds === 0 && bedStatus !== 'invalid_state') return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5">
      <BedDouble size={15} className="text-slate-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-slate-600">No beds configured yet</p>
        <p className="text-xs text-slate-400 mt-0.5">Add rooms and beds to start tracking occupancy</p>
      </div>
      <button type="button" onClick={() => navigate('/rooms')}
        className="shrink-0 flex items-center gap-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 active:scale-95 transition-all px-2.5 py-1.5 text-[11px] font-semibold text-slate-600">
        Add Beds
      </button>
    </div>
  )

  return (
    <div className="space-y-2">

      {/* 1. Invalid state — critical */}
      {bedStatus === 'invalid_state' && (
        <div className="flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3.5">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm font-bold text-red-700">
            Data inconsistency: tenants are assigned without any beds configured
          </p>
        </div>
      )}

      {/* 2. Over capacity — operational */}
      {bedStatus === 'over_capacity' && (
        <div className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3.5">
          <AlertTriangle size={16} className="text-orange-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-orange-700">
              {extraOccupants} extra occupant{extraOccupants !== 1 ? 's' : ''} beyond capacity
            </p>
            <p className="text-xs text-orange-500 mt-0.5">
              {totalBeds} {totalBeds === 1 ? 'bed' : 'beds'} · {occupiedBeds} {occupiedBeds === 1 ? 'tenant' : 'tenants'}
            </p>
          </div>
          <button type="button" onClick={() => navigate('/rooms')}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-orange-300 bg-white hover:bg-orange-50 active:scale-95 transition-all px-2.5 py-1.5 text-[11px] font-semibold text-orange-700">
            View Rooms
          </button>
        </div>
      )}

      {/* 3. Overdue rent — high priority financial */}
      {overdueCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
          <div className="h-8 w-8 rounded-lg bg-red-100 border border-red-200 flex items-center justify-center shrink-0">
            <IndianRupee size={14} className="text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-700">
              {overdueCount} tenant{overdueCount !== 1 ? 's' : ''} have overdue rent
            </p>
            <p className="text-xs text-red-500 mt-0.5">{fmt(overdueAmt)} overdue</p>
          </div>
          <button type="button" onClick={() => navigate('/rent')}
            className="shrink-0 flex items-center gap-1 rounded-lg bg-red-600 hover:bg-red-700 active:scale-95 transition-all px-3 py-1.5 text-[11px] font-bold text-white">
            Collect Rent
          </button>
        </div>
      )}

      {/* 4. Pending rent — hidden only when overdueMode */}
      {!overdueMode && pendingCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
          <div className="h-8 w-8 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
            <IndianRupee size={14} className="text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-700">
              {pendingCount} tenant{pendingCount !== 1 ? 's' : ''} have upcoming dues
            </p>
            <p className="text-xs text-amber-500 mt-0.5">{fmt(pendingAmt)} due this month</p>
          </div>
          <button type="button" onClick={() => navigate('/rent')}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-amber-300 bg-white hover:bg-amber-50 active:scale-95 transition-all px-2.5 py-1.5 text-[11px] font-semibold text-amber-700">
            View Details
          </button>
        </div>
      )}

      {/* 5. Rent not generated — explicit backend flag, not inferred */}
      {noRentGenerated && (
        <div className="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3.5">
          <AlertTriangle size={15} className="text-amber-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-amber-700">Rent not generated yet</p>
            <p className="text-xs text-amber-500 mt-0.5">Rent will be generated automatically when you open Rent section</p>
          </div>
          <button type="button" onClick={() => navigate('/rent')}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-amber-300 bg-white hover:bg-amber-50 active:scale-95 transition-all px-2.5 py-1.5 text-[11px] font-semibold text-amber-700">
            Go to Rent
          </button>
        </div>
      )}

      {/* 6. Single insight slot — exactly one shown, priority: zero occ > low occ > vacant */}
      {totalBeds > 0 && bedStatus !== 'invalid_state' && (
        occupiedBeds === 0 ? (
          <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
            <BedDouble size={13} className="text-slate-400 shrink-0" />
            <p className="text-[12px] font-medium text-slate-500">
              No tenants currently — {totalBeds} bed{totalBeds !== 1 ? 's' : ''} available
            </p>
          </div>
        ) : lowOccupancy ? (
          <div className="flex items-center gap-2.5 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
            <BedDouble size={13} className="text-slate-400 shrink-0" />
            <p className="text-[12px] font-medium text-slate-500">
              Low occupancy — {vacantBeds} {vacantBeds === 1 ? 'bed' : 'beds'} still vacant
            </p>
          </div>
        ) : vacantBeds > 0 ? (
          <div className="flex items-center gap-2.5 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
            <BedDouble size={13} className="text-blue-400 shrink-0" />
            <p className="text-[12px] font-medium text-blue-600">
              {vacantBeds} bed{vacantBeds !== 1 ? 's' : ''} available
            </p>
          </div>
        ) : null
      )}

    </div>
  )
}

// ── Financial Summary ─────────────────────────────────────────────────────────
const FinancialSummaryCard = ({ financials, period, navigate }) => {
  const { expectedRent, collectedRent, pendingDues, collectionRate, netIncome, totalExpenses } = financials
  const rateColor  = collectionRate >= 80 ? 'text-emerald-600' : collectionRate >= 50 ? 'text-amber-500' : 'text-red-500'
  const barColor   = collectionRate >= 80 ? 'bg-emerald-500'   : collectionRate >= 50 ? 'bg-amber-400'   : 'bg-red-500'
  const isPositive = (netIncome ?? 0) >= 0

  // Insight line
  let insight = null
  if (collectionRate === 100 && expectedRent > 0) {
    insight = { text: 'All payments collected for this month', positive: true }
  } else if (collectedRent === 0 && expectedRent > 0) {
    insight = { text: 'No payments collected yet — start collecting rent', positive: false }
  } else if (pendingDues > 0) {
    insight = { text: `${fmt(pendingDues)} total outstanding — collect payment or use deposit`, positive: false }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-slate-700">Financial Summary</p>
          <p className="text-xs text-slate-400 mt-0.5">{period}</p>
        </div>
        <button type="button" onClick={() => navigate('/rent')}
          className="flex items-center gap-1 text-[11px] font-semibold text-primary-500 hover:text-primary-600 transition-colors">
          View rent <ChevronRight size={11} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3 text-center">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">Expected this month</p>
          <p className="text-sm font-bold text-slate-700 tabular-nums">{fmt(expectedRent)}</p>
        </div>
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-center">
          <p className="text-[10px] font-semibold text-emerald-500 uppercase tracking-wide mb-1">Collected</p>
          <p className="text-sm font-bold text-emerald-700 tabular-nums">{fmt(collectedRent)}</p>
        </div>
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-center">
          <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide mb-1">Total Due</p>
          <p className="text-sm font-bold text-amber-700 tabular-nums">{fmt(pendingDues)}</p>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] text-slate-400">Collection rate</span>
          <span className={`text-xs font-bold ${rateColor}`}>{collectionRate}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-slate-100">
          <div className={`h-2 rounded-full transition-all duration-700 ${barColor}`}
            style={{ width: `${Math.min(collectionRate, 100)}%` }} />
        </div>
      </div>

      {insight && (
        <div className={`flex items-center gap-2 rounded-xl px-3.5 py-2.5 mb-3 border text-[11px] font-medium ${
          insight.positive
            ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
            : 'bg-amber-50 border-amber-100 text-amber-700'
        }`}>
          {insight.positive
            ? <TrendingUp size={12} className="text-emerald-500 shrink-0" />
            : <AlertTriangle size={12} className="text-amber-500 shrink-0" />}
          {insight.text}
        </div>
      )}

      <div className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 border ${isPositive ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'}`}>
        <div className="flex items-center gap-2">
          {isPositive
            ? <TrendingUp size={13} className="text-emerald-500 shrink-0" />
            : <TrendingDown size={13} className="text-red-500 shrink-0" />}
          <span className="text-[11px] font-medium text-slate-600">Net income</span>
          {totalExpenses > 0 && (
            <span className="text-[10px] text-slate-400">after {fmt(totalExpenses)} expenses</span>
          )}
        </div>
        <span className={`text-sm font-bold tabular-nums ${isPositive ? 'text-emerald-700' : 'text-red-600'}`}>
          {fmt(netIncome)}
        </span>
      </div>
    </div>
  )
}

// ── Recent Activity ───────────────────────────────────────────────────────────
const CHARGE_TYPE_LABELS = { damage: 'Damage', extra: 'Extra', penalty: 'Penalty', other: 'Charge' }

const ActivityRow = ({ item }) => {
  const isPayment = item._type === 'payment'
  return (
    <div className="flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50/60 transition-colors">
      <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 border ${
        isPayment ? 'bg-emerald-50 border-emerald-100' : 'bg-orange-50 border-orange-100'
      }`}>
        <span className={`text-[10px] font-bold ${isPayment ? 'text-emerald-600' : 'text-orange-600'}`}>
          {(item.tenant?.name ?? '?').slice(0, 2).toUpperCase()}
        </span>
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-700 truncate">{item.tenant?.name ?? '—'}</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {isPayment
            ? `${METHOD_LABELS[item.method] ?? item.method}${item.referenceId ? ` · ${item.referenceId}` : ''}`
            : `${CHARGE_TYPE_LABELS[item.chargeType] ?? 'Charge'}${item.description ? ` · ${item.description}` : ''}`
          }
        </p>
      </div>

      <div className="text-right shrink-0">
        <p className={`text-sm font-bold tabular-nums ${isPayment ? 'text-emerald-600' : 'text-orange-600'}`}>
          {isPayment ? '+' : '−'}{fmt(item.amount)}
        </p>
        <div className="flex items-center justify-end gap-1 mt-0.5">
          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
            isPayment ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-orange-600'
          }`}>
            {isPayment ? 'Payment' : 'Charge'}
          </span>
          <span className="text-[10px] text-slate-400">{fmtDate(item.createdAt)}</span>
        </div>
      </div>
    </div>
  )
}

const ACTIVITY_FILTERS = [
  { id: 'all',      label: 'All'      },
  { id: 'payment',  label: 'Payments' },
  { id: 'charge',   label: 'Charges'  },
]

const RecentActivityCard = ({ activity, loading, navigate }) => {
  const [filter, setFilter] = useState('all')

  const filtered = filter === 'all'
    ? activity
    : activity.filter(i => i._type === filter)
  const displayed = filtered.slice(0, 5)

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <p className="text-sm font-semibold text-slate-700">Recent Activity</p>
        <button type="button" onClick={() => navigate('/tenants')}
          className="flex items-center gap-1 text-[11px] font-semibold text-primary-500 hover:text-primary-600 transition-colors">
          View all <ChevronRight size={11} />
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-5 pt-3 pb-1">
        {ACTIVITY_FILTERS.map(({ id, label }) => (
          <button key={id} type="button" onClick={() => setFilter(id)}
            className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${
              filter === id
                ? 'bg-slate-800 text-white'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-6 flex justify-center"><Spinner /></div>
      ) : displayed.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-slate-400">
            {filter === 'all' ? 'No activity yet.' : `No ${filter}s found.`}
          </p>
          {filter === 'all' && (
            <button type="button" onClick={() => navigate('/tenants')}
              className="mt-2 text-xs font-semibold text-primary-500 hover:underline">
              Record first payment →
            </button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-slate-50">
          {displayed.map((item) => <ActivityRow key={item._id} item={item} />)}
        </div>
      )}
    </div>
  )
}

// ── Occupancy Card ────────────────────────────────────────────────────────────
const STATUS_STRIP = {
  full:          { label: 'Fully occupied',                     cls: 'bg-blue-50 border-blue-100 text-blue-700'     },
  no_capacity:   { label: 'No beds configured',                 cls: 'bg-slate-50 border-slate-200 text-slate-500'  },
}

const OccupancyCard = ({ beds }) => {
  const { total, occupied, vacant, reserved, status } = beds
  const items = [
    { label: 'Occupied', count: occupied, p: pct(occupied, total), color: '#3B82F6', bg: 'bg-blue-50',    text: 'text-blue-600'    },
    { label: 'Reserved', count: reserved, p: pct(reserved, total), color: '#F59E0B', bg: 'bg-amber-50',   text: 'text-amber-600'   },
    { label: 'Vacant',   count: vacant,   p: pct(vacant, total),   color: '#22C55E', bg: 'bg-emerald-50', text: 'text-emerald-600' },
  ]
  const strip = STATUS_STRIP[status]

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-semibold text-slate-700">Occupancy</p>
          <p className="text-xs text-slate-400 mt-0.5">{total} beds total</p>
        </div>
        <span className="text-[10px] font-semibold text-slate-400 bg-slate-50 border border-slate-200 rounded-full px-2.5 py-1">
          Live
        </span>
      </div>

      <div className="flex items-center gap-5 mb-4">
        <DonutChart occupied={occupied} reserved={reserved} vacant={vacant} total={total} />
        <div className="flex-1 space-y-2.5">
          {items.map(({ label, count, p, color, bg, text }) => (
            <div key={label}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                  <span className="text-[11px] font-medium text-slate-600">{label}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md ${bg} ${text}`}>{count}</span>
                  <span className="text-[10px] text-slate-400 w-6 text-right">{p}%</span>
                </div>
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-100">
                <div className="h-1.5 rounded-full transition-all duration-700" style={{ width: `${p}%`, background: color }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {total > 0 && (
        <div className="flex h-1.5 w-full rounded-full overflow-hidden gap-0.5 mb-3">
          {occupied > 0 && <div className="h-full bg-blue-500"   style={{ width: `${pct(occupied, total)}%` }} />}
          {reserved > 0 && <div className="h-full bg-amber-400"  style={{ width: `${pct(reserved, total)}%` }} />}
          {vacant   > 0 && <div className="h-full bg-emerald-400 flex-1" />}
        </div>
      )}

      {strip && (
        <div className={`flex items-center justify-center rounded-xl border px-3 py-2 text-[11px] font-semibold ${strip.cls}`}>
          {strip.label}
        </div>
      )}
    </div>
  )
}

// ── Tenant Summary ────────────────────────────────────────────────────────────
const TenantSummaryCard = ({ tenants, navigate }) => {
  const rows = [
    { label: 'Active',         value: tenants.active,               color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-100' },
    { label: 'On Notice',      value: tenants.onNotice,             color: 'text-amber-600',   bg: 'bg-amber-50',   border: 'border-amber-100'   },
    { label: 'New this month', value: tenants.newCheckInsThisMonth, color: 'text-blue-600',    bg: 'bg-blue-50',    border: 'border-blue-100'    },
  ]

  return (
    <button type="button" onClick={() => navigate('/tenants')}
      className="card p-5 w-full text-left hover:shadow-md transition-shadow cursor-pointer">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold text-slate-700">Tenants</p>
        <span className="flex items-center gap-1 text-[11px] font-semibold text-primary-500">
          View Tenants <ChevronRight size={11} />
        </span>
      </div>
      <div className="space-y-2 mb-3">
        {rows.map(({ label, value, color, bg, border }) => (
          <div key={label} className={`flex items-center justify-between rounded-xl px-3.5 py-2.5 ${bg} border ${border}`}>
            <span className="text-[12px] font-medium text-slate-600">{label}</span>
            <span className={`text-base font-bold tabular-nums ${color}`}>{value}</span>
          </div>
        ))}
      </div>
      <div className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50 hover:bg-slate-100 py-2 text-xs font-semibold text-slate-500 transition-colors">
        <Users size={12} /> Manage Tenants
      </div>
    </button>
  )
}

// ── No Property Empty State ───────────────────────────────────────────────────
const NoPropertyState = () => {
  const navigate = useNavigate()
  const features = [
    { icon: BedDouble,  label: 'Rooms & Beds',      desc: 'Manage rooms, beds, and occupancy'  },
    { icon: Users,      label: 'Tenant Management', desc: 'Track tenants, leases, and history' },
    { icon: CreditCard, label: 'Rent Collection',   desc: 'Collect and track rent payments'    },
    { icon: TrendingUp, label: 'Financial Reports',  desc: 'Ledger, charges, and summaries'     },
  ]

  return (
    <div className="px-4 py-8 pb-24 md:pb-8">
      <div className="w-full max-w-lg mx-auto">

        {/* Hero */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl mb-4 mx-auto"
            style={{ background: 'rgba(96,195,173,0.12)', border: '1.5px solid rgba(96,195,173,0.25)' }}>
            <Building2 size={28} style={{ color: '#60C3AD' }} />
          </div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">Welcome to DormAxis</h1>
          <p className="text-slate-400 mt-2 text-sm leading-relaxed max-w-xs mx-auto">
            Add your first property to start managing rooms, tenants, and rent.
          </p>
        </div>

        {/* CTA card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden mb-4">
          <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">Create your first property</p>
              <p className="text-xs text-slate-400 mt-0.5">Takes less than a minute to set up</p>
            </div>
            <button onClick={() => navigate('/properties')}
              className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: 'linear-gradient(135deg, #60C3AD 0%, #4aa897 100%)' }}>
              <Plus size={15} /> Add Property
            </button>
          </div>
          <div className="h-px bg-slate-100" />
          <div className="px-5 py-3 bg-slate-50/60">
            <p className="text-xs text-slate-400">
              <span className="md:hidden">Already have a property? Switch from the <span className="font-semibold text-slate-500">More</span> tab below.</span>
              <span className="hidden md:inline">Already have a property? Select it from the sidebar on the left.</span>
            </p>
          </div>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-2 gap-3">
          {features.map(({ icon: Icon, label, desc }) => (
            <div key={label} className="rounded-xl border border-slate-100 bg-white px-4 py-3.5 flex items-start gap-3">
              <div className="mt-0.5 shrink-0 flex h-8 w-8 items-center justify-center rounded-lg"
                style={{ background: 'rgba(96,195,173,0.10)', color: '#60C3AD' }}>
                <Icon size={15} />
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-700">{label}</p>
                <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
const Dashboard = () => {
  const { selectedProperty } = useProperty()
  const propertyId = selectedProperty?._id ?? ''
  const navigate   = useNavigate()
  const { user }   = useAuth()
  const { greeting, time, date } = useGreeting()

  const { data, loading, error, refetch } = useApi(
    () => propertyId ? getPropertyDashboard(propertyId) : Promise.resolve({ data: null }),
    [propertyId]
  )

  const [activity,        setActivity]        = useState([])
  const [activityLoading, setActivityLoading] = useState(false)

  useEffect(() => {
    if (!propertyId) { setActivity([]); return }
    setActivityLoading(true)
    getRecentActivity(propertyId)
      .then(res => setActivity(res.data?.data ?? []))
      .catch(() => setActivity([]))
      .finally(() => setActivityLoading(false))
  }, [propertyId])

  if (!propertyId) return <NoPropertyState />
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

  const period  = fmtPeriod(d.financials.month, d.financials.year)
  const heading = d.property?.name ?? selectedProperty?.name ?? ''

  return (
    <div className="space-y-3 sm:space-y-5 max-w-6xl">

      {/* Greeting */}
      <div>
        <p className="text-xl font-bold text-slate-800">{greeting}, {user?.name?.split(' ')[0]} 👋</p>
        <p className="text-xs text-slate-400 mt-0.5">{date} · {time}</p>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800">{heading}</h1>
          <p className="text-xs text-slate-400 mt-0.5">{period}</p>
        </div>
        <button type="button" onClick={refetch} className="btn-secondary text-xs gap-1.5 py-2">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <StatsRow beds={d.beds} tenants={d.tenants} financials={d.financials} navigate={navigate} />

      {/* Alerts */}
      <AlertsSection financials={d.financials} beds={d.beds} navigate={navigate} />

      {/* Main two-column layout */}
      <div className="grid gap-3 sm:gap-5 lg:grid-cols-5">

        {/* Left — Financial + Activity */}
        <div className="lg:col-span-3 space-y-3 sm:space-y-5">
          <FinancialSummaryCard financials={d.financials} period={period} navigate={navigate} />
          <RecentActivityCard activity={activity} loading={activityLoading} navigate={navigate} />
        </div>

        {/* Right — Occupancy + Tenants */}
        <div className="lg:col-span-2 space-y-3 sm:space-y-5">
          <OccupancyCard beds={d.beds} />
          <TenantSummaryCard tenants={d.tenants} navigate={navigate} />
        </div>
      </div>

    </div>
  )
}

export default Dashboard
