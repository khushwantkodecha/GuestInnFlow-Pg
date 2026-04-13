import { useState, useMemo, useCallback } from 'react'
import {
  CheckCircle2, Zap, AlertTriangle, Clock, TrendingUp,
  CircleDollarSign, MessageCircle, Copy, Check,
  Search, X, RotateCcw, BedDouble, IndianRupee,
  Calendar, ChevronRight, Download, ArrowDownCircle,
  ArrowUpCircle, Wallet, CreditCard,
} from 'lucide-react'
import { getRents, generateRent, recordPayment, getTenantLedger, sendRentReminder } from '../api/rent'
import { getTenantRents } from '../api/tenants'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'
import Drawer from '../components/ui/Drawer'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt   = (n) => `₹${(n ?? 0).toLocaleString('en-IN')}`
const fdate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const fdateTime = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const daysOverdue = (dueDate) => Math.max(0, Math.floor((Date.now() - new Date(dueDate)) / 86400000))

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i).toLocaleString('default', { month: 'long' }),
}))
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const waLink = (phone = '') => `https://wa.me/${phone.replace(/[^\d]/g, '')}`

// ── Status pill ───────────────────────────────────────────────────────────────
const StatusPill = ({ status }) => {
  const cfg = {
    paid:    'bg-emerald-50 text-emerald-700 border border-emerald-200',
    pending: 'bg-amber-50 text-amber-700 border border-amber-200',
    partial: 'bg-orange-50 text-orange-700 border border-orange-200',
    overdue: 'bg-red-50 text-red-700 border border-red-200',
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold capitalize ${cfg[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status === 'overdue' && <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />}
      {status === 'paid'    && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
      {status === 'pending' && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
      {status === 'partial' && <span className="h-1.5 w-1.5 rounded-full bg-orange-400" />}
      {status}
    </span>
  )
}

// ── Summary Cards ─────────────────────────────────────────────────────────────
const SummaryCards = ({ rents, statusFilter, onFilter }) => {
  const expected  = rents.reduce((s, r) => s + r.amount, 0)
  const collected = rents.reduce((s, r) => r.status === 'paid' ? s + r.amount : s + (r.paidAmount ?? 0), 0)
  const pending   = rents.filter(r => r.status === 'pending').reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0)
  const overdueAmt = rents.filter(r => r.status === 'overdue').reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0)
  const overdueCount = rents.filter(r => r.status === 'overdue').length
  const rate = expected > 0 ? Math.round((collected / expected) * 100) : 0

  const cards = [
    {
      key: 'all', label: 'Expected', value: fmt(expected),
      sub: `${rents.length} records`, icon: TrendingUp,
      iconBg: 'bg-primary-50', iconColor: 'text-primary-500',
      numColor: 'text-slate-800',
    },
    {
      key: 'paid', label: 'Collected', value: fmt(collected),
      sub: `${rate}% collection rate`, icon: CheckCircle2,
      iconBg: 'bg-emerald-50', iconColor: 'text-emerald-500',
      numColor: 'text-emerald-600',
      extra: (
        <div className="mt-2.5">
          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${rate}%` }} />
          </div>
        </div>
      ),
    },
    {
      key: 'pending', label: 'Pending', value: fmt(pending),
      sub: `${rents.filter(r => r.status === 'pending').length} tenants`,
      icon: Clock,
      iconBg: 'bg-amber-50', iconColor: 'text-amber-500',
      numColor: 'text-amber-600',
    },
    {
      key: 'overdue', label: 'Overdue', value: fmt(overdueAmt),
      sub: `${overdueCount} tenant${overdueCount !== 1 ? 's' : ''}`,
      icon: AlertTriangle,
      iconBg: 'bg-red-50', iconColor: 'text-red-500',
      numColor: overdueCount > 0 ? 'text-red-600' : 'text-slate-300',
      highlight: overdueCount > 0,
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ key, label, value, sub, icon: Icon, iconBg, iconColor, numColor, extra, highlight }) => (
        <button key={key} onClick={() => onFilter(key)}
          className={`card p-4 text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]
            ${statusFilter === key ? 'ring-2 ring-primary-400 border-primary-300' : ''}
            ${highlight ? 'border-red-200 bg-red-50/50' : ''}`}
        >
          <div className="flex items-center gap-2 mb-2">
            <div className={`rounded-lg p-1.5 ${iconBg}`}><Icon size={14} className={iconColor} /></div>
            <span className="text-xs text-slate-500 font-medium">{label}</span>
          </div>
          <p className={`text-xl font-bold tabular-nums ${numColor}`}>{value}</p>
          <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
          {extra}
        </button>
      ))}
    </div>
  )
}

// ── Bulk Bar ──────────────────────────────────────────────────────────────────
const BulkBar = ({ count, onRemind, onExport, onClear }) => (
  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 rounded-2xl bg-slate-900 px-5 py-3 shadow-2xl ring-1 ring-black/10 animate-scaleIn">
    <span className="text-sm font-semibold text-white tabular-nums">{count} selected</span>
    <div className="h-4 w-px bg-slate-700 mx-1" />
    <button onClick={onRemind}
      className="flex items-center gap-1.5 rounded-xl bg-green-500 hover:bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors">
      <MessageCircle size={12} /> Send Reminders
    </button>
    <button onClick={onExport}
      className="flex items-center gap-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors">
      <Download size={12} /> Export
    </button>
    <button onClick={onClear} className="rounded-lg p-1.5 text-slate-500 hover:text-white transition-colors">
      <X size={14} />
    </button>
  </div>
)

// ── Rent Row ──────────────────────────────────────────────────────────────────
const RentRow = ({ rent: r, selected, onSelect, onMarkPaid, onRemind, onLedger, reminding, reminded }) => {
  const isOverdue  = r.status === 'overdue'
  const isPending  = r.status === 'pending'
  const days       = isOverdue ? daysOverdue(r.dueDate) : 0
  const bed        = r.tenant?.bed
  const roomNum    = bed?.room?.roomNumber
  const bedNum     = bed?.bedNumber
  const balance    = r.tenant?.ledgerBalance ?? null
  const wasReminded = reminded && r.tenant?._id && reminded.has(r.tenant._id)

  return (
    <tr className={`group transition-colors cursor-pointer
      ${selected ? 'bg-primary-50/40' : 'hover:bg-slate-50/80'}
    `} onClick={() => onLedger(r.tenant)}>

      {/* Checkbox */}
      <td className="pl-4 pr-2 py-3 w-10" onClick={e => { e.stopPropagation(); onSelect(r._id) }}>
        <div className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
          selected ? 'bg-primary-500 border-primary-500' : 'border-slate-300 group-hover:border-primary-400'
        }`}>
          {selected && <Check size={10} className="text-white" strokeWidth={3} />}
        </div>
      </td>

      {/* Tenant */}
      <td className="px-3 py-3">
        <p className={`text-sm font-semibold leading-tight ${isOverdue ? 'text-red-600' : 'text-slate-800'}`}>
          {r.tenant?.name ?? '—'}
        </p>
        {r.tenant?.phone && (
          <p className="text-xs text-slate-400 mt-0.5">{r.tenant.phone}</p>
        )}
        {balance !== null && balance < 0 && (
          <p className="text-[10px] font-semibold text-emerald-600 mt-0.5">
            {fmt(Math.abs(balance))} advance credit
          </p>
        )}
        {wasReminded && (
          <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-green-50 border border-green-200 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">
            <MessageCircle size={9} /> Reminder Sent
          </span>
        )}
      </td>

      {/* Room / Bed */}
      <td className="px-3 py-3">
        {roomNum
          ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5">
              <BedDouble size={11} />
              R{roomNum}{bedNum ? ` / B${bedNum}` : ''}
            </span>
          : <span className="text-xs text-slate-300">—</span>
        }
      </td>

      {/* Amount */}
      <td className="px-3 py-3">
        <p className={`text-sm font-bold tabular-nums ${isOverdue ? 'text-red-600' : 'text-slate-800'}`}>
          {fmt(r.amount)}
        </p>
        {(r.paidAmount ?? 0) > 0 && r.status !== 'paid' && (
          <p className="text-xs text-amber-600 font-medium mt-0.5">
            {fmt(r.paidAmount)} paid · {fmt(r.amount - r.paidAmount)} due
          </p>
        )}
      </td>

      {/* Due Date */}
      <td className="px-3 py-3">
        <p className={`text-sm ${isOverdue ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
          {fdate(r.dueDate)}
        </p>
        {isOverdue && days > 0 && (
          <p className="text-[10px] font-semibold text-red-500 mt-0.5 flex items-center gap-0.5">
            <AlertTriangle size={9} /> {days}d overdue
          </p>
        )}
      </td>

      {/* Status */}
      <td className="px-3 py-3">
        <StatusPill status={r.status} />
      </td>

      {/* Paid On */}
      <td className="px-3 py-3">
        {r.status === 'paid' ? (
          <div>
            <p className="text-xs text-slate-600 font-medium">{fdate(r.paymentDate)}</p>
            {r.paymentMethod && (
              <p className="text-[10px] text-slate-400 capitalize mt-0.5">{r.paymentMethod.replace('_', ' ')}</p>
            )}
          </div>
        ) : <span className="text-sm text-slate-300">—</span>}
      </td>

      {/* Actions */}
      <td className="px-3 py-3">
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          {(isOverdue || isPending) && (
            <>
              <button onClick={() => onMarkPaid(r)}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                  isOverdue ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100'
                }`}>
                <CheckCircle2 size={11} /> Collect
              </button>
              {r.tenant?.phone && (
                <a href={waLink(r.tenant.phone)} target="_blank" rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  title="WhatsApp reminder"
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-green-50 hover:text-green-600 transition-colors">
                  <MessageCircle size={13} />
                </a>
              )}
            </>
          )}
          {r.status === 'paid' && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
              <CheckCircle2 size={11} /> Paid
            </span>
          )}
          <button onClick={() => onLedger(r.tenant)}
            className="rounded-lg p-1.5 text-slate-300 hover:text-primary-500 hover:bg-primary-50 transition-colors" title="View ledger">
            <ChevronRight size={13} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Allocation Preview (pure computation, no side effects) ────────────────────
