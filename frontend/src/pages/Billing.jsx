import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  IndianRupee, Calendar, BedDouble, AlertTriangle, CheckCircle2,
  Clock, MessageCircle, X, ChevronRight, Wallet, CreditCard,
  TrendingUp, Users, RefreshCw, Search, ArrowDownLeft, ArrowUpLeft,
  Zap, Check, Phone, CalendarClock, Ban,
} from 'lucide-react'
import { getTenants, getTenantRents } from '../api/tenants'
import { getTenantLedger, recordPayment, sendRentReminder } from '../api/rent'
import { useProperty } from '../context/PropertyContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt    = (n) => `₹${(n ?? 0).toLocaleString('en-IN')}`
const fdate  = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'
const fdateY = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const waLink = (p = '') => `https://wa.me/${p.replace(/[^\d]/g, '')}`

const AVATAR_COLORS = [
  'bg-violet-100 text-violet-700',
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-indigo-100 text-indigo-700',
  'bg-teal-100 text-teal-700',
]
const avatarColor = (n = '') => AVATAR_COLORS[n.charCodeAt(0) % AVATAR_COLORS.length]
const initials   = (n = '') => n.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

// Compute current billing cycle for a tenant
const computeCycle = (tenant) => {
  const anchor = tenant.billingStartDate || tenant.checkInDate
  if (!anchor) return null
  const billingDay = new Date(anchor).getDate()
  const today = new Date()
  const m = today.getMonth()
  const y = today.getFullYear()
  const daysThisMonth = new Date(y, m + 1, 0).getDate()
  const effDay = Math.min(billingDay, daysThisMonth)

  let cycleStart, cycleEnd
  if (today.getDate() >= effDay) {
    cycleStart = new Date(y, m, effDay)
    const nm = m === 11 ? 0 : m + 1
    const ny = m === 11 ? y + 1 : y
    cycleEnd = new Date(ny, nm, Math.min(billingDay, new Date(ny, nm + 1, 0).getDate()))
    cycleEnd.setDate(cycleEnd.getDate() - 1)
  } else {
    const pm = m === 0 ? 11 : m - 1
    const py = m === 0 ? y - 1 : y
    cycleStart = new Date(py, pm, Math.min(billingDay, new Date(py, pm + 1, 0).getDate()))
    cycleEnd = new Date(y, m, effDay)
    cycleEnd.setDate(cycleEnd.getDate() - 1)
  }

  const graceDays = tenant.dueDate ?? 5
  const dueDate = new Date(cycleStart)
  dueDate.setDate(dueDate.getDate() + graceDays)
  dueDate.setHours(23, 59, 59, 999)

  return { cycleStart, cycleEnd, dueDate }
}

// Days until (+) or since (-) a date
const daysDiff = (d) => Math.ceil((new Date(d) - Date.now()) / 86_400_000)

// ── BillingCycleBar ───────────────────────────────────────────────────────────
const BillingCycleBar = ({ cycleStart, cycleEnd }) => {
  const today     = new Date()
  const totalMs   = cycleEnd - cycleStart
  const elapsedMs = today - cycleStart
  const pct = Math.max(0, Math.min(100, (elapsedMs / totalMs) * 100))
  const inCycle = today >= cycleStart && today <= cycleEnd

  // Clamp label position to avoid overflow at edges
  const labelLeft = Math.max(8, Math.min(86, pct))

  return (
    <div>
      {/* Date labels */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="text-center">
          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Start</p>
          <p className="text-xs font-bold text-slate-700 mt-0.5">{fdate(cycleStart)}</p>
        </div>
        <div className="flex-1 mx-3 flex flex-col items-center">
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Current Billing Cycle</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {Math.ceil(totalMs / 86_400_000)} days total
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">End</p>
          <p className="text-xs font-bold text-slate-700 mt-0.5">{fdate(cycleEnd)}</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="relative">
        <div className="h-7 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-out ${
              pct >= 100 ? 'bg-red-400' : 'bg-gradient-to-r from-primary-400 to-primary-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Today marker line */}
        {inCycle && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/80 shadow-sm"
            style={{ left: `${pct}%`, transform: 'translateX(-50%)' }}
          />
        )}
      </div>

      {/* Today label */}
      {inCycle ? (
        <div className="relative h-5 mt-1">
          <div
            className="absolute flex flex-col items-center"
            style={{ left: `${labelLeft}%`, transform: 'translateX(-50%)' }}
          >
            <div className="w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-primary-500" />
            <span className="text-[10px] font-bold text-primary-600 whitespace-nowrap">
              Today · {Math.floor(elapsedMs / 86_400_000)}d in
            </span>
          </div>
        </div>
      ) : (
        <div className="h-5 mt-1 flex justify-center">
          {today < cycleStart
            ? <span className="text-[10px] text-slate-400">Cycle starts {fdate(cycleStart)}</span>
            : <span className="text-[10px] text-red-500 font-semibold">Cycle ended {fdate(cycleEnd)}</span>
          }
        </div>
      )}
    </div>
  )
}

