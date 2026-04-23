import { useEffect, useState } from 'react'
import {
  Layers, Users, IndianRupee, Building2,
  Pencil, Check, X, TrendingUp,
} from 'lucide-react'
import Spinner  from '../components/ui/Spinner'
import StatCard from '../components/ui/StatCard'
import { getPlans, updatePlan } from '../api/plans'

const PLAN_STYLES = {
  standard:   { color: '#64748b', bg: 'rgba(100,116,139,0.10)', border: '#94a3b8', pill: '#f1f5f9', pillText: '#475569' },
  pro:        { color: '#3b82f6', bg: 'rgba(59,130,246,0.10)',  border: '#93c5fd', pill: '#eff6ff', pillText: '#1d4ed8' },
  elite:      { color: '#8b5cf6', bg: 'rgba(139,92,246,0.10)', border: '#c4b5fd', pill: '#f5f3ff', pillText: '#6d28d9' },
  enterprise: { color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: '#fcd34d', pill: '#fffbeb', pillText: '#b45309' },
}

const fmt = (n) => new Intl.NumberFormat('en-IN').format(n)

/* ── Edit modal ──────────────────────────────────────────────────────────────── */
const EditModal = ({ plan, onClose, onSaved }) => {
  const [name,        setName]        = useState(plan.name)
  const [price,       setPrice]       = useState(String(plan.price))
  const [description, setDescription] = useState(plan.description ?? '')
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  const style = PLAN_STYLES[plan.key]

  const handleSave = async () => {
    const p = Number(price)
    if (!name.trim())       { setError('Plan name is required'); return }
    if (isNaN(p) || p < 0)  { setError('Enter a valid price');   return }
    setSaving(true); setError('')
    try {
      await updatePlan(plan.key, { name: name.trim(), price: p, description })
      onSaved()
    } catch {
      setError('Failed to save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(3px)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-[420px] rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden">

        {/* Coloured header strip */}
        <div className="h-1 w-full" style={{ background: style.color }} />

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0"
              style={{ background: style.bg, border: `1.5px solid ${style.border}` }}>
              <Layers size={16} style={{ color: style.color }} />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">Edit Plan</p>
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ background: style.pill, color: style.pillText }}>
                {plan.key}
              </span>
            </div>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Fields */}
        <div className="px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5 text-sm text-red-600">
              <X size={13} className="shrink-0" />{error}
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Plan Name</label>
            <input
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#60C3AD]/30 focus:border-[#60C3AD] transition-colors"
              value={name}
              onChange={e => { setName(e.target.value); setError('') }}
              placeholder="e.g. Standard"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">Price (₹ / year)</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-medium text-slate-400">₹</span>
              <input
                type="number" min="0"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 pl-7 pr-3.5 py-2.5 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#60C3AD]/30 focus:border-[#60C3AD] transition-colors"
                value={price}
                onChange={e => { setPrice(e.target.value); setError('') }}
                placeholder="0"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
              Description <span className="normal-case font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              rows={2}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-800 resize-none focus:outline-none focus:ring-2 focus:ring-[#60C3AD]/30 focus:border-[#60C3AD] transition-colors"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Short description shown to owners…"
            />
          </div>

          <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Max Properties</p>
              <p className="text-sm font-semibold text-slate-700 mt-0.5">
                {plan.maxProperties === -1 ? 'Unlimited' : plan.maxProperties}
              </p>
            </div>
            <span className="text-[10px] bg-white border border-slate-200 text-slate-400 px-2.5 py-1 rounded-lg font-medium shadow-sm">
              Enforced by code
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2.5 px-6 pb-6">
          <button onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[.98] disabled:opacity-60 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #45a793, #60c3ad)' }}>
            {saving
              ? <><Spinner size={14} />Saving…</>
              : <><Check size={14} />Save Changes</>}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Plan row ────────────────────────────────────────────────────────────────── */
const PlanRow = ({ plan, onEdit, isLast }) => {
  const style = PLAN_STYLES[plan.key]

  return (
    <div className={`flex items-center gap-4 px-5 py-4 hover:bg-slate-50/70 transition-colors group ${!isLast ? 'border-b border-slate-100' : ''}`}>

      {/* Colour indicator */}
      <div className="w-1 self-stretch rounded-full shrink-0" style={{ background: style.color, minHeight: 40 }} />

      {/* Icon + name */}
      <div className="flex items-center gap-3 w-40 shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl shrink-0"
          style={{ background: style.bg, border: `1.5px solid ${style.border}` }}>
          <Layers size={16} style={{ color: style.color }} />
        </div>
        <div>
          <p className="text-sm font-bold text-slate-800 leading-tight">{plan.name}</p>
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
            style={{ background: style.pill, color: style.pillText }}>
            {plan.key}
          </span>
        </div>
      </div>

      {/* Description */}
      <p className="flex-1 text-xs text-slate-400 leading-relaxed min-w-0 hidden md:block">
        {plan.description || <span className="italic">No description</span>}
      </p>

      {/* Price */}
      <div className="w-28 shrink-0 text-right">
        <p className="text-base font-black text-slate-800 tabular-nums leading-none">
          ₹{fmt(plan.price)}
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">per year</p>
      </div>

      {/* Divider */}
      <div className="w-px h-8 bg-slate-100 shrink-0" />

      {/* Max props */}
      <div className="w-20 shrink-0 text-center">
        <p className="text-sm font-bold text-slate-700">
          {plan.maxProperties === -1 ? '∞' : plan.maxProperties}
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">Max props</p>
      </div>

      {/* Owners */}
      <div className="w-16 shrink-0 text-center">
        <p className="text-sm font-bold text-slate-700">{plan.ownerCount}</p>
        <p className="text-[10px] text-slate-400 mt-0.5">Owners</p>
      </div>

      {/* Revenue */}
      <div className="w-24 shrink-0 text-right">
        <p className="text-sm font-bold tabular-nums" style={{ color: plan.annualRevenue > 0 ? '#10b981' : '#94a3b8' }}>
          {plan.annualRevenue > 0
            ? `₹${plan.annualRevenue >= 100000 ? (plan.annualRevenue / 100000).toFixed(1) + 'L' : fmt(plan.annualRevenue)}`
            : '—'}
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">Revenue / yr</p>
      </div>

      {/* Edit */}
      <button
        onClick={() => onEdit(plan)}
        className="ml-1 flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 hover:border-slate-300 hover:text-slate-700 hover:bg-slate-50 transition-all opacity-0 group-hover:opacity-100 shrink-0"
      >
        <Pencil size={11} /> Edit
      </button>
    </div>
  )
}

/* ── Main ────────────────────────────────────────────────────────────────────── */
export default function Subscriptions() {
  const [plans,   setPlans]   = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)

  const load = () => {
    setLoading(true)
    getPlans()
      .then(setPlans)
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const totalOwners  = plans.reduce((s, p) => s + p.ownerCount,    0)
  const totalRevenue = plans.reduce((s, p) => s + p.annualRevenue,  0)
  const activePlans  = plans.filter(p => p.ownerCount > 0).length

  if (loading) return (
    <div className="flex items-center justify-center h-64"><Spinner size={32} /></div>
  )

  return (
    <div className="space-y-5">

      {/* ── Summary ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Users}       label="Subscribed Owners"    value={totalOwners}   color="#45a793" />
        <StatCard icon={IndianRupee} label="Est. Annual Revenue"
          value={totalRevenue >= 100000 ? `₹${(totalRevenue / 100000).toFixed(2)}L` : `₹${fmt(totalRevenue)}`}
          color="#10b981"
        />
        <StatCard icon={TrendingUp}  label="Plans with Subscribers" value={`${activePlans} / ${plans.length}`} color="#6366f1" />
      </div>

      {/* ── Plan list ── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">

        {/* Table header */}
        <div className="flex items-center gap-4 px-5 py-3 border-b border-slate-100 bg-slate-50/60">
          <div className="w-1 shrink-0" />
          <p className="w-40 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Plan</p>
          <p className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400 hidden md:block">Description</p>
          <p className="w-28 shrink-0 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">Price</p>
          <div className="w-px h-4 bg-slate-200 shrink-0" />
          <p className="w-20 shrink-0 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">Max Props</p>
          <p className="w-16 shrink-0 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">Owners</p>
          <p className="w-24 shrink-0 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-400">Revenue/yr</p>
          <div className="ml-1 w-[64px] shrink-0" />
        </div>

        {/* Rows */}
        {plans.map((plan, i) => (
          <PlanRow
            key={plan.key}
            plan={plan}
            onEdit={setEditing}
            isLast={i === plans.length - 1}
          />
        ))}
      </div>

      {/* Edit modal */}
      {editing && (
        <EditModal
          plan={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}
