import { useState, useEffect } from 'react'
import {
  Building2, BedDouble, Users, CreditCard,
  AlertTriangle, ChevronRight, RefreshCw,
  TrendingUp, TrendingDown, Plus,
  IndianRupee, UserPlus,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { getPropertyDashboard, getRecentActivity } from '../api/dashboard'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import Spinner from '../components/ui/Spinner'
import { DashboardSkeleton } from '../components/ui/Skeleton'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt     = (n) => `₹${(n ?? 0).toLocaleString('en-IN')}`
const pct     = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0)
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const fmtPeriod  = (m, y) => `${MONTH_NAMES[(m ?? 1) - 1]} ${y ?? ''}`

const METHOD_LABELS = {
  cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank', cheque: 'Cheque', deposit_adjustment: 'Deposit',
}

// ── Donut chart ───────────────────────────────────────────────────────────────
const DonutChart = ({ occupied, reserved, vacant, total }) => {
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

// ── Quick Actions ─────────────────────────────────────────────────────────────
const QuickActions = ({ navigate }) => {
  const actions = [
    { icon: IndianRupee, label: 'Collect Payment',  desc: 'Collect rent',  to: '/tenants', bg: 'rgba(96,195,173,0.10)', color: '#60C3AD' },
    { icon: UserPlus,    label: 'Add New Tenant',   desc: 'Register new',  to: '/tenants', bg: 'rgba(59,130,246,0.10)', color: '#3B82F6' },
    { icon: Plus,        label: 'Add Extra Charge', desc: 'Bill a charge', to: '/tenants', bg: 'rgba(245,158,11,0.10)', color: '#F59E0B' },
  ]
  return (
    <div className="grid grid-cols-3 gap-3">
      {actions.map(({ icon: Icon, label, desc, to, bg, color }) => (
        <button key={label} type="button" onClick={() => navigate(to)}
          className="flex flex-col items-center gap-2.5 p-4 rounded-2xl bg-white border border-slate-100 hover:border-slate-200 hover:shadow-sm active:scale-95 transition-all text-center">
          <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: bg, color }}>
            <Icon size={18} />
          </div>
          <div>
            <p className="text-xs font-bold text-slate-700">{label}</p>
            <p className="text-[10px] text-slate-400 mt-0.5">{desc}</p>
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
  const totalDueCount  = overdueCount + pendingCount
  const totalDueAmount = overdueAmt + pendingAmt

  const { status: bedStatus, total: totalBeds, occupied: occupiedBeds,
          extraOccupants = 0, vacant: vacantBeds = 0 } = beds

  const hasIssues = totalDueCount > 0 || bedStatus === 'over_capacity' || bedStatus === 'invalid_state'

  if (!hasIssues) return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
        <p className="text-[12px] font-medium text-emerald-700">No issues — everything looks good</p>
      </div>
      {vacantBeds > 0 && (
        <div className="flex items-center gap-2.5 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
          <BedDouble size={13} className="text-blue-400 shrink-0" />
          <p className="text-[12px] font-medium text-blue-600">
            {vacantBeds} bed{vacantBeds !== 1 ? 's' : ''} available across this property
          </p>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-2">
      {/* Over-capacity alert */}
      {bedStatus === 'over_capacity' && (
        <div className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3.5">
          <AlertTriangle size={16} className="text-orange-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-orange-700">
              {extraOccupants} extra occupant{extraOccupants !== 1 ? 's' : ''} beyond capacity
            </p>
            <p className="text-xs text-orange-500 mt-0.5">
              Total beds: {totalBeds} · Occupied: {occupiedBeds}
            </p>
          </div>
          <button type="button" onClick={() => navigate('/rooms')}
            className="shrink-0 flex items-center gap-1 rounded-lg border border-orange-300 bg-white hover:bg-orange-50 active:scale-95 transition-all px-2.5 py-1.5 text-[11px] font-semibold text-orange-700">
            View Rooms <ChevronRight size={10} />
          </button>
        </div>
      )}

      {/* Invalid state — data inconsistency */}
      {bedStatus === 'invalid_state' && (
        <div className="flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3.5">
          <AlertTriangle size={16} className="text-red-500 shrink-0" />
          <p className="text-sm font-bold text-red-700">
            Data inconsistency: tenants assigned without beds
          </p>
        </div>
      )}

      {/* Dues alert */}
      {totalDueCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3.5">
          <div className="h-8 w-8 rounded-lg bg-red-100 border border-red-200 flex items-center justify-center shrink-0">
            <IndianRupee size={14} className="text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-red-700">
              {totalDueCount} tenant{totalDueCount !== 1 ? 's' : ''} have pending dues
            </p>
            <p className="text-xs text-red-500 mt-0.5">{fmt(totalDueAmount)} outstanding this month</p>
          </div>
          <button type="button" onClick={() => navigate('/rent')}
            className="shrink-0 flex items-center gap-1 rounded-lg bg-red-600 hover:bg-red-700 active:scale-95 transition-all px-3 py-1.5 text-[11px] font-bold text-white">
            View Dues <ChevronRight size={11} />
          </button>
        </div>
      )}
    </div>
  )
}

// ── Financial Summary ─────────────────────────────────────────────────────────
const FinancialSummaryCard = ({ financials, period, navigate }) => {
  const { expectedRent, collectedRent, pendingRent, collectionRate, netIncome, totalExpenses } = financials
  const rateColor  = collectionRate >= 80 ? 'text-emerald-600' : collectionRate >= 50 ? 'text-amber-500' : 'text-red-500'
  const barColor   = collectionRate >= 80 ? 'bg-emerald-500'   : collectionRate >= 50 ? 'bg-amber-400'   : 'bg-red-500'
  const isPositive = (netIncome ?? 0) >= 0

  // Insight line
  let insight = null
  if (collectionRate === 100 && expectedRent > 0) {
    insight = { text: 'All payments collected for this month', positive: true }
  } else if (collectedRent === 0 && expectedRent > 0) {
    insight = { text: 'No payments collected yet — start collecting rent', positive: false }
  } else if (pendingRent > 0) {
    insight = { text: `${fmt(pendingRent)} pending — collect payment or use deposit`, positive: false }
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
          <p className="text-[10px] font-semibold text-amber-500 uppercase tracking-wide mb-1">Remaining</p>
          <p className="text-sm font-bold text-amber-700 tabular-nums">{fmt(pendingRent)}</p>
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
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center h-20 w-20 rounded-3xl mb-5 mx-auto"
            style={{ background: 'rgba(96,195,173,0.12)', border: '1.5px solid rgba(96,195,173,0.25)' }}>
            <Building2 size={36} style={{ color: '#60C3AD' }} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Welcome to TenantInnFlow</h1>
          <p className="text-slate-400 mt-2 text-sm leading-relaxed max-w-sm mx-auto">
            Add your first property to start managing rooms, tenants, and rent — all in one place.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden mb-6">
          <div className="px-6 py-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">Create your first property</p>
              <p className="text-xs text-slate-400 mt-0.5">Takes less than a minute to set up</p>
            </div>
            <button onClick={() => navigate('/properties')}
              className="shrink-0 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: 'linear-gradient(135deg, #60C3AD 0%, #4aa897 100%)' }}>
              <Plus size={15} /> Add Property
            </button>
          </div>
          <div className="h-px bg-slate-100" />
          <div className="px-6 py-4 bg-slate-50/60">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-3">
              Or select an existing property from the sidebar
            </p>
          </div>
        </div>

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
    <div className="space-y-5 max-w-6xl">

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

      {/* Quick Actions */}
      <QuickActions navigate={navigate} />

      {/* Alerts */}
      <AlertsSection financials={d.financials} beds={d.beds} navigate={navigate} />

      {/* Main two-column layout */}
      <div className="grid gap-5 lg:grid-cols-5">

        {/* Left — Financial + Activity */}
        <div className="lg:col-span-3 space-y-5">
          <FinancialSummaryCard financials={d.financials} period={period} navigate={navigate} />
          <RecentActivityCard activity={activity} loading={activityLoading} navigate={navigate} />
        </div>

        {/* Right — Occupancy + Tenants */}
        <div className="lg:col-span-2 space-y-5">
          <OccupancyCard beds={d.beds} />
          <TenantSummaryCard tenants={d.tenants} navigate={navigate} />
        </div>
      </div>

    </div>
  )
}

export default Dashboard