// ── DueStatusBanner ───────────────────────────────────────────────────────────
const DueStatusBanner = ({ cycle, ledgerBalance, openRecords }) => {
  if (!cycle) return null
  const today = new Date()
  const isPaid = ledgerBalance <= 0
  const isOverdue = today > cycle.dueDate && ledgerBalance > 0
  const diff = daysDiff(cycle.dueDate)

  if (isPaid) {
    return (
      <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-5 py-4 flex items-center gap-4">
        <div className="h-11 w-11 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
          <CheckCircle2 size={22} className="text-emerald-600" />
        </div>
        <div>
          <p className="text-base font-bold text-emerald-700">All dues cleared</p>
          <p className="text-xs text-emerald-600 mt-0.5">
            {ledgerBalance < 0 ? `${fmt(Math.abs(ledgerBalance))} advance credit on account` : 'Cycle fully paid'}
          </p>
        </div>
      </div>
    )
  }

  if (isOverdue) {
    const days = Math.abs(diff)
    return (
      <div className="rounded-2xl bg-red-50 border border-red-200 px-5 py-4 flex items-center gap-4">
        <div className="h-11 w-11 rounded-xl bg-red-100 flex items-center justify-center shrink-0 animate-pulse">
          <AlertTriangle size={22} className="text-red-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xl font-bold text-red-700 tabular-nums">{fmt(ledgerBalance)} Overdue</p>
          <p className="text-xs text-red-600 mt-0.5">
            Since {fdate(cycle.dueDate)} · <span className="font-semibold">{days} day{days !== 1 ? 's' : ''} past due</span>
          </p>
        </div>
        {openRecords.length > 1 && (
          <div className="shrink-0 rounded-lg bg-red-100 border border-red-200 px-2.5 py-1 text-center">
            <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide">{openRecords.length} cycles</p>
          </div>
        )}
      </div>
    )
  }

  // Pending — before due date
  const daysLeft = Math.max(0, diff)
  const urgency = daysLeft <= 1 ? 'red' : daysLeft <= 3 ? 'amber' : 'blue'
  const colors = {
    red:   { bg: 'bg-red-50', border: 'border-red-200', icon: 'bg-red-100 text-red-600', text: 'text-red-700', sub: 'text-red-600' },
    amber: { bg: 'bg-amber-50', border: 'border-amber-200', icon: 'bg-amber-100 text-amber-600', text: 'text-amber-700', sub: 'text-amber-600' },
    blue:  { bg: 'bg-blue-50', border: 'border-blue-200', icon: 'bg-blue-100 text-blue-600', text: 'text-blue-700', sub: 'text-blue-600' },
  }[urgency]

  return (
    <div className={`rounded-2xl ${colors.bg} border ${colors.border} px-5 py-4 flex items-center gap-4`}>
      <div className={`h-11 w-11 rounded-xl ${colors.icon} flex items-center justify-center shrink-0`}>
        <Clock size={22} />
      </div>
      <div>
        <p className={`text-base font-bold ${colors.text}`}>
          {daysLeft === 0 ? 'Due today' : `Due in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`}
        </p>
        <p className={`text-xs ${colors.sub} mt-0.5`}>
          {fmt(ledgerBalance)} due by {fdate(cycle.dueDate)}
        </p>
      </div>
    </div>
  )
}

// ── PaymentProgress ───────────────────────────────────────────────────────────
const PaymentProgress = ({ record }) => {
  if (!record) return null
  const paid  = record.paidAmount ?? 0
  const total = record.amount ?? 0
  const pct   = total > 0 ? Math.round((paid / total) * 100) : 0
  const remaining = total - paid

  const barColor = pct === 100
    ? 'bg-emerald-500'
    : pct > 0
    ? 'bg-amber-400'
    : 'bg-slate-300'

  return (
    <div className="rounded-2xl bg-white border border-slate-200 px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Payment Progress</p>
        <span className={`text-xs font-bold tabular-nums ${
          pct === 100 ? 'text-emerald-600' : pct > 0 ? 'text-amber-600' : 'text-slate-400'
        }`}>{pct}%</span>
      </div>

      {/* Bar */}
      <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between mt-2.5">
        <div>
          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Paid</p>
          <p className={`text-sm font-bold tabular-nums mt-0.5 ${paid > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
            {fmt(paid)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-[10px] text-slate-400">of</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">Total</p>
          <p className="text-sm font-bold text-slate-700 tabular-nums mt-0.5">{fmt(total)}</p>
        </div>
      </div>

      {remaining > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-500">Remaining</p>
          <p className="text-sm font-bold text-red-600 tabular-nums">{fmt(remaining)}</p>
        </div>
      )}
    </div>
  )
}

// ── RentChangeItem ────────────────────────────────────────────────────────────
const REASON_LABELS = {
  assign:           'New tenant moved in',
  vacate:           'Tenant vacated',
  change_room:      'Room transfer',
  extra_bed_change: 'Extra bed change',
  base_rent_update: 'Base rent updated',
  rent_type_update: 'Rent type changed',
}

const RentChangeItem = ({ event: e }) => {
  const went_up  = e.newRent > e.oldRent
  const delta    = Math.abs(e.newRent - e.oldRent)
  const reason   = REASON_LABELS[e.reason] ?? e.reason ?? 'Rent updated'

  return (
    <div className="flex items-start gap-3 py-3.5 border-b border-slate-50 last:border-0">
      {/* Icon */}
      <div className="mt-0.5 h-8 w-8 rounded-xl flex items-center justify-center shrink-0 bg-violet-50">
        <TrendingUp size={14} className="text-violet-500" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-violet-100 text-violet-700">
                RENT CHANGE
              </span>
              <span className={`text-[9px] font-semibold ${went_up ? 'text-red-500' : 'text-emerald-500'}`}>
                {went_up ? `+${fmt(delta)}` : `–${fmt(delta)}`}
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5 truncate leading-relaxed">
              New rent {fmt(e.newRent)} applied · {reason}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold text-violet-700 tabular-nums">{fmt(e.newRent)}</p>
            <p className="text-[10px] text-slate-400 tabular-nums line-through">{fmt(e.oldRent)}</p>
          </div>
        </div>
        <p className="text-[10px] text-slate-400 mt-1">{fdateY(e.changedAt)}</p>
      </div>
    </div>
  )
}

// ── TransactionItem ───────────────────────────────────────────────────────────
const REFUND_TYPES = new Set(['deposit_refunded', 'refund'])
const TX_BADGES = {
  rent_record:         { label: 'RENT',    cls: 'bg-slate-100 text-slate-600' },
  payment:             { label: 'PAYMENT', cls: 'bg-emerald-100 text-emerald-700' },
  adjustment:          { label: 'CHARGE',  cls: 'bg-blue-100 text-blue-700' },
  reservation_advance:   { label: 'ADVANCE',   cls: 'bg-amber-100 text-amber-700' },
  reservation_forfeited: { label: 'FORFEITED', cls: 'bg-red-100 text-red-700' },
  deposit_collected:     { label: 'DEPOSIT',   cls: 'bg-purple-100 text-purple-700' },
  deposit_forfeited:     { label: 'FORFEITED', cls: 'bg-red-100 text-red-700' },
  deposit_adjusted:    { label: 'DEPOSIT', cls: 'bg-purple-100 text-purple-700' },
  deposit_refunded:    { label: 'REFUND',  cls: 'bg-red-100 text-red-600' },
  refund:              { label: 'REFUND',  cls: 'bg-red-100 text-red-600' },
}

const TransactionItem = ({ entry: e }) => {
  const isNeg     = e.type === 'debit' || REFUND_TYPES.has(e.referenceType)
  const badge     = TX_BADGES[e.referenceType] ?? { label: e.referenceType?.toUpperCase(), cls: 'bg-slate-100 text-slate-500' }
  const amtColor  = isNeg ? 'text-red-600' : 'text-emerald-600'
  const balColor  = e.balanceAfter > 0 ? 'text-red-500' : e.balanceAfter < 0 ? 'text-emerald-600' : 'text-slate-400'

  return (
    <div className="flex items-start gap-3 py-3.5 border-b border-slate-50 last:border-0">
      {/* Icon */}
      <div className={`mt-0.5 h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${
        isNeg ? 'bg-red-50' : 'bg-emerald-50'
      }`}>
        {isNeg
          ? <ArrowDownLeft size={14} className="text-red-500" />
          : <ArrowUpLeft   size={14} className="text-emerald-500" style={{ transform: 'scaleX(-1)' }} />
        }
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md ${badge.cls}`}>
                {badge.label}
              </span>
              {e.method && (
                <span className="text-[9px] text-slate-400 font-medium capitalize">{e.method.replace('_', ' ')}</span>
              )}
            </div>
            <p className="text-xs text-slate-600 mt-0.5 truncate leading-relaxed">{e.description ?? '—'}</p>
          </div>
          <div className="text-right shrink-0">
            <p className={`text-sm font-bold tabular-nums ${amtColor}`}>
              {isNeg ? '–' : '+'}{fmt(e.amount)}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between mt-1">
          <p className="text-[10px] text-slate-400">
            {fdateY(e.createdAt)}
          </p>
          <p className={`text-[10px] font-semibold tabular-nums ${balColor}`}>
            Bal: {fmt(Math.abs(e.balanceAfter))}{e.balanceAfter < 0 ? ' (Adv)' : ''}
          </p>
        </div>
      </div>
    </div>
  )
}

