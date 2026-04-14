import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Plus, Phone, Mail, BedDouble, Calendar, Calculator,
  UserX, IndianRupee, User, Hash,
  FileText, ShieldCheck, Upload, Link,
  Search, X, RotateCcw, Eye, MessageCircle,
  Check, CheckCircle, AlertCircle, Download, Clock, Bell,
  BookOpen, ChevronDown, ChevronUp, Filter, CreditCard, Zap,
  TrendingUp, TrendingDown, Minus, RefreshCw, ChevronLeft, ChevronRight,
} from 'lucide-react'
import { getTenants, getTenant, searchTenants as searchTenantsApi, createTenant, vacateTenant, markDepositPaid, getTenantRents, getTenantAdvance, applyTenantAdvance, refundTenantAdvance, adjustDeposit, refundDeposit } from '../api/tenants'
import { getTenantLedger, recordPayment, addCharge } from '../api/rent'
import { getInvoices, getInvoicePdfUrl } from '../api/invoices'
import { getReminderLogs } from '../api/reminders'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import Drawer from '../components/ui/Drawer'
import PhoneInput from '../components/ui/PhoneInput'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt   = (n) => `₹${(n ?? 0).toLocaleString('en-IN')}`
const fdate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const AVATAR_COLORS = [
  'bg-violet-100 text-violet-700 border border-violet-200',
  'bg-blue-100 text-blue-700 border border-blue-200',
  'bg-emerald-100 text-emerald-700 border border-emerald-200',
  'bg-amber-100 text-amber-700 border border-amber-200',
  'bg-rose-100 text-rose-700 border border-rose-200',
  'bg-indigo-100 text-indigo-700 border border-indigo-200',
  'bg-teal-100 text-teal-700 border border-teal-200',
]
const avatarColor  = (name = '') => AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length]
const initials     = (name = '') => name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)

const waLink = (phone = '') => `https://wa.me/${phone.replace(/[^\d]/g, '')}`

// ── Computed field helpers ────────────────────────────────────────────────────
// Returns a rough rent status from cached ledgerBalance (positive = owes money).
// Detailed per-cycle status comes from RentPayment records loaded in the profile.
const computeRentStatus = (tenant) => {
  if (!tenant || tenant.status === 'vacated') return null
  const lb = tenant.ledgerBalance
  if (lb == null) return null
  if (lb <= 0)   return 'current'   // settled or advance credit
  return 'pending'                   // has outstanding balance (may be overdue)
}

const computeHealthScore = (tenant) => {
  if (tenant.status === 'vacated') return null
  const rs = computeRentStatus(tenant)
  const profileOk = tenant.profileStatus === 'complete'
  if (rs === 'overdue')         return 'critical'
  if (rs === 'pending' || !profileOk) return 'risk'
  return 'healthy'
}

const computeStayDuration = (checkInDate) => {
  if (!checkInDate) return '—'
  const days = Math.floor((Date.now() - new Date(checkInDate).getTime()) / 86_400_000)
  if (days < 30)   return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  const years = Math.floor(months / 12)
  const rem   = months % 12
  return rem ? `${years}y ${rem}mo` : `${years}y`
}

// ── Billing cycle helper ──────────────────────────────────────────────────────
// Returns the billing cycle period that contains today for a given tenant.
const computeBillingCycle = (tenant) => {
  const anchor = tenant.billingStartDate || tenant.checkInDate
  if (!anchor) return null
  const billingDay = new Date(anchor).getDate()
  const today = new Date()
  const todayDay   = today.getDate()
  const todayMonth = today.getMonth()   // 0-based
  const todayYear  = today.getFullYear()

  const daysThisMonth = new Date(todayYear, todayMonth + 1, 0).getDate()
  const effectiveThis = Math.min(billingDay, daysThisMonth)

  let cycleStart, cycleEnd
  if (todayDay >= effectiveThis) {
    // Cycle started this month
    cycleStart = new Date(todayYear, todayMonth, effectiveThis)
    const nextMonth = todayMonth === 11 ? 0  : todayMonth + 1
    const nextYear  = todayMonth === 11 ? todayYear + 1 : todayYear
    const daysNext  = new Date(nextYear, nextMonth + 1, 0).getDate()
    const effectiveNext = Math.min(billingDay, daysNext)
    cycleEnd = new Date(nextYear, nextMonth, effectiveNext)
    cycleEnd.setDate(cycleEnd.getDate() - 1)
  } else {
    // Still in last month's cycle
    const prevMonth = todayMonth === 0 ? 11 : todayMonth - 1
    const prevYear  = todayMonth === 0 ? todayYear - 1 : todayYear
    const daysPrev  = new Date(prevYear, prevMonth + 1, 0).getDate()
    const effectivePrev = Math.min(billingDay, daysPrev)
    cycleStart = new Date(prevYear, prevMonth, effectivePrev)
    cycleEnd   = new Date(todayYear, todayMonth, effectiveThis)
    cycleEnd.setDate(cycleEnd.getDate() - 1)
  }

  return { cycleStart, cycleEnd }
}
const fmtCycleDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''

// ── Rent status badge ─────────────────────────────────────────────────────────
const RENT_STATUS_CFG = {
  current:  { label: 'Settled',  cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  pending:  { label: 'Pending',  cls: 'text-orange-700 bg-orange-50 border-orange-200' },
  overdue:  { label: 'Overdue',  cls: 'text-red-700 bg-red-50 border-red-200' },
}
const RentStatusBadge = ({ tenant }) => {
  const rs = computeRentStatus(tenant)
  if (!rs) return <span className="text-xs text-slate-300 font-medium">—</span>
  const { label, cls } = RENT_STATUS_CFG[rs]
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold border rounded-full px-2 py-0.5 ${cls}`}>
      {label}
    </span>
  )
}

// ── Health dot ────────────────────────────────────────────────────────────────
const HEALTH_CFG = {
  healthy:  { dot: 'bg-emerald-400', title: 'Healthy' },
  risk:     { dot: 'bg-amber-400',   title: 'At Risk' },
  critical: { dot: 'bg-red-500',     title: 'Critical' },
}
const HealthDot = ({ tenant }) => {
  const score = computeHealthScore(tenant)
  if (!score) return null
  const { dot, title } = HEALTH_CFG[score]
  return <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${dot}`} title={title} />
}

const SELECT_CLS =
  'rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 ' +
  'transition-colors hover:border-slate-300 cursor-pointer'

