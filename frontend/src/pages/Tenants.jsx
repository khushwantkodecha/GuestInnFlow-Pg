import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Plus, Phone, Mail, BedDouble, Calendar, Calculator,
  UserX, IndianRupee, User, Hash,
  FileText, FileSpreadsheet, Printer, ShieldCheck, Upload, Link,
  Search, X, RotateCcw, Eye, MessageCircle,
  Check, CheckCircle, AlertCircle, Download, Clock,
  BookOpen, ChevronDown, ChevronUp, Filter, CreditCard, Zap,
  TrendingUp, TrendingDown, Minus, RefreshCw, ChevronLeft, ChevronRight,
  Home, Building2, Shield, Copy, PhoneCall, MoreVertical,
  Pencil, UserMinus, Trash2, Power, AlertTriangle, Users,
} from 'lucide-react'
import { getTenants, getTenant, searchTenants as searchTenantsApi, createTenant, updateTenant, vacateTenant, markDepositPaid, getTenantRents, getTenantAdvance, applyTenantAdvance, refundTenantAdvance, adjustDeposit, refundDeposit, getTenantProfile, vacateWithPayment } from '../api/tenants'
import { loadEnabledMethods } from '../utils/paymentMethods'
import { getRooms, getBeds, assignTenant as assignTenantApi, cancelReservation as cancelReservationApi } from '../api/rooms'
import { BedActionModal } from './RoomsBeds'
import { getTenantLedger, recordPayment, addCharge } from '../api/rent'
import { exportLedgerXlsx } from '../utils/exportLedgerXlsx'
import { getInvoices, getInvoicePdfUrl } from '../api/invoices'
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
  // Reserved tenants have not moved in — no rent has been generated for them yet.
  if (tenant.status === 'reserved') return null
  const lb = tenant.ledgerBalance
  if (lb == null) return null
  // A tenant with no bed assigned has no rent generated yet.
  // lb=0 here means "billing not started", NOT "settled/paid".
  // Never show "Paid" for a tenant who hasn't had rent generated.
  if (lb === 0 && !tenant.bed) return null
  if (lb <= 0) return 'current'   // paid up or advance credit
  return 'pending'                 // has outstanding balance (may be overdue)
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
  current:  { label: 'Paid',     cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
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
const STAT_ICON_STYLES = {
  default: { num: 'text-slate-800',   ic: 'bg-slate-50 border-slate-200 text-slate-500'   },
  emerald: { num: 'text-emerald-700', ic: 'bg-emerald-50 border-emerald-100 text-emerald-600' },
  amber:   { num: 'text-amber-700',   ic: 'bg-amber-50 border-amber-100 text-amber-600'   },
  slate:   { num: 'text-slate-500',   ic: 'bg-slate-50 border-slate-200 text-slate-400'   },
}
const StatCard = ({ label, value, sub, icon: Icon, color = 'default' }) => {
  const { num, ic } = STAT_ICON_STYLES[color] ?? STAT_ICON_STYLES.default
  return (
    <div className="flex-1 min-w-[120px] rounded-2xl bg-white border border-slate-200 px-4 py-3.5 flex items-center gap-3 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300">
      {Icon && (
        <div className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 ${ic}`}>
          <Icon size={15} />
        </div>
      )}
      <div className="min-w-0">
        <p className={`text-[18px] font-bold leading-none tabular-nums ${num}`}>{value}</p>
        {sub && <p className="text-[10px] font-medium tabular-nums text-slate-400 mt-0.5">{sub}</p>}
        <p className="text-[10px] font-medium leading-tight text-slate-400 mt-0.5">{label}</p>
      </div>
    </div>
  )
}

// ── Filter Bar ────────────────────────────────────────────────────────────────
const FilterBar = ({ filters, onChange, onReset, hasActive }) => (
  <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
    {/* Row 1 — Search */}
    <div className="px-3 pt-3 pb-2.5 border-b border-slate-100">
      <div className="relative">
        <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-9 py-2 text-sm text-slate-700 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#60C3AD]/25 focus:border-[#60C3AD] focus:bg-white transition-all"
          placeholder="Search by name, phone or email…"
          value={filters.search}
          onChange={e => onChange('search', e.target.value)}
        />
        {filters.search && (
          <button onClick={() => onChange('search', '')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors">
            <X size={13} />
          </button>
        )}
      </div>
    </div>

    {/* Row 2 — Filters + Sort */}
    <div className="px-3 py-2 flex flex-wrap items-center gap-2">

      {/* Status segmented control */}
      <div className="flex items-center gap-0.5 bg-slate-100 rounded-full p-0.5">
        {[
          { v: 'all',     l: 'All'     },
          { v: 'active',  l: 'Active'  },
          { v: 'notice',  l: 'Notice'  },
          { v: 'vacated', l: 'Vacated' },
        ].map(({ v, l }) => (
          <button key={v} onClick={() => onChange('status', v)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              filters.status === v
                ? v === 'notice'
                  ? 'bg-orange-400 text-white shadow-sm'
                  : 'bg-[#60C3AD] text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}>{l}</button>
        ))}
      </div>

      <div className="h-5 w-px bg-slate-200 shrink-0" />

      {/* Rent segmented control */}
      <div className="flex items-center gap-0.5 bg-slate-100 rounded-full p-0.5">
        {[
          { v: 'all',             l: 'All Rent' },
          { v: 'pending_overdue', l: 'Pending'  },
          { v: 'current',         l: 'Paid'     },
        ].map(({ v, l }) => (
          <button key={v} onClick={() => onChange('rentStatus', v)}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              filters.rentStatus === v
                ? v === 'pending_overdue'
                  ? 'bg-red-500 text-white shadow-sm'
                  : 'bg-[#60C3AD] text-white shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}>{l}</button>
        ))}
      </div>

      <div className="h-5 w-px bg-slate-200 shrink-0" />

      {/* Toggle chips */}
      <button
        onClick={() => onChange('profile', filters.profile === 'incomplete' ? 'all' : 'incomplete')}
        className={`rounded-full px-3 py-1 text-xs font-semibold border transition-all ${
          filters.profile === 'incomplete'
            ? 'bg-amber-500 border-amber-500 text-white shadow-sm'
            : 'bg-white border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600'
        }`}
      >
        Incomplete
      </button>
      <button
        onClick={() => onChange('deposit', filters.deposit === 'pending' ? 'all' : 'pending')}
        className={`rounded-full px-3 py-1 text-xs font-semibold border transition-all ${
          filters.deposit === 'pending'
            ? 'bg-rose-500 border-rose-500 text-white shadow-sm'
            : 'bg-white border-slate-200 text-slate-500 hover:border-rose-300 hover:text-rose-600'
        }`}
      >
        Deposit Due
      </button>
      <button
        onClick={() => onChange('extraBed', filters.extraBed === 'extra' ? 'all' : 'extra')}
        className={`rounded-full px-3 py-1 text-xs font-semibold border transition-all ${
          filters.extraBed === 'extra'
            ? 'bg-violet-500 border-violet-500 text-white shadow-sm'
            : 'bg-white border-slate-200 text-slate-500 hover:border-violet-300 hover:text-violet-600'
        }`}
      >
        ✦ Extra Beds
      </button>

      {/* Sort + Reset pushed to right */}
      <div className="ml-auto flex items-center gap-2">
        <select
          value={filters.sortBy}
          onChange={e => onChange('sortBy', e.target.value)}
          className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 focus:outline-none focus:ring-2 focus:ring-[#60C3AD]/20 focus:border-[#60C3AD] transition-colors cursor-pointer hover:border-slate-300"
        >
          <option value="pending_first">Pending First</option>
          <option value="name">Name A–Z</option>
          <option value="rent_desc">Rent High–Low</option>
          <option value="rent_asc">Rent Low–High</option>
          <option value="checkin">Move-in Newest</option>
        </select>
        {hasActive && (
          <button onClick={onReset}
            className="flex items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-500 hover:bg-red-50 hover:border-red-300 hover:text-red-500 transition-all">
            <RotateCcw size={11} /> Reset
          </button>
        )}
      </div>

    </div>
  </div>
)

// ── Action Required Bar ───────────────────────────────────────────────────────
const ActionBar = ({ incomplete, pendingRentCount, onIncompleteClick, onPendingRentClick }) => {
  if (!incomplete && !pendingRentCount) return null
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3 flex-wrap">
      <AlertCircle size={15} className="text-amber-500 shrink-0" />
      <p className="flex-1 text-sm text-amber-800 font-medium leading-snug min-w-0">
        <span className="font-bold">Action required: </span>
        {incomplete > 0 && (
          <button
            onClick={onIncompleteClick}
            className="underline underline-offset-2 hover:text-amber-900 transition-colors"
          >
            {incomplete} incomplete profile{incomplete > 1 ? 's' : ''}
          </button>
        )}
        {incomplete > 0 && pendingRentCount > 0 && ' · '}
        {pendingRentCount > 0 && (
          <button
            onClick={onPendingRentClick}
            className="underline underline-offset-2 hover:text-amber-900 transition-colors"
          >
            {pendingRentCount} tenant{pendingRentCount > 1 ? 's' : ''} with pending rent
          </button>
        )}
      </p>
    </div>
  )
}

// ── Bulk Actions Bar ──────────────────────────────────────────────────────────
const BulkBar = ({ count, onVacate, onExport, onClear }) => (
  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 rounded-2xl bg-slate-900 px-5 py-3 shadow-2xl ring-1 ring-black/10 animate-scaleIn">
    <span className="text-sm font-semibold text-white tabular-nums">{count} selected</span>
    <div className="h-4 w-px bg-slate-700 mx-1" />
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
  name: '', phone: '', email: '', aadharNumber: '',
  checkInDate: new Date().toISOString().split('T')[0],
  rentAmount: '', depositAmount: '',
  emergencyName: '', emergencyPhone: '',
  policeVerification: true,
}

const SectionCard = ({ icon: Icon, label, children }) => (
  <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4 space-y-3">
    <div className="flex items-center gap-2 mb-1">
      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#60C3AD]/10">
        <Icon size={13} className="text-[#60C3AD]" />
      </div>
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
    </div>
    {children}
  </div>
)

const AddTenantForm = ({ propertyId, onSubmit, onCancel, saving }) => {
  const [form, setForm]                         = useState(EMPTY_FORM)
  const [extraOpen, setExtraOpen]               = useState(false)
  const [depositCollectedNow, setDepositCollectedNow] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Room / bed selection
  const [rooms, setRooms]                   = useState([])
  const [selectedRoomId, setSelectedRoomId] = useState('')
  const [beds, setBeds]                     = useState([])
  const [selectedBedId, setSelectedBedId]   = useState('')
  const [loadingRooms, setLoadingRooms]     = useState(false)
  const [loadingBeds, setLoadingBeds]       = useState(false)

  // Duplicate phone detection
  const [phoneConflict, setPhoneConflict] = useState(null)
  const [phoneChecking, setPhoneChecking] = useState(false)
  const phoneDebounceRef = useRef(null)

  // Load rooms on mount
  useEffect(() => {
    if (!propertyId) return
    setLoadingRooms(true)
    getRooms(propertyId)
      .then(r => setRooms(r.data?.data ?? r.data ?? []))
      .catch(() => {})
      .finally(() => setLoadingRooms(false))
  }, [propertyId])

  // Load vacant beds when room changes
  useEffect(() => {
    setSelectedBedId('')
    setBeds([])
    if (!propertyId || !selectedRoomId) return
    setLoadingBeds(true)
    getBeds(propertyId, selectedRoomId)
      .then(r => {
        const all = r.data?.data ?? r.data ?? []
        setBeds(all.filter(b => b.status === 'vacant'))
      })
      .catch(() => {})
      .finally(() => setLoadingBeds(false))
  }, [propertyId, selectedRoomId])

  // Auto-fill rent from selected room when not yet set
  useEffect(() => {
    if (!selectedRoomId) return
    const room = rooms.find(r => r._id === selectedRoomId)
    if (room?.baseRent && !form.rentAmount) set('rentAmount', String(room.baseRent))
  }, [selectedRoomId]) // eslint-disable-line

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
    const payload = {
      name:          form.name.trim(),
      phone:         form.phone.trim(),
      ...(form.email.trim() ? { email: form.email.trim() } : {}),
      checkInDate:   form.checkInDate || undefined,
      rentAmount:    Number(form.rentAmount),
      depositAmount: Number(form.depositAmount) || 0,
      ...(Number(form.depositAmount) > 0 && depositCollectedNow ? { depositPaid: true } : {}),
      ...(form.aadharNumber.trim()  ? { aadharNumber: form.aadharNumber.trim() }  : {}),
      ...((form.emergencyName || form.emergencyPhone) ? {
        emergencyContact: { name: form.emergencyName.trim(), phone: form.emergencyPhone.trim() }
      } : {}),
      verification: { policeStatus: form.policeVerification ? 'submitted' : 'pending' },
    }
    onSubmit(payload, selectedRoomId || null, selectedBedId || null)
  }

  const canSubmit = form.name.trim() && form.phone && form.rentAmount && !phoneConflict && !phoneChecking && !saving
  const selectedRoom = rooms.find(r => r._id === selectedRoomId)

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-0">

      {/* ── Scrollable body ── */}
      <div className="space-y-3 max-h-[62vh] overflow-y-auto pb-1">

        {/* Section 1 — Basic Info */}
        <SectionCard icon={User} label="Basic Info">
          <div>
            <label className="label text-[12px]">Full Name <span className="text-red-400">*</span></label>
            <input className="input" placeholder="e.g. Rahul Sharma" value={form.name}
              onChange={e => set('name', e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label text-[12px]">Phone Number <span className="text-red-400">*</span></label>
            <div className="relative">
              <PhoneInput value={form.phone} onChange={handlePhoneChange} />
              {phoneChecking && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 animate-pulse pointer-events-none">checking…</span>
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
                </div>
              </div>
            )}
          </div>
          <div>
            <label className="label text-[12px]">Email <span className="text-slate-400 font-normal">(optional)</span></label>
            <input type="email" className="input" placeholder="e.g. rahul@gmail.com"
              value={form.email} onChange={e => set('email', e.target.value)} />
          </div>
        </SectionCard>

        {/* Section 2 — Stay Details */}
        <SectionCard icon={BedDouble} label="Stay Details">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label text-[12px]">Room</label>
              <select className="input text-sm" value={selectedRoomId}
                onChange={e => setSelectedRoomId(e.target.value)} disabled={loadingRooms}>
                <option value="">{loadingRooms ? 'Loading…' : 'Select room'}</option>
                {rooms.filter(r => r.status !== 'inactive').map(r => (
                  <option key={r._id} value={r._id}>
                    Room {r.roomNumber}{r.floor != null ? ` · Fl.${r.floor}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label text-[12px]">
                Bed <span className="text-[10px] font-normal text-slate-400">(vacant)</span>
              </label>
              <select className="input text-sm" value={selectedBedId}
                onChange={e => setSelectedBedId(e.target.value)}
                disabled={!selectedRoomId || loadingBeds}>
                <option value="">
                  {!selectedRoomId ? 'Select room first' : loadingBeds ? 'Loading…' : beds.length === 0 ? 'No vacant beds' : 'Select bed'}
                </option>
                {beds.map(b => <option key={b._id} value={b._id}>Bed {b.bedNumber}</option>)}
              </select>
              {selectedRoomId && !loadingBeds && beds.length === 0 && (
                <p className="mt-1 text-[10px] text-amber-600 font-medium">Room is full</p>
              )}
            </div>
          </div>
          {!selectedRoomId && (
            <p className="text-[11px] text-slate-400 font-medium">
              No room selected — you can assign one later. Tenant will remain inactive until a bed is assigned.
            </p>
          )}
          <div>
            <label className="label text-[12px]">Move-in Date</label>
            <input type="date" className="input" value={form.checkInDate}
              onChange={e => set('checkInDate', e.target.value)} />
          </div>
        </SectionCard>

        {/* Section 3 — Rent Details */}
        <SectionCard icon={IndianRupee} label="Rent Details">
          <div>
            <label className="label text-[12px]">Monthly Rent <span className="text-red-400">*</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none select-none">₹</span>
              <input type="number" min="0"
                className={`input pl-7 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                  selectedRoom?.baseRent && form.rentAmount && Number(form.rentAmount) !== selectedRoom.baseRent
                    ? 'border-amber-400 focus:border-amber-400 focus:ring-amber-400/20'
                    : ''
                }`}
                placeholder="8000" value={form.rentAmount}
                onChange={e => set('rentAmount', e.target.value)} required />
            </div>
            {selectedRoom?.baseRent && form.rentAmount && Number(form.rentAmount) !== selectedRoom.baseRent ? (
              <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 flex items-start gap-2">
                <AlertCircle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-[11px] font-bold text-amber-700">Rent override applied</p>
                  <p className="text-[10px] text-amber-600 mt-0.5">
                    Room base is ₹{selectedRoom.baseRent.toLocaleString('en-IN')} — this tenant will be charged ₹{Number(form.rentAmount).toLocaleString('en-IN')} instead.
                  </p>
                </div>
              </div>
            ) : selectedRoom?.baseRent ? (
              <p className="mt-1 text-[10px] text-[#60C3AD] font-medium">
                Matches room base: ₹{selectedRoom.baseRent.toLocaleString('en-IN')}
              </p>
            ) : null}
          </div>
          <div>
            <label className="label text-[12px]">Security Deposit <span className="text-[10px] font-normal text-slate-400">(optional)</span></label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none select-none">₹</span>
              <input type="number" min="0"
                className="input pl-7 tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                placeholder="0" value={form.depositAmount}
                onChange={e => set('depositAmount', e.target.value)} />
            </div>
            {Number(form.depositAmount) > 0 && (
              <button type="button"
                onClick={() => setDepositCollectedNow(v => !v)}
                className={`mt-2 w-full flex items-center justify-between rounded-lg border px-3 py-2 transition-colors ${
                  depositCollectedNow
                    ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
                    : 'border-amber-200 bg-amber-50 hover:bg-amber-100'
                }`}>
                <div className="flex items-center gap-2">
                  <div className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors duration-200 ${
                    depositCollectedNow ? 'bg-emerald-500' : 'bg-amber-400'
                  }`}>
                    <span className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform duration-200 ${
                      depositCollectedNow ? 'translate-x-[14px]' : 'translate-x-[2px]'
                    }`} />
                  </div>
                  <span className={`text-xs font-semibold ${depositCollectedNow ? 'text-emerald-800' : 'text-amber-800'}`}>
                    {depositCollectedNow ? 'Collected now' : 'Not collected yet (pending)'}
                  </span>
                </div>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                  depositCollectedNow
                    ? 'text-emerald-700 bg-white border-emerald-200'
                    : 'text-amber-700 bg-white border-amber-200'
                }`}>
                  {depositCollectedNow ? 'Collected' : 'Pending'}
                </span>
              </button>
            )}
          </div>
        </SectionCard>

        {/* Section 4 — Additional Info (collapsible) */}
        <div className="rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden">
          <button type="button" onClick={() => setExtraOpen(o => !o)}
            className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50/60 transition-colors">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100">
                <ChevronDown size={13} className={`text-slate-400 transition-transform duration-200 ${extraOpen ? 'rotate-180' : ''}`} />
              </div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Additional Info</p>
            </div>
            <span className="text-[10px] text-slate-300">{extraOpen ? 'Collapse' : 'Expand'}</span>
          </button>

          {extraOpen && (
            <div className="px-4 pb-4 space-y-4 border-t border-[#E2E8F0] pt-3">

              {/* Aadhaar */}
              <div>
                <label className="label text-[12px] flex items-center gap-1.5">
                  <Hash size={11} className="text-slate-400" /> Aadhaar Number
                </label>
                <input className="input text-sm" placeholder="XXXX XXXX XXXX"
                  value={form.aadharNumber} onChange={e => set('aadharNumber', e.target.value)} maxLength={14} />
                <p className="mt-1.5 text-[10px] text-slate-400 flex items-center gap-1">
                  <Upload size={9} className="shrink-0" /> Document upload coming soon
                </p>
              </div>

              {/* Emergency Contact */}
              <div>
                <label className="label text-[12px] flex items-center gap-1.5">
                  <Phone size={11} className="text-slate-400" /> Emergency Contact
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <input className="input text-sm" placeholder="Contact name"
                    value={form.emergencyName} onChange={e => set('emergencyName', e.target.value)} />
                  <PhoneInput value={form.emergencyPhone} onChange={v => set('emergencyPhone', v)} placeholder="Phone" />
                </div>
              </div>

              {/* Police Verification */}
              <div className="flex items-center justify-between rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] px-3.5 py-3">
                <div className="flex items-center gap-2.5">
                  <Shield size={14} className="text-[#60C3AD] shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-[#334155]">Police Verification</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Mark as submitted if already done</p>
                  </div>
                </div>
                <button type="button" onClick={() => set('policeVerification', !form.policeVerification)}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                    form.policeVerification ? 'bg-[#60C3AD]' : 'bg-slate-200'
                  }`}>
                  <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    form.policeVerification ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Section 5 — Documents (Coming Soon) */}
        <div className="rounded-2xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3.5 flex items-center gap-3 opacity-60 select-none cursor-not-allowed">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white border border-[#E2E8F0]">
            <Upload size={15} className="text-slate-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#334155]">Documents</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Upload Aadhaar, Agreement &amp; other docs — Coming Soon</p>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex gap-2 pt-4 mt-3 border-t border-[#E2E8F0]">
        <button type="button" onClick={onCancel}
          className="flex-1 rounded-xl border border-[#E2E8F0] bg-white py-2.5 text-sm font-semibold text-[#334155] hover:bg-slate-50 transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={!canSubmit}
          className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
          style={{ backgroundColor: '#60C3AD' }}>
          {saving ? 'Saving…' : 'Save Tenant'}
        </button>
      </div>
    </form>
  )
}

// ── Tenant Row ────────────────────────────────────────────────────────────────
const TenantRow = ({ tenant: t, onView, onQuickPay }) => {
  const lb         = t.ledgerBalance ?? null
  const pending    = lb !== null && lb > 0 ? lb : 0
  const advance    = lb !== null && lb < 0 ? Math.abs(lb) : 0
  const hasPending = pending > 0
  const hasAdvance = advance > 0
  const depositDue = (t.depositAmount ?? 0) > 0 && !t.depositPaid && t.status !== 'vacated'

  const isComplete = t.status !== 'vacated' && !!(
    t.name && t.phone && t.bed && t.checkInDate && t.rentAmount > 0 &&
    t.aadharNumber && t.emergencyContact?.name && t.emergencyContact?.phone
  )
  const rentStatus = (() => {
    if (lb === null) return null
    if (t.status === 'vacated') return hasPending ? 'pending' : 'current'
    return computeRentStatus(t)
  })()

  const statusDot = {
    active:     'bg-emerald-400',
    notice:     'bg-orange-400',
    vacated:    'bg-slate-300',
    reserved:   'bg-blue-400',
    incomplete: 'bg-amber-400',
  }[t.status] ?? 'bg-slate-300'

  return (
    <tr
      className={`group cursor-pointer transition-all duration-150 ${
        hasPending ? 'hover:bg-red-50/20' : 'hover:bg-slate-50/60'
      }`}
      style={hasPending ? { boxShadow: 'inset 3px 0 0 #f87171' } : undefined}
      onClick={() => onView(t)}
    >
      {/* Tenant: avatar + name + phone + stay */}
      <td className="px-4 py-4 min-w-[200px]">
        <div className="flex items-center gap-3">
          <Avatar name={t.name} size="sm" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold text-slate-800 truncate leading-tight">{t.name}</p>
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDot}`} />
            </div>
            <p className="text-xs text-slate-400 tabular-nums mt-0.5">{t.phone}</p>
            {t.checkInDate && t.status !== 'vacated' && (
              <p className="text-[10px] text-slate-300 mt-0.5">{computeStayDuration(t.checkInDate)}</p>
            )}
          </div>
        </div>
      </td>

      {/* Room / Bed */}
      <td className="px-4 py-4">
        {t.bed && t.status !== 'vacated' ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 bg-slate-100 rounded-xl px-2.5 py-1.5">
              <BedDouble size={11} className="text-slate-400 shrink-0" />
              {t.bed.room?.roomNumber ? `R${t.bed.room.roomNumber}` : ''}
              {t.bed.room?.roomNumber && t.bed.bedNumber ? ' · ' : ''}
              {t.bed.bedNumber ?? ''}
            </span>
            {t.bed.bedNumber?.startsWith('X') && (
              <span className="text-[9px] font-bold text-violet-600 bg-violet-100 rounded-full px-1.5 py-0.5">Extra</span>
            )}
          </div>
        ) : t.status === 'incomplete' ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-600 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5">
            No bed assigned
          </span>
        ) : <span className="text-slate-300">—</span>}
      </td>

      {/* Rent */}
      <td className="px-4 py-4">
        {t.status === 'incomplete'
          ? <span className="text-slate-300 text-xs">—</span>
          : <>
              <p className="text-sm font-bold text-slate-700 tabular-nums">{fmt(t.rentAmount)}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">monthly</p>
            </>
        }
      </td>

      {/* Outstanding */}
      <td className="px-4 py-4">
        {t.status === 'incomplete' ? (
          <span className="text-slate-300 text-xs">—</span>
        ) : hasPending ? (
          <>
            <p className="text-sm font-bold text-red-600 tabular-nums">{fmt(pending)}</p>
            <p className="text-[10px] text-red-400 mt-0.5">due</p>
          </>
        ) : hasAdvance ? (
          <>
            <p className="text-sm font-bold text-emerald-600 tabular-nums">{fmt(advance)}</p>
            <p className="text-[10px] text-emerald-500 mt-0.5">advance</p>
          </>
        ) : (
          <>
            <p className="text-sm font-bold text-emerald-600 tabular-nums">₹0</p>
            <p className="text-[10px] text-slate-300 mt-0.5">settled</p>
          </>
        )}
      </td>

      {/* Billing: rent + deposit */}
      <td className="px-4 py-4">
        <div className="flex flex-col gap-1.5">
          {rentStatus ? (
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2.5 py-1 w-fit ${
              rentStatus === 'current'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-red-100 text-red-700'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${rentStatus === 'current' ? 'bg-emerald-500' : 'bg-red-500'}`} />
              {rentStatus === 'current' ? 'Rent Paid' : 'Balance Due'}
            </span>
          ) : <span className="text-slate-300 text-xs">—</span>}
          {depositDue && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2.5 py-1 w-fit bg-amber-100 text-amber-700">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
              Deposit · ₹{(t.depositAmount ?? 0).toLocaleString('en-IN')} Due
            </span>
          )}
          {(t.depositAmount ?? 0) > 0 && t.depositPaid && t.status !== 'vacated'
            && t.depositStatus !== 'refunded' && t.depositStatus !== 'adjusted' && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2.5 py-1 w-fit bg-emerald-100 text-emerald-700">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
              Deposit · ₹{(t.depositBalance ?? t.depositAmount ?? 0).toLocaleString('en-IN')} Paid
            </span>
          )}
        </div>
      </td>

      {/* Status */}
      <td className="px-4 py-4">
        <Badge status={t.status} />
      </td>

      {/* Profile */}
      <td className="px-4 py-4">
        {t.status === 'vacated'
          ? <span className="text-slate-300">—</span>
          : isComplete
            ? <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2.5 py-1 bg-emerald-100 text-emerald-700">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" /> Complete
              </span>
            : <span className="inline-flex items-center gap-1 text-[10px] font-bold rounded-full px-2.5 py-1 bg-amber-100 text-amber-700">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" /> Incomplete
              </span>
        }
      </td>

      {/* Actions */}
      <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onView(t)}
            className="rounded-xl p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600 transition-colors"
            title="View profile">
            <Eye size={14} />
          </button>
          {hasPending && t.status !== 'incomplete' && (
            <button
              onClick={() => onQuickPay(t)}
              className="flex items-center gap-1 rounded-xl bg-[#60C3AD] hover:bg-[#4fa898] px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors shadow-sm"
              title="Collect rent payment">
              <CreditCard size={11} /> Collect
            </button>
          )}
        </div>
      </td>
    </tr>
  )
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
  // ── Canonical names ──────────────────────────────────────────────────────────
  rent_generated:          { label: 'RENT',       cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  payment_received:        { label: 'PAYMENT',    cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  reservation_paid:        { label: 'ADVANCE',    cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  reservation_adjusted:    { label: 'ADJ',        cls: 'bg-orange-100 text-orange-700 border-orange-200' },
  reservation_refunded:    { label: 'REFUND',     cls: 'bg-red-100 text-red-600 border-red-200' },
  reservation_forfeited:   { label: 'FORFEITED',  cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  deposit_collected:       { label: 'DEPOSIT',    cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  deposit_adjusted:        { label: 'DEP·ADJ',    cls: 'bg-yellow-100 text-yellow-700 border-yellow-200' },
  deposit_refunded:        { label: 'DEP·REFUND', cls: 'bg-red-100 text-red-600 border-red-200' },
  deposit_forfeited:       { label: 'DEP·FORFEIT',cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  advance_refunded:        { label: 'REFUND',     cls: 'bg-red-100 text-red-600 border-red-200' },
  billing_start_corrected: { label: 'CORRECTION', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  payment_reversal:        { label: 'REVERSAL',   cls: 'bg-rose-100 text-rose-700 border-rose-200' },
  // ── Legacy names (backward compat with older records) ───────────────────────
  rent_record:             { label: 'RENT',       cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  payment:                 { label: 'PAYMENT',    cls: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  adjustment:              { label: 'CHARGE',     cls: 'bg-blue-100 text-blue-700 border-blue-200' },
  reservation_advance:     { label: 'ADVANCE',    cls: 'bg-amber-100 text-amber-700 border-amber-200' },
  refund:                  { label: 'REFUND',     cls: 'bg-red-100 text-red-600 border-red-200' },
}
const LEDGER_TYPE_OPTIONS = [
  { value: '',                       label: 'All Types' },
  { value: 'rent_generated',         label: 'Rent' },
  { value: 'payment_received',       label: 'Payment' },
  { value: 'deposit_collected',      label: 'Deposit Collected' },
  { value: 'deposit_adjusted',       label: 'Deposit Adjusted' },
  { value: 'deposit_refunded',       label: 'Deposit Refunded' },
  { value: 'deposit_forfeited',      label: 'Deposit Forfeited' },
  { value: 'reservation_paid',       label: 'Advance' },
  { value: 'reservation_refunded',   label: 'Advance Refunded' },
  { value: 'reservation_forfeited',  label: 'Advance Forfeited' },
  { value: 'advance_refunded',       label: 'Overpay Refunded' },
  { value: 'payment_reversal',       label: 'Payment Reversal' },
  { value: 'adjustment',             label: 'Manual Charge' },
  { value: 'refund',                 label: 'Refund' },
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
    ...[...entries].reverse().map(e => {
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
  const rows = [...entries].reverse().map(e => {
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


export const TenantProfile = ({ tenant: t, propertyId, onVacate, onDepositToggle, onRefetch }) => {
  const toast = useToast()
  const { refreshProperties } = useProperty()
  const filteredPaymentMethods = useMemo(() => {
    const enabled = loadEnabledMethods(propertyId)
    return PAYMENT_METHODS.filter(([v]) => enabled.includes(v))
  }, [propertyId])
  // ── Single aggregated API call ────────────────────────────────────────────────
  const [profileData,    setProfileData]    = useState(null)
  const [profileLoading, setProfileLoading] = useState(true)
  const [profileKey,     setProfileKey]     = useState(0)
  const refetchProfile = useCallback(() => {
    setProfileKey(k => k + 1)
    onRefetch?.()
  }, [onRefetch])

  useEffect(() => {
    let cancelled = false
    setProfileLoading(true)
    getTenantProfile(propertyId, t._id)
      .then(res => { if (!cancelled) { setProfileData(res.data?.data ?? null); setProfileLoading(false) } })
      .catch(() => { if (!cancelled) setProfileLoading(false) })
    return () => { cancelled = true }
  }, [propertyId, t._id, profileKey])

  // Derive all data from single response
  const rents        = profileData?.rents     ?? []
  const invoices     = profileData?.invoices  ?? []
  const heldAdvance  = profileData?.advance   ?? null
  // ledgerBalance is ALWAYS from the live API — never from t.ledgerBalance
  const ledgerBalance = profileData?.ledger?.currentBalance ?? null
  const hasAdvance    = ledgerBalance !== null && ledgerBalance < 0
  const hasDues       = ledgerBalance !== null && ledgerBalance > 0
  const rentLoading   = profileLoading
  // ⋮ menu only for active/reserved — notice tenants get the reactivate button instead
  const isOnNotice          = t.status === 'notice'
  const hasSecondaryActions = t.status === 'active' || t.status === 'reserved'

  // Current billing-cycle rent record — anchored to tenant's move-in date.
  const now = new Date()
  const billingDay = t.billingStartDate  ? new Date(t.billingStartDate).getDate()
    : t.checkInDate                      ? new Date(t.checkInDate).getDate()
    : now.getDate()
  const lastDayThisMonth    = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const effectiveBillingDay = Math.min(billingDay, lastDayThisMonth)
  const cycleStartedThisMonth = now.getDate() >= effectiveBillingDay
  const cycleMonth = cycleStartedThisMonth
    ? now.getMonth() + 1
    : (now.getMonth() === 0 ? 12 : now.getMonth())
  const cycleYear  = cycleStartedThisMonth
    ? now.getFullYear()
    : (now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear())
  const currentMonthRent = rents.find(r => r.month === cycleMonth && r.year === cycleYear) ?? null

  // ── Activity timeline ─────────────────────────────────────────────────────
  const activityItems = useMemo(() => {
    const items = []
    if (t.checkInDate) {
      const bedLabel = t.bed
        ? ` · Bed ${t.bed.bedNumber}${t.bed.room?.roomNumber ? ` (Room ${t.bed.room.roomNumber})` : ''}`
        : ''
      items.push({ id: 'assigned', type: 'ASSIGNED', amount: t.rentAmount, date: new Date(t.checkInDate), note: `Tenant assigned${bedLabel}` })
    }
    if (t.checkOutDate && t.status === 'vacated') {
      items.push({ id: 'vacated', type: 'VACATED', amount: null, date: new Date(t.checkOutDate), note: t.vacateNotes ?? 'Tenant vacated' })
    }
    items.sort((a, b) => b.date - a.date)
    return items
  }, [t.checkInDate, t.checkOutDate, t.status, t.rentAmount, t.bed, t.vacateNotes])

  const [advanceActing, setAdvanceActing] = useState(false)

  const handleAdvanceApply = async () => {
    setAdvanceActing(true)
    try {
      await applyTenantAdvance(propertyId, t._id)
      refetchProfile()
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to apply advance', 'error')
    } finally {
      setAdvanceActing(false)
    }
  }

  const handleAdvanceRefund = async () => {
    setAdvanceActing(true)
    try {
      await refundTenantAdvance(propertyId, t._id)
      refetchProfile()
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to mark refund', 'error')
    } finally {
      setAdvanceActing(false)
    }
  }

  // ── Deactivate / Reactivate / Delete actions ──
  const [deactivateConfirmOpen,  setDeactivateConfirmOpen]  = useState(false)
  const [deactivateActing,       setDeactivateActing]       = useState(false)
  const [reactivateConfirmOpen,  setReactivateConfirmOpen]  = useState(false)
  const [reactivateActing,       setReactivateActing]       = useState(false)
  const [deleteConfirmOpen,      setDeleteConfirmOpen]      = useState(false)
  const [deleteActing,           setDeleteActing]           = useState(false)
  const [viewDocsOpen,           setViewDocsOpen]           = useState(false)
  const [phoneCopied,            setPhoneCopied]            = useState(false)
  const [callConfirmOpen,        setCallConfirmOpen]        = useState(false)

  const handleDeactivateConfirm = async () => {
    setDeactivateActing(true)
    try {
      await updateTenant(propertyId, t._id, { status: 'notice' })
      setDeactivateConfirmOpen(false)
      toast(`${t.name} put on notice`, 'info')
      // Stay in the drawer — tenant is on notice, not vacated.
      // Refresh both the profile and the list row.
      refetchProfile()
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to deactivate tenant', 'error')
    } finally {
      setDeactivateActing(false)
    }
  }

  const handleReactivate = () => setReactivateConfirmOpen(true)

  const confirmReactivate = async () => {
    setReactivateActing(true)
    try {
      await updateTenant(propertyId, t._id, { status: 'active' })
      setReactivateConfirmOpen(false)
      toast(`${t.name} reactivated`, 'success')
      refetchProfile()
      onRefetch?.()
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to reactivate tenant', 'error')
    } finally {
      setReactivateActing(false)
    }
  }

  const handleDeleteConfirm = async () => {
    setDeleteActing(true)
    try {
      await vacateTenant(propertyId, t._id)
      setDeleteConfirmOpen(false)
      refreshProperties()
      onVacate?.(t._id)
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to remove tenant', 'error')
    } finally {
      setDeleteActing(false)
    }
  }

  // ── Change Room modal — delegates to the shared BedActionModal ──
  const [changeRoomOpen,  setChangeRoomOpen]  = useState(false)
  const [changeRoomRooms, setChangeRoomRooms] = useState([])

  const openChangeRoom = async () => {
    setChangeRoomOpen(true)
    if (changeRoomRooms.length === 0) {
      try {
        const res = await getRooms(propertyId)
        setChangeRoomRooms(res.data?.data ?? [])
      } catch (_) {}
    }
  }

  // ── Reserved tenant actions ──
  const [confirmMoveInOpen,    setConfirmMoveInOpen]    = useState(false)
  const [confirmMoveInRooms,   setConfirmMoveInRooms]   = useState([])
  const [cancelResActing,      setCancelResActing]      = useState(false)
  const [cancelResConfirmOpen, setCancelResConfirmOpen] = useState(false)

  const openConfirmMoveIn = async () => {
    setConfirmMoveInOpen(true)
    if (confirmMoveInRooms.length === 0) {
      try {
        const res = await getRooms(propertyId)
        setConfirmMoveInRooms(res.data?.data ?? [])
      } catch (_) {}
    }
  }

  const handleCancelReservation = async () => {
    if (!t.bed?._id || !t.bed?.room?._id) return
    setCancelResActing(true)
    try {
      await cancelReservationApi(propertyId, t.bed.room._id, t.bed._id)
      setCancelResConfirmOpen(false)
      toast(`Reservation cancelled for ${t.name}`, 'info')
      onVacate?.(t._id)
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to cancel reservation', 'error')
    } finally {
      setCancelResActing(false)
    }
  }

  // ── Deposit actions ──
  const [depositActing, setDepositActing] = useState(false)
  const [depositAdjustModal, setDepositAdjustModal] = useState(false)
  const [collectDepositModal, setCollectDepositModal] = useState(false)
  const [collectDepositDate,  setCollectDepositDate]  = useState(() => new Date().toISOString().split('T')[0])

  const handleCollectDeposit = async () => {
    setDepositActing(true)
    try {
      await onDepositToggle(t._id, true, collectDepositDate)
      setCollectDepositModal(false)
    } catch (_) {}
    setDepositActing(false)
  }
  const [depositAdjustMode,  setDepositAdjustMode]  = useState('full')   // 'full' | 'partial'
  const [depositAdjustAmt,   setDepositAdjustAmt]   = useState('')

  const openDepositAdjustModal = () => {
    setDepositAdjustMode('full')
    setDepositAdjustAmt('')
    setDepositAdjustModal(true)
  }

  const handleDepositAdjust = openDepositAdjustModal

  const handleDepositAdjustConfirm = async () => {
    const depositBal    = t.depositBalance ?? t.depositAmount ?? 0
    const outstandingDue = Math.max(0, ledgerBalance ?? 0)
    const fullAmt       = Math.min(depositBal, outstandingDue)
    const applyAmt      = depositAdjustMode === 'full' ? fullAmt : Number(depositAdjustAmt)
    if (!applyAmt || applyAmt <= 0) return
    setDepositActing(true)
    try {
      await adjustDeposit(propertyId, t._id, depositAdjustMode === 'partial' ? { amount: applyAmt } : {})
      setDepositAdjustModal(false)
      toast(`₹${applyAmt.toLocaleString('en-IN')} deposit adjusted against dues`, 'success')
      refetchProfile()
      fetchLedger(1)
      refreshProperties()
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to adjust deposit', 'error')
    } finally {
      setDepositActing(false)
    }
  }

  const [depositRefundModal,  setDepositRefundModal]  = useState(false)
  const [depositRefundMethod, setDepositRefundMethod] = useState('cash')

  const openDepositRefundModal = () => {
    setDepositRefundMethod('cash')
    setDepositRefundModal(true)
  }

  const handleDepositRefund = openDepositRefundModal

  const handleDepositRefundConfirm = async () => {
    setDepositActing(true)
    try {
      await refundDeposit(propertyId, t._id)
      setDepositRefundModal(false)
      toast('Deposit marked as refunded', 'success')
      refetchProfile()
      fetchLedger(1)
      refreshProperties()
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to refund deposit', 'error')
    } finally {
      setDepositActing(false)
    }
  }

  // ── Editable / UI state ──
  const [activeTab, setActiveTab]        = useState('overview') // 'overview' | 'ledger'
  const [editing, setEditing]           = useState(null)
  const [saving, setSaving]             = useState(false)
  const [invoicesOpen,          setInvoicesOpen]          = useState(false)
  const [secondaryActionsOpen,  setSecondaryActionsOpen]  = useState(false)
  const secondaryActionsRef = useRef(null)
  const personalRef  = useRef(null)
  const identityRef  = useRef(null)
  const agreementRef = useRef(null)

  // Close secondary dropdown on outside click
  useEffect(() => {
    const handler = (e) => { if (secondaryActionsRef.current && !secondaryActionsRef.current.contains(e.target)) setSecondaryActionsOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Auto-scroll to the section being edited
  useEffect(() => {
    if (!editing) return
    const ref = editing === 'personal' ? personalRef : editing === 'identity' ? identityRef : editing === 'agreement' ? agreementRef : null
    if (!ref?.current) return
    setTimeout(() => ref.current.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }, [editing])

  // ── Ledger tab state ──
  const [ledgerPage,    setLedgerPage]    = useState(1)
  const [ledgerFrom,    setLedgerFrom]    = useState('')
  const [ledgerTo,      setLedgerTo]      = useState('')
  const [ledgerType,    setLedgerType]    = useState('')
  const [ledgerSearch,  setLedgerSearch]  = useState('')
  const [searchDraft,   setSearchDraft]   = useState('')
  const [ledgerEntries, setLedgerEntries] = useState([])
  const [ledgerTotal,   setLedgerTotal]   = useState(0)
  const [ledgerPages,   setLedgerPages]   = useState(1)
  const [ledgerView,    setLedgerView]    = useState('timeline') // 'timeline' | 'category'
  const [sortDesc,       setSortDesc]       = useState(true)  // shared: true = newest first
  const [sortFlash,      setSortFlash]      = useState(false) // brief opacity-0 on sort change
  const [visibleCount,   setVisibleCount]   = useState(20)
  const [ledgerRentDue,    setLedgerRentDue]    = useState(0)
  const [ledgerChargesDue, setLedgerChargesDue] = useState(0)
  const [catCollapsed, setCatCollapsed] = useState({ rent: false, charges: false, payments: false, deposit: true })
  const catRentRef     = useRef(null)
  const catChargesRef  = useRef(null)
  const catPaymentsRef = useRef(null)
  const [tabLedgerBalance, setLedgerBalanceState] = useState(null)
  // Fresh balance: prefer tabLedgerBalance (kept up-to-date by both profile and ledger APIs)
  // Falls back to ledgerBalance (from profileData) on first render before the useEffect syncs.
  const bal            = tabLedgerBalance !== null ? tabLedgerBalance : ledgerBalance
  const balHasAdvance  = bal !== null && bal < 0
  const balHasDues     = bal !== null && bal > 0
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [expandedEntry, setExpandedEntry] = useState(null)
  const [ledgerFiltersOpen, setLedgerFiltersOpen] = useState(false)

  // Seed ledger tab with profile data on initial load
  useEffect(() => {
    if (profileData?.ledger) {
      setLedgerEntries(profileData.ledger.entries ?? [])
      setLedgerTotal(profileData.ledger.total ?? 0)
      setLedgerPages(profileData.ledger.pages ?? 1)
      setLedgerBalanceState(profileData.ledger.currentBalance ?? 0)
      setLedgerRentDue(profileData.ledger.rentDue ?? 0)
      setLedgerChargesDue(profileData.ledger.chargesDue ?? 0)
    }
  }, [profileData])
  // Vacate flow modal
  const [vacateModal,     setVacateModal]     = useState(false)
  const [vacating,        setVacating]        = useState(false)
  const [vacateOption,    setVacateOption]    = useState('skip')   // 'collect' | 'skip'
  const [vacateAmt,       setVacateAmt]       = useState('')
  const [vacateMethod,    setVacateMethod]    = useState('cash')

  const openVacateModal = () => {
    setVacateOption('skip')
    setVacateAmt(String(ledgerBalance > 0 ? ledgerBalance : ''))
    setVacateMethod('cash')
    setVacateModal(true)
  }

  const handleVacateConfirm = async () => {
    setVacating(true)
    try {
      const opts = { vacateOption }
      if (vacateOption === 'collect') {
        const amt = parseFloat(vacateAmt)
        if (!amt || amt <= 0) { toast('Enter a valid amount', 'error'); setVacating(false); return }
        opts.paymentAmount = amt
        opts.paymentMethod = vacateMethod
      }
      await vacateWithPayment(propertyId, t._id, opts)
      setVacateModal(false)
      refreshProperties()
      onVacate?.(t._id)
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to vacate tenant', 'error')
    } finally {
      setVacating(false)
    }
  }

  // Quick action modals
  const [payModal,      setPayModal]      = useState(false)
  const [chargeModal,   setChargeModal]   = useState(false)
  const [payAmt,        setPayAmt]        = useState('')
  const [payMethod,     setPayMethod]     = useState(() => loadEnabledMethods(propertyId)[0] ?? 'cash')
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
      setVisibleCount(20)
      setLedgerTotal(d.total ?? 0)
      setLedgerPages(d.pages ?? 1)
      setLedgerBalanceState(d.currentBalance ?? 0)
      setLedgerRentDue(d.rentDue ?? 0)
      setLedgerChargesDue(d.chargesDue ?? 0)
    } catch (_) {}
    finally { setLedgerLoading(false) }
  }, [propertyId, t._id, ledgerFrom, ledgerTo, ledgerType, ledgerSearch])

  useEffect(() => {
    if (activeTab === 'ledger') fetchLedger(ledgerPage)
  }, [activeTab, ledgerPage]) // eslint-disable-line

  const searchDraftRef = useRef(false)
  useEffect(() => {
    if (!searchDraftRef.current) { searchDraftRef.current = true; return }
    if (activeTab !== 'ledger') return
    const timer = setTimeout(() => {
      setLedgerSearch(searchDraft)
      setLedgerPage(1)
      fetchLedger(1, ledgerFrom, ledgerTo, ledgerType, searchDraft)
    }, 400)
    return () => clearTimeout(timer)
  }, [searchDraft]) // eslint-disable-line

  // Auto-collapse large sections in category view (threshold: 10 entries)
  useEffect(() => {
    if (ledgerView !== 'category' || ledgerEntries.length === 0) return
    const THRESHOLD = 10
    const rentCount     = ledgerEntries.filter(e => ['rent_generated','rent_record'].includes(e.referenceType)).length
    const chargesCount  = ledgerEntries.filter(e => e.referenceType === 'adjustment').length
    const paymentsCount = ledgerEntries.filter(e => ['payment_received','payment'].includes(e.referenceType)).length
    setCatCollapsed(prev => ({
      ...prev,
      rent:     rentCount     > THRESHOLD ? true : prev.rent,
      charges:  chargesCount  > THRESHOLD ? true : prev.charges,
      payments: paymentsCount > THRESHOLD ? true : prev.payments,
    }))
  }, [ledgerView, ledgerEntries]) // eslint-disable-line

  const handlePaySubmit = async () => {
    const amt = Number(payAmt)
    if (!amt || amt <= 0) return
    setActionBusy(true)
    try {
      await recordPayment(propertyId, { tenantId: t._id, amount: amt, method: payMethod, notes: payNotes || undefined, referenceId: payRef || undefined })
      setPayModal(false); setPayAmt(''); setPayNotes(''); setPayRef('')
      // Refresh both: profile (header balance card + rents) AND ledger tab entries
      refetchProfile()
      fetchLedger(1)
    } catch (err) { toast(err.response?.data?.message || 'Failed to record payment', 'error') }
    finally { setActionBusy(false) }
  }

  const handleChargeSubmit = async () => {
    const amt = Number(chargeAmt)
    if (!amt || amt <= 0) return
    setActionBusy(true)
    try {
      await addCharge(propertyId, t._id, { amount: amt, description: chargeDesc || undefined })
      setChargeModal(false); setChargeAmt(''); setChargeDesc('')
      // Refresh both: ledger tab entries AND profile (header balance card + rents)
      fetchLedger(1)
      refetchProfile()
      onRefetch?.()
    } catch (err) { toast(err.response?.data?.message || 'Failed to add charge', 'error') }
    finally { setActionBusy(false) }
  }

  const handleLedgerFilter = () => {
    setLedgerPage(1)
    fetchLedger(1, ledgerFrom, ledgerTo, ledgerType, ledgerSearch)
  }

  const handleLedgerReset = () => {
    setLedgerFrom(''); setLedgerTo(''); setLedgerType(''); setLedgerSearch(''); setSearchDraft(''); setLedgerPage(1)
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

  // Reset form fields for the active section back to server state, then close edit mode.
  const handleCancel = () => {
    if (editing === 'personal') {
      setForm(f => ({
        ...f,
        name:                     t.name ?? '',
        phone:                    t.phone ?? '',
        email:                    t.email ?? '',
        emergencyName:            t.emergencyContact?.name ?? '',
        emergencyPhone:           t.emergencyContact?.phone ?? '',
        emergencyRelation:        t.emergencyContact?.relation ?? '',
      }))
    } else if (editing === 'identity') {
      setForm(f => ({
        ...f,
        aadharNumber:             t.aadharNumber ?? '',
        idProofUrl:               t.documents?.idProofUrl ?? '',
        photoUrl:                 t.documents?.photoUrl ?? '',
        policeStatus:             t.verification?.policeStatus ?? 'pending',
        idVerified:               t.verification?.idVerified ?? false,
        emergencyContactVerified: t.verification?.emergencyContactVerified ?? false,
      }))
    } else if (editing === 'agreement') {
      setForm(f => ({
        ...f,
        checkInDate:      t.checkInDate ? new Date(t.checkInDate).toISOString().split('T')[0] : '',
        checkOutDate:     t.checkOutDate ? new Date(t.checkOutDate).toISOString().split('T')[0] : '',
        rentAmount:       t.rentAmount ?? 0,
        depositAmount:    t.depositAmount ?? 0,
        agreementType:    t.agreementType ?? '',
        agreementFileUrl: t.agreementFileUrl ?? '',
      }))
    }
    setEditing(null)
  }

  // ── Profile completion ──
  // Complete = all 7 fields required for daily rent tracking are present.
  // Optional fields (address, documents, agreement file) don't affect overall status.
  const isProfileComplete = !!(
    t.name &&
    t.phone &&
    t.bed &&
    t.checkInDate &&
    t.rentAmount > 0 &&
    t.aadharNumber &&
    t.emergencyContact?.name && t.emergencyContact?.phone
  )
  // Section-level missing field lists (grouped by edit section)
  const personalMissing = [
    !t.name  && 'Name',
    !t.phone && 'Phone',
    !(t.emergencyContact?.name && t.emergencyContact?.phone) && 'Emergency Contact',
  ].filter(Boolean)
  const identityMissing = [
    !t.aadharNumber && 'Aadhaar Number',
  ].filter(Boolean)
  const agreementMissing = [
    !t.checkInDate      && 'Move-in Date',
    !(t.rentAmount > 0) && 'Monthly Rent',
  ].filter(Boolean)

  // ── Save handler ──
  const handleSave = async (section) => {
    setSaving(true)
    try {
      const payload = {}
      if (section === 'personal') {
        payload.name = form.name
        payload.phone = form.phone
        payload.email = form.email
        payload.emergencyContact = {
          name: form.emergencyName,
          phone: form.emergencyPhone,
          relation: form.emergencyRelation,
        }
      } else if (section === 'identity') {
        payload.aadharNumber = form.aadharNumber
        payload.documents = {
          idProofUrl: form.idProofUrl || null,
          photoUrl:   form.photoUrl   || null,
        }
        payload.verification = {
          policeStatus:             form.policeStatus,
          idVerified:               form.idVerified,
          emergencyContactVerified: form.emergencyContactVerified,
        }
      } else if (section === 'agreement') {
        payload.checkInDate = form.checkInDate
        payload.checkOutDate = form.checkOutDate || null
        payload.rentAmount = Number(form.rentAmount)
        payload.depositAmount = Number(form.depositAmount)
        payload.agreementType = form.agreementType || null
        payload.agreementFileUrl = form.agreementFileUrl || null
      }
      await updateTenant(propertyId, t._id, payload)
      setEditing(null)
      toast('Saved successfully', 'success')
      refetchProfile()
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to save', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── Section helpers ──
  const missingLabel = (fields) => {
    if (!fields?.length) return null
    if (fields.length <= 2) return `Missing: ${fields.join(', ')}`
    return `Missing: ${fields.length} fields`
  }

  const SectionHeader = ({ icon: Icon, title, section, missing = [] }) => {
    const hasGaps = missing.length > 0
    const isEditing = editing === section
    return (
      <div className={`flex items-center justify-between px-4 py-3 border-b ${isEditing ? 'border-[#60C3AD]/20 bg-[#60C3AD]/5' : 'border-[#E2E8F0]'}`}>
        <div className="flex items-center gap-2">
          <div className={`flex h-6 w-6 items-center justify-center rounded-lg ${isEditing ? 'bg-[#60C3AD]/15' : hasGaps ? 'bg-amber-50' : 'bg-[#60C3AD]/10'}`}>
            <Icon size={13} className={isEditing ? 'text-[#60C3AD]' : hasGaps ? 'text-amber-500' : 'text-[#60C3AD]'} />
          </div>
          <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{title}</h4>
          {hasGaps && !isEditing && (
            <span className="text-[9px] font-bold uppercase tracking-wide text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              {missingLabel(missing)}
            </span>
          )}
        </div>
        {!isEditing
          ? <button type="button" onClick={() => setEditing(section)}
              className="text-xs font-medium text-slate-400 hover:text-[#60C3AD] transition-colors">Edit</button>
          : <span className="text-[10px] font-semibold text-[#60C3AD]">Editing</span>
        }
      </div>
    )
  }

  const Field = ({ label, value, fallback = '—' }) => (
    <div className="py-2.5 border-b border-[#E2E8F0] last:border-0">
      <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">{label}</p>
      <p className="text-sm font-medium text-[#334155] mt-0.5">{value || fallback}</p>
    </div>
  )

  return (
    <div className="flex-1 min-h-0 overflow-y-auto scroll-smooth">

      {/* ── Hero Header ── */}
      <div className="px-5 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0]">
        <div className="flex items-center gap-3">
          <Avatar name={t.name} size="md" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] font-bold text-[#334155] leading-tight">{t.name}</h3>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <Badge status={t.status} />
              {t.bed && (
                <span className="flex items-center gap-1 text-[11px] text-[#60C3AD] font-semibold bg-[#60C3AD]/10 border border-[#60C3AD]/30 rounded-full px-2 py-0.5">
                  <BedDouble size={10} />
                  {t.bed.room?.roomNumber ? `Room ${t.bed.room.roomNumber} · ` : ''}Bed {t.bed.bedNumber}
                </span>
              )}
              {t.bed?.bedNumber?.startsWith('X') && (
                <span className="flex items-center gap-1 text-[11px] text-violet-600 font-bold bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
                  ✦ Extra Bed
                </span>
              )}
              {/* Hero rent badge — derived from fresh rent API data, not stale t.ledgerBalance.
                  Skip for incomplete tenants: no rent generated, no badge should show. */}
              {!rentLoading && t.status !== 'incomplete' && (() => {
                const s = currentMonthRent?.status
                const freshStatus =
                  s === 'paid'                             ? 'current'
                  : (s === 'pending' || s === 'overdue' || s === 'partial') ? 'pending'
                  : (t.checkInDate && t.rentAmount > 0)   ? 'pending'
                  : null
                if (!freshStatus) return null
                const cfg = RENT_STATUS_CFG[freshStatus]
                return (
                  <span className={`inline-flex items-center text-[10px] font-semibold border rounded-full px-2 py-0.5 ${cfg.cls}`}>
                    {cfg.label}
                  </span>
                )
              })()}
              {/* Profile status — inlined with badges to save vertical space */}
              {t.status !== 'vacated' && (
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${isProfileComplete ? 'text-emerald-600' : 'text-amber-600'}`}>
                  <span className={`h-1.5 w-1.5 rounded-full inline-block shrink-0 ${isProfileComplete ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  Profile: {isProfileComplete ? 'Complete' : 'Incomplete'}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              {t.checkInDate && (
                <p className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Calendar size={10} className="shrink-0" />
                  Move-in: {fdate(t.checkInDate)}
                  {t.createdAt && (
                    <span>· {new Date(t.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}</span>
                  )}
                </p>
              )}
              {t.status === 'vacated' && hasDues && (
                <p className="text-[11px] font-semibold text-red-500 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse inline-block" />
                  Vacated · ₹{ledgerBalance.toLocaleString('en-IN')} pending
                </p>
              )}
            </div>
          </div>
        </div>

        {/* ── Quick Actions + Key numbers on same row (desktop) / stacked (mobile) ── */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {t.phone && (<>
            <button type="button"
              onClick={() => setCallConfirmOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors shadow-sm">
              <PhoneCall size={12} className="text-slate-500" /> Call
            </button>
            <a href={`https://wa.me/${t.phone.replace(/[^\d]/g, '')}`} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 text-xs font-semibold text-emerald-700 transition-colors shadow-sm">
              <MessageCircle size={12} /> WhatsApp
            </a>
            <button type="button"
              onClick={() => {
                navigator.clipboard.writeText(t.phone)
                setPhoneCopied(true)
                setTimeout(() => setPhoneCopied(false), 2000)
              }}
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors shadow-sm ${
                phoneCopied
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-600'
              }`}>
              {phoneCopied
                ? <><CheckCircle size={12} className="text-emerald-500" /> Copied!</>
                : <><Copy size={12} className="text-slate-500" /> Copy</>
              }
            </button>
          </>)}
        </div>

        {/* Key numbers */}
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="rounded-xl bg-white border border-[#E2E8F0] px-3 py-2 text-center">
            <p className="text-[10px] text-slate-400 font-medium">Monthly Rent</p>
            {t.status === 'incomplete'
              ? <p className="text-sm font-bold mt-0.5 tabular-nums text-slate-300">—</p>
              : <p className="text-sm font-bold mt-0.5 tabular-nums text-[#334155]">{fmt(t.rentAmount)}</p>
            }
          </div>
          <div className={`rounded-xl border px-3 py-2 text-center ${
            t.status === 'incomplete' || profileLoading ? 'bg-white border-[#E2E8F0]'
            : balHasAdvance ? 'bg-emerald-50 border-emerald-200'
            : balHasDues    ? 'bg-amber-50 border-amber-200'
            :                 'bg-white border-[#E2E8F0]'
          }`}>
            <p className="text-[10px] font-medium text-slate-400">Balance</p>
            {t.status === 'incomplete'
              ? <p className="text-sm font-bold mt-0.5 tabular-nums text-slate-300">—</p>
              : profileLoading
                ? <div className="h-4 w-10 bg-slate-200 rounded animate-pulse mx-auto mt-1" />
                : <p className={`text-sm font-bold mt-0.5 tabular-nums ${
                    balHasAdvance ? 'text-emerald-700' : balHasDues ? 'text-amber-700' : 'text-slate-400'
                  }`}>
                    {bal === null ? '—'
                      : bal === 0 ? 'Settled'
                      : balHasAdvance ? `Adv ₹${Math.abs(bal).toLocaleString('en-IN')}`
                      : `Due ₹${bal.toLocaleString('en-IN')}`}
                  </p>
            }
          </div>
          <div className="rounded-xl bg-white border border-[#E2E8F0] px-3 py-2 text-center">
            <p className="text-[10px] text-slate-400 font-medium">Deposit</p>
            {t.depositAmount > 0 && !t.depositPaid
              ? <p className="text-sm font-bold mt-0.5 tabular-nums text-amber-600">Pending</p>
              : t.depositStatus === 'adjusted'
                ? <p className="text-sm font-bold mt-0.5 tabular-nums text-blue-600">Adjusted</p>
                : t.depositStatus === 'refunded'
                  ? <p className="text-sm font-bold mt-0.5 tabular-nums text-emerald-600">Refunded</p>
                  : <p className="text-sm font-bold mt-0.5 tabular-nums text-[#334155]">{fmt(t.depositBalance ?? t.depositAmount)}</p>
            }
          </div>
        </div>

        {/* ── Incomplete setup banner ── */}
        {t.status === 'incomplete' && (
          <div className="mt-2 flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3">
            <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-amber-800">Incomplete setup — assign a bed to activate this tenant.</p>
              <p className="text-xs text-amber-600 mt-0.5">Rent generation and payments are disabled until a bed is assigned via Rooms &amp; Beds.</p>
            </div>
          </div>
        )}

        {/* ── Primary Actions ── */}
        <div className="mt-2 flex items-center gap-2">
          {(t.status !== 'vacated' || hasDues) && (
            <button type="button"
              disabled={t.status === 'incomplete'}
              onClick={() => { setPayAmt(String(balHasDues && bal ? bal : t.rentAmount || '')); setPayNotes(t.status === 'vacated' ? 'Payment collected after vacating' : ''); setPayRef(''); setPayMethod(filteredPaymentMethods[0]?.[0] ?? 'cash'); setPayModal(true) }}
              className={`flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold text-white transition-colors shadow-sm ${t.status === 'incomplete' ? 'bg-slate-300 cursor-not-allowed' : 'bg-[#60C3AD] hover:bg-[#4fa898]'}`}>
              <CreditCard size={13} />
              {t.status === 'vacated' ? 'Collect Payment' : 'Record Payment'}
              {balHasDues && bal && (
                <span className="ml-1 bg-white/25 rounded-full px-1.5 py-0.5 text-[10px] tabular-nums">
                  ₹{bal.toLocaleString('en-IN')}
                </span>
              )}
            </button>
          )}
          {t.status === 'active' || t.status === 'notice' ? (
            <button type="button" onClick={openVacateModal}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 px-3.5 py-2.5 text-xs font-bold text-red-600 transition-colors shrink-0">
              <UserX size={13} /> Vacate
            </button>
          ) : t.status === 'reserved' ? (
            <>
              <button type="button" onClick={openConfirmMoveIn}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-[#60C3AD] hover:bg-[#4fa898] px-3.5 py-2.5 text-xs font-bold text-white transition-colors shrink-0">
                <CheckCircle size={13} /> Confirm Move-in
              </button>
              <button type="button" onClick={() => setCancelResConfirmOpen(true)}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 px-3.5 py-2.5 text-xs font-bold text-red-600 transition-colors shrink-0">
                <X size={13} /> Cancel
              </button>
            </>
          ) : null}
          {isOnNotice && (
            <button type="button" onClick={handleReactivate} title="Reactivate Tenant"
              className="flex items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 px-2.5 py-2.5 text-emerald-600 transition-colors shrink-0">
              <RotateCcw size={14} />
            </button>
          )}
          {hasSecondaryActions && (
            <div className="relative shrink-0" ref={secondaryActionsRef}>
              <button type="button" onClick={() => setSecondaryActionsOpen(o => !o)}
                className="flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-2.5 py-2.5 text-slate-500 transition-colors">
                <MoreVertical size={14} />
              </button>
              {secondaryActionsOpen && (
                <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-2xl border border-[#E2E8F0] shadow-xl z-50 overflow-hidden py-1">

                  {/* ── Tenant Management ── */}
                  <button type="button"
                    onMouseDown={e => { e.preventDefault(); setSecondaryActionsOpen(false); setActiveTab('overview'); setEditing('personal') }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors text-left cursor-pointer">
                    <Pencil size={12} className="text-slate-400 shrink-0" />
                    Edit Tenant
                  </button>
                  <button type="button"
                    onMouseDown={e => { e.preventDefault(); setSecondaryActionsOpen(false); openChangeRoom() }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors text-left cursor-pointer">
                    <BedDouble size={12} className="text-slate-400 shrink-0" />
                    Change Room
                  </button>
                  <button type="button"
                    onMouseDown={e => { e.preventDefault(); setSecondaryActionsOpen(false); setViewDocsOpen(true) }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors text-left cursor-pointer">
                    <FileText size={12} className="text-slate-400 shrink-0" />
                    View Documents
                  </button>

                  {/* ── Advance actions (contextual) ── */}
                  {heldAdvance && (
                    <>
                      <div className="my-1 h-px bg-slate-100" />
                      <button type="button" disabled={advanceActing}
                        onMouseDown={e => { e.preventDefault(); setSecondaryActionsOpen(false); handleAdvanceApply() }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors text-left disabled:opacity-50 cursor-pointer">
                        <CheckCircle size={12} className="text-emerald-500 shrink-0" />
                        Apply Advance to Rent
                      </button>
                      <button type="button" disabled={advanceActing}
                        onMouseDown={e => { e.preventDefault(); setSecondaryActionsOpen(false); handleAdvanceRefund() }}
                        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors text-left disabled:opacity-50 cursor-pointer">
                        <IndianRupee size={12} className="text-amber-500 shrink-0" />
                        Refund Advance
                      </button>
                    </>
                  )}

                  {/* ── Danger zone ── */}
                  <div className="my-1 h-px bg-slate-100" />
                  <button type="button"
                    onMouseDown={e => { e.preventDefault(); setSecondaryActionsOpen(false); setDeactivateConfirmOpen(true) }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-amber-600 hover:bg-amber-50 transition-colors text-left cursor-pointer">
                    <UserMinus size={12} className="shrink-0" />
                    Deactivate Tenant
                  </button>
                  <button type="button"
                    onMouseDown={e => { e.preventDefault(); setSecondaryActionsOpen(false); setDeleteConfirmOpen(true) }}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors text-left cursor-pointer">
                    <Trash2 size={12} className="shrink-0" />
                    Delete Tenant
                  </button>

                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="sticky top-0 z-10 flex border-b border-[#E2E8F0] bg-white shadow-sm">
        {[['overview', 'Overview'], ['ledger', 'Ledger']].map(([tab, label]) => (
          <button key={tab} type="button" onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors border-b-2 ${
              activeTab === tab
                ? 'border-[#60C3AD] text-[#60C3AD]'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Sections ── */}
      <div className={activeTab === 'overview' ? 'px-5 py-4 space-y-3' : ''}>

        {activeTab === 'overview' && <>

        {/* ── Reserved: Reservation info banner ── */}
        {t.status === 'reserved' && (
          <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 shrink-0">
                  <Calendar size={13} className="text-violet-600" />
                </div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-violet-700">Reservation</p>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-violet-100 text-violet-700 border border-violet-200">Reserved</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white border border-violet-100 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">Bed</p>
                <p className="text-xs font-bold text-slate-700">
                  {t.bed ? `Room ${t.bed.room?.roomNumber ?? '?'} · Bed ${t.bed.bedNumber}` : '—'}
                </p>
              </div>
              <div className="rounded-xl bg-white border border-violet-100 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">Expected Move-in</p>
                <p className="text-xs font-bold text-slate-700">
                  {t.checkInDate ? fdate(t.checkInDate) : '—'}
                </p>
              </div>
            </div>
            {heldAdvance && (
              <div className="flex items-center justify-between rounded-xl bg-white border border-violet-100 px-3 py-2">
                <p className="text-xs text-slate-600">Advance Held</p>
                <p className="text-xs font-bold text-violet-700 tabular-nums">₹{heldAdvance.reservationAmount.toLocaleString('en-IN')}</p>
              </div>
            )}
            <div className="flex gap-2 pt-0.5">
              <button type="button" onClick={openConfirmMoveIn}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#60C3AD] hover:bg-[#4fa898] px-3 py-2 text-xs font-bold text-white transition-colors">
                <CheckCircle size={12} /> Confirm Move-in
              </button>
              <button type="button" onClick={() => setCancelResConfirmOpen(true)}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-white hover:bg-red-50 px-3 py-2 text-xs font-semibold text-red-600 transition-colors">
                <X size={12} /> Cancel Reservation
              </button>
            </div>
          </div>
        )}

        {/* ── Vacated: Checkout summary banner ── */}
        {t.status === 'vacated' && (
          <div className={`rounded-2xl border px-4 py-3.5 space-y-2 ${hasDues ? 'border-red-200 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`flex h-7 w-7 items-center justify-center rounded-lg shrink-0 ${hasDues ? 'bg-red-100' : 'bg-slate-100'}`}>
                  <UserX size={13} className={hasDues ? 'text-red-500' : 'text-slate-500'} />
                </div>
                <p className={`text-[11px] font-bold uppercase tracking-widest ${hasDues ? 'text-red-700' : 'text-slate-600'}`}>Vacated</p>
              </div>
              {hasDues
                ? <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-red-100 text-red-700 border border-red-200">₹{ledgerBalance.toLocaleString('en-IN')} due</span>
                : <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">Settled</span>
              }
            </div>
            {t.checkOutDate && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400 w-20 shrink-0">Checked out</span>
                <span className="font-semibold text-slate-700">{fdate(t.checkOutDate)}</span>
              </div>
            )}
            {t.checkInDate && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-slate-400 w-20 shrink-0">Stayed from</span>
                <span className="font-semibold text-slate-700">{fdate(t.checkInDate)}</span>
              </div>
            )}
            {t.vacateNotes && (
              <div className="flex items-start gap-2 text-xs">
                <span className="text-slate-400 w-20 shrink-0 pt-0.5">Notes</span>
                <span className="text-slate-600 leading-relaxed">{t.vacateNotes}</span>
              </div>
            )}
          </div>
        )}

        {/* ── Profile Completion Checklist (always visible) ── */}
        {t.status !== 'vacated' && (() => {
          const fields = [
            { key: 'name',    label: 'Name',              ok: !!t.name,                                                             section: 'personal'  },
            { key: 'phone',   label: 'Phone',             ok: !!t.phone,                                                            section: 'personal'  },
            { key: 'bed',     label: 'Bed Assigned',      ok: !!t.bed,                                                              section: null        },
            { key: 'checkin', label: 'Move-in Date',      ok: !!t.checkInDate,                                                      section: 'agreement' },
            { key: 'rent',    label: 'Monthly Rent',      ok: t.rentAmount > 0,                                                     section: 'agreement' },
            { key: 'aadhaar', label: 'Aadhaar Number',    ok: !!t.aadharNumber,                                                     section: 'identity'  },
            { key: 'emerg',   label: 'Emergency Contact', ok: !!(t.emergencyContact?.name && t.emergencyContact?.phone),            section: 'personal'  },
          ]
          const missing = fields.filter(f => !f.ok)
          if (missing.length === 0) {
            return null
          }
          return (
            <div className="rounded-2xl border border-amber-200 bg-white overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber-100 bg-amber-50/60">
                <AlertCircle size={12} className="text-amber-500 shrink-0" />
                <p className="text-[11px] font-bold uppercase tracking-widest text-amber-700 flex-1">Profile Incomplete</p>
                <span className="text-[10px] font-bold text-amber-600 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                  {fields.filter(f => f.ok).length}/{fields.length}
                </span>
              </div>
              <div className="divide-y divide-slate-50">
                {fields.map(f => (
                  <div key={f.key} className={`flex items-center gap-3 px-4 py-2 ${f.ok ? '' : 'bg-amber-50/20'}`}>
                    <div className={`shrink-0 flex h-4 w-4 items-center justify-center rounded-full ${f.ok ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                      {f.ok ? <Check size={9} className="text-emerald-600" /> : <X size={8} className="text-amber-500" />}
                    </div>
                    <span className={`text-xs flex-1 ${f.ok ? 'text-slate-400' : 'text-slate-700 font-medium'}`}>{f.label}</span>
                    {!f.ok && f.section && (
                      <button type="button" onClick={() => { setActiveTab('overview'); setEditing(f.section) }}
                        className="text-[10px] font-bold text-[#60C3AD] hover:underline shrink-0">Fix</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })()}

        {/* ── Skeleton: show while loading ── */}
        {profileLoading && (
          <div className="space-y-3 animate-pulse">
            <div className="rounded-2xl bg-slate-100 h-20" />
            <div className="rounded-2xl bg-slate-100 h-32" />
            <div className="rounded-2xl bg-slate-100 h-24" />
          </div>
        )}

        {/* ── Rent not started (incomplete tenants) ── */}
        {t.status === 'incomplete' && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-100 shrink-0">
              <BedDouble size={15} className="text-slate-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-600">Rent not started</p>
              <p className="text-xs text-slate-400 mt-0.5">Assign a bed to begin billing</p>
            </div>
          </div>
        )}

        {/* ── Rent Status Card ── */}
        {!rentLoading && !profileLoading && t.status !== 'vacated' && t.status !== 'incomplete' && (() => {
          const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
          const paid    = currentMonthRent?.paidAmount ?? 0
          const total   = currentMonthRent?.amount ?? t.rentAmount ?? 0
          const pending = Math.max(0, total - paid)
          const status  = currentMonthRent?.status ?? (t.checkInDate ? 'pending' : null)
          if (!status) return null
          const isPaid  = status === 'paid'
          return (
            <div className={`rounded-2xl border p-4 ${isPaid ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className={`flex h-6 w-6 items-center justify-center rounded-lg ${isPaid ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                    <IndianRupee size={13} className={isPaid ? 'text-emerald-600' : 'text-amber-600'} />
                  </div>
                  <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
                    {monthNames[cycleMonth - 1]} {cycleYear}
                  </h4>
                </div>
                <span className={`text-[10px] font-bold uppercase tracking-widest rounded-full px-2.5 py-1 ${
                  isPaid
                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-200'
                    : 'bg-amber-100 text-amber-700 border border-amber-200'
                }`}>
                  {isPaid ? 'Paid' : 'Pending'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Monthly</p>
                  <p className="text-sm font-bold text-[#334155] tabular-nums">{fmt(total)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">Paid</p>
                  <p className={`text-sm font-bold tabular-nums ${paid > 0 ? 'text-emerald-700' : 'text-slate-300'}`}>{fmt(paid)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-400 mb-0.5">This month</p>
                  <p className={`text-sm font-bold tabular-nums ${pending > 0 ? 'text-red-600' : 'text-slate-300'}`}>{pending > 0 ? `₹${pending.toLocaleString('en-IN')} due` : fmt(0)}</p>
                </div>
              </div>
              {isPaid && currentMonthRent?.paymentDate && (
                <p className="text-[10px] text-emerald-600 text-center font-medium mt-3">
                  Paid on {fdate(currentMonthRent.paymentDate)}
                  {currentMonthRent.paymentMethod && ` · ${currentMonthRent.paymentMethod.replace(/_/g, ' ')}`}
                </p>
              )}
            </div>
          )
        })()}

        {/* ── Financial Summary removed — balance shown in header ── */}
        {false && ledgerBalance !== null && ledgerBalance !== 0 && (
          <div className={`rounded-2xl px-4 py-3.5 border flex items-center justify-between ${
            hasAdvance ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
          }`}>
            <div>
              <p className={`text-sm font-bold ${hasAdvance ? 'text-emerald-700' : 'text-amber-700'}`}>
                {hasAdvance
                  ? `Advance ₹${Math.abs(ledgerBalance).toLocaleString('en-IN')}`
                  : `You owe ₹${ledgerBalance.toLocaleString('en-IN')}`}
              </p>
              {hasDues && (
                <p className="text-[11px] text-amber-500 mt-0.5">
                  Based on {rents.filter(r => ['pending','partial','overdue'].includes(r.status)).length} pending record{rents.filter(r => ['pending','partial','overdue'].includes(r.status)).length !== 1 ? 's' : ''}
                </p>
              )}
              {hasAdvance && (
                <p className="text-[11px] text-emerald-500 mt-0.5">Will be applied to next rent cycle</p>
              )}
            </div>
            {hasDues && rents.filter(r => r.status === 'overdue').length > 0 && (
              <div className="flex items-center gap-1 shrink-0">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                <span className="text-[11px] font-semibold text-red-600">
                  {rents.filter(r => r.status === 'overdue').length} overdue
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Reservation Advance ── */}
        {heldAdvance && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-100">
                <IndianRupee size={14} className="text-amber-600" />
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Reservation Advance</p>
                <p className="text-sm font-bold text-amber-800 tabular-nums mt-0.5">{fmt(heldAdvance.reservationAmount)}</p>
                <p className="text-[10px] text-amber-500 mt-0.5 truncate">
                  {heldAdvance.roomNumber ? `Room ${heldAdvance.roomNumber} · ` : ''}Bed {heldAdvance.bedNumber}
                  {heldAdvance.reservedTill ? ` · till ${new Date(heldAdvance.reservedTill).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
                </p>
              </div>
            </div>
            <span className="text-[10px] font-bold text-amber-600 bg-amber-100 border border-amber-200 rounded-full px-2.5 py-1 shrink-0">Held</span>
          </div>
        )}

        {/* ── Security Deposit card ── */}
        {t.depositAmount > 0 && t.depositPaid && t.depositStatus !== 'refunded' && t.depositStatus !== 'adjusted' && (
          <div className="rounded-2xl border border-violet-200 bg-violet-50 px-4 pt-3 pb-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-violet-100">
                  <Shield size={14} className="text-violet-600" />
                </div>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-violet-600">Security Deposit</p>
                  <p className="text-sm font-bold text-violet-800 tabular-nums mt-0.5">
                    ₹{(t.depositBalance ?? t.depositAmount ?? 0).toLocaleString('en-IN')}
                  </p>
                  {t.depositBalance !== null && t.depositBalance !== t.depositAmount && (
                    <p className="text-[10px] text-violet-400 mt-0.5">
                      of ₹{t.depositAmount.toLocaleString('en-IN')} original
                    </p>
                  )}
                  {t.depositPaidAt && (
                    <p className="text-[10px] text-violet-400 mt-0.5">
                      Collected {new Date(t.depositPaidAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  )}
                </div>
              </div>
              <span className="text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 bg-violet-100 text-violet-700 border border-violet-200">
                Held
              </span>
            </div>
            <div className="mt-2.5 flex items-center gap-2 border-t border-violet-200/60 pt-2.5">
              {hasDues && (
                <button type="button" disabled={depositActing}
                  onClick={handleDepositAdjust}
                  className="flex-1 rounded-xl border border-violet-300 bg-white hover:bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors disabled:opacity-50">
                  Adjust vs Dues
                </button>
              )}
              <button type="button" disabled={depositActing}
                onClick={handleDepositRefund}
                className="flex-1 rounded-xl border border-violet-300 bg-white hover:bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 transition-colors disabled:opacity-50">
                Refund
              </button>
            </div>
          </div>
        )}

        {/* Deposit refunded / adjusted badge (past state) */}
        {t.depositAmount > 0 && t.depositPaid && (t.depositStatus === 'refunded' || t.depositStatus === 'adjusted') && (
          <div className="flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3">
            <div>
              <p className="text-xs font-semibold text-[#334155]">Security Deposit</p>
              <p className="text-xs text-slate-400 mt-0.5">₹{t.depositAmount.toLocaleString('en-IN')}</p>
            </div>
            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full ${
              t.depositStatus === 'refunded' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'
            }`}>
              {t.depositStatus === 'refunded' ? 'Refunded' : 'Adjusted'}
            </span>
          </div>
        )}

        {/* ── A. Personal Info ── */}
        <div ref={personalRef} className="rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden">
          <SectionHeader icon={User} title="Personal Info" section="personal" missing={personalMissing} />
          {editing === 'personal' ? (
            <div className="grid grid-cols-2 gap-2.5 px-4 pt-3 pb-4">
              <div className="col-span-2">
                <label className="label text-xs">Full Name *</label>
                <input className={`input text-sm ${!form.name ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : ''}`}
                  value={form.name} onChange={e => set('name', e.target.value)} />
              </div>
              <div className="col-span-2">
                <label className="label text-xs">Phone *</label>
                <PhoneInput value={form.phone} onChange={(v) => set('phone', v)}
                  className={!form.phone ? 'border-red-300' : ''} />
              </div>
              <div className="col-span-2">
                <label className="label text-xs">Email</label>
                <input type="email" className="input text-sm" value={form.email} onChange={e => set('email', e.target.value)} />
              </div>
              <div className="col-span-2 border-t border-[#E2E8F0] pt-2.5 mt-1">
                <p className="text-[11px] font-semibold text-slate-500 mb-2">Emergency Contact</p>
                <div className="space-y-2">
                  <input className={`input text-sm w-full ${!form.emergencyName ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : ''}`}
                    placeholder="Name" value={form.emergencyName} onChange={e => set('emergencyName', e.target.value)} />
                  <PhoneInput value={form.emergencyPhone} onChange={(v) => set('emergencyPhone', v)} placeholder="Phone"
                    className={!form.emergencyPhone ? 'border-red-300' : ''} />
                  <input className="input text-sm w-full" placeholder="Relation"
                    value={form.emergencyRelation} onChange={e => set('emergencyRelation', e.target.value)} />
                </div>
              </div>
            </div>
          ) : (
            <div className="px-4 pt-2 pb-4 space-y-1">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="text-slate-400 w-16 shrink-0">Phone</span>
                <span className="font-medium">{t.phone || '—'}</span>
              </div>
              {t.email && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="text-slate-400 w-16 shrink-0">Email</span>
                  <span className="font-medium truncate">{t.email}</span>
                </div>
              )}
              {t.emergencyContact?.name && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="text-slate-400 w-16 shrink-0">Emergency</span>
                  <span className="font-medium truncate">
                    {t.emergencyContact.name}{t.emergencyContact.relation ? ` (${t.emergencyContact.relation})` : ''} · {t.emergencyContact.phone ?? ''}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── B. Identity & Verification ── */}
        <div ref={identityRef} className="rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden">
          <SectionHeader icon={Hash} title="Identity & Verification" section="identity" missing={identityMissing} />
          {editing === 'identity' ? (
            <div className="space-y-3 px-4 pt-3 pb-4">
              <div>
                <label className="label text-xs">Aadhaar Number</label>
                <input className={`input text-sm ${!form.aadharNumber ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : ''}`}
                  placeholder="XXXX XXXX XXXX"
                  value={form.aadharNumber} onChange={e => set('aadharNumber', e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Police Verification</label>
                <select className="input text-sm" value={form.policeStatus} onChange={e => set('policeStatus', e.target.value)}>
                  <option value="pending">Pending</option>
                  <option value="submitted">Submitted</option>
                  <option value="verified">Verified</option>
                </select>
              </div>
            </div>
          ) : (
            <div className="px-4 pt-2 pb-4 space-y-2">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="text-slate-400 w-20 shrink-0">Aadhaar</span>
                <span className="font-medium">{t.aadharNumber || '—'}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="text-slate-400 w-20 shrink-0">Police</span>
                {{
                  pending:   <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" />Pending</span>,
                  submitted: <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Submitted</span>,
                  verified:  <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />Verified</span>,
                }[t.verification?.policeStatus ?? 'pending']}
              </div>
            </div>
          )}
        </div>

        {/* ── C. Stay & Agreement ── */}
        <div ref={agreementRef} className="rounded-2xl border border-[#E2E8F0] bg-white overflow-hidden">
          <SectionHeader icon={FileText} title="Stay & Agreement" section="agreement" missing={agreementMissing} />
          {editing === 'agreement' ? (
            <div className="grid grid-cols-2 gap-2.5 px-4 pt-3 pb-4">
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
                {t.depositPaid ? (
                  <div className="input text-sm bg-slate-50 text-slate-500 cursor-not-allowed flex items-center gap-1.5">
                    <span>{fmt(t.depositAmount)}</span>
                    <span className="text-xs text-amber-600 ml-auto">(collected — cannot edit)</span>
                  </div>
                ) : (
                  <input type="number" className="input text-sm" value={form.depositAmount} onChange={e => set('depositAmount', e.target.value)} />
                )}
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
            <div className="px-4 pt-2 pb-4 space-y-1">
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="text-slate-400 w-20 shrink-0">Move-in</span>
                <span className="font-medium">{fdate(t.checkInDate) || '—'}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="text-slate-400 w-20 shrink-0">Rent</span>
                <span className="font-medium">{fmt(t.rentAmount)}</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <span className="text-slate-400 w-20 shrink-0">Deposit</span>
                <span className="font-medium">{fmt(t.depositAmount)}</span>
              </div>
              {t.agreementType && (
                <div className="flex items-center gap-2 text-xs text-slate-600">
                  <span className="text-slate-400 w-20 shrink-0">Agreement</span>
                  <span className="font-medium">{t.agreementType === 'monthly' ? 'Monthly' : 'Fixed Term'}</span>
                </div>
              )}
              {t.agreementFileUrl && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-slate-400 w-20 shrink-0">File</span>
                  <a href={t.agreementFileUrl} target="_blank" rel="noreferrer"
                    className="font-medium flex items-center gap-1 hover:underline" style={{ color: '#60C3AD' }}>
                    <Upload size={10} /> View
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Deposit pending card — shown when deposit is expected but not yet collected */}
          {t.depositAmount > 0 && !t.depositPaid && (
            <div className="mx-4 mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-100">
                    <Shield size={13} className="text-amber-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Security Deposit</p>
                    <p className="text-sm font-bold text-amber-800 tabular-nums">{fmt(t.depositAmount)}</p>
                  </div>
                </div>
                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 bg-amber-100 text-amber-700 border border-amber-200">
                  Pending
                </span>
              </div>
              <button
                type="button"
                disabled={depositActing}
                onClick={() => { setCollectDepositDate(new Date().toISOString().split('T')[0]); setCollectDepositModal(true) }}
                className="mt-3 w-full rounded-lg bg-amber-500 hover:bg-amber-600 disabled:opacity-50 px-3 py-2 text-xs font-bold text-white transition-colors">
                Collect Deposit
              </button>
            </div>
          )}
        </div>

        {/* ── E. Rent Details (Billing Snapshot) — hidden in MVP ── */}
        {false && t.billingSnapshot != null && (() => {
          const snap = t.billingSnapshot
          const rentLabel = snap.isExtra ? 'Extra Bed (Fixed)' : 'Fixed Rent'
          return (
            <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4">
              <SectionHeader icon={Calculator} title="Rent Details" section={null} missing={[]} />
              {/* Monthly Rent — always from tenant.rentAmount, the single source of truth */}
              <div className="py-2.5 border-b border-[#E2E8F0]">
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Monthly Rent</p>
                <p className="text-lg font-bold text-[#334155] tabular-nums mt-0.5">{fmt(t.rentAmount)}</p>
              </div>
              {/* Rent Type */}
              <div className="py-2.5 border-b border-[#E2E8F0]">
                <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Rent Type</p>
                <span className={`inline-flex items-center mt-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                  snap.isExtra
                    ? 'bg-violet-50 text-violet-600 border border-violet-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}>
                  {rentLabel}
                </span>
              </div>
              {/* Override indicator */}
              {snap.overrideApplied && (
                <div className="py-2.5 border-b border-[#E2E8F0]">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Override</p>
                  <p className="text-xs text-amber-600 font-medium mt-0.5">
                    ⚡ {snap.overrideSource === 'bed' ? 'Bed-level override' : 'Manual override'} applied
                  </p>
                </div>
              )}
              {/* Assigned At */}
              {snap.assignedAt && (
                <div className={snap.traceId ? 'py-2.5 border-b border-[#E2E8F0]' : 'py-2.5'}>
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Assigned At</p>
                  <p className="text-sm font-medium text-[#334155] mt-0.5">{fdate(snap.assignedAt)}</p>
                </div>
              )}
              {/* Trace ID (for support) */}
              {snap.traceId && (
                <div className="py-2.5">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Reference ID</p>
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5 select-all">{snap.traceId}</p>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── G. Timeline ── */}
        <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#60C3AD]/10">
              <Clock size={13} className="text-[#60C3AD]" />
            </div>
            <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Timeline</h4>
          </div>
          <div className="mt-1">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Milestones</p>
            {activityItems.length === 0 ? (
              <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] py-6 text-center">
                <div className="flex justify-center mb-2">
                  <div className="h-8 w-8 rounded-full bg-slate-100 flex items-center justify-center">
                    <Clock size={15} className="text-slate-300" />
                  </div>
                </div>
                <p className="text-sm text-slate-400 font-medium">No milestones yet</p>
              </div>
            ) : (
              <div className="rounded-xl border border-[#E2E8F0] overflow-hidden divide-y divide-[#E2E8F0]">
                {activityItems.map((item) => {
                  const isVacated = item.type === 'VACATED'
                  return (
                    <div key={item.id} className="flex items-center gap-3 px-4 py-3">
                      <div className={`shrink-0 flex h-7 w-7 items-center justify-center rounded-full ${
                        isVacated ? 'bg-red-50 border border-red-200' : 'bg-[#60C3AD]/10 border border-[#60C3AD]/20'
                      }`}>
                        {isVacated
                          ? <UserX size={13} className="text-red-500" />
                          : <Home size={13} className="text-[#60C3AD]" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-[#334155]">
                          {isVacated ? 'Tenant vacated' : 'Tenant assigned'}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate mt-0.5">{item.note}</p>
                      </div>
                      <div className="text-right shrink-0">
                        {item.amount !== null && (
                          <p className="text-sm font-bold tabular-nums text-[#334155]">{fmt(item.amount)}</p>
                        )}
                        <p className="text-[10px] text-slate-400 tabular-nums mt-0.5">{fdate(item.date)}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            <button type="button" onClick={() => setActiveTab('ledger')}
              className="mt-2 w-full flex items-center justify-center gap-1 text-[11px] font-semibold text-[#60C3AD] hover:underline py-1">
              View full transaction history <ChevronRight size={11} />
            </button>
          </div>
        </div>

        {/* ── H. Invoices — hidden in MVP ── */}
        {false && <div className="rounded-2xl border border-[#E2E8F0] bg-white p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-[#60C3AD]/10">
                <FileText size={13} className="text-[#60C3AD]" />
              </div>
              <h4 className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Invoices</h4>
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
                className="text-[11px] font-semibold flex items-center gap-1"
                style={{ color: '#60C3AD' }}
              >
                {invoicesOpen ? 'Hide' : 'Show'}
                <span className={`text-[10px] transition-transform duration-200 inline-block ${invoicesOpen ? 'rotate-180' : ''}`}>▼</span>
              </button>
            )}
          </div>

          {invoicesLoading ? (
            <div className="flex justify-center py-4">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-[#E2E8F0] border-t-[#60C3AD]" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="py-4 text-center">
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
                  <div key={inv._id} className="flex items-center justify-between rounded-xl border border-[#E2E8F0] bg-white px-4 py-3 hover:border-[#60C3AD]/40 transition-colors">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-mono font-semibold" style={{ color: '#60C3AD' }}>{inv.invoiceNumber}</p>
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
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-[#60C3AD]/10 hover:text-[#60C3AD] transition-colors"
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
            <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="text-emerald-600 font-semibold">{invoices.filter(i => i.status === 'paid').length} paid</span>
                <span className="text-amber-600 font-semibold">{invoices.filter(i => i.status === 'partial').length} partial</span>
                <span className="text-red-600 font-semibold">{invoices.filter(i => i.status === 'unpaid').length} unpaid</span>
              </div>
              <p className="text-xs font-bold text-[#334155] tabular-nums">
                {fmt(invoices.reduce((s, i) => s + i.totalAmount, 0))} total
              </p>
            </div>
          )}
        </div>}

        </>}

        {/* ── LEDGER TAB ── */}
        {activeTab === 'ledger' && (
          <div className="flex flex-col">

            {/* ── Financial Summary ── */}
            {(() => {
              const payEntries    = ledgerEntries.filter(e => ['payment_received','payment'].includes(e.referenceType))
              const rentEntries   = ledgerEntries.filter(e => ['rent_generated','rent_record'].includes(e.referenceType))
              const chargeEntries = ledgerEntries.filter(e => e.referenceType === 'adjustment')

              const totalRent    = rents.length > 0 ? rents.reduce((s, r) => s + (r.amount ?? 0), 0) : rentEntries.reduce((s, e) => s + (e.amount ?? 0), 0)
              const totalCharges = chargeEntries.reduce((s, e) => s + (e.amount ?? 0), 0)
              const totalBilled  = totalRent + totalCharges

              // Separate cash payments from deposit payments
              const byCash    = payEntries.filter(e => e.method === 'cash').reduce((s, e) => s + (e.amount ?? 0), 0)
              const byUPI     = payEntries.filter(e => e.method === 'upi').reduce((s, e) => s + (e.amount ?? 0), 0)
              const byBank    = payEntries.filter(e => e.method === 'bank_transfer').reduce((s, e) => s + (e.amount ?? 0), 0)
              const byCheque  = payEntries.filter(e => e.method === 'cheque').reduce((s, e) => s + (e.amount ?? 0), 0)
              const byDeposit = payEntries.filter(e => e.method === 'deposit_adjustment').reduce((s, e) => s + (e.amount ?? 0), 0)
              const cashReceived = byCash + byUPI + byBank + byCheque   // actual cash — excludes deposit
              const totalCleared = cashReceived + byDeposit              // everything that cleared dues

              const depositOriginal  = t.depositAmount ?? 0
              const depositCollected = t.depositPaid === true
              // When not collected, nothing is held — remaining and used must both be 0.
              // NOTE: depositBalance defaults to 0 in the schema (not null), so we cannot
              // use `?? depositOriginal` here — that would only fire for null/undefined.
              // Gate everything on depositCollected to avoid the impossible "Used ₹X but
              // deposit was never collected" state.
              const depositRemaining = depositCollected ? (t.depositBalance ?? depositOriginal) : 0
              const depositUsed      = depositCollected
                ? (byDeposit > 0 ? byDeposit : Math.max(0, depositOriginal - depositRemaining))
                : 0

              const bal       = tabLedgerBalance ?? 0
              const isPending = bal > 0
              const isCredit  = bal < 0
              const isSettled = bal === 0

              // Build smart settlement message
              const settlementMsg = (() => {
                if (isPending && depositUsed > 0) {
                  // Deposit was used but still has remaining dues
                  return `₹${bal.toLocaleString('en-IN')} still due after deposit usage`
                }
                if (isPending) {
                  const parts = []
                  if (ledgerRentDue    > 0) parts.push(`₹${ledgerRentDue.toLocaleString('en-IN')} rent`)
                  if (ledgerChargesDue > 0) parts.push(`₹${ledgerChargesDue.toLocaleString('en-IN')} charges`)
                  const breakdown = parts.length > 0 ? ` (${parts.join(' + ')})` : ''
                  return `₹${bal.toLocaleString('en-IN')} pending${breakdown}`
                }
                if (isCredit) return `₹${Math.abs(bal).toLocaleString('en-IN')} advance available — will apply to next bill`
                const parts = []
                if (cashReceived > 0) parts.push(`₹${cashReceived.toLocaleString('en-IN')} cash`)
                if (depositUsed  > 0) parts.push(`₹${depositUsed.toLocaleString('en-IN')} deposit`)
                if (parts.length === 0) return 'Account is up to date'
                return `All dues cleared using ${parts.join(' and ')}`
              })()

              return (
                <div className="px-5 pt-4 pb-4 border-b border-slate-200 bg-white shrink-0 space-y-3">

                  {/* ── Status Banner ── */}
                  <div className={`rounded-2xl px-4 py-3 ${
                    isPending ? 'bg-red-50 border border-red-200' : 'bg-emerald-50 border border-emerald-200'
                  }`}>
                    <div className="flex items-start gap-3">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${isPending ? 'bg-red-100' : 'bg-emerald-100'}`}>
                        {isPending
                          ? <AlertCircle size={15} className="text-red-500" />
                          : <CheckCircle size={15} className="text-emerald-500" />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-bold ${isPending ? 'text-red-700' : 'text-emerald-700'}`}>
                          {isPending
                            ? (() => {
                                const typeLabel = ledgerRentDue > 0 && ledgerChargesDue > 0
                                  ? 'rent + charges'
                                  : ledgerChargesDue > 0 ? 'charges pending'
                                  : ledgerRentDue   > 0 ? 'rent pending'
                                  : 'pending'
                                return `₹${bal.toLocaleString('en-IN')} due (${typeLabel})`
                              })()
                            : isCredit
                              ? `₹${Math.abs(bal).toLocaleString('en-IN')} Advance Credit`
                              : 'All Dues Settled'}
                        </p>
                        <p className={`text-[10px] mt-0.5 leading-relaxed ${isPending ? 'text-red-400' : 'text-emerald-600'}`}>
                          {isPending
                            ? (t.depositPaid && (t.depositBalance ?? 0) > 0
                                ? 'Use deposit or collect payment'
                                : 'Collect payment to clear dues')
                            : settlementMsg}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full ${
                        isPending ? 'bg-red-100 text-red-600' : isCredit ? 'bg-emerald-100 text-emerald-700' : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        {isPending ? 'PENDING' : isCredit ? 'CREDIT' : 'SETTLED'}
                      </span>
                    </div>

                    {/* Req #3: deposit suggestion */}
                    {isPending && t.depositPaid && depositRemaining > 0 && t.depositStatus !== 'adjusted' && (
                      <div className="mt-2.5 pt-2.5 border-t border-red-200 flex items-center gap-2">
                        <Shield size={11} className="text-teal-500 shrink-0" />
                        <p className="text-[10px] text-teal-700 font-medium">
                          {fmt(depositRemaining)} deposit available — can be used to clear dues
                        </p>
                      </div>
                    )}
                  </div>

                  {/* ── Four-card breakdown ── */}
                  <div className="grid grid-cols-2 gap-2.5">

                    {/* 1 — Total Due */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Total Due</p>
                      <p className="text-base font-extrabold tabular-nums text-slate-700">{fmt(totalBilled)}</p>
                      <div className="mt-2 pt-2 border-t border-slate-200 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-slate-400">Rent</span>
                          <span className="text-[10px] font-semibold text-slate-600 tabular-nums">{fmt(totalRent)}</span>
                        </div>
                        {totalCharges > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-amber-500">+ Charges</span>
                            <span className="text-[10px] font-semibold text-amber-600 tabular-nums">{fmt(totalCharges)}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-1 border-t border-slate-200 mt-1">
                          <span className="text-[10px] font-bold text-slate-500">Total</span>
                          <span className="text-[10px] font-bold text-slate-700 tabular-nums">{fmt(totalBilled)}</span>
                        </div>
                      </div>
                    </div>

                    {/* 2 — Cash Payments */}
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 px-3.5 py-3">
                      <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500 mb-1">Cash Payments</p>
                      <p className="text-base font-extrabold tabular-nums text-emerald-700">{cashReceived > 0 ? fmt(cashReceived) : '—'}</p>
                      <div className="mt-2 pt-2 border-t border-emerald-100 space-y-1">
                        {byCash   > 0 && <div className="flex justify-between"><span className="text-[10px] text-slate-400">Cash</span><span className="text-[10px] font-semibold text-slate-600 tabular-nums">{fmt(byCash)}</span></div>}
                        {byUPI    > 0 && <div className="flex justify-between"><span className="text-[10px] text-slate-400">UPI</span><span className="text-[10px] font-semibold text-slate-600 tabular-nums">{fmt(byUPI)}</span></div>}
                        {byBank   > 0 && <div className="flex justify-between"><span className="text-[10px] text-slate-400">Bank Transfer</span><span className="text-[10px] font-semibold text-slate-600 tabular-nums">{fmt(byBank)}</span></div>}
                        {byCheque > 0 && <div className="flex justify-between"><span className="text-[10px] text-slate-400">Cheque</span><span className="text-[10px] font-semibold text-slate-600 tabular-nums">{fmt(byCheque)}</span></div>}
                        {cashReceived === 0 && <span className="text-[10px] text-slate-400 italic">No cash payments yet</span>}
                      </div>
                    </div>

                    {/* 3 — Deposit */}
                    {depositCollected ? (
                      /* Collected: show original / used / available breakdown */
                      <div className={`rounded-xl border px-3.5 py-3 ${
                        depositUsed > 0 ? 'border-violet-200 bg-violet-50/40' : 'border-slate-200 bg-slate-50'
                      }`}>
                        <p className={`text-[9px] font-bold uppercase tracking-widest mb-1 ${depositUsed > 0 ? 'text-violet-500' : 'text-slate-400'}`}>
                          Deposit Used
                        </p>
                        <p className={`text-base font-extrabold tabular-nums ${depositUsed > 0 ? 'text-violet-700' : 'text-slate-400'}`}>
                          {depositUsed > 0 ? fmt(depositUsed) : '—'}
                        </p>
                        <div className="mt-2 pt-2 border-t border-violet-100/60 space-y-1">
                          <div className="flex justify-between">
                            <span className="text-[10px] text-slate-400">Original</span>
                            <span className="text-[10px] font-semibold text-slate-600 tabular-nums">{depositOriginal > 0 ? fmt(depositOriginal) : '—'}</span>
                          </div>
                          {depositUsed > 0 && (
                            <div className="flex justify-between">
                              <span className="text-[10px] text-violet-400">Used</span>
                              <span className="text-[10px] font-semibold text-violet-600 tabular-nums">− {fmt(depositUsed)}</span>
                            </div>
                          )}
                          <div className="flex justify-between pt-1 border-t border-violet-100/60 mt-1">
                            <span className="text-[10px] font-bold text-slate-500">Available</span>
                            <span className={`text-[10px] font-bold tabular-nums ${depositRemaining > 0 ? 'text-violet-700' : 'text-slate-400'}`}>
                              {fmt(depositRemaining)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : depositOriginal > 0 ? (
                      /* Not collected: show flat "not collected" card — no used/available */
                      <div className="rounded-xl border border-amber-200 bg-amber-50/40 px-3.5 py-3">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-amber-500 mb-1">Security Deposit</p>
                        <p className="text-base font-extrabold tabular-nums text-amber-700">{fmt(depositOriginal)}</p>
                        <p className="text-[10px] text-amber-600 font-medium mt-1.5">Not collected yet</p>
                      </div>
                    ) : (
                      /* No deposit on file */
                      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-1">Security Deposit</p>
                        <p className="text-base font-extrabold tabular-nums text-slate-400">—</p>
                      </div>
                    )}

                    {/* 4 — Final Balance */}
                    <div className={`rounded-xl border px-3.5 py-3 ${
                      isPending ? 'border-red-200 bg-red-50/40' : 'border-emerald-200 bg-emerald-50/40'
                    }`}>
                      <p className={`text-[9px] font-bold uppercase tracking-widest mb-1 ${isPending ? 'text-red-400' : 'text-emerald-500'}`}>
                        Final Balance
                      </p>
                      <p className={`text-base font-extrabold tabular-nums ${isPending ? 'text-red-700' : 'text-emerald-700'}`}>
                        {isSettled ? 'Settled' : isPending ? fmt(bal) : `+${fmt(Math.abs(bal))}`}
                      </p>
                      <div className={`mt-2 pt-2 border-t space-y-1 ${isPending ? 'border-red-100' : 'border-emerald-100/60'}`}>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-slate-400">Total Due</span>
                          <span className="text-[10px] font-semibold text-slate-600 tabular-nums">{fmt(totalBilled)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-[10px] text-slate-400">Total Cleared</span>
                          <span className="text-[10px] font-semibold text-emerald-600 tabular-nums">{fmt(totalCleared)}</span>
                        </div>
                        {/* Req #4: rent + charges pending breakdown */}
                        {isPending && ledgerRentDue > 0 && (
                          <div className="flex justify-between">
                            <span className="text-[10px] text-red-400">Rent pending</span>
                            <span className="text-[10px] font-semibold text-red-600 tabular-nums">{fmt(ledgerRentDue)}</span>
                          </div>
                        )}
                        {isPending && ledgerChargesDue > 0 && (
                          <div className="flex justify-between">
                            <span className="text-[10px] text-orange-400">Charges pending</span>
                            <span className="text-[10px] font-semibold text-orange-600 tabular-nums">{fmt(ledgerChargesDue)}</span>
                          </div>
                        )}
                        <div className={`flex justify-between pt-1 border-t mt-1 ${isPending ? 'border-red-100' : 'border-emerald-100'}`}>
                          <span className={`text-[10px] font-bold ${isPending ? 'text-red-500' : 'text-emerald-600'}`}>
                            {isPending ? 'Remaining' : isCredit ? 'Credit' : 'Balance'}
                          </span>
                          <span className={`text-[10px] font-bold tabular-nums ${isPending ? 'text-red-600' : 'text-emerald-700'}`}>
                            {isSettled ? '₹0' : isPending ? fmt(bal) : `+${fmt(Math.abs(bal))}`}
                          </span>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              )
            })()}

            {/* Quick Actions */}
            <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-2 shrink-0 flex-wrap">
              {t.status !== 'vacated' && t.status !== 'incomplete' && (
                <>
                  {/* Req #5: Primary — Collect Payment */}
                  <button type="button" onClick={() => { setPayAmt(''); setPayNotes(''); setPayRef(''); setPayMethod(filteredPaymentMethods[0]?.[0] ?? 'cash'); setPayModal(true) }}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white transition-colors shadow-sm">
                    <CreditCard size={12} />
                    {hasDues ? `Collect ₹${(bal ?? 0).toLocaleString('en-IN')}` : 'Record Payment'}
                  </button>
                  {/* Req #5: Secondary — Use Deposit (only when dues + deposit available) */}
                  {hasDues && t.depositPaid && (t.depositBalance ?? 0) > 0 && t.depositStatus !== 'adjusted' && (
                    <button type="button" disabled={depositActing}
                      onClick={handleDepositAdjust}
                      className="flex items-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 px-3.5 py-2 text-xs font-bold text-violet-700 transition-colors shadow-sm disabled:opacity-50">
                      <Shield size={12} /> Use Deposit
                    </button>
                  )}
                  {/* Req #5: Tertiary — Add Charge */}
                  <button type="button" onClick={() => { setChargeAmt(''); setChargeDesc(''); setChargeModal(true) }}
                    className="flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 px-3.5 py-2 text-xs font-bold text-slate-600 transition-colors shadow-sm">
                    <Zap size={12} /> Add Charge
                  </button>
                </>
              )}
              <div className="ml-auto flex items-center gap-1.5">
                {/* View toggle */}
                <div className="flex items-center rounded-lg border border-slate-200 bg-white overflow-hidden">
                  <button type="button" onClick={() => setLedgerView('timeline')}
                    title="Timeline view"
                    className={`px-2.5 py-1.5 text-[10px] font-bold transition-colors ${ledgerView === 'timeline' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                    Timeline
                  </button>
                  <button type="button" onClick={() => setLedgerView('category')}
                    title="Category view"
                    className={`px-2.5 py-1.5 text-[10px] font-bold transition-colors border-l border-slate-200 ${ledgerView === 'category' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                    Category
                  </button>
                </div>
                <button type="button"
                  onClick={() => {
                    setSortFlash(true)
                    setSortDesc(d => !d)
                    if (ledgerView === 'timeline') setVisibleCount(20)
                    setTimeout(() => setSortFlash(false), 200)
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-2.5 py-1.5 text-[10px] font-semibold text-slate-500 transition-colors whitespace-nowrap">
                  {sortDesc ? 'Sorted by: Newest first' : 'Sorted by: Oldest first'}
                  <ChevronDown size={10} className={`transition-transform duration-200 ${sortDesc ? 'rotate-180' : ''}`} />
                </button>
                <button type="button"
                  onClick={() => downloadLedgerCSV(ledgerEntries, t.name)}
                  title="Download CSV"
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 p-2 text-slate-500 transition-colors">
                  <Download size={13} />
                </button>
                <button type="button"
                  onClick={() => exportLedgerXlsx({ entries: ledgerEntries, tenant: t, currentBalance: tabLedgerBalance ?? 0 })}
                  title="Download Excel (.xlsx)"
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 p-2 text-slate-500 transition-colors">
                  <FileSpreadsheet size={13} />
                </button>
                <button type="button"
                  onClick={() => printLedgerPDF(ledgerEntries, t, tabLedgerBalance ?? 0, t.depositBalance ?? t.depositAmount ?? 0)}
                  title="Print / PDF"
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 p-2 text-slate-500 transition-colors">
                  <Printer size={13} />
                </button>
                <button type="button" onClick={() => fetchLedger(ledgerPage)} title="Refresh"
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 p-2 text-slate-500 transition-colors">
                  <RefreshCw size={13} className={ledgerLoading ? 'animate-spin' : ''} />
                </button>
              </div>
            </div>

            {/* Smart action hint */}
            {hasDues && t.status !== 'vacated' && (
              <div className="px-5 pb-2 shrink-0">
                <p className="text-[10px] text-slate-400">
                  {t.depositPaid && (t.depositBalance ?? 0) >= (bal ?? 0)
                    ? `Recommended: Use ₹${(bal ?? 0).toLocaleString('en-IN')} from deposit to clear dues`
                    : t.depositPaid && (t.depositBalance ?? 0) > 0
                      ? `Recommended: Use deposit (₹${(t.depositBalance ?? 0).toLocaleString('en-IN')}) + collect ₹${Math.max(0, (bal ?? 0) - (t.depositBalance ?? 0)).toLocaleString('en-IN')}`
                      : `Recommended: Collect payment of ₹${(bal ?? 0).toLocaleString('en-IN')} to clear dues`
                  }
                </p>
              </div>
            )}

            {/* Filters */}
            <div className="px-5 py-2.5 border-b border-slate-100 shrink-0">
              {/* Search row — always visible */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input type="text" className="input text-xs py-1.5 pl-8"
                    placeholder="Search notes or reference…"
                    value={searchDraft} onChange={e => setSearchDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        setLedgerSearch(searchDraft)
                        setLedgerPage(1)
                        fetchLedger(1, ledgerFrom, ledgerTo, ledgerType, searchDraft)
                      }
                    }}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setLedgerFiltersOpen(o => !o)}
                  className={`relative flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    ledgerFiltersOpen || ledgerFrom || ledgerTo || ledgerType
                      ? 'border-[#60C3AD]/40 bg-[#60C3AD]/10 text-[#60C3AD]'
                      : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                  }`}
                >
                  <Filter size={11} />
                  Filters
                  {(ledgerFrom || ledgerTo || ledgerType) && (
                    <span className="h-1.5 w-1.5 rounded-full bg-[#60C3AD] absolute -top-0.5 -right-0.5" />
                  )}
                </button>
                {(ledgerFrom || ledgerTo || ledgerType || searchDraft) && (
                  <button type="button" onClick={handleLedgerReset}
                    className="rounded-xl border border-slate-200 bg-white hover:bg-slate-50 p-1.5 text-slate-400 transition-colors">
                    <X size={11} />
                  </button>
                )}
              </div>
              {/* Collapsible: date range + type + apply */}
              {ledgerFiltersOpen && (
                <div className="mt-2 space-y-2">
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
                    <button type="button"
                      onClick={() => { handleLedgerFilter(); setLedgerFiltersOpen(false) }}
                      className="rounded-xl bg-[#60C3AD] hover:bg-[#4fa898] px-3 py-1.5 text-xs font-bold text-white transition-colors">
                      Apply
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Ledger table */}
            <div className="overflow-x-auto">
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
              ) : ledgerView === 'category' ? (
                // ── CATEGORY VIEW ──
                (() => {
                  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

                  const rentEs     = ledgerEntries.filter(e => ['rent_generated','rent_record'].includes(e.referenceType))
                  const chargesEs  = ledgerEntries.filter(e => e.referenceType === 'adjustment')
                  const paymentsEs = ledgerEntries.filter(e => ['payment_received','payment'].includes(e.referenceType))

                  const rentTotal     = rentEs.reduce((s, e)     => s + (e.amount ?? 0), 0)
                  const chargesTotal  = chargesEs.reduce((s, e)  => s + (e.amount ?? 0), 0)
                  const paymentsTotal = paymentsEs.reduce((s, e) => s + (e.amount ?? 0), 0)
                  const totalBilled   = rentTotal + chargesTotal
                  const remaining     = tabLedgerBalance ?? 0

                  // Deposit info (from tenant object, not ledger entries)
                  const depOriginal  = t.depositAmount  ?? 0
                  const depRemaining = t.depositBalance ?? depOriginal
                  const depUsed      = depOriginal - depRemaining

                  const fmtCatDate  = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                  const sortEntries = (arr) => [...arr].sort((a, b) => sortDesc
                    ? new Date(b.createdAt) - new Date(a.createdAt)
                    : new Date(a.createdAt) - new Date(b.createdAt))
                  const latestId = (arr) => arr.length === 0 ? null
                    : arr.reduce((best, e) => new Date(e.createdAt) > new Date(best.createdAt) ? e : best)._id
                  const globalLatestId = latestId([...rentEs, ...chargesEs, ...paymentsEs])
                  const groupByDate = (arr) => {
                    const groups = []
                    let cur = null
                    for (const e of arr) {
                      const d = fmtCatDate(e.createdAt)
                      if (d !== cur) { cur = d; groups.push({ date: d, items: [] }) }
                      groups[groups.length - 1].items.push(e)
                    }
                    return groups
                  }

                  // Collapsible section header: "TITLE (₹X)" with item count + chevron
                  const SectionHeader = ({ id, title, count, total, totalColor, bg }) => (
                    <button
                      type="button"
                      onClick={() => setCatCollapsed(prev => ({ ...prev, [id]: !prev[id] }))}
                      className={`w-full flex items-center justify-between px-5 py-3 border-b border-slate-200 ${bg} hover:brightness-[0.98] transition-all`}
                    >
                      <div className="flex items-center gap-2">
                        <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-700">{title}</p>
                        {total > 0 && (
                          <span className={`text-[10px] font-bold tabular-nums ${totalColor}`}>({fmt(total)})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-400">{count} {count === 1 ? 'item' : 'items'}</span>
                        {catCollapsed[id]
                          ? <ChevronDown size={12} className="text-slate-400 shrink-0" />
                          : <ChevronUp   size={12} className="text-slate-400 shrink-0" />
                        }
                      </div>
                    </button>
                  )

                  // Summary subtext: what makes up the remaining balance
                  const remainingSubtext = (() => {
                    if (remaining <= 0) return null
                    const parts = [
                      ledgerRentDue    > 0 && `₹${ledgerRentDue.toLocaleString('en-IN')} rent`,
                      ledgerChargesDue > 0 && `₹${ledgerChargesDue.toLocaleString('en-IN')} charges`,
                    ].filter(Boolean)
                    if (parts.length === 0) return null
                    return `Remaining ${fmt(remaining)} is from ${parts.join(' + ')}`
                  })()

                  return (
                    <div className={`transition-opacity duration-200 ${sortFlash ? 'opacity-0' : 'opacity-100'}`}>

                      {/* ── Sticky summary bar ── */}
                      <div className="sticky top-9 z-10 px-5 py-3 bg-slate-50/95 backdrop-blur-sm border-b border-slate-200">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-semibold text-slate-500 tabular-nums">{fmt(totalBilled)} billed</span>
                          <span className="text-[10px] text-slate-300">•</span>
                          <span className="text-[11px] font-semibold text-emerald-600 tabular-nums">{fmt(paymentsTotal)} paid</span>
                          <span className="text-[10px] text-slate-300">•</span>
                          <span className={`text-[12px] font-extrabold tabular-nums ${remaining > 0 ? 'text-red-600' : remaining < 0 ? 'text-emerald-600' : 'text-slate-500'}`}>
                            {remaining > 0 ? `${fmt(remaining)} remaining` : remaining < 0 ? `${fmt(Math.abs(remaining))} advance` : 'Settled ✓'}
                          </span>
                        </div>
                        {remainingSubtext && (
                          <p className="text-[10px] text-red-400 mt-1 font-medium">{remainingSubtext}</p>
                        )}
                        {/* Quick nav */}
                        <div className="flex items-center gap-1.5 mt-2">
                          <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mr-0.5">Jump:</span>
                          {[
                            { label: 'Rent',     ref: catRentRef,     count: rentEs.length     },
                            { label: 'Charges',  ref: catChargesRef,  count: chargesEs.length  },
                            { label: 'Payments', ref: catPaymentsRef, count: paymentsEs.length },
                          ].map(({ label, ref, count }) => (
                            <button key={label} type="button"
                              onClick={() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-500 transition-colors">
                              {label}
                              <span className="text-[8px] text-slate-400">({count})</span>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* ── 1. RENT ── */}
                      <div ref={catRentRef} className="border-b border-slate-200">
                        <SectionHeader id="rent" title="Rent" count={rentEs.length} total={rentTotal} totalColor="text-red-500" bg="bg-slate-50" />
                        {!catCollapsed.rent && (
                          rentEs.length === 0
                            ? <p className="px-5 py-4 text-[11px] text-slate-400 italic">No rent billed yet</p>
                            : (() => {
                                const groups = groupByDate(sortEntries(rentEs))
                                const multi  = groups.length > 1
                                return groups.map(({ date, items }) => (
                                  <div key={date}>
                                    {multi && (
                                      <div className="px-5 py-1 bg-slate-100/60 border-b border-slate-100 sticky top-9">
                                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{date}</p>
                                      </div>
                                    )}
                                    {items.map(e => (
                                      <div key={e._id} className={`flex items-center justify-between px-5 py-3 border-b border-slate-100 transition-colors ${e._id === globalLatestId ? 'bg-red-50/40 hover:bg-red-50/60' : 'hover:bg-slate-50'}`}>
                                        <div className="min-w-0 flex-1 pr-3">
                                          <div className="flex items-center gap-1.5">
                                            <p className="text-[11px] font-semibold text-slate-700 truncate">{e.description ?? '—'}</p>
                                            {e._id === globalLatestId && <span className="shrink-0 rounded-md bg-red-100 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wide text-red-500">Latest</span>}
                                          </div>
                                          <p className="text-[10px] text-slate-400 mt-0.5">{fmtCatDate(e.createdAt)}</p>
                                        </div>
                                        <span className="text-[12px] font-bold tabular-nums text-red-500">
                                          −₹{(e.amount ?? 0).toLocaleString('en-IN')}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ))
                              })()
                        )}
                      </div>

                      {/* ── 2. CHARGES ── */}
                      <div ref={catChargesRef} className="border-b border-slate-200">
                        <SectionHeader id="charges" title="Charges" count={chargesEs.length} total={chargesTotal} totalColor="text-red-500" bg="bg-amber-50/40" />
                        {!catCollapsed.charges && (
                          chargesEs.length === 0
                            ? <p className="px-5 py-4 text-[11px] text-slate-400 italic">No extra charges</p>
                            : (() => {
                                const groups = groupByDate(sortEntries(chargesEs))
                                const multi  = groups.length > 1
                                return groups.map(({ date, items }) => (
                                  <div key={date}>
                                    {multi && (
                                      <div className="px-5 py-1 bg-amber-50/60 border-b border-amber-100 sticky top-9">
                                        <p className="text-[9px] font-bold text-amber-400 uppercase tracking-widest">{date}</p>
                                      </div>
                                    )}
                                    {items.map(e => (
                                      <div key={e._id} className={`flex items-center justify-between px-5 py-3 border-b border-slate-100 transition-colors ${e._id === globalLatestId ? 'bg-amber-50/50 hover:bg-amber-50/80' : 'hover:bg-amber-50/20'}`}>
                                        <div className="min-w-0 flex-1 pr-3">
                                          <div className="flex items-center gap-1.5">
                                            <p className="text-[11px] font-semibold text-slate-700 truncate">{e.description ?? '—'}</p>
                                            {e._id === globalLatestId && <span className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wide text-amber-600">Latest</span>}
                                          </div>
                                          <p className="text-[10px] text-slate-400 mt-0.5">{fmtCatDate(e.createdAt)}</p>
                                        </div>
                                        <span className="text-[12px] font-bold tabular-nums text-red-500">
                                          −₹{(e.amount ?? 0).toLocaleString('en-IN')}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                ))
                              })()
                        )}
                      </div>

                      {/* ── 3. PAYMENTS (cash + deposit adjustments) ── */}
                      <div ref={catPaymentsRef} className="border-b border-slate-200">
                        <SectionHeader id="payments" title="Payments" count={paymentsEs.length} total={paymentsTotal} totalColor="text-emerald-600" bg="bg-emerald-50/40" />
                        {!catCollapsed.payments && (
                          paymentsEs.length === 0
                            ? <p className="px-5 py-4 text-[11px] text-slate-400 italic">No payments recorded</p>
                            : (() => {
                                const renderPaymentRow = (e, latestPaymentId) => {
                                  const isDepAdj  = e.method === 'deposit_adjustment'
                                  const isLatest  = e._id === latestPaymentId
                                  const primaryLabel = isDepAdj
                                    ? `Deposit Used ₹${(e.amount ?? 0).toLocaleString('en-IN')}`
                                    : (() => {
                                        const m = e.method === 'bank_transfer' ? 'Bank Transfer'
                                          : e.method === 'upi' ? 'UPI'
                                          : e.method ? e.method.replace(/\b\w/g, c => c.toUpperCase())
                                          : null
                                        return m ? `${m} · ₹${(e.amount ?? 0).toLocaleString('en-IN')}` : (e.description ?? '—')
                                      })()
                                  const alloc    = e.allocation
                                  const hasAlloc = alloc && (alloc.appliedTo?.length > 0 || alloc.chargeAllocations?.length > 0 || alloc.advanceApplied > 0)
                                  return (
                                    <div key={e._id} className={`border-b border-slate-100 ${isDepAdj ? 'bg-violet-50/20' : ''} ${isLatest && !isDepAdj ? 'bg-emerald-50/30' : ''}`}>
                                      <div className={`flex items-start justify-between px-5 py-3 transition-colors ${isDepAdj ? 'hover:bg-violet-50/40' : isLatest ? 'hover:bg-emerald-50/50' : 'hover:bg-emerald-50/20'}`}>
                                        <div className="min-w-0 flex-1 pr-3">
                                          <div className="flex items-center gap-1.5">
                                            <p className={`text-[11px] font-semibold ${isDepAdj ? 'text-violet-700' : 'text-slate-700'}`}>
                                              {primaryLabel}
                                            </p>
                                            {isLatest && <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-extrabold uppercase tracking-wide ${isDepAdj ? 'bg-violet-100 text-violet-500' : 'bg-emerald-100 text-emerald-600'}`}>Latest</span>}
                                          </div>
                                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                            <span className="text-[10px] text-slate-400">{fmtCatDate(e.createdAt)}</span>
                                            {isDepAdj && (
                                              <span className="text-[10px] text-violet-400">(from security deposit)</span>
                                            )}
                                          </div>
                                          {!isDepAdj && hasAlloc && (
                                            <div className="mt-1.5 pl-2 border-l-2 border-slate-200 space-y-0.5">
                                              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">Applied to</p>
                                              {alloc.appliedTo?.map((a, i) => (
                                                <p key={i} className="text-[10px] text-slate-500">
                                                  • Rent ({MONTHS[(a.month ?? 1) - 1]} {a.year}): ₹{(a.amount ?? 0).toLocaleString('en-IN')}
                                                </p>
                                              ))}
                                              {alloc.chargeAllocations?.map((c, i) => (
                                                <p key={i} className="text-[10px] text-amber-600">
                                                  • Charge ({c.chargeRecord?.description ?? 'Extra charge'}): ₹{(c.amount ?? 0).toLocaleString('en-IN')}
                                                </p>
                                              ))}
                                              {alloc.advanceApplied > 0 && (
                                                <p className="text-[10px] text-violet-500">
                                                  • +₹{alloc.advanceApplied.toLocaleString('en-IN')} to advance balance
                                                </p>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                        <span className={`text-[12px] font-bold tabular-nums shrink-0 ${isDepAdj ? 'text-violet-600' : 'text-emerald-600'}`}>
                                          +₹{(e.amount ?? 0).toLocaleString('en-IN')}
                                        </span>
                                      </div>
                                    </div>
                                  )
                                }
                                const groups = groupByDate(sortEntries(paymentsEs))
                                const multi  = groups.length > 1
                                return groups.map(({ date, items }) => (
                                  <div key={date}>
                                    {multi && (
                                      <div className="px-5 py-1 bg-emerald-50/60 border-b border-emerald-100 sticky top-9">
                                        <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-widest">{date}</p>
                                      </div>
                                    )}
                                    {items.map(e => renderPaymentRow(e, globalLatestId))}
                                  </div>
                                ))
                              })()
                        )}
                      </div>

                      {/* ── 4. DEPOSIT INFO — visually separated, default collapsed ── */}
                      {depOriginal > 0 && (
                        <div className="mx-4 my-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/60 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setCatCollapsed(prev => ({ ...prev, deposit: !prev.deposit }))}
                            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-slate-100/60 transition-colors"
                          >
                            <div className="flex flex-col items-start gap-0.5">
                              <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-400">Deposit Account</p>
                              <p className="text-[9px] text-slate-400">Used to clear dues when applied</p>
                            </div>
                            {catCollapsed.deposit
                              ? <ChevronDown size={12} className="text-slate-400" />
                              : <ChevronUp   size={12} className="text-slate-400" />
                            }
                          </button>
                          {!catCollapsed.deposit && (
                            <div className="px-4 pb-3 pt-1 space-y-2 border-t border-dashed border-slate-200">
                              <div className="flex items-center justify-between">
                                <span className="text-[11px] text-slate-500">Original deposit</span>
                                <span className="text-[11px] font-bold text-slate-600 tabular-nums">{fmt(depOriginal)}</span>
                              </div>
                              {depUsed > 0 && (
                                <div className="flex items-center justify-between">
                                  <span className="text-[11px] text-violet-500">{fmt(depUsed)} used to clear dues</span>
                                  <span className="text-[11px] font-bold text-violet-600 tabular-nums">−{fmt(depUsed)}</span>
                                </div>
                              )}
                              <div className="flex items-center justify-between pt-1.5 border-t border-slate-200">
                                <span className="text-[11px] font-semibold text-slate-600">
                                  {t.depositPaid && depRemaining > 0 ? `${fmt(depRemaining)} for future use` : 'Available'}
                                </span>
                                <span className={`text-[11px] font-bold tabular-nums ${depRemaining > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                  {t.depositPaid ? fmt(depRemaining) : 'Not collected'}
                                </span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                    </div>
                  )
                })()
              ) : (
                <div className={`min-w-[360px] transition-opacity duration-200 ${sortFlash ? 'opacity-0' : 'opacity-100'}`}>
                  {/* Last action indicator */}
                  {ledgerEntries.length > 0 && (() => {
                    const latest = ledgerEntries[0]
                    const isDepPay = ['payment_received','payment'].includes(latest.referenceType) && latest.method === 'deposit_adjustment'
                    let actionLabel = ''
                    if (isDepPay) actionLabel = `Deposit used ₹${(latest.amount ?? 0).toLocaleString('en-IN')} for dues`
                    else if (['payment_received','payment'].includes(latest.referenceType)) actionLabel = `Payment of ₹${(latest.amount ?? 0).toLocaleString('en-IN')} recorded`
                    else if (latest.referenceType === 'adjustment') actionLabel = `Charge added: ${latest.description ?? '—'}`
                    else if (['rent_generated','rent_record'].includes(latest.referenceType)) actionLabel = `Rent billed ₹${(latest.amount ?? 0).toLocaleString('en-IN')}`
                    else actionLabel = latest.description ?? latest.referenceType?.replace(/_/g,' ')
                    return (
                      <div className="flex items-center gap-2 px-4 py-2 bg-slate-50/70 border-b border-slate-100">
                        <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Last action</span>
                        <span className="text-[10px] font-semibold text-slate-600">{actionLabel}</span>
                        <span className="text-[9px] text-slate-400 ml-auto">
                          {new Date(latest.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                      </div>
                    )
                  })()}
                  {/* Header row */}
                  <div className="sticky top-9 z-10 grid grid-cols-[1fr_68px_68px_60px] gap-0 bg-white/95 backdrop-blur-sm border-b border-slate-200 px-4 py-2">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Transaction</p>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 text-right">Type</p>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 text-right">Amount</p>
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 text-right">Balance</p>
                  </div>

                  {/* Entry rows with date grouping */}
                  {(() => {
                    const HIDE_TYPES = new Set(['deposit_adjusted', 'deposit_collected'])
                    const sorted = [...ledgerEntries].sort((a, b) => sortDesc
                      ? new Date(b.createdAt) - new Date(a.createdAt)
                      : new Date(a.createdAt) - new Date(b.createdAt)
                    )
                    const filtered = sorted.filter(e => !HIDE_TYPES.has(e.referenceType))
                    const hasMore  = filtered.length > visibleCount
                    const visible  = filtered.slice(0, visibleCount)
                    const rows = []
                    let lastDateKey = null

                    visible.forEach((entry, idx) => {

                      const dateKey = new Date(entry.createdAt).toDateString()
                      const isPayment = ['payment_received','payment'].includes(entry.referenceType)
                      const isDepositPay = isPayment && entry.method === 'deposit_adjustment'
                      const isDepositInfo = entry.referenceType === 'deposit_collected'
                      const isDebit = entry.type === 'debit'
                      const showNegative = isDebit || entry.referenceType === 'deposit_refunded' || entry.referenceType === 'refund'
                      // Deposit-adjustment payments get their own distinct badge
                      const badge = isDepositPay
                        ? { label: 'DEP·USED', cls: 'bg-violet-100 text-violet-700 border-violet-200' }
                        : LEDGER_BADGE[entry.referenceType] ?? { label: entry.referenceType?.replace(/_/g,' ').toUpperCase(), cls: 'bg-slate-100 text-slate-600 border-slate-200' }
                      const isLatest = sortDesc
                        ? (idx === 0 && ledgerPage === 1)
                        : (idx === visible.length - 1 && ledgerPage === ledgerPages && !hasMore)
                      const isExpanded = expandedEntry === entry._id
                      const bal = entry.balanceAfter ?? 0
                      const balLabel = bal === 0 ? 'Settled' : bal < 0 ? `+${Math.abs(bal).toLocaleString('en-IN')}` : bal.toLocaleString('en-IN')
                      const balClr = bal > 0 ? 'text-red-500' : bal < 0 ? 'text-emerald-600' : 'text-slate-400'

                      // Row left-border accent by type
                      let rowAccent = 'border-l-2 border-l-transparent'
                      if (isDepositPay)                               rowAccent = 'border-l-2 border-l-violet-400'
                      else if (entry.referenceType?.includes('rent')) rowAccent = 'border-l-2 border-l-slate-300'
                      else if (isDebit)                               rowAccent = 'border-l-2 border-l-amber-400'
                      else                                            rowAccent = 'border-l-2 border-l-emerald-400'

                      // For payment rows: show compact "UPI · ₹500 · 16 Apr" as the primary label
                      const entryDate = new Date(entry.createdAt)
                      const shortDate = entryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                      const methodName = entry.method === 'deposit_adjustment' ? 'Deposit Used'
                        : entry.method === 'bank_transfer' ? 'Bank Transfer'
                        : entry.method === 'upi' ? 'UPI'
                        : entry.method ? entry.method.replace(/\b\w/g, c => c.toUpperCase())
                        : null
                      const paymentLabel = isPayment && methodName
                        ? `${methodName} · ₹${(entry.amount ?? 0).toLocaleString('en-IN')} · ${shortDate}`
                        : null

                      const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                      const alloc = entry.allocation
                      const hasAlloc = alloc && (alloc.appliedTo?.length > 0 || alloc.chargeAllocations?.length > 0 || alloc.advanceApplied > 0)

                      // Context line: "→ what this entry is for" shown beneath description
                      const contextLine = (() => {
                        if (hasAlloc) {
                          const parts = []
                          if (alloc.appliedTo?.length > 0) parts.push(`Rent: ${MONTHS[(alloc.appliedTo[0].month ?? 1) - 1]} ${alloc.appliedTo[0].year}${alloc.appliedTo.length > 1 ? ` +${alloc.appliedTo.length - 1} more` : ''}`)
                          if (alloc.chargeAllocations?.length > 0) parts.push(`Charge: ${alloc.chargeAllocations[0].chargeRecord?.description ?? 'Extra charge'}`)
                          if (alloc.advanceApplied > 0) parts.push('Advance credit')
                          return parts.length > 0 ? `→ ${parts.join(', ')}` : null
                        }
                        if (entry.referenceType === 'adjustment') return `→ Charge: ${entry.description ?? 'Extra charge'}`
                        return null
                      })()

                      // Date separator
                      if (dateKey !== lastDateKey) {
                        lastDateKey = dateKey
                        const dateLabel = new Date(entry.createdAt).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: '2-digit' })
                        rows.push(
                          <div key={`date-${dateKey}`} className="flex items-center gap-3 px-4 py-1.5 bg-slate-50/80 border-b border-slate-100 sticky top-[69px] z-[5]">
                            <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 whitespace-nowrap">{dateLabel}</span>
                            <div className="flex-1 h-px bg-slate-200" />
                          </div>
                        )
                      }

                      rows.push(
                        <div key={entry._id} className={isDepositInfo ? 'opacity-60' : ''}>
                          <button type="button"
                            onClick={() => setExpandedEntry(isExpanded ? null : entry._id)}
                            className={`w-full grid grid-cols-[1fr_68px_68px_60px] gap-0 pl-3 pr-4 py-2.5 text-left border-b border-slate-100 transition-colors ${rowAccent} ${
                              isLatest      ? 'bg-emerald-50/40' :
                              isDepositInfo ? 'bg-violet-50/20 hover:bg-violet-50/40' :
                                              'hover:bg-slate-50/80'
                            } ${isExpanded ? '!bg-slate-50' : ''}`}>

                            {/* Description + sub-label + allocation pills */}
                            <div className="flex flex-col justify-center min-w-0 pr-2">
                              <span className={`text-[11px] font-semibold leading-snug truncate ${isDepositInfo ? 'text-slate-400' : 'text-slate-700'}`}>
                                {paymentLabel ?? entry.description ?? '—'}
                              </span>
                              {/* Show original description as sub-label for payments (already in paymentLabel), or date for deposit-info */}
                              {isDepositInfo && (
                                <span className="text-[10px] mt-0.5 text-violet-400">
                                  Security deposit · {shortDate}
                                </span>
                              )}
                              {hasAlloc && !isExpanded && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {alloc.appliedTo?.map((a, i) => (
                                    <span key={i} className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                                      Rent: {MONTHS[(a.month ?? 1) - 1]} {a.year} · ₹{(a.amount ?? 0).toLocaleString('en-IN')}
                                    </span>
                                  ))}
                                  {alloc.chargeAllocations?.map((c, i) => (
                                    <span key={i} className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                                      Charge: {c.chargeRecord?.description ?? 'Extra charge'} · ₹{(c.amount ?? 0).toLocaleString('en-IN')}
                                    </span>
                                  ))}
                                  {alloc.advanceApplied > 0 && (
                                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600 border border-violet-200">
                                      Advance · ₹{alloc.advanceApplied.toLocaleString('en-IN')}
                                    </span>
                                  )}
                                </div>
                              )}
                              {!hasAlloc && !isExpanded && contextLine && (
                                <span className="text-[10px] text-slate-400 mt-0.5 leading-snug">{contextLine}</span>
                              )}
                              {!isDepositInfo && !isExpanded && (
                                <span className="text-[9px] text-slate-400 mt-0.5 tabular-nums">
                                  {bal === 0 ? 'Balance after: Settled' : bal < 0 ? `Balance after: ₹${Math.abs(bal).toLocaleString('en-IN')} credit` : `Remaining: ₹${bal.toLocaleString('en-IN')}`}
                                </span>
                              )}
                            </div>

                            {/* Type badge */}
                            <div className="flex items-center justify-end">
                              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full border ${badge.cls}`}>
                                {badge.label}
                              </span>
                            </div>

                            {/* Amount */}
                            <div className="flex items-center justify-end">
                              {isDepositInfo
                                ? <span className="text-[11px] text-violet-400 tabular-nums">₹{(entry.amount ?? 0).toLocaleString('en-IN')}</span>
                                : <span className={`text-[11px] font-bold tabular-nums ${showNegative ? 'text-red-500' : 'text-emerald-600'}`}>
                                    {showNegative ? '−' : '+'}₹{(entry.amount ?? 0).toLocaleString('en-IN')}
                                  </span>
                              }
                            </div>

                            {/* Balance after */}
                            <div className="flex items-center justify-end">
                              {isDepositInfo
                                ? <span className="text-[9px] text-violet-300">—</span>
                                : <span className={`text-[10px] font-bold tabular-nums ${balClr}`}>{balLabel}</span>
                              }
                            </div>
                          </button>

                          {/* Expanded detail panel */}
                          {isExpanded && (() => {
                            const alloc = entry.allocation
                            const hasAlloc = alloc && (alloc.appliedTo?.length > 0 || alloc.chargeAllocations?.length > 0 || alloc.advanceApplied > 0)
                            const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
                            return (
                              <div className="bg-slate-50 border-b border-slate-200 px-5 py-3 space-y-3">

                                {/* Payment allocation breakdown */}
                                {hasAlloc && (
                                  <div>
                                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Applied To</p>
                                    <div className="space-y-1">
                                      {alloc.appliedTo?.map((a, i) => (
                                        <div key={i} className="flex items-center justify-between rounded-lg bg-white border border-slate-200 px-3 py-1.5">
                                          <div className="flex items-center gap-2">
                                            <span className="h-1.5 w-1.5 rounded-full bg-slate-400 shrink-0" />
                                            <span className="text-[11px] text-slate-600 font-medium">
                                              Rent: {MONTHS[(a.month ?? 1) - 1]} {a.year}
                                            </span>
                                          </div>
                                          <span className="text-[11px] font-bold text-emerald-600 tabular-nums">₹{(a.amount ?? 0).toLocaleString('en-IN')}</span>
                                        </div>
                                      ))}
                                      {alloc.chargeAllocations?.map((c, i) => (
                                        <div key={i} className="flex items-center justify-between rounded-lg bg-white border border-amber-200 px-3 py-1.5">
                                          <div className="flex items-center gap-2">
                                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
                                            <span className="text-[11px] text-slate-600 font-medium">
                                              Charge: {c.chargeRecord?.description ?? 'Extra charge'}
                                            </span>
                                          </div>
                                          <span className="text-[11px] font-bold text-emerald-600 tabular-nums">₹{(c.amount ?? 0).toLocaleString('en-IN')}</span>
                                        </div>
                                      ))}
                                      {alloc.advanceApplied > 0 && (
                                        <div className="flex items-center justify-between rounded-lg bg-white border border-violet-200 px-3 py-1.5">
                                          <div className="flex items-center gap-2">
                                            <span className="h-1.5 w-1.5 rounded-full bg-violet-400 shrink-0" />
                                            <span className="text-[11px] text-slate-600 font-medium">Advance credit</span>
                                          </div>
                                          <span className="text-[11px] font-bold text-violet-600 tabular-nums">₹{alloc.advanceApplied.toLocaleString('en-IN')}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                )}

                                {/* Meta info */}
                                <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
                                  {entry.method && (
                                    <div className="flex gap-2 text-xs">
                                      <span className="text-slate-400 w-16 shrink-0">Method</span>
                                      <span className="text-slate-600 font-medium">
                                        {entry.method === 'deposit_adjustment' ? 'Deposit Used'
                                          : entry.method === 'bank_transfer' ? 'Bank Transfer'
                                          : entry.method === 'upi' ? 'UPI'
                                          : entry.method.replace(/\b\w/g, c => c.toUpperCase())}
                                      </span>
                                    </div>
                                  )}
                                  {!isDepositInfo && (
                                    <div className="flex gap-2 text-xs">
                                      <span className="text-slate-400 w-16 shrink-0">Balance</span>
                                      <span className={`font-semibold ${bal > 0 ? 'text-red-500' : bal < 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                                        {bal === 0 ? 'Settled' : bal < 0 ? `₹${Math.abs(bal).toLocaleString('en-IN')} credit` : `₹${bal.toLocaleString('en-IN')} due`}
                                      </span>
                                    </div>
                                  )}
                                  <div className="flex gap-2 text-xs col-span-2">
                                    <span className="text-slate-400 w-16 shrink-0">Time</span>
                                    <span className="text-slate-500">{new Date(entry.createdAt).toLocaleString('en-IN')}</span>
                                  </div>
                                  <div className="flex gap-2 text-xs col-span-2">
                                    <span className="text-slate-400 w-16 shrink-0">ID</span>
                                    <span className="font-mono text-[9px] text-slate-400 select-all">{String(entry._id)}</span>
                                  </div>
                                </div>
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })
                    return (
                      <>
                        {rows}
                        {hasMore && (
                          <div className="px-4 py-3 border-t border-slate-100 text-center">
                            <button type="button" onClick={() => setVisibleCount(c => c + 20)}
                              className="text-[11px] font-semibold text-slate-500 hover:text-slate-700 transition-colors">
                              Load {Math.min(20, filtered.length - visibleCount)} more
                              <span className="text-slate-400 font-normal"> ({filtered.length - visibleCount} remaining)</span>
                            </button>
                          </div>
                        )}
                      </>
                    )
                  })()}

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
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* ── Sticky Save/Cancel bar ── */}
      {editing !== null && activeTab === 'overview' && (
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-t border-[#E2E8F0] bg-white">
          <p className="text-xs text-slate-400 truncate">
            Editing <span className="font-semibold text-slate-600">
              {editing === 'personal' ? 'Personal Info' : editing === 'identity' ? 'Identity & Verification' : 'Stay & Agreement'}
            </span>
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-xl border border-[#E2E8F0] bg-white px-4 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => handleSave(editing)}
              disabled={saving}
              className="rounded-xl px-4 py-2 text-xs font-bold text-white transition-colors disabled:opacity-50"
              style={{ background: '#60C3AD' }}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}

      {/* ── Record Payment Modal ── */}
      {payModal && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={e => e.target === e.currentTarget && setPayModal(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-[#60C3AD]/10 flex items-center justify-center">
                  <CreditCard size={14} className="text-[#60C3AD]" />
                </div>
                <p className="text-sm font-bold text-[#334155]">{t.status === 'vacated' ? 'Collect Payment' : 'Record Payment'}</p>
              </div>
              <button onClick={() => setPayModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              {ledgerBalance !== null && ledgerBalance > 0 && (
                <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5">
                  <p className="text-xs font-semibold text-amber-800">
                    Outstanding: ₹{ledgerBalance.toLocaleString('en-IN')}
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
                  {filteredPaymentMethods.map(([v,l]) => <option key={v} value={v}>{l}</option>)}
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
                className="flex-1 rounded-xl bg-[#60C3AD] hover:bg-[#4fa898] px-4 py-2.5 text-xs font-bold text-white transition-colors disabled:opacity-50">
                {actionBusy ? 'Recording…' : `Record ₹${Number(payAmt) > 0 ? Number(payAmt).toLocaleString('en-IN') : '0'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add Charge Modal ── */}
      {chargeModal && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={e => e.target === e.currentTarget && setChargeModal(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-amber-50 flex items-center justify-center">
                  <Zap size={14} className="text-amber-500" />
                </div>
                <p className="text-sm font-bold text-[#334155]">Add Charge</p>
              </div>
              <button onClick={() => setChargeModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="label text-xs">Amount (₹) *</label>
                <input type="number" min="1" className="input text-sm" autoFocus
                  placeholder="0"
                  value={chargeAmt} onChange={e => setChargeAmt(e.target.value)} />
              </div>
              <div>
                <label className="label text-xs">Description <span className="text-slate-400 font-normal">(optional)</span></label>
                <input type="text" className="input text-sm"
                  placeholder="e.g. Late fee, Maintenance charge…"
                  value={chargeDesc} onChange={e => setChargeDesc(e.target.value)} />
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-2.5">
              <button className="btn-secondary flex-1 text-xs" onClick={() => setChargeModal(false)}>Cancel</button>
              <button
                disabled={actionBusy || !Number(chargeAmt) || Number(chargeAmt) <= 0}
                onClick={handleChargeSubmit}
                className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 px-4 py-2.5 text-xs font-bold text-white transition-colors disabled:opacity-50">
                {actionBusy ? 'Adding…' : `Add ₹${Number(chargeAmt) > 0 ? Number(chargeAmt).toLocaleString('en-IN') : '0'}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Deposit Adjust Modal ── */}
      {depositAdjustModal && (() => {
        const depositBal = t.depositBalance ?? t.depositAmount ?? 0
        const outstandingDue = Math.max(0, ledgerBalance ?? 0)
        const maxAmt         = Math.min(depositBal, outstandingDue)
        const partialAmt     = Number(depositAdjustAmt)
        const applyAmt       = depositAdjustMode === 'full' ? maxAmt : partialAmt
        const newDeposit     = Math.max(0, depositBal - applyAmt)
        const newDue         = Math.max(0, outstandingDue - applyAmt)
        const isPartialValid = depositAdjustMode === 'full' || (partialAmt > 0 && partialAmt <= depositBal && partialAmt <= outstandingDue)
        return (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && !depositActing && setDepositAdjustModal(false)}>
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-violet-100 flex items-center justify-center">
                    <Shield size={14} className="text-violet-600" />
                  </div>
                  <p className="text-sm font-bold text-[#334155]">Adjust Security Deposit</p>
                </div>
                <button onClick={() => !depositActing && setDepositAdjustModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X size={16} />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Context */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-red-500 mb-0.5">Outstanding Due</p>
                    <p className="text-sm font-bold text-red-700 tabular-nums">₹{outstandingDue.toLocaleString('en-IN')}</p>
                  </div>
                  <div className="rounded-xl bg-violet-50 border border-violet-200 px-3 py-2.5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-violet-500 mb-0.5">Available Deposit</p>
                    <p className="text-sm font-bold text-violet-700 tabular-nums">₹{depositBal.toLocaleString('en-IN')}</p>
                  </div>
                </div>

                {/* Options */}
                <div className="space-y-2">
                  <label className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                    depositAdjustMode === 'full' ? 'border-violet-300 bg-violet-50' : 'border-[#E2E8F0] bg-white hover:bg-slate-50'
                  }`}>
                    <input type="radio" name="depositAdjMode" value="full"
                      checked={depositAdjustMode === 'full'}
                      onChange={() => { setDepositAdjustMode('full'); setDepositAdjustAmt('') }}
                      className="mt-0.5 accent-violet-600" />
                    <div>
                      <p className="text-sm font-semibold text-slate-700">Full Adjustment</p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Apply ₹{maxAmt.toLocaleString('en-IN')} — clears {maxAmt >= outstandingDue ? 'all dues' : 'partial dues'}
                      </p>
                    </div>
                  </label>
                  <label className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                    depositAdjustMode === 'partial' ? 'border-violet-300 bg-violet-50' : 'border-[#E2E8F0] bg-white hover:bg-slate-50'
                  }`}>
                    <input type="radio" name="depositAdjMode" value="partial"
                      checked={depositAdjustMode === 'partial'}
                      onChange={() => setDepositAdjustMode('partial')}
                      className="mt-0.5 accent-violet-600" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-slate-700">Partial Adjustment</p>
                      <p className="text-xs text-slate-400 mt-0.5">Enter a custom amount</p>
                      {depositAdjustMode === 'partial' && (
                        <div className="mt-2 relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">₹</span>
                          <input
                            type="number" min="1" max={maxAmt} autoFocus
                            className={`input text-sm pl-7 ${
                              depositAdjustAmt && !isPartialValid ? 'border-red-300 focus:border-red-400 focus:ring-red-200' : ''
                            }`}
                            placeholder="0"
                            value={depositAdjustAmt}
                            onChange={e => setDepositAdjustAmt(e.target.value)}
                          />
                          {depositAdjustAmt && !isPartialValid && (
                            <p className="text-[10px] text-red-500 mt-1">
                              {partialAmt > depositBal ? `Max deposit: ₹${depositBal.toLocaleString('en-IN')}` :
                               partialAmt > outstandingDue ? `Max due: ₹${outstandingDue.toLocaleString('en-IN')}` : 'Enter a valid amount'}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </label>
                </div>

                {/* Dynamic Preview */}
                {applyAmt > 0 && isPartialValid && (
                  <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-4 py-3 space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Preview</p>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">New deposit balance</span>
                      <span className="font-bold text-violet-700 tabular-nums">₹{newDeposit.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">Remaining due</span>
                      <span className={`font-bold tabular-nums ${newDue > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {newDue > 0 ? `₹${newDue.toLocaleString('en-IN')}` : 'Cleared'}
                      </span>
                    </div>
                  </div>
                )}

                {/* Warning */}
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5">
                  <AlertCircle size={13} className="text-amber-500 shrink-0" />
                  <p className="text-xs font-medium text-amber-700">This action cannot be undone</p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 pb-5 flex gap-2.5">
                <button className="btn-secondary flex-1 text-xs" onClick={() => setDepositAdjustModal(false)} disabled={depositActing}>
                  Cancel
                </button>
                <button
                  disabled={depositActing || !applyAmt || !isPartialValid}
                  onClick={handleDepositAdjustConfirm}
                  className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 px-4 py-2.5 text-xs font-bold text-white transition-colors disabled:opacity-50">
                  {depositActing ? 'Adjusting…' : `Confirm — ₹${applyAmt > 0 ? applyAmt.toLocaleString('en-IN') : '0'}`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Vacate Flow Modal ── rendered outside tab conditionals so it works from any tab */}
      {vacateModal && (
        <Modal
          onClose={() => !vacating && setVacateModal(false)}
          title={`Vacate — Bed ${t.bed?.bedNumber ?? '—'}`}
          zIndex="z-[70]"
          size="sm"
        >
          <div className="flex flex-col gap-4">

            {/* Tenant summary */}
            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 flex items-center gap-3">
              <Avatar name={t.name} size="sm" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{t.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {t.phone}
                  {t.bed && ` · R${t.bed.room?.roomNumber ?? '?'} / B${t.bed.bedNumber}`}
                </p>
              </div>
              <div className="ml-auto text-right shrink-0">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Monthly</p>
                <p className="text-sm font-bold text-slate-700">₹{(t.rentAmount ?? 0).toLocaleString('en-IN')}</p>
              </div>
            </div>

            {/* Financial summary */}
            <div className="rounded-xl border border-slate-100 overflow-hidden">
              <div className="grid grid-cols-3 divide-x divide-slate-100">
                <div className="px-3 py-2.5 text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Monthly Rent</p>
                  <p className="text-sm font-bold text-slate-700">₹{(t.rentAmount ?? 0).toLocaleString('en-IN')}</p>
                </div>
                <div className="px-3 py-2.5 text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Paid</p>
                  <p className="text-sm font-bold text-emerald-600">
                    ₹{(ledgerBalance !== null ? Math.max(0, (t.rentAmount ?? 0) - ledgerBalance) : 0).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="px-3 py-2.5 text-center">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wide mb-0.5">Pending</p>
                  <p className={`text-sm font-bold ${hasDues ? 'text-red-500' : 'text-slate-400'}`}>
                    {hasDues ? `₹${ledgerBalance.toLocaleString('en-IN')}` : '₹0'}
                  </p>
                </div>
              </div>
            </div>

            {/* Payment option — only shown when dues exist */}
            {hasDues && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Payment Option</p>

                {/* Option 1 — Collect */}
                <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                  vacateOption === 'collect' ? 'border-[#60C3AD] bg-teal-50/50' : 'border-slate-200 hover:border-slate-300'
                }`}>
                  <input
                    type="radio" name="vacateOpt" value="collect"
                    checked={vacateOption === 'collect'}
                    onChange={() => setVacateOption('collect')}
                    className="mt-0.5 accent-[#60C3AD]"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700">Collect Payment &amp; Vacate</p>
                    {vacateOption === 'collect' && (
                      <div className="mt-2.5 flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">Amount (₹)</label>
                          <input
                            type="number" min="1"
                            value={vacateAmt}
                            onChange={e => setVacateAmt(e.target.value)}
                            className="input text-sm py-1.5 w-full"
                            placeholder="0"
                            autoFocus
                          />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-slate-400 uppercase tracking-wide block mb-1">Mode</label>
                          <select
                            value={vacateMethod}
                            onChange={e => setVacateMethod(e.target.value)}
                            className="input text-sm py-1.5 w-full"
                          >
                            <option value="cash">Cash</option>
                            <option value="upi">UPI</option>
                            <option value="bank_transfer">Bank</option>
                            <option value="cheque">Cheque</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </label>

                {/* Option 2 — Skip */}
                <label className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                  vacateOption === 'skip' ? 'border-[#60C3AD] bg-teal-50/50' : 'border-slate-200 hover:border-slate-300'
                }`}>
                  <input
                    type="radio" name="vacateOpt" value="skip"
                    checked={vacateOption === 'skip'}
                    onChange={() => setVacateOption('skip')}
                    className="mt-0.5 accent-[#60C3AD]"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-700">Vacate without collecting</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      ₹{ledgerBalance.toLocaleString('en-IN')} will remain pending and can be collected later
                    </p>
                  </div>
                </label>
              </div>
            )}

            {/* Confirmation summary */}
            <div className="rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-3 text-xs text-amber-700 space-y-1">
              {vacateOption === 'collect' && parseFloat(vacateAmt) > 0 ? (
                <p className="font-semibold">You will collect ₹{parseFloat(vacateAmt).toLocaleString('en-IN')} and vacate tenant</p>
              ) : hasDues ? (
                <p className="font-semibold">₹{ledgerBalance.toLocaleString('en-IN')} will remain pending after vacating</p>
              ) : null}
              <p>· Tenant will be marked as vacated</p>
              <p>· Bed will become available immediately</p>
              <p>· Financial records will NOT be deleted</p>
            </div>

            {/* Actions */}
            <div className="flex gap-2.5 pt-1">
              <button
                onClick={() => setVacateModal(false)}
                disabled={vacating}
                className="flex-1 btn-secondary justify-center text-sm py-2.5"
              >
                Cancel
              </button>
              <button
                onClick={handleVacateConfirm}
                disabled={vacating}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white transition-colors shadow-sm disabled:opacity-60"
                style={{ background: vacating ? '#9ca3af' : '#60C3AD' }}
              >
                {vacating ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                    </svg>
                    Vacating…
                  </>
                ) : vacateOption === 'collect' && parseFloat(vacateAmt) > 0 ? (
                  `Collect ₹${parseFloat(vacateAmt || 0).toLocaleString('en-IN')} & Vacate`
                ) : (
                  'Vacate Tenant'
                )}
              </button>
            </div>

          </div>
        </Modal>
      )}

      {depositRefundModal && (() => {
        const depositBal = t.depositBalance ?? t.depositAmount ?? 0
        return (
          <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
            onClick={e => e.target === e.currentTarget && !depositActing && setDepositRefundModal(false)}>
            <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-violet-100 flex items-center justify-center">
                    <Shield size={14} className="text-violet-600" />
                  </div>
                  <p className="text-sm font-bold text-[#334155]">Refund Security Deposit</p>
                </div>
                <button onClick={() => !depositActing && setDepositRefundModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X size={16} />
                </button>
              </div>

              <div className="px-5 py-4 space-y-4">
                {/* Context */}
                <div className="rounded-xl bg-violet-50 border border-violet-200 px-4 py-3 flex items-center justify-between">
                  <p className="text-xs font-semibold text-violet-600">Deposit Balance</p>
                  <p className="text-sm font-bold text-violet-700 tabular-nums">₹{depositBal.toLocaleString('en-IN')}</p>
                </div>

                {/* Refund Method */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 mb-2">Refund Method</p>
                  <div className="space-y-2">
                    {[['cash', 'Cash'], ['bank_transfer', 'Bank Transfer'], ['upi', 'UPI']].map(([val, label]) => (
                      <label key={val} className={`flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer transition-colors ${
                        depositRefundMethod === val ? 'border-violet-300 bg-violet-50' : 'border-[#E2E8F0] bg-white hover:bg-slate-50'
                      }`}>
                        <input type="radio" name="depositRefundMethod" value={val}
                          checked={depositRefundMethod === val}
                          onChange={() => setDepositRefundMethod(val)}
                          className="accent-violet-600" />
                        <span className="text-sm font-semibold text-slate-700">{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Warning */}
                <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-2.5">
                  <AlertCircle size={13} className="text-amber-500 shrink-0" />
                  <p className="text-xs font-medium text-amber-700">This action cannot be undone</p>
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 pb-5 flex gap-2.5">
                <button className="btn-secondary flex-1 text-xs" onClick={() => setDepositRefundModal(false)} disabled={depositActing}>
                  Cancel
                </button>
                <button
                  disabled={depositActing}
                  onClick={handleDepositRefundConfirm}
                  className="flex-1 rounded-xl bg-violet-600 hover:bg-violet-700 px-4 py-2.5 text-xs font-bold text-white transition-colors disabled:opacity-50">
                  {depositActing ? 'Refunding…' : `Refund ₹${depositBal.toLocaleString('en-IN')}`}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── Collect Deposit Modal ── */}
      {collectDepositModal && (
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={e => e.target === e.currentTarget && !depositActing && setCollectDepositModal(false)}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Shield size={14} className="text-amber-600" />
                </div>
                <p className="text-sm font-bold text-[#334155]">Collect Security Deposit</p>
              </div>
              <button onClick={() => !depositActing && setCollectDepositModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Amount row */}
              <div className="rounded-xl bg-amber-50 border border-amber-200 px-4 py-3 flex items-center justify-between">
                <p className="text-xs font-semibold text-amber-700">Deposit Amount</p>
                <p className="text-sm font-bold text-amber-800 tabular-nums">
                  ₹{(t.depositAmount ?? 0).toLocaleString('en-IN')}
                </p>
              </div>

              {/* Collection date */}
              <div>
                <label className="label text-xs">Collection Date</label>
                <input
                  type="date"
                  className="input text-sm"
                  value={collectDepositDate}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={e => setCollectDepositDate(e.target.value)}
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  A deposit_collected ledger entry will be created (audit only, does not affect rent balance).
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 pb-5 flex gap-2.5">
              <button className="btn-secondary flex-1 text-xs" onClick={() => setCollectDepositModal(false)} disabled={depositActing}>
                Cancel
              </button>
              <button
                disabled={depositActing}
                onClick={handleCollectDeposit}
                className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 px-4 py-2.5 text-xs font-bold text-white transition-colors disabled:opacity-50">
                {depositActing ? 'Saving…' : `Confirm — ₹${(t.depositAmount ?? 0).toLocaleString('en-IN')} Collected`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Room Modal — reuses BedActionModal from RoomsBeds ── */}
      {changeRoomOpen && t.bed && (
        <BedActionModal
          bed={{
            ...t.bed,
            tenant: {
              _id:            t._id,
              name:           t.name,
              gender:         t.gender,
              rentAmount:     t.rentAmount,
              depositBalance: t.depositBalance ?? t.depositAmount ?? 0,
              depositPaid:    t.depositPaid ?? false,
              depositAmount:  t.depositAmount ?? 0,
              ledgerBalance:  t.ledgerBalance ?? 0,
            },
          }}
          room={t.bed.room}
          propertyId={propertyId}
          allRooms={changeRoomRooms}
          initialView="changeRoom"
          zIndex="z-[70]"
          occupancy={null}
          onClose={() => setChangeRoomOpen(false)}
          onSuccess={() => { setChangeRoomOpen(false); refetchProfile(); onRefetch?.() }}
        />
      )}

      {/* ── Confirm Move-in Modal — reuses BedActionModal assign view ── */}
      {confirmMoveInOpen && t.bed && (
        <BedActionModal
          bed={{
            ...t.bed,
            status: 'reserved',
            reservation: {
              name:              t.name,
              phone:             t.phone,
              reservationStatus: 'held',
              reservationAmount: heldAdvance?.reservationAmount ?? 0,
              reservedTill:      heldAdvance?.reservedTill ?? null,
            },
            tenant: null,
          }}
          room={t.bed.room}
          propertyId={propertyId}
          allRooms={confirmMoveInRooms}
          initialView="assign"
          zIndex="z-[70]"
          occupancy={null}
          onClose={() => setConfirmMoveInOpen(false)}
          onSuccess={() => { setConfirmMoveInOpen(false); refetchProfile(); onRefetch?.() }}
        />
      )}

      {/* ── Cancel Reservation Confirm ── */}
      {cancelResConfirmOpen && (
        <Modal onClose={() => !cancelResActing && setCancelResConfirmOpen(false)} title="Cancel Reservation" zIndex="z-[70]" size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3.5">
              <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-800">{t.name}</p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  This will release the reserved bed
                  {t.bed ? ` (Room ${t.bed.room?.roomNumber ?? '?'} · Bed ${t.bed.bedNumber})` : ''}.
                  {heldAdvance ? ` The advance of ₹${heldAdvance.reservationAmount.toLocaleString('en-IN')} will need to be refunded separately.` : ''}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setCancelResConfirmOpen(false)} disabled={cancelResActing}>Keep</button>
              <button
                onClick={handleCancelReservation}
                disabled={cancelResActing}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm disabled:opacity-50">
                <X size={14} /> {cancelResActing ? 'Cancelling…' : 'Cancel Reservation'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── View Documents Modal ── */}
      {viewDocsOpen && (
        <Modal onClose={() => setViewDocsOpen(false)} title="Documents" zIndex="z-[70]" size="sm">
          <div className="flex flex-col gap-3 px-5 py-4">

            {/* Identity */}
            <div className="rounded-xl border border-[#E2E8F0] overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-[#E2E8F0]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Identity</p>
              </div>
              <div className="px-4 py-3 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500">Aadhaar</p>
                  <p className="text-xs font-semibold text-slate-700">{t.aadharNumber || '—'}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500">Police Verification</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    t.verification?.policeStatus === 'verified'  ? 'bg-emerald-100 text-emerald-700' :
                    t.verification?.policeStatus === 'submitted' ? 'bg-blue-100 text-blue-700' :
                                                                   'bg-amber-100 text-amber-700'
                  }`}>
                    {t.verification?.policeStatus ?? 'pending'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-500">ID Verified</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${t.verification?.idVerified ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
                    {t.verification?.idVerified ? 'Yes' : 'No'}
                  </span>
                </div>
              </div>
            </div>

            {/* Uploaded files */}
            {[
              { label: 'ID Proof',     url: t.documents?.idProofUrl },
              { label: 'Photo',        url: t.documents?.photoUrl },
              { label: 'Agreement',    url: t.agreementFileUrl },
            ].some(d => d.url) && (
              <div className="rounded-xl border border-[#E2E8F0] overflow-hidden">
                <div className="px-4 py-2.5 bg-slate-50 border-b border-[#E2E8F0]">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Files</p>
                </div>
                <div className="px-4 py-3 space-y-2">
                  {[
                    { label: 'ID Proof',  url: t.documents?.idProofUrl },
                    { label: 'Photo',     url: t.documents?.photoUrl },
                    { label: 'Agreement', url: t.agreementFileUrl },
                  ].map(({ label, url }) => url ? (
                    <a key={label} href={url} target="_blank" rel="noreferrer"
                      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-2 transition-colors">
                      <span className="text-xs font-semibold text-slate-700">{label}</span>
                      <span className="text-[10px] font-bold text-[#60C3AD] hover:underline">View →</span>
                    </a>
                  ) : null)}
                </div>
              </div>
            )}

            {/* No files placeholder */}
            {![t.documents?.idProofUrl, t.documents?.photoUrl, t.agreementFileUrl].some(Boolean) && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-6 text-center">
                <FileText size={20} className="text-slate-300 mx-auto mb-2" />
                <p className="text-xs text-slate-400">No documents uploaded yet</p>
              </div>
            )}

            <button onClick={() => { setViewDocsOpen(false); setActiveTab('overview'); setEditing('identity') }}
              className="w-full rounded-xl border border-[#60C3AD] text-[#60C3AD] hover:bg-teal-50 px-4 py-2.5 text-xs font-bold transition-colors">
              Edit / Upload Documents
            </button>
          </div>
        </Modal>
      )}

      {/* ── Call Confirm Modal ── */}
      {callConfirmOpen && (
        <Modal title="" onClose={() => setCallConfirmOpen(false)} size="sm" zIndex="z-[70]">
          <div className="flex flex-col items-center text-center px-2 pb-2 space-y-4">
            {/* Avatar ring */}
            <div className="relative">
              <div className="h-16 w-16 rounded-full bg-blue-50 border-2 border-blue-100 flex items-center justify-center">
                <PhoneCall size={26} className="text-blue-500" />
              </div>
              <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-emerald-400 border-2 border-white flex items-center justify-center">
                <span className="h-2 w-2 rounded-full bg-white animate-ping" />
              </span>
            </div>

            <div>
              <p className="text-base font-bold text-slate-800">{t.name}</p>
              <p className="text-lg font-semibold text-blue-600 tracking-wide mt-0.5">{t.phone}</p>
              <p className="text-xs text-slate-400 mt-1">
                Room {t.bed?.room?.roomNumber} · Bed {t.bed?.bedNumber}
              </p>
            </div>

            <div className="w-full flex gap-2 pt-1">
              <button
                type="button"
                className="btn-secondary flex-1"
                onClick={() => setCallConfirmOpen(false)}
              >
                Cancel
              </button>
              <a
                href={`tel:${t.phone}`}
                onClick={() => setCallConfirmOpen(false)}
                className="btn-primary flex-1 flex items-center justify-center gap-1.5"
              >
                <PhoneCall size={14} /> Call Now
              </a>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Deactivate Tenant Confirm ── */}
      {deactivateConfirmOpen && (() => {
        // Reserved tenants must cancel reservation first — deactivation doesn't apply
        const isReserved    = t.status === 'reserved'
        const hasPendingDues = ledgerBalance !== null && ledgerBalance > 0
        return (
        <Modal onClose={() => !deactivateActing && setDeactivateConfirmOpen(false)} title="Deactivate Tenant" zIndex="z-[70]" size="sm">
          <div className="space-y-4">
            {isReserved ? (
              <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3.5">
                <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">{t.name}</p>
                  <p className="text-xs text-red-700 mt-1 leading-relaxed font-medium">
                    Tenant has a reserved bed. Cancel the reservation first.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3.5">
                <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">{t.name}</p>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    This tenant will be put on <strong>notice</strong>. Their bed will remain assigned and all financial records will be preserved.
                  </p>
                  {hasPendingDues && (
                    <p className="text-xs text-amber-700 font-semibold mt-2">
                      ⚠ ₹{ledgerBalance.toLocaleString('en-IN')} in pending dues will remain outstanding.
                    </p>
                  )}
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setDeactivateConfirmOpen(false)} disabled={deactivateActing}>Cancel</button>
              {!isReserved && (
                <button
                  onClick={handleDeactivateConfirm}
                  disabled={deactivateActing}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-colors shadow-sm disabled:opacity-50">
                  <Power size={14} /> {deactivateActing ? 'Deactivating…' : 'Put on Notice'}
                </button>
              )}
            </div>
          </div>
        </Modal>
        )
      })()}

      {/* ── Reactivate Tenant Confirm ── */}
      {reactivateConfirmOpen && (
        <Modal onClose={() => !reactivateActing && setReactivateConfirmOpen(false)} title="Reactivate Tenant" zIndex="z-[70]" size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3.5">
              <RotateCcw size={18} className="text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-800">{t.name}</p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  This tenant will be restored to active status and their bed assignment will continue as normal.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setReactivateConfirmOpen(false)} disabled={reactivateActing}>Cancel</button>
              <button
                onClick={confirmReactivate}
                disabled={reactivateActing}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm disabled:opacity-50">
                <RotateCcw size={14} /> {reactivateActing ? 'Reactivating…' : 'Reactivate'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete Tenant Confirm ── */}
      {deleteConfirmOpen && (
        <Modal onClose={() => !deleteActing && setDeleteConfirmOpen(false)} title="Remove Tenant" zIndex="z-[70]" size="sm">
          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3">
              <Trash2 size={16} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-red-800">Remove <span className="font-bold">{t.name}</span>?</p>
                <p className="text-xs text-red-700 mt-1">This will mark the tenant as vacated and free their bed. Financial records are preserved. This cannot be undone.</p>
              </div>
            </div>
            <div className="flex gap-2.5">
              <button onClick={() => setDeleteConfirmOpen(false)} disabled={deleteActing}
                className="flex-1 btn-secondary text-xs justify-center py-2.5">
                Cancel
              </button>
              <button onClick={handleDeleteConfirm} disabled={deleteActing}
                className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 px-4 py-2.5 text-xs font-bold text-white transition-colors disabled:opacity-50">
                {deleteActing ? 'Removing…' : 'Remove Tenant'}
              </button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const FILTER_DEFAULTS = { search: '', status: 'all', profile: 'all', rentStatus: 'all', extraBed: 'all', deposit: 'all', sortBy: 'pending_first' }

// ── No Property Empty State ───────────────────────────────────────────────────
const NoPropertyState = () => {
  const navigate = useNavigate()

  const highlights = [
    { icon: User,        label: 'Tenant Profiles',    desc: 'Store contact details, ID proofs, and move-in history'   },
    { icon: BedDouble,   label: 'Bed Assignment',      desc: 'Assign tenants to specific beds with rent overrides'      },
    { icon: CreditCard,  label: 'Rent & Ledger',       desc: 'Track payments, charges, and full audit trail per tenant' },
    { icon: Shield,      label: 'Deposit Management',  desc: 'Collect, adjust, and refund deposits with full records'   },
  ]

  return (
    <div className="px-4 py-8 pb-24 md:pb-8">
      <div className="w-full max-w-xl mx-auto">

        {/* Hero */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-3xl mb-5 mx-auto"
            style={{ background: 'rgba(96,195,173,0.12)', border: '1.5px solid rgba(96,195,173,0.25)' }}>
            <Users size={32} style={{ color: '#60C3AD' }} />
          </div>
          <h2 className="text-xl font-bold text-slate-800">No property selected</h2>
          <p className="text-sm text-slate-400 mt-2 max-w-xs mx-auto leading-relaxed">
            Select a property from the sidebar to manage its tenants.
          </p>
        </div>

        {/* CTA */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden mb-5">
          <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-800">No properties yet?</p>
              <p className="text-xs text-slate-400 mt-0.5">Add a property first, then assign tenants to beds</p>
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

const Tenants = () => {
  const { selectedProperty } = useProperty()
  const propertyId = selectedProperty?._id ?? ''
  const toast = useToast()
  const enabledPayMethods = useMemo(() => loadEnabledMethods(propertyId), [propertyId])
  const filteredQpMethods = PAYMENT_METHODS.filter(([v]) => enabledPayMethods.includes(v))

  const PAGE_SIZE = 10

  const [showAdd,   setShowAdd]   = useState(false)
  const [profile,   setProfile]   = useState(null)
  const [saving,    setSaving]    = useState(false)
  const [filters,   setFilters]   = useState(FILTER_DEFAULTS)
  const [selected,  setSelected]  = useState(new Set())
  const [page,      setPage]      = useState(1)

  // Quick-pay modal: { tenant, amount, method, busy }
  const [quickPay,    setQuickPay]    = useState(null)
  const [qpAmt,       setQpAmt]       = useState('')
  const [qpMethod,    setQpMethod]    = useState(() => filteredQpMethods[0]?.[0] ?? 'cash')
  const [qpRef,       setQpRef]       = useState('')
  const [qpNotes,     setQpNotes]     = useState('')
  const [qpBusy,      setQpBusy]      = useState(false)

  const openQuickPay = (t) => {
    const pending = t.ledgerBalance > 0 ? t.ledgerBalance : 0
    setQpAmt(String(pending || ''))
    setQpMethod(filteredQpMethods[0]?.[0] ?? 'cash')
    setQpRef('')
    setQpNotes('')
    setQuickPay(t)
  }

  const handleQuickPay = async () => {
    const amt = Number(qpAmt)
    if (!amt || amt <= 0 || !quickPay) return
    setQpBusy(true)
    try {
      await recordPayment(propertyId, {
        tenantId:    quickPay._id,
        amount:      amt,
        method:      qpMethod,
        referenceId: qpRef.trim() || undefined,
        notes:       qpNotes.trim() || (quickPay.status === 'vacated' ? 'Payment collected after vacating' : undefined),
      })
      setQuickPay(null)
      refetch()
      toast(`₹${amt.toLocaleString('en-IN')} collected from ${quickPay.name}`, 'success')
    } catch (err) {
      toast(err.response?.data?.message || 'Payment failed', 'error')
    } finally { setQpBusy(false) }
  }

  // Fetch ALL tenants once — filter client-side for instant updates + accurate stats
  const { data, loading, refetch } = useApi(
    () => propertyId ? getTenants(propertyId) : Promise.resolve({ data: null }),
    [propertyId]
  )
  const allTenants = data?.data ?? []

  // ── Stats ──────────────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const activeTenants = allTenants.filter(t => t.status !== 'vacated' && t.status !== 'merged')
    const pendingRentList = activeTenants.filter(t => {
      const rs = computeRentStatus(t)
      return rs === 'pending' || rs === 'overdue'
    })
    return {
      total:            allTenants.length,
      active:           allTenants.filter(t => t.status === 'active').length,
      notice:           allTenants.filter(t => t.status === 'notice').length,
      vacated:          allTenants.filter(t => t.status === 'vacated').length,
      incomplete:       activeTenants.filter(t => !(t.name && t.phone && t.bed && t.checkInDate && t.rentAmount > 0 && t.aadharNumber && t.emergencyContact?.name && t.emergencyContact?.phone)).length,
      // Use actual ledgerBalance (what's really owed), not rentAmount (monthly rate)
      pendingRentTotal: pendingRentList.reduce((s, t) => s + (t.ledgerBalance ?? 0), 0),
      pendingRentCount: pendingRentList.length,
      // Use checkOutDate (set explicitly on vacate), not updatedAt (changes on any edit)
      recentlyVacated:  allTenants.filter(t => t.status === 'vacated' && t.checkOutDate && new Date(t.checkOutDate) > thirtyDaysAgo).length,
    }
  }, [allTenants])

  // ── Filtered + sorted list ────────────────────────────────────────────────
  const filtered = useMemo(() => {
    let list = [...allTenants]

    if (filters.status !== 'all')  list = list.filter(t => t.status === filters.status)
    if (filters.profile !== 'all') {
      const isComplete = (t) => !!(t.name && t.phone && t.bed && t.checkInDate && t.rentAmount > 0 && t.aadharNumber && t.emergencyContact?.name && t.emergencyContact?.phone)
      // Vacated and merged tenants are excluded from profile filtering — vacated always lack
      // a bed (cleared at vacate time) so they'd always appear "incomplete", which is misleading
      list = list.filter(t => {
        if (t.status === 'vacated' || t.status === 'merged') return false
        return filters.profile === 'complete' ? isComplete(t) : !isComplete(t)
      })
    }
    if (filters.rentStatus !== 'all') {
      list = list.filter(t => {
        // For vacated tenants, derive status from ledgerBalance directly
        // (computeRentStatus returns null for vacated, which breaks combined filters)
        const lb = t.ledgerBalance ?? null
        if (t.status === 'vacated') {
          const hasDues = lb !== null && lb > 0
          if (filters.rentStatus === 'pending_overdue') return hasDues
          if (filters.rentStatus === 'current') return !hasDues
          return false
        }
        const rs = computeRentStatus(t)
        if (filters.rentStatus === 'pending_overdue') return rs === 'pending' || rs === 'overdue'
        return rs === filters.rentStatus
      })
    }

    if (filters.extraBed !== 'all') {
      const isExtra = (t) => !!(t.bed?.bedNumber?.startsWith('X') || t.billingSnapshot?.isExtra)
      list = list.filter(t => filters.extraBed === 'extra' ? isExtra(t) : !isExtra(t))
    }

    if (filters.deposit === 'pending') {
      list = list.filter(t => (t.depositAmount ?? 0) > 0 && !t.depositPaid && t.status !== 'vacated')
    }

    const q = filters.search.trim().toLowerCase()
    if (q) list = list.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.phone ?? '').includes(q) ||
      (t.email ?? '').toLowerCase().includes(q)
    )

    // Default: pending dues first (highest balance first), then paid, then by name
    list.sort((a, b) => {
      const pa = a.ledgerBalance > 0 ? a.ledgerBalance : 0
      const pb = b.ledgerBalance > 0 ? b.ledgerBalance : 0
      if (pb !== pa) return pb - pa   // higher pending first
      return a.name.localeCompare(b.name)
    })
    if (filters.sortBy === 'name')      list.sort((a, b) => a.name.localeCompare(b.name))
    if (filters.sortBy === 'rent_desc') list.sort((a, b) => (b.rentAmount ?? 0) - (a.rentAmount ?? 0))
    if (filters.sortBy === 'rent_asc')  list.sort((a, b) => (a.rentAmount ?? 0) - (b.rentAmount ?? 0))
    if (filters.sortBy === 'checkin')   list.sort((a, b) => new Date(b.checkInDate) - new Date(a.checkInDate))

    return list
  }, [allTenants, filters])

  const hasActiveFilters = filters.search !== '' || filters.status !== 'all' || filters.profile !== 'all' || filters.rentStatus !== 'all' || filters.extraBed !== 'all' || filters.deposit !== 'all' || filters.sortBy !== 'pending_first'

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
  const handleAdd = async (form, roomId, bedId) => {
    setSaving(true)
    try {
      const res = await createTenant(propertyId, form)
      // Optionally assign to a bed if the user selected one
      if (roomId && bedId) {
        const tenantId = res.data?.data?._id
        if (tenantId) {
          await assignTenantApi(propertyId, roomId, bedId, {
            tenantId,
            moveInDate: form.checkInDate || undefined,
            // Deposit is already fully handled by createTenant above.
            // Do NOT pass deposit/depositCollected here — it would create a
            // duplicate deposit_collected ledger entry.
          }).catch((err) => toast(
            err.response?.data?.message || 'Tenant created but bed assignment failed — please assign manually from the room view',
            'warn'
          ))
        }
      }
      setShowAdd(false)
      refetch()
    } catch (err) {
      toast(err.response?.data?.message || 'Error adding tenant', 'error')
    } finally { setSaving(false) }
  }

  const handleVacate = async (id) => {
    if (!confirm('Mark this tenant as vacated? This will also free their bed.')) return
    try {
      await vacateTenant(propertyId, id)
      setProfile(null)
      refetch()
    } catch (err) { toast(err.response?.data?.message || 'Failed to vacate tenant', 'error') }
  }

  const handleDepositToggle = async (id, paid, paidAt = null) => {
    try {
      const extra = paid
        ? { depositBalance: profile?.depositAmount ?? 0, depositStatus: 'held', depositPaidAt: paidAt ?? new Date().toISOString() }
        : { depositPaidAt: null }
      await markDepositPaid(propertyId, id, paid, profile?.depositAmount, paidAt)
      setProfile(prev => prev ? { ...prev, depositPaid: paid, ...extra } : prev)
      refetch()
      if (paid) toast(`Deposit ₹${(profile?.depositAmount ?? 0).toLocaleString('en-IN')} marked as collected`, 'success')
    } catch (err) { toast(err.response?.data?.message || 'Error updating deposit status', 'error') }
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
          {allTenants.length > 0 && (
            <p className="text-sm text-slate-400">
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
        <NoPropertyState />
      ) : loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : (
        <>
          {/* ── Stat Cards ── */}
          {allTenants.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-1">
              <StatCard label="Total Tenants" value={stats.total} icon={Users}
                sub={`${stats.active} active`} />
              <StatCard label="Active" value={stats.active} icon={CheckCircle} color="emerald"
                sub={stats.notice > 0 ? `${stats.notice} on notice` : undefined} />
              <StatCard label="Pending Rent" value={fmt(stats.pendingRentTotal)} icon={IndianRupee}
                color={stats.pendingRentCount > 0 ? 'amber' : 'default'}
                sub={stats.pendingRentCount > 0 ? `${stats.pendingRentCount} tenant${stats.pendingRentCount > 1 ? 's' : ''}` : 'none'} />
              <StatCard label="Vacated (30d)" value={stats.recentlyVacated} icon={UserMinus} color="slate" />
            </div>
          )}

          {/* ── Action Required Bar ── */}
          {allTenants.length > 0 && (
            <ActionBar
              incomplete={stats.incomplete}
              pendingRentCount={stats.pendingRentCount}
              onIncompleteClick={() => onStatClick('profile', 'incomplete')}
              onPendingRentClick={() => onStatClick('rentStatus', 'pending_overdue')}
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
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/60">
                      {['Tenant', 'Room / Bed', 'Rent', 'Outstanding', 'Billing', 'Status', 'Profile', ''].map((h, i) => (
                        <th key={i} className="px-4 py-3.5 text-left text-[10px] font-semibold text-slate-400 uppercase tracking-wider whitespace-nowrap">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50/80 bg-white">
                    {paginated.map(t => (
                      <TenantRow
                        key={t._id}
                        tenant={t}
                        onView={setProfile}
                        onQuickPay={openQuickPay}

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
          onVacate={handleBulkVacate}
          onExport={handleExportCSV}
          onClear={clearSelection}
        />
      )}

      {/* ── Quick Collect Payment Modal ── */}
      {quickPay && (
        <Modal onClose={() => !qpBusy && setQuickPay(null)} title="Collect Payment" size="sm">
          <div className="flex flex-col gap-4">
            {/* Tenant info */}
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-3">
              <Avatar name={quickPay.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-800 truncate">{quickPay.name}</p>
                <p className="text-xs text-slate-400">{quickPay.phone}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">Pending</p>
                <p className="text-sm font-bold text-red-600 tabular-nums">
                  {fmt(quickPay.ledgerBalance > 0 ? quickPay.ledgerBalance : 0)}
                </p>
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="label text-xs">Amount (₹) *</label>
              <input type="number" min="1" className="input text-sm" autoFocus
                placeholder="0" value={qpAmt} onChange={e => setQpAmt(e.target.value)} />
            </div>

            {/* Method */}
            <div>
              <label className="label text-xs">Payment Method</label>
              <select className="input text-sm" value={qpMethod} onChange={e => setQpMethod(e.target.value)}>
                {filteredQpMethods.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>

            {/* Reference / UTR */}
            <div>
              <label className="label text-xs">
                Reference / UTR <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                className="input text-sm"
                placeholder="UPI ref, cheque number..."
                value={qpRef}
                onChange={e => setQpRef(e.target.value)}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="label text-xs">
                Notes <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <textarea
                className="input text-sm resize-none"
                rows={2}
                placeholder="Payment notes..."
                value={qpNotes}
                onChange={e => setQpNotes(e.target.value)}
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2.5 pt-1">
              <button className="btn-secondary flex-1 text-sm py-2.5" onClick={() => setQuickPay(null)} disabled={qpBusy}>Cancel</button>
              <button
                disabled={qpBusy || !Number(qpAmt) || Number(qpAmt) <= 0}
                onClick={handleQuickPay}
                className="flex-1 rounded-xl bg-[#60C3AD] hover:bg-[#4fa898] px-4 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-50">
                {qpBusy ? 'Recording…' : `Collect ₹${Number(qpAmt) > 0 ? Number(qpAmt).toLocaleString('en-IN') : '0'}`}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Add Tenant Modal ── */}
      {showAdd && (
        <Modal title="Add New Tenant" onClose={() => setShowAdd(false)} disableBackdropClose size="md">
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
          width="max-w-2xl"
          bodyClassName="flex-1 overflow-hidden flex flex-col"
        >
          <TenantProfile
            tenant={profile}
            propertyId={propertyId}
            onVacate={() => { setProfile(null); refetch() }}
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
