import { useState, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Pencil, Trash2, MapPin, Building2, RotateCcw, X,
  AlertTriangle, BedDouble, Users, IndianRupee, ArrowRight,
  Sparkles, CheckCircle2, Search, SlidersHorizontal,
  TrendingUp, AlertOctagon, FileText,
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

// Deterministic accent color from property name
const ACCENTS = [
  { from: 'from-violet-500', to: 'to-purple-600',  solid: '#7C3AED' },
  { from: 'from-blue-500',   to: 'to-cyan-600',    solid: '#2563EB' },
  { from: 'from-emerald-500',to: 'to-teal-600',    solid: '#059669' },
  { from: 'from-rose-500',   to: 'to-pink-600',    solid: '#E11D48' },
  { from: 'from-amber-500',  to: 'to-orange-600',  solid: '#D97706' },
  { from: 'from-teal-500',   to: 'to-emerald-600', solid: '#0D9488' },
  { from: 'from-cyan-500',   to: 'to-blue-600',    solid: '#0891B2' },
  { from: 'from-fuchsia-500',to: 'to-violet-600',  solid: '#A21CAF' },
]
const cardAccent = (str = '') => {
  let h = 0
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0
  return ACCENTS[Math.abs(h) % ACCENTS.length]
}

const TYPE_LABEL = { pg: 'PG', hostel: 'Hostel', apartment: 'Co-living' }
const TYPE_OPTIONS = [
  { value: 'pg',        label: 'PG',        desc: 'Paying Guest'    },
  { value: 'hostel',    label: 'Hostel',     desc: 'Shared dorms'   },
  { value: 'apartment', label: 'Co-living',  desc: 'Private units'  },
]

const EMPTY_FORM = {
  name: '', type: 'pg', description: '', isActive: true,
  address: { street: '', city: '', state: '', pincode: '' },
}

const formEqual = (a, b) =>
  a.name        === b.name        &&
  a.type        === b.type        &&
  a.description === b.description &&
  a.isActive    === b.isActive    &&
  a.address?.street  === b.address?.street  &&
  a.address?.city    === b.address?.city    &&
  a.address?.state   === b.address?.state   &&
  a.address?.pincode === b.address?.pincode


// ── Form section label ────────────────────────────────────────────────────────
const FormSection = ({ icon: Icon, label, optional }) => (
  <div className="flex items-center gap-2 mb-3">
    <div className="h-5 w-5 rounded-md bg-primary-50 flex items-center justify-center shrink-0">
      <Icon size={11} className="text-primary-500" />
    </div>
    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-400 select-none">{label}</span>
    {optional && <span className="text-[10px] text-slate-300 font-medium ml-1">Optional</span>}
  </div>
)

// ── Property Form ─────────────────────────────────────────────────────────────
const PropertyForm = ({ initial = EMPTY_FORM, onSubmit, saving, onCancel, isAdd, onTitleChange, onDirtyChange }) => {
  const [form, setForm]     = useState({ isActive: true, ...initial })
  const [errors, setErrors] = useState({})

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
    if (!form.name.trim()) { setErrors({ name: 'Property name is required' }); return }
    onSubmit(form)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* ── Property Details ── */}
      <div>
        <FormSection icon={Building2} label="Property Details" />
        <div className="space-y-3">

          {/* Name */}
          <div>
            <label className="label">Property Name <span className="text-red-400">*</span></label>
            <input
              autoFocus
              className={`input ${errors.name ? 'border-red-400 focus:ring-red-400/20 focus:border-red-400' : ''}`}
              placeholder="e.g. Green Valley PG"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
            />
            {errors.name && (
              <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
                <span className="h-1 w-1 rounded-full bg-red-400 shrink-0" />
                {errors.name}
              </p>
            )}
          </div>

          {/* Type button group */}
          <div>
            <label className="label">Property Type</label>
            <div className="grid grid-cols-3 gap-2">
              {TYPE_OPTIONS.map(({ value, label, desc }) => {
                const active = form.type === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => set('type', value)}
                    className={`flex flex-col items-start rounded-xl border px-3 py-2.5 text-left transition-all duration-150
                      ${active
                        ? 'border-primary-400 bg-primary-50 ring-2 ring-primary-400/20'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}`}
                  >
                    <span className={`text-[13px] font-semibold leading-tight ${active ? 'text-primary-700' : 'text-slate-700'}`}>
                      {label}
                    </span>
                    <span className={`text-[11px] mt-0.5 ${active ? 'text-primary-500' : 'text-slate-400'}`}>
                      {desc}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ── Location ── */}
      <div>
        <FormSection icon={MapPin} label="Location" />
        <div className="space-y-3">
          <div>
            <label className="label">Street Address</label>
            <input className="input" placeholder="e.g. 12 MG Road, Indiranagar"
              value={form.address.street} onChange={(e) => setAddr('street', e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">City</label>
              <input className="input" placeholder="e.g. Bangalore"
                value={form.address.city} onChange={(e) => setAddr('city', e.target.value)} />
            </div>
            <div>
              <label className="label">State</label>
              <input className="input" placeholder="e.g. Karnataka"
                value={form.address.state} onChange={(e) => setAddr('state', e.target.value)} />
            </div>
          </div>
          <div className="max-w-[160px]">
            <label className="label">Pincode</label>
            <input className="input" placeholder="e.g. 560001" maxLength={6}
              value={form.address.pincode} onChange={(e) => setAddr('pincode', e.target.value)} />
          </div>
        </div>
      </div>

      {/* ── Description ── */}
      <div>
        <FormSection icon={FileText} label="Description" optional />
        <textarea
          className="input resize-none"
          rows={2}
          placeholder="Add notes about amenities, rules, or anything useful for tenants…"
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>


      {/* ── Footer ── */}
      <div className="flex flex-col gap-3 pt-1 border-t border-slate-100">
        <div className="flex gap-2">
          <button type="button" className="btn-secondary flex-1" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving ? 'Saving…' : isAdd ? 'Add Property' : 'Save Changes'}
          </button>
        </div>
        <p className="text-xs text-slate-400 text-center">
          {isAdd ? 'Fields marked * are required' : 'Changes are saved immediately'}
        </p>
      </div>
    </form>
  )
}

// ── Analytics Drawer ──────────────────────────────────────────────────────────
const AnalyticsDrawer = ({ property, onClose }) => {
  const { data, loading } = useApi(() => getPropertyAnalytics(property._id), [property._id])
  const trend = data?.data?.trend ?? []

  return (
    <Modal title={`Analytics — ${property.name}`} onClose={onClose}>
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-primary-500" />
        </div>
      ) : trend.length === 0 ? (
        <p className="text-center text-sm text-slate-400 py-10">No data yet for this property.</p>
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
          className="input"
          placeholder={property.name}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>
      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onCancel} disabled={loading}>Cancel</button>
        <button
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
const PropertyCard = ({ property: p, stats, highlight, onEdit, onDelete, onReactivate, onAnalytics, onHardDelete, onView }) => {
  const inactive  = !p.isActive
  const accent    = cardAccent(p._id ?? p.name)
  const s         = stats
  const occupancy = s ? s.occupancyRate : null

  const occColor = occupancy === null ? ''
    : occupancy >= 80 ? 'text-emerald-600' : occupancy >= 50 ? 'text-amber-600' : 'text-slate-500'
  const occBar = occupancy === null ? ''
    : occupancy >= 80 ? 'bg-emerald-500' : occupancy >= 50 ? 'bg-amber-400' : 'bg-primary-500'

  return (
    <div
      onClick={() => onView?.(p)}
      className={`rounded-2xl overflow-hidden flex flex-col bg-white border transition-all duration-300 cursor-pointer
      ${inactive
        ? 'opacity-60 border-slate-200'
        : `border-slate-200 hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(0,0,0,.08)] hover:border-slate-300`}
      ${highlight ? 'ring-2 ring-primary-400 ring-offset-2 animate-highlightFade' : ''}`}>

      {/* Accent stripe */}
      <div className={`h-1 w-full shrink-0 ${inactive ? 'bg-slate-200' : `bg-gradient-to-r ${accent.from} ${accent.to}`}`} />

      {/* Card header */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl
            ${inactive ? 'bg-slate-100' : `bg-gradient-to-br ${accent.from} ${accent.to}`}`}>
            <Building2 size={16} className={inactive ? 'text-slate-400' : 'text-white'} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-800 truncate text-sm leading-snug">{p.name}</h3>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              <span className="text-[11px] font-medium text-slate-400">{TYPE_LABEL[p.type] ?? p.type}</span>
              {(p.address?.city || p.address?.state) && (
                <>
                  <span className="text-slate-200 select-none">·</span>
                  <span className="flex items-center gap-0.5 text-[11px] text-slate-400">
                    <MapPin size={10} className="shrink-0" />
                    {[p.address.city, p.address.state].filter(Boolean).join(', ')}
                  </span>
                </>
              )}
              {inactive && (
                <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600 border border-red-200">
                  Inactive
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-0.5 shrink-0 mt-0.5">
          {inactive ? (
            <button onClick={(e) => { e.stopPropagation(); onReactivate(p._id) }}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" title="Reactivate">
              <RotateCcw size={14} />
            </button>
          ) : (
            <>
              <button onClick={(e) => { e.stopPropagation(); onAnalytics(p) }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" title="Analytics">
                <TrendingUp size={14} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onEdit(p) }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" title="Edit">
                <Pencil size={14} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); onDelete(p._id) }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors" title="Deactivate">
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Description */}
      {p.description && (
        <p className="px-4 pb-2 -mt-1 text-xs text-slate-400 line-clamp-1">{p.description}</p>
      )}

      {/* Divider */}
      <div className="mx-4 border-t border-slate-100" />

      {/* Stats */}
      <div className="flex-1 flex flex-col px-4 py-3 space-y-3">
        {!inactive ? (
          s ? (
            <>
              {/* Occupancy bar */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-slate-400">Occupancy</span>
                  <span className={`font-semibold tabular-nums ${occColor}`}>{occupancy}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-100">
                  <div
                    className={`h-1.5 rounded-full transition-all duration-700 ${occBar}`}
                    style={{ width: `${occupancy}%` }}
                  />
                </div>
              </div>

              {/* Bed stat pills */}
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-xl px-2.5 py-2 text-center bg-slate-50 border border-slate-100">
                  <p className="text-sm font-bold text-slate-700">{s.totalBeds}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Total</p>
                </div>
                <div className="rounded-xl px-2.5 py-2 text-center bg-emerald-50 border border-emerald-100">
                  <p className="text-sm font-bold text-emerald-600">{s.vacantBeds}</p>
                  <p className="text-[10px] text-emerald-500 mt-0.5">Vacant</p>
                </div>
                <div className="rounded-xl px-2.5 py-2 text-center bg-blue-50 border border-blue-100">
                  <p className="text-sm font-bold text-blue-600">{s.occupiedBeds}</p>
                  <p className="text-[10px] text-blue-500 mt-0.5">Occupied</p>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-100">
                <span className="flex items-center gap-1 font-semibold text-slate-700">
                  <IndianRupee size={11} className="text-primary-500" />{fmt(s.totalRent)}/mo
                </span>
                <span className="flex items-center gap-1 text-slate-400">
                  <Users size={11} />{s.activeTenants} tenant{s.activeTenants !== 1 ? 's' : ''}
                </span>
              </div>
            </>
          ) : (
            <StatsSkeleton />
          )
        ) : (
          <div className="flex items-center justify-between py-1">
            <button onClick={(e) => { e.stopPropagation(); onReactivate(p._id) }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200 transition-colors">
              <RotateCcw size={12} /> Reactivate
            </button>
            <button onClick={(e) => { e.stopPropagation(); onHardDelete(p) }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors">
              <Trash2 size={12} /> Delete Forever
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Property Detail Modal ─────────────────────────────────────────────────────
const PropertyDetailModal = ({ property: p, stats: s, onClose, onEdit, onDelete }) => {
  const inactive  = !p.isActive
  const accent    = cardAccent(p._id ?? p.name)
  const occupancy = s?.occupancyRate ?? null
  const occColor  = occupancy === null ? 'text-slate-500'
    : occupancy >= 80 ? 'text-emerald-600' : occupancy >= 50 ? 'text-amber-600' : 'text-slate-500'
  const occBar    = occupancy === null ? 'bg-slate-200'
    : occupancy >= 80 ? 'bg-emerald-500' : occupancy >= 50 ? 'bg-amber-400' : 'bg-primary-500'

  return (
    <Modal onClose={onClose} size="md" title={p.name}>
      <div className="space-y-5">

        {/* Hero banner */}
        <div className={`rounded-2xl bg-gradient-to-br ${accent.from} ${accent.to} p-5 flex items-center gap-4`}>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur-sm">
            <Building2 size={24} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-lg leading-tight truncate">{p.name}</p>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <span className="text-white/80 text-xs font-medium capitalize">{TYPE_LABEL[p.type] ?? p.type}</span>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold backdrop-blur-sm ${
                inactive ? 'bg-red-500/30 text-white' : 'bg-white/25 text-white'
              }`}>
                {inactive ? 'Inactive' : 'Active'}
              </span>
            </div>
            {(p.address?.city || p.address?.state) && (
              <div className="flex items-center gap-1 mt-1.5">
                <MapPin size={11} className="text-white/60 shrink-0" />
                <span className="text-white/70 text-xs">{[p.address.city, p.address.state].filter(Boolean).join(', ')}</span>
              </div>
            )}
          </div>
        </div>

        {/* Address */}
        {p.address?.street && (
          <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
            <MapPin size={14} className="text-primary-500 mt-0.5 shrink-0" />
            <p className="text-sm text-slate-600 leading-relaxed">
              {[p.address.street, p.address.city, p.address.state, p.address.pincode].filter(Boolean).join(', ')}
            </p>
          </div>
        )}

        {/* Description */}
        {p.description && (
          <p className="text-sm text-slate-500 leading-relaxed px-1">{p.description}</p>
        )}

        {/* Stats */}
        {s && (
          <div className="space-y-3">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Overview</p>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Total Beds', value: s.totalBeds,     bg: 'bg-slate-50',    border: 'border-slate-200',   val: 'text-slate-700' },
                { label: 'Vacant',     value: s.vacantBeds,    bg: 'bg-emerald-50',  border: 'border-emerald-200', val: 'text-emerald-600' },
                { label: 'Occupied',   value: s.occupiedBeds,  bg: 'bg-blue-50',     border: 'border-blue-200',    val: 'text-blue-600' },
                { label: 'Tenants',    value: s.activeTenants, bg: 'bg-violet-50',   border: 'border-violet-200',  val: 'text-violet-600' },
              ].map(({ label, value, bg, border, val }) => (
                <div key={label} className={`rounded-xl px-2 py-3 text-center ${bg} border ${border}`}>
                  <p className={`text-xl font-bold ${val}`}>{value}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5 leading-tight">{label}</p>
                </div>
              ))}
            </div>

            {/* Rent + Occupancy */}
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3.5 flex items-center justify-between">
              <div>
                <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Monthly Rent</p>
                <p className="text-xl font-bold text-slate-800 mt-0.5">₹{fmt(s.totalRent)}</p>
              </div>
              {occupancy !== null && (
                <div className="text-right">
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide mb-1.5">Occupancy</p>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 rounded-full bg-slate-200">
                      <div className={`h-1.5 rounded-full ${occBar}`} style={{ width: `${occupancy}%` }} />
                    </div>
                    <span className={`text-sm font-bold ${occColor}`}>{occupancy}%</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        {!inactive && (
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => { onClose(); onEdit(p) }}
              className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-primary-500 hover:bg-primary-600 py-2.5 text-sm font-semibold text-white transition-colors"
            >
              <Pencil size={14} /> Edit Property
            </button>
            <button
              onClick={() => { onClose(); onDelete(p._id) }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-100 transition-colors"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const Properties = () => {
  const navigate = useNavigate()
  const { refreshProperties, setSelectedProperty } = useProperty()
  const toast = useToast()

  const { data, loading, refetch }              = useApi(getAllProperties)
  const { data: sData, refetch: refetchStats }  = useApi(getAllPropertyStats)

  const statsMap = sData?.data ?? {}

  const [modal,        setModal]        = useState(null)
  const [confirmModal, setConfirmModal] = useState(null)
  const [hardDelete,   setHardDelete]   = useState(null)
  const [analytics,    setAnalytics]    = useState(null)
  const [quickSetup,   setQuickSetup]   = useState(null)
  const [saving,       setSaving]       = useState(false)
  const [confirming,   setConfirming]   = useState(false)

  const [liveTitle,    setLiveTitle]    = useState('')
  const [formDirty,    setFormDirty]    = useState(false)
  const [discardGuard, setDiscardGuard] = useState(false)
  const [updatedId,    setUpdatedId]    = useState(null)
  const highlightTimer = useRef(null)

  const [viewProperty, setViewProperty] = useState(null)

  const [search,       setSearch]       = useState('')
  const [filterType,   setFilterType]   = useState('all')
  const [filterStatus, setFilterStatus] = useState('active')
  const [showFilters,  setShowFilters]  = useState(false)

  const properties    = data?.data ?? []
  const activeCount   = properties.filter((p) => p.isActive).length
  const inactiveCount = properties.filter((p) => !p.isActive).length

  const filtered = useMemo(() => {
    return properties.filter((p) => {
      const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
        (p.address?.city ?? '').toLowerCase().includes(search.toLowerCase())
      const matchType   = filterType === 'all'   || p.type === filterType
      const matchStatus = filterStatus === 'all' || (filterStatus === 'active' ? p.isActive : !p.isActive)
      return matchSearch && matchType && matchStatus
    })
  }, [properties, search, filterType, filterStatus])

  const closeModal = useCallback(() => {
    if (modal !== 'add' && formDirty) {
      setDiscardGuard(true)
    } else {
      setModal(null); setLiveTitle(''); setFormDirty(false)
    }
  }, [modal, formDirty])

  const confirmDiscard = useCallback(() => {
    setDiscardGuard(false); setModal(null); setLiveTitle(''); setFormDirty(false)
  }, [])

  const handleSave = async (form) => {
    if (modal !== 'add' && formEqual(form, modal)) {
      toast('No changes made', 'info')
      setModal(null); setLiveTitle(''); setFormDirty(false)
      return
    }
    setSaving(true)
    try {
      if (modal === 'add') {
        const res = await createProperty(form)
        const newProperty = res.data?.data
        setModal(null); setLiveTitle(''); setFormDirty(false)
        setQuickSetup(newProperty ?? form.name)
        toast(`"${form.name}" created successfully`, 'success')
      } else {
        const savedId = modal._id
        await updateProperty(savedId, form)
        setModal(null); setLiveTitle(''); setFormDirty(false)
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

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-slate-500">
          {activeCount} active propert{activeCount !== 1 ? 'ies' : 'y'}
          {inactiveCount > 0 && <span className="ml-2 text-slate-400">· {inactiveCount} inactive</span>}
        </p>
        <button className="btn-primary" onClick={() => setModal('add')}>
          <Plus size={16} /> Add Property
        </button>
      </div>

      {/* ── Search + Filters ── */}
      {!loading && properties.length > 0 && (
        <div className="space-y-2">
          {/* Row: search + mobile filter toggle */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="input pl-8 py-1.5 text-sm w-full"
                placeholder="Search by name or city…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {/* Mobile filter toggle */}
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={`sm:hidden relative flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors shrink-0 ${
                showFilters
                  ? 'border-primary-300 bg-primary-50 text-primary-600'
                  : 'border-slate-200 bg-white text-slate-500'
              }`}
            >
              <SlidersHorizontal size={13} />
              Filters
              {(filterType !== 'all' || filterStatus !== 'active') && (
                <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary-500 ring-2 ring-white" />
              )}
            </button>
          </div>

          {/* Mobile filter bottom sheet */}
          {showFilters && createPortal(
            <div className="fixed inset-0 z-50 flex items-end"
              style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
              onClick={() => setShowFilters(false)}>
              <div className="w-full bg-white rounded-t-2xl overflow-y-auto max-h-[80vh]"
                onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal size={15} className="text-primary-500" />
                    <span className="text-sm font-semibold text-slate-800">Filters</span>
                  </div>
                  <button onClick={() => setShowFilters(false)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition-colors">
                    <X size={16} />
                  </button>
                </div>

                <div className="p-4 space-y-4">
                  {/* Type */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Type</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {['all', 'pg', 'hostel', 'apartment'].map((t) => (
                        <button key={t} onClick={() => setFilterType(t)}
                          className={`rounded-xl py-2 text-xs font-medium capitalize border text-center transition-colors ${
                            filterType === t ? 'bg-primary-50 border-primary-300 text-primary-600' : 'bg-slate-50 border-slate-200 text-slate-500'
                          }`}>
                          {t === 'all' ? 'All' : TYPE_LABEL[t]}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Status */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Status</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([v, l]) => (
                        <button key={v} onClick={() => setFilterStatus(v)}
                          className={`rounded-xl py-2 text-xs font-medium border text-center transition-colors ${
                            filterStatus === v ? 'bg-primary-50 border-primary-300 text-primary-600' : 'bg-slate-50 border-slate-200 text-slate-500'
                          }`}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-1 pb-2">
                    {(filterType !== 'all' || filterStatus !== 'active') && (
                      <button
                        onClick={() => { setFilterType('all'); setFilterStatus('active') }}
                        className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors">
                        Reset
                      </button>
                    )}
                    <button onClick={() => setShowFilters(false)}
                      className="flex-1 rounded-xl bg-primary-500 hover:bg-primary-600 py-2.5 text-sm font-semibold text-white transition-colors">
                      Apply
                    </button>
                  </div>
                </div>
              </div>
            </div>,
            document.body
          )}

          {/* Desktop filters row */}
          <div className="hidden sm:flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-0.5 rounded-xl p-1 text-xs bg-slate-50 border border-slate-200">
              {['all', 'pg', 'hostel', 'apartment'].map((t) => (
                <button key={t} onClick={() => setFilterType(t)}
                  className={`rounded-lg px-2.5 py-1.5 font-medium capitalize transition-colors ${
                    filterType === t
                      ? 'bg-white text-primary-600 shadow-sm border border-slate-200'
                      : 'text-slate-500 hover:bg-white hover:text-slate-700'
                  }`}>
                  {t === 'all' ? 'All Types' : TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-0.5 rounded-xl p-1 text-xs bg-slate-50 border border-slate-200">
              {[['active', 'Active'], ['inactive', 'Inactive'], ['all', 'All']].map(([v, l]) => (
                <button key={v} onClick={() => setFilterStatus(v)}
                  className={`rounded-lg px-2.5 py-1.5 font-medium transition-colors ${
                    filterStatus === v
                      ? 'bg-white text-primary-600 shadow-sm border border-slate-200'
                      : 'text-slate-500 hover:bg-white hover:text-slate-700'
                  }`}>
                  {l}
                </button>
              ))}
            </div>
            {(search || filterType !== 'all' || filterStatus !== 'active') && (
              <button
                onClick={() => { setSearch(''); setFilterType('all'); setFilterStatus('active') }}
                className="text-xs text-primary-600 hover:text-primary-700 hover:underline font-medium"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Grid ── */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <PropertyCardSkeleton key={i} />)}
        </div>
      ) : properties.length === 0 ? (
        <div className="card py-16">
          <div className="flex flex-col items-center text-center gap-4 max-w-sm mx-auto">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 border border-primary-100">
              <Sparkles size={28} className="text-primary-500" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-800 mb-1">Add your first property</h3>
              <p className="text-sm text-slate-500">
                Start by adding your first PG to manage rooms, tenants &amp; rent — all in one place.
              </p>
            </div>
            <button className="btn-primary" onClick={() => setModal('add')}>
              <Plus size={16} /> Add Property
            </button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card py-10 text-center">
          <SlidersHorizontal size={24} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm text-slate-500 font-medium">No properties match your filters</p>
          <button onClick={() => { setSearch(''); setFilterType('all'); setFilterStatus('active') }}
            className="mt-2 text-xs text-primary-600 hover:underline">
            Clear all filters
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
              onEdit={(prop) => { setLiveTitle(prop.name); setFormDirty(false); setModal(prop) }}
              onDelete={handleDelete}
              onReactivate={handleReactivate}
              onAnalytics={setAnalytics}
              onHardDelete={setHardDelete}
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
          onEdit={(prop) => { setLiveTitle(prop.name); setFormDirty(false); setModal(prop) }}
          onDelete={handleDelete}
        />
      )}

      {/* ── Modals ── */}
      {modal && (
        <Modal
          title={modal === 'add' ? 'Add Property' : `Edit — ${liveTitle || modal.name || 'Property'}`}
          onClose={closeModal}
        >
          <PropertyForm
            initial={modal === 'add' ? EMPTY_FORM : modal}
            onSubmit={handleSave}
            saving={saving}
            onCancel={closeModal}
            isAdd={modal === 'add'}
            onTitleChange={setLiveTitle}
            onDirtyChange={setFormDirty}
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