// ── CollectPaymentModal ───────────────────────────────────────────────────────
const METHODS = [
  { id: 'cash',          label: 'Cash' },
  { id: 'upi',           label: 'UPI' },
  { id: 'bank_transfer', label: 'Bank' },
  { id: 'cheque',        label: 'Cheque' },
]

const CollectPaymentModal = ({ tenant, propertyId, suggestedAmount, onClose, onSuccess }) => {
  const [amount, setAmount]   = useState(String(suggestedAmount || ''))
  const [method, setMethod]   = useState('cash')
  const [ref,    setRef]      = useState('')
  const [notes,  setNotes]    = useState('')
  const [saving, setSaving]   = useState(false)
  const [error,  setError]    = useState('')
  const { addToast } = useToast()

  const handleSubmit = async (e) => {
    e.preventDefault()
    const amt = Number(amount)
    if (!amt || amt <= 0) { setError('Enter a valid amount'); return }
    setSaving(true)
    setError('')
    try {
      await recordPayment(propertyId, {
        tenantId:    tenant._id,
        amount:      amt,
        method,
        referenceId: ref  || undefined,
        notes:       notes || undefined,
      })
      addToast('Payment recorded successfully', 'success')
      onSuccess()
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to record payment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-sm rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden animate-pageIn">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-slate-50">
          <div>
            <p className="text-sm font-bold text-slate-800">Collect Payment</p>
            <p className="text-xs text-slate-400 mt-0.5">{tenant.name}</p>
          </div>
          <button onClick={onClose}
            className="h-7 w-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-200 hover:text-slate-600 transition-colors">
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* Amount */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Amount</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm">₹</span>
              <input
                type="number" min="1" step="1" required
                className="input pl-7 text-lg font-bold tabular-nums w-full"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0"
                autoFocus
              />
            </div>
          </div>

          {/* Method chips */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Method</label>
            <div className="grid grid-cols-4 gap-1.5">
              {METHODS.map(m => (
                <button key={m.id} type="button" onClick={() => setMethod(m.id)}
                  className={`py-2 rounded-xl text-xs font-semibold transition-all ${
                    method === m.id
                      ? 'bg-primary-600 text-white shadow-sm'
                      : 'bg-slate-50 border border-slate-200 text-slate-600 hover:border-primary-300'
                  }`}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Reference */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">
              Reference <span className="text-slate-300 font-normal">(UTR / Cheque No.)</span>
            </label>
            <input type="text" className="input text-sm w-full" placeholder="Optional"
              value={ref} onChange={e => setRef(e.target.value)} />
          </div>

          {/* Notes */}
          <div>
            <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-1.5">Notes</label>
            <input type="text" className="input text-sm w-full" placeholder="Optional"
              value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={saving}
              className="btn-primary flex-1 flex items-center justify-center gap-2">
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <Check size={13} />}
              {saving ? 'Recording…' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── ReservationCard ───────────────────────────────────────────────────────────
// Shows a reserved tenant (with reservation advance) in the Reservations tab.
const ReservationCard = ({ tenant, selected, onClick }) => {
  const advAmt    = tenant.ledgerBalance < 0 ? Math.abs(tenant.ledgerBalance) : 0
  const bedInfo   = tenant.bed ? `Bed ${tenant.bed.bedNumber ?? '?'}` : '—'
  const moveIn    = tenant.checkInDate ? fdate(tenant.checkInDate) : null

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 transition-all duration-150 border-b border-slate-100 last:border-0
        ${selected ? 'bg-amber-50/70 border-l-2 border-l-amber-500' : 'hover:bg-slate-50 border-l-2 border-l-transparent'}`}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${avatarColor(tenant.name)}`}>
          {initials(tenant.name)}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <p className={`text-sm font-semibold truncate ${selected ? 'text-amber-700' : 'text-slate-800'}`}>
              {tenant.name}
            </p>
            <span className="shrink-0 text-[9px] font-bold border rounded-full px-1.5 py-0.5 text-amber-700 bg-amber-50 border-amber-200">
              RESERVED
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
            <BedDouble size={9} /> {bedInfo}
            {moveIn && (
              <>
                <span className="text-slate-300">·</span>
                <CalendarClock size={9} />
                Move-in {moveIn}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Advance */}
      {advAmt > 0 ? (
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[10px] text-slate-400">Advance Collected</p>
          <p className="text-sm font-bold tabular-nums text-emerald-600">{fmt(advAmt)}</p>
        </div>
      ) : (
        <div className="mt-2">
          <p className="text-[10px] text-slate-400">No advance collected</p>
        </div>
      )}
    </button>
  )
}

// ── ReservationDetail ─────────────────────────────────────────────────────────
// Right-panel detail for a reserved tenant on the Reservations tab.
const ReservationDetail = ({ tenant, propertyId, onClose }) => {
  const [ledger,        setLedger]        = useState([])
  const [ledgerBalance, setLedgerBalance] = useState(tenant.ledgerBalance ?? 0)
  const [loading,       setLoading]       = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getTenantLedger(propertyId, tenant._id, { limit: 50 })
      .then(res => {
        if (cancelled) return
        const ld = res.data?.data ?? {}
        setLedger(ld.entries ?? [])
        setLedgerBalance(ld.currentBalance ?? tenant.ledgerBalance ?? 0)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [propertyId, tenant._id, tenant.ledgerBalance])

  const bedInfo   = tenant.bed ? `Bed ${tenant.bed.bedNumber ?? '?'}` : '—'
  const advAmt    = ledgerBalance < 0 ? Math.abs(ledgerBalance) : 0
  const moveIn    = tenant.checkInDate
  const phone     = tenant.phone

  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── Header ── */}
      <div className="shrink-0 bg-white border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${avatarColor(tenant.name)}`}>
            {initials(tenant.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-slate-800 leading-tight">{tenant.name}</h3>
              <span className="text-[9px] font-bold border rounded-full px-1.5 py-0.5 text-amber-700 bg-amber-50 border-amber-200">
                RESERVED
              </span>
            </div>
            {(phone || bedInfo !== '—') && (
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                <BedDouble size={10} className="shrink-0" /> {bedInfo}
                {phone && <><span className="text-slate-300 mx-0.5">·</span>{phone}</>}
              </p>
            )}
          </div>
          <button onClick={onClose}
            className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto pb-6">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <RefreshCw size={18} className="animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="px-5 py-5 space-y-5">

            {/* ── Snapshot cards ── */}
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: advAmt > 0 ? 'Advance Held' : 'Advance',
                  value: fmt(advAmt),
                  color: advAmt > 0 ? 'text-emerald-600' : 'text-slate-400',
                  sub:   advAmt > 0 ? 'in ledger as credit' : 'none collected',
                },
                {
                  label: 'Expected Move-in',
                  value: moveIn ? fdate(moveIn) : '—',
                  color: 'text-slate-700',
                  sub:   'from reservation form',
                },
                {
                  label: 'Phone',
                  value: phone ?? '—',
                  color: 'text-slate-700',
                  sub:   'contact number',
                },
                {
                  label: 'Status',
                  value: 'Reserved',
                  color: 'text-violet-600',
                  sub:   'awaiting check-in',
                },
              ].map(({ label, value, color, sub }) => (
                <div key={label} className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
                  <p className={`text-sm font-bold tabular-nums mt-0.5 ${color}`}>{value}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* ── Advance status banner ── */}
            {advAmt > 0 ? (
              <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-5 py-4 flex items-center gap-4">
                <div className="h-11 w-11 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
                  <IndianRupee size={22} className="text-emerald-600" />
                </div>
                <div>
                  <p className="text-base font-bold text-emerald-700">{fmt(advAmt)} advance on hold</p>
                  <p className="text-xs text-emerald-600 mt-0.5">
                    Will offset against first rent on check-in, or be refunded if cancelled
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-slate-50 border border-slate-100 px-5 py-4 flex items-center gap-4">
                <div className="h-11 w-11 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <Ban size={20} className="text-slate-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-500">No advance collected</p>
                  <p className="text-xs text-slate-400 mt-0.5">Reservation was created without a token amount</p>
                </div>
              </div>
            )}

            {/* ── Transaction timeline ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Financial History</p>
                <p className="text-[10px] text-slate-400">{ledger.length} entries</p>
              </div>

              {ledger.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-8 text-center">
                  <Wallet size={28} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-sm font-medium text-slate-400">No financial records yet</p>
                  <p className="text-xs text-slate-300 mt-1">Will appear once advance is collected</p>
                </div>
              ) : (
                <div className="rounded-2xl bg-white border border-slate-200 px-4 divide-y divide-slate-50">
                  {ledger.map((entry, idx) => (
                    <TransactionItem key={entry._id ?? idx} entry={entry} />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── TenantBillingCard ─────────────────────────────────────────────────────────
const TenantBillingCard = ({ tenant, selected, onClick }) => {
  const cycle   = computeCycle(tenant)
  const balance = tenant.ledgerBalance ?? 0
  const isOverdue = balance > 0 && cycle && new Date() > cycle.dueDate
  const isPaid    = balance <= 0

  const statusCls = isPaid    ? 'text-emerald-600 bg-emerald-50 border-emerald-200'
    : isOverdue               ? 'text-red-600 bg-red-50 border-red-200'
    :                           'text-amber-600 bg-amber-50 border-amber-200'
  const statusLabel = isPaid ? 'Paid' : isOverdue ? 'Overdue' : 'Pending'

  const bed     = tenant.bed
  const bedInfo = bed ? `Bed ${bed.bedNumber}` : '—'

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3.5 transition-all duration-150 border-b border-slate-100 last:border-0
        ${selected ? 'bg-primary-50/70 border-l-2 border-l-primary-500' : 'hover:bg-slate-50 border-l-2 border-l-transparent'}`}
    >
      <div className="flex items-center gap-3">
        {/* Avatar */}
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0 ${avatarColor(tenant.name)}`}>
          {initials(tenant.name)}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-1">
            <p className={`text-sm font-semibold truncate ${selected ? 'text-primary-700' : 'text-slate-800'}`}>
              {tenant.name}
            </p>
            <span className={`shrink-0 text-[9px] font-bold border rounded-full px-1.5 py-0.5 ${statusCls}`}>
              {statusLabel}
            </span>
          </div>
          <div className="flex items-center justify-between mt-0.5">
            <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
              <BedDouble size={9} /> {bedInfo}
              {cycle && (
                <>
                  <span className="text-slate-300">·</span>
                  <Calendar size={9} />
                  {fdate(cycle.cycleStart)} – {fdate(cycle.cycleEnd)}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Outstanding */}
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[10px] text-slate-400">Outstanding</p>
        <p className={`text-sm font-bold tabular-nums ${
          isPaid ? 'text-emerald-500' : isOverdue ? 'text-red-600' : 'text-amber-600'
        }`}>
          {isPaid ? (balance < 0 ? `${fmt(Math.abs(balance))} adv` : '₹0') : fmt(balance)}
        </p>
      </div>
    </button>
  )
}

// ── BillingDetail ─────────────────────────────────────────────────────────────
const BillingDetail = ({ tenant, propertyId, onClose }) => {
  const { addToast } = useToast()

  // Data
  const [rents,         setRents]         = useState([])
  const [rentChanges,   setRentChanges]   = useState([])
  const [ledger,        setLedger]        = useState([])
  const [ledgerBalance, setLedgerBalance] = useState(tenant.ledgerBalance ?? 0)
  const [loading,       setLoading]       = useState(true)
  const [payModal,      setPayModal]      = useState(false)
  const [reminding,     setReminding]     = useState(false)
  const [ledgerPage,    setLedgerPage]    = useState(1)
  const [ledgerTotal,   setLedgerTotal]   = useState(0)
  const LIMIT = 20

  const loadData = useCallback(async (page = 1) => {
    setLoading(page === 1)
    try {
      const [rentsRes, ledgerRes] = await Promise.all([
        getTenantRents(propertyId, tenant._id),
        getTenantLedger(propertyId, tenant._id, { page, limit: LIMIT }),
      ])
      setRents(rentsRes.data?.data ?? [])
      setRentChanges(rentsRes.data?.rentChanges ?? [])
      const ld = ledgerRes.data?.data ?? {}
      setLedger(prev => page === 1 ? (ld.entries ?? []) : [...prev, ...(ld.entries ?? [])])
      setLedgerBalance(ld.currentBalance ?? 0)
      setLedgerTotal(ld.total ?? 0)
      setLedgerPage(page)
    } catch (_) {}
    finally { setLoading(false) }
  }, [propertyId, tenant._id])

  useEffect(() => { loadData(1) }, [loadData])

  // Derived values
  const cycle = useMemo(() => computeCycle(tenant), [tenant])

  const currentRecord = useMemo(() => {
    if (!cycle) return null
    const cm = cycle.cycleStart.getMonth() + 1
    const cy = cycle.cycleStart.getFullYear()
    return rents.find(r => r.month === cm && r.year === cy) ?? null
  }, [cycle, rents])

  const openRecords = useMemo(() =>
    rents.filter(r => ['pending', 'partial', 'overdue'].includes(r.status)),
  [rents])

  const totalOutstanding = openRecords.reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0)
  const bed = tenant.bed
  const roomNum = bed?.room?.roomNumber ?? bed?.room ?? null
  const bedNum  = bed?.bedNumber ?? null

  const handlePaymentSuccess = () => {
    setPayModal(false)
    loadData(1)
  }

  const handleRemind = async () => {
    if (reminding) return
    setReminding(true)
    try {
      await sendRentReminder(propertyId, tenant._id)
      addToast('Reminder sent via WhatsApp', 'success')
    } catch (_) {
      addToast('Failed to send reminder', 'error')
    } finally { setReminding(false) }
  }

  const suggestedAmt = Math.max(0, ledgerBalance)

  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── Sticky Header ── */}
      <div className="shrink-0 bg-white border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${avatarColor(tenant.name)}`}>
            {initials(tenant.name)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-slate-800 leading-tight">{tenant.name}</h3>
              <span className={`text-[9px] font-bold border rounded-full px-1.5 py-0.5 ${
                tenant.status === 'active' ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
                : tenant.status === 'notice' ? 'text-amber-700 bg-amber-50 border-amber-200'
                : 'text-slate-500 bg-slate-50 border-slate-200'
              }`}>
                {tenant.status?.toUpperCase()}
              </span>
            </div>
            {(roomNum || bedNum) && (
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                <BedDouble size={10} className="shrink-0" />
                {roomNum ? `Room ${roomNum}` : ''}{bedNum ? ` · Bed ${bedNum}` : ''}
              </p>
            )}
          </div>
          <button onClick={onClose}
            className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors shrink-0">
            <X size={16} />
          </button>
        </div>
      </div>

      {/* ── Scrollable Body ── */}
      <div className="flex-1 overflow-y-auto pb-24">
        {loading ? (
          <div className="flex items-center justify-center py-16"><Spinner /></div>
        ) : (
          <div className="px-5 py-5 space-y-5">

            {/* ── 1. Financial Snapshot ── */}
            <div className="grid grid-cols-2 gap-3">
              {[
                {
                  label: 'Monthly Rent',
                  value: fmt(tenant.rentAmount),
                  color: 'text-slate-700',
                  sub: 'per billing cycle',
                },
                {
                  label: ledgerBalance > 0 ? 'Outstanding' : ledgerBalance < 0 ? 'Advance Credit' : 'Balance',
                  value: fmt(Math.abs(ledgerBalance)),
                  color: ledgerBalance > 0 ? 'text-red-600' : ledgerBalance < 0 ? 'text-emerald-600' : 'text-slate-400',
                  sub: ledgerBalance > 0
                    ? openRecords.length > 1 ? `${openRecords.length} open cycles` : 'current balance'
                    : ledgerBalance < 0 ? 'will apply to next bill' : 'fully settled',
                },
                {
                  label: 'Due Date',
                  value: cycle ? fdate(cycle.dueDate) : '—',
                  color: cycle && new Date() > cycle.dueDate && ledgerBalance > 0 ? 'text-red-600' : 'text-slate-700',
                  sub: cycle ? `${tenant.dueDate ?? 5} grace days` : 'no cycle',
                },
                {
                  label: 'Check-in',
                  value: fdate(tenant.checkInDate),
                  color: 'text-slate-700',
                  sub: cycle ? `Billing day: ${cycle.cycleStart.getDate()}` : 'no billing',
                },
              ].map(({ label, value, color, sub }) => (
                <div key={label} className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">{label}</p>
                  <p className={`text-base font-bold tabular-nums mt-0.5 ${color}`}>{value}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
                </div>
              ))}
            </div>

            {/* ── 2. Billing Cycle Timeline ── */}
            {cycle && (
              <div className="rounded-2xl bg-white border border-slate-200 px-5 py-4">
                <BillingCycleBar cycleStart={cycle.cycleStart} cycleEnd={cycle.cycleEnd} />
              </div>
            )}

            {/* ── 3. Due Status Banner ── */}
            <DueStatusBanner
              cycle={cycle}
              ledgerBalance={ledgerBalance}
              openRecords={openRecords}
            />

            {/* ── 4. Multiple Cycles Warning ── */}
            {openRecords.length > 1 && (
              <div className="rounded-2xl bg-orange-50 border border-orange-200 px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <AlertTriangle size={16} className="text-orange-600 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-orange-700">
                      Total Outstanding: {fmt(totalOutstanding)}
                    </p>
                    <p className="text-xs text-orange-600 mt-0.5">
                      {openRecords.length} billing cycles unpaid
                    </p>
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  {openRecords.map(r => (
                    <div key={r._id} className="flex items-center justify-between text-xs">
                      <span className="text-orange-700 font-medium">
                        {r.periodStart ? `${fdate(r.periodStart)} – ${fdate(r.periodEnd)}` : `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][r.month - 1]} ${r.year}`}
                      </span>
                      <span className="font-bold text-orange-800 tabular-nums">
                        {fmt(r.amount - (r.paidAmount ?? 0))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── 5. Payment Progress (current cycle) ── */}
            {currentRecord && <PaymentProgress record={currentRecord} />}

            {/* ── 6. Hint text ── */}
            {!cycle && (
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-center">
                <p className="text-xs text-slate-400">
                  Billing cycle starts from move-in date. No active cycle found.
                </p>
              </div>
            )}

            {/* ── 7. Transaction Timeline ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">Transaction History</p>
                <p className="text-[10px] text-slate-400">{ledgerTotal + rentChanges.length} entries</p>
              </div>

              {ledger.length === 0 && rentChanges.length === 0 ? (
                <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-8 text-center">
                  <Wallet size={28} className="mx-auto text-slate-300 mb-2" />
                  <p className="text-sm font-medium text-slate-400">No payments recorded yet</p>
                  <p className="text-xs text-slate-300 mt-1">Transactions will appear here once rent is generated</p>
                </div>
              ) : (() => {
                // Merge ledger entries + rent change events, sort newest-first by date
                const ledgerItems  = ledger.map(e  => ({ _type: 'tx',     date: new Date(e.createdAt),  data: e }))
                const changeItems  = rentChanges.map(e => ({ _type: 'rc',  date: new Date(e.changedAt), data: e }))
                const merged = [...ledgerItems, ...changeItems].sort((a, b) => b.date - a.date)

                return (
                  <div className="rounded-2xl bg-white border border-slate-200 px-4 divide-y divide-slate-50">
                    {merged.map((item, idx) =>
                      item._type === 'tx'
                        ? <TransactionItem  key={item.data._id ?? idx} entry={item.data} />
                        : <RentChangeItem   key={`rc-${item.data.traceId ?? idx}`} event={item.data} />
                    )}
                  </div>
                )
              })()}

              {/* Load more */}
              {ledger.length < ledgerTotal && (
                <button
                  onClick={() => loadData(ledgerPage + 1)}
                  className="mt-3 w-full rounded-xl border border-slate-200 py-2.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-colors">
                  Load more ({ledgerTotal - ledger.length} remaining)
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Sticky Footer: Quick Actions ── */}
      <div className="shrink-0 bg-white border-t border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setPayModal(true)}
            className="flex-1 btn-primary flex items-center justify-center gap-2 py-2.5">
            <IndianRupee size={14} />
            Collect Payment
          </button>
          {tenant.phone && (
            <>
              <a href={waLink(tenant.phone)} target="_blank" rel="noreferrer"
                className="h-10 w-10 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-green-50 hover:text-green-600 hover:border-green-200 transition-colors shrink-0"
                title="WhatsApp">
                <MessageCircle size={15} />
              </a>
              <button
                onClick={handleRemind} disabled={reminding}
                className="h-10 w-10 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-200 transition-colors shrink-0"
                title="Send reminder">
                {reminding ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={15} />}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Collect Payment Modal ── */}
      {payModal && (
        <CollectPaymentModal
          tenant={tenant}
          propertyId={propertyId}
          suggestedAmount={suggestedAmt}
          onClose={() => setPayModal(false)}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  )
}

// ── Main Billing Page ─────────────────────────────────────────────────────────
const Billing = () => {
  const { selectedProperty } = useProperty()
  const propertyId = selectedProperty?._id

  const [activeTab,  setActiveTab]  = useState('tenants')   // 'tenants' | 'reservations'
  const [tenants,    setTenants]    = useState([])
  const [leads,      setLeads]      = useState([])           // reserved tenants with advances
  const [loading,    setLoading]    = useState(true)
  const [selected,   setSelected]   = useState(null)   // selected tenant object
  const [search,     setSearch]     = useState('')
  const [sortBy,     setSortBy]     = useState('outstanding') // 'outstanding' | 'name' | 'status'
  const [showDetail, setShowDetail] = useState(false)   // mobile: show detail panel

  const loadTenants = useCallback(async () => {
    if (!propertyId) return
    setLoading(true)
    try {
      const res = await getTenants(propertyId)
      const data = res.data?.data ?? []
      // Active/notice tenants for Billing tab
      setTenants(data.filter(t => ['active', 'notice'].includes(t.status)))
      // Reserved tenants (reservations) — show those with any advance or all
      setLeads(data.filter(t => t.status === 'reserved'))
    } catch (_) {}
    finally { setLoading(false) }
  }, [propertyId])

  useEffect(() => { loadTenants() }, [loadTenants])

  // Re-select tenant with fresh data after payment
  const handleRefetch = useCallback(async () => {
    await loadTenants()
  }, [loadTenants])

  // Filtered + sorted tenant list
  const filtered = useMemo(() => {
    let list = [...tenants]

    if (search.trim()) {
      const q = search.trim().toLowerCase()
      list = list.filter(t => t.name.toLowerCase().includes(q) || t.phone?.includes(q))
    }

    list.sort((a, b) => {
      if (sortBy === 'outstanding') {
        const ba = a.ledgerBalance ?? 0
        const bb = b.ledgerBalance ?? 0
        return bb - ba  // highest outstanding first
      }
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      if (sortBy === 'status') {
        const order = { overdue: 0, pending: 1, partial: 2, paid: 3 }
        const ca = computeCycle(a)
        const cb = computeCycle(b)
        const sa = (a.ledgerBalance ?? 0) > 0 && ca && new Date() > ca.dueDate ? 'overdue' : (a.ledgerBalance ?? 0) > 0 ? 'pending' : 'paid'
        const sb = (b.ledgerBalance ?? 0) > 0 && cb && new Date() > cb.dueDate ? 'overdue' : (b.ledgerBalance ?? 0) > 0 ? 'pending' : 'paid'
        return (order[sa] ?? 9) - (order[sb] ?? 9)
      }
      return 0
    })

    return list
  }, [tenants, search, sortBy])

  // Summary stats
  const stats = useMemo(() => {
    const total          = tenants.length
    const overdue        = tenants.filter(t => {
      const c = computeCycle(t)
      return (t.ledgerBalance ?? 0) > 0 && c && new Date() > c.dueDate
    }).length
    const collected      = tenants.filter(t => (t.ledgerBalance ?? 0) <= 0).length
    const totalDue       = tenants.reduce((s, t) => s + Math.max(0, t.ledgerBalance ?? 0), 0)
    const reservations   = leads.length
    const totalAdvances  = leads.reduce((s, t) => s + Math.max(0, -(t.ledgerBalance ?? 0)), 0)
    return { total, overdue, collected, totalDue, reservations, totalAdvances }
  }, [tenants, leads])

  const handleSelectTenant = (tenant) => {
    setSelected(tenant)
    setShowDetail(true)
  }

  const handleCloseDetail = () => {
    setShowDetail(false)
    // Delay clearing on mobile so animation can play
    setTimeout(() => setSelected(null), 300)
  }

  if (!propertyId) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState title="No property selected" description="Select a property from the sidebar to view billing." />
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">

      {/* ── Page Header ── */}
      <div className="shrink-0 bg-white border-b border-slate-100 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold text-slate-800 tracking-tight">Billing</h1>
            <p className="text-xs text-slate-400 mt-0.5">Tenant financial tracking &amp; payment collection</p>
          </div>
          <button onClick={loadTenants}
            className="h-8 w-8 rounded-xl border border-slate-200 flex items-center justify-center text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-colors"
            title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>

        {/* Stats strip */}
        {!loading && (
          <div className="mt-3 grid grid-cols-4 gap-2">
            {[
              { label: 'Active',    value: stats.total,        icon: Users,         color: 'text-slate-700' },
              { label: 'Overdue',   value: stats.overdue,      icon: AlertTriangle, color: stats.overdue > 0 ? 'text-red-600' : 'text-slate-300' },
              { label: 'Reserved',  value: stats.reservations, icon: CalendarClock, color: stats.reservations > 0 ? 'text-amber-600' : 'text-slate-300' },
              { label: 'Advances',  value: fmt(stats.totalAdvances), icon: IndianRupee, color: stats.totalAdvances > 0 ? 'text-emerald-600' : 'text-slate-300' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5 text-center">
                <Icon size={12} className={`mx-auto mb-1 ${color}`} />
                <p className={`text-sm font-bold tabular-nums ${color}`}>{value}</p>
                <p className="text-[10px] text-slate-400 font-medium">{label}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Body: Two-panel layout ── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Left: Tenant List ── */}
        <div className={`
          flex flex-col bg-white border-r border-slate-100
          ${showDetail ? 'hidden md:flex' : 'flex'}
          w-full md:w-[320px] lg:w-[360px] shrink-0
        `}>
          {/* Tabs */}
          <div className="shrink-0 flex border-b border-slate-100">
            <button
              onClick={() => { setActiveTab('tenants'); setSelected(null); setShowDetail(false) }}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                activeTab === 'tenants'
                  ? 'text-primary-700 border-b-2 border-primary-500 bg-primary-50/40'
                  : 'text-slate-500 hover:text-slate-700'
              }`}>
              Tenants
              {stats.total > 0 && (
                <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  activeTab === 'tenants' ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-500'
                }`}>{stats.total}</span>
              )}
            </button>
            <button
              onClick={() => { setActiveTab('reservations'); setSelected(null); setShowDetail(false) }}
              className={`flex-1 py-2.5 text-xs font-semibold transition-colors ${
                activeTab === 'reservations'
                  ? 'text-amber-700 border-b-2 border-amber-500 bg-amber-50/40'
                  : 'text-slate-500 hover:text-slate-700'
              }`}>
              Reservations
              {stats.reservations > 0 && (
                <span className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                  activeTab === 'reservations' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                }`}>{stats.reservations}</span>
              )}
            </button>
          </div>

          {/* Search + Sort */}
          <div className="shrink-0 px-4 py-3 border-b border-slate-100 space-y-2">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input
                type="text"
                className="input pl-8 text-sm py-1.5 w-full"
                placeholder={activeTab === 'reservations' ? 'Search reservation…' : 'Search tenant…'}
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            {activeTab === 'tenants' && (
              <div className="flex gap-1.5">
                {[
                  { id: 'outstanding', label: 'Due first' },
                  { id: 'status',      label: 'Overdue' },
                  { id: 'name',        label: 'A–Z' },
                ].map(s => (
                  <button key={s.id} onClick={() => setSortBy(s.id)}
                    className={`flex-1 rounded-lg py-1 text-[10px] font-semibold transition-colors ${
                      sortBy === s.id
                        ? 'bg-primary-600 text-white'
                        : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-primary-300'
                    }`}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-12"><Spinner /></div>
            ) : activeTab === 'tenants' ? (
              filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                  <Users size={32} className="text-slate-200 mb-2" />
                  <p className="text-sm font-medium text-slate-400">No tenants found</p>
                  {search && <p className="text-xs text-slate-300 mt-1">Try a different search</p>}
                </div>
              ) : (
                filtered.map(t => (
                  <TenantBillingCard
                    key={t._id}
                    tenant={t}
                    selected={selected?._id === t._id}
                    onClick={() => handleSelectTenant(t)}
                  />
                ))
              )
            ) : (
              /* Reservations tab */
              (() => {
                const q = search.trim().toLowerCase()
                const filteredLeads = q
                  ? leads.filter(t => t.name.toLowerCase().includes(q) || t.phone?.includes(q))
                  : leads
                return filteredLeads.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                    <CalendarClock size={32} className="text-slate-200 mb-2" />
                    <p className="text-sm font-medium text-slate-400">No reservations found</p>
                    {q
                      ? <p className="text-xs text-slate-300 mt-1">Try a different search</p>
                      : <p className="text-xs text-slate-300 mt-1">Reserved beds will appear here</p>
                    }
                  </div>
                ) : (
                  filteredLeads.map(t => (
                    <ReservationCard
                      key={t._id}
                      tenant={t}
                      selected={selected?._id === t._id}
                      onClick={() => handleSelectTenant(t)}
                    />
                  ))
                )
              })()
            )}
          </div>
        </div>

        {/* ── Right: Billing Detail ── */}
        <div className={`
          flex-1 min-w-0
          ${showDetail ? 'flex' : 'hidden md:flex'}
          ${!selected ? 'items-center justify-center' : ''}
          flex-col
        `}>
          {selected ? (
            activeTab === 'reservations' ? (
              <ReservationDetail
                key={selected._id}
                tenant={selected}
                propertyId={propertyId}
                onClose={handleCloseDetail}
              />
            ) : (
              <BillingDetail
                key={selected._id}
                tenant={selected}
                propertyId={propertyId}
                onClose={handleCloseDetail}
                onRefetch={handleRefetch}
              />
            )
          ) : (
            <div className="flex flex-col items-center justify-center py-16 px-8 text-center">
              <div className={`h-16 w-16 rounded-2xl flex items-center justify-center mb-4 ${
                activeTab === 'reservations'
                  ? 'bg-amber-50 border border-amber-100'
                  : 'bg-primary-50 border border-primary-100'
              }`}>
                {activeTab === 'reservations'
                  ? <CalendarClock size={28} className="text-amber-400" />
                  : <CreditCard size={28} className="text-primary-400" />
                }
              </div>
              <p className="text-base font-semibold text-slate-500">
                {activeTab === 'reservations' ? 'Select a reservation' : 'Select a tenant'}
              </p>
              <p className="text-sm text-slate-400 mt-1.5 leading-relaxed max-w-xs">
                {activeTab === 'reservations'
                  ? 'Click any reservation to view advance payment details and financial history.'
                  : 'Click any tenant on the left to view their billing cycle, due status, and payment history.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default Billing
