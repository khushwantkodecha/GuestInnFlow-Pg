import { useState } from 'react'
import {
  TrendingUp, TrendingDown, Wallet, ArrowDownLeft, ArrowUpRight,
  Zap, Droplets, UtensilsCrossed, Wrench, Wifi, Users, MoreHorizontal,
  Plus, Trash2, AlertTriangle, BarChart3,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import { getOverview, getCashFlow, getChartData } from '../api/accounting'
import { getExpenses, addExpense, deleteExpense } from '../api/expenses'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import { AddExpenseModal } from './Expenses'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt   = (n) => `₹${(Math.abs(n) ?? 0).toLocaleString('en-IN')}`
const fmtSigned = (n) => `${n >= 0 ? '+' : '-'}₹${Math.abs(n ?? 0).toLocaleString('en-IN')}`
const fdate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i).toLocaleString('default', { month: 'long' }),
}))

// ── Expense type meta ─────────────────────────────────────────────────────────
const TYPE_META = {
  electricity: { icon: Zap,             bg: 'bg-yellow-50',  border: 'border-yellow-200', iconCls: 'text-yellow-600', badge: 'bg-yellow-50 text-yellow-700 border border-yellow-200',  bar: 'bg-yellow-400' },
  water:       { icon: Droplets,        bg: 'bg-blue-50',    border: 'border-blue-200',   iconCls: 'text-blue-600',   badge: 'bg-blue-50 text-blue-700 border border-blue-200',          bar: 'bg-blue-400'   },
  food:        { icon: UtensilsCrossed, bg: 'bg-orange-50',  border: 'border-orange-200', iconCls: 'text-orange-600', badge: 'bg-orange-50 text-orange-700 border border-orange-200',    bar: 'bg-orange-400' },
  maintenance: { icon: Wrench,          bg: 'bg-red-50',     border: 'border-red-200',    iconCls: 'text-red-600',    badge: 'bg-red-50 text-red-700 border border-red-200',              bar: 'bg-red-400'    },
  internet:    { icon: Wifi,            bg: 'bg-purple-50',  border: 'border-purple-200', iconCls: 'text-purple-600', badge: 'bg-purple-50 text-purple-700 border border-purple-200',    bar: 'bg-purple-400' },
  salary:      { icon: Users,           bg: 'bg-emerald-50', border: 'border-emerald-200',iconCls: 'text-emerald-600',badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200', bar: 'bg-emerald-400'},
  other:       { icon: MoreHorizontal,  bg: 'bg-slate-50',   border: 'border-slate-200',  iconCls: 'text-slate-400',  badge: 'bg-slate-100 text-slate-500 border border-slate-200',       bar: 'bg-slate-300'  },
}
// ── Overview Cards ────────────────────────────────────────────────────────────
const OverviewCards = ({ data }) => {
  const cards = [
    {
      label: 'Total Revenue',
      value: fmt(data.revenue),
      sub: `${data.collectionRate}% collection rate`,
      icon: TrendingUp,
      iconBg: 'bg-emerald-50', iconColor: 'text-emerald-500',
      numColor: 'text-emerald-600',
      extra: (
        <div className="mt-2.5">
          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-700"
              style={{ width: `${data.collectionRate}%` }} />
          </div>
        </div>
      ),
    },
    {
      label: 'Total Expenses',
      value: fmt(data.totalExpense),
      sub: `${data.expenseBreakdown?.length ?? 0} categories`,
      icon: TrendingDown,
      iconBg: 'bg-red-50', iconColor: 'text-red-500',
      numColor: 'text-red-600',
    },
    {
      label: 'Net Profit',
      value: fmt(data.netProfit),
      sub: `${data.profitMargin >= 0 ? '+' : ''}${data.profitMargin}% margin`,
      icon: BarChart3,
      iconBg: data.netProfit >= 0 ? 'bg-primary-50' : 'bg-amber-50',
      iconColor: data.netProfit >= 0 ? 'text-primary-500' : 'text-amber-500',
      numColor: data.netProfit >= 0 ? 'text-slate-800' : 'text-amber-600',
      highlight: data.netProfit < 0,
    },
    {
      label: 'Pending Rent',
      value: fmt(data.pendingRent),
      sub: 'uncollected this month',
      icon: Wallet,
      iconBg: data.pendingRent > 0 ? 'bg-amber-50' : 'bg-slate-50',
      iconColor: data.pendingRent > 0 ? 'text-amber-500' : 'text-slate-400',
      numColor: data.pendingRent > 0 ? 'text-amber-600' : 'text-slate-300',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ label, value, sub, icon: Icon, iconBg, iconColor, numColor, extra, highlight }) => (
        <div key={label}
          className={`card p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5
            ${highlight ? 'border-amber-200 bg-amber-50/30' : ''}
          `}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`rounded-lg p-1.5 ${iconBg}`}><Icon size={14} className={iconColor} /></div>
            <span className="text-xs text-slate-500 font-medium">{label}</span>
          </div>
          <p className={`text-xl font-bold tabular-nums ${numColor}`}>{value}</p>
          <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
          {extra}
        </div>
      ))}
    </div>
  )
}

