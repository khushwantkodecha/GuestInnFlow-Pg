import { useState, useMemo, useEffect, useRef, useCallback, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CheckCircle2, Zap, AlertTriangle, TrendingUp,
  CircleDollarSign, MessageCircle,
  Search, X, RotateCcw, BedDouble, IndianRupee,
  ChevronRight, ChevronLeft, ArrowDownCircle,
  ArrowUpCircle, Wallet, CreditCard, Plus, Printer,
  ExternalLink, Building2, Home, ArrowUpDown, Shield,
} from 'lucide-react'
import { getRents, generateRent, recordPayment, reversePayment, getTenantLedger, addCharge } from '../api/rent'
import { loadEnabledMethods } from '../utils/paymentMethods'
import { getTenantRents, adjustDeposit } from '../api/tenants'
import { TenantProfile } from './Tenants'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import { useToast } from '../context/ToastContext'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'
import Drawer from '../components/ui/Drawer'
import { RentSkeleton } from '../components/ui/Skeleton'

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
const StatusPill = memo(({ status }) => {
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
})

// ── Summary Cards ─────────────────────────────────────────────────────────────
const RENT_STAT_STYLES = {
  amber:   { num: 'text-amber-700',   ic: 'bg-amber-50 border-amber-100 text-amber-600'     },
  orange:  { num: 'text-orange-700',  ic: 'bg-orange-50 border-orange-100 text-orange-600'  },
  primary: { num: 'text-primary-700', ic: 'bg-primary-50 border-primary-100 text-primary-600' },
  emerald: { num: 'text-emerald-700', ic: 'bg-emerald-50 border-emerald-100 text-emerald-600' },
  dim:     { num: 'text-slate-300',   ic: 'bg-slate-50 border-slate-200 text-slate-300'     },
}

