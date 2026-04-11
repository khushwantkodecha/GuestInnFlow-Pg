import { useState, useMemo } from 'react'
import {
  Plus, Trash2, Zap, Droplets, UtensilsCrossed, Wrench, Wifi,
  Users, MoreHorizontal, Receipt, CheckCircle2, XCircle, Clock,
  RefreshCw, PauseCircle, PlayCircle, BarChart3, Search, X,
  RotateCcw, Filter, ChevronDown, Tag, Home, Shield, Brush,
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import {
  getExpenses, addExpense, deleteExpense,
  approveExpense, rejectExpense, toggleRecurring, getExpenseAnalytics,
} from '../api/expenses'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'

// ── Constants ─────────────────────────────────────────────────────────────────
export const EXPENSE_CATEGORIES = [
  'electricity', 'water', 'food', 'maintenance', 'internet',
  'salary', 'rent', 'cleaning', 'security', 'taxes', 'other',
]

const now = new Date()
const iso = (d) => d.toISOString().slice(0, 10)

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i).toLocaleString('default', { month: 'long' }),
}))

export const TYPE_META = {
  electricity: { icon: Zap,             bg: 'bg-yellow-50',  border: 'border-yellow-200',  iconCls: 'text-yellow-600',  badge: 'bg-yellow-50 text-yellow-700 border border-yellow-200',   bar: 'bg-yellow-400'  },
  water:       { icon: Droplets,        bg: 'bg-blue-50',    border: 'border-blue-200',    iconCls: 'text-blue-600',    badge: 'bg-blue-50 text-blue-700 border border-blue-200',           bar: 'bg-blue-400'    },
  food:        { icon: UtensilsCrossed, bg: 'bg-orange-50',  border: 'border-orange-200',  iconCls: 'text-orange-600',  badge: 'bg-orange-50 text-orange-700 border border-orange-200',     bar: 'bg-orange-400'  },
  maintenance: { icon: Wrench,          bg: 'bg-red-50',     border: 'border-red-200',     iconCls: 'text-red-600',     badge: 'bg-red-50 text-red-700 border border-red-200',               bar: 'bg-red-400'     },
  internet:    { icon: Wifi,            bg: 'bg-purple-50',  border: 'border-purple-200',  iconCls: 'text-purple-600',  badge: 'bg-purple-50 text-purple-700 border border-purple-200',     bar: 'bg-purple-400'  },
  salary:      { icon: Users,           bg: 'bg-emerald-50', border: 'border-emerald-200', iconCls: 'text-emerald-600', badge: 'bg-emerald-50 text-emerald-700 border border-emerald-200',  bar: 'bg-emerald-400' },
  rent:        { icon: Home,            bg: 'bg-sky-50',     border: 'border-sky-200',     iconCls: 'text-sky-600',     badge: 'bg-sky-50 text-sky-700 border border-sky-200',               bar: 'bg-sky-400'     },
  cleaning:    { icon: Brush,           bg: 'bg-teal-50',    border: 'border-teal-200',    iconCls: 'text-teal-600',    badge: 'bg-teal-50 text-teal-700 border border-teal-200',            bar: 'bg-teal-400'    },
  security:    { icon: Shield,          bg: 'bg-indigo-50',  border: 'border-indigo-200',  iconCls: 'text-indigo-600',  badge: 'bg-indigo-50 text-indigo-700 border border-indigo-200',     bar: 'bg-indigo-400'  },
  taxes:       { icon: Receipt,         bg: 'bg-rose-50',    border: 'border-rose-200',    iconCls: 'text-rose-600',    badge: 'bg-rose-50 text-rose-700 border border-rose-200',            bar: 'bg-rose-400'    },
  other:       { icon: MoreHorizontal,  bg: 'bg-slate-50',   border: 'border-slate-200',   iconCls: 'text-slate-400',   badge: 'bg-slate-100 text-slate-500 border border-slate-200',        bar: 'bg-slate-300'   },
}

const PAYMENT_METHODS = ['cash', 'upi', 'bank_transfer', 'cheque', 'other']
const FREQUENCIES = ['daily', 'weekly', 'monthly']

const fmt   = (n) => `₹${(n ?? 0).toLocaleString('en-IN')}`
const fdate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const SELECT_CLS =
  'rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 ' +
  'transition-colors hover:border-slate-300 cursor-pointer'

