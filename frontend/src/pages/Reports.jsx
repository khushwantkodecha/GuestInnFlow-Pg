import { useState } from 'react'
import {
  BarChart3, TrendingUp, Clock, Receipt,
  CheckCircle2, AlertTriangle, CircleDollarSign,
  Zap, Droplets, UtensilsCrossed, Wrench, Wifi, Users, MoreHorizontal,
  CalendarDays,
} from 'lucide-react'
import api from '../api/axios'
import { useProperty } from '../context/PropertyContext'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import Badge from '../components/ui/Badge'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt   = (n) => `₹${(n ?? 0).toLocaleString('en-IN')}`
const fdate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const monthLabel = (m, y) => new Date(y, m - 1).toLocaleString('default', { month: 'long', year: 'numeric' })

// ── Quick date presets ────────────────────────────────────────────────────────
const today = new Date()
const iso = (d) => d.toISOString().slice(0, 10)

const PRESETS = [
  {
    label: 'This Month',
    from: iso(new Date(today.getFullYear(), today.getMonth(), 1)),
    to:   iso(today),
  },
  {
    label: 'Last Month',
    from: iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
    to:   iso(new Date(today.getFullYear(), today.getMonth(), 0)),
  },
  {
    label: 'Last 3 Months',
    from: iso(new Date(today.getFullYear(), today.getMonth() - 2, 1)),
    to:   iso(today),
  },
  {
    label: 'This Year',
    from: iso(new Date(today.getFullYear(), 0, 1)),
    to:   iso(today),
  },
]

