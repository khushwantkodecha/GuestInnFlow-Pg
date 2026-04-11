import { useState, useEffect, useMemo, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Plus, Phone, Mail, BedDouble, Calendar, Calculator,
  UserX, IndianRupee, User, Hash,
  FileText, ShieldCheck, Upload, Link,
  Search, X, RotateCcw, Eye, MessageCircle,
  Check, CheckCircle, AlertCircle, Download, Clock,
} from 'lucide-react'
import { getTenants, getTenant, createTenant, vacateTenant, markDepositPaid, getTenantRents } from '../api/tenants'
import { getRooms, getBeds } from '../api/rooms'
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
const computeRentStatus = (tenant) => {
  if (!tenant || tenant.status === 'vacated') return null
  const today   = new Date()
  const dueDay  = tenant.dueDate ?? 1
  const todayDay = today.getDate()
  const diff    = todayDay - dueDay  // positive = past due, negative = before due
  if (diff < -3)                  return 'current'
  if (diff >= -3 && diff < 0)     return 'due_soon'
  if (diff >= 0  && diff <= 7)    return 'pending'
  return 'overdue'
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

// ── Rent status badge ─────────────────────────────────────────────────────────
const RENT_STATUS_CFG = {
  current:  { label: 'Current',  cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
  due_soon: { label: 'Due Soon', cls: 'text-amber-700 bg-amber-50 border-amber-200' },
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
  checkInDate: '', rentAmount: '', depositAmount: '', dueDate: 1,
  selectedRoomId: '', bedId: '',
}

const AddTenantForm = ({ propertyId, onSubmit, onCancel, saving }) => {
  const [form, setForm] = useState(EMPTY_FORM)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  // Fetch rooms for bed assignment
  const { data: roomData } = useApi(() => getRooms(propertyId), [propertyId])
  const rooms = roomData?.data ?? []

  // Fetch vacant beds when a room is selected
  const [vacantBeds, setVacantBeds] = useState([])
  const [bedsLoading, setBedsLoading] = useState(false)

  useEffect(() => {
    if (!form.selectedRoomId) { setVacantBeds([]); set('bedId', ''); return }
    setBedsLoading(true)
    getBeds(propertyId, form.selectedRoomId)
      .then((res) => setVacantBeds((res.data?.data ?? []).filter((b) => b.status === 'vacant')))
      .finally(() => setBedsLoading(false))
  }, [form.selectedRoomId]) // eslint-disable-line

  const handleSubmit = (e) => {
    e.preventDefault()
    const { selectedRoomId, ...rest } = form
    onSubmit({
      ...rest,
      rentAmount:    Number(rest.rentAmount),
      depositAmount: Number(rest.depositAmount) || 0,
      dueDate:       Number(rest.dueDate),
      bedId:         rest.bedId || undefined,
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
          <div>
            <label className="label">Phone *</label>
            <PhoneInput value={form.phone} onChange={(v) => set('phone', v)} />
          </div>
          <div>
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
            <label className="label">Due Day (1–28)</label>
            <input type="number" min="1" max="28" className="input" value={form.dueDate}
              onChange={(e) => set('dueDate', e.target.value)} />
          </div>
        </div>
      </div>

      {/* Bed assignment */}
      <div>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">
          Assign Bed <span className="text-slate-300 font-normal normal-case tracking-normal">(optional)</span>
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Room</label>
            <select className="input" value={form.selectedRoomId}
              onChange={(e) => { set('selectedRoomId', e.target.value); set('bedId', '') }}>
              <option value="">Select room…</option>
              {rooms.map((r) => (
                <option key={r._id} value={r._id}>Room {r.roomNumber} ({r.type})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Vacant Bed</label>
            <select className="input" value={form.bedId} onChange={(e) => set('bedId', e.target.value)}
              disabled={!form.selectedRoomId || bedsLoading}>
              <option value="">{bedsLoading ? 'Loading…' : 'Select bed…'}</option>
              {vacantBeds.map((b) => (
                <option key={b._id} value={b._id}>Bed {b.bedNumber}</option>
              ))}
            </select>
            {form.selectedRoomId && !bedsLoading && vacantBeds.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">No vacant beds in this room</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-1 border-t border-slate-100">
        <button type="button" className="btn-secondary flex-1" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn-primary flex-1" disabled={saving}>
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

const RentHistoryItem = ({ rent }) => {
  const statusColor = {
    paid:    'text-emerald-700 bg-emerald-50 border border-emerald-200',
    pending: 'text-amber-700 bg-amber-50 border border-amber-200',
    overdue: 'text-red-700 bg-red-50 border border-red-200',
  }
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return (
    <div className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
      <div>
        <p className="text-sm font-medium text-slate-700">{months[rent.month - 1]} {rent.year}</p>
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

  // ── Editable state ──
  const [editing, setEditing] = useState(null) // 'personal' | 'documents' | 'agreement' | 'notes'
  const [saving, setSaving]   = useState(false)
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
    dueDate:          t.dueDate ?? 1,
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
            { label: 'Monthly Rent', value: fmt(t.rentAmount) },
            { label: 'Total Paid', value: fmt(totalPaid) },
            { label: 'Deposit', value: fmt(t.depositAmount) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-white border border-slate-100 px-3 py-2.5 text-center">
              <p className="text-[10px] text-slate-400 font-medium">{label}</p>
              <p className="text-sm font-bold text-slate-700 mt-0.5 tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Scrollable Sections ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

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
                <label className="label text-xs">Due Day (1-28)</label>
                <input type="number" min="1" max="28" className="input text-sm" value={form.dueDate} onChange={e => set('dueDate', e.target.value)} />
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
              <Field label="Start Date"   value={fdate(t.checkInDate)} />
              <Field label="End Date"     value={fdate(t.checkOutDate)} />
              <Field label="Monthly Rent" value={fmt(t.rentAmount)} />
              <Field label="Deposit"      value={fmt(t.depositAmount)} />
              <Field label="Due Date"     value={t.dueDate ? `${t.dueDate}th of every month` : null} />
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

          {/* Deposit toggle */}
          {t.depositAmount > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 bg-white">
              <div>
                <p className="text-xs font-medium text-slate-700">Deposit Collected</p>
                <p className="text-xs text-slate-400 mt-0.5">{fmt(t.depositAmount)}</p>
              </div>
              <button
                onClick={() => onDepositToggle(t._id, !t.depositPaid)}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                  t.depositPaid ? 'bg-primary-500' : 'bg-slate-200'
                }`}
              >
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  t.depositPaid ? 'translate-x-[18px]' : 'translate-x-[3px]'
                }`} />
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
        {t.billingSnapshot?.finalRent != null && (() => {
          const snap = t.billingSnapshot
          const rentLabel = snap.rentType === 'per_room' ? 'Per Room' : 'Per Bed'
          const showConsistencyWarning = snap.rentType === 'per_room'
            && snap.roomCapacity > 1
            && snap.occupiedAtAssign < (snap.roomCapacity - 1)
          return (
            <div className="space-y-2">
              <SectionTitle icon={Calculator} title="Rent Details" />
              <div className="card px-4">
                {/* Monthly Rent */}
                <div className="py-2.5 border-b border-slate-100">
                  <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Monthly Rent</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-lg font-bold text-slate-800 tabular-nums">{fmt(snap.finalRent)}</p>
                    {snap.isEarlyOccupant && (
                      <span className="text-[9px] font-bold uppercase tracking-wider text-violet-600 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5">
                        ✦ Early occupant
                      </span>
                    )}
                  </div>
                </div>
                {/* Rent Type */}
                <div className="py-2.5 border-b border-slate-100">
                  <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Rent Type</p>
                  <span className={`inline-flex items-center mt-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
                    snap.rentType === 'per_room'
                      ? 'bg-blue-50 text-blue-600 border border-blue-200'
                      : 'bg-slate-100 text-slate-600 border border-slate-200'
                  }`}>
                    {rentLabel}
                  </span>
                </div>
                {/* Calculation (per_room only) */}
                {snap.rentType === 'per_room' && snap.divisorUsed && (
                  <div className="py-2.5 border-b border-slate-100">
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Calculation</p>
                    <p className="text-sm font-medium text-slate-700 mt-0.5 tabular-nums">
                      {fmt(snap.baseRent)} ÷ {snap.divisorUsed} = {fmt(snap.finalRent)}
                    </p>
                  </div>
                )}
                {/* Occupancy at assignment */}
                {snap.occupiedAtAssign != null && (
                  <div className="py-2.5 border-b border-slate-100">
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Occupancy at Assignment</p>
                    <p className="text-sm font-medium text-slate-700 mt-0.5">
                      {snap.occupiedAtAssign + 1} / {snap.roomCapacity ?? '—'} beds
                    </p>
                  </div>
                )}
                {/* Override indicator with source */}
                {snap.overrideApplied && (
                  <div className="py-2.5 border-b border-slate-100">
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Override</p>
                    <p className="text-xs text-amber-600 font-medium mt-0.5">
                      ⚡ {snap.overrideSource === 'bed' ? 'Bed-level override' : 'Manual override'} was applied
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

        {/* ── F. Rent & Payment ── */}
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
      await markDepositPaid(propertyId, id, paid)
      setProfile(prev => prev ? { ...prev, depositPaid: paid } : prev)
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
        <Modal title="Add Tenant" onClose={() => setShowAdd(false)}>
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
