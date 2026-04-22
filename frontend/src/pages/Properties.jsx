import { useState, useMemo, useRef, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Pencil, Trash2, MapPin, Building2, RotateCcw, X,
  AlertTriangle, BedDouble, Users, IndianRupee, ArrowRight,
  CheckCircle2, Search,
  TrendingUp, AlertOctagon, FileText, MoreVertical,
} from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  getAllProperties, createProperty, updateProperty,
  deleteProperty, reactivateProperty,
  getAllPropertyStats, getPropertyAnalytics,
  permanentDeleteProperty,
} from '../api/properties'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import { useToast } from '../context/ToastContext'
import { PropertyCardSkeleton, StatsSkeleton } from '../components/ui/Skeleton'
import Modal from '../components/ui/Modal'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt = (n) => `₹${(n ?? 0).toLocaleString('en-IN')}`


const EMPTY_FORM = {
  name: '', description: '', isActive: true,
  address: { street: '', city: '', state: '', pincode: '' },
}

const formEqual = (a, b) =>
  a.name        === b.name        &&
  a.description === b.description &&
  a.isActive    === b.isActive    &&
  a.address?.street  === b.address?.street  &&
  a.address?.city    === b.address?.city    &&
  a.address?.state   === b.address?.state   &&
  a.address?.pincode === b.address?.pincode