const SummaryCards = memo(({ rents }) => {
  const chargesMap = new Map()
  rents.forEach(r => {
    const tid = r.tenant?._id
    if (tid && !chargesMap.has(tid)) chargesMap.set(tid, r.chargesDue ?? 0)
  })
  const chargesDue = [...chargesMap.values()].reduce((s, c) => s + c, 0)

  const rentDue = rents
    .filter(r => ['pending', 'partial', 'overdue'].includes(r.status))
    .reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0)

  const totalOutstanding = rentDue + chargesDue

  const collected    = rents.reduce((s, r) => r.status === 'paid' ? s + r.amount : s + (r.paidAmount ?? 0), 0)
  const expected     = rents.reduce((s, r) => s + r.amount, 0)
  const overdueCount = rents.filter(r => r.status === 'overdue').length
  const rate         = expected > 0 ? Math.round((collected / expected) * 100) : 0

  const cardBase = 'rounded-2xl bg-white border border-slate-200 px-4 py-3.5 flex items-center gap-3 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300 sm:flex-1 sm:min-w-[130px]'

  return (
    <div className="grid grid-cols-2 gap-3 sm:flex sm:gap-3 sm:overflow-x-auto sm:pb-1">

      {/* Rent Due */}
      {(() => {
        const s = rentDue > 0 ? RENT_STAT_STYLES.amber : RENT_STAT_STYLES.dim
        return (
          <div className={cardBase}>
            <div className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 ${s.ic}`}>
              <IndianRupee size={15} />
            </div>
            <div className="min-w-0">
              <p className={`text-[18px] font-bold leading-none tabular-nums ${s.num}`}>{fmt(rentDue)}</p>
              {overdueCount > 0 && (
                <p className="text-[10px] font-semibold text-red-500 mt-0.5 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse inline-block shrink-0" />{overdueCount} overdue
                </p>
              )}
              <p className="text-[10px] font-medium text-slate-400 mt-0.5">Rent Due</p>
            </div>
          </div>
        )
      })()}

      {/* Charges Due */}
      {(() => {
        const s = chargesDue > 0 ? RENT_STAT_STYLES.orange : RENT_STAT_STYLES.dim
        return (
          <div className={cardBase}>
            <div className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 ${s.ic}`}>
              <AlertTriangle size={15} />
            </div>
            <div className="min-w-0">
              <p className={`text-[18px] font-bold leading-none tabular-nums ${s.num}`}>{fmt(chargesDue)}</p>
              <p className="text-[10px] font-medium text-slate-400 mt-0.5">Charges Due</p>
            </div>
          </div>
        )
      })()}

      {/* Outstanding */}
      {(() => {
        const s = totalOutstanding > 0 ? RENT_STAT_STYLES.primary : RENT_STAT_STYLES.dim
        return (
          <div className={cardBase}>
            <div className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 ${s.ic}`}>
              <CircleDollarSign size={15} />
            </div>
            <div className="min-w-0">
              <p className={`text-[18px] font-bold leading-none tabular-nums ${s.num}`}>{fmt(totalOutstanding)}</p>
              <p className="text-[10px] font-medium text-slate-400 mt-0.5">{totalOutstanding === 0 ? 'All Settled' : 'Outstanding'}</p>
            </div>
          </div>
        )
      })()}

      {/* Collected */}
      <div className={cardBase}>
        <div className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 ${RENT_STAT_STYLES.emerald.ic}`}>
          <CheckCircle2 size={15} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <p className={`text-[18px] font-bold leading-none tabular-nums ${RENT_STAT_STYLES.emerald.num}`}>{fmt(collected)}</p>
            <span className="text-[11px] font-bold text-emerald-600 tabular-nums">{rate}%</span>
          </div>
          <div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-400 transition-all duration-700" style={{ width: `${rate}%` }} />
          </div>
          <p className="text-[10px] font-medium text-slate-400 mt-0.5">Collected</p>
        </div>
      </div>

    </div>
  )
})

// ── Tenant avatar helpers ─────────────────────────────────────────────────────
const AVATAR_PALETTE = [
  'bg-primary-100 text-primary-700',
  'bg-blue-100 text-blue-700',
  'bg-violet-100 text-violet-700',
  'bg-rose-100 text-rose-700',
  'bg-amber-100 text-amber-700',
  'bg-emerald-100 text-emerald-700',
]
const tenantInitials    = (name = '') => name.trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?'
const tenantAvatarColor = (name = '') => AVATAR_PALETTE[(name.charCodeAt(0) || 0) % AVATAR_PALETTE.length]

// ── Rent Row ──────────────────────────────────────────────────────────────────
const RentRow = memo(({ rent: r, onMarkPaid, onLedger, onProfile, onAddCharge }) => {
  const isOverdue  = r.status === 'overdue'
  const isPending  = r.status === 'pending'
  const isPaid     = r.status === 'paid'
  const days       = isOverdue ? daysOverdue(r.dueDate) : 0
  const bed        = r.tenant?.bed
  const roomNum    = bed?.room?.roomNumber
  const bedNum     = bed?.bedNumber
  const balance    = r.tenant?.ledgerBalance ?? null
  const avColor    = tenantAvatarColor(r.tenant?.name ?? '')
  const avText     = tenantInitials(r.tenant?.name ?? '')

  return (
    <tr
      className={`group cursor-pointer transition-colors ${
        isOverdue ? 'bg-red-50/20 hover:bg-red-50/40' : 'hover:bg-slate-50/70'
      }`}
      onClick={() => onLedger(r.tenant)}
    >
      {/* Tenant */}
      <td className="px-3 py-4">
        <div className="flex items-center gap-3">
          <div className={`h-8 w-8 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 ${avColor}`}>
            {avText}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <button
                onClick={e => { e.stopPropagation(); onProfile?.(r.tenant) }}
                className={`text-sm font-semibold leading-tight text-left hover:underline ${isOverdue ? 'text-red-600' : 'text-slate-800'}`}
              >
                {r.tenant?.name ?? '—'}
              </button>
              {r.tenant?.status === 'vacated' && (
                <span className="text-[9px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5 leading-none shrink-0">
                  Vacated
                </span>
              )}
              <ExternalLink size={10} className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </div>
            {r.tenant?.phone && (
              <p className="text-xs text-slate-400 mt-0.5">{r.tenant.phone}</p>
            )}
            {balance !== null && balance < 0 && (
              <p className="text-[10px] font-semibold text-emerald-600 mt-0.5 flex items-center gap-0.5">
                <Wallet size={8} /> {fmt(Math.abs(balance))} advance
              </p>
            )}
          </div>
        </div>
      </td>

      {/* Room / Bed */}
      <td className="px-3 py-4">
        {roomNum
          ? <div className="inline-flex items-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
              <BedDouble size={11} />
              R{roomNum}{bedNum ? ` / B${bedNum}` : ''}
            </div>
          : <span className="text-xs text-slate-300">—</span>
        }
      </td>

      {/* Amount */}
      <td className="px-3 py-4">
        {isPaid ? (
          <div>
            <p className="text-sm font-bold tabular-nums text-slate-800">{fmt(r.amount)}</p>
            {(r.chargesDue ?? 0) > 0 && (
              <div className="mt-1 inline-flex items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-2 py-0.5">
                <AlertTriangle size={9} className="text-orange-500" />
                <span className="text-[10px] font-semibold text-orange-600">{fmt(r.chargesDue)} charges due</span>
              </div>
            )}
          </div>
        ) : (() => {
          const rentRemaining = r.amount - (r.paidAmount ?? 0)
          const charges       = r.chargesDue ?? 0
          const total         = rentRemaining + charges
          const hasCharges    = charges > 0
          const isPartialPay  = (r.paidAmount ?? 0) > 0
          return (
            <div>
              <p className={`text-sm font-bold tabular-nums ${isOverdue ? 'text-red-600' : 'text-slate-800'}`}>
                {fmt(total)}
              </p>
              {hasCharges ? (
                <div className="mt-1 space-y-0.5">
                  <p className="text-[10px] text-slate-400 tabular-nums flex items-center gap-0.5">
                    <IndianRupee size={8} className="text-amber-400" />
                    Rent {fmt(rentRemaining)}
                    {isPartialPay && <span className="text-amber-500 ml-1">({fmt(r.paidAmount)} paid)</span>}
                  </p>
                  <p className="text-[10px] text-orange-500 font-semibold tabular-nums flex items-center gap-0.5">
                    <AlertTriangle size={8} /> Charges {fmt(charges)}
                  </p>
                </div>
              ) : isPartialPay ? (
                <p className="text-[10px] text-amber-600 font-medium mt-0.5">
                  {fmt(r.paidAmount)} paid · {fmt(rentRemaining)} due
                </p>
              ) : null}
            </div>
          )
        })()}
      </td>

      {/* Due Date / Cycle */}
      <td className="px-3 py-4">
        <p className={`text-sm font-medium ${isOverdue ? 'text-red-600' : 'text-slate-700'}`}>
          {fdate(r.dueDate)}
        </p>
        {r.periodStart && r.periodEnd && (
          <p className="text-[10px] text-slate-400 mt-0.5">
            {fdate(r.periodStart)} – {fdate(r.periodEnd)}
          </p>
        )}
        {isOverdue && days > 0 && (
          <div className="mt-1 inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-2 py-0.5">
            <AlertTriangle size={8} className="text-red-500" />
            <span className="text-[10px] font-bold text-red-600">{days}d overdue</span>
          </div>
        )}
      </td>

      {/* Status */}
      <td className="px-3 py-4">
        <StatusPill status={r.status} />
      </td>

      {/* Paid On */}
      <td className="px-3 py-4">
        {r.status === 'paid' ? (
          <div>
            <p className="text-sm font-medium text-slate-700">{fdate(r.paymentDate)}</p>
            {r.paymentMethod && (
              <span className="mt-1 inline-flex items-center rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 capitalize">
                {r.paymentMethod.replace('_', ' ')}
              </span>
            )}
          </div>
        ) : <span className="text-slate-300 text-sm">—</span>}
      </td>

      {/* Actions */}
      <td className="px-3 py-4 pr-4">
        <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
          {(isOverdue || isPending || r.status === 'partial') && (
            <>
              <button onClick={() => onMarkPaid(r)}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all shadow-sm ${
                  isOverdue
                    ? 'bg-red-500 text-white hover:bg-red-600'
                    : 'bg-primary-500 text-white hover:bg-primary-600'
                }`}>
                <CheckCircle2 size={11} /> Collect
              </button>
              {r.tenant?.phone && (
                <a href={waLink(r.tenant.phone)} target="_blank" rel="noreferrer"
                  onClick={e => e.stopPropagation()}
                  title="WhatsApp reminder"
                  className="rounded-xl border border-transparent p-1.5 text-slate-400 hover:border-green-200 hover:bg-green-50 hover:text-green-600 transition-all">
                  <MessageCircle size={13} />
                </a>
              )}
            </>
          )}
          {r.status === 'paid' && (
            <span className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-700">
              <CheckCircle2 size={11} /> Paid
            </span>
          )}
          <button onClick={() => onAddCharge?.(r.tenant)}
            className="rounded-xl border border-transparent p-1.5 text-slate-400 hover:border-orange-200 hover:bg-orange-50 hover:text-orange-500 transition-all" title="Add charge">
            <Plus size={13} />
          </button>
          <button onClick={() => onLedger(r.tenant)}
            className="rounded-xl border border-transparent p-1.5 text-slate-400 hover:border-primary-200 hover:bg-primary-50 hover:text-primary-500 transition-all" title="View ledger">
            <ChevronRight size={13} />
          </button>
        </div>
      </td>
    </tr>
  )
})

// ── Mobile rent card ─────────────────────────────────────────────────────────
const RentCard = memo(({ rent: r, onMarkPaid, onLedger }) => {
  const isOverdue = r.status === 'overdue'
  const isPaid    = r.status === 'paid'
  const isPartial = r.status === 'partial'
  const bed       = r.tenant?.bed
  const roomNum   = bed?.room?.roomNumber
  const bedNum    = bed?.bedNumber
  const avColor   = tenantAvatarColor(r.tenant?.name ?? '')
  const avText    = tenantInitials(r.tenant?.name ?? '')
  const rentRemaining = r.amount - (r.paidAmount ?? 0)
  const charges   = r.chargesDue ?? 0
  const total     = isPaid ? r.amount : rentRemaining + charges
  const hasDues   = !isPaid && (r.status === 'pending' || isPartial || isOverdue)
  const days      = isOverdue ? daysOverdue(r.dueDate) : 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onLedger(r.tenant)}
      onKeyDown={e => e.key === 'Enter' && onLedger(r.tenant)}
      className={`flex items-center gap-3 px-4 py-3 cursor-pointer touch-manipulation active:bg-slate-50/80 transition-colors ${
        isOverdue ? 'border-l-[3px] border-l-red-400 bg-red-50/20' : isPartial ? 'border-l-[3px] border-l-orange-400' : r.status === 'pending' ? 'border-l-[3px] border-l-amber-400' : 'border-l-[3px] border-l-transparent'
      }`}
    >
      <div className={`h-9 w-9 rounded-xl flex items-center justify-center text-[11px] font-bold shrink-0 ${avColor}`}>
        {avText}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className={`text-sm font-semibold truncate ${isOverdue ? 'text-red-600' : 'text-slate-800'}`}>
            {r.tenant?.name ?? '—'}
          </p>
          {r.tenant?.status === 'vacated' && (
            <span className="text-[9px] font-bold uppercase tracking-wide bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5 leading-none shrink-0">Vacated</span>
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {roomNum && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
              <BedDouble size={9} /> R{roomNum}{bedNum ? `/B${bedNum}` : ''}
            </span>
          )}
          {isOverdue && days > 0 && (
            <span className="text-[10px] font-semibold text-red-500">{days}d overdue</span>
          )}
          {isPartial && (r.paidAmount ?? 0) > 0 && (
            <span className="text-[10px] text-amber-600 font-medium">{fmt(r.paidAmount)} paid</span>
          )}
          {isPaid && r.paymentDate && (
            <span className="text-[10px] text-slate-400">{fdate(r.paymentDate)}</span>
          )}
          {!isPaid && r.dueDate && !isOverdue && (
            <span className="text-[10px] text-slate-400">Due {fdate(r.dueDate)}</span>
          )}
        </div>
      </div>
      <div className="shrink-0 flex flex-col items-end gap-1.5">
        <p className={`text-sm font-bold tabular-nums ${isOverdue ? 'text-red-600' : isPaid ? 'text-emerald-600' : 'text-slate-800'}`}>
          {fmt(total)}
        </p>
        {hasDues ? (
          <button
            onClick={e => { e.stopPropagation(); onMarkPaid(r) }}
            className={`inline-flex items-center gap-1 rounded-xl px-3 py-1.5 text-[11px] font-bold text-white shadow-sm ${isOverdue ? 'bg-red-500 active:bg-red-600' : 'bg-primary-500 active:bg-primary-600'}`}
          >
            <CheckCircle2 size={10} /> Collect
          </button>
        ) : (
          <StatusPill status={r.status} />
        )}
      </div>
    </div>
  )
})

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
const PaymentModal = ({ tenant, openRents, currentBalance, onConfirm, onClose, paying, propertyId }) => {
  const rentDue    = openRents.reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0)
  const chargesDue = openRents[0]?.chargesDue ?? 0
  const totalDue   = rentDue + chargesDue

  const METHODS = loadEnabledMethods(propertyId)

  const [form, setForm] = useState({
    amount:      String(Math.max(0, totalDue)),
    method:      METHODS[0] ?? 'cash',
    referenceId: '',
    paymentDate: new Date().toISOString().split('T')[0],
    notes:       '',
  })

  const payingAmt = Math.max(0, Number(form.amount) || 0)
  const { rows, advanceAmount } = computeAllocation(openRents, payingAmt)
  // After covering rent records, remaining goes to charges first, then advance
  const chargesApplied = Math.min(chargesDue, Math.max(0, advanceAmount))
  const actualAdvance  = Math.max(0, advanceAmount - chargesApplied)
  const isAdvance = actualAdvance > 0 && payingAmt > 0
  const isPartial = payingAmt < totalDue && payingAmt > 0

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

        {/* Breakdown — only when there are dues */}
        {totalDue > 0 && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white divide-y divide-slate-100 text-xs">
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-slate-500 flex items-center gap-1.5">
                <IndianRupee size={10} className="text-amber-400" /> Rent
              </span>
              <span className="font-semibold text-slate-700 tabular-nums">{fmt(rentDue)}</span>
            </div>
            {chargesDue > 0 && (
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-orange-500 font-medium flex items-center gap-1.5">
                  <AlertTriangle size={10} /> Charges
                </span>
                <span className="font-semibold text-orange-600 tabular-nums">{fmt(chargesDue)}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-3 py-2 bg-primary-50/40 rounded-b-lg">
              <span className="font-semibold text-primary-700 flex items-center gap-1.5">
                <CircleDollarSign size={10} /> Total Outstanding
              </span>
              <span className="font-bold text-primary-700 tabular-nums">{fmt(totalDue)}</span>
            </div>
          </div>
        )}
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
              <Wallet size={11} /> {fmt(actualAdvance)} will go toward advance credit
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
              {/* Charges row in allocation preview */}
              {chargesDue > 0 && (() => {
                return (
                  <div className={`flex items-center justify-between px-3 py-2.5 ${chargesApplied > 0 ? '' : 'opacity-40'}`}>
                    <div>
                      <p className="text-xs font-medium text-orange-600 flex items-center gap-1">
                        <AlertTriangle size={10} /> Charges
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{fmt(chargesDue)} outstanding</p>
                    </div>
                    <div className="text-right">
                      {chargesApplied > 0 ? (
                        <>
                          <p className="text-xs font-bold text-emerald-600 tabular-nums">−{fmt(chargesApplied)}</p>
                          {chargesApplied >= chargesDue
                            ? <p className="text-[10px] text-emerald-500 font-medium">Fully settled</p>
                            : <p className="text-[10px] text-amber-500 font-medium">{fmt(chargesDue - chargesApplied)} remains</p>
                          }
                        </>
                      ) : (
                        <p className="text-xs text-slate-300">Not covered</p>
                      )}
                    </div>
                  </div>
                )
              })()}
              {isAdvance && (
                <div className="flex items-center justify-between px-3 py-2.5 bg-emerald-50">
                  <p className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                    <Wallet size={11} /> Advance credit
                  </p>
                  <p className="text-xs font-bold text-emerald-600 tabular-nums">+{fmt(actualAdvance)}</p>
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
const TenantLedger = ({ tenant, propertyId, onCollect }) => {
  const [view, setView] = useState('ledger') // 'ledger' | 'records'
  const [chargeOpen, setChargeOpen] = useState(false)
  const [chargeSaving, setChargeSaving] = useState(false)
  const [chargeForm, setChargeForm] = useState({
    amount: '', description: '', date: new Date().toISOString().split('T')[0],
  })
  const [confirmReverse, setConfirmReverse] = useState(null)
  const [reversing, setReversing] = useState(false)
  const [depositLoading, setDepositLoading] = useState(false)
  const toast = useToast()

  // Ledger entries (new financial layer)
  const { data: ledgerData, loading: ledgerLoading, refetch: refetchLedger } = useApi(
    () => getTenantLedger(propertyId, tenant._id),
    [tenant._id]
  )
  const { entries = [], currentBalance = 0, rentDue = 0, chargesDue: tenantChargesDue = 0 } = ledgerData?.data ?? {}

  // Legacy rent records (per-period)
  const { data: rentData, loading: rentLoading, refetch: refetchRents } = useApi(
    () => getTenantRents(propertyId, tenant._id),
    [tenant._id]
  )
  const rents = rentData?.data ?? []

  const handleAddCharge = async (e) => {
    e.preventDefault()
    const amt = Number(chargeForm.amount)
    if (!amt || amt <= 0) return toast('Enter a valid amount', 'error')
    if (!chargeForm.description.trim()) return toast('Enter a description', 'error')
    setChargeSaving(true)
    try {
      await addCharge(propertyId, tenant._id, {
        amount:      amt,
        description: chargeForm.description.trim(),
        date:        chargeForm.date || undefined,
      })
      toast('Charge added', 'success')
      setChargeOpen(false)
      setChargeForm({ amount: '', description: '', date: new Date().toISOString().split('T')[0] })
      refetchLedger()
      refetchRents()
    } catch (err) {
      toast(err.response?.data?.message || 'Error adding charge', 'error')
    } finally {
      setChargeSaving(false)
    }
  }

  const handleReverse = async () => {
    if (!confirmReverse) return
    setReversing(true)
    try {
      await reversePayment(propertyId, confirmReverse.paymentId, { reason: 'Manual reversal' })
      toast('Payment reversed', 'success')
      setConfirmReverse(null)
      refetchLedger()
      refetchRents()
    } catch (err) {
      toast(err.response?.data?.message || 'Error reversing payment', 'error')
    } finally {
      setReversing(false)
    }
  }

  const totalBilled  = rents.reduce((s, r) => s + r.amount, 0)
  const totalPaid    = rents.reduce((s, r) => r.status === 'paid' ? s + r.amount : s + (r.paidAmount ?? 0), 0)

  const hasAdvance = currentBalance < 0
  const isPending  = currentBalance > 0

  const depositAvailable = tenant.depositPaid && (tenant.depositBalance ?? 0) > 0
  const depositBalance   = tenant.depositBalance ?? 0

  const handleUseDeposit = async () => {
    if (!depositAvailable || !isPending) return
    const applyAmt = Math.min(depositBalance, currentBalance)
    setDepositLoading(true)
    try {
      await adjustDeposit(propertyId, tenant._id, { amount: applyAmt })
      toast(`₹${applyAmt.toLocaleString('en-IN')} deposit used to clear dues`, 'success')
      refetchLedger()
      refetchRents()
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to use deposit', 'error')
    } finally {
      setDepositLoading(false)
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-smooth">
      {/* Header */}
      <div className="px-6 py-5 bg-slate-50 border-b border-slate-100">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-base font-bold text-slate-800">{tenant.name}</p>
            <p className="text-xs text-slate-400 mt-0.5">{tenant.phone}</p>
          </div>
          <button
            onClick={() => setChargeOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs font-semibold text-orange-600 hover:bg-orange-100 transition-colors"
          >
            <Plus size={12} /> Add Charge
          </button>
        </div>

        {/* Balance block */}
        <div className={`mt-4 rounded-xl px-4 py-3 ${
          hasAdvance   ? 'bg-emerald-50 border border-emerald-200' :
          isPending    ? 'bg-amber-50 border border-amber-200' :
                         'bg-slate-100 border border-slate-200'
        }`}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              {hasAdvance
                ? <Wallet size={15} className="text-emerald-600 mt-0.5 shrink-0" />
                : <IndianRupee size={15} className={`mt-0.5 shrink-0 ${isPending ? 'text-amber-600' : 'text-slate-400'}`} />
              }
              <div>
                <p className={`text-xs font-medium ${hasAdvance ? 'text-emerald-600' : isPending ? 'text-amber-600' : 'text-slate-500'}`}>
                  {hasAdvance ? 'Advance Credit' : isPending ? 'Outstanding Balance' : 'Fully Settled'}
                </p>
                <p className={`text-xl font-bold tabular-nums leading-tight ${hasAdvance ? 'text-emerald-700' : isPending ? 'text-amber-700' : 'text-slate-500'}`}>
                  {fmt(Math.abs(currentBalance))}
                </p>
                {/* Req #1: breakdown inline under amount */}
                {isPending && (rentDue > 0 || tenantChargesDue > 0) && (
                  <p className="text-[10px] text-amber-500 mt-0.5">
                    {[rentDue > 0 && `${fmt(rentDue)} rent`, tenantChargesDue > 0 && `${fmt(tenantChargesDue)} charges`].filter(Boolean).join(' + ')}
                  </p>
                )}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-right shrink-0">
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

          {/* Req #2: action guidance */}
          {isPending && (
            <p className="mt-2 text-[10px] text-amber-600 border-t border-amber-200 pt-2">
              Collect payment or adjust from deposit to clear dues.
            </p>
          )}
        </div>

        {/* Req #3: deposit suggestion strip */}
        {isPending && depositAvailable && (
          <div className="mt-2 flex items-center justify-between rounded-lg bg-teal-50 border border-teal-200 px-3 py-2">
            <div className="flex items-center gap-2">
              <Shield size={12} className="text-teal-500 shrink-0" />
              <p className="text-[10px] font-medium text-teal-700">
                {fmt(depositBalance)} deposit available — can be used to clear dues
              </p>
            </div>
          </div>
        )}

        {/* Req #4: balance breakdown */}
        {isPending && (rentDue > 0 || tenantChargesDue > 0) && (
          <div className="mt-2 rounded-lg border border-slate-100 bg-white divide-y divide-slate-100 text-xs overflow-hidden">
            {rentDue > 0 && (
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-slate-500 flex items-center gap-1.5">
                  <IndianRupee size={10} className="text-amber-400" /> Rent pending
                </span>
                <span className="font-semibold text-amber-700 tabular-nums">{fmt(rentDue)}</span>
              </div>
            )}
            {tenantChargesDue > 0 && (
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-orange-500 flex items-center gap-1.5 font-medium">
                  <AlertTriangle size={10} /> Charges pending
                </span>
                <span className="font-semibold text-orange-600 tabular-nums">{fmt(tenantChargesDue)}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-3 py-1.5 bg-amber-50/60">
              <span className="font-semibold text-amber-700 flex items-center gap-1.5">
                <CircleDollarSign size={10} /> Total remaining
              </span>
              <span className="font-bold text-amber-800 tabular-nums">{fmt(currentBalance)}</span>
            </div>
          </div>
        )}

        {/* Req #5: action buttons */}
        {isPending && (
          <div className="mt-3 flex flex-col gap-2">
            <button
              onClick={() => onCollect?.({ tenant })}
              className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary-500 hover:bg-primary-600 text-white text-xs font-bold py-2.5 transition-colors"
            >
              <CircleDollarSign size={13} />
              Collect Payment · {fmt(currentBalance)}
            </button>
            {depositAvailable && (
              <button
                onClick={handleUseDeposit}
                disabled={depositLoading}
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-teal-50 hover:bg-teal-100 border border-teal-200 text-teal-700 text-xs font-bold py-2 transition-colors disabled:opacity-50"
              >
                <Shield size={12} />
                {depositLoading ? 'Applying…' : `Use Deposit · ${fmt(Math.min(depositBalance, currentBalance))}`}
              </button>
            )}
          </div>
        )}

      </div>

      {/* Sticky view toggle */}
      <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-6 py-2.5">
        <div className="flex rounded-xl border border-slate-200 bg-white p-1 gap-1">
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
      <div className="px-6 py-5">

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
                  const isDebit      = e.type === 'debit'
                  const isFirst      = idx === 0
                  const balNeg       = e.balanceAfter < 0
                  const canReverse   = e.referenceType === 'payment_received' && e.referenceId
                  const isConfirming = confirmReverse?.entryId === e._id

                  // Detect room-change entries that baked an advance into one ledger record
                  const advMatch   = e.referenceType === 'rent_generated'
                    && e.description?.match(/·\s*₹([\d,]+)\s*advance applied/)
                  const advAmt     = advMatch ? parseInt(advMatch[1].replace(/,/g, ''), 10) : 0
                  const mainDesc   = advAmt > 0
                    ? e.description.replace(/\s*·\s*₹[\d,]+\s*advance applied/, '')
                    : (e.description ?? (isDebit ? 'Rent charged' : 'Payment received'))

                  return (
                    <div key={e._id ?? idx} className="flex gap-3 items-start">
                      {/* Icon dot */}
                      <div className={`mt-0.5 shrink-0 h-9 w-9 rounded-full flex items-center justify-center border-2 bg-white z-10 ${
                        isDebit
                          ? 'border-amber-200 text-amber-500'
                          : 'border-emerald-200 text-emerald-500'
                      }`}>
                        {isDebit ? <ArrowDownCircle size={14} /> : <ArrowUpCircle size={14} />}
                      </div>

                      {/* Card */}
                      <div className={`flex-1 rounded-xl border px-3.5 py-3 ${
                        isFirst ? 'bg-white shadow-sm border-slate-200' : 'bg-white border-slate-100'
                      }`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-700 leading-tight">
                              {mainDesc}
                            </p>
                            <p className="text-[10px] text-slate-400 mt-0.5">{fdateTime(e.createdAt)}</p>
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end gap-1">
                            <p className={`text-sm font-bold tabular-nums ${isDebit ? 'text-red-600' : 'text-emerald-600'}`}>
                              {isDebit ? '+' : '−'}{fmt(e.amount)}
                            </p>
                            <p className={`text-[10px] font-medium tabular-nums ${balNeg ? 'text-emerald-500' : e.balanceAfter > 0 ? 'text-amber-500' : 'text-slate-400'}`}>
                              {balNeg ? `${fmt(Math.abs(e.balanceAfter))} credit` : `${fmt(e.balanceAfter)} due`}
                            </p>
                            {canReverse && !isConfirming && (
                              <button
                                onClick={() => setConfirmReverse({ entryId: e._id, paymentId: String(e.referenceId), amount: e.amount, description: e.description })}
                                className="text-[10px] font-semibold text-slate-400 hover:text-red-500 transition-colors"
                              >
                                Reverse
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Advance-applied sub-row for room-change entries */}
                        {advAmt > 0 && (
                          <div className="mt-2 flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-1.5">
                            <span className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                              <ArrowUpCircle size={11} />
                              Advance applied
                            </span>
                            <span className="text-[11px] font-bold text-emerald-600 tabular-nums">−{fmt(advAmt)}</span>
                          </div>
                        )}

                        {/* Inline reversal confirm */}
                        {isConfirming && (
                          <div className="mt-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 flex items-center justify-between gap-3">
                            <p className="text-xs text-red-700 font-medium">Reverse {fmt(e.amount)} payment?</p>
                            <div className="flex gap-1.5 shrink-0">
                              <button onClick={() => setConfirmReverse(null)}
                                className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                                Cancel
                              </button>
                              <button onClick={handleReverse} disabled={reversing}
                                className="rounded-lg bg-red-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-600 transition-colors disabled:opacity-60">
                                {reversing ? 'Reversing…' : 'Confirm'}
                              </button>
                            </div>
                          </div>
                        )}
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
              {rents.map(r => {
                const isOpen = ['pending', 'partial', 'overdue'].includes(r.status)
                return (
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
                      {isOpen && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          Due {fdate(r.dueDate)}
                          {r.periodStart && r.periodEnd && (
                            <span className="ml-1">· {fdate(r.periodStart)} – {fdate(r.periodEnd)}</span>
                          )}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right">
                        <p className="text-sm font-bold text-slate-700 tabular-nums">{fmt(r.amount)}</p>
                        {(r.paidAmount ?? 0) > 0 && isOpen && (
                          <p className="text-xs text-amber-600 font-medium">{fmt(r.paidAmount)} paid</p>
                        )}
                        <StatusPill status={r.status} />
                      </div>
                      {isOpen && onCollect && (
                        <button
                          onClick={() => onCollect(r)}
                          className="shrink-0 flex items-center gap-1 rounded-lg bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 transition-colors"
                        >
                          <CheckCircle2 size={11} /> Collect
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      {/* ── Add Charge Modal ── */}
      {chargeOpen && (
        <Modal title="Add Charge" onClose={() => setChargeOpen(false)} size="sm" zIndex="z-[70]">
          <form onSubmit={handleAddCharge} className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-orange-50 border border-orange-200 px-4 py-3">
              <IndianRupee size={15} className="text-orange-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-800">{tenant.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">A debit entry will be added to this tenant's ledger.</p>
              </div>
            </div>

            <div>
              <label className="label">Amount (₹)</label>
              <input
                type="number" min="1" step="1" className="input" placeholder="e.g. 500"
                value={chargeForm.amount}
                onChange={e => setChargeForm(f => ({ ...f, amount: e.target.value }))}
                required
              />
            </div>

            <div>
              <label className="label">Description</label>
              <input
                className="input" placeholder="e.g. Electricity bill, Damage repair…"
                value={chargeForm.description}
                onChange={e => setChargeForm(f => ({ ...f, description: e.target.value }))}
                required
              />
            </div>

            <div>
              <label className="label">Date</label>
              <input
                type="date" className="input"
                value={chargeForm.date}
                onChange={e => setChargeForm(f => ({ ...f, date: e.target.value }))}
              />
            </div>

            <div className="flex gap-2 pt-1 border-t border-slate-100">
              <button type="button" className="btn-secondary flex-1" onClick={() => setChargeOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary flex-1" disabled={chargeSaving}>
                <Plus size={14} /> {chargeSaving ? 'Saving…' : 'Add Charge'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}

// ── No Property Empty State ───────────────────────────────────────────────────
const NoPropertyState = () => {
  const navigate = useNavigate()

  const highlights = [
    { icon: IndianRupee,     label: 'Rent Collection',    desc: 'Record payments, track partial & full payments'      },
    { icon: CircleDollarSign,label: 'Outstanding Balance', desc: 'See rent due, charges, and total per tenant'         },
    { icon: TrendingUp,      label: 'Collection Rate',     desc: 'Track monthly collection vs expected in real time'   },
    { icon: Wallet,          label: 'Ledger & Charges',    desc: 'Full audit trail with manual charge support'         },
  ]

  return (
    <div className="px-4 py-8 pb-24 md:pb-8">
      <div className="w-full max-w-xl mx-auto">

        {/* Hero */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-3xl mb-5 mx-auto"
            style={{ background: 'rgba(96,195,173,0.12)', border: '1.5px solid rgba(96,195,173,0.25)' }}>
            <CreditCard size={32} style={{ color: '#60C3AD' }} />
          </div>
          <h2 className="text-xl font-bold text-slate-800">No property selected</h2>
          <p className="text-sm text-slate-400 mt-2 max-w-xs mx-auto leading-relaxed">
            Select a property from the sidebar to manage rent collection.
          </p>
        </div>

        {/* CTA */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden mb-5">
          <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">No properties yet?</p>
              <p className="text-xs text-slate-400 mt-0.5">Add a property, add rooms &amp; tenants, then collect rent</p>
            </div>
            <button
              onClick={() => navigate('/properties')}
              className="w-full sm:w-auto shrink-0 inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95"
              style={{ background: 'linear-gradient(135deg, #60C3AD 0%, #4aa897 100%)' }}
            >
              <Building2 size={14} /> Add Property
            </button>
          </div>
          <div className="h-px bg-slate-100" />
          <div className="px-5 py-3 bg-slate-50/60 flex items-center gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-sm font-medium text-slate-600">
              <Home size={10} className="text-emerald-500" />
              Your property
              <ChevronRight size={10} className="text-slate-300" />
            </div>
            <span className="md:hidden">Already have a property? Switch from the <span className="font-semibold text-slate-500">More</span> tab below.</span>
            <span className="hidden md:inline">shows in the sidebar panel on the left</span>
          </div>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-2 gap-3">
          {highlights.map(({ icon: Icon, label, desc }) => (
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

// ── Main Page ─────────────────────────────────────────────────────────────────
const now = new Date()
const FILTERS = [
  { key: 'all',          label: 'All'            },
  { key: 'pending',      label: 'Pending'        },
  { key: 'partial',      label: 'Partial'        },
  { key: 'overdue',      label: 'Overdue'        },
  { key: 'paid',         label: 'Paid'           },
  { key: 'vacated_dues', label: 'Vacated w/ Dues' },
]

const Rent = () => {
  const { selectedProperty, refreshProperties } = useProperty()
  const propertyId = selectedProperty?._id ?? ''
  const toast = useToast()

  const [month,          setMonth]          = useState(now.getMonth() + 1)
  const [year,           setYear]           = useState(now.getFullYear())
  const [statusFilter,   setStatusFilter]   = useState('all')
  const [search,         setSearch]         = useState('')
  const [sortBy,         setSortBy]         = useState('due_desc')
  const [generating,     setGenerating]     = useState(false)
  const [autoGenResult,  setAutoGenResult]  = useState(null) // { month, year, created, skipped }
  const [paying,         setPaying]         = useState(false)
  const [ledgerTenant,   setLedgerTenant]   = useState(null)
  const [profileTenant,  setProfileTenant]  = useState(null)   // TenantProfile drawer
  const [quickCharge,    setQuickCharge]     = useState(null)   // { tenant } quick add charge
  const [qcForm,         setQcForm]          = useState({ amount: '', description: '', date: new Date().toISOString().split('T')[0] })
  const [qcSaving,       setQcSaving]        = useState(false)

  // Track which property+month+year combos have already been auto-generated this session
  // so switching months and back doesn't re-trigger unnecessarily.
  const autoGenDone = useRef(new Set())

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
    let list
    if (statusFilter === 'vacated_dues') {
      list = allRents.filter(r =>
        r.tenant?.status === 'vacated' &&
        (r.status === 'pending' || r.status === 'partial' || r.status === 'overdue')
      )
    } else if (statusFilter !== 'all') {
      list = allRents.filter(r => r.status === statusFilter)
    } else {
      list = [...allRents]
    }
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(r =>
      (r.tenant?.name ?? '').toLowerCase().includes(q) ||
      (r.tenant?.phone ?? '').includes(q)
    )

    if (sortBy === 'due_desc') {
      list.sort((a, b) => (b.amount - (b.paidAmount ?? 0)) - (a.amount - (a.paidAmount ?? 0)))
    } else if (sortBy === 'name_asc') {
      list.sort((a, b) => (a.tenant?.name ?? '').localeCompare(b.tenant?.name ?? ''))
    } else if (sortBy === 'due_date_asc') {
      list.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
    } else if (sortBy === 'paid_recent') {
      list.sort((a, b) => new Date(b.paymentDate ?? 0) - new Date(a.paymentDate ?? 0))
    }

    return list
  }, [allRents, statusFilter, search, sortBy])

  const counts = useMemo(() => ({
    all:          allRents.length,
    pending:      allRents.filter(r => r.status === 'pending').length,
    partial:      allRents.filter(r => r.status === 'partial').length,
    overdue:      allRents.filter(r => r.status === 'overdue').length,
    paid:         allRents.filter(r => r.status === 'paid').length,
    vacated_dues: allRents.filter(r =>
      r.tenant?.status === 'vacated' &&
      (r.status === 'pending' || r.status === 'partial' || r.status === 'overdue')
    ).length,
  }), [allRents])

  // Auto-generate silently when property/month/year loads — only current month,
  // and only once per property+month+year combo per session.
  useEffect(() => {
    if (!propertyId) return
    const currentMonth = now.getMonth() + 1
    const currentYear  = now.getFullYear()
    if (month !== currentMonth || year !== currentYear) return
    const key = `${propertyId}-${month}-${year}`
    if (autoGenDone.current.has(key)) return
    autoGenDone.current.add(key)

    generateRent(propertyId, { month, year })
      .then(res => {
        const { created, skipped } = res.data.data
        setAutoGenResult({ month, year, created: 0, skipped: created + skipped })
        if (created > 0) refetch()
      })
      .catch(() => {})  // silent — user can still press Generate manually
  }, [propertyId, month, year]) // eslint-disable-line

  // Manual generate — works for any month/year, shows toast with result
  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await generateRent(propertyId, { month, year })
      const { created, skipped, skippedRecords = [] } = res.data.data
      setAutoGenResult({ month, year, created: 0, skipped: created + skipped })
      if (created > 0) {
        toast(`Generated ${created} new record${created !== 1 ? 's' : ''}.`, 'success')
      } else if (skipped > 0) {
        // Check if all were skipped due to billing not started (tenant joined after this cycle)
        const allNotStarted = skippedRecords.every(s => s.reason === 'Billing cycle not started yet')
        if (allNotStarted) {
          toast(`No records for this period — tenants' billing starts in a later month.`, 'info')
        } else {
          toast(`All ${skipped} record${skipped !== 1 ? 's' : ''} already exist for this period.`, 'info')
        }
      } else {
        toast('No active tenants found for this property.', 'info')
      }
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
      refreshProperties()
      toast('Payment recorded', 'success')
    } catch (err) {
      toast(err.response?.data?.message || 'Error recording payment', 'error')
    } finally {
      setPaying(false)
    }
  }

  const onFilterTab = useCallback((key) => {
    setStatusFilter(key)
  }, [])

  const prevMonth = useCallback(() => {
    if (month === 1) { setMonth(12); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }, [month])

  const nextMonth = useCallback(() => {
    if (month === 12) { setMonth(1); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }, [month])

  const handleAddCharge = useCallback((t) => {
    setQuickCharge(t)
    setQcForm({ amount: '', description: '', date: new Date().toISOString().split('T')[0] })
  }, [])

  const handleQuickCharge = async (e) => {
    e.preventDefault()
    const amt = Number(qcForm.amount)
    if (!amt || amt <= 0 || !quickCharge) return
    setQcSaving(true)
    try {
      await addCharge(propertyId, quickCharge._id, {
        amount: amt,
        description: qcForm.description.trim(),
        date: qcForm.date || undefined,
      })
      toast('Charge added', 'success')
      setQuickCharge(null)
      setQcForm({ amount: '', description: '', date: new Date().toISOString().split('T')[0] })
      refetch()
    } catch (err) {
      toast(err.response?.data?.message || 'Error adding charge', 'error')
    } finally {
      setQcSaving(false)
    }
  }

  const handlePrint = () => {
    const targets = filtered
    const periodLabel = `${MONTHS.find(m => m.value === month)?.label} ${year}`
    const rows = targets.map(r => {
      const bed = r.tenant?.bed
      const loc = bed?.room?.roomNumber ? `R${bed.room.roomNumber}${bed.bedNumber ? `/B${bed.bedNumber}` : ''}` : '—'
      const rentRemaining = r.status === 'paid' ? 0 : r.amount - (r.paidAmount ?? 0)
      const charges = r.chargesDue ?? 0
      const statusColor = { paid: '#059669', pending: '#d97706', overdue: '#dc2626', partial: '#ea580c' }[r.status] ?? '#64748b'
      return `<tr>
        <td>${r.tenant?.name ?? '—'}</td>
        <td>${r.tenant?.phone ?? '—'}</td>
        <td>${loc}</td>
        <td>₹${(r.amount ?? 0).toLocaleString('en-IN')}</td>
        <td>${charges > 0 ? '₹' + charges.toLocaleString('en-IN') : '—'}</td>
        <td>₹${(rentRemaining + charges).toLocaleString('en-IN')}</td>
        <td><span style="color:${statusColor};font-weight:600;text-transform:capitalize">${r.status}</span></td>
        <td>${r.paymentDate ? new Date(r.paymentDate).toLocaleDateString('en-IN') : '—'}</td>
      </tr>`
    }).join('')
    const html = `<!DOCTYPE html><html><head><title>Rent – ${periodLabel}</title>
    <style>
      body{font-family:sans-serif;padding:24px;color:#1e293b}
      h2{margin:0 0 4px;font-size:18px}p{margin:0 0 16px;color:#64748b;font-size:13px}
      table{width:100%;border-collapse:collapse;font-size:12px}
      th{background:#f8fafc;border-bottom:2px solid #e2e8f0;padding:8px 10px;text-align:left;font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8}
      td{padding:8px 10px;border-bottom:1px solid #f1f5f9}
      tr:last-child td{border-bottom:none}
      @media print{@page{margin:16mm}}
    </style></head><body>
    <h2>Rent Collection — ${periodLabel}</h2>
    <p>Property: ${selectedProperty?.name ?? ''} &nbsp;·&nbsp; ${targets.length} record${targets.length !== 1 ? 's' : ''}</p>
    <table><thead><tr>
      <th>Tenant</th><th>Phone</th><th>Room/Bed</th><th>Rent</th><th>Charges</th><th>Outstanding</th><th>Status</th><th>Paid On</th>
    </tr></thead><tbody>${rows}</tbody></table>
    </body></html>`
    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 400)
  }

  if (loading) return <RentSkeleton />

  return (
    <div className="space-y-3 sm:space-y-5 max-w-7xl">

      {/* ── Header ── */}
      <>

      {/* Mobile header */}
      <div className="sm:hidden space-y-2">
        <div className="flex items-center bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {/* Prev */}
          <button onClick={prevMonth} className="px-3 py-4 text-slate-400 active:bg-slate-50 transition-colors shrink-0">
            <ChevronLeft size={16} />
          </button>

          {/* Month + Year — center */}
          <div className="flex-1 flex items-center justify-center gap-1.5">
            <select
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="text-base font-bold text-slate-800 bg-transparent border-none outline-none cursor-pointer text-center appearance-none"
            >
              {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <input
              type="number"
              value={year}
              onChange={e => setYear(Number(e.target.value))}
              className="w-14 text-base font-bold text-slate-800 bg-transparent border-none outline-none text-center"
            />
          </div>

          {/* Next */}
          <button onClick={nextMonth} className="px-3 py-4 text-slate-400 active:bg-slate-50 transition-colors shrink-0">
            <ChevronRight size={16} />
          </button>

          {/* Divider + Generate */}
          {propertyId && (() => {
            const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear()
            const resultForPeriod = autoGenResult?.month === month && autoGenResult?.year === year
            const allExist = resultForPeriod && autoGenResult.created === 0
            const label = generating ? 'Loading…' : allExist && isCurrentMonth ? 'Current' : 'Generate'
            return (
              <>
                <div className="w-px h-8 bg-slate-100 shrink-0" />
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className={`flex items-center gap-1.5 px-4 py-4 text-sm font-semibold transition-colors shrink-0 ${
                    allExist && isCurrentMonth
                      ? 'text-slate-400'
                      : 'text-primary-600'
                  }`}
                >
                  <Zap size={14} />
                  {label}
                </button>
              </>
            )
          })()}
        </div>

        {/* Stats */}
        {allRents.length > 0 && (
          <div className="flex items-center gap-3 px-1">
            <span className="text-xs text-slate-400">{counts.paid} paid</span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span className={`text-xs font-medium ${counts.pending > 0 ? 'text-amber-500' : 'text-slate-400'}`}>{counts.pending} pending</span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span className={`text-xs font-medium ${counts.overdue > 0 ? 'text-red-500' : 'text-slate-400'}`}>{counts.overdue} overdue</span>
          </div>
        )}
      </div>

      {/* Desktop header */}
      <div className="hidden sm:flex items-center justify-between gap-3">
        {/* Period navigator pill */}
        <div className="flex items-center bg-white rounded-2xl border border-slate-200 shadow-sm p-1">
          <button onClick={prevMonth} className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors shrink-0">
            <ChevronLeft size={14} />
          </button>
          <div className="flex items-center gap-1 px-3">
            <select
              className="text-sm font-semibold text-slate-700 bg-transparent border-none outline-none cursor-pointer appearance-none"
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
            >
              {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <input
              type="number"
              className="w-14 text-sm font-semibold text-slate-700 bg-transparent border-none outline-none text-center"
              value={year}
              onChange={e => setYear(Number(e.target.value))}
            />
          </div>
          <button onClick={nextMonth} className="h-8 w-8 rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors shrink-0">
            <ChevronRight size={14} />
          </button>
        </div>

        {/* Stats + Generate */}
        <div className="flex items-center gap-3 shrink-0">
          {allRents.length > 0 && (
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5 text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shrink-0" />{counts.paid} paid
              </span>
              <span className="flex items-center gap-1.5 text-slate-500">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />{counts.pending} pending
              </span>
              {counts.overdue > 0 && (
                <span className="flex items-center gap-1.5 font-semibold text-red-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />{counts.overdue} overdue
                </span>
              )}
            </div>
          )}
          {propertyId && (() => {
            const isCurrentMonth = month === now.getMonth() + 1 && year === now.getFullYear()
            const resultForPeriod = autoGenResult?.month === month && autoGenResult?.year === year
            const allExist = resultForPeriod && autoGenResult.created === 0
            return (
              <button
                className={`btn-primary ${allExist && isCurrentMonth ? 'opacity-70' : ''}`}
                onClick={handleGenerate}
                disabled={generating}
              >
                <Zap size={15} />
                {generating ? 'Generating…' : allExist && isCurrentMonth ? 'Up to date' : 'Generate'}
              </button>
            )
          })()}
        </div>
      </div>

      </>

      {!propertyId ? (
        <NoPropertyState />
      ) : (
        <>
          {/* ── Summary Cards ── */}
          {allRents.length > 0 && (
            <SummaryCards rents={allRents} />
          )}

          {/* ── Overdue Alert ── */}
          {counts.overdue > 0 && (
            <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3.5">
              <div className="h-8 w-8 rounded-xl bg-red-100 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle size={14} className="text-red-500" />
              </div>
              <p className="flex-1 text-sm text-red-700 font-medium">
                <span className="font-bold">{counts.overdue} tenant{counts.overdue !== 1 ? 's' : ''}</span>
                {counts.overdue !== 1 ? ' have' : ' has'} overdue rent this period.
              </p>
              <button
                className="shrink-0 rounded-xl bg-red-100 border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-200 transition-colors"
                onClick={() => onFilterTab('overdue')}
              >
                View overdue
              </button>
            </div>
          )}

          {/* ── Filter Bar ── */}
          <div className="sticky top-0 z-10">
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">

              {/* Row 1 — Status pills */}
              <div className="flex items-center gap-1 px-2.5 py-2 border-b border-slate-100 overflow-x-auto scrollbar-none">
                {FILTERS.map(({ key, label }) => {
                  const isActive = statusFilter === key
                  const dot = {
                    pending:      'bg-amber-400',
                    partial:      'bg-orange-400',
                    overdue:      'bg-red-500 animate-pulse',
                    paid:         'bg-emerald-400',
                    vacated_dues: 'bg-slate-400',
                  }[key]
                  return (
                    <button key={key} onClick={() => onFilterTab(key)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all ${
                        isActive
                          ? 'bg-primary-50 text-primary-600 ring-1 ring-primary-200'
                          : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
                      }`}>
                      {dot && <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dot}`} />}
                      {label}
                      {counts[key] > 0 && (
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                          isActive ? 'bg-primary-100 text-primary-700' : 'bg-slate-100 text-slate-500'
                        }`}>{counts[key]}</span>
                      )}
                    </button>
                  )
                })}
              </div>

              {/* Row 2 — Search · Sort · Actions */}
              <div className="flex items-center gap-2 px-3 py-2">
                {/* Search */}
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-8 pr-8 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 outline-none focus:border-primary-400 focus:bg-white focus:ring-2 focus:ring-primary-100 transition-all"
                    placeholder="Search…"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                  {search && (
                    <button onClick={() => setSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Sort */}
                <div className="relative shrink-0">
                  <ArrowUpDown size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value)}
                    className="rounded-xl border border-slate-200 bg-white pl-7 pr-2 py-1.5 text-xs font-medium text-slate-600 outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition-all appearance-none cursor-pointer w-32 sm:w-44"
                  >
                    <option value="due_desc">Highest due</option>
                    <option value="name_asc">Name A–Z</option>
                    <option value="due_date_asc">Due date</option>
                    <option value="paid_recent">Recently paid</option>
                  </select>
                </div>

                {/* Print — desktop only */}
                <button onClick={handlePrint}
                  className="hidden sm:flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all">
                  <Printer size={12} /> Print
                </button>
              </div>

            </div>
          </div>

          {/* ── Table ── */}
          {filtered.length === 0 ? (
            <div className="card border-dashed">
              <EmptyState
                message={search || statusFilter !== 'all'
                  ? `No ${statusFilter !== 'all' ? (FILTERS.find(f => f.key === statusFilter)?.label ?? statusFilter) : ''} records match`
                  : 'No rent records for this period'}
                action={
                  statusFilter === 'all' && !search
                    ? <button className="btn-primary" onClick={handleGenerate} disabled={generating}><Zap size={15} />{generating ? 'Generating…' : 'Generate Rent'}</button>
                    : <button className="btn-secondary" onClick={() => { setStatusFilter('all'); setSearch('') }}><RotateCcw size={13} /> Clear filters</button>
                }
              />
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">

              {/* Mobile: card list */}
              <div className="sm:hidden divide-y divide-slate-100">
                {filtered.map(r => (
                  <RentCard
                    key={r._id}
                    rent={r}
                    onMarkPaid={handleOpenPayModal}
                    onLedger={setLedgerTenant}
                  />
                ))}
              </div>

              {/* Desktop: table */}
              <div className="hidden sm:block overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      {[
                        { label: 'Tenant'      },
                        { label: 'Room / Bed'  },
                        { label: 'Amount'      },
                        { label: 'Due / Cycle' },
                        { label: 'Status'      },
                        { label: 'Paid On'     },
                        { label: ''            },
                      ].map(({ label }) => (
                        <th key={label} className="px-3 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-[0.06em]">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100/80 bg-white">
                    {filtered.map(r => (
                      <RentRow
                        key={r._id}
                        rent={r}
                        onMarkPaid={handleOpenPayModal}
                        onLedger={setLedgerTenant}
                        onProfile={setProfileTenant}
                        onAddCharge={handleAddCharge}
                      />
                    ))}
                  </tbody>
                </table>
              </div>{/* end hidden sm:block */}

              {/* Footer */}
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-slate-400">
                  <span className="font-semibold text-slate-600">{filtered.length}</span> record{filtered.length !== 1 ? 's' : ''}
                  {(search || statusFilter !== 'all') && (
                    <span className="text-slate-400"> · filtered from <span className="font-medium text-slate-500">{allRents.length}</span></span>
                  )}
                </p>
                <p className="text-xs text-slate-500 flex items-center gap-1.5">
                  Outstanding:
                  <span className="font-bold text-slate-800 tabular-nums">
                    {fmt(filtered.reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0))}
                  </span>
                </p>
              </div>
            </div>
          )}
        </>
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
          propertyId={propertyId}
        />
      )}
      {/* ── Tenant Ledger Drawer ── */}
      {ledgerTenant && (
        <Drawer
          title="Payment Ledger"
          subtitle={ledgerTenant.name}
          onClose={() => setLedgerTenant(null)}
          closeOnBackdrop={false}
          width="max-w-2xl"
          bodyClassName="flex-1 overflow-hidden flex flex-col"
        >
          <TenantLedger
            tenant={ledgerTenant}
            propertyId={propertyId}
            onCollect={async (rentRow) => {
              setLedgerTenant(null)
              await handleOpenPayModal({ ...rentRow, tenant: ledgerTenant })
            }}
          />
        </Drawer>
      )}

      {/* ── Tenant Profile Drawer ── */}
      {profileTenant && (
        <Drawer
          title="Tenant Profile"
          subtitle={profileTenant.name}
          onClose={() => setProfileTenant(null)}
          width="max-w-2xl"
          bodyClassName="flex-1 overflow-hidden flex flex-col"
        >
          <TenantProfile
            tenant={profileTenant}
            propertyId={propertyId}
            onVacate={() => { setProfileTenant(null); refetch(); refreshProperties() }}
            onDepositToggle={() => refetch()}
            onRefetch={() => refetch()}
          />
        </Drawer>
      )}

      {/* ── Quick Add Charge Modal ── */}
      {quickCharge && (
        <Modal title="Add Charge" onClose={() => setQuickCharge(null)} size="sm">
          <form onSubmit={handleQuickCharge} className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-orange-50 border border-orange-200 px-4 py-3">
              <IndianRupee size={15} className="text-orange-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-800">{quickCharge.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">A debit entry will be added to this tenant's ledger.</p>
              </div>
            </div>
            <div>
              <label className="label">Amount (₹)</label>
              <input type="number" min="1" step="1" className="input" placeholder="e.g. 500"
                value={qcForm.amount} onChange={e => setQcForm(f => ({ ...f, amount: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Description</label>
              <input className="input" placeholder="e.g. Electricity bill, Damage repair…"
                value={qcForm.description} onChange={e => setQcForm(f => ({ ...f, description: e.target.value }))} required />
            </div>
            <div>
              <label className="label">Date</label>
              <input type="date" className="input"
                value={qcForm.date} onChange={e => setQcForm(f => ({ ...f, date: e.target.value }))} />
            </div>
            <div className="flex gap-2 pt-1 border-t border-slate-100">
              <button type="button" className="btn-secondary flex-1" onClick={() => setQuickCharge(null)}>Cancel</button>
              <button type="submit" className="btn-primary flex-1" disabled={qcSaving}>
                <Plus size={14} /> {qcSaving ? 'Saving…' : 'Add Charge'}
              </button>
            </div>
          </form>
        </Modal>
      )}

    </div>
  )
}

export default Rent