// ── Expense type meta ─────────────────────────────────────────────────────────
const TYPE_META = {
  electricity: { icon: Zap,             bar: 'bg-yellow-400', badge: 'bg-yellow-50 text-yellow-700 border border-yellow-200',   iconCls: 'text-yellow-600' },
  water:       { icon: Droplets,        bar: 'bg-blue-400',   badge: 'bg-blue-50 text-blue-700 border border-blue-200',         iconCls: 'text-blue-600'   },
  food:        { icon: UtensilsCrossed, bar: 'bg-orange-400', badge: 'bg-orange-50 text-orange-700 border border-orange-200',   iconCls: 'text-orange-600' },
  maintenance: { icon: Wrench,          bar: 'bg-red-400',    badge: 'bg-red-50 text-red-700 border border-red-200',            iconCls: 'text-red-600'    },
  internet:    { icon: Wifi,            bar: 'bg-purple-400', badge: 'bg-purple-50 text-purple-700 border border-purple-200',   iconCls: 'text-purple-600' },
  salary:      { icon: Users,           bar: 'bg-emerald-400',badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200',iconCls: 'text-emerald-600'},
  other:       { icon: MoreHorizontal,  bar: 'bg-slate-300',  badge: 'bg-slate-100 text-slate-500 border border-slate-200',     iconCls: 'text-slate-400'  },
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
const TABS = [
  { id: 'income',       label: 'Income',      icon: TrendingUp },
  { id: 'pending-rent', label: 'Pending Rent', icon: Clock      },
  { id: 'expenses',     label: 'Expenses',    icon: Receipt    },
]

// ── Stat card ─────────────────────────────────────────────────────────────────
const StatCard = ({ label, value, sub, color = 'gray', progress }) => {
  const colors = {
    gray:   { bg: '',              val: 'text-slate-800'    },
    green:  { bg: '',              val: 'text-emerald-600'  },
    amber:  { bg: '',              val: 'text-amber-600'    },
    red:    { bg: 'border-red-200 !bg-red-50', val: 'text-red-600' },
    teal:   { bg: '',              val: 'text-primary-600'  },
  }
  const c = colors[color] ?? colors.gray
  const showRed = color === 'red' && value !== fmt(0)
  return (
    <div className={`card p-4 ${showRed ? c.bg : ''}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-xl font-bold ${c.val}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      {progress !== undefined && (
        <div className="mt-2">
          <div className="h-1.5 w-full rounded-full bg-slate-100">
            <div className="h-1.5 rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

// ── Income report ─────────────────────────────────────────────────────────────
const IncomeResult = ({ report }) => {
  const { totals, data: months } = report
  if (!months.length) return <div className="card border-dashed"><EmptyState message="No income data in this period" /></div>

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Billed"  value={fmt(totals.totalBilled)} color="teal" />
        <StatCard label="Collected"     value={fmt(totals.paid)}    color="green"
          sub={`${totals.collectionRate}% collection rate`} progress={totals.collectionRate} />
        <StatCard label="Pending"       value={fmt(totals.pending)} color="amber"
          sub={`${months.filter(m => m.pending > 0).length} month(s)`} />
        <StatCard label="Overdue"       value={fmt(totals.overdue)} color="red"
          sub={`${months.filter(m => m.overdue > 0).length} month(s)`} />
      </div>

      {/* Extra bed revenue breakdown — only shown when extra beds contributed */}
      {totals.extraBilled > 0 && (
        <div className="flex items-center justify-between rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[11px] font-bold text-violet-600 uppercase tracking-wide">✦ Extra Beds</span>
            <span className="text-[11px] text-violet-500 font-medium">
              {fmt(totals.extraBilled)} billed · {fmt(totals.extraPaid)} collected
            </span>
          </div>
          <span className="text-[11px] font-bold text-violet-600">
            {fmt(totals.normalBilled)} normal
          </span>
        </div>
      )}

      <div className="card overflow-hidden !p-0">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Monthly Breakdown</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {['Month', 'Total Billed', 'Collected', 'Pending', 'Overdue', 'Collection Rate'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {months.map((m) => (
                <tr key={`${m.year}-${m.month}`} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 text-sm font-medium text-slate-700">{monthLabel(m.month, m.year)}</td>
                  <td className="px-5 py-3.5 text-sm text-slate-600">{fmt(m.totalBilled)}</td>
                  <td className="px-5 py-3.5 text-sm font-semibold text-emerald-600">{fmt(m.paid)}</td>
                  <td className="px-5 py-3.5 text-sm text-amber-600">{fmt(m.pending)}</td>
                  <td className="px-5 py-3.5 text-sm text-red-600">{fmt(m.overdue)}</td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 rounded-full bg-slate-100">
                        <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${m.collectionRate}%` }} />
                      </div>
                      <span className="text-xs text-slate-500 font-medium">{m.collectionRate}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-2.5 flex justify-between text-xs text-slate-400">
          <span>{months.length} month{months.length !== 1 ? 's' : ''}</span>
          <span>Total collected: <span className="font-semibold text-slate-800">{fmt(totals.paid)}</span></span>
        </div>
      </div>
    </div>
  )
}

// ── Pending rent report ───────────────────────────────────────────────────────
const PendingResult = ({ report }) => {
  const { summary, data: records } = report
  if (!records.length) return <div className="card border-dashed"><EmptyState message="No pending rents in this period" /></div>

  const overdueCount  = records.filter(r => r.status === 'overdue').length
  const pendingCount  = records.filter(r => r.status === 'pending').length

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Pending" value={fmt(summary.pending)} color="amber" sub={`${pendingCount} record${pendingCount !== 1 ? 's' : ''}`} />
        <StatCard label="Overdue" value={fmt(summary.overdue)} color="red"   sub={`${overdueCount} record${overdueCount !== 1 ? 's' : ''}`} />
        <StatCard label="Total Unpaid" value={fmt(summary.total)} sub={`${records.length} total`} />
      </div>

      {overdueCount > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle size={15} className="shrink-0 text-red-500" />
          <p className="text-sm text-red-600 font-medium">
            {overdueCount} overdue record{overdueCount !== 1 ? 's' : ''} totalling <span className="font-bold">{fmt(summary.overdue)}</span>
          </p>
        </div>
      )}

      <div className="card overflow-hidden !p-0">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Unpaid Records</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {['Tenant', 'Property', 'Amount', 'Due Date', 'Status'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {records.map((r) => {
                const isOverdue = r.status === 'overdue'
                return (
                  <tr key={r._id}
                    className={`transition-colors hover:brightness-[0.97] ${isOverdue ? 'bg-red-50 border-l-[3px] border-l-red-400' : 'border-l-[3px] border-l-amber-400 bg-amber-50'}`}>
                    <td className="px-5 py-3.5">
                      <p className={`text-sm font-semibold ${isOverdue ? 'text-red-600' : 'text-slate-800'}`}>{r.tenant?.name ?? '—'}</p>
                      {r.tenant?.phone && <p className="text-xs text-slate-400 mt-0.5">{r.tenant.phone}</p>}
                    </td>
                    <td className="px-5 py-3.5 text-sm text-slate-500">{r.property?.name ?? '—'}</td>
                    <td className="px-5 py-3.5 text-sm font-bold text-slate-800">{fmt(r.amount)}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-500">{fdate(r.dueDate)}</td>
                    <td className="px-5 py-3.5"><Badge status={r.status} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-2.5 flex justify-between text-xs text-slate-400">
          <span>{records.length} record{records.length !== 1 ? 's' : ''}</span>
          <span>Total: <span className="font-semibold text-slate-800">{fmt(summary.total)}</span></span>
        </div>
      </div>
    </div>
  )
}

// ── Expense report ────────────────────────────────────────────────────────────
const ExpenseResult = ({ report }) => {
  const { grandTotal, byType, byMonth, data: records } = report
  if (!records.length) return <div className="card border-dashed"><EmptyState message="No expenses in this period" /></div>

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="card p-4 lg:col-span-1">
          <p className="text-xs text-slate-500 mb-1">Grand Total</p>
          <p className="text-2xl font-bold text-slate-800">{fmt(grandTotal)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{records.length} entries · {byType.length} categories</p>
        </div>
        {byType.slice(0, 3).map((t) => {
          const meta = TYPE_META[t._id] ?? TYPE_META.other
          return (
            <div key={t._id} className="card p-4">
              <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${meta.badge}`}>{t._id}</span>
              <p className="text-lg font-bold text-slate-800 mt-2">{fmt(t.total)}</p>
              <p className="text-xs text-slate-400">{t.count} record{t.count !== 1 ? 's' : ''}</p>
            </div>
          )
        })}
      </div>

      {/* Category breakdown */}
      {byType.length > 0 && (
        <div className="card p-5">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-4">By Category</p>
          <div className="space-y-3">
            {byType.map((t) => {
              const meta = TYPE_META[t._id] ?? TYPE_META.other
              const Icon = meta.icon
              const pct  = grandTotal > 0 ? Math.round((t.total / grandTotal) * 100) : 0
              return (
                <div key={t._id} className="flex items-center gap-3">
                  <div className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100">
                    <Icon size={13} className={meta.iconCls} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-600 capitalize">{t._id}</span>
                      <span className="text-xs font-semibold text-slate-800">{fmt(t.total)}</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100">
                      <div className={`h-1.5 rounded-full transition-all ${meta.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400 w-8 text-right">{pct}%</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Monthly trend */}
      {byMonth.length > 1 && (
        <div className="card overflow-hidden !p-0">
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Monthly Trend</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  {['Month', 'Total Spent', 'Entries'].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {byMonth.map((m) => (
                  <tr key={m.period} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 text-sm font-medium text-slate-700">{monthLabel(m.month, m.year)}</td>
                    <td className="px-5 py-3.5 text-sm font-bold text-slate-800">{fmt(m.total)}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-500">{m.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Full record list */}
      <div className="card overflow-hidden !p-0">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">All Records</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50">
                {['Category', 'Amount', 'Date', 'Property', 'Notes'].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {records.map((e) => {
                const meta = TYPE_META[e.type] ?? TYPE_META.other
                return (
                  <tr key={e._id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${meta.badge}`}>{e.type}</span>
                    </td>
                    <td className="px-5 py-3.5 text-sm font-bold text-slate-800">{fmt(e.amount)}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-500">{fdate(e.date)}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-500">{e.property?.name ?? '—'}</td>
                    <td className="px-5 py-3.5 text-sm text-slate-400 max-w-xs truncate">{e.notes || '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 bg-slate-50 px-5 py-2.5 flex justify-between text-xs text-slate-400">
          <span>{records.length} record{records.length !== 1 ? 's' : ''}</span>
          <span>Total: <span className="font-semibold text-slate-800">{fmt(grandTotal)}</span></span>
        </div>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const Reports = () => {
  const { selectedProperty } = useProperty()
  const propertyId = selectedProperty?._id ?? ''

  const [tab,     setTab]     = useState('income')
  const [from,    setFrom]    = useState(PRESETS[3].from) // This Year
  const [to,      setTo]      = useState(PRESETS[3].to)
  const [report,  setReport]  = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const runReport = async () => {
    setLoading(true)
    setError('')
    setReport(null)
    try {
      const params = { from, to, ...(propertyId ? { propertyId } : {}) }
      const res = await api.get(`/reports/${tab}`, { params })
      setReport(res.data)
    } catch (err) {
      setError(err.response?.data?.message || 'Error fetching report')
    } finally {
      setLoading(false)
    }
  }

  const applyPreset = (preset) => {
    setFrom(preset.from)
    setTo(preset.to)
    setReport(null)
  }

  return (
    <div className="space-y-5 max-w-6xl">

      {/* ── Report type tabs ── */}
      <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => { setTab(id); setReport(null) }}
            className={`flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === id
                ? 'bg-white text-primary-600 shadow-sm border border-slate-200'
                : 'text-slate-500 hover:bg-slate-100'
            }`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Date range */}
          <div>
            <label className="label">From</label>
            <input type="date" className="input" value={from} onChange={(e) => { setFrom(e.target.value); setReport(null) }} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="input" value={to} onChange={(e) => { setTo(e.target.value); setReport(null) }} />
          </div>

          <button className="btn-primary" onClick={runReport} disabled={loading}>
            <BarChart3 size={15} /> {loading ? 'Running…' : 'Run Report'}
          </button>
        </div>

        {/* Quick presets */}
        <div className="flex items-center gap-2">
          <CalendarDays size={13} className="text-slate-400 shrink-0" />
          <span className="text-xs text-slate-400 mr-1">Quick:</span>
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => applyPreset(p)}
              className={`rounded-lg border px-3 py-1 text-xs font-medium transition-colors ${
                from === p.from && to === p.to
                  ? 'border-primary-400 bg-primary-50 text-primary-600'
                  : 'border-slate-200 text-slate-500 hover:bg-slate-50'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          <AlertTriangle size={15} className="shrink-0" /> {error}
        </div>
      )}

      {/* ── Loading ── */}
      {loading && <Spinner />}

      {/* ── No report yet ── */}
      {!loading && !report && !error && (
        <div className="card border-dashed">
          <EmptyState
            message="Select filters and run a report"
            action={
              <button className="btn-primary" onClick={runReport}>
                <BarChart3 size={15} /> Run Report
              </button>
            }
          />
        </div>
      )}

      {/* ── Results ── */}
      {report && tab === 'income'       && <IncomeResult  report={report} />}
      {report && tab === 'pending-rent' && <PendingResult report={report} />}
      {report && tab === 'expenses'     && <ExpenseResult report={report} />}
    </div>
  )
}

export default Reports