// ── Property Form ─────────────────────────────────────────────────────────────
const PropertyForm = ({ initial = EMPTY_FORM, onSubmit, saving, onCancel, isAdd, onTitleChange, onDirtyChange, onDelete }) => {
  const [form, setForm]         = useState({ isActive: true, type: 'pg', ...initial })
  const [errors, setErrors]     = useState({})
  const [notesOpen, setNotesOpen] = useState(!!(initial.description))

  const set = (k, v) => {
    const next = { ...form, [k]: v }
    setForm(next)
    setErrors((e) => ({ ...e, [k]: null }))
    if (onTitleChange && k === 'name') onTitleChange(v)
    if (onDirtyChange) onDirtyChange(!formEqual(next, initial))
  }

  const setAddr = (k, v) => {
    const next = { ...form, address: { ...form.address, [k]: v } }
    setForm(next)
    if (onDirtyChange) onDirtyChange(!formEqual(next, initial))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const trimmed = form.name.trim()
    if (!trimmed) { setErrors({ name: 'Property name is required' }); return }
    onSubmit({ ...form, name: trimmed })
  }

  const canSubmit = form.name.trim().length > 0 && !saving

  // Live preview display values
  const previewName = form.name.trim() || (isAdd ? 'Your PG / Hostel Name' : initial.name)
  const previewCity = form.address?.city?.trim() || form.address?.state?.trim() || 'City, State'

  return (
    <form onSubmit={handleSubmit} className="-mx-5 -mt-5 flex flex-col">

      {/* ── Gradient header ── */}
      <div className="bg-gradient-to-br from-primary-500 to-primary-700 px-5 pt-5 pb-5 rounded-t-2xl">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-[17px] font-bold text-white leading-tight">
              {isAdd ? 'Add New Property' : 'Edit Property'}
            </h2>
            <p className="text-[11px] text-primary-200 mt-0.5">
              {isAdd ? 'Set up your PG / Hostel in seconds' : 'Update your property details'}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1.5 text-primary-300 hover:text-white hover:bg-white/15 transition-colors shrink-0"
            aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {/* Live preview card */}
        <div className="rounded-xl bg-white/15 border border-white/20 px-4 py-3 flex items-center gap-3 backdrop-blur-sm">
          <div className="h-9 w-9 rounded-xl bg-white/20 border border-white/25 flex items-center justify-center shrink-0">
            <Building2 size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className={`text-sm font-bold leading-tight truncate transition-all ${
              form.name.trim() ? 'text-white' : 'text-white/40 italic'
            }`}>
              {previewName}
            </p>
            <p className={`text-[11px] mt-0.5 transition-all ${
              (form.address?.city || form.address?.state) ? 'text-primary-200' : 'text-white/30 italic'
            }`}>
              {previewCity}
            </p>
          </div>
          <span className="shrink-0 ml-auto text-[9px] font-black uppercase tracking-widest text-primary-300 bg-white/15 rounded-full px-2 py-0.5">
            PG / Hostel
          </span>
        </div>
      </div>

      {/* ── Form body ── */}
      <div className="px-5 py-5 space-y-5 overflow-y-auto">

        {/* ── Property Name ── */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
            Property Name <span className="text-red-400 normal-case tracking-normal font-semibold">*</span>
          </label>
          <input
            autoFocus
            data-testid="property-name-input"
            className={`input text-sm font-medium ${
              errors.name
                ? 'border-red-400 focus:ring-red-400/20 focus:border-red-400'
                : form.name.trim()
                  ? 'border-primary-300 ring-1 ring-primary-200/60'
                  : ''
            }`}
            placeholder="e.g. Green Valley PG"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
          {errors.name ? (
            <p className="text-xs text-red-500 flex items-center gap-1.5">
              <AlertTriangle size={11} className="shrink-0" />
              {errors.name}
            </p>
          ) : (
            <p className="text-[10px] text-slate-400">
              This name will appear across all reports and tenant communications
            </p>
          )}
        </div>

        {/* ── Location ── */}
        <div className="space-y-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
            <MapPin size={10} className="text-slate-400" /> Location
          </p>
          <input
            className="input text-sm"
            placeholder="Street address (e.g. 12 MG Road, Indiranagar)"
            value={form.address?.street ?? ''}
            onChange={(e) => setAddr('street', e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              className="input text-sm"
              placeholder="City"
              value={form.address?.city ?? ''}
              onChange={(e) => setAddr('city', e.target.value)}
            />
            <input
              className="input text-sm"
              placeholder="State"
              value={form.address?.state ?? ''}
              onChange={(e) => setAddr('state', e.target.value)}
            />
          </div>
          <input
            className="input text-sm w-36"
            placeholder="Pincode"
            maxLength={6}
            value={form.address?.pincode ?? ''}
            onChange={(e) => setAddr('pincode', e.target.value)}
          />
        </div>

        {/* ── Notes — collapsible ── */}
        <div className="rounded-xl border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setNotesOpen(v => !v)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-slate-50 transition-colors">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <FileText size={13} className="text-slate-400" />
              Notes
              {form.description?.trim() && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 inline-block" />
              )}
            </div>
            <span className="text-[10px] text-slate-400 font-medium">
              {notesOpen ? 'Hide ▲' : 'Add ▼'}
            </span>
          </button>
          {notesOpen && (
            <div className="px-3.5 pb-3.5 border-t border-slate-100">
              <textarea
                className="input text-sm mt-2.5 resize-none"
                rows={3}
                placeholder="Add amenities, house rules, or anything useful for tenants (e.g. AC, WiFi, no alcohol, veg only)…"
                value={form.description ?? ''}
                onChange={(e) => set('description', e.target.value)}
              />
              <p className="text-[10px] text-slate-400 mt-1.5">Visible to you only — not shown to tenants directly</p>
            </div>
          )}
        </div>

        {/* ── Danger zone (edit mode only) ── */}
        {!isAdd && onDelete && (
          <div className="rounded-xl border border-red-100 bg-red-50/50 px-4 py-3.5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold text-red-700">Danger Zone</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Deactivate this property and hide it from all views</p>
            </div>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); onDelete() }}
              className="shrink-0 flex items-center gap-1.5 rounded-xl border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 hover:border-red-300 transition-colors">
              <Trash2 size={12} /> Deactivate
            </button>
          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="px-5 pb-5 pt-0 flex gap-2.5 border-t border-slate-100">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
          Cancel
        </button>
        <button
          type="submit"
          data-testid="property-submit-btn"
          disabled={!canSubmit}
          className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white
            bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700
            disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-primary-200/50 active:scale-[0.98]">
          {saving ? (
            <>
              <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              {isAdd ? 'Creating…' : 'Saving…'}
            </>
          ) : (
            <>
              {isAdd ? <><Plus size={15} /> Create Property</> : <><CheckCircle2 size={15} /> Save Changes</>}
            </>
          )}
        </button>
      </div>
    </form>
  )
}

// ── Analytics Drawer ──────────────────────────────────────────────────────────
const AnalyticsDrawer = ({ property, onClose }) => {
  const { data, loading } = useApi(() => getPropertyAnalytics(property._id), [property._id])
  const trend   = data?.data?.trend ?? []
  // API always returns 6 month buckets; treat as "no data" when all collected+expected are zero
  const hasData = trend.some((m) => m.collected > 0 || m.expected > 0)

  return (
    <Modal title={`Analytics — ${property.name}`} onClose={onClose}>
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-primary-500" />
        </div>
      ) : !hasData ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm font-semibold text-slate-500">No rent data yet</p>
          <p className="text-[11px] text-slate-400 leading-relaxed max-w-xs">
            Analytics appear once tenants are assigned and rent is active.
            Visit the <span className="font-medium text-primary-500">Rent</span> page to generate this month's records.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Collected Rent chart */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
              Collected Rent — Last 6 Months
            </p>
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="rentGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#60c3ad" stopOpacity={0.20} />
                    <stop offset="95%" stopColor="#60c3ad" stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis hide />
                <Tooltip
                  formatter={(v) => [fmt(v), 'Collected']}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#334155' }}
                />
                <Area type="monotone" dataKey="collected" stroke="#60c3ad" strokeWidth={2}
                  fill="url(#rentGrad)" dot={{ r: 3, fill: '#60c3ad' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Collection rate chart */}
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3">
              Collection Rate % — Last 6 Months
            </p>
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={trend} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="occGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#22C55E" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#22C55E" stopOpacity={0}   />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                <YAxis hide domain={[0, 100]} />
                <Tooltip
                  formatter={(v) => [`${v}%`, 'Collection Rate']}
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #E2E8F0', background: '#fff', color: '#334155' }}
                />
                <Area type="monotone" dataKey="collectionRate" stroke="#22C55E" strokeWidth={2}
                  fill="url(#occGrad)" dot={{ r: 3, fill: '#22C55E' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Monthly table */}
          <div className="rounded-xl overflow-hidden border border-slate-200">
            <table className="min-w-full text-xs">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-slate-400 uppercase tracking-wide">Month</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-400 uppercase tracking-wide">Expected</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-400 uppercase tracking-wide">Collected</th>
                  <th className="px-4 py-2.5 text-right font-semibold text-slate-400 uppercase tracking-wide">Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trend.map((row) => (
                  <tr key={`${row.year}-${row.month}`} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-2.5 font-medium text-slate-700">{row.label}</td>
                    <td className="px-4 py-2.5 text-right text-slate-400">{fmt(row.expected)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold text-slate-700">{fmt(row.collected)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-semibold ${row.collectionRate >= 80 ? 'text-emerald-600' : row.collectionRate >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                        {row.collectionRate}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  )
}

// ── Hard Delete Modal ─────────────────────────────────────────────────────────
const HardDeleteModal = ({ property, onConfirm, onCancel, loading }) => {
  const [typed, setTyped] = useState('')
  const confirmed = typed === property.name

  return (
    <Modal title="Permanent Delete" onClose={onCancel}>
      <div className="mb-5 flex items-start gap-3 rounded-xl px-4 py-4 bg-red-50 border border-red-200">
        <AlertOctagon size={20} className="shrink-0 mt-0.5 text-red-500" />
        <div>
          <p className="text-sm font-bold text-red-700">This action is irreversible</p>
          <p className="text-sm text-red-600 mt-1">
            Permanently deleting <span className="font-semibold">{property.name}</span> will also
            delete all its rooms and beds. Tenant history and rent records are kept.
          </p>
        </div>
      </div>
      <div className="mb-5">
        <label className="label">Type <span className="font-bold text-slate-800">{property.name}</span> to confirm</label>
        <input
          data-testid="hard-delete-confirm-input"
          className="input"
          placeholder={property.name}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel} disabled={loading}>Cancel</button>
        <button
          data-testid="hard-delete-confirm-btn"
          disabled={!confirmed || loading}
          onClick={onConfirm}
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
        >
          <Trash2 size={14} />
          {loading ? 'Deleting…' : 'Permanently Delete'}
        </button>
      </div>
    </Modal>
  )
}

// ── Confirm Modal ─────────────────────────────────────────────────────────────
const ConfirmModal = ({ type, property, onConfirm, onCancel, loading }) => {
  const isDeactivate = type === 'deactivate'
  return (
    <Modal title={isDeactivate ? 'Deactivate Property' : 'Reactivate Property'} onClose={onCancel}>
      <div className={`mb-5 flex items-start gap-3 rounded-xl px-4 py-4 border
        ${isDeactivate ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'}`}>
        <AlertTriangle size={18} className={`shrink-0 mt-0.5 ${isDeactivate ? 'text-red-500' : 'text-emerald-600'}`} />
        <div>
          <p className="text-sm font-semibold text-slate-800">{property.name}</p>
          <p className="text-sm text-slate-500 mt-1">
            {isDeactivate
              ? 'This property will be hidden from the sidebar and all pages. You can reactivate it anytime.'
              : 'This property will be restored and visible in the sidebar and dropdown again.'}
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel} disabled={loading}>Cancel</button>
        <button
          onClick={onConfirm} disabled={loading}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 shadow-sm
            ${isDeactivate ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}
        >
          {isDeactivate
            ? <><Trash2 size={14} />{loading ? 'Deactivating…' : 'Deactivate'}</>
            : <><RotateCcw size={14} />{loading ? 'Reactivating…' : 'Reactivate'}</>
          }
        </button>
      </div>
    </Modal>
  )
}

// ── Quick Setup Modal ─────────────────────────────────────────────────────────
const QuickSetupModal = ({ propertyName, onSetupRooms, onSkip }) => (
  <Modal title="" onClose={onSkip}>
    <div className="text-center py-2">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 border border-emerald-200">
        <CheckCircle2 size={28} className="text-emerald-500" />
      </div>
      <p className="text-xs font-bold uppercase tracking-widest text-emerald-600 mb-2">
        Created successfully
      </p>
      <h2 className="text-lg font-bold text-slate-800 mb-1">{propertyName}</h2>
      <p className="text-sm text-slate-500 mb-6">
        Your property is ready. Would you like to set up rooms and beds now?
      </p>
      <div className="flex flex-col gap-2">
        <button onClick={onSetupRooms} className="btn-primary justify-center py-2.5 text-sm">
          <BedDouble size={16} /> Set Up Rooms Now
          <ArrowRight size={14} className="ml-auto" />
        </button>
        <button onClick={onSkip} className="btn-secondary justify-center py-2 text-sm">
          Maybe Later
        </button>
      </div>
    </div>
  </Modal>
)

// ── Property Card ─────────────────────────────────────────────────────────────
const PropertyCard = ({ property: p, stats, highlight, onEdit, onDelete, onReactivate, onAnalytics, onHardDelete, onView, onManage, onAddRoom }) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef   = useRef(null)
  const inactive  = !p.isActive
  const s         = stats
  const occupancy = s ? s.occupancyRate : null
  const isSetupPending = s && s.totalBeds === 0

  const occColor = occupancy === null ? 'text-slate-400'
    : occupancy >= 80 ? 'text-emerald-600' : occupancy >= 50 ? 'text-amber-600' : 'text-slate-500'
  const occBar = occupancy === null ? 'bg-slate-200'
    : occupancy >= 80 ? 'bg-emerald-500' : occupancy >= 50 ? 'bg-amber-400' : 'bg-primary-500'

  // Status badge — wait for stats before deciding Active vs Setup Pending
  const statusBadge = inactive
    ? { cls: 'bg-red-50 text-red-600 border-red-200',       label: 'Inactive'       }
    : !s
      ? { cls: 'bg-slate-100 text-slate-400 border-slate-200', label: '·  ·  ·'       }
      : isSetupPending
        ? { cls: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Setup Pending' }
        : { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Active'  }

  // Dynamic alerts
  const alerts = []
  if (!inactive && s) {
    if (s.totalBeds === 0) {
      alerts.push({ msg: 'Add rooms & beds to start tracking', icon: AlertTriangle })
    } else if (s.activeTenants === 0) {
      alerts.push({ msg: 'No active tenants assigned yet', icon: AlertTriangle })
    }
  }

  useEffect(() => {
    if (!menuOpen) return
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  return (
    <div
      data-testid={`property-card-${p._id}`}
      className={`relative rounded-2xl overflow-visible flex flex-col bg-white border transition-all duration-300
        ${inactive
          ? 'opacity-60 border-slate-200'
          : 'border-slate-200 hover:-translate-y-1 hover:shadow-[0_8px_32px_rgba(0,0,0,.10)] hover:border-slate-300 cursor-default'}
        ${highlight ? 'ring-2 ring-primary-400 ring-offset-2 animate-highlightFade' : ''}`}>

      {/* Accent stripe */}
      <div className={`h-1 w-full shrink-0 rounded-t-2xl ${inactive ? 'bg-slate-200' : `bg-gradient-to-r from-primary-500 to-primary-700`}`} />

      {/* ── HEADER ── */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2">
          {/* Icon + name + location */}
          <div className="flex items-center gap-3 min-w-0">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-sm
              ${inactive ? 'bg-slate-100' : `bg-gradient-to-br from-primary-500 to-primary-700`}`}>
              <Building2 size={18} className={inactive ? 'text-slate-400' : 'text-white'} />
            </div>
            <div className="min-w-0">
              <h3 className="font-bold text-slate-800 truncate text-[15px] leading-tight">{p.name}</h3>
              {(p.address?.city || p.address?.state) ? (
                <div className="flex items-center gap-1 mt-0.5 text-[11px] text-slate-400">
                  <MapPin size={9} className="shrink-0" />
                  <span className="truncate">{[p.address.city, p.address.state].filter(Boolean).join(', ')}</span>
                </div>
              ) : (
                <p className="mt-0.5 text-[11px] text-slate-400 italic">No address set</p>
              )}
            </div>
          </div>

          {/* Status badge */}
          <span className={`shrink-0 mt-0.5 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border ${statusBadge.cls}`}>
            {statusBadge.label}
          </span>
        </div>
      </div>

      {/* ── BODY ── */}
      {!inactive ? (
        s ? (
          <div className="flex-1 flex flex-col px-4 pb-3 gap-2.5">
            <div className="border-t border-slate-100 pt-3 space-y-3">

              {/* ── KPI STRIP ── */}
              <div className="grid grid-cols-4 gap-0 divide-x divide-slate-100 rounded-xl bg-slate-50 border border-slate-200 overflow-hidden">
                {[
                  {
                    label: 'Rent',
                    value: `₹${(s.totalRevenue ?? 0).toLocaleString('en-IN')}`,
                    cls: 'text-slate-800',
                    small: true,
                  },
                  {
                    label: 'Occupancy',
                    value: occupancy !== null ? `${occupancy}%` : '—',
                    cls: occColor,
                    small: false,
                  },
                  {
                    label: 'Tenants',
                    value: String(s.activeTenants),
                    cls: 'text-slate-800',
                    small: false,
                  },
                  {
                    label: 'Beds',
                    value: `${s.occupiedBeds}/${s.totalBeds}`,
                    cls: 'text-slate-800',
                    small: false,
                    note: s.extraBeds > 0 ? `+${s.extraBeds}X` : null,
                  },
                ].map(({ label, value, cls, small, note }) => (
                  <div key={label} className="flex flex-col items-center text-center py-2.5 px-1">
                    <p className={`font-bold leading-tight tabular-nums ${small ? 'text-[11px]' : 'text-[13px]'} ${cls}`}>{value}</p>
                    <p className="text-[9px] font-medium text-slate-400 uppercase tracking-wide mt-0.5">{label}</p>
                    {note && <span className="text-[8px] font-bold text-violet-500 mt-0.5">✦ {note}</span>}
                  </div>
                ))}
              </div>

              {/* ── OCCUPANCY BAR (only when beds exist) ── */}
              {s.totalBeds > 0 && occupancy !== null && (
                <div>
                  <div className="flex items-center justify-between text-[10px] mb-1.5">
                    <span className="text-slate-400 font-medium">Occupancy</span>
                    <span className={`font-bold tabular-nums ${occColor}`}>{occupancy}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100">
                    <div className={`h-1.5 rounded-full transition-all duration-700 ${occBar}`} style={{ width: `${occupancy}%` }} />
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="flex items-center gap-1 text-[9px] text-slate-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                      {s.occupiedBeds} occupied
                    </span>
                    <span className="flex items-center gap-1 text-[9px] text-slate-400">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                      {s.vacantBeds} vacant
                      {s.extraVacant > 0 && <span className="text-violet-400 font-semibold">+{s.extraVacant}X</span>}
                    </span>
                  </div>
                </div>
              )}

              {/* ── ALERTS ── */}
              {alerts.length > 0 && (
                <div className="space-y-1.5">
                  {alerts.map((a, i) => (
                    <div key={i} className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[10px] font-medium text-amber-700">
                      <a.icon size={10} className="shrink-0" />
                      {a.msg}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 px-4 pb-3"><StatsSkeleton /></div>
        )
      ) : (
        /* Inactive state */
        <div className="flex-1 px-4 pb-4">
          <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-4 flex items-center justify-between gap-3">
            <button onClick={(e) => { e.stopPropagation(); onReactivate(p._id) }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200 transition-colors">
              <RotateCcw size={12} /> Reactivate
            </button>
            <button onClick={(e) => { e.stopPropagation(); onHardDelete(p) }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors">
              <Trash2 size={12} /> Delete Forever
            </button>
          </div>
        </div>
      )}

      {/* ── FOOTER ACTIONS ── */}
      {!inactive && (
        <div className="px-4 pb-4 pt-1 flex items-center gap-2">
          {/* Primary: Manage Property */}
          <button
            onClick={(e) => { e.stopPropagation(); onManage?.(p) }}
            className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold
              bg-gradient-to-r from-primary-500 to-primary-700 text-white hover:opacity-90 active:scale-[.98] transition-all shadow-sm`}>
            Manage Property <ArrowRight size={13} />
          </button>

          {/* Secondary: Add Room */}
          <button
            onClick={(e) => { e.stopPropagation(); onAddRoom?.(p) }}
            className="flex items-center justify-center gap-1 rounded-xl border border-slate-200 px-3 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-colors whitespace-nowrap shrink-0">
            <Plus size={12} /> Add Room
          </button>

          {/* Overflow menu */}
          <div className="relative shrink-0" ref={menuRef}>
            <button
              data-testid={`overflow-menu-${p._id}`}
              onClick={(e) => { e.stopPropagation(); setMenuOpen(v => !v) }}
              aria-label="Property actions"
              className={`flex items-center justify-center w-9 h-[38px] rounded-xl border transition-colors
                ${menuOpen ? 'bg-slate-100 border-slate-300 text-slate-700' : 'border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}>
              <MoreVertical size={15} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 bottom-full mb-2 w-44 rounded-xl bg-white border border-slate-200 shadow-xl shadow-slate-200/60 overflow-hidden z-20">
                <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onView?.(p) }}
                  data-testid="menu-view-details"
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors">
                  <Building2 size={13} className="text-slate-400" /> View Details
                </button>
                <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onAnalytics(p) }}
                  data-testid="menu-analytics"
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors">
                  <TrendingUp size={13} className="text-slate-400" /> Analytics
                </button>
                <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onEdit(p) }}
                  data-testid="menu-edit"
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors">
                  <Pencil size={13} className="text-slate-400" /> Edit Property
                </button>
                <div className="border-t border-slate-100 my-0.5" />
                <button onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete(p._id) }}
                  data-testid="menu-deactivate"
                  className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-red-500 hover:bg-red-50 transition-colors">
                  <Trash2 size={13} /> Deactivate
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Property Detail Modal ─────────────────────────────────────────────────────
const PropertyDetailModal = ({
  property: p, stats: s, onClose, onEdit, onDelete,
  onAnalytics, onReactivate, onHardDelete, onAddRoom, onAddTenant,
}) => {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef   = useRef(null)
  const inactive  = !p.isActive
  const occupancy  = s?.occupancyRate ?? null
  const noBeds     = s && s.totalBeds === 0
  const noTenants  = s && s.totalBeds > 0 && s.activeTenants === 0

  const occColor = occupancy === null ? 'text-slate-500'
    : occupancy >= 80 ? 'text-emerald-600' : occupancy >= 50 ? 'text-amber-600' : 'text-slate-500'
  const occBar   = occupancy === null ? 'bg-slate-200'
    : occupancy >= 80 ? 'bg-emerald-500' : occupancy >= 50 ? 'bg-amber-400' : 'bg-primary-500'

  useEffect(() => {
    if (!menuOpen) return
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  return (
    <Modal onClose={onClose} size="md">
      {/* ── HERO — bleeds to modal edges ── */}
      <div className="-mx-5 -mt-5 rounded-t-2xl bg-gradient-to-br from-primary-500 to-primary-700 px-5 pt-5 pb-5 mb-5">
        {/* Top row: icon + name + close */}
        <div className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm shadow-sm">
            <Building2 size={22} className="text-white" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-white font-bold text-[18px] leading-tight truncate">{p.name}</h2>
              <button
                onClick={onClose}
                className="shrink-0 rounded-lg p-1 text-white/60 hover:text-white hover:bg-white/15 transition-colors"
                aria-label="Close">
                <X size={17} />
              </button>
            </div>

            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold border
                ${inactive ? 'bg-red-500/30 border-red-400/30 text-white' : 'bg-white/20 border-white/20 text-white'}`}>
                {inactive ? 'Inactive' : 'Active'}
              </span>
            </div>

            {(p.address?.city || p.address?.state) && (
              <div className="flex items-center gap-1 mt-1.5">
                <MapPin size={10} className="text-white/50 shrink-0" />
                <span className="text-white/70 text-xs">
                  {[p.address.city, p.address.state].filter(Boolean).join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Quick-stat pills */}
        {s && (
          <div className="flex items-center gap-2 mt-4 flex-wrap">
            <div className="flex items-center gap-1.5 rounded-lg bg-white/15 border border-white/10 px-2.5 py-1.5">
              <BedDouble size={11} className="text-white/70" />
              <span className="text-white text-[11px] font-semibold">
                {s.occupiedBeds}/{s.totalBeds} beds{s.extraBeds > 0 ? ` · +${s.extraBeds}X` : ''}
              </span>
            </div>
            <div className="flex items-center gap-1.5 rounded-lg bg-white/15 border border-white/10 px-2.5 py-1.5">
              <Users size={11} className="text-white/70" />
              <span className="text-white text-[11px] font-semibold">
                {s.activeTenants} tenant{s.activeTenants !== 1 ? 's' : ''}
              </span>
            </div>
            {occupancy !== null && (
              <div className="flex items-center gap-1.5 rounded-lg bg-white/15 border border-white/10 px-2.5 py-1.5">
                <TrendingUp size={11} className="text-white/70" />
                <span className="text-white text-[11px] font-semibold">{occupancy}% full</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── BODY ── */}
      <div className="space-y-4">

        {/* Description */}
        {p.description && (
          <p className="text-sm text-slate-500 leading-relaxed">{p.description}</p>
        )}

        {/* Address */}
        {(p.address?.street || p.address?.city) && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Address</p>
            <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-3">
              <MapPin size={14} className="text-primary-500 mt-0.5 shrink-0" />
              <p className="text-sm text-slate-600 leading-relaxed">
                {[p.address.street, p.address.city, p.address.state, p.address.pincode].filter(Boolean).join(', ')}
              </p>
            </div>
          </div>
        )}

        {/* Stats sections */}
        {s ? (
          <>
            {/* ── INSIGHT GRID — 2×2 ── */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Overview</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  {
                    label: 'Total Beds', value: s.totalBeds,
                    note: s.extraBeds > 0 ? `+${s.extraBeds} extra` : null,
                    icon: BedDouble, iconCls: 'text-slate-500',
                    iconBg: 'bg-slate-200/70', bg: 'bg-slate-50', border: 'border-slate-200', val: 'text-slate-700',
                  },
                  {
                    label: 'Tenants', value: s.activeTenants,
                    icon: Users, iconCls: 'text-violet-500',
                    iconBg: 'bg-violet-200/60', bg: 'bg-violet-50', border: 'border-violet-200', val: 'text-violet-700',
                  },
                  {
                    label: 'Vacant', value: s.vacantBeds,
                    note: s.extraVacant > 0 ? `+${s.extraVacant} extra` : null,
                    icon: CheckCircle2, iconCls: 'text-emerald-500',
                    iconBg: 'bg-emerald-200/60', bg: 'bg-emerald-50', border: 'border-emerald-200', val: 'text-emerald-600',
                  },
                  {
                    label: 'Occupied', value: s.occupiedBeds,
                    icon: Users, iconCls: 'text-blue-500',
                    iconBg: 'bg-blue-200/60', bg: 'bg-blue-50', border: 'border-blue-200', val: 'text-blue-600',
                  },
                ].map(({ label, value, note, icon: Icon, iconCls, iconBg, bg, border, val }) => (
                  <div key={label} className={`flex items-center gap-3 rounded-xl ${bg} border ${border} px-3.5 py-3`}>
                    <div className={`h-8 w-8 rounded-lg ${iconBg} flex items-center justify-center shrink-0`}>
                      <Icon size={15} className={iconCls} />
                    </div>
                    <div>
                      <p className={`text-xl font-bold leading-none ${val}`}>{value}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{label}</p>
                      {note && <p className="text-[9px] font-bold text-violet-500 mt-0.5">✦ {note}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── RENT SECTION ── */}
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Rent</p>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-4 space-y-3">
                {/* Rent + Occupancy % */}
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mb-0.5">Monthly Rent</p>
                    <p className="flex items-baseline gap-0.5 text-[22px] font-bold text-slate-800 leading-none">
                      <IndianRupee size={15} className="text-primary-500 mb-px" />
                      {(s.totalRevenue ?? 0).toLocaleString('en-IN')}
                    </p>
                    {s.extraRevenue > 0 && (
                      <p className="text-[10px] text-slate-400 mt-1">
                        ₹{(s.normalRevenue ?? 0).toLocaleString('en-IN')} base · ₹{(s.extraRevenue ?? 0).toLocaleString('en-IN')} extra
                      </p>
                    )}
                  </div>
                  {occupancy !== null && (
                    <div className="text-right">
                      <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mb-0.5">Occupancy</p>
                      <p className={`text-[22px] font-bold leading-none ${occColor}`}>{occupancy}%</p>
                    </div>
                  )}
                </div>

                {/* Occupancy bar */}
                {occupancy !== null && (
                  <>
                    <div className="h-2 w-full rounded-full bg-slate-200">
                      <div className={`h-2 rounded-full transition-all duration-700 ${occBar}`} style={{ width: `${occupancy}%` }} />
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                        {s.occupiedBeds} occupied
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                        {s.vacantBeds} vacant
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* ── EMPTY STATE: no rooms/beds set up ── */}
            {noBeds && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-5 py-5 flex flex-col items-center gap-3 text-center">
                <div className="h-11 w-11 rounded-xl bg-slate-100 flex items-center justify-center shadow-sm">
                  <BedDouble size={20} className="text-slate-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600">No rooms set up yet</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    Add rooms and beds first to start tracking occupancy and rent
                  </p>
                </div>
                {onAddRoom && (
                  <button
                    onClick={() => { onClose(); onAddRoom() }}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-primary-50 text-primary-600 hover:bg-primary-100 border border-primary-200 transition-colors">
                    <Plus size={12} /> Add Room
                  </button>
                )}
              </div>
            )}

            {/* ── EMPTY STATE: beds exist but no tenants ── */}
            {noTenants && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-5 py-5 flex flex-col items-center gap-3 text-center">
                <div className="h-11 w-11 rounded-xl bg-slate-100 flex items-center justify-center shadow-sm">
                  <Users size={20} className="text-slate-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600">No tenants yet</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    Rooms are ready — assign tenants to start tracking rent
                  </p>
                </div>
                {onAddTenant && (
                  <button
                    onClick={() => { onClose(); onAddTenant() }}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold bg-primary-50 text-primary-600 hover:bg-primary-100 border border-primary-200 transition-colors">
                    <Users size={12} /> Add Tenant
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          !inactive && <StatsSkeleton />
        )}

        {/* ── ACTIONS ── */}
        <div className="pt-1 border-t border-slate-100">
          {!inactive ? (
            <div className="flex gap-2">
              {/* Primary: Edit Property */}
              <button
                onClick={() => { onClose(); onEdit(p) }}
                className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold text-white transition-all shadow-sm
                  bg-gradient-to-r from-primary-500 to-primary-700 hover:opacity-90 active:scale-[.98]`}>
                <Pencil size={14} /> Edit Property
              </button>

              {/* Secondary dropdown */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen(v => !v)}
                  className={`flex items-center justify-center w-10 h-[42px] rounded-xl border transition-colors
                    ${menuOpen ? 'bg-slate-100 border-slate-300 text-slate-700' : 'border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600'}`}>
                  <MoreVertical size={15} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 bottom-full mb-2 w-48 rounded-xl bg-white border border-slate-200 shadow-xl shadow-slate-200/60 overflow-hidden z-20">
                    {onAnalytics && (
                      <button
                        onClick={() => { setMenuOpen(false); onClose(); onAnalytics(p) }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-slate-600 hover:bg-slate-50 transition-colors">
                        <TrendingUp size={13} className="text-slate-400" /> Analytics
                      </button>
                    )}
                    <div className="border-t border-slate-100 my-0.5" />
                    <button
                      onClick={() => { setMenuOpen(false); onClose(); onDelete(p._id) }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-xs text-red-500 hover:bg-red-50 transition-colors">
                      <Trash2 size={13} /> Deactivate Property
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Inactive actions */
            <div className="flex gap-2">
              <button
                onClick={() => { onClose(); onReactivate?.(p._id) }}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200 transition-colors">
                <RotateCcw size={14} /> Reactivate
              </button>
              <button
                onClick={() => { onClose(); onHardDelete?.(p) }}
                className="flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors">
                <Trash2 size={14} /> Delete Forever
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const Properties = () => {
  const navigate = useNavigate()
  const { refreshProperties, setSelectedProperty } = useProperty()
  const toast = useToast()

  const { data, loading, refetch }                          = useApi(getAllProperties)
  const { data: sData, loading: statsLoading, refetch: refetchStats } = useApi(getAllPropertyStats)

  const statsMap = sData?.data ?? {}

  const [modal,        setModal]        = useState(null)
  const [confirmModal, setConfirmModal] = useState(null)
  const [hardDelete,   setHardDelete]   = useState(null)
  const [analytics,    setAnalytics]    = useState(null)
  const [quickSetup,   setQuickSetup]   = useState(null)
  const [saving,       setSaving]       = useState(false)
  const [confirming,   setConfirming]   = useState(false)

  const [formDirty,    setFormDirty]    = useState(false)
  const [discardGuard, setDiscardGuard] = useState(false)
  const [updatedId,    setUpdatedId]    = useState(null)
  const highlightTimer = useRef(null)

  const [viewProperty, setViewProperty] = useState(null)

  const [search,       setSearch]       = useState('')
  const [filterStatus, setFilterStatus] = useState('active')

  const properties    = data?.data ?? []
  const activeCount   = properties.filter((p) => p.isActive).length
  const inactiveCount = properties.filter((p) => !p.isActive).length

  // Portfolio-level aggregates (active properties only)
  const activeStats = properties.filter((p) => p.isActive).map((p) => statsMap[p._id]).filter(Boolean)
  const portfolioRevenue  = activeStats.reduce((s, x) => s + (x.totalRevenue  ?? 0), 0)
  const portfolioTenants  = activeStats.reduce((s, x) => s + (x.activeTenants ?? 0), 0)
  const portfolioTotalBeds  = activeStats.reduce((s, x) => s + (x.totalBeds   ?? 0), 0)
  const portfolioExtraBeds  = activeStats.reduce((s, x) => s + (x.extraBeds   ?? 0), 0)
  const portfolioOccupied   = activeStats.reduce((s, x) => s + (x.occupiedBeds ?? 0), 0)
  const portfolioOccPct   = portfolioTotalBeds > 0
    ? Math.round((portfolioOccupied / portfolioTotalBeds) * 100)
    : 0

  const filtered = useMemo(() => {
    return properties.filter((p) => {
      const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.address?.city ?? '').toLowerCase().includes(search.toLowerCase())
      const matchStatus = filterStatus === 'all' || (filterStatus === 'active' ? p.isActive : !p.isActive)
      return matchSearch && matchStatus
    })
  }, [properties, search, filterStatus])

  const closeModal = useCallback(() => {
    if (modal !== 'add' && formDirty) {
      setDiscardGuard(true)
    } else {
      setModal(null); setFormDirty(false)
    }
  }, [modal, formDirty])

  const confirmDiscard = useCallback(() => {
    setDiscardGuard(false); setModal(null); setFormDirty(false)

  }, [])

  const handleSave = async (form) => {
    if (modal !== 'add' && formEqual(form, modal)) {
      toast('No changes made', 'info')
      setModal(null); setFormDirty(false)
      return
    }
    setSaving(true)
    try {
      if (modal === 'add') {
        const res = await createProperty(form)
        const newProperty = res.data?.data
        setModal(null); setFormDirty(false)
        setQuickSetup(newProperty ?? form.name)
        toast(`"${form.name}" created successfully`, 'success')
      } else {
        const savedId = modal._id
        await updateProperty(savedId, form)
        setModal(null); setFormDirty(false)
        toast(`"${form.name}" updated`, 'success')
        clearTimeout(highlightTimer.current)
        setUpdatedId(savedId)
        highlightTimer.current = setTimeout(() => setUpdatedId(null), 1600)
      }
      refetch(); refetchStats(); refreshProperties()
    } catch (err) {
      toast(err.response?.data?.message || 'Something went wrong. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete     = (id) => setConfirmModal({ type: 'deactivate',  property: properties.find((p) => p._id === id) })
  const handleReactivate = (id) => setConfirmModal({ type: 'reactivate',  property: properties.find((p) => p._id === id) })

  const handleConfirm = async () => {
    if (!confirmModal) return
    setConfirming(true)
    try {
      const { type, property } = confirmModal
      if (type === 'deactivate') {
        await deleteProperty(property._id)
        toast(`"${property.name}" deactivated`, 'info')
      } else {
        await reactivateProperty(property._id)
        toast(`"${property.name}" reactivated`, 'success')
      }
      setConfirmModal(null); refetch(); refetchStats(); refreshProperties()
    } catch (err) {
      toast(err.response?.data?.message || 'Something went wrong.', 'error')
    } finally {
      setConfirming(false)
    }
  }

  const handleHardDelete = async () => {
    if (!hardDelete) return
    setConfirming(true)
    try {
      await permanentDeleteProperty(hardDelete._id)
      toast(`"${hardDelete.name}" permanently deleted`, 'info')
      setHardDelete(null); refetch(); refetchStats(); refreshProperties()
    } catch (err) {
      toast(err.response?.data?.message || 'Something went wrong.', 'error')
    } finally {
      setConfirming(false)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5 max-w-6xl">

      {/* ── Page Header ── */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-slate-800 leading-tight">My Properties</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {activeCount} active{inactiveCount > 0 ? ` · ${inactiveCount} inactive` : ''}
          </p>
        </div>
        <button
          className="btn-primary shrink-0"
          onClick={() => setModal('add')}
          data-testid="add-property-btn"
        >
          <Plus size={16} /> Add Property
        </button>
      </div>

      {/* ── Portfolio KPI Bar ── */}
      {!loading && activeCount > 0 && (
        statsLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[0,1,2,3].map(i => (
              <div key={i} className="rounded-2xl bg-white border border-slate-200 px-4 py-3.5 flex items-center gap-3 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300">
                <div className="h-9 w-9 rounded-xl bg-slate-100 animate-pulse shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-16 rounded bg-slate-100 animate-pulse" />
                  <div className="h-3 w-20 rounded bg-slate-100 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Monthly Rent', value: fmt(portfolioRevenue), sub: '/mo', icon: IndianRupee, accent: 'text-primary-600', bg: 'bg-primary-50 border-primary-100' },
            { label: 'Occupancy', value: `${portfolioOccPct}%`, icon: TrendingUp, accent: portfolioOccPct >= 80 ? 'text-emerald-600' : portfolioOccPct >= 50 ? 'text-amber-600' : 'text-slate-500', bg: 'bg-slate-50 border-slate-200' },
            { label: 'Active Tenants', value: portfolioTenants, icon: Users, accent: 'text-violet-600', bg: 'bg-violet-50 border-violet-100' },
            { label: 'Beds Occupied', value: `${portfolioOccupied}/${portfolioTotalBeds}`, note: portfolioExtraBeds > 0 ? `+${portfolioExtraBeds} extra` : null, icon: BedDouble, accent: 'text-blue-600', bg: 'bg-blue-50 border-blue-100' },
          ].map(({ label, value, sub, note, icon: Icon, accent, bg }) => (
            <div key={label} className="rounded-2xl bg-white border border-slate-200 px-4 py-3.5 flex items-center gap-3 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300 active:scale-[0.98] cursor-default">
              <div className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 transition-transform duration-200 group-hover:scale-110 ${bg}`}>
                <Icon size={15} className={accent} />
              </div>
              <div className="min-w-0">
                <p className={`text-[18px] font-bold leading-none tabular-nums ${accent}`}>
                  {value}
                  {sub && <span className="text-[11px] font-normal text-slate-400 ml-0.5">{sub}</span>}
                </p>
                <p className="text-[10px] text-slate-400 mt-0.5 font-medium">{label}</p>
                {note && <p className="text-[9px] font-bold text-violet-500 mt-0.5">✦ {note}</p>}
              </div>
            </div>
          ))}
        </div>
        )
      )}

      {/* ── Search + Filters ── */}
      {!loading && properties.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              data-testid="properties-search"
              className="input pl-8 py-1.5 text-sm w-full"
              placeholder="Search by name or city…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-0.5 rounded-xl p-1 text-xs bg-slate-50 border border-slate-200 shrink-0">
            {[['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([v, l]) => (
              <button key={v} onClick={() => setFilterStatus(v)}
                data-testid={`filter-${v}`}
                className={`rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
                  filterStatus === v
                    ? 'bg-white text-primary-600 shadow-sm border border-slate-200'
                    : 'text-slate-500 hover:bg-white hover:text-slate-700'
                }`}>
                {l}
              </button>
            ))}
          </div>

          {/* Clear */}
          {(search || filterStatus !== 'active') && (
            <button
              onClick={() => { setSearch(''); setFilterStatus('active') }}
              className="text-xs text-primary-600 hover:text-primary-700 hover:underline font-medium shrink-0"
            >
              Clear
            </button>
          )}
        </div>
      )}

      {/* ── Grid ── */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <PropertyCardSkeleton key={i} />)}
        </div>
      ) : properties.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <div className="w-full max-w-2xl">

            {/* Hero */}
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center h-20 w-20 rounded-3xl mb-5 mx-auto"
                style={{ background: 'rgba(96,195,173,0.12)', border: '1.5px solid rgba(96,195,173,0.25)' }}>
                <Building2 size={36} style={{ color: '#60C3AD' }} />
              </div>
              <h2 className="text-2xl font-bold text-slate-800 tracking-tight">Add your first property</h2>
              <p className="text-sm text-slate-400 mt-2 max-w-sm mx-auto leading-relaxed">
                Set up your PG / Hostel in minutes — add rooms, assign tenants, and start tracking rent all in one place.
              </p>
              <button
                className="mt-5 inline-flex items-center gap-2 rounded-xl px-6 py-3 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-95 shadow-sm"
                style={{ background: 'linear-gradient(135deg, #60C3AD 0%, #4aa897 100%)' }}
                onClick={() => setModal('add')}
                data-testid="add-property-empty-state-btn"
              >
                <Plus size={16} /> Add Property
              </button>
            </div>

            {/* Feature cards */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {[
                { icon: BedDouble,    label: 'Rooms & Beds',   desc: 'Manage rooms, beds, and live occupancy at a glance'   },
                { icon: Users,        label: 'Tenants',         desc: 'Track tenants, lease history, and contact details'    },
                { icon: IndianRupee,  label: 'Rent & Ledger',   desc: 'Collect rent, log charges, and view full audit trail' },
              ].map(({ icon: Icon, label, desc }) => (
                <div key={label} className="rounded-xl border border-slate-100 bg-white px-4 py-4 text-center">
                  <div className="inline-flex items-center justify-center h-9 w-9 rounded-xl mb-3"
                    style={{ background: 'rgba(96,195,173,0.10)', color: '#60C3AD' }}>
                    <Icon size={17} />
                  </div>
                  <p className="text-xs font-semibold text-slate-700 mb-1">{label}</p>
                  <p className="text-[11px] text-slate-400 leading-snug">{desc}</p>
                </div>
              ))}
            </div>

            {/* Quick-start steps */}
            <div className="rounded-2xl border border-slate-100 bg-white overflow-hidden">
              <p className="px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 border-b border-slate-100">
                Quick start — 4 steps
              </p>
              {[
                { num: '1', label: 'Add this property',  desc: 'Click "Add Property" above and fill in the details' },
                { num: '2', label: 'Create rooms',        desc: 'Go to Rooms & Beds and define your room layout'     },
                { num: '3', label: 'Add beds per room',   desc: 'Set capacity, amenities, and bed-level rent'        },
                { num: '4', label: 'Assign first tenant', desc: 'Pick a bed, set rent, and move your tenant in'      },
              ].map(({ num, label, desc }, i, arr) => (
                <div key={num} className={`flex items-center gap-4 px-5 py-3.5 ${i < arr.length - 1 ? 'border-b border-slate-100' : ''}`}>
                  <div className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #60C3AD 0%, #4aa897 100%)' }}>
                    {num}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-700">{label}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{desc}</p>
                  </div>
                </div>
              ))}
            </div>

          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card py-10 text-center">
          <Search size={24} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-600 font-semibold">No properties found</p>
          <p className="text-xs text-slate-400 mt-1">Try a different name, city, or adjust your filters</p>
          <button
            onClick={() => { setSearch(''); setFilterStatus('active') }}
            className="mt-3 text-xs text-primary-600 hover:underline font-medium"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <PropertyCard
              key={p._id}
              property={p}
              stats={statsMap[p._id]}
              highlight={updatedId === p._id}
              onView={setViewProperty}
              onEdit={(prop) => { setFormDirty(false); setModal(prop) }}
              onDelete={handleDelete}
              onReactivate={handleReactivate}
              onAnalytics={setAnalytics}
              onHardDelete={setHardDelete}
              onManage={(prop) => { setSelectedProperty(prop); navigate('/rooms') }}
              onAddRoom={(prop) => { setSelectedProperty(prop); navigate('/rooms') }}
            />
          ))}
        </div>
      )}

      {/* ── Property Detail Modal ── */}
      {viewProperty && (
        <PropertyDetailModal
          property={viewProperty}
          stats={statsMap[viewProperty._id]}
          onClose={() => setViewProperty(null)}
          onEdit={(prop) => { setFormDirty(false); setModal(prop) }}
          onDelete={handleDelete}
          onAnalytics={setAnalytics}
          onReactivate={handleReactivate}
          onHardDelete={setHardDelete}
          onAddRoom={() => { setSelectedProperty(viewProperty); navigate('/rooms') }}
          onAddTenant={() => navigate('/tenants')}
        />
      )}

      {/* ── Modals ── */}
      {modal && (
        <Modal onClose={closeModal} disableBackdropClose>
          <PropertyForm
            initial={modal === 'add' ? EMPTY_FORM : modal}
            onSubmit={handleSave}
            saving={saving}
            onCancel={closeModal}
            isAdd={modal === 'add'}
            onDirtyChange={setFormDirty}
            onDelete={modal !== 'add' ? () => { setModal(null); setFormDirty(false); handleDelete(modal._id) } : undefined}
          />
        </Modal>
      )}

      {discardGuard && (
        <Modal title="Unsaved Changes" onClose={() => setDiscardGuard(false)} size="sm">
          <p className="text-sm text-slate-600 mb-5">
            You have unsaved changes. Are you sure you want to discard them?
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setDiscardGuard(false)}>Keep Editing</button>
            <button className="btn-danger" onClick={confirmDiscard}>Discard</button>
          </div>
        </Modal>
      )}

      {confirmModal && (
        <ConfirmModal
          type={confirmModal.type}
          property={confirmModal.property}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmModal(null)}
          loading={confirming}
        />
      )}

      {hardDelete && (
        <HardDeleteModal
          property={hardDelete}
          onConfirm={handleHardDelete}
          onCancel={() => setHardDelete(null)}
          loading={confirming}
        />
      )}

      {analytics && (
        <AnalyticsDrawer property={analytics} onClose={() => setAnalytics(null)} />
      )}

      {quickSetup && (
        <QuickSetupModal
          propertyName={typeof quickSetup === 'object' ? quickSetup.name : quickSetup}
          onSetupRooms={() => {
            if (quickSetup && typeof quickSetup === 'object') {
              setSelectedProperty(quickSetup)
            }
            setQuickSetup(null)
            navigate('/rooms')
          }}
          onSkip={() => setQuickSetup(null)}
        />
      )}
    </div>
  )
}

export default Properties