// ── P&L Section ───────────────────────────────────────────────────────────────
const ProfitLoss = ({ data }) => {
  const breakdown = data.expenseBreakdown ?? []
  const total = breakdown.reduce((s, b) => s + b.total, 0)

  return (
    <div className="card p-5">
      <h3 className="text-sm font-bold text-slate-700 mb-4">Profit & Loss</h3>
      <div className="space-y-4">

        {/* Revenue row */}
        <div className="flex items-center justify-between py-3 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            <span className="text-sm font-medium text-slate-700">Revenue</span>
            <span className="text-xs text-slate-400">(rent collected)</span>
          </div>
          <span className="text-sm font-bold text-emerald-600 tabular-nums">{fmt(data.revenue)}</span>
        </div>

        {/* Expenses by category */}
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Expenses</p>
          {breakdown.length === 0 ? (
            <p className="text-xs text-slate-300 italic">No expenses this period</p>
          ) : (
            breakdown.map(b => {
              const meta = TYPE_META[b._id] ?? TYPE_META.other
              const Icon = meta.icon
              const pct  = total > 0 ? Math.round((b.total / total) * 100) : 0
              return (
                <div key={b._id} className="flex items-center gap-3">
                  <div className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-lg border ${meta.bg} ${meta.border}`}>
                    <Icon size={11} className={meta.iconCls} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-600 capitalize">{b._id}</span>
                      <span className="text-xs font-semibold text-slate-700 tabular-nums">{fmt(b.total)}</span>
                    </div>
                    <div className="h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${meta.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-slate-400 w-7 text-right">{pct}%</span>
                </div>
              )
            })
          )}
        </div>

        {/* Total expenses */}
        <div className="flex items-center justify-between py-3 border-t border-slate-100">
          <span className="text-sm font-medium text-slate-600">Total Expenses</span>
          <span className="text-sm font-bold text-red-600 tabular-nums">− {fmt(data.totalExpense)}</span>
        </div>

        {/* Net Profit */}
        <div className={`flex items-center justify-between rounded-xl px-4 py-3 ${
          data.netProfit >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'
        }`}>
          <span className="text-sm font-bold text-slate-700">Net Profit</span>
          <span className={`text-base font-bold tabular-nums ${data.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {fmtSigned(data.netProfit)}
          </span>
        </div>

        {/* Analytics row */}
        <div className="grid grid-cols-2 gap-3 pt-1">
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 text-center">
            <p className="text-[10px] text-slate-400 font-medium">Collection Rate</p>
            <p className="text-sm font-bold text-slate-700 mt-0.5 tabular-nums">{data.collectionRate}%</p>
          </div>
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 text-center">
            <p className="text-[10px] text-slate-400 font-medium">Profit Margin</p>
            <p className={`text-sm font-bold mt-0.5 tabular-nums ${data.profitMargin >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {data.profitMargin >= 0 ? '+' : ''}{data.profitMargin}%
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Chart ─────────────────────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl bg-white border border-slate-200 shadow-lg px-4 py-3 text-xs">
      <p className="font-bold text-slate-700 mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4">
          <span style={{ color: p.color }} className="font-medium capitalize">{p.name}</span>
          <span className="font-bold text-slate-700 tabular-nums">₹{(p.value ?? 0).toLocaleString('en-IN')}</span>
        </div>
      ))}
    </div>
  )
}

const MonthlyChart = ({ propertyId, months }) => {
  const { data, loading } = useApi(
    () => propertyId ? getChartData(propertyId, { months }) : Promise.resolve({ data: null }),
    [propertyId, months]
  )
  const chartData = data?.data ?? []

  return (
    <div className="card p-5">
      <h3 className="text-sm font-bold text-slate-700 mb-5">Revenue vs Expenses vs Profit</h3>
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-100 border-t-primary-500" />
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex items-center justify-center py-12 text-sm text-slate-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData} barSize={10} barGap={3}
            margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 10, fill: '#94A3B8' }}
              axisLine={false} tickLine={false}
              tickFormatter={v => v >= 1000 ? `₹${(v/1000).toFixed(0)}k` : `₹${v}`}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: '#F8FAFC' }} />
            <Legend
              wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
              formatter={(v) => <span className="capitalize text-slate-500">{v}</span>}
            />
            <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[3,3,0,0]} />
            <Bar dataKey="expense" name="Expenses" fill="#f87171" radius={[3,3,0,0]} />
            <Bar dataKey="profit"  name="Profit"   fill="#60C3AD" radius={[3,3,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ── Cash Flow Table ───────────────────────────────────────────────────────────
const CashFlowTable = ({ propertyId, month, year }) => {
  const { data, loading } = useApi(
    () => propertyId ? getCashFlow(propertyId, { month, year }) : Promise.resolve({ data: null }),
    [propertyId, month, year]
  )
  const rows   = data?.data    ?? []
  const net    = data?.net     ?? 0
  const totalIn  = data?.totalIn  ?? 0
  const totalOut = data?.totalOut ?? 0

  return (
    <div className="card overflow-hidden !p-0">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">Cash Flow</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1 text-emerald-600 font-semibold">
            <ArrowDownLeft size={12} /> {fmt(totalIn)}
          </span>
          <span className="flex items-center gap-1 text-red-500 font-semibold">
            <ArrowUpRight size={12} /> {fmt(totalOut)}
          </span>
          <span className={`font-bold tabular-nums ${net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            Net: {fmtSigned(net)}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-100 border-t-primary-500" />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-slate-300">No transactions this period</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/80">
                {['Date', 'Description', 'Type', 'Amount'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map(row => {
                const isInflow = row.type === 'inflow'
                const meta = !isInflow ? (TYPE_META[row.label] ?? TYPE_META.other) : null
                const Icon = meta?.icon
                return (
                  <tr key={row._id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fdate(row.date)}</td>
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-slate-700 truncate max-w-[200px]">{row.label}</p>
                      {row.sub && <p className="text-xs text-slate-400 mt-0.5 capitalize truncate max-w-[200px]">{row.sub.replace('_', ' ')}</p>}
                    </td>
                    <td className="px-4 py-3">
                      {isInflow ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                          <ArrowDownLeft size={9} /> Inflow
                        </span>
                      ) : (
                        <span className={`inline-flex items-center gap-1 text-[10px] font-semibold border rounded-full px-2 py-0.5 ${meta?.badge ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                          {Icon && <Icon size={9} />}
                          <span className="capitalize">{row.label}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold tabular-nums ${isInflow ? 'text-emerald-600' : 'text-red-500'}`}>
                        {isInflow ? '+' : '−'}{fmt(row.amount)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="sticky bottom-0 px-4 py-2.5 border-t border-slate-100 bg-white flex items-center justify-between text-xs text-slate-400">
        <span>{rows.length} transaction{rows.length !== 1 ? 's' : ''}</span>
        <span className={`font-bold tabular-nums ${net >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
          Net: {fmtSigned(net)}
        </span>
      </div>
    </div>
  )
}

// ── Recent Expenses ───────────────────────────────────────────────────────────
const RecentExpenses = ({ propertyId, month, year, onAdd }) => {
  const [showAdd, setShowAdd] = useState(false)
  const [saving,  setSaving]  = useState(false)
  const toast = useToast()

  const { data, loading, refetch } = useApi(
    () => propertyId ? getExpenses(propertyId, { month, year }) : Promise.resolve({ data: null }),
    [propertyId, month, year]
  )
  const expenses = (data?.data ?? []).slice(0, 8)

  const handleAdd = async (form) => {
    setSaving(true)
    try {
      await addExpense(propertyId, { ...form, amount: Number(form.amount) })
      setShowAdd(false)
      refetch()
      onAdd?.()
      toast('Expense added', 'success')
    } catch (err) {
      toast(err.response?.data?.message || 'Error adding expense', 'error')
    } finally { setSaving(false) }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this expense?')) return
    try {
      await deleteExpense(propertyId, id)
      refetch()
      onAdd?.()
      toast('Expense deleted', 'success')
    } catch (err) {
      toast(err.response?.data?.message || 'Error', 'error')
    }
  }

  return (
    <div className="card overflow-hidden !p-0">
      <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-700">Recent Expenses</h3>
        <button onClick={() => setShowAdd(true)} className="btn-primary py-1.5 text-xs">
          <Plus size={13} /> Add
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-100 border-t-primary-500" />
        </div>
      ) : expenses.length === 0 ? (
        <div className="px-5 py-8 text-center">
          <p className="text-sm text-slate-300">No expenses this period</p>
          <button onClick={() => setShowAdd(true)} className="mt-3 text-xs text-primary-500 hover:underline">
            + Add expense
          </button>
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {expenses.map(e => {
            const meta = TYPE_META[e.type] ?? TYPE_META.other
            const Icon = meta.icon
            return (
              <div key={e._id} className="flex items-center gap-3 px-5 py-3 hover:bg-slate-50/80 transition-colors group">
                <div className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-lg border ${meta.bg} ${meta.border}`}>
                  <Icon size={12} className={meta.iconCls} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-slate-700 capitalize">{e.type}</p>
                  {e.notes && <p className="text-[10px] text-slate-400 truncate">{e.notes}</p>}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-slate-700 tabular-nums">{fmt(e.amount)}</p>
                  <p className="text-[10px] text-slate-400">{fdate(e.date)}</p>
                </div>
                <button onClick={() => handleDelete(e._id)}
                  className="opacity-0 group-hover:opacity-100 rounded-lg p-1 text-slate-300 hover:bg-red-50 hover:text-red-400 transition-all">
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {showAdd && (
        <AddExpenseModal onSubmit={handleAdd} onClose={() => setShowAdd(false)} saving={saving} />
      )}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const now = new Date()
const CHART_OPTIONS = [
  { value: 3, label: '3 months' },
  { value: 6, label: '6 months' },
  { value: 12, label: '12 months' },
]

const Accounting = () => {
  const { selectedProperty } = useProperty()
  const propertyId = selectedProperty?._id ?? ''

  const [month,      setMonth]      = useState(now.getMonth() + 1)
  const [year,       setYear]       = useState(now.getFullYear())
  const [chartRange, setChartRange] = useState(6)
  const [refetchKey, setRefetchKey] = useState(0)

  const { data: overviewData, loading: overviewLoading, refetch: refetchOverview } = useApi(
    () => propertyId ? getOverview(propertyId, { month, year }) : Promise.resolve({ data: null }),
    [propertyId, month, year, refetchKey]
  )

  const overview = overviewData?.data

  const handleExpenseChange = () => {
    setRefetchKey(k => k + 1)
  }

  return (
    <div className="space-y-5 max-w-7xl">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 leading-tight">Accounting</h2>
          {overview && (
            <p className="text-sm text-slate-400 mt-0.5">
              Revenue {fmt(overview.revenue)} · Expenses {fmt(overview.totalExpense)} · Net {fmtSigned(overview.netProfit)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-32 text-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <input type="number" className="input w-20 text-sm" value={year}
            onChange={e => setYear(Number(e.target.value))} />
        </div>
      </div>

      {!propertyId ? (
        <div className="card border-dashed">
          <EmptyState message="No property selected. Choose one from the sidebar." />
        </div>
      ) : overviewLoading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : (
        <>
          {/* ── Overview Cards ── */}
          {overview && <OverviewCards data={overview} />}

          {/* ── Net Loss Warning ── */}
          {overview && overview.netProfit < 0 && (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle size={15} className="shrink-0 text-amber-500" />
              <p className="text-sm text-amber-700 font-medium">
                Expenses exceed revenue by <span className="font-bold">{fmt(Math.abs(overview.netProfit))}</span> this period.
              </p>
            </div>
          )}

          {/* ── Chart + P&L ── */}
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-xs font-semibold text-slate-500">Monthly Trend</p>
                <select className="rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 focus:outline-none hover:border-slate-300 transition-colors cursor-pointer"
                  value={chartRange} onChange={e => setChartRange(Number(e.target.value))}>
                  {CHART_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <MonthlyChart propertyId={propertyId} months={chartRange} />
            </div>
            <div>
              {overview && <ProfitLoss data={overview} />}
            </div>
          </div>

          {/* ── Cash Flow + Recent Expenses ── */}
          <div className="grid gap-5 lg:grid-cols-2">
            <CashFlowTable propertyId={propertyId} month={month} year={year} />
            <RecentExpenses
              propertyId={propertyId}
              month={month}
              year={year}
              onAdd={() => { handleExpenseChange(); refetchOverview() }}
            />
          </div>
        </>
      )}
    </div>
  )
}

export default Accounting