const computeAllocation = (openRents, payingAmount) => {
  let remaining = payingAmount
  const rows = []

  for (const r of openRents) {
    if (remaining <= 0) {
      rows.push({ rent: r, applying: 0, covered: false })
      continue
    }
    const due      = r.amount - (r.paidAmount ?? 0)
    const applying = Math.min(due, remaining)
    remaining -= applying
    rows.push({ rent: r, applying, covered: applying >= due })
  }

  return { rows, advanceAmount: remaining }
}

// ── Payment Modal (allocation-preview, multi-record) ─────────────────────────
const PaymentModal = ({ tenant, openRents, currentBalance, onConfirm, onClose, paying }) => {
  const totalDue = openRents.reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0)

  const [form, setForm] = useState({
    amount:      String(Math.max(0, totalDue)),
    method:      'cash',
    referenceId: '',
    paymentDate: new Date().toISOString().split('T')[0],
    notes:       '',
  })

  const payingAmt = Math.max(0, Number(form.amount) || 0)
  const { rows, advanceAmount } = computeAllocation(openRents, payingAmt)
  const isAdvance = advanceAmount > 0 && payingAmt > 0
  const isPartial = payingAmt < totalDue && payingAmt > 0

  const METHODS = ['cash', 'upi', 'bank_transfer', 'cheque', 'other']

  return (
    <Modal title="Collect Payment" onClose={onClose}>
      {/* Tenant header */}
      <div className="mb-5 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-semibold text-slate-800">{tenant?.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">{tenant?.phone}</p>
          </div>
          <div className="text-right">
            {currentBalance < 0 ? (
              <div className="flex items-center gap-1.5 justify-end text-emerald-600">
                <Wallet size={13} />
                <p className="text-sm font-bold tabular-nums">{fmt(Math.abs(currentBalance))} advance</p>
              </div>
            ) : (
              <p className="text-sm font-bold text-slate-700 tabular-nums">{fmt(totalDue)} due</p>
            )}
            {openRents.length > 0 && (
              <p className="text-xs text-slate-400 mt-0.5">{openRents.length} open record{openRents.length !== 1 ? 's' : ''}</p>
            )}
          </div>
        </div>
      </div>

      <form onSubmit={e => { e.preventDefault(); onConfirm({ ...form, amount: payingAmt }) }} className="space-y-4">

        {/* Amount */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="label mb-0">Amount (₹)</label>
            {totalDue > 0 && (
              <button type="button" className="text-xs text-primary-500 hover:underline"
                onClick={() => setForm(f => ({ ...f, amount: String(totalDue) }))}>
                Fill full balance
              </button>
            )}
          </div>
          <input type="number" min="1" step="1" className="input"
            value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} required />
          {isPartial && (
            <p className="mt-1 text-xs text-amber-600 font-medium">
              Partial — {fmt(totalDue - payingAmt)} will remain pending
            </p>
          )}
          {isAdvance && (
            <p className="mt-1 text-xs text-emerald-600 font-medium flex items-center gap-1">
              <Wallet size={11} /> {fmt(advanceAmount)} will go toward advance credit
            </p>
          )}
        </div>

        {/* Allocation Preview */}
        {openRents.length > 0 && payingAmt > 0 && (
          <div>
            <p className="label mb-1.5">Allocation Preview</p>
            <div className="rounded-xl border border-slate-100 bg-slate-50 overflow-hidden divide-y divide-slate-100">
              {rows.map(({ rent: r, applying, covered }) => {
                const due = r.amount - (r.paidAmount ?? 0)
                return (
                  <div key={r._id} className={`flex items-center justify-between px-3 py-2.5 ${applying > 0 ? '' : 'opacity-40'}`}>
                    <div>
                      <p className="text-xs font-medium text-slate-700">
                        {MONTH_SHORT[r.month - 1]} {r.year}
                        {r.status === 'overdue' && (
                          <span className="ml-1.5 text-[10px] font-semibold text-red-500 uppercase">overdue</span>
                        )}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {(r.paidAmount ?? 0) > 0
                          ? `${fmt(r.paidAmount)} already paid · ${fmt(due)} remaining`
                          : `${fmt(r.amount)} due`
                        }
                      </p>
                    </div>
                    <div className="text-right">
                      {applying > 0 ? (
                        <>
                          <p className="text-xs font-bold text-emerald-600 tabular-nums">−{fmt(applying)}</p>
                          {covered
                            ? <p className="text-[10px] text-emerald-500 font-medium">Fully settled</p>
                            : <p className="text-[10px] text-amber-500 font-medium">{fmt(due - applying)} remains</p>
                          }
                        </>
                      ) : (
                        <p className="text-xs text-slate-300">Not covered</p>
                      )}
                    </div>
                  </div>
                )
              })}
              {isAdvance && (
                <div className="flex items-center justify-between px-3 py-2.5 bg-emerald-50">
                  <p className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                    <Wallet size={11} /> Advance credit
                  </p>
                  <p className="text-xs font-bold text-emerald-600 tabular-nums">+{fmt(advanceAmount)}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Payment Method */}
        <div>
          <label className="label">Payment Method</label>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {METHODS.map(m => (
              <button key={m} type="button" onClick={() => setForm(f => ({ ...f, method: m }))}
                className={`rounded-xl border px-2 py-2 text-xs font-medium capitalize transition-colors ${
                  form.method === m
                    ? 'border-primary-400 bg-primary-50 text-primary-600'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}>
                {m.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Reference ID (UPI/cheque) */}
        {(form.method === 'upi' || form.method === 'bank_transfer' || form.method === 'cheque') && (
          <div>
            <label className="label">
              {form.method === 'cheque' ? 'Cheque No.' : 'Reference / UTR'}
            </label>
            <input className="input" placeholder={form.method === 'cheque' ? 'e.g. 002341' : 'e.g. 123456789012'}
              value={form.referenceId} onChange={e => setForm(f => ({ ...f, referenceId: e.target.value }))} />
          </div>
        )}

        {/* Date */}
        <div>
          <label className="label">Payment Date</label>
          <input type="date" className="input"
            value={form.paymentDate} onChange={e => setForm(f => ({ ...f, paymentDate: e.target.value }))} />
        </div>

        {/* Notes */}
        <div>
          <label className="label">Notes (optional)</label>
          <input className="input" placeholder="Additional notes…"
            value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
        </div>

        {/* Confirmation message indicator */}
        {tenant?.phone && payingAmt > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
            <CheckCircle2 size={12} className="shrink-0 text-emerald-500" />
            <p className="text-xs text-emerald-700 font-medium">
              WhatsApp confirmation will be sent to {tenant.phone}
            </p>
          </div>
        )}

        <div className="flex gap-2 pt-1 border-t border-slate-100">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={paying || payingAmt <= 0}>
            <CircleDollarSign size={14} />
            {paying ? 'Saving…' : isPartial ? 'Record Partial' : isAdvance ? 'Record + Advance' : 'Confirm Payment'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Tenant Ledger Drawer ──────────────────────────────────────────────────────
const TenantLedger = ({ tenant, propertyId }) => {
  const [view, setView] = useState('ledger') // 'ledger' | 'records'

  // Ledger entries (new financial layer)
  const { data: ledgerData, loading: ledgerLoading } = useApi(
    () => getTenantLedger(propertyId, tenant._id),
    [tenant._id]
  )
  const { entries = [], currentBalance = 0 } = ledgerData?.data ?? {}

  // Legacy rent records (per-period)
  const { data: rentData, loading: rentLoading } = useApi(
    () => getTenantRents(propertyId, tenant._id),
    [tenant._id]
  )
  const rents = rentData?.data ?? []

  const totalBilled  = rents.reduce((s, r) => s + r.amount, 0)
  const totalPaid    = rents.reduce((s, r) => r.status === 'paid' ? s + r.amount : s + (r.paidAmount ?? 0), 0)

  const hasAdvance = currentBalance < 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 bg-slate-50 border-b border-slate-100">
        <p className="text-base font-bold text-slate-800">{tenant.name}</p>
        <p className="text-xs text-slate-400 mt-0.5">{tenant.phone}</p>

        {/* Balance block */}
        <div className={`mt-4 rounded-xl px-4 py-3 flex items-center justify-between ${
          hasAdvance
            ? 'bg-emerald-50 border border-emerald-200'
            : currentBalance > 0
            ? 'bg-amber-50 border border-amber-200'
            : 'bg-slate-100 border border-slate-200'
        }`}>
          <div className="flex items-center gap-2">
            {hasAdvance
              ? <Wallet size={15} className="text-emerald-600" />
              : <IndianRupee size={15} className={currentBalance > 0 ? 'text-amber-600' : 'text-slate-400'} />
            }
            <div>
              <p className={`text-xs font-medium ${hasAdvance ? 'text-emerald-600' : currentBalance > 0 ? 'text-amber-600' : 'text-slate-500'}`}>
                {hasAdvance ? 'Advance Credit' : currentBalance > 0 ? 'Outstanding Balance' : 'Fully Settled'}
              </p>
              <p className={`text-lg font-bold tabular-nums ${hasAdvance ? 'text-emerald-700' : currentBalance > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                {fmt(Math.abs(currentBalance))}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-right">
            <div>
              <p className="text-[10px] text-slate-400">Billed</p>
              <p className="text-xs font-bold text-slate-700 tabular-nums">{fmt(totalBilled)}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-400">Paid</p>
              <p className="text-xs font-bold text-emerald-600 tabular-nums">{fmt(totalPaid)}</p>
            </div>
          </div>
        </div>

        {/* View toggle */}
        <div className="mt-3 flex rounded-xl border border-slate-200 bg-white p-1 gap-1">
          {[
            { key: 'ledger',  label: 'Ledger Timeline' },
            { key: 'records', label: 'Rent Records'    },
          ].map(({ key, label }) => (
            <button key={key} onClick={() => setView(key)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                view === key ? 'bg-primary-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-5">

        {/* ── Ledger Timeline ── */}
        {view === 'ledger' && (
          ledgerLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-100 border-t-primary-500" />
            </div>
          ) : entries.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No ledger entries yet</p>
          ) : (
            <div className="relative">
              {/* Vertical line */}
              <div className="absolute left-[18px] top-0 bottom-0 w-px bg-slate-100" />
              <div className="space-y-4 relative">
                {entries.map((e, idx) => {
                  const isDebit  = e.type === 'debit'
                  const isFirst  = idx === 0
                  const balNeg   = e.balanceAfter < 0

                  return (
                    <div key={e._id ?? idx} className="flex gap-3 items-start">
                      {/* Icon dot */}
                      <div className={`mt-0.5 shrink-0 h-9 w-9 rounded-full flex items-center justify-center border-2 bg-white z-10 ${
                        isDebit
                          ? 'border-amber-200 text-amber-500'
                          : 'border-emerald-200 text-emerald-500'
                      }`}>
                        {isDebit
                          ? <ArrowDownCircle size={14} />
                          : <ArrowUpCircle  size={14} />
                        }
                      </div>

                      {/* Card */}
                      <div className={`flex-1 rounded-xl border px-3.5 py-3 ${
                        isFirst ? 'bg-white shadow-sm border-slate-200' : 'bg-white border-slate-100'
                      }`}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold text-slate-700 leading-tight">
                              {e.description ?? (isDebit ? 'Rent charged' : 'Payment received')}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{fdateTime(e.createdAt)}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className={`text-sm font-bold tabular-nums ${isDebit ? 'text-red-600' : 'text-emerald-600'}`}>
                              {isDebit ? '+' : '−'}{fmt(e.amount)}
                            </p>
                            <p className={`text-[10px] font-medium mt-0.5 tabular-nums ${balNeg ? 'text-emerald-500' : e.balanceAfter > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                              {balNeg ? `${fmt(Math.abs(e.balanceAfter))} credit` : `${fmt(e.balanceAfter)} due`}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        )}

        {/* ── Rent Records ── */}
        {view === 'records' && (
          rentLoading ? (
            <div className="flex justify-center py-10">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-100 border-t-primary-500" />
            </div>
          ) : rents.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">No rent records yet</p>
          ) : (
            <div className="space-y-2">
              {rents.map(r => (
                <div key={r._id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3 hover:border-slate-200 transition-colors">
                  <div>
                    <p className="text-sm font-semibold text-slate-700">
                      {MONTH_SHORT[r.month - 1]} {r.year}
                    </p>
                    {r.status === 'paid' && r.paymentDate && (
                      <p className="text-xs text-slate-400 mt-0.5">
                        Paid {fdate(r.paymentDate)}
                        {r.paymentMethod && ` · ${r.paymentMethod.replace('_', ' ')}`}
                      </p>
                    )}
                    {r.status !== 'paid' && (
                      <p className="text-xs text-slate-400 mt-0.5">Due {fdate(r.dueDate)}</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-slate-700 tabular-nums">{fmt(r.amount)}</p>
                    {(r.paidAmount ?? 0) > 0 && r.status !== 'paid' && (
                      <p className="text-xs text-amber-600 font-medium">{fmt(r.paidAmount)} paid</p>
                    )}
                    <StatusPill status={r.status} />
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  )
}

// ── Reminder Result Modal ─────────────────────────────────────────────────────
const ReminderModal = ({ result, onClose }) => {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(result.message)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Modal title="Reminder Sent" onClose={onClose}>
      <div className="mb-5 flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3">
        <CheckCircle2 size={18} className="shrink-0 text-emerald-500" />
        <div>
          <p className="text-sm font-semibold text-emerald-700">Sent to {result.tenantName}</p>
          <p className="text-xs text-emerald-600 mt-0.5">{result.phone}</p>
        </div>
      </div>
      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <label className="label">Message Preview</label>
          <button onClick={handleCopy} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 transition-colors">
            {copied ? <><Check size={12} className="text-emerald-500" /><span className="text-emerald-600">Copied</span></> : <><Copy size={12} />Copy</>}
          </button>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
          <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{result.message}</p>
        </div>
      </div>
      <div className="flex justify-end">
        <button className="btn-primary" onClick={onClose}>Done</button>
      </div>
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const now = new Date()
const FILTERS = [
  { key: 'all',     label: 'All'     },
  { key: 'pending', label: 'Pending' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'paid',    label: 'Paid'    },
]

const Rent = () => {
  const { selectedProperty } = useProperty()
  const propertyId = selectedProperty?._id ?? ''
  const toast = useToast()

  const [month,          setMonth]          = useState(now.getMonth() + 1)
  const [year,           setYear]           = useState(now.getFullYear())
  const [statusFilter,   setStatusFilter]   = useState('all')
  const [search,         setSearch]         = useState('')
  const [generating,     setGenerating]     = useState(false)
  const [paying,         setPaying]         = useState(false)
  const [remindingId,    setRemindingId]    = useState(null)
  const [reminderModal,  setReminderModal]  = useState(null)
  const [reminded,       setReminded]       = useState(new Set()) // tenantIds reminded this session
  const [selected,       setSelected]       = useState(new Set())
  const [ledgerTenant,   setLedgerTenant]   = useState(null)

  // Payment modal state: { tenant, openRents, currentBalance }
  const [payModal, setPayModal] = useState(null)

  // Fetch all rents for the selected period (no status filter — client-side)
  const { data, loading, refetch } = useApi(
    () => propertyId
      ? getRents(propertyId, { month, year })
      : Promise.resolve({ data: null }),
    [propertyId, month, year]
  )
  const allRents = data?.data ?? []

  // Client-side filter + search
  const filtered = useMemo(() => {
    let list = statusFilter !== 'all' ? allRents.filter(r => r.status === statusFilter) : [...allRents]
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(r =>
      (r.tenant?.name ?? '').toLowerCase().includes(q) ||
      (r.tenant?.phone ?? '').includes(q)
    )
    return list
  }, [allRents, statusFilter, search])

  const counts = useMemo(() => ({
    all:     allRents.length,
    pending: allRents.filter(r => r.status === 'pending').length,
    overdue: allRents.filter(r => r.status === 'overdue').length,
    paid:    allRents.filter(r => r.status === 'paid').length,
  }), [allRents])

  // Bulk selection
  const toggleSelect = useCallback((id) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }, [])
  const toggleAll = () => {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(r => r._id)))
  }
  const clearSelection = () => setSelected(new Set())

  const allSelected  = filtered.length > 0 && selected.size === filtered.length
  const someSelected = selected.size > 0

  // Handlers
  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await generateRent(propertyId, { month, year })
      const { created, skipped } = res.data.data
      toast(`Generated ${created} record${created !== 1 ? 's' : ''}. ${skipped} already existed.`, 'success')
      refetch()
    } catch (err) {
      toast(err.response?.data?.message || 'Error generating rent', 'error')
    } finally {
      setGenerating(false)
    }
  }

  // Open PaymentModal: collect all open (pending+overdue) records for that tenant
  const handleOpenPayModal = async (rentRow) => {
    const tenant = rentRow.tenant
    if (!tenant) return

    // Get ALL open records for this tenant (across all months)
    try {
      const res = await getRents(propertyId, { tenantId: tenant._id })
      const openRents = (res.data?.data ?? [])
        .filter(r => r.status === 'pending' || r.status === 'partial' || r.status === 'overdue')
        .sort((a, b) => {
          if (a.year !== b.year) return a.year - b.year
          return a.month - b.month
        })
      const currentBalance = tenant.ledgerBalance ?? 0
      setPayModal({ tenant, openRents, currentBalance })
    } catch {
      // Fallback: just use the current row
      const openRents = (['pending','partial','overdue'].includes(rentRow.status)) ? [rentRow] : []
      setPayModal({ tenant, openRents, currentBalance: tenant.ledgerBalance ?? 0 })
    }
  }

  const handleRecordPayment = async (form) => {
    setPaying(true)
    try {
      await recordPayment(propertyId, {
        tenantId:    payModal.tenant._id,
        amount:      form.amount,
        method:      form.method,
        referenceId: form.referenceId || undefined,
        paymentDate: form.paymentDate,
        notes:       form.notes || undefined,
      })
      setPayModal(null)
      refetch()
      toast('Payment recorded', 'success')
    } catch (err) {
      toast(err.response?.data?.message || 'Error recording payment', 'error')
    } finally {
      setPaying(false)
    }
  }

  const handleRemind = async (rent) => {
    setRemindingId(rent._id)
    try {
      const res = await sendRentReminder(propertyId, rent.tenant._id)
      setReminderModal(res.data.data)
      // Track as reminded in this session
      setReminded((prev) => new Set([...prev, rent.tenant._id]))
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to send reminder', 'error')
    } finally {
      setRemindingId(null)
    }
  }

  const handleBulkRemind = () => {
    const targets = filtered.filter(r => selected.has(r._id) && r.tenant?.phone && r.status !== 'paid')
    if (!targets.length) { toast('No actionable tenants selected', 'error'); return }
    targets.forEach(r => window.open(waLink(r.tenant.phone), '_blank'))
    toast(`Opened WhatsApp for ${targets.length} tenant${targets.length > 1 ? 's' : ''}`, 'success')
    clearSelection()
  }

  const handleExport = () => {
    const targets = selected.size > 0 ? filtered.filter(r => selected.has(r._id)) : filtered
    const headers = ['Tenant', 'Phone', 'Room/Bed', 'Amount', 'Due Date', 'Status', 'Paid On', 'Method']
    const rows = targets.map(r => {
      const bed = r.tenant?.bed
      const loc = bed?.room?.roomNumber ? `R${bed.room.roomNumber}${bed.bedNumber ? `/B${bed.bedNumber}` : ''}` : ''
      return [
        `"${r.tenant?.name ?? ''}"`,
        r.tenant?.phone ?? '',
        loc,
        r.amount ?? 0,
        r.dueDate ? new Date(r.dueDate).toLocaleDateString('en-IN') : '',
        r.status,
        r.paymentDate ? new Date(r.paymentDate).toLocaleDateString('en-IN') : '',
        r.paymentMethod ?? '',
      ]
    })
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `rent-${MONTH_SHORT[month - 1]}-${year}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast(`Exported ${targets.length} record${targets.length !== 1 ? 's' : ''}`, 'success')
  }

  const onFilterTab = (key) => {
    setStatusFilter(key)
    clearSelection()
  }

  return (
    <div className="space-y-5 max-w-7xl">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 leading-tight">Rent Collection</h2>
          {allRents.length > 0 && (
            <p className="text-sm text-slate-400 mt-0.5">
              {counts.paid} paid · {counts.pending} pending · {counts.overdue} overdue
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Month + Year selector */}
          <select className="input w-32 text-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <input type="number" className="input w-20 text-sm" value={year}
            onChange={e => setYear(Number(e.target.value))} />
          {propertyId && (
            <button className="btn-primary" onClick={handleGenerate} disabled={generating}>
              <Zap size={15} /> {generating ? 'Generating…' : 'Generate'}
            </button>
          )}
        </div>
      </div>

      {!propertyId ? (
        <div className="card border-dashed">
          <EmptyState message="No property selected. Choose one from the sidebar." />
        </div>
      ) : loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : (
        <>
          {/* ── Summary Cards ── */}
          {allRents.length > 0 && (
            <SummaryCards rents={allRents} statusFilter={statusFilter} onFilter={onFilterTab} />
          )}

          {/* ── Overdue Alert ── */}
          {counts.overdue > 0 && (
            <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <AlertTriangle size={15} className="shrink-0 text-red-500" />
              <p className="flex-1 text-sm text-red-700 font-medium">
                {counts.overdue} tenant{counts.overdue !== 1 ? 's have' : ' has'} overdue rent this period.
              </p>
              <button className="text-xs font-semibold text-red-600 hover:text-red-800 transition-colors"
                onClick={() => onFilterTab('overdue')}>
                View →
              </button>
            </div>
          )}

          {/* ── Filter Bar ── */}
          <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm py-2 -mx-1 px-1 flex flex-wrap items-center gap-3">
            {/* Status tabs */}
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {FILTERS.map(({ key, label }) => (
                <button key={key} onClick={() => onFilterTab(key)}
                  className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    statusFilter === key
                      ? 'bg-primary-500 text-white shadow-sm'
                      : 'text-slate-500 hover:bg-slate-50'
                  }`}>
                  {label}
                  {counts[key] > 0 && statusFilter !== key && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                      key === 'overdue' ? 'bg-red-100 text-red-600'
                      : key === 'pending' ? 'bg-amber-100 text-amber-600'
                      : 'bg-slate-100 text-slate-500'
                    }`}>{counts[key]}</span>
                  )}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative flex-1 min-w-[180px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input pl-8 py-1.5 text-sm w-full"
                placeholder="Search by name or phone…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
              {search && (
                <button onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={13} />
                </button>
              )}
            </div>

            {/* Export all */}
            <button onClick={handleExport}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              <Download size={12} /> Export
            </button>
          </div>

          {/* ── Table ── */}
          {filtered.length === 0 ? (
            <div className="card border-dashed">
              <EmptyState
                message={search || statusFilter !== 'all'
                  ? `No ${statusFilter !== 'all' ? statusFilter : ''} records match`
                  : 'No rent records for this period'}
                action={
                  statusFilter === 'all' && !search
                    ? <button className="btn-primary" onClick={handleGenerate} disabled={generating}><Zap size={15} />Generate Rent</button>
                    : <button className="btn-secondary" onClick={() => { setStatusFilter('all'); setSearch('') }}><RotateCcw size={13} /> Clear filters</button>
                }
              />
            </div>
          ) : (
            <div className="card overflow-hidden !p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      <th className="pl-4 pr-2 py-3 w-10" onClick={toggleAll}>
                        <div className={`h-4 w-4 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${
                          allSelected ? 'bg-primary-500 border-primary-500' : 'border-slate-300 hover:border-primary-400'
                        }`}>
                          {allSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                          {!allSelected && someSelected && <span className="h-1.5 w-1.5 rounded-sm bg-primary-400" />}
                        </div>
                      </th>
                      {['Tenant', 'Room / Bed', 'Amount', 'Due Date', 'Status', 'Paid On', ''].map(h => (
                        <th key={h} className="px-3 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filtered.map(r => (
                      <RentRow
                        key={r._id}
                        rent={r}
                        selected={selected.has(r._id)}
                        onSelect={toggleSelect}
                        onMarkPaid={handleOpenPayModal}
                        onRemind={handleRemind}
                        onLedger={setLedgerTenant}
                        reminding={remindingId === r._id}
                        reminded={reminded}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Footer */}
              <div className="sticky bottom-0 z-10 px-4 py-2.5 border-t border-slate-100 bg-white flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-slate-400">
                  {filtered.length} record{filtered.length !== 1 ? 's' : ''}
                  {(search || statusFilter !== 'all') && ` · filtered from ${allRents.length}`}
                  {someSelected && <span className="text-primary-600 font-medium"> · {selected.size} selected</span>}
                </p>
                <p className="text-xs text-slate-500">
                  Total: <span className="font-bold text-slate-800 tabular-nums">
                    {fmt(filtered.reduce((s, r) => s + r.amount, 0))}
                  </span>
                </p>
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Bulk Bar ── */}
      {someSelected && (
        <BulkBar
          count={selected.size}
          onRemind={handleBulkRemind}
          onExport={handleExport}
          onClear={clearSelection}
        />
      )}

      {/* ── Modals ── */}
      {payModal && (
        <PaymentModal
          tenant={payModal.tenant}
          openRents={payModal.openRents}
          currentBalance={payModal.currentBalance}
          onConfirm={handleRecordPayment}
          onClose={() => setPayModal(null)}
          paying={paying}
        />
      )}
      {reminderModal && (
        <ReminderModal result={reminderModal} onClose={() => setReminderModal(null)} />
      )}

      {/* ── Tenant Ledger Drawer ── */}
      {ledgerTenant && (
        <Drawer
          title="Payment Ledger"
          subtitle={ledgerTenant.name}
          onClose={() => setLedgerTenant(null)}
          closeOnBackdrop={false}
        >
          <TenantLedger tenant={ledgerTenant} propertyId={propertyId} />
        </Drawer>
      )}
    </div>
  )
}

export default Rent