// ── Avatar ────────────────────────────────────────────────────────────────────
const Avatar = ({ name, size = 'md' }) => {
  const sz = size === 'lg' ? 'h-14 w-14 text-lg' : size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm'
  return (
    <div className={`shrink-0 flex items-center justify-center rounded-full font-semibold ${sz} ${avatarColor(name)}`}>
      {initials(name)}
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────────────────────
const STAT_COLORS = {
  default: { num: 'text-slate-800', idle: 'bg-white border-slate-200 hover:shadow-md hover:-translate-y-0.5', active: 'bg-primary-500 border-primary-500 shadow-md shadow-primary-200' },
  emerald: { num: 'text-emerald-700', idle: 'bg-white border-slate-200 hover:shadow-md hover:-translate-y-0.5', active: 'bg-emerald-500 border-emerald-500 shadow-md shadow-emerald-200' },
  amber:   { num: 'text-amber-700',   idle: 'bg-white border-slate-200 hover:shadow-md hover:-translate-y-0.5', active: 'bg-amber-400 border-amber-400 shadow-md shadow-amber-200' },
  slate:   { num: 'text-slate-500',   idle: 'bg-white border-slate-200 hover:shadow-md hover:-translate-y-0.5', active: 'bg-slate-600 border-slate-600 shadow-md shadow-slate-200' },
}
const StatCard = ({ label, value, sub, color = 'default', active, onClick }) => {
  const c = STAT_COLORS[color] ?? STAT_COLORS.default
  return (
    <button onClick={onClick}
      className={`flex-1 min-w-[120px] flex flex-col gap-1 rounded-2xl border px-4 py-3.5 text-left
        transition-all duration-200 active:scale-[0.97]
        ${active ? c.active : c.idle}`}>
      <p className={`text-xl font-bold tabular-nums leading-none transition-colors ${active ? 'text-white' : c.num}`}>{value}</p>
      {sub && <p className={`text-[10px] font-medium tabular-nums transition-colors ${active ? 'text-white/60' : 'text-slate-400'}`}>{sub}</p>}
      <p className={`text-xs font-medium leading-tight transition-colors ${active ? 'text-white/80' : 'text-slate-500'} ${sub ? '' : 'mt-0.5'}`}>{label}</p>
    </button>
  )
}

// ── Filter Bar ────────────────────────────────────────────────────────────────
const FilterBar = ({ filters, onChange, onReset, hasActive }) => (
  <div className="flex flex-wrap items-center gap-2">
    <div className="relative flex-1 min-w-[200px]">
      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
      <input
        className="input pl-8 py-1.5 text-sm w-full"
        placeholder="Search by name or phone…"
        value={filters.search}
        onChange={e => onChange('search', e.target.value)}
      />
      {filters.search && (
        <button onClick={() => onChange('search', '')}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
          <X size={13} />
        </button>
      )}
    </div>
    <select value={filters.status} onChange={e => onChange('status', e.target.value)} className={SELECT_CLS}>
      <option value="all">All Status</option>
      <option value="active">Active</option>
      <option value="notice">On Notice</option>
      <option value="vacated">Vacated</option>
    </select>
    <select value={filters.profile} onChange={e => onChange('profile', e.target.value)} className={SELECT_CLS}>
      <option value="all">All Profiles</option>
      <option value="complete">Complete</option>
      <option value="incomplete">Incomplete</option>
    </select>
    <select value={filters.rentStatus} onChange={e => onChange('rentStatus', e.target.value)} className={SELECT_CLS}>
      <option value="all">All Rent</option>
      <option value="current">Current</option>
      <option value="due_soon">Due Soon</option>
      <option value="pending_overdue">Pending / Overdue</option>
    </select>
    <select value={filters.sortBy} onChange={e => onChange('sortBy', e.target.value)} className={SELECT_CLS}>
      <option value="name">Sort: Name A–Z</option>
      <option value="rent_desc">Rent: High → Low</option>
      <option value="rent_asc">Rent: Low → High</option>
      <option value="checkin">Check-in: Newest</option>
    </select>
    {hasActive && (
      <button onClick={onReset}
        className="flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition-colors">
        <RotateCcw size={12} /> Reset
      </button>
    )}
  </div>
)

// ── Action Required Bar ───────────────────────────────────────────────────────
const ActionBar = ({ incomplete, pendingRentCount }) => {
  if (!incomplete && !pendingRentCount) return null
  const parts = []
  if (incomplete > 0)       parts.push(`${incomplete} incomplete profile${incomplete > 1 ? 's' : ''}`)
  if (pendingRentCount > 0) parts.push(`${pendingRentCount} tenant${pendingRentCount > 1 ? 's' : ''} with pending/overdue rent`)
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex-wrap">
      <AlertCircle size={15} className="text-amber-500 shrink-0" />
      <p className="flex-1 text-sm text-amber-800 font-medium leading-snug min-w-0">
        <span className="font-bold">Action required: </span>{parts.join(' · ')}
      </p>
    </div>
  )
}

// ── Bulk Actions Bar ──────────────────────────────────────────────────────────
const BulkBar = ({ count, onReminder, onVacate, onExport, onClear }) => (
  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 rounded-2xl bg-slate-900 px-5 py-3 shadow-2xl ring-1 ring-black/10 animate-scaleIn">
    <span className="text-sm font-semibold text-white tabular-nums">{count} selected</span>
    <div className="h-4 w-px bg-slate-700 mx-1" />
    <button onClick={onReminder}
      className="flex items-center gap-1.5 rounded-xl bg-green-500 hover:bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors">
      <MessageCircle size={12} /> Send Reminder
    </button>
    <button onClick={onVacate}
      className="flex items-center gap-1.5 rounded-xl bg-red-500 hover:bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors">
      <UserX size={12} /> Vacate
    </button>
    <button onClick={onExport}
      className="flex items-center gap-1.5 rounded-xl bg-slate-700 hover:bg-slate-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors">
      <Download size={12} /> Export
    </button>
    <button onClick={onClear}
      className="rounded-lg p-1.5 text-slate-500 hover:text-white transition-colors">
      <X size={14} />
    </button>
  </div>
)

// ── Add Tenant Form ───────────────────────────────────────────────────────────
const EMPTY_FORM = {
  name: '', email: '', phone: '', aadharNumber: '',
  checkInDate: '', rentAmount: '', depositAmount: '', dueDate: 5,
}

const AddTenantForm = ({ propertyId, onSubmit, onCancel, saving }) => {
  const [form, setForm] = useState(EMPTY_FORM)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Duplicate phone detection
  const [phoneConflict, setPhoneConflict]   = useState(null)
  const [phoneChecking, setPhoneChecking]   = useState(false)
  const phoneDebounceRef                    = useRef(null)

  const handlePhoneChange = (val) => {
    set('phone', val)
    setPhoneConflict(null)
    clearTimeout(phoneDebounceRef.current)
    const digits = val.replace(/\D/g, '')
    if (digits.length < 6) return
    setPhoneChecking(true)
    phoneDebounceRef.current = setTimeout(() => {
      searchTenantsApi(propertyId, { phone: val.trim() })
        .then(r => {
          const active = (r.data?.data ?? []).find(t => t.status === 'active' || t.status === 'notice' || t.status === 'reserved')
          setPhoneConflict(active ?? null)
        })
        .catch(() => {})
        .finally(() => setPhoneChecking(false))
    }, 500)
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (phoneConflict) return
    onSubmit({
      ...form,
      rentAmount:    Number(form.rentAmount),
      depositAmount: Number(form.depositAmount) || 0,
      dueDate:       Number(form.dueDate),
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Personal info */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Personal Info</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">Full Name *</label>
            <input className="input" placeholder="Rahul Sharma" value={form.name}
              onChange={(e) => set('name', e.target.value)} required />
          </div>
          <div className="col-span-2">
            <label className="label">Phone *</label>
            <div className="relative">
              <PhoneInput value={form.phone} onChange={handlePhoneChange} />
              {phoneChecking && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 animate-pulse pointer-events-none">
                  checking…
                </span>
              )}
            </div>
            {phoneConflict && (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2">
                <AlertCircle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-700">Tenant already exists</p>
                  <p className="text-[11px] text-amber-600 mt-0.5">
                    <span className="font-semibold">{phoneConflict.name}</span> · {phoneConflict.phone} · {phoneConflict.status}
                  </p>
                  <p className="text-[11px] text-amber-600 mt-0.5">
                    Use the Assign Bed flow from the Rooms & Beds page to re-assign this tenant.
                  </p>
                </div>
              </div>
            )}
          </div>
          <div className="col-span-2">
            <label className="label">Email</label>
            <input type="email" className="input" placeholder="rahul@example.com" value={form.email}
              onChange={(e) => set('email', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className="label">Aadhar Number</label>
            <input className="input" placeholder="XXXX XXXX XXXX" value={form.aadharNumber}
              onChange={(e) => set('aadharNumber', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Rent info */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Rent Details</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Check-in Date *</label>
            <input type="date" className="input" value={form.checkInDate}
              onChange={(e) => set('checkInDate', e.target.value)} required />
          </div>
          <div>
            <label className="label">Monthly Rent (₹) *</label>
            <input type="number" className="input" placeholder="8000" value={form.rentAmount}
              onChange={(e) => set('rentAmount', e.target.value)} required />
          </div>
          <div>
            <label className="label">Deposit (₹)</label>
            <input type="number" className="input" placeholder="16000" value={form.depositAmount}
              onChange={(e) => set('depositAmount', e.target.value)} />
          </div>
          <div>
            <label className="label">Grace Days (0–28)</label>
            <input type="number" min="0" max="28" className="input" value={form.dueDate}
              onChange={(e) => set('dueDate', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Bed assignment note */}
      <div className="rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5 text-xs text-blue-700">
        Bed assignment happens from the <strong>Rooms &amp; Beds</strong> page. Use &ldquo;Assign Tenant&rdquo; on a vacant bed after creating the tenant here.
      </div>

      <div className="flex gap-2 pt-1 border-t border-slate-100">
        <button type="button" className="btn-secondary flex-1" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary flex-1" disabled={saving || !!phoneConflict || phoneChecking}>
          {saving ? 'Adding…' : 'Add Tenant'}
        </button>
      </div>
    </form>
  )
}

// ── Tenant Row ────────────────────────────────────────────────────────────────
const TenantRow = ({ tenant: t, selected, onSelect, onView, onVacate }) => {
  const profilePct = t.profileCompletion?.percent ?? (t.profileStatus === 'complete' ? 100 : 0)
  return (
    <tr
      className={`group transition-colors ${selected ? 'bg-primary-50/40' : 'hover:bg-slate-50/80'} cursor-pointer`}
      onClick={() => onView(t)}
    >
      {/* Checkbox */}
      <td className="pl-4 pr-2 py-3 w-10" onClick={e => { e.stopPropagation(); onSelect(t._id) }}>
        <div className={`h-4 w-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
          selected ? 'bg-primary-500 border-primary-500' : 'border-slate-300 group-hover:border-primary-400'
        }`}>
          {selected && <Check size={10} className="text-white" strokeWidth={3} />}
        </div>
      </td>

      {/* Health + Name + Phone */}
      <td className="px-3 py-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <HealthDot tenant={t} />
          <Avatar name={t.name} size="sm" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800 leading-tight truncate max-w-[160px]">{t.name}</p>
            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
              <Phone size={10} className="shrink-0 text-slate-300" />
              {t.phone}
            </p>
          </div>
        </div>
      </td>

      {/* Bed */}
      <td className="px-3 py-3">
        {t.bed
          ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5">
              <BedDouble size={11} /> Bed {t.bed.bedNumber}
            </span>
          : <span className="text-xs text-slate-300 font-medium">—</span>
        }
      </td>

      {/* Rent + Stay */}
      <td className="px-3 py-3">
        <p className="text-sm font-bold text-slate-800 tabular-nums">{fmt(t.rentAmount)}</p>
        <p className="text-[10px] text-slate-400 font-medium flex items-center gap-0.5 mt-0.5">
          <Clock size={9} className="shrink-0" />
          {computeStayDuration(t.checkInDate)}
        </p>
      </td>

      {/* Profile % */}
      <td className="px-3 py-3">
        <div className="flex flex-col gap-1">
          <span className={`text-xs font-bold tabular-nums ${
            profilePct === 100 ? 'text-emerald-600' : profilePct >= 60 ? 'text-amber-600' : 'text-red-500'
          }`}>{profilePct}%</span>
          <div className="h-1 w-14 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full ${
                profilePct === 100 ? 'bg-emerald-400' : profilePct >= 60 ? 'bg-amber-400' : 'bg-red-400'
              }`}
              style={{ width: `${profilePct}%` }}
            />
          </div>
        </div>
      </td>

      {/* Rent Status */}
      <td className="px-3 py-3">
        <RentStatusBadge tenant={t} />
      </td>

      {/* Status */}
      <td className="px-3 py-3">
        <Badge status={t.status} />
      </td>

      {/* Actions */}
      <td className="px-3 py-3">
        <div className="flex items-center gap-0.5">
          {t.phone && (
            <a href={waLink(t.phone)} target="_blank" rel="noreferrer"
              onClick={e => e.stopPropagation()}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-green-50 hover:text-green-600 transition-colors" title="WhatsApp">
              <MessageCircle size={14} />
            </a>
          )}
          <button onClick={e => { e.stopPropagation(); onView(t) }}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-primary-50 hover:text-primary-600 transition-colors" title="View profile">
            <Eye size={14} />
          </button>
          {t.status !== 'vacated' && (
            <button onClick={e => { e.stopPropagation(); onVacate(t._id) }}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors" title="Vacate">
              <UserX size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Rent history helpers ──────────────────────────────────────────────────────
const SOURCE_LABELS = {
  per_bed:        'Fixed per bed',
  per_room_split: 'Split by occupancy',
  override:       'Manual override',
  extra_custom:   'Extra bed custom',
  extra_fallback: 'Extra bed default',
  extra_free:     'Free (non-chargeable)',
}
const REASON_LABELS = {
  assign:           'Tenant assigned',
  vacate:           'Tenant vacated',
  change_room:      'Room changed',
  extra_bed_change: 'Extra bed changed',
  base_rent_update: 'Base rent updated',
  rent_type_update: 'Rent type changed',
}

// ── Tenant Profile Drawer ─────────────────────────────────────────────────────
const InfoRow = ({ icon: Icon, label, value }) => (
  <div className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
    <div className="mt-0.5 rounded-lg bg-slate-100 p-1.5">
      <Icon size={13} className="text-slate-400" />
    </div>
    <div className="min-w-0">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="text-sm font-medium text-slate-700 mt-0.5">{value || '—'}</p>
    </div>
  </div>
)

// ── Ledger helpers ────────────────────────────────────────────────────────────
const LEDGER_BADGE = {
  rent_record:         { label: 'RENT',       cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  payment:             { label: 'PAYMENT',    cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  deposit_collected:   { label: 'DEPOSIT',    cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  deposit_adjusted:    { label: 'DEPOSIT',    cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  deposit_refunded:    { label: 'REFUND',     cls: 'bg-red-100 text-red-600 border-red-200' },
  adjustment:          { label: 'CHARGE',     cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  reservation_advance: { label: 'ADVANCE',    cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  refund:              { label: 'REFUND',     cls: 'bg-red-100 text-red-600 border-red-200' },
}
const LEDGER_TYPE_OPTIONS = [
  { value: '',                    label: 'All Types' },
  { value: 'rent_record',         label: 'Rent' },
  { value: 'payment',             label: 'Payment' },
  { value: 'deposit_collected',   label: 'Deposit Collected' },
  { value: 'deposit_adjusted',    label: 'Deposit Adjusted' },
  { value: 'deposit_refunded',    label: 'Deposit Refunded' },
  { value: 'adjustment',          label: 'Manual Charge' },
  { value: 'reservation_advance', label: 'Advance' },
  { value: 'refund',              label: 'Refund' },
]
const PAYMENT_METHODS = [
  ['cash','Cash'], ['upi','UPI'], ['bank_transfer','Bank Transfer'], ['cheque','Cheque'],
]

const fmtLedgerDate = (d) => {
  if (!d) return '—'
  const dt = new Date(d)
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
}

// Generate a CSV blob from ledger entries and trigger browser download
const isRefundType = (referenceType) =>
  referenceType === 'deposit_refunded' || referenceType === 'refund'

const downloadLedgerCSV = (entries, tenantName) => {
  const rows = [
    ['Date', 'Description', 'Type', 'Method', 'Debit', 'Credit', 'Balance'].join(','),
    ...entries.map(e => {
      const showNeg  = e.type === 'debit' || isRefundType(e.referenceType)
      const debit    = showNeg ? e.amount : ''
      const credit   = !showNeg ? e.amount : ''
      const desc     = (e.description ?? '').replace(/,/g, ';')
      const badge    = LEDGER_BADGE[e.referenceType]?.label ?? e.referenceType
      const method   = e.method ? e.method.replace(/_/g, ' ') : ''
      return [fmtLedgerDate(e.createdAt), desc, badge, method, debit, credit, e.balanceAfter].join(',')
    }),
  ]
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `ledger-${(tenantName ?? 'tenant').replace(/\s+/g, '-').toLowerCase()}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// Open a print window with a formatted HTML ledger
const printLedgerPDF = (entries, tenant, currentBalance, depositBal) => {
  const rows = entries.map(e => {
    const showNeg = e.type === 'debit' || isRefundType(e.referenceType)
    const badge   = LEDGER_BADGE[e.referenceType]?.label ?? e.referenceType
    const amtClr  = showNeg ? '#dc2626' : '#16a34a'
    const balClr  = e.balanceAfter > 0 ? '#dc2626' : e.balanceAfter < 0 ? '#16a34a' : '#64748b'
    const methodTd = e.method ? `<td style="font-size:10px;color:#64748b">${e.method.replace(/_/g,' ')}</td>` : '<td>—</td>'
    return `<tr>
      <td>${fmtLedgerDate(e.createdAt)}</td>
      <td>${e.description ?? '—'}</td>
      <td><span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:999px;background:#f1f5f9">${badge}</span></td>
      ${methodTd}
      <td style="text-align:right;color:${amtClr};font-weight:600">${showNeg ? '-' : '+'}₹${(e.amount ?? 0).toLocaleString('en-IN')}</td>
      <td style="text-align:right;color:${balClr};font-weight:600">₹${Math.abs(e.balanceAfter ?? 0).toLocaleString('en-IN')}${e.balanceAfter < 0 ? ' (Adv)' : ''}</td>
    </tr>`
  }).join('')

  const w = window.open('', '_blank')
  w.document.write(`<!DOCTYPE html><html><head><title>Ledger — ${tenant?.name ?? ''}</title>
  <style>
    body { font-family: system-ui, sans-serif; font-size: 12px; color: #1e293b; margin: 24px; }
    h2   { font-size: 16px; margin-bottom: 4px; }
    .meta { color: #64748b; font-size: 11px; margin-bottom: 16px; }
    .summary { display: flex; gap: 24px; margin-bottom: 20px; padding: 12px 16px; background: #f8fafc; border-radius: 8px; }
    .summary div { font-size: 11px; color: #64748b; }
    .summary strong { display: block; font-size: 15px; margin-top: 2px; }
    table { width: 100%; border-collapse: collapse; }
    th    { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; padding: 6px 8px; border-bottom: 2px solid #e2e8f0; }
    td    { padding: 7px 8px; border-bottom: 1px solid #f1f5f9; font-size: 11.5px; }
    @media print { body { margin: 8px; } }
  </style></head><body>
  <h2>Ledger Statement — ${tenant?.name ?? ''}</h2>
  <p class="meta">Printed on ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
  <div class="summary">
    <div>Balance Due <strong style="color:${currentBalance > 0 ? '#dc2626' : '#16a34a'}">₹${Math.abs(currentBalance).toLocaleString('en-IN')}${currentBalance < 0 ? ' (Advance)' : ''}</strong></div>
    ${depositBal > 0 ? `<div>Deposit Balance <strong style="color:#7c3aed">₹${depositBal.toLocaleString('en-IN')}</strong></div>` : ''}
    <div>Total Entries <strong>${entries.length}</strong></div>
  </div>
  <table><thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Method</th><th style="text-align:right">Amount</th><th style="text-align:right">Balance</th></tr></thead>
  <tbody>${rows}</tbody></table>
  </body></html>`)
  w.document.close()
  w.print()
}

const RentHistoryItem = ({ rent }) => {
  const statusColor = {
    paid:    'text-emerald-700 bg-emerald-50 border border-emerald-200',
    pending: 'text-amber-700 bg-amber-50 border border-amber-200',
    partial: 'text-orange-700 bg-orange-50 border border-orange-200',
    overdue: 'text-red-700 bg-red-50 border border-red-200',
  }
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-slate-700">{months[rent.month - 1]} {rent.year}</p>
        {rent.periodStart && rent.periodEnd && (
          <p className="text-[10px] text-primary-500 font-medium">
            {fdate(rent.periodStart)} – {fdate(rent.periodEnd)}
          </p>
        )}
        {rent.paymentDate && (
          <p className="text-xs text-slate-400">Paid {fdate(rent.paymentDate)}</p>
        )}
        {rent.paymentMethod && (
          <p className="text-xs text-slate-400 capitalize">{rent.paymentMethod.replace('_', ' ')}</p>
        )}
      </div>
      <div className="text-right">
        <p className="text-sm font-bold text-slate-700">{fmt(rent.amount)}</p>
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusColor[rent.status] ?? 'bg-slate-100 text-slate-500'}`}>
          {rent.status}
        </span>
      </div>
    </div>
  )
}

export const TenantProfile = ({ tenant: t, propertyId, onVacate, onDepositToggle, onRefetch }) => {
  const { data: rentData, loading: rentLoading } = useApi(
    () => getTenantRents(propertyId, t._id),
    [t._id]
  )
  const rents = rentData?.data ?? []
  const totalPaid = rents.filter((r) => r.status === 'paid').reduce((s, r) => s + r.amount, 0)

  // Ledger balance (from the financial layer)
  const { data: ledgerData } = useApi(
    () => getTenantLedger(propertyId, t._id),
    [t._id]
  )
  const ledgerBalance  = ledgerData?.data?.currentBalance ?? (t.ledgerBalance ?? null)
  const hasAdvance     = ledgerBalance !== null && ledgerBalance < 0
  const hasDues        = ledgerBalance !== null && ledgerBalance > 0
  const pendingDues    = rents
    .filter(r => r.status === 'pending' || r.status === 'partial' || r.status === 'overdue')
    .reduce((s, r) => s + (r.amount - (r.paidAmount ?? 0)), 0)

  // Tenant invoices
  const { data: invoiceData, loading: invoicesLoading } = useApi(
    () => getInvoices(propertyId, { tenantId: t._id }),
    [t._id]
  )
  const invoices = invoiceData?.data ?? []

  // Reminder history for this tenant (last 5)
  const { data: reminderData } = useApi(
    () => getReminderLogs(propertyId, { tenantId: t._id, limit: 5 }),
    [t._id]
  )
  const reminderHistory = reminderData?.data ?? []
  const lastReminder    = reminderHistory[0] ?? null

  // ── Reservation advance ──
  const { data: advanceData, refetch: refetchAdvance } = useApi(
    () => getTenantAdvance(propertyId, t._id),
    [t._id]
  )
  const heldAdvance = advanceData?.data ?? null  // null = no held advance
  const [advanceActing, setAdvanceActing] = useState(false)

  const handleAdvanceApply = async () => {
    setAdvanceActing(true)
    try {
      await applyTenantAdvance(propertyId, t._id)
      refetchAdvance()
      onRefetch?.()
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to apply advance')
    } finally {
      setAdvanceActing(false)
    }
  }

  const handleAdvanceRefund = async () => {
    setAdvanceActing(true)
    try {
      await refundTenantAdvance(propertyId, t._id)
      refetchAdvance()
      onRefetch?.()
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to mark refund')
    } finally {
      setAdvanceActing(false)
    }
  }

  // ── Deposit actions ──
  const [depositActing, setDepositActing] = useState(false)

  const handleDepositAdjust = async () => {
    if (!window.confirm('Apply the security deposit against outstanding dues?')) return
    setDepositActing(true)
    try {
      await adjustDeposit(propertyId, t._id)
      onRefetch?.()
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to adjust deposit')
    } finally {
      setDepositActing(false)
    }
  }

  const handleDepositRefund = async () => {
    if (!window.confirm('Mark deposit as refunded to the tenant?')) return
    setDepositActing(true)
    try {
      await refundDeposit(propertyId, t._id)
      onRefetch?.()
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to refund deposit')
    } finally {
      setDepositActing(false)
    }
  }

  // ── Editable state ──
  const [activeTab, setActiveTab]        = useState('overview') // 'overview' | 'ledger'
  const [editing, setEditing]           = useState(null) // 'personal' | 'documents' | 'agreement' | 'notes'
  const [saving, setSaving]             = useState(false)
  const [rentHistoryOpen, setRentHistoryOpen] = useState(false)
  const [invoicesOpen,    setInvoicesOpen]    = useState(false)

  // ── Ledger tab state ──
  const [ledgerPage,    setLedgerPage]    = useState(1)
  const [ledgerFrom,    setLedgerFrom]    = useState('')
  const [ledgerTo,      setLedgerTo]      = useState('')
  const [ledgerType,    setLedgerType]    = useState('')
  const [ledgerSearch,  setLedgerSearch]  = useState('')
  const [ledgerEntries, setLedgerEntries] = useState([])
  const [ledgerTotal,   setLedgerTotal]   = useState(0)
  const [ledgerPages,   setLedgerPages]   = useState(1)
  const [tabLedgerBalance, setLedgerBalanceState] = useState(null)
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [expandedEntry, setExpandedEntry] = useState(null)
  // Quick action modals
  const [payModal,      setPayModal]      = useState(false)
  const [chargeModal,   setChargeModal]   = useState(false)
  const [payAmt,        setPayAmt]        = useState('')
  const [payMethod,     setPayMethod]     = useState('cash')
  const [payNotes,      setPayNotes]      = useState('')
  const [payRef,        setPayRef]        = useState('')
  const [chargeAmt,     setChargeAmt]     = useState('')
  const [chargeDesc,    setChargeDesc]    = useState('')
  const [actionBusy,    setActionBusy]    = useState(false)

  const LEDGER_LIMIT = 20

  const fetchLedger = useCallback(async (page = 1, from = ledgerFrom, to = ledgerTo, type = ledgerType, search = ledgerSearch) => {
    setLedgerLoading(true)
    try {
      const params = { page, limit: LEDGER_LIMIT }
      if (from)   params.from  = from
      if (to)     params.to    = to
      if (type)   params.type  = type
      if (search) params.q     = search
      const res = await getTenantLedger(propertyId, t._id, params)
      const d   = res.data?.data ?? {}
      setLedgerEntries(d.entries ?? [])
      setLedgerTotal(d.total ?? 0)
      setLedgerPages(d.pages ?? 1)
      setLedgerBalanceState(d.currentBalance ?? 0)
    } catch (_) {}
    finally { setLedgerLoading(false) }
  }, [propertyId, t._id, ledgerFrom, ledgerTo, ledgerType])

  useEffect(() => {
    if (activeTab === 'ledger') fetchLedger(ledgerPage)
  }, [activeTab, ledgerPage]) // eslint-disable-line

  const handlePaySubmit = async () => {
    const amt = Number(payAmt)
    if (!amt || amt <= 0) return
    setActionBusy(true)
    try {
      await recordPayment(propertyId, { tenantId: t._id, amount: amt, method: payMethod, notes: payNotes || undefined, referenceId: payRef || undefined })
      setPayModal(false); setPayAmt(''); setPayNotes(''); setPayRef('')
      fetchLedger(1)
      onRefetch?.()
    } catch (err) { alert(err.response?.data?.message || 'Failed to record payment') }
    finally { setActionBusy(false) }
  }

  const handleChargeSubmit = async () => {
    const amt = Number(chargeAmt)
    if (!amt || amt <= 0) return
    setActionBusy(true)
    try {
      await addCharge(propertyId, t._id, { amount: amt, description: chargeDesc || undefined })
      setChargeModal(false); setChargeAmt(''); setChargeDesc('')
      fetchLedger(1)
      onRefetch?.()
    } catch (err) { alert(err.response?.data?.message || 'Failed to add charge') }
    finally { setActionBusy(false) }
  }

  const handleLedgerFilter = () => {
    setLedgerPage(1)
    fetchLedger(1, ledgerFrom, ledgerTo, ledgerType, ledgerSearch)
  }

  const handleLedgerReset = () => {
    setLedgerFrom(''); setLedgerTo(''); setLedgerType(''); setLedgerSearch(''); setLedgerPage(1)
    fetchLedger(1, '', '', '', '')
  }
  const [form, setForm]       = useState({
    name:             t.name ?? '',
    phone:            t.phone ?? '',
    email:            t.email ?? '',
    aadharNumber:     t.aadharNumber ?? '',
    emergencyName:    t.emergencyContact?.name ?? '',
    emergencyPhone:   t.emergencyContact?.phone ?? '',
    emergencyRelation: t.emergencyContact?.relation ?? '',
    checkInDate:      t.checkInDate ? new Date(t.checkInDate).toISOString().split('T')[0] : '',
    checkOutDate:     t.checkOutDate ? new Date(t.checkOutDate).toISOString().split('T')[0] : '',
    rentAmount:       t.rentAmount ?? 0,
    depositAmount:    t.depositAmount ?? 0,
    dueDate:          t.dueDate ?? 5,
    notes:            t.notes ?? '',
    // Documents
    idProofUrl:       t.documents?.idProofUrl ?? '',
    photoUrl:         t.documents?.photoUrl ?? '',
    // Agreement
    agreementType:    t.agreementType ?? '',
    agreementFileUrl: t.agreementFileUrl ?? '',
    // Verification
    policeStatus:             t.verification?.policeStatus ?? 'pending',
    idVerified:               t.verification?.idVerified ?? false,
    emergencyContactVerified: t.verification?.emergencyContactVerified ?? false,
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // ── Profile completion ──
  const completionChecks = [
    { label: 'Name',                 done: !!t.name },
    { label: 'Phone',                done: !!t.phone },
    { label: 'Email',                done: !!t.email },
    { label: 'Aadhar',               done: !!t.aadharNumber },
    { label: 'Address',              done: !!t.address },
    { label: 'Emergency Contact',    done: !!t.emergencyContact?.name },
    { label: 'Agreement',            done: !!t.checkInDate && t.rentAmount > 0 },
    { label: 'ID Document',          done: !!(t.documents?.idProofUrl || t.idProofUploaded) },
    { label: 'ID Verified',          done: !!t.verification?.idVerified },
    { label: 'Police Verification',  done: t.verification?.policeStatus === 'verified' },
  ]
  const completed = completionChecks.filter(c => c.done).length
  const pct = Math.round((completed / completionChecks.length) * 100)

  // ── Save handler ──
  const handleSave = async (section) => {
    setSaving(true)
    try {
      const payload = {}
      if (section === 'personal') {
        payload.name = form.name
        payload.phone = form.phone
        payload.email = form.email
        payload.aadharNumber = form.aadharNumber
        payload.emergencyContact = {
          name: form.emergencyName,
          phone: form.emergencyPhone,
          relation: form.emergencyRelation,
        }
      } else if (section === 'agreement') {
        payload.checkInDate = form.checkInDate
        payload.checkOutDate = form.checkOutDate || null
        payload.rentAmount = Number(form.rentAmount)
        payload.depositAmount = Number(form.depositAmount)
        payload.dueDate = Number(form.dueDate)
        payload.agreementType = form.agreementType || null
        payload.agreementFileUrl = form.agreementFileUrl || null
      } else if (section === 'documents') {
        payload.aadharNumber = form.aadharNumber
        payload.documents = {
          idProofUrl: form.idProofUrl || null,
          photoUrl:   form.photoUrl   || null,
        }
      } else if (section === 'verification') {
        payload.verification = {
          policeStatus:             form.policeStatus,
          idVerified:               form.idVerified,
          emergencyContactVerified: form.emergencyContactVerified,
        }
      } else if (section === 'notes') {
        payload.notes = form.notes
      }
      await import('../api/tenants').then(m => m.updateTenant(propertyId, t._id, payload))
      setEditing(null)
      onRefetch?.()
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // ── Section helpers ──
  const SectionTitle = ({ icon: Icon, title, section, incomplete }) => (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${incomplete ? 'bg-amber-50' : 'bg-primary-50'}`}>
          <Icon size={14} className={incomplete ? 'text-amber-500' : 'text-primary-500'} />
        </div>
        <h4 className="text-[13px] font-bold text-slate-700 tracking-tight">{title}</h4>
        {incomplete && (
          <span className="text-[9px] font-bold uppercase tracking-widest text-amber-500 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">Incomplete</span>
        )}
      </div>
      {section && (
        editing === section ? (
          <div className="flex items-center gap-1.5">
            <button onClick={() => setEditing(null)} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Cancel</button>
            <button onClick={() => handleSave(section)} disabled={saving}
              className="text-xs font-semibold text-primary-600 hover:text-primary-700 transition-colors disabled:opacity-50">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        ) : (
          <button onClick={() => setEditing(section)}
            className="text-xs font-medium text-slate-400 hover:text-primary-600 transition-colors">Edit</button>
        )
      )}
    </div>
  )

  const Field = ({ label, value, fallback = '—' }) => (
    <div className="py-2.5 border-b border-slate-100 last:border-0">
      <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">{label}</p>
      <p className="text-sm font-medium text-slate-700 mt-0.5">{value || fallback}</p>
    </div>
  )

  return (
    <div className="flex flex-col h-full">

      {/* ── Hero Header ── */}
      <div className="px-6 py-5 bg-slate-50 border-b border-slate-100">
        <div className="flex items-center gap-4">
          <Avatar name={t.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-slate-800 leading-tight">{t.name}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <Badge status={t.status} />
              {t.bed && (
                <span className="flex items-center gap-1 text-xs text-blue-600 font-medium bg-blue-50 border border-blue-200 rounded-full px-2 py-0.5">
                  <BedDouble size={11} /> Bed {t.bed.bedNumber}
                </span>
              )}
              <RentStatusBadge tenant={t} />
              <span className={`text-[10px] font-bold uppercase tracking-widest rounded-full px-2 py-0.5 ${
                pct === 100
                  ? 'text-emerald-600 bg-emerald-50 border border-emerald-200'
                  : 'text-amber-600 bg-amber-50 border border-amber-200'
              }`}>
                {pct === 100 ? 'Complete' : 'Incomplete'}
              </span>
            </div>
            {t.checkInDate && (
              <p className="text-xs text-slate-400 mt-1.5">
                <Calendar size={10} className="inline mr-1" />
                Check-in: {fdate(t.checkInDate)}
                {(() => {
                  const cycle = computeBillingCycle(t)
                  if (!cycle) return null
                  return (
                    <span className="ml-2 text-primary-500 font-medium">
                      · Cycle: {fmtCycleDate(cycle.cycleStart)} – {fmtCycleDate(cycle.cycleEnd)}
                    </span>
                  )
                })()}
              </p>
            )}
          </div>
        </div>

        {/* Profile completion bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs font-medium text-slate-500">Profile Completion</p>
            <p className={`text-xs font-bold tabular-nums ${pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500'}`}>{pct}%</p>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Quick stats */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: 'Monthly Rent', value: fmt(t.rentAmount), color: 'text-slate-700' },
            {
              label: ledgerBalance !== null ? (hasAdvance ? 'Advance' : hasDues ? 'Balance Due' : 'Settled') : 'Total Paid',
              value: ledgerBalance !== null ? fmt(Math.abs(ledgerBalance)) : fmt(totalPaid),
              color: hasAdvance ? 'text-emerald-600' : hasDues ? 'text-amber-600' : 'text-slate-400',
            },
            { label: 'Deposit', value: fmt(t.depositAmount), color: 'text-slate-700' },
          ].map(({ label, value, color }) => (
            <div key={label} className="rounded-xl bg-white border border-slate-100 px-3 py-2.5 text-center">
              <p className="text-[10px] text-slate-400 font-medium">{label}</p>
              <p className={`text-sm font-bold mt-0.5 tabular-nums ${color}`}>{value}</p>
            </div>
          ))}
        </div>
        {/* Last reminder indicator */}
        {lastReminder && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-100 bg-white px-3 py-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Bell size={11} className="text-slate-400" />
              <span>Last reminder</span>
              <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold capitalize ${
                lastReminder.type === 'payment_confirmation' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : lastReminder.type === 'overdue'           ? 'bg-red-50 text-red-700 border-red-200'
                : lastReminder.type === 'due_day'           ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-blue-50 text-blue-700 border-blue-200'
              }`}>
                {lastReminder.type === 'payment_confirmation' ? 'Payment' : lastReminder.type.replace('_', ' ')}
              </span>
            </div>
            <span className="text-[11px] text-slate-400">
              {(() => {
                const diff = Date.now() - new Date(lastReminder.sentAt ?? lastReminder.createdAt).getTime()
                const mins = Math.floor(diff / 60000)
                if (mins < 60) return `${mins}m ago`
                const hrs = Math.floor(mins / 60)
                if (hrs < 24) return `${hrs}h ago`
                return `${Math.floor(hrs / 24)}d ago`
              })()}
            </span>
          </div>
        )}
      </div>

      {/* ── Tab Bar ── */}
      <div className="flex border-b border-slate-100 bg-white shrink-0">
        {[
          { id: 'overview', label: 'Overview', icon: User },
          { id: 'ledger',   label: 'Ledger',   icon: BookOpen },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id} type="button"
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-5 py-3 text-xs font-semibold border-b-2 transition-colors ${
              activeTab === id
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            <Icon size={12} />
            {label}
          </button>
        ))}
      </div>

      {/* ── Scrollable Sections ── */}
      <div className={`flex-1 overflow-y-auto ${activeTab === 'overview' ? 'px-6 py-5 space-y-5' : 'p-0'}`}>

        {activeTab === 'overview' && <>
        {/* ── Financial Balance (from Ledger) ── */}
        {ledgerBalance !== null && (
          <div className={`rounded-2xl px-4 py-3.5 border ${
            hasAdvance
              ? 'bg-emerald-50 border-emerald-200'
              : hasDues
              ? 'bg-amber-50 border-amber-200'
              : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-[11px] font-semibold uppercase tracking-wide ${
                  hasAdvance ? 'text-emerald-600' : hasDues ? 'text-amber-600' : 'text-slate-400'
                }`}>
                  {hasAdvance ? 'Advance Credit' : hasDues ? 'Outstanding Balance' : 'Fully Settled'}
                </p>
                <p className={`text-2xl font-bold tabular-nums mt-0.5 ${
                  hasAdvance ? 'text-emerald-700' : hasDues ? 'text-amber-700' : 'text-slate-400'
                }`}>
                  {fmt(Math.abs(ledgerBalance))}
                </p>
                {hasDues && pendingDues > 0 && (
                  <p className="text-xs text-amber-500 mt-0.5">
                    {rents.filter(r => ['pending','partial','overdue'].includes(r.status)).length} open record{rents.filter(r => ['pending','partial','overdue'].includes(r.status)).length !== 1 ? 's' : ''}
                  </p>
                )}
                {hasAdvance && (
                  <p className="text-xs text-emerald-500 mt-0.5">Will be applied to next rent cycle</p>
                )}
              </div>
              {hasDues && (
                <div className="text-right space-y-1">
                  {rents.filter(r => r.status === 'overdue').length > 0 && (
                    <div className="flex items-center gap-1 justify-end">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-[11px] font-semibold text-red-600">
                        {rents.filter(r => r.status === 'overdue').length} overdue
                      </span>
                    </div>
                  )}
                  {rents.filter(r => r.status === 'partial').length > 0 && (
                    <p className="text-[11px] text-amber-600">
                      {rents.filter(r => r.status === 'partial').length} partial
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Reservation Advance ── */}
        {heldAdvance && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-100">
                  <IndianRupee size={14} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-amber-600">
                    Reservation Advance
                  </p>
                  <p className="text-xl font-bold text-amber-800 tabular-nums leading-tight mt-0.5">
                    {fmt(heldAdvance.reservationAmount)}
                  </p>
                </div>
              </div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600 bg-amber-100 border border-amber-200 rounded-full px-2.5 py-1">
                Held
              </span>
            </div>

            {/* Details */}
            <div className="rounded-xl bg-white border border-amber-100 px-3.5 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Bed</span>
                <span className="font-semibold text-slate-700">
                  {heldAdvance.roomNumber ? `Room ${heldAdvance.roomNumber} · ` : ''}Bed {heldAdvance.bedNumber}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Mode</span>
                <span className="font-semibold text-slate-700 capitalize">
                  {heldAdvance.reservationMode === 'adjust' ? 'Adjust against rent' : 'Refund on cancel'}
                </span>
              </div>
              {heldAdvance.reservedTill && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Reserved till</span>
                  <span className="font-semibold text-slate-700">
                    {new Date(heldAdvance.reservedTill).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </span>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              <button type="button" disabled={advanceActing}
                onClick={handleAdvanceApply}
                className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 py-2.5 text-xs font-bold text-white transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                {advanceActing ? '…' : 'Apply to Rent'}
              </button>
              <button type="button" disabled={advanceActing}
                onClick={handleAdvanceRefund}
                className="flex-1 rounded-xl border border-amber-300 bg-white hover:bg-amber-50 py-2.5 text-xs font-bold text-amber-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                {advanceActing ? '…' : 'Mark Refunded'}
              </button>
            </div>

            <p className="text-[10px] text-amber-600 leading-relaxed">
              "Apply to Rent" credits this amount to the tenant's ledger balance.
              "Mark Refunded" records a cash refund back to the tenant.
            </p>
          </div>
        )}

        {/* ── Security Deposit card ── */}
        {t.depositAmount > 0 && t.depositPaid && t.depositStatus !== 'refunded' && t.depositStatus !== 'adjusted' && (
          <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-violet-800">Security Deposit</p>
                <p className="text-lg font-extrabold text-violet-700 leading-tight mt-0.5">
                  ₹{(t.depositBalance ?? t.depositAmount ?? 0).toLocaleString('en-IN')}
                </p>
              </div>
              <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
                t.depositStatus === 'held' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'
              }`}>
                {t.depositStatus === 'held' ? 'Held' : 'Uncategorised'}
              </span>
            </div>

            {/* Balance vs original breakdown if they differ */}
            {t.depositBalance !== null && t.depositBalance !== t.depositAmount && (
              <p className="text-[11px] text-violet-600">
                Original: ₹{t.depositAmount.toLocaleString('en-IN')} · Remaining balance: ₹{(t.depositBalance ?? 0).toLocaleString('en-IN')}
              </p>
            )}

            <div className="flex gap-2">
              {pendingDues > 0 && (
                <button type="button" disabled={depositActing}
                  onClick={handleDepositAdjust}
                  className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 py-2.5 text-xs font-bold text-white transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                  {depositActing ? '…' : 'Adjust Against Dues'}
                </button>
              )}
              <button type="button" disabled={depositActing}
                onClick={handleDepositRefund}
                className="flex-1 rounded-xl border border-violet-300 bg-white hover:bg-violet-50 py-2.5 text-xs font-bold text-violet-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed">
                {depositActing ? '…' : 'Mark Refunded'}
              </button>
            </div>
            <p className="text-[10px] text-violet-500 leading-relaxed">
              "Adjust Against Dues" applies the deposit toward outstanding rent.
              "Mark Refunded" records a cash return to the tenant.
            </p>
          </div>
        )}

        {/* Deposit refunded / adjusted badge (past state) */}
        {t.depositAmount > 0 && t.depositPaid && (t.depositStatus === 'refunded' || t.depositStatus === 'adjusted') && (
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <div>
              <p className="text-xs font-semibold text-slate-700">Security Deposit</p>
              <p className="text-xs text-slate-400 mt-0.5">₹{t.depositAmount.toLocaleString('en-IN')}</p>
            </div>
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
              t.depositStatus === 'refunded' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {t.depositStatus === 'refunded' ? 'Refunded' : 'Adjusted'}
            </span>
          </div>
        )}

        {/* ── A. Personal Details ── */}
        <div className="space-y-2">
          <SectionTitle icon={User} title="Personal Details" section="personal"
            incomplete={!t.email || !t.emergencyContact?.name} />
          {editing === 'personal' ? (
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <div className="col-span-2">
                <label className="label text-xs">Full Name *</label>
                <input className="input text-sm" value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="label text-xs">Phone *</label>
                <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} />
              </div>
              <div className="col-span-2">
                <label className="label text-xs">Email</label>
                <input type="email" className="input text-sm" value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
              <div className="col-span-2 border-t border-slate-100 pt-2.5 mt-1">
                <p className="text-[11px] font-semibold text-slate-500 mb-2">Emergency Contact</p>
                <div className="space-y-2">
                  <input className="input text-sm w-full" placeholder="Name" value={form.emergencyName} onChange={e => set('emergencyName', e.target.value)} />
                  <PhoneInput value={form.emergencyPhone} onChange={(v) => set('emergencyPhone', v)} placeholder="Phone" />
                  <input className="input text-sm w-full" placeholder="Relation" value={form.emergencyRelation} onChange={e => set('emergencyRelation', e.target.value)} />
                </div>
              </div>
            </div>
          ) : (
            <div className="card px-4">
              <Field label="Phone"   value={t.phone} />
              <Field label="Email"   value={t.email} />
              {t.emergencyContact?.name && (
                <Field label="Emergency Contact"
                  value={`${t.emergencyContact.name} (${t.emergencyContact.relation ?? ''}) · ${t.emergencyContact.phone ?? ''}`} />
              )}
            </div>
          )}
        </div>

        {/* ── B. Documents ── */}
        <div className="space-y-2">
          <SectionTitle icon={Hash} title="Documents" section="documents"
            incomplete={!t.aadharNumber || !(t.documents?.idProofUrl || t.idProofUploaded)} />
          {editing === 'documents' ? (
            <div className="space-y-2.5 pt-1">
              <div>
                <label className="label text-xs">Aadhar Number</label>
                <input className="input text-sm" placeholder="XXXX XXXX XXXX"
                  value={form.aadharNumber} onChange={e => set('aadharNumber', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">ID Proof URL <span className="text-slate-400 font-normal">(link to uploaded file)</span></label>
                <div className="relative">
                  <Link size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input className="input text-sm pl-8" placeholder="https://drive.google.com/…"
                    value={form.idProofUrl} onChange={e => set('idProofUrl', e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label text-xs">Photo URL <span className="text-slate-400 font-normal">(optional)</span></label>
                <div className="relative">
                  <Link size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input className="input text-sm pl-8" placeholder="https://drive.google.com/…"
                    value={form.photoUrl} onChange={e => set('photoUrl', e.target.value)} />
                </div>
              </div>
            </div>
          ) : (
            <div className="card px-4">
              <Field label="ID Type"   value="Aadhar Card" />
              <Field label="ID Number" value={t.aadharNumber} />
              <div className="py-2.5 border-b border-slate-100">
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider mb-1.5">ID Document</p>
                {t.documents?.idProofUrl ? (
                  <a href={t.documents.idProofUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:underline">
                    <Upload size={11} /> View uploaded document
                  </a>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 font-medium">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Not uploaded
                  </span>
                )}
              </div>
              {t.documents?.photoUrl && (
                <div className="py-2.5">
                  <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider mb-1.5">Photo</p>
                  <a href={t.documents.photoUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:underline">
                    <Upload size={11} /> View photo
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── C. Agreement ── */}
        <div className="space-y-2">
          <SectionTitle icon={FileText} title="Agreement" section="agreement" />
          {editing === 'agreement' ? (
            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <div className="col-span-2">
                <label className="label text-xs">Agreement Type</label>
                <select className="input text-sm" value={form.agreementType} onChange={e => set('agreementType', e.target.value)}>
                  <option value="">Not specified</option>
                  <option value="monthly">Monthly (rolling)</option>
                  <option value="fixed">Fixed Term</option>
                </select>
              </div>
              <div>
                <label className="label text-xs">Start Date</label>
                <input type="date" className="input text-sm" value={form.checkInDate} onChange={e => set('checkInDate', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">End Date <span className="text-slate-400 font-normal">(optional)</span></label>
                <input type="date" className="input text-sm" value={form.checkOutDate} onChange={e => set('checkOutDate', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Monthly Rent (₹)</label>
                <input type="number" className="input text-sm" value={form.rentAmount} onChange={e => set('rentAmount', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Deposit (₹)</label>
                <input type="number" className="input text-sm" value={form.depositAmount} onChange={e => set('depositAmount', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Grace Days (0–28)</label>
                <input type="number" min="0" max="28" className="input text-sm" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="label text-xs">Agreement File URL <span className="text-slate-400 font-normal">(optional)</span></label>
                <div className="relative">
                  <Link size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input className="input text-sm pl-8" placeholder="https://drive.google.com/…"
                    value={form.agreementFileUrl} onChange={e => set('agreementFileUrl', e.target.value)} />
                </div>
              </div>
            </div>
          ) : (
            <div className="card px-4">
              {t.agreementType && (
                <Field label="Type" value={t.agreementType === 'monthly' ? 'Monthly (rolling)' : 'Fixed Term'} />
              )}
              <Field label="Start Date"    value={fdate(t.checkInDate)} />
              <Field label="End Date"      value={fdate(t.checkOutDate)} />
              <Field label="Monthly Rent"  value={fmt(t.rentAmount)} />
              <Field label="Deposit"       value={fmt(t.depositAmount)} />
              {/* billingStartDate is the immutable anchor for all billing cycles.
                  It is set once at first assignment and never changes on re-assignment.
                  If it differs from checkInDate it means the tenant was re-assigned. */}
              {t.billingStartDate && (
                <Field
                  label="Billing Anchor"
                  value={
                    <span className="flex items-center gap-1.5">
                      {fdate(t.billingStartDate)}
                      {t.checkInDate && new Date(t.billingStartDate).toDateString() !== new Date(t.checkInDate).toDateString() && (
                        <span className="inline-flex items-center text-[10px] font-semibold bg-amber-50 border border-amber-200 text-amber-700 rounded-full px-1.5 py-0.5">
                          re-assigned
                        </span>
                      )}
                    </span>
                  }
                />
              )}
              {(() => {
                const cycle = computeBillingCycle(t)
                if (!cycle) return <Field label="Billing Cycle" value={null} />
                const graceDays = t.dueDate ?? 5
                const dueDate = new Date(cycle.cycleStart)
                dueDate.setDate(dueDate.getDate() + graceDays)
                return (
                  <>
                    <Field
                      label="Current Billing Cycle"
                      value={`${fmtCycleDate(cycle.cycleStart)} → ${fmtCycleDate(cycle.cycleEnd)}`}
                    />
                    <Field
                      label="Grace Days / Due By"
                      value={`${graceDays} day${graceDays !== 1 ? 's' : ''} → Due ${fmtCycleDate(dueDate)}`}
                    />
                  </>
                )
              })()}
              {t.agreementFileUrl && (
                <div className="py-2.5">
                  <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider mb-1.5">Agreement File</p>
                  <a href={t.agreementFileUrl} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:underline">
                    <Upload size={11} /> View agreement
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Deposit collected toggle — only shown when not yet collected */}
          {t.depositAmount > 0 && !t.depositPaid && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 bg-white">
              <div>
                <p className="text-xs font-medium text-slate-700">Deposit Collected</p>
                <p className="text-xs text-slate-400 mt-0.5">{fmt(t.depositAmount)}</p>
              </div>
              <button
                onClick={() => onDepositToggle(t._id, true)}
                className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none bg-slate-200"
              >
                <span className="inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform translate-x-[3px]" />
              </button>
            </div>
          )}
        </div>

        {/* ── D. Verification ── */}
        <div className="space-y-2">
          <SectionTitle icon={ShieldCheck} title="Verification" section="verification"
            incomplete={
              !t.verification?.idVerified ||
              t.verification?.policeStatus !== 'verified'
            }
          />
          {editing === 'verification' ? (
            <div className="space-y-3 pt-1">
              <div>
                <label className="label text-xs">Police Verification Status</label>
                <select className="input text-sm" value={form.policeStatus} onChange={e => set('policeStatus', e.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="submitted">Submitted</option>
                  <option value="verified">Verified</option>
                </select>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium text-slate-700">ID Verified</p>
                <button type="button" role="switch" aria-checked={form.idVerified}
                  onClick={() => set('idVerified', !form.idVerified)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.idVerified ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${form.idVerified ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                </button>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-medium text-slate-700">Emergency Contact Verified</p>
                <button type="button" role="switch" aria-checked={form.emergencyContactVerified}
                  onClick={() => set('emergencyContactVerified', !form.emergencyContactVerified)}
                  className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${form.emergencyContactVerified ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${form.emergencyContactVerified ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                </button>
              </div>
            </div>
          ) : (
            <div className="card px-4">
              {/* Police status */}
              <div className="py-2.5 border-b border-slate-100">
                <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider mb-1.5">Police Verification</p>
                {{
                  pending:   <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-1"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" />Pending</span>,
                  submitted: <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Submitted</span>,
                  verified:  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Verified</span>,
                }[t.verification?.policeStatus ?? 'pending']}
              </div>
              {/* ID verified */}
              <div className="flex items-center justify-between py-2.5 border-b border-slate-100">
                <p className="text-sm font-medium text-slate-700">ID Verified</p>
                {t.verification?.idVerified
                  ? <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">Yes</span>
                  : <span className="text-xs font-semibold text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5">No</span>
                }
              </div>
              {/* Emergency contact verified */}
              <div className="flex items-center justify-between py-2.5">
                <p className="text-sm font-medium text-slate-700">Emergency Contact Verified</p>
                {t.verification?.emergencyContactVerified
                  ? <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">Yes</span>
                  : <span className="text-xs font-semibold text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5">No</span>
                }
              </div>
            </div>
          )}
        </div>

        {/* ── E. Rent Details (Billing Snapshot) ── */}
        {t.billingSnapshot != null && (() => {
          const snap = t.billingSnapshot
          const rentLabel = snap.isExtra
            ? 'Extra Bed (Fixed)'
            : snap.rentType === 'per_room' ? 'Equal Split' : 'Fixed Rent'
          const showConsistencyWarning = snap.rentType === 'per_room' && !snap.isExtra
          return (
            <div className="space-y-2">
              <SectionTitle icon={Calculator} title="Rent Details" />
              <div className="card px-4">
                {/* Monthly Rent — always from tenant.rentAmount, the single source of truth */}
                <div className="py-2.5 border-b border-slate-100">
                  <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Monthly Rent</p>
                  <p className="text-lg font-bold text-slate-800 tabular-nums mt-0.5">{fmt(t.rentAmount)}</p>
                </div>
                {/* Rent Type */}
                <div className="py-2.5 border-b border-slate-100">
                  <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Rent Type</p>
                  <span className={`inline-flex items-center mt-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                    snap.isExtra
                      ? 'bg-violet-50 text-violet-600 border border-violet-200'
                      : snap.rentType === 'per_room'
                        ? 'bg-blue-50 text-blue-600 border border-blue-200'
                        : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}>
                    {rentLabel}
                  </span>
                </div>
                {/* Calculation context (per_room only) */}
                {snap.rentType === 'per_room' && snap.divisorUsed && (
                  <div className="py-2.5 border-b border-slate-100">
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Calculation</p>
                    <p className="text-sm font-medium text-slate-700 mt-0.5 tabular-nums">
                      ₹{fmt(snap.baseRent)} ÷ {snap.divisorUsed} tenants
                    </p>
                  </div>
                )}
                {/* Override indicator */}
                {snap.overrideApplied && (
                  <div className="py-2.5 border-b border-slate-100">
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Override</p>
                    <p className="text-xs text-amber-600 font-medium mt-0.5">
                      ⚡ {snap.overrideSource === 'bed' ? 'Bed-level override' : 'Manual override'} applied
                    </p>
                  </div>
                )}
                {/* Assigned At */}
                {snap.assignedAt && (
                  <div className={snap.traceId ? 'py-2.5 border-b border-slate-100' : 'py-2.5'}>
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Assigned At</p>
                    <p className="text-sm font-medium text-slate-700 mt-0.5">{fdate(snap.assignedAt)}</p>
                  </div>
                )}
                {/* Trace ID (for support) */}
                {snap.traceId && (
                  <div className="py-2.5">
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Reference ID</p>
                    <p className="text-[11px] font-mono text-slate-400 mt-0.5 select-all">{snap.traceId}</p>
                  </div>
                )}
              </div>
              {/* Rent consistency warning */}
              {showConsistencyWarning && (
                <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5">
                  <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
                  <p className="text-[11px] text-amber-700 leading-relaxed">
                    Rent may differ from other occupants in this room. Per-room pricing is
                    calculated based on occupancy at the time of each tenant's assignment.
                  </p>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── F. Rent History (calculation audit trail) ── */}
        {(t.rentHistory?.length ?? 0) > 0 && (() => {
          const history = [...t.rentHistory].reverse() // newest first
          return (
            <div className="space-y-2">
              {/* Header row with toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100">
                    <Clock size={14} className="text-slate-400" />
                  </div>
                  <h4 className="text-[13px] font-bold text-slate-700 tracking-tight">Rent History</h4>
                  <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">
                    {history.length}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setRentHistoryOpen(v => !v)}
                  className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1"
                >
                  {rentHistoryOpen ? 'Hide' : 'Show'}
                  <span className={`text-[10px] transition-transform duration-200 inline-block ${rentHistoryOpen ? 'rotate-180' : ''}`}>▼</span>
                </button>
              </div>

              {/* Timeline */}
              {rentHistoryOpen && (
                <div className="card overflow-hidden divide-y divide-slate-100">
                  {history.map((entry, i) => {
                    const diff     = (entry.newRent ?? 0) - (entry.oldRent ?? 0)
                    const isFirst  = i === 0
                    return (
                      <div key={i} className={`px-4 py-3 ${isFirst ? 'bg-slate-50/60' : ''}`}>
                        {/* Row 1: date + reason */}
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-[11px] font-bold text-slate-600">
                            {REASON_LABELS[entry.reason] ?? entry.reason ?? 'Updated'}
                          </span>
                          <span className="text-[10px] text-slate-400 tabular-nums">
                            {fdate(entry.changedAt)}
                          </span>
                        </div>
                        {/* Row 2: rent delta */}
                        <div className="flex items-center gap-2">
                          {entry.oldRent != null && (
                            <>
                              <span className="text-[12px] text-slate-400 line-through tabular-nums">{fmt(entry.oldRent)}</span>
                              <span className="text-[10px] text-slate-300">→</span>
                            </>
                          )}
                          <span className={`text-[13px] font-bold tabular-nums ${
                            diff > 0 ? 'text-red-600' : diff < 0 ? 'text-emerald-600' : 'text-slate-700'
                          }`}>
                            {fmt(entry.newRent ?? entry.rentAmount)}
                          </span>
                          {diff !== 0 && (
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border tabular-nums ${
                              diff > 0
                                ? 'bg-red-50 border-red-200 text-red-600'
                                : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                            }`}>
                              {diff > 0 ? '+' : ''}{fmt(diff)}
                            </span>
                          )}
                          {entry.source && (
                            <span className="text-[10px] text-slate-400 ml-auto shrink-0">
                              {SOURCE_LABELS[entry.source] ?? entry.source}
                            </span>
                          )}
                        </div>
                        {/* Row 3: traceId */}
                        {entry.traceId && (
                          <p className="text-[9px] font-mono text-slate-300 mt-1.5 select-all truncate" title={entry.traceId}>
                            {entry.traceId}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })()}

        {/* ── G. Rent & Payment ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50">
                <IndianRupee size={14} className="text-primary-500" />
              </div>
              <h4 className="text-[13px] font-bold text-slate-700 tracking-tight">Rent & Payment</h4>
            </div>
            <span className="text-xs text-slate-400">{rents.length} records</span>
          </div>

          {rentLoading ? (
            <div className="flex justify-center py-6">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-100 border-t-primary-500" />
            </div>
          ) : rents.length === 0 ? (
            <div className="card px-4 py-6 text-center">
              <p className="text-sm text-slate-400">No rent records yet</p>
            </div>
          ) : (
            <div className="card px-4">
              {rents.map((r) => <RentHistoryItem key={r._id} rent={r} />)}
            </div>
          )}
        </div>

        {/* ── H. Invoices ── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50">
                <FileText size={14} className="text-blue-500" />
              </div>
              <h4 className="text-[13px] font-bold text-slate-700 tracking-tight">Invoices</h4>
              {invoices.length > 0 && (
                <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">
                  {invoices.length}
                </span>
              )}
            </div>
            {invoices.length > 0 && (
              <button
                type="button"
                onClick={() => setInvoicesOpen(v => !v)}
                className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 flex items-center gap-1"
              >
                {invoicesOpen ? 'Hide' : 'Show'}
                <span className={`text-[10px] transition-transform duration-200 inline-block ${invoicesOpen ? 'rotate-180' : ''}`}>▼</span>
              </button>
            )}
          </div>

          {invoicesLoading ? (
            <div className="flex justify-center py-4">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-100 border-t-primary-500" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="card px-4 py-4 text-center">
              <p className="text-sm text-slate-400">No invoices generated yet</p>
            </div>
          ) : invoicesOpen ? (
            <div className="space-y-2">
              {invoices.map(inv => {
                const statusCfg = {
                  paid:    'bg-emerald-50 text-emerald-700 border-emerald-200',
                  partial: 'bg-amber-50 text-amber-700 border-amber-200',
                  unpaid:  'bg-red-50 text-red-700 border-red-200',
                }
                const MONTH_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                const period  = inv.month ? `${MONTH_S[inv.month - 1]} ${inv.year}` : '—'
                return (
                  <div key={inv._id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-white px-4 py-3 hover:border-slate-200 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-mono font-semibold text-primary-600">{inv.invoiceNumber}</p>
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize ${statusCfg[inv.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                          {inv.status}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{period}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-right mr-1">
                        <p className="text-sm font-bold text-slate-700 tabular-nums">{fmt(inv.totalAmount)}</p>
                        {inv.balance > 0 && (
                          <p className="text-[10px] text-red-500 font-medium">{fmt(inv.balance)} due</p>
                        )}
                      </div>
                      <a
                        href={getInvoicePdfUrl(propertyId, inv._id)}
                        target="_blank"
                        rel="noreferrer"
                        title="Download PDF"
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-primary-50 hover:text-primary-600 transition-colors"
                        onClick={e => e.stopPropagation()}
                      >
                        <Download size={13} />
                      </a>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* Collapsed summary */
            <div className="card px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="text-emerald-600 font-semibold">{invoices.filter(i => i.status === 'paid').length} paid</span>
                <span className="text-amber-600 font-semibold">{invoices.filter(i => i.status === 'partial').length} partial</span>
                <span className="text-red-600 font-semibold">{invoices.filter(i => i.status === 'unpaid').length} unpaid</span>
              </div>
              <p className="text-xs font-bold text-slate-700 tabular-nums">
                {fmt(invoices.reduce((s, i) => s + i.totalAmount, 0))} total
              </p>
            </div>
          )}
        </div>

        {/* ── I. Reminder History ── */}
        {reminderHistory.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50">
                <Bell size={14} className="text-amber-500" />
              </div>
              <h4 className="text-[13px] font-bold text-slate-700 tracking-tight">Reminder History</h4>
              <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 rounded-full px-2 py-0.5">
                {reminderHistory.length}
              </span>
            </div>
            <div className="card px-4 divide-y divide-slate-100">
              {reminderHistory.map((log) => {
                const typeCfg = {
                  pre_due:              { label: 'Pre-Due',  cls: 'bg-blue-50 text-blue-700 border-blue-200'       },
                  due_day:              { label: 'Due Day',  cls: 'bg-amber-50 text-amber-700 border-amber-200'    },
                  overdue:              { label: 'Overdue',  cls: 'bg-red-50 text-red-700 border-red-200'          },
                  payment_confirmation: { label: 'Payment',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                }[log.type] ?? { label: log.type, cls: 'bg-slate-100 text-slate-500 border-slate-200' }

                const statusCfg = {
                  sent:    'text-emerald-600',
                  failed:  'text-red-500',
                  pending: 'text-slate-400',
                }[log.status] ?? 'text-slate-400'

                const sentTime = (() => {
                  const d = log.sentAt ?? log.createdAt
                  if (!d) return '—'
                  const diff = Date.now() - new Date(d).getTime()
                  const mins = Math.floor(diff / 60000)
                  if (mins < 60) return `${mins}m ago`
                  const hrs = Math.floor(mins / 60)
                  if (hrs < 24) return `${hrs}h ago`
                  return `${Math.floor(hrs / 24)}d ago`
                })()

                return (
                  <div key={log._id} className="flex items-center justify-between py-2.5">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${typeCfg.cls}`}>
                        {typeCfg.label}
                      </span>
                      <span className={`text-[11px] font-semibold capitalize ${statusCfg}`}>
                        {log.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400">{sentTime}</span>
                      {log.meta?.waUrl && (
                        <a href={log.meta.waUrl} target="_blank" rel="noreferrer"
                          className="rounded p-1 text-slate-300 hover:text-green-600 hover:bg-green-50 transition-colors"
                          onClick={e => e.stopPropagation()}>
                          <MessageCircle size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── G. Notes ── */}
        <div className="space-y-2">
          <SectionTitle icon={Mail} title="Notes" section="notes" />
          {editing === 'notes' ? (
            <textarea
              className="input text-sm min-h-[80px] resize-none"
              placeholder="Add internal notes about this tenant…"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          ) : (
            <div className="card px-4 py-3">
              <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                {t.notes || <span className="text-slate-300 italic">No notes added</span>}
              </p>
            </div>
          )}
        </div>

        {/* ── Vacate ── */}
        {t.status !== 'vacated' && (
          <button onClick={() => onVacate(t._id)}
            className="w-full btn-danger justify-center text-sm py-2.5 mt-2">
            <UserX size={15} /> Mark as Vacated
          </button>
        )}
        </>}

        {/* ── LEDGER TAB ── */}
        {activeTab === 'ledger' && (
          <div className="flex flex-col h-full">

            {/* Financial summary */}
            <div className="px-5 pt-4 pb-3 bg-gradient-to-r from-slate-50 to-white border-b border-slate-100 shrink-0">
              <div className="grid grid-cols-2 gap-3">
                <div className={`rounded-xl px-3.5 py-2.5 border ${
                  tabLedgerBalance === null ? 'bg-slate-50 border-slate-200'
                  : tabLedgerBalance > 0    ? 'bg-red-50 border-red-200'
                  : tabLedgerBalance < 0    ? 'bg-emerald-50 border-emerald-200'
                  :                           'bg-slate-50 border-slate-200'
                }`}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Current Balance</p>
                  <p className={`text-lg font-extrabold tabular-nums mt-0.5 ${
                    tabLedgerBalance === null ? 'text-slate-400'
                    : tabLedgerBalance > 0   ? 'text-red-700'
                    : tabLedgerBalance < 0   ? 'text-emerald-700'
                    :                          'text-slate-400'
                  }`}>
                    {tabLedgerBalance === null ? '—'
                      : tabLedgerBalance === 0 ? 'Settled'
                      : `₹${Math.abs(tabLedgerBalance).toLocaleString('en-IN')}`}
                  </p>
                  {tabLedgerBalance !== null && tabLedgerBalance !== 0 && (
                    <p className="text-[10px] mt-0.5 font-medium text-slate-400">
                      {tabLedgerBalance > 0 ? 'Due' : 'Advance'}
                    </p>
                  )}
                </div>
                <div className={`rounded-xl px-3.5 py-2.5 border ${
                  t.depositPaid && (t.depositBalance ?? 0) > 0
                    ? 'bg-violet-50 border-violet-200'
                    : 'bg-slate-50 border-slate-200'
                }`}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Deposit Balance</p>
                  <p className={`text-lg font-extrabold tabular-nums mt-0.5 ${
                    t.depositPaid && (t.depositBalance ?? 0) > 0 ? 'text-violet-700' : 'text-slate-400'
                  }`}>
                    {t.depositPaid && (t.depositBalance ?? 0) > 0
                      ? `₹${(t.depositBalance ?? t.depositAmount ?? 0).toLocaleString('en-IN')}`
                      : '—'}
                  </p>
                  <p className="text-[10px] mt-0.5 font-medium text-slate-400">
                    {t.depositStatus === 'held' ? 'Held' : t.depositStatus === 'refunded' ? 'Refunded' : t.depositStatus === 'adjusted' ? 'Adjusted' : 'Not collected'}
                  </p>
                </div>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 shrink-0">
              {t.status !== 'vacated' && (
                <>
                  <button type="button" onClick={() => { setPayAmt(''); setPayNotes(''); setPayRef(''); setPayMethod('cash'); setPayModal(true) }}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white transition-colors shadow-sm">
                    <CreditCard size={12} /> Record Payment
                  </button>
                  <button type="button" onClick={() => { setChargeAmt(''); setChargeDesc(''); setChargeModal(true) }}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-600 transition-colors shadow-sm">
                    <Zap size={12} /> Add Charge
                  </button>
                  {pendingDues > 0 && t.depositPaid && (t.depositBalance ?? 0) > 0 && t.depositStatus !== 'adjusted' && (
                    <button type="button" disabled={depositActing}
                      onClick={handleDepositAdjust}
                      className="flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 px-3.5 py-2 text-xs font-bold text-violet-700 transition-colors shadow-sm disabled:opacity-50">
                      Adjust Deposit
                    </button>
                  )}
                </>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                <button type="button"
                  onClick={() => downloadLedgerCSV(ledgerEntries, t.name)}
                  title="Download CSV"
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 p-2 text-slate-500 transition-colors">
                  <Download size={13} />
                </button>
                <button type="button"
                  onClick={() => printLedgerPDF(ledgerEntries, t, tabLedgerBalance ?? 0, t.depositBalance ?? t.depositAmount ?? 0)}
                  title="Print / PDF"
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 p-2 text-slate-500 transition-colors">
                  <FileText size={13} />
                </button>
                <button type="button" onClick={() => fetchLedger(ledgerPage)} title="Refresh"
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 p-2 text-slate-500 transition-colors">
                  <RefreshCw size={13} className={ledgerLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="px-5 py-2.5 border-b border-slate-100 shrink-0 space-y-2">
              {/* Search */}
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input type="text" className="input text-xs py-1.5 pl-8"
                  placeholder="Search notes or reference…"
                  value={ledgerSearch} onChange={e => setLedgerSearch(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLedgerFilter()} />
              </div>
              {/* Date range */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label text-[10px]">From</label>
                  <input type="date" className="input text-xs py-1.5"
                    value={ledgerFrom} onChange={e => setLedgerFrom(e.target.value)} />
                </div>
                <div>
                  <label className="label text-[10px]">To</label>
                  <input type="date" className="input text-xs py-1.5"
                    value={ledgerTo} onChange={e => setLedgerTo(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <select className="input text-xs py-1.5 flex-1"
                  value={ledgerType} onChange={e => setLedgerType(e.target.value)}>
                  {LEDGER_TYPE_OPTIONS.map(({ value, label }) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
                <button type="button" onClick={handleLedgerFilter}
                  className="rounded-xl bg-primary-500 hover:bg-primary-600 px-3 py-1.5 text-xs font-bold text-white transition-colors flex items-center gap-1">
                  <Filter size={11} /> Filter
                </button>
                {(ledgerFrom || ledgerTo || ledgerType || ledgerSearch) && (
                  <button type="button" onClick={handleLedgerReset}
                    className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500 transition-colors">
                    <X size={11} />
                  </button>
                )}
              </div>
            </div>

            {/* Ledger table */}
            <div className="flex-1 overflow-y-auto">
              {ledgerLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-100 border-t-primary-500" />
                </div>
              ) : ledgerEntries.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center px-8">
                  <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center mb-3">
                    <BookOpen size={20} className="text-slate-400" />
                  </div>
                  <p className="text-sm font-semibold text-slate-500">No transactions yet</p>
                  <p className="text-xs text-slate-400 mt-1">Ledger entries will appear here once rent or payments are recorded.</p>
                </div>
              ) : (
                <>
                  {/* Header row */}
                  <div className="sticky top-0 z-10 grid grid-cols-[72px_1fr_76px_72px_68px] gap-0 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200 px-4 py-2">
                    {['Date','Description','Type','Amount','Balance'].map(h => (
                      <p key={h} className="text-[9px] font-bold uppercase tracking-widest text-slate-400">{h}</p>
                    ))}
                  </div>

                  {/* Entry rows */}
                  {ledgerEntries.map((entry, idx) => {
                    const isDebit    = entry.type === 'debit'
                    // Refunds (deposit_refunded, refund) show as negative even though stored as 'credit'
                    const showNegative = isDebit || entry.referenceType === 'deposit_refunded' || entry.referenceType === 'refund'
                    const badge      = LEDGER_BADGE[entry.referenceType] ?? { label: entry.referenceType?.toUpperCase(), cls: 'bg-slate-100 text-slate-600 border-slate-200' }
                    const isLatest   = idx === 0 && ledgerPage === 1
                    const isExpanded = expandedEntry === entry._id
                    const balClr     = entry.balanceAfter > 0 ? 'text-red-600' : entry.balanceAfter < 0 ? 'text-emerald-600' : 'text-slate-400'

                    return (
                      <div key={entry._id}>
                        <button type="button"
                          onClick={() => setExpandedEntry(isExpanded ? null : entry._id)}
                          className={`w-full grid grid-cols-[72px_1fr_76px_72px_68px] gap-0 px-4 py-3 text-left border-b border-slate-100 transition-colors ${
                            isLatest ? 'bg-emerald-50/40' : 'hover:bg-slate-50'
                          } ${isExpanded ? 'bg-slate-50' : ''}`}>
                          {/* Date */}
                          <div className="flex items-center">
                            <span className="text-[11px] text-slate-500 tabular-nums leading-tight">{fmtLedgerDate(entry.createdAt)}</span>
                          </div>
                          {/* Description */}
                          <div className="flex items-center pr-2 min-w-0">
                            <span className="text-xs text-slate-700 font-medium truncate">{entry.description ?? '—'}</span>
                          </div>
                          {/* Type badge */}
                          <div className="flex items-center">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border ${badge.cls}`}>
                              {badge.label}
                            </span>
                          </div>
                          {/* Amount */}
                          <div className="flex items-center justify-end pr-1">
                            <span className={`text-xs font-bold tabular-nums ${showNegative ? 'text-red-600' : 'text-emerald-600'}`}>
                              {showNegative ? '-' : '+'}₹{(entry.amount ?? 0).toLocaleString('en-IN')}
                            </span>
                          </div>
                          {/* Balance */}
                          <div className="flex items-center justify-end">
                            <span className={`text-xs font-semibold tabular-nums ${balClr}`}>
                              ₹{Math.abs(entry.balanceAfter ?? 0).toLocaleString('en-IN')}
                            </span>
                          </div>
                        </button>

                        {/* Expanded detail row */}
                        {isExpanded && (
                          <div className="bg-slate-50 border-b border-slate-200 px-4 py-2.5 space-y-1">
                            {entry.method && (
                              <div className="flex gap-2 text-xs">
                                <span className="text-slate-400 w-20 shrink-0">Method</span>
                                <span className="text-slate-600 capitalize">{entry.method.replace(/_/g, ' ')}</span>
                              </div>
                            )}
                            {entry.description && (
                              <div className="flex gap-2 text-xs">
                                <span className="text-slate-400 w-20 shrink-0">Notes</span>
                                <span className="text-slate-600">{entry.description}</span>
                              </div>
                            )}
                            <div className="flex gap-2 text-xs">
                              <span className="text-slate-400 w-20 shrink-0">Reference</span>
                              <span className="font-mono text-[10px] text-slate-500 select-all">{String(entry.referenceId ?? '—')}</span>
                            </div>
                            <div className="flex gap-2 text-xs">
                              <span className="text-slate-400 w-20 shrink-0">Entry ID</span>
                              <span className="font-mono text-[10px] text-slate-500 select-all">{String(entry._id)}</span>
                            </div>
                            <div className="flex gap-2 text-xs">
                              <span className="text-slate-400 w-20 shrink-0">Time</span>
                              <span className="text-slate-500">{new Date(entry.createdAt).toLocaleString('en-IN')}</span>
                            </div>
                            <div className="flex gap-2 text-xs">
                              <span className="text-slate-400 w-20 shrink-0">Balance After</span>
                              <span className={`font-semibold ${entry.balanceAfter > 0 ? 'text-red-600' : entry.balanceAfter < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                ₹{Math.abs(entry.balanceAfter ?? 0).toLocaleString('en-IN')}
                                {entry.balanceAfter < 0 ? ' (Advance)' : entry.balanceAfter > 0 ? ' (Due)' : ' (Settled)'}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {/* Pagination */}
                  {ledgerPages > 1 && (
                    <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 shrink-0">
                      <p className="text-xs text-slate-400">
                        {((ledgerPage - 1) * LEDGER_LIMIT) + 1}–{Math.min(ledgerPage * LEDGER_LIMIT, ledgerTotal)} of {ledgerTotal}
                      </p>
                      <div className="flex items-center gap-1">
                        <button type="button" disabled={ledgerPage <= 1}
                          onClick={() => setLedgerPage(p => p - 1)}
                          className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30 hover:bg-slate-50 transition-colors">
                          <ChevronLeft size={12} />
                        </button>
                        <span className="text-xs font-semibold text-slate-600 px-2">{ledgerPage} / {ledgerPages}</span>
                        <button type="button" disabled={ledgerPage >= ledgerPages}
                          onClick={() => setLedgerPage(p => p + 1)}
                          className="rounded-lg border border-slate-200 p-1.5 disabled:opacity-30 hover:bg-slate-50 transition-colors">
                          <ChevronRight size={12} />
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* ── Record Payment Modal ── */}
            {payModal && (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                onClick={e => e.target === e.currentTarget && setPayModal(false)}>
                <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                        <CreditCard size={14} className="text-emerald-600" />
                      </div>
                      <p className="text-sm font-bold text-slate-800">Record Payment</p>
                    </div>
                    <button onClick={() => setPayModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="px-5 py-4 space-y-3">
                    {tabLedgerBalance !== null && tabLedgerBalance > 0 && (
                      <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5">
                        <p className="text-xs font-semibold text-amber-800">
                          Outstanding: ₹{tabLedgerBalance.toLocaleString('en-IN')}
                        </p>
                      </div>
                    )}
                    <div>
                      <label className="label text-xs">Amount (₹) *</label>
                      <input type="number" min="1" className="input text-sm" autoFocus
                        placeholder="0"
                        value={payAmt} onChange={e => setPayAmt(e.target.value)} />
                    </div>
                    <div>
                      <label className="label text-xs">Payment Method</label>
                      <select className="input text-sm" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                        {PAYMENT_METHODS.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="label text-xs">Reference / UTR <span className="text-slate-400 font-normal">(optional)</span></label>
                      <input type="text" className="input text-sm"
                        placeholder="UPI ref, cheque number…"
                        value={payRef} onChange={e => setPayRef(e.target.value)} />
                    </div>
                    <div>
                      <label className="label text-xs">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
                      <textarea className="input text-sm resize-none" rows={2}
                        placeholder="Payment notes…"
                        value={payNotes} onChange={e => setPayNotes(e.target.value)} />
                    </div>
                  </div>
                  <div className="px-5 pb-5 flex gap-2.5">
                    <button className="btn-secondary flex-1 text-xs" onClick={() => setPayModal(false)}>Cancel</button>
                    <button
                      disabled={actionBusy || !Number(payAmt) || Number(payAmt) <= 0}
                      onClick={handlePaySubmit}
                      className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-4 py-2.5 text-xs font-bold text-white transition-colors disabled:opacity-50">
                      {actionBusy ? 'Recording…' : `Record ₹${Number(payAmt) > 0 ? Number(payAmt).toLocaleString('en-IN') : '0'}`}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ── Add Charge Modal ── */}
            {chargeModal && (
              <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
                onClick={e => e.target === e.currentTarget && setChargeModal(false)}>
                <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-blue-100 flex items-center justify-center">
                        <Zap size={14} className="text-blue-600" />
                      </div>
                      <p className="text-sm font-bold text-slate-800">Add Manual Charge</p>
                    </div>
                    <button onClick={() => setChargeModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="px-5 py-4 space-y-3">
                    <div className="rounded-xl bg-blue-50 border border-blue-200 px-3.5 py-2.5">
                      <p className="text-xs text-blue-700">Adds a debit charge to the tenant's ledger (damage, maintenance, extra services, etc.)</p>
                    </div>
                    <div>
                      <label className="label text-xs">Amount (₹) *</label>
                      <input type="number" min="1" className="input text-sm" autoFocus
                        placeholder="0"
                        value={chargeAmt} onChange={e => setChargeAmt(e.target.value)} />
                    </div>
                    <div>
                      <label className="label text-xs">Description *</label>
                      <input type="text" className="input text-sm"
                        placeholder="e.g. Damage charge — broken window"
                        value={chargeDesc} onChange={e => setChargeDesc(e.target.value)} />
                    </div>
                  </div>
                  <div className="px-5 pb-5 flex gap-2.5">
                    <button className="btn-secondary flex-1 text-xs" onClick={() => setChargeModal(false)}>Cancel</button>
                    <button
                      disabled={actionBusy || !Number(chargeAmt) || Number(chargeAmt) <= 0}
                      onClick={handleChargeSubmit}
                      className="flex-1 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-xs font-bold text-white transition-colors disabled:opacity-50">
                      {actionBusy ? 'Adding…' : `Add ₹${Number(chargeAmt) > 0 ? Number(chargeAmt).toLocaleString('en-IN') : '0'} Charge`}
                    </button>
                  </div>
                </div>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const FILTER_DEFAULTS = { search: '', status: 'all', profile: 'all', rentStatus: 'all', sortBy: 'name' }

const Tenants = () => {
  const { selectedProperty } = useProperty()
  const propertyId = selectedProperty?._id ?? ''
  const toast = useToast()

  const PAGE_SIZE = 10

  const [showAdd,   setShowAdd]   = useState(false)
  const [profile,   setProfile]   = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [filters,   setFilters]   = useState(FILTER_DEFAULTS)
  const [selected,  setSelected]  = useState(new Set())
  const [page,      setPage]      = useState(1)

  // Fetch ALL tenants once — filter client-side for instant updates + accurate stats
  const { data, loading, refetch } = useApi(
    () => propertyId ? getTenants(propertyId) : Promise.resolve({ data: null }),
    [propertyId]
  )
  const allTenants = data?.data ?? []

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const activeTenants = allTenants.filter(t => t.status !== 'vacated')
    const pendingRentList = activeTenants.filter(t => {
      const rs = computeRentStatus(t)
      return rs === 'pending' || rs === 'overdue'
    })
    return {
      total:            allTenants.length,
      active:           allTenants.filter(t => t.status === 'active').length,
      notice:           allTenants.filter(t => t.status === 'notice').length,
      vacated:          allTenants.filter(t => t.status === 'vacated').length,
      incomplete:       activeTenants.filter(t => t.profileStatus === 'incomplete').length,
      pendingRentTotal: pendingRentList.reduce((s, t) => s + (t.rentAmount ?? 0), 0),
      pendingRentCount: pendingRentList.length,
      recentlyVacated:  allTenants.filter(t => t.status === 'vacated' && t.updatedAt && new Date(t.updatedAt) > thirtyDaysAgo).length,
    }
  }, [allTenants])

  // ── Filtered + sorted list ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...allTenants]

    if (filters.status !== 'all')  list = list.filter(t => t.status === filters.status)
    if (filters.profile !== 'all') list = list.filter(t => t.profileStatus === filters.profile)
    if (filters.rentStatus !== 'all') {
      list = list.filter(t => {
        const rs = computeRentStatus(t)
        if (filters.rentStatus === 'pending_overdue') return rs === 'pending' || rs === 'overdue'
        return rs === filters.rentStatus
      })
    }

    const q = filters.search.trim().toLowerCase()
    if (q) list = list.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.phone ?? '').includes(q) ||
      (t.email ?? '').toLowerCase().includes(q)
    )

    if (filters.sortBy === 'name')      list.sort((a, b) => a.name.localeCompare(b.name))
    if (filters.sortBy === 'rent_desc') list.sort((a, b) => b.rentAmount - a.rentAmount)
    if (filters.sortBy === 'rent_asc')  list.sort((a, b) => a.rentAmount - b.rentAmount)
    if (filters.sortBy === 'checkin')   list.sort((a, b) => new Date(b.checkInDate) - new Date(a.checkInDate))

    return list
  }, [allTenants, filters])

  const hasActiveFilters = filters.search !== '' || filters.status !== 'all' || filters.profile !== 'all' || filters.rentStatus !== 'all'

  // ── Filter helpers ────────────────────────────────────────────────────────
  const onFilterChange = useCallback((key, val) => { setFilters(f => ({ ...f, [key]: val })); setPage(1) }, [])
  const onReset        = useCallback(() => { setFilters(FILTER_DEFAULTS); setPage(1) }, [])

  // Stat card click: quick-filter shortcut
  const onStatClick = (key, val) => {
    setFilters(f => ({ ...FILTER_DEFAULTS, sortBy: f.sortBy, [key]: val }))
    setPage(1)
  }

  // ── Bulk selection ────────────────────────────────────────────────────────
  const toggleSelect = useCallback((id) => {
    setSelected(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  }, [])
  const toggleAll = () => {
    setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map(t => t._id)))
  }
  const clearSelection = () => setSelected(new Set())

  // Bulk: open WhatsApp for each selected tenant with a phone number
  const handleBulkReminder = () => {
    const targets = filtered.filter(t => selected.has(t._id) && t.phone)
    if (!targets.length) { toast('No selected tenants have phone numbers', 'error'); return }
    targets.forEach(t => window.open(waLink(t.phone), '_blank'))
    toast(`Opened WhatsApp for ${targets.length} tenant${targets.length > 1 ? 's' : ''}`, 'success')
  }

  // Bulk: vacate selected (active/notice only)
  const handleBulkVacate = async () => {
    const targets = filtered.filter(t => selected.has(t._id) && t.status !== 'vacated')
    if (!targets.length) return
    if (!confirm(`Vacate ${targets.length} tenant${targets.length > 1 ? 's' : ''}? This will free their beds.`)) return
    await Promise.allSettled(targets.map(t => vacateTenant(propertyId, t._id)))
    clearSelection()
    refetch()
    toast(`${targets.length} tenant${targets.length > 1 ? 's' : ''} vacated`, 'success')
  }

  // Export selected (or all filtered) tenants as CSV
  const handleExportCSV = () => {
    const targets = selected.size > 0
      ? filtered.filter(t => selected.has(t._id))
      : filtered
    const headers = ['Name', 'Phone', 'Email', 'Status', 'Rent', 'Check-in', 'Stay', 'Bed', 'Profile', 'Rent Status']
    const rows = targets.map(t => [
      `"${t.name}"`,
      t.phone ?? '',
      t.email ?? '',
      t.status,
      t.rentAmount ?? 0,
      t.checkInDate ? new Date(t.checkInDate).toLocaleDateString('en-IN') : '',
      computeStayDuration(t.checkInDate),
      t.bed?.bedNumber ? `Bed ${t.bed.bedNumber}` : '',
      t.profileStatus ?? '',
      computeRentStatus(t) ?? '',
    ])
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `tenants-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast(`Exported ${targets.length} tenant${targets.length !== 1 ? 's' : ''}`, 'success')
  }

  // ── Auto-open from Bed Modal ──────────────────────────────────────────────
  const location = useLocation()
  useEffect(() => {
    const tid = location.state?.openTenantId
    if (!tid || !propertyId || loading) return
    const found = allTenants.find(t => t._id === tid)
    if (found) { setProfile(found); window.history.replaceState({}, '') }
    else if (!loading) {
      getTenant(propertyId, tid).then(r => { if (r.data?.data) setProfile(r.data.data) }).catch(() => {})
      window.history.replaceState({}, '')
    }
  }, [location.state, allTenants, propertyId, loading]) // eslint-disable-line

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleAdd = async (form) => {
    setSaving(true)
    try {
      await createTenant(propertyId, form)
      setShowAdd(false)
      refetch()
    } catch (err) {
      alert(err.response?.data?.message || 'Error adding tenant')
    } finally { setSaving(false) }
  }

  const handleVacate = async (id) => {
    if (!confirm('Mark this tenant as vacated? This will also free their bed.')) return
    try {
      await vacateTenant(propertyId, id)
      setProfile(null)
      refetch()
    } catch (err) { alert(err.response?.data?.message || 'Error') }
  }

  const handleDepositToggle = async (id, paid) => {
    try {
      // When marking as collected, also initialise depositBalance + depositStatus
      const extra = paid
        ? { depositBalance: profile?.depositAmount ?? 0, depositStatus: 'held' }
        : {}
      await markDepositPaid(propertyId, id, paid, profile?.depositAmount)
      setProfile(prev => prev ? { ...prev, depositPaid: paid, ...extra } : prev)
      refetch()
    } catch (err) { alert(err.response?.data?.message || 'Error updating deposit status') }
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const allSelected = filtered.length > 0 && selected.size === filtered.length
  const someSelected = selected.size > 0

  return (
    <div className="space-y-5 max-w-7xl">

      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 leading-tight">Tenants</h2>
          {allTenants.length > 0 && (
            <p className="text-sm text-slate-400 mt-0.5">
              {stats.active} active · {stats.notice > 0 ? `${stats.notice} on notice · ` : ''}{stats.vacated} vacated
            </p>
          )}
        </div>
        {propertyId && (
          <button className="btn-primary" onClick={() => setShowAdd(true)}>
            <Plus size={16} /> Add Tenant
          </button>
        )}
      </div>

      {!propertyId ? (
        <div className="card border-dashed">
          <EmptyState message="No property selected. Choose one from the sidebar." />
        </div>
      ) : loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : (
        <>
          {/* ── Stat Cards ── */}
          {allTenants.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              <StatCard label="Total Tenants" value={stats.total}
                sub={`${stats.active} active`}
                active={filters.status === 'all' && filters.profile === 'all'}
                onClick={onReset} />
              <StatCard label="Active" value={stats.active} color="emerald"
                sub={stats.notice > 0 ? `${stats.notice} on notice` : undefined}
                active={filters.status === 'active'}
                onClick={() => onStatClick('status', 'active')} />
              <StatCard label="Incomplete" value={stats.incomplete} color="amber"
                sub="profiles"
                active={filters.profile === 'incomplete'}
                onClick={() => onStatClick('profile', 'incomplete')} />
              <StatCard label="Pending Rent" value={fmt(stats.pendingRentTotal)} color="amber"
                sub={stats.pendingRentCount > 0 ? `${stats.pendingRentCount} tenant${stats.pendingRentCount > 1 ? 's' : ''}` : 'none'}
                active={filters.rentStatus === 'pending_overdue'}
                onClick={() => onStatClick('rentStatus', 'pending_overdue')} />
              <StatCard label="Vacated (30d)" value={stats.recentlyVacated} color="slate"
                active={filters.status === 'vacated'}
                onClick={() => onStatClick('status', 'vacated')} />
            </div>
          )}

          {/* ── Action Required Bar ── */}
          {allTenants.length > 0 && (
            <ActionBar
              incomplete={stats.incomplete}
              pendingRentCount={stats.pendingRentCount}
            />
          )}

          {/* ── Filter Bar ── */}
          <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm py-2 -mx-1 px-1">
            <FilterBar filters={filters} onChange={onFilterChange} onReset={onReset} hasActive={hasActiveFilters} />
          </div>

          {/* ── Table ── */}
          {filtered.length === 0 ? (
            <div className="card border-dashed">
              <EmptyState
                message={hasActiveFilters ? 'No tenants match your filters' : 'No tenants yet'}
                action={
                  hasActiveFilters
                    ? <button className="btn-secondary text-sm" onClick={onReset}><RotateCcw size={14} /> Clear filters</button>
                    : <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={16} /> Add Tenant</button>
                }
              />
            </div>
          ) : (
            <div className="card overflow-hidden !p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      {/* Select-all checkbox */}
                      <th className="pl-4 pr-2 py-3 w-10" onClick={toggleAll}>
                        <div className={`h-4 w-4 rounded border-2 flex items-center justify-center cursor-pointer transition-colors ${
                          allSelected ? 'bg-primary-500 border-primary-500' : 'border-slate-300 hover:border-primary-400'
                        }`}>
                          {allSelected && <Check size={10} className="text-white" strokeWidth={3} />}
                          {!allSelected && someSelected && <span className="h-1.5 w-1.5 rounded-sm bg-primary-400" />}
                        </div>
                      </th>
                      {['Tenant', 'Bed', 'Rent / Stay', 'Profile', 'Rent Status', 'Status', ''].map(h => (
                        <th key={h} className="px-3 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {paginated.map(t => (
                      <TenantRow
                        key={t._id}
                        tenant={t}
                        selected={selected.has(t._id)}
                        onSelect={toggleSelect}
                        onView={setProfile}
                        onVacate={handleVacate}
                      />
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Table footer / Pagination */}
              <div className="sticky bottom-0 z-10 px-4 py-2.5 border-t border-slate-100 bg-white flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-slate-400">
                  {filtered.length} tenant{filtered.length !== 1 ? 's' : ''}
                  {hasActiveFilters && ` · filtered from ${allTenants.length}`}
                  {someSelected && <span className="text-primary-600 font-medium"> · {selected.size} selected</span>}
                </p>
                {totalPages > 1 && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={page === 1}
                      className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 text-xs font-medium disabled:opacity-40 hover:bg-slate-50 transition-colors"
                    >‹</button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(n => n === 1 || n === totalPages || Math.abs(n - page) <= 1)
                      .reduce((acc, n, idx, arr) => {
                        if (idx > 0 && n - arr[idx - 1] > 1) acc.push('…')
                        acc.push(n)
                        return acc
                      }, [])
                      .map((n, i) =>
                        n === '…'
                          ? <span key={`ellipsis-${i}`} className="px-1 text-xs text-slate-400">…</span>
                          : <button key={n} onClick={() => setPage(n)}
                              className={`h-7 w-7 flex items-center justify-center rounded-lg border text-xs font-medium transition-colors ${
                                page === n
                                  ? 'bg-primary-500 border-primary-500 text-white'
                                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                              }`}
                            >{n}</button>
                      )
                    }
                    <button
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                      className="h-7 w-7 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 text-xs font-medium disabled:opacity-40 hover:bg-slate-50 transition-colors"
                    >›</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Bulk Actions Bar ── */}
      {someSelected && (
        <BulkBar
          count={selected.size}
          onReminder={handleBulkReminder}
          onVacate={handleBulkVacate}
          onExport={handleExportCSV}
          onClear={clearSelection}
        />
      )}

      {/* ── Add Tenant Modal ── */}
      {showAdd && (
        <Modal title="Add Tenant" onClose={() => setShowAdd(false)} disableBackdropClose>
          <AddTenantForm
            propertyId={propertyId}
            onSubmit={handleAdd}
            onCancel={() => setShowAdd(false)}
            saving={saving}
          />
        </Modal>
      )}

      {/* ── Tenant Profile Drawer ── */}
      {profile && (
        <Drawer
          title="Tenant Profile"
          subtitle={`Since ${fdate(profile.checkInDate)}`}
          onClose={() => setProfile(null)}
          closeOnBackdrop={false}
        >
          <TenantProfile
            tenant={profile}
            propertyId={propertyId}
            onVacate={(id) => { handleVacate(id); setProfile(null) }}
            onDepositToggle={handleDepositToggle}
            onRefetch={() => {
              refetch()
              getTenant(propertyId, profile._id)
                .then(r => setProfile(r.data?.data ?? profile))
                .catch(() => {})
            }}
          />
        </Drawer>
      )}
    </div>
  )
}

export default Tenants