// ── Status pill ───────────────────────────────────────────────────────────────
const StatusPill = ({ status }) => {
  const cfg = {
    approved: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
    pending:  { cls: 'bg-amber-50  text-amber-700  border-amber-200',     icon: Clock        },
    rejected: { cls: 'bg-red-50    text-red-700    border-red-200',       icon: XCircle      },
  }
  const { cls, icon: Icon } = cfg[status] ?? cfg.pending
  return (
    <span className={`inline-flex items-center gap-1 border rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${cls}`}>
      <Icon size={9} />
      {status}
    </span>
  )
}

// ── Summary cards ─────────────────────────────────────────────────────────────
const SummaryCards = ({ expenses }) => {
  const approved = expenses.filter(e => e.status === 'approved')
  const pending  = expenses.filter(e => e.status === 'pending')
  const total    = approved.reduce((s, e) => s + e.amount, 0)
  const pendingAmt = pending.reduce((s, e) => s + e.amount, 0)

  // Category breakdown
  const byCategory = {}
  approved.forEach(e => { byCategory[e.type] = (byCategory[e.type] ?? 0) + e.amount })
  const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {[
        {
          label: 'Total Spent',
          value: fmt(total),
          sub:   `${approved.length} approved`,
          icon: Receipt,
          iconBg: 'bg-primary-50', iconColor: 'text-primary-500',
          numColor: 'text-slate-800',
        },
        {
          label: 'Pending Approval',
          value: fmt(pendingAmt),
          sub:   `${pending.length} expense${pending.length !== 1 ? 's' : ''}`,
          icon: Clock,
          iconBg: 'bg-amber-50', iconColor: 'text-amber-500',
          numColor: pending.length > 0 ? 'text-amber-600' : 'text-slate-300',
          highlight: pending.length > 0,
        },
        {
          label: 'Top Category',
          value: topCategory ? topCategory[0].charAt(0).toUpperCase() + topCategory[0].slice(1) : '—',
          sub:   topCategory ? fmt(topCategory[1]) : 'no data',
          icon: Tag,
          iconBg: 'bg-violet-50', iconColor: 'text-violet-500',
          numColor: 'text-violet-600',
        },
        {
          label: 'Recurring Active',
          value: expenses.filter(e => e.isRecurring && e.isRecurringActive).length,
          sub:   'auto-scheduled',
          icon: RefreshCw,
          iconBg: 'bg-teal-50', iconColor: 'text-teal-500',
          numColor: 'text-teal-600',
        },
      ].map(({ label, value, sub, icon: Icon, iconBg, iconColor, numColor, highlight }) => (
        <div key={label}
          className={`card p-4 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5
            ${highlight ? 'border-amber-200 bg-amber-50/30' : ''}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`rounded-lg p-1.5 ${iconBg}`}><Icon size={14} className={iconColor} /></div>
            <span className="text-xs text-slate-500 font-medium">{label}</span>
          </div>
          <p className={`text-xl font-bold tabular-nums ${numColor}`}>{value}</p>
          <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
        </div>
      ))}
    </div>
  )
}

// ── Category breakdown bar ────────────────────────────────────────────────────
const CategoryBreakdown = ({ expenses }) => {
  const approved = expenses.filter(e => e.status === 'approved')
  const total = approved.reduce((s, e) => s + e.amount, 0)
  const byCategory = {}
  approved.forEach(e => { byCategory[e.type] = (byCategory[e.type] ?? 0) + e.amount })
  const sorted = Object.entries(byCategory).sort((a, b) => b[1] - a[1])
  if (!sorted.length) return null

  return (
    <div className="card p-5">
      <h3 className="text-sm font-bold text-slate-700 mb-4">Category Breakdown</h3>
      <div className="space-y-3">
        {sorted.map(([type, amt]) => {
          const meta = TYPE_META[type] ?? TYPE_META.other
          const Icon = meta.icon
          const pct  = total > 0 ? Math.round((amt / total) * 100) : 0
          return (
            <div key={type} className="flex items-center gap-3">
              <div className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-lg border ${meta.bg} ${meta.border}`}>
                <Icon size={12} className={meta.iconCls} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-medium text-slate-600 capitalize">{type}</span>
                  <span className="text-xs font-bold text-slate-700 tabular-nums">{fmt(amt)}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full rounded-full transition-all duration-500 ${meta.bar}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              <span className="shrink-0 text-[10px] text-slate-400 w-7 text-right">{pct}%</span>
            </div>
          )
        })}
      </div>
      <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between text-xs">
        <span className="text-slate-400">Total</span>
        <span className="font-bold text-slate-700 tabular-nums">{fmt(total)}</span>
      </div>
    </div>
  )
}

