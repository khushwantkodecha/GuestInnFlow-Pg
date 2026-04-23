import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Building2, Users, BedDouble, TrendingUp,
  Mail, Phone, Calendar, MapPin, ShieldCheck, ShieldOff, Layers, X, CheckCircle2,
} from 'lucide-react'
import Badge   from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import { getOwner, toggleOwner, updateOwnerPlan } from '../api/owners'

const PLAN_OPTIONS = [
  { value: 'standard',   label: 'Standard',   maxProperties: 1,        price: '₹1,999/yr', color: '#64748b', bg: '#f8fafc', border: '#e2e8f0' },
  { value: 'pro',        label: 'Pro',        maxProperties: 2,        price: '₹2,999/yr', color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' },
  { value: 'elite',      label: 'Elite',      maxProperties: 3,        price: '₹3,999/yr', color: '#8b5cf6', bg: '#f5f3ff', border: '#ddd6fe' },
  { value: 'enterprise', label: 'Enterprise', maxProperties: Infinity, price: '₹5,999/yr', color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' },
]

export default function OwnerDetail() {
  const { id } = useParams()
  const [owner,        setOwner]        = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [toggling,     setToggling]     = useState(false)
  const [confirm,      setConfirm]      = useState(false)
  const [planModal,    setPlanModal]    = useState(false)
  const [selectedPlan, setSelectedPlan] = useState(null)
  const [planSaving,   setPlanSaving]   = useState(false)
  const [planSuccess,  setPlanSuccess]  = useState(false)
  const [planError,    setPlanError]    = useState('')

  const load = () => {
    setLoading(true)
    getOwner(id).then(setOwner).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [id])

  const handleToggle = async () => {
    setToggling(true)
    setConfirm(false)
    try { await toggleOwner(id, !owner.isActive); load() } catch {}
    setToggling(false)
  }

  const openPlanModal = () => {
    setSelectedPlan(owner.plan ?? 'standard')
    setPlanError('')
    setPlanModal(true)
  }

  const closePlanModal = () => {
    if (planSaving) return
    setPlanModal(false)
    setSelectedPlan(null)
    setPlanError('')
    setPlanSuccess(false)
  }

  const handlePlanSave = async () => {
    if (!selectedPlan || selectedPlan === (owner.plan ?? 'standard')) return
    setPlanSaving(true)
    setPlanError('')
    try {
      await updateOwnerPlan(id, selectedPlan)
      load()
      setPlanSuccess(true)
      setTimeout(() => {
        setPlanModal(false)
        setSelectedPlan(null)
        setPlanSuccess(false)
      }, 1800)
    } catch (err) {
      setPlanError(err.response?.data?.message || 'Failed to update plan')
    } finally {
      setPlanSaving(false)
    }
  }

  if (loading) return <div className="flex items-center justify-center h-64"><Spinner size={28} /></div>
  if (!owner)  return <div className="flex items-center justify-center h-64 text-sm text-slate-400">Owner not found.</div>

  const initials      = owner.name?.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'U'
  const joinDate      = new Date(owner.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  const revenue       = owner.monthlyRevenue ?? 0
  const revenueLabel  = revenue >= 100000 ? `₹${(revenue/100000).toFixed(1)}L` : revenue >= 1000 ? `₹${(revenue/1000).toFixed(1)}K` : `₹${revenue}`

  const currentPlanOpt  = PLAN_OPTIONS.find(p => p.value === (owner.plan ?? 'standard')) ?? PLAN_OPTIONS[0]
  const selectedPlanOpt = PLAN_OPTIONS.find(p => p.value === selectedPlan)
  const planChanged     = selectedPlan && selectedPlan !== (owner.plan ?? 'standard')

  return (
    <div className="space-y-4">

      {/* Back */}
      <Link to="/owners" className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-700 transition-colors">
        <ArrowLeft size={13} /> Back to owners
      </Link>

      {/* Profile card */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">

          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div
              className="w-14 h-14 rounded-xl flex items-center justify-center text-lg font-black text-white shrink-0"
              style={{ background: 'linear-gradient(135deg, #45a793, #60c3ad)' }}
            >
              {initials}
            </div>

            {/* Info */}
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-lg font-bold text-slate-800 leading-none">{owner.name}</h1>
                <Badge variant={owner.isActive ? 'active' : 'inactive'}>
                  {owner.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2.5">
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Mail size={12} className="text-slate-400" />{owner.email}
                </span>
                {owner.phone && (
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Phone size={12} className="text-slate-400" />{owner.phone}
                  </span>
                )}
                <span className="flex items-center gap-1.5 text-xs text-slate-500">
                  <Calendar size={12} className="text-slate-400" />Joined {joinDate}
                </span>
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={openPlanModal}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 transition-all"
            >
              <Layers size={13} />
              Change Plan
            </button>
            <button
              onClick={() => setConfirm(true)}
              disabled={toggling}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold border transition-all disabled:opacity-50 ${
                owner.isActive
                  ? 'border-red-200 text-red-600 bg-white hover:bg-red-50'
                  : 'border-emerald-200 text-emerald-700 bg-white hover:bg-emerald-50'
              }`}
            >
              {owner.isActive ? <ShieldOff size={13} /> : <ShieldCheck size={13} />}
              {owner.isActive ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: Building2,  label: 'Properties',   value: owner.propertyCount ?? 0, color: '#6366f1' },
          { icon: BedDouble,  label: 'Total Beds',   value: owner.bedCount ?? 0,       color: '#f59e0b' },
          { icon: Users,      label: 'Tenants',      value: owner.tenantCount ?? 0,    color: '#45a793' },
          { icon: TrendingUp, label: 'Revenue (MTD)', value: revenueLabel,             color: '#10b981' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{s.label}</p>
              <s.icon size={14} style={{ color: s.color }} />
            </div>
            <p className="text-2xl font-black text-slate-800 tracking-tight">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Properties */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-800">Properties</p>
            <p className="text-xs text-slate-400 mt-0.5">{owner.properties?.length ?? 0} total</p>
          </div>
        </div>

        {!owner.properties?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-300 gap-2">
            <Building2 size={32} />
            <p className="text-sm text-slate-400">No properties added yet</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {owner.properties.map(p => {
              const addr       = [p.address?.city, p.address?.state].filter(Boolean).join(', ')
              const pct        = p.bedCount > 0 ? Math.round(((p.tenantCount ?? 0) / p.bedCount) * 100) : 0
              const barColor   = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#45a793'

              return (
                <div key={p._id} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50 transition-colors">

                  <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-indigo-50">
                    <Building2 size={15} className="text-indigo-500" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-slate-800">{p.name}</p>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                        {p.type}
                      </span>
                    </div>
                    {addr && (
                      <p className="flex items-center gap-1 text-xs text-slate-400 mt-0.5">
                        <MapPin size={10} />{addr}
                      </p>
                    )}
                  </div>

                  <div className="hidden sm:flex items-center gap-6 shrink-0 text-center">
                    <div>
                      <p className="text-sm font-bold text-slate-700">{p.bedCount ?? 0}</p>
                      <p className="text-[10px] text-slate-400">Beds</p>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-700">{p.tenantCount ?? 0}</p>
                      <p className="text-[10px] text-slate-400">Tenants</p>
                    </div>
                  </div>

                  <div className="hidden lg:block w-24 shrink-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-slate-400">Occupancy</span>
                      <span className="text-[10px] font-bold text-slate-600">{pct}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
                    </div>
                  </div>

                  <Badge variant={p.isActive ? 'active' : 'inactive'}>
                    {p.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Deactivate confirmation modal ── */}
      {confirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl p-6 space-y-4">
            <div className={`flex items-start gap-3 rounded-xl px-4 py-3.5 border ${
              owner.isActive ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'
            }`}>
              {owner.isActive
                ? <ShieldOff size={18} className="text-red-500 mt-0.5 shrink-0" />
                : <ShieldCheck size={18} className="text-emerald-600 mt-0.5 shrink-0" />
              }
              <div>
                <p className={`text-sm font-semibold ${owner.isActive ? 'text-red-700' : 'text-emerald-700'}`}>
                  {owner.isActive ? 'Deactivate owner?' : 'Activate owner?'}
                </p>
                <p className={`text-xs mt-1 leading-relaxed ${owner.isActive ? 'text-red-600/80' : 'text-emerald-600/80'}`}>
                  {owner.isActive
                    ? `${owner.name}'s account and all their properties will be deactivated.`
                    : `${owner.name}'s account and all their properties will be reactivated.`
                  }
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirm(false)}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleToggle}
                disabled={toggling}
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-white transition-colors disabled:opacity-60 ${
                  owner.isActive ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'
                }`}
              >
                {toggling ? 'Please wait…' : owner.isActive ? 'Yes, deactivate' : 'Yes, activate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Change Plan modal ── */}
      {planModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
          onClick={closePlanModal}
        >
          <div
            className="w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <p className="text-sm font-bold text-slate-800">Change Plan</p>
                <p className="text-xs text-slate-400 mt-0.5">{owner.name}</p>
              </div>
              <button
                onClick={closePlanModal}
                disabled={planSaving}
                className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors disabled:opacity-40"
              >
                <X size={14} />
              </button>
            </div>

            {/* Current plan pill */}
            <div className="px-6 pt-4 pb-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Current Plan</p>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-bold"
                style={{ background: currentPlanOpt.bg, borderColor: currentPlanOpt.border, color: currentPlanOpt.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: currentPlanOpt.color }} />
                {currentPlanOpt.label} — {currentPlanOpt.price}
              </div>
            </div>

            {/* Plan options */}
            <div className="px-6 pb-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2">Select New Plan</p>
              <div className="space-y-2">
                {PLAN_OPTIONS.map(opt => {
                  const isCurrent  = opt.value === (owner.plan ?? 'standard')
                  const isSelected = opt.value === selectedPlan
                  return (
                    <button
                      key={opt.value}
                      onClick={() => !isCurrent && setSelectedPlan(opt.value)}
                      disabled={isCurrent || planSaving}
                      className="w-full flex items-center gap-3.5 rounded-xl border px-4 py-3 text-left transition-all disabled:cursor-default"
                      style={
                        isSelected && !isCurrent
                          ? { background: opt.bg, borderColor: opt.color }
                          : isCurrent
                            ? { background: '#f8fafc', borderColor: '#e2e8f0', opacity: 0.55 }
                            : { background: '#fff', borderColor: '#e2e8f0' }
                      }
                    >
                      {/* Radio */}
                      <div className="shrink-0 w-4 h-4 rounded-full border-2 flex items-center justify-center transition-all"
                        style={
                          isSelected && !isCurrent
                            ? { borderColor: opt.color, background: opt.color }
                            : { borderColor: '#cbd5e1', background: '#fff' }
                        }>
                        {isSelected && !isCurrent && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold" style={{ color: isSelected && !isCurrent ? opt.color : '#334155' }}>
                            {opt.label}
                          </p>
                          {isCurrent && (
                            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-500">
                              Current
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          {opt.maxProperties === Infinity ? 'Unlimited properties' : `Up to ${opt.maxProperties} propert${opt.maxProperties === 1 ? 'y' : 'ies'}`}
                        </p>
                      </div>

                      {/* Price */}
                      <p className="shrink-0 text-sm font-black" style={{ color: isSelected && !isCurrent ? opt.color : '#94a3b8' }}>
                        {opt.price}
                      </p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Confirmation strip + actions */}
            <div className="px-6 py-4 mt-1">
              {planSuccess ? (
                <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3.5">
                  <CheckCircle2 size={18} className="text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-emerald-700">Plan updated successfully</p>
                    <p className="text-xs text-emerald-600/80 mt-0.5">
                      {owner.name}'s plan is now <span className="font-bold">{selectedPlanOpt?.label}</span>.
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {planChanged && selectedPlanOpt && (
                    <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 mb-3"
                      style={{ background: selectedPlanOpt.bg, borderColor: selectedPlanOpt.border }}>
                      <Layers size={14} className="mt-0.5 shrink-0" style={{ color: selectedPlanOpt.color }} />
                      <p className="text-xs leading-relaxed" style={{ color: selectedPlanOpt.color }}>
                        You're about to change <span className="font-bold">{owner.name}'s</span> plan from{' '}
                        <span className="font-bold">{currentPlanOpt.label}</span> to{' '}
                        <span className="font-bold">{selectedPlanOpt.label}</span>.
                      </p>
                    </div>
                  )}

                  {planError && (
                    <p className="text-xs text-red-500 mb-3">{planError}</p>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={closePlanModal}
                      disabled={planSaving}
                      className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handlePlanSave}
                      disabled={!planChanged || planSaving}
                      className="flex-1 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-40"
                      style={{ background: planChanged && selectedPlanOpt ? selectedPlanOpt.color : '#94a3b8' }}
                    >
                      {planSaving ? 'Saving…' : 'Confirm Change'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