// ── Monthly trend chart ───────────────────────────────────────────────────────
const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-xl bg-white border border-slate-200 shadow-lg px-3 py-2 text-xs">
      <p className="font-bold text-slate-700 mb-1">{label}</p>
      <p className="text-red-500 font-semibold tabular-nums">₹{(payload[0]?.value ?? 0).toLocaleString('en-IN')}</p>
    </div>
  )
}

const MonthlyTrend = ({ propertyId, months }) => {
  const { data, loading } = useApi(
    () => propertyId ? getExpenseAnalytics(propertyId, { months }) : Promise.resolve({ data: null }),
    [propertyId, months]
  )
  const chartData = data?.data?.monthly ?? []

  return (
    <div className="card p-5">
      <h3 className="text-sm font-bold text-slate-700 mb-5">Monthly Trend</h3>
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-100 border-t-primary-500" />
        </div>
      ) : chartData.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-sm text-slate-300">No data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={chartData} barSize={14} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
            <YAxis
              tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false}
              tickFormatter={v => v >= 1000 ? `₹${(v/1000).toFixed(0)}k` : `₹${v}`}
            />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: '#FEF3C7' }} />
            <Bar dataKey="total" name="Expenses" fill="#f87171" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

// ── Reject Modal ──────────────────────────────────────────────────────────────
const RejectModal = ({ expense, onConfirm, onClose, saving }) => {
  const [reason, setReason] = useState('')
  return (
    <Modal title="Reject Expense" onClose={onClose}>
      <div className="mb-4 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
        <p className="text-sm font-semibold text-slate-700 capitalize">{expense.type}</p>
        <p className="text-xs text-slate-400 mt-0.5">{fmt(expense.amount)} · {fdate(expense.date)}</p>
      </div>
      <div className="mb-4">
        <label className="label">Reason (optional)</label>
        <textarea className="input resize-none" rows={3}
          placeholder="Why is this expense being rejected?"
          value={reason} onChange={e => setReason(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
        <button onClick={() => onConfirm(reason)} disabled={saving}
          className="btn-danger flex-1 justify-center">
          {saving ? 'Rejecting…' : 'Reject Expense'}
        </button>
      </div>
    </Modal>
  )
}

// ── Add Expense Modal ─────────────────────────────────────────────────────────
export const AddExpenseModal = ({ onSubmit, onClose, saving }) => {
  const [form, setForm] = useState({
    type: 'electricity',
    customLabel: '',
    amount: '',
    date: iso(now),
    paymentMethod: 'cash',
    notes: '',
    isRecurring: false,
    recurringFrequency: 'monthly',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal title="Add Expense" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); onSubmit(form) }} className="space-y-4">

        {/* Category grid */}
        <div>
          <label className="label">Category *</label>
          <div className="grid grid-cols-4 gap-2">
            {EXPENSE_CATEGORIES.map(t => {
              const meta = TYPE_META[t]
              const Icon = meta.icon
              const active = form.type === t
              return (
                <button key={t} type="button" onClick={() => set('type', t)}
                  className={`flex flex-col items-center gap-1.5 rounded-xl border py-3 px-1 text-[10px] font-medium capitalize transition-all ${
                    active
                      ? `${meta.border} ${meta.bg} ring-2 ring-offset-1 ring-primary-200`
                      : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                  }`}>
                  <Icon size={15} className={active ? meta.iconCls : 'text-slate-300'} />
                  {t}
                </button>
              )
            })}
          </div>
        </div>

        {/* Custom label for 'other' */}
        {form.type === 'other' && (
          <div>
            <label className="label">Custom Label</label>
            <input className="input" placeholder="e.g. Pest control"
              value={form.customLabel} onChange={e => set('customLabel', e.target.value)} />
          </div>
        )}

        {/* Amount + Date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Amount (₹) *</label>
            <input type="number" className="input" placeholder="0" min="1"
              value={form.amount} onChange={e => set('amount', e.target.value)} required />
          </div>
          <div>
            <label className="label">Date *</label>
            <input type="date" className="input"
              value={form.date} onChange={e => set('date', e.target.value)} required />
          </div>
        </div>

        {/* Payment method */}
        <div>
          <label className="label">Payment Method</label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {PAYMENT_METHODS.map(m => (
              <button key={m} type="button" onClick={() => set('paymentMethod', m)}
                className={`rounded-xl border px-2 py-2 text-xs font-medium capitalize transition-colors ${
                  form.paymentMethod === m
                    ? 'border-primary-400 bg-primary-50 text-primary-600'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}>
                {m.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Recurring toggle */}
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-slate-700">Recurring Expense</p>
              <p className="text-[10px] text-slate-400 mt-0.5">Auto-creates this expense on a schedule</p>
            </div>
            <button type="button" role="switch" aria-checked={form.isRecurring}
              onClick={() => set('isRecurring', !form.isRecurring)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.isRecurring ? 'bg-primary-500' : 'bg-slate-200'}`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${form.isRecurring ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
            </button>
          </div>
          {form.isRecurring && (
            <div>
              <label className="label text-xs">Frequency</label>
              <div className="grid grid-cols-3 gap-2">
                {FREQUENCIES.map(f => (
                  <button key={f} type="button" onClick={() => set('recurringFrequency', f)}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium capitalize transition-colors ${
                      form.recurringFrequency === f
                        ? 'border-primary-400 bg-primary-50 text-primary-600'
                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                    }`}>
                    {f}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-amber-600 font-medium mt-2">
                Next occurrence starts as pending and requires approval.
              </p>
            </div>
          )}
        </div>

        {/* Notes */}
        <div>
          <label className="label">Notes</label>
          <textarea className="input resize-none" rows={2} placeholder="Optional description…"
            value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>

        <div className="flex gap-2 pt-1 border-t border-slate-100">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            <Plus size={15} /> {saving ? 'Adding…' : 'Add Expense'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Expense row ───────────────────────────────────────────────────────────────
const ExpenseRow = ({ expense: e, onDelete, onApprove, onReject }) => {
  const meta = TYPE_META[e.type] ?? TYPE_META.other
  const Icon = meta.icon

  return (
    <tr className={`group transition-colors hover:bg-slate-50/80 ${e.status === 'pending' ? 'bg-amber-50/30' : ''}`}>
      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fdate(e.date)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <div className={`shrink-0 flex h-6 w-6 items-center justify-center rounded-lg border ${meta.bg} ${meta.border}`}>
            <Icon size={11} className={meta.iconCls} />
          </div>
          <div>
            <span className={`text-xs font-semibold capitalize ${meta.iconCls}`}>
              {e.type === 'other' && e.customLabel ? e.customLabel : e.type}
            </span>
            {e.isRecurring && (
              <span className="ml-1.5 text-[9px] font-bold text-teal-600 bg-teal-50 border border-teal-200 rounded-full px-1.5 py-0.5 inline-flex items-center gap-0.5">
                <RefreshCw size={7} /> {e.recurringFrequency}
              </span>
            )}
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="text-sm font-bold text-slate-800 tabular-nums">{fmt(e.amount)}</span>
      </td>
      <td className="px-4 py-3">
        <span className="text-xs text-slate-500 capitalize">
          {e.paymentMethod?.replace('_', ' ') ?? '—'}
        </span>
      </td>
      <td className="px-4 py-3">
        <StatusPill status={e.status} />
      </td>
      <td className="px-4 py-3 max-w-[160px]">
        <span className="text-xs text-slate-400 truncate block">{e.notes || '—'}</span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-0.5">
          {e.status === 'pending' && (
            <>
              <button onClick={() => onApprove(e._id)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-emerald-50 hover:text-emerald-600 transition-colors" title="Approve">
                <CheckCircle2 size={14} />
              </button>
              <button onClick={() => onReject(e)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors" title="Reject">
                <XCircle size={14} />
              </button>
            </>
          )}
          <button onClick={() => onDelete(e._id)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors" title="Delete">
            <Trash2 size={14} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Recurring templates panel ─────────────────────────────────────────────────
const RecurringPanel = ({ propertyId, onRefetch }) => {
  const toast = useToast()
  const { data, loading, refetch } = useApi(
    () => propertyId ? getExpenses(propertyId, { recurring: 'true' }) : Promise.resolve({ data: null }),
    [propertyId]
  )
  const templates = data?.data ?? []

  const handleToggle = async (id) => {
    try {
      const res = await toggleRecurring(propertyId, id)
      toast(res.data.message, 'success')
      refetch()
      onRefetch?.()
    } catch (err) {
      toast(err.response?.data?.message || 'Error', 'error')
    }
  }

  if (loading) return (
    <div className="card p-6 flex justify-center">
      <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-100 border-t-primary-500" />
    </div>
  )

  if (!templates.length) return (
    <div className="card border-dashed">
      <EmptyState message="No recurring expenses set up yet" />
    </div>
  )

  return (
    <div className="card overflow-hidden !p-0">
      <div className="px-5 py-4 border-b border-slate-100">
        <h3 className="text-sm font-bold text-slate-700">Recurring Templates</h3>
        <p className="text-xs text-slate-400 mt-0.5">Auto-generates pending expenses on schedule</p>
      </div>
      <div className="divide-y divide-slate-100">
        {templates.map(e => {
          const meta = TYPE_META[e.type] ?? TYPE_META.other
          const Icon = meta.icon
          return (
            <div key={e._id} className={`flex items-center gap-3 px-5 py-3.5 ${!e.isRecurringActive ? 'opacity-50' : ''}`}>
              <div className={`shrink-0 flex h-8 w-8 items-center justify-center rounded-xl border ${meta.bg} ${meta.border}`}>
                <Icon size={14} className={meta.iconCls} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-slate-700 capitalize">
                    {e.type === 'other' && e.customLabel ? e.customLabel : e.type}
                  </p>
                  <span className="text-[10px] font-bold text-teal-600 bg-teal-50 border border-teal-200 rounded-full px-2 py-0.5 capitalize">
                    {e.recurringFrequency}
                  </span>
                  {!e.isRecurringActive && (
                    <span className="text-[10px] font-bold text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
                      Paused
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {fmt(e.amount)} · Next: {fdate(e.recurringNextRun)}
                </p>
              </div>
              <button onClick={() => handleToggle(e._id)}
                className={`shrink-0 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  e.isRecurringActive
                    ? 'border-amber-200 bg-amber-50 text-amber-600 hover:bg-amber-100'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                }`}>
                {e.isRecurringActive
                  ? <><PauseCircle size={11} /> Pause</>
                  : <><PlayCircle  size={11} /> Resume</>
                }
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'list',      label: 'Expenses',  icon: Receipt  },
  { key: 'recurring', label: 'Recurring', icon: RefreshCw },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
]

const STATUS_FILTERS = [
  { key: 'all',      label: 'All'      },
  { key: 'approved', label: 'Approved' },
  { key: 'pending',  label: 'Pending'  },
  { key: 'rejected', label: 'Rejected' },
]

const Expenses = () => {
  const { selectedProperty } = useProperty()
  const propertyId = selectedProperty?._id ?? ''
  const toast = useToast()

  const [tab,          setTab]          = useState('list')
  const [month,        setMonth]        = useState(now.getMonth() + 1)
  const [year,         setYear]         = useState(now.getFullYear())
  const [typeFilter,   setTypeFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search,       setSearch]       = useState('')
  const [showAdd,      setShowAdd]      = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejecting,    setRejecting]    = useState(false)
  const [showFilters,  setShowFilters]  = useState(false)
  const [chartRange,   setChartRange]   = useState(6)

  const { data, loading, refetch } = useApi(
    () => propertyId
      ? getExpenses(propertyId, {
          month, year,
          ...(typeFilter   !== 'all' ? { type:   typeFilter   } : {}),
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
        })
      : Promise.resolve({ data: null }),
    [propertyId, month, year, typeFilter, statusFilter]
  )

  const allExpenses = data?.data ?? []

  // Client-side search
  const expenses = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return allExpenses
    return allExpenses.filter(e =>
      e.type.includes(q) ||
      (e.customLabel ?? '').toLowerCase().includes(q) ||
      (e.notes ?? '').toLowerCase().includes(q)
    )
  }, [allExpenses, search])

  const pendingCount = allExpenses.filter(e => e.status === 'pending').length

  // Counts for status filter
  const statusCounts = useMemo(() => {
    const all = data?.data ?? []
    return {
      all:      all.length,
      approved: all.filter(e => e.status === 'approved').length,
      pending:  all.filter(e => e.status === 'pending').length,
      rejected: all.filter(e => e.status === 'rejected').length,
    }
  }, [data])

  const hasActiveFilters = typeFilter !== 'all' || statusFilter !== 'all' || search !== ''

  const handleAdd = async (form) => {
    setSaving(true)
    try {
      await addExpense(propertyId, { ...form, amount: Number(form.amount) })
      setShowAdd(false)
      refetch()
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
      toast('Expense deleted', 'success')
    } catch (err) {
      toast(err.response?.data?.message || 'Error', 'error')
    }
  }

  const handleApprove = async (id) => {
    try {
      await approveExpense(propertyId, id)
      refetch()
      toast('Expense approved', 'success')
    } catch (err) {
      toast(err.response?.data?.message || 'Error', 'error')
    }
  }

  const handleReject = async (reason) => {
    setRejecting(true)
    try {
      await rejectExpense(propertyId, rejectTarget._id, reason)
      setRejectTarget(null)
      refetch()
      toast('Expense rejected', 'success')
    } catch (err) {
      toast(err.response?.data?.message || 'Error', 'error')
    } finally { setRejecting(false) }
  }

  const resetFilters = () => {
    setTypeFilter('all')
    setStatusFilter('all')
    setSearch('')
  }

  return (
    <div className="space-y-5 max-w-7xl">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 leading-tight">Expenses</h2>
          {allExpenses.length > 0 && (
            <p className="text-sm text-slate-400 mt-0.5">
              {statusCounts.approved} approved · {statusCounts.pending} pending · {statusCounts.rejected} rejected
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-32 text-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <input type="number" className="input w-20 text-sm" value={year}
            onChange={e => setYear(Number(e.target.value))} />
          {propertyId && (
            <button className="btn-primary" onClick={() => setShowAdd(true)}>
              <Plus size={16} /> Add Expense
            </button>
          )}
        </div>
      </div>

      {!propertyId ? (
        <div className="card border-dashed">
          <EmptyState message="No property selected. Choose one from the sidebar." />
        </div>
      ) : (
        <>
          {/* ── Tabs ── */}
          <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1 w-fit">
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  tab === key ? 'bg-primary-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
                }`}>
                <Icon size={12} />{label}
                {key === 'list' && pendingCount > 0 && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none ${
                    tab === key ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-600'
                  }`}>{pendingCount}</span>
                )}
              </button>
            ))}
          </div>

          {/* ── ANALYTICS TAB ── */}
          {tab === 'analytics' && (
            <div className="space-y-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-500">Expense Trends</p>
                <select className={SELECT_CLS} value={chartRange} onChange={e => setChartRange(Number(e.target.value))}>
                  <option value={3}>3 months</option>
                  <option value={6}>6 months</option>
                  <option value={12}>12 months</option>
                </select>
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <MonthlyTrend propertyId={propertyId} months={chartRange} />
                <CategoryBreakdown expenses={allExpenses} />
              </div>
              {allExpenses.length > 0 && <SummaryCards expenses={allExpenses} />}
            </div>
          )}

          {/* ── RECURRING TAB ── */}
          {tab === 'recurring' && (
            <RecurringPanel propertyId={propertyId} onRefetch={refetch} />
          )}

          {/* ── LIST TAB ── */}
          {tab === 'list' && (
            <>
              {/* Summary Cards */}
              {allExpenses.length > 0 && <SummaryCards expenses={allExpenses} />}

              {/* Pending approval alert */}
              {pendingCount > 0 && (
                <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <Clock size={15} className="shrink-0 text-amber-500" />
                  <p className="flex-1 text-sm text-amber-700 font-medium">
                    {pendingCount} expense{pendingCount > 1 ? 's require' : ' requires'} approval.
                  </p>
                  <button onClick={() => setStatusFilter('pending')}
                    className="text-xs font-semibold text-amber-600 hover:text-amber-800 transition-colors">
                    Review →
                  </button>
                </div>
              )}

              {/* Filter bar */}
              <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm py-2 -mx-1 px-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Search */}
                  <div className="relative flex-1 min-w-[180px]">
                    <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input className="input pl-8 py-1.5 text-sm w-full"
                      placeholder="Search category or notes…"
                      value={search} onChange={e => setSearch(e.target.value)} />
                    {search && (
                      <button onClick={() => setSearch('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {/* Status filter */}
                  <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
                    {STATUS_FILTERS.map(({ key, label }) => (
                      <button key={key} onClick={() => setStatusFilter(key)}
                        className={`rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                          statusFilter === key ? 'bg-primary-500 text-white' : 'text-slate-500 hover:bg-slate-50'
                        }`}>
                        {label}
                        {key !== 'all' && statusCounts[key] > 0 && statusFilter !== key && (
                          <span className={`ml-1 text-[9px] font-bold ${key === 'pending' ? 'text-amber-500' : ''}`}>
                            {statusCounts[key]}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  {/* Category filter */}
                  <button onClick={() => setShowFilters(v => !v)}
                    className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors ${
                      typeFilter !== 'all' ? 'border-primary-300 bg-primary-50 text-primary-600' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}>
                    <Filter size={11} />
                    {typeFilter !== 'all' ? typeFilter : 'Category'}
                    <ChevronDown size={10} className={`transition-transform ${showFilters ? 'rotate-180' : ''}`} />
                  </button>

                  {hasActiveFilters && (
                    <button onClick={resetFilters}
                      className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition-colors">
                      <RotateCcw size={11} /> Reset
                    </button>
                  )}
                </div>

                {/* Expanded category filter */}
                {showFilters && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <button onClick={() => { setTypeFilter('all'); setShowFilters(false) }}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                        typeFilter === 'all' ? 'bg-primary-500 border-primary-500 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      }`}>
                      All
                    </button>
                    {EXPENSE_CATEGORIES.map(t => {
                      const meta = TYPE_META[t]
                      const Icon = meta.icon
                      const active = typeFilter === t
                      return (
                        <button key={t} onClick={() => { setTypeFilter(t); setShowFilters(false) }}
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                            active ? 'bg-primary-500 border-primary-500 text-white' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                          }`}>
                          <Icon size={10} className={active ? 'text-white' : meta.iconCls} /> {t}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Expense table */}
              {loading ? (
                <div className="flex justify-center py-16"><Spinner /></div>
              ) : expenses.length === 0 ? (
                <div className="card border-dashed">
                  <EmptyState
                    message={hasActiveFilters ? 'No expenses match your filters' : 'No expenses recorded this period'}
                    action={
                      hasActiveFilters
                        ? <button className="btn-secondary text-sm" onClick={resetFilters}><RotateCcw size={13} /> Clear filters</button>
                        : <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Add Expense</button>
                    }
                  />
                </div>
              ) : (
                <div className="card overflow-hidden !p-0">
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50/80">
                          {['Date', 'Category', 'Amount', 'Method', 'Status', 'Notes', ''].map(h => (
                            <th key={h} className="px-4 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {expenses.map(e => (
                          <ExpenseRow
                            key={e._id}
                            expense={e}
                            onDelete={handleDelete}
                            onApprove={handleApprove}
                            onReject={setRejectTarget}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Footer */}
                  <div className="sticky bottom-0 z-10 px-4 py-2.5 border-t border-slate-100 bg-white flex items-center justify-between flex-wrap gap-2">
                    <p className="text-xs text-slate-400">
                      {expenses.length} record{expenses.length !== 1 ? 's' : ''}
                      {hasActiveFilters && ` · filtered from ${allExpenses.length}`}
                    </p>
                    <p className="text-xs text-slate-500">
                      Approved total: <span className="font-bold text-slate-800 tabular-nums">
                        {fmt(expenses.filter(e => e.status === 'approved').reduce((s, e) => s + e.amount, 0))}
                      </span>
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* ── Modals ── */}
      {showAdd && (
        <AddExpenseModal onSubmit={handleAdd} onClose={() => setShowAdd(false)} saving={saving} />
      )}
      {rejectTarget && (
        <RejectModal
          expense={rejectTarget}
          onConfirm={handleReject}
          onClose={() => setRejectTarget(null)}
          saving={rejecting}
        />
      )}
    </div>
  )
}

export default Expenses
