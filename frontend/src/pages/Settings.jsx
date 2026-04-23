import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  User, Lock, Shield, Info, LogOut, ChevronRight,
  Save, RefreshCw, Check, CheckCircle2, Eye, EyeOff, KeyRound,
  IndianRupee, Banknote, Landmark, CreditCard,
  ArrowDownUp, Layers, Wallet, Building2,
} from 'lucide-react'
import { useAuth }         from '../context/AuthContext'
import { useProperty }     from '../context/PropertyContext'
import { useToast }        from '../context/ToastContext'
import { useNavigate }     from 'react-router-dom'
import { changePassword }  from '../api/auth'
import PhoneInput          from '../components/ui/PhoneInput'

// ── Payment method definitions ─────────────────────────────────────────────────
const PAYMENT_METHODS = [
  { id: 'cash',          label: 'Cash',          icon: Banknote,    desc: 'Physical cash payments' },
  { id: 'upi',           label: 'UPI',           icon: IndianRupee, desc: 'UPI, PhonePe, GPay, Paytm' },
  { id: 'bank_transfer', label: 'Bank Transfer', icon: Landmark,    desc: 'NEFT, RTGS, IMPS' },
  { id: 'cheque',        label: 'Cheque',        icon: CreditCard,  desc: 'Cheque / DD payments' },
]
const DEFAULT_METHODS = ['cash', 'upi', 'bank_transfer', 'cheque']
const pmKey  = (id) => `pm_${id}`
const loadPM = (id) => { try { return JSON.parse(localStorage.getItem(pmKey(id))) ?? DEFAULT_METHODS } catch { return DEFAULT_METHODS } }
const savePM = (id, arr) => localStorage.setItem(pmKey(id), JSON.stringify(arr))

// ── Shared primitives ──────────────────────────────────────────────────────────
const SectionHead = ({ title, desc }) => (
  <div className="mb-6">
    <h2 className="text-base font-bold text-slate-800">{title}</h2>
    {desc && <p className="text-sm text-slate-400 mt-0.5">{desc}</p>}
  </div>
)

// ── Profile panel ──────────────────────────────────────────────────────────────
const normalizePhone = (val) => val ?? ''

const ProfilePanel = ({ user, onUpdate }) => {
  const toast      = useToast()
  const hasSynced  = useRef(false)
  const [name,      setName]      = useState(user?.name  ?? '')
  const [phone,     setPhone]     = useState(normalizePhone(user?.phone))
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const [phoneErr,  setPhoneErr]  = useState('')
  const [lastSaved, setLastSaved] = useState(null)

  // Sync form when user loads after mount
  useEffect(() => {
    if (user && !hasSynced.current) {
      hasSynced.current = true
      setName(user.name ?? '')
      setPhone(normalizePhone(user.phone))
    }
  }, [user])

  const initials   = (user?.name ?? '?').split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  const savedPhone = normalizePhone(user?.phone)
  const dirty      = name.trim() !== (user?.name ?? '') || phone !== savedPhone

  const validatePhone = (val) => {
    if (!val || !val.trim()) return 'Mobile number is required'
    if (!/^\+\d{7,15}$/.test(val.trim())) return 'Enter a valid mobile number'
    return ''
  }

  const handlePhoneChange = (val) => {
    setPhone(val)
    setPhoneErr(val ? validatePhone(val) : '')
    setError('')
  }

  const handleSave = async () => {
    if (!name.trim()) { setError('Name cannot be empty'); return }
    const pErr = validatePhone(phone)
    if (pErr) { setPhoneErr(pErr); return }
    setSaving(true); setError('')
    try {
      await onUpdate({ name: name.trim(), phone: phone.trim() })
      setLastSaved(new Date())
      toast('Profile updated successfully', 'success')
    } catch (err) {
      setError(err.response?.data?.message ?? 'Failed to save. Please try again.')
      toast('Failed to save profile', 'error')
    } finally { setSaving(false) }
  }

  const fmtTime = (d) => d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <SectionHead title="Profile" desc="Your account details" />

      {/* Avatar card */}
      <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200 mb-6">
        <div className="shrink-0 flex h-14 w-14 items-center justify-center rounded-2xl text-lg font-bold text-white"
          style={{ background: 'linear-gradient(135deg, #60C3AD 0%, #4aa897 100%)' }}>
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-slate-800 truncate">{user?.name ?? '—'}</p>
          <p className="text-sm text-slate-400 truncate">{user?.email ?? '—'}</p>
        </div>
        <div className="shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1 bg-emerald-50 border border-emerald-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="text-[11px] font-semibold text-emerald-600">Active</span>
        </div>
      </div>

      {/* Editable fields */}
      <div className="space-y-4">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Full Name</label>
          <input
            value={name}
            onChange={e => { setName(e.target.value); setError('') }}
            placeholder="Your name"
            className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-[#60C3AD]/30 focus:border-[#60C3AD] transition-colors"
          />
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Mobile Number</label>
          <PhoneInput
            value={phone}
            onChange={handlePhoneChange}
            placeholder="Mobile number"
            error={!!phoneErr}
          />
          {phoneErr
            ? <p className="text-[11px] text-red-500 mt-1">{phoneErr}</p>
            : <p className="text-[11px] text-slate-400 mt-1">Select country code and enter your number</p>
          }
        </div>
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Email</label>
          <div className="w-full rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-400 flex items-center justify-between">
            <span>{user?.email ?? '—'}</span>
            <span className="text-[10px] bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full font-medium">Cannot change</span>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200 px-3.5 py-2.5">
            <p className="text-[12px] text-red-600 font-medium">{error}</p>
          </div>
        )}

        {/* Sticky save bar */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-100 sticky bottom-0 bg-white pb-1">
          <div>
            {lastSaved && (
              <p className="text-[10px] text-slate-400">Last updated: {fmtTime(lastSaved)}</p>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={!dirty || saving || !!phoneErr}
            className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #60C3AD 0%, #4aa897 100%)' }}
          >
            {saving
              ? <><RefreshCw size={13} className="animate-spin" /> Saving…</>
              : <><Save size={13} /> Save Changes</>}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Payments panel ─────────────────────────────────────────────────────────────
const PaymentsPanel = ({ selectedProperty }) => {
  const toast = useToast()
  const [enabled, setEnabled] = useState(() => selectedProperty ? loadPM(selectedProperty._id) : DEFAULT_METHODS)
  const [saved,   setSaved]   = useState(() => selectedProperty ? loadPM(selectedProperty._id) : DEFAULT_METHODS)

  useEffect(() => {
    if (selectedProperty) {
      const m = loadPM(selectedProperty._id)
      setEnabled(m)
      setSaved(m)
    }
  }, [selectedProperty?._id])

  const dirty = [...enabled].sort().join() !== [...saved].sort().join()

  const toggle = (id) => setEnabled(prev => {
    if (prev.includes(id)) return prev.length <= 1 ? prev : prev.filter(m => m !== id)
    return [...prev, id]
  })

  const handleSave = () => {
    if (!selectedProperty) return
    savePM(selectedProperty._id, enabled)
    setSaved([...enabled])
    toast('Payment methods updated', 'success')
  }

  return (
    <>
      <SectionHead
        title="Payment Methods"
        desc={selectedProperty ? `For ${selectedProperty.name}` : 'Select a property first'}
      />

      <div className="space-y-2 mb-5">
        {PAYMENT_METHODS.map(({ id, label, icon: Icon, desc }) => {
          const on = enabled.includes(id)
          return (
            <button key={id} type="button" onClick={() => toggle(id)}
              className={`w-full flex items-center gap-3 p-3.5 rounded-xl border text-left transition-all duration-200 ${
                on
                  ? 'border-[#60C3AD]/40 bg-white shadow-sm hover:border-[#60C3AD]/60'
                  : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
              }`}>
              <span className="shrink-0 flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-200"
                style={on
                  ? { background: 'rgba(96,195,173,0.12)', color: '#60C3AD' }
                  : { background: '#e2e8f0', color: '#94a3b8' }}>
                <Icon size={15} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className={`text-sm font-semibold transition-colors duration-200 ${on ? 'text-slate-700' : 'text-slate-500'}`}>{label}</p>
                  {!on && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-200 text-slate-500">
                      Disabled
                    </span>
                  )}
                </div>
                <p className={`text-[11px] mt-0.5 transition-colors duration-200 ${on ? 'text-slate-400' : 'text-slate-400'}`}>{desc}</p>
              </div>
              <span className={`shrink-0 flex h-5 w-5 items-center justify-center rounded-full border-2 transition-all duration-200 ${
                on ? 'border-[#60C3AD] bg-[#60C3AD]' : 'border-slate-300 bg-white'
              }`}>
                {on && <Check size={10} className="text-white" strokeWidth={3} />}
              </span>
            </button>
          )
        })}
      </div>

      <div className="rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5 mb-4">
        <p className="text-[11px] text-slate-600 font-medium leading-relaxed">
          Only enabled methods will appear when recording payments.
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">Partial payments are always allowed.</p>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-slate-100 sticky bottom-0 bg-white pb-1">
        <p className="text-[10px] text-slate-400">{enabled.length} of {PAYMENT_METHODS.length} enabled</p>
        <button
          onClick={handleSave}
          disabled={!selectedProperty || !dirty}
          className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(135deg, #60C3AD 0%, #4aa897 100%)' }}
        >
          <Save size={13} /> Save
        </button>
      </div>
    </>
  )
}

// ── Billing Rules panel ────────────────────────────────────────────────────────
const BILLING_RULES = [
  { icon: User,        title: 'Rent follows move-in date',       line: 'Generated monthly from check-in date'     },
  { icon: ArrowDownUp, title: 'Payments clear oldest dues first', line: 'Applied to oldest pending amount'         },
  { icon: Wallet,      title: 'Deposit is manual',               line: 'Used only when you apply it'              },
  { icon: IndianRupee, title: 'Extra payment becomes advance',    line: 'Auto-applied to future rent'              },
  { icon: Layers,      title: 'Partial payments allowed',        line: 'Any amount can be paid anytime'           },
  { icon: Check,       title: 'Charges are manual',              line: 'Added only when you create them'          },
]

const HowBillingWorksPanel = () => (
  <>
    <SectionHead title="Billing Rules" desc="How the system handles money — always consistent." />
    <div className="divide-y divide-slate-100 rounded-xl border border-slate-100 overflow-hidden mb-4">
      {BILLING_RULES.map(({ icon: Icon, title, line }) => (
        <div key={title} className="flex items-start gap-3 px-4 py-3.5 bg-white">
          <span className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg mt-0.5"
            style={{ background: 'rgba(96,195,173,0.10)', color: '#60C3AD' }}>
            <Icon size={13} />
          </span>
          <div>
            <p className="text-[13px] font-semibold text-slate-700">{title}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{line}</p>
          </div>
        </div>
      ))}
    </div>
    <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-3">
      <span className="text-amber-400 mt-0.5 shrink-0 text-sm font-bold">💡</span>
      <p className="text-[11px] text-amber-700 leading-relaxed">
        <span className="font-semibold">Tip:</span> Use deposit when a tenant is about to vacate to quickly clear dues.
      </p>
    </div>
  </>
)

// ── Security panel ─────────────────────────────────────────────────────────────
const PwdInput = ({ id, label, value, onChange, show, onToggle, placeholder, hasError }) => (
  <div>
    <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
      {label}
    </label>
    <div className="relative">
      <input
        id={id}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete="off"
        className={`w-full rounded-xl border pr-10 px-3.5 py-2.5 text-sm text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 transition-colors ${
          hasError
            ? 'border-red-300 focus:ring-red-200 focus:border-red-400'
            : 'border-slate-200 focus:ring-[#60C3AD]/30 focus:border-[#60C3AD]'
        }`}
      />
      <button
        type="button"
        onClick={onToggle}
        tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
      >
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  </div>
)

const SecurityPanel = () => {
  const toast        = useToast()
  const lastLoginRaw = localStorage.getItem('gif_login_ts')
  const lastLogin    = lastLoginRaw
    ? new Date(lastLoginRaw).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const [form,    setForm]    = useState({ current: '', newPwd: '', confirm: '' })
  const [show,    setShow]    = useState({ current: false, newPwd: false, confirm: false })
  const [saving,  setSaving]  = useState(false)
  const [error,   setError]   = useState('')
  const [success, setSuccess] = useState(false)

  const set    = (k, v) => { setForm(f => ({ ...f, [k]: v })); setError(''); setSuccess(false) }
  const toggle = (k)    => setShow(s => ({ ...s, [k]: !s[k] }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.current)             { setError('Enter your current password'); return }
    if (form.newPwd.length < 6)    { setError('New password must be at least 6 characters'); return }
    if (form.newPwd !== form.confirm) { setError('New passwords do not match'); return }
    setSaving(true); setError('')
    try {
      await changePassword({ currentPassword: form.current, newPassword: form.newPwd })
      setSuccess(true)
      setForm({ current: '', newPwd: '', confirm: '' })
      toast('Password changed successfully', 'success')
    } catch (err) {
      const code = err.response?.data?.code
      setError(
        code === 'WRONG_CURRENT_PASSWORD'
          ? 'Current password is incorrect.'
          : (err.response?.data?.message ?? 'Failed to change password. Try again.')
      )
    } finally {
      setSaving(false)
    }
  }

  const isCurrentError = error === 'Current password is incorrect.'

  return (
    <>
      <SectionHead title="Security" desc="Change your login password" />

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3.5 py-3 text-sm text-red-600">
            <Lock size={13} className="shrink-0" />{error}
          </div>
        )}

        {/* Success */}
        {success && (
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3.5 py-3 text-sm text-emerald-700">
            <CheckCircle2 size={13} className="shrink-0" />Password updated successfully!
          </div>
        )}

        <PwdInput
          id="current-pwd"
          label="Current Password"
          value={form.current}
          onChange={e => set('current', e.target.value)}
          show={show.current}
          onToggle={() => toggle('current')}
          placeholder="Your current password"
          hasError={isCurrentError}
        />

        <div className="h-px bg-slate-100" />

        <PwdInput
          id="new-pwd"
          label="New Password"
          value={form.newPwd}
          onChange={e => set('newPwd', e.target.value)}
          show={show.newPwd}
          onToggle={() => toggle('newPwd')}
          placeholder="Min. 6 characters"
          hasError={false}
        />

        <PwdInput
          id="confirm-pwd"
          label="Confirm New Password"
          value={form.confirm}
          onChange={e => set('confirm', e.target.value)}
          show={show.confirm}
          onToggle={() => toggle('confirm')}
          placeholder="Repeat new password"
          hasError={!!error && form.confirm && form.newPwd !== form.confirm}
        />

        <button
          type="submit"
          disabled={saving || !form.current || !form.newPwd || !form.confirm}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition-all hover:opacity-90 active:scale-[.98] disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: 'linear-gradient(135deg, #45a793, #60c3ad)' }}
        >
          {saving
            ? <><RefreshCw size={14} className="animate-spin" />Updating…</>
            : <><KeyRound size={14} />Update Password</>}
        </button>
      </form>

      {/* Footer info */}
      <div className="mt-6 space-y-2">
        {lastLogin && (
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5">
            <Shield size={12} className="text-slate-400 shrink-0" />
            <p className="text-[11px] text-slate-500">Last login: <span className="font-medium">{lastLogin}</span></p>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3.5 py-2.5">
          <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
          <p className="text-[11px] text-emerald-700 font-medium">Your data is securely stored and encrypted.</p>
        </div>
      </div>
    </>
  )
}

// ── Subscription panel ─────────────────────────────────────────────────────────
const PLAN_CONFIG = {
  standard:   { name: 'Standard',   maxProperties: 1,        price: 1999,  color: '#64748b', bg: '#f8fafc', border: '#e2e8f0' },
  pro:        { name: 'Pro',        maxProperties: 2,        price: 2999,  color: '#3b82f6', bg: '#eff6ff', border: '#bfdbfe' },
  elite:      { name: 'Elite',      maxProperties: 3,        price: 3999,  color: '#8b5cf6', bg: '#f5f3ff', border: '#ddd6fe' },
  enterprise: { name: 'Enterprise', maxProperties: Infinity, price: 5999,  color: '#10b981', bg: '#ecfdf5', border: '#a7f3d0' },
}

const SubscriptionPanel = ({ user, propertyCount }) => {
  const plan   = user?.plan ?? 'standard'
  const config = PLAN_CONFIG[plan]
  const used   = propertyCount ?? 0
  const max    = config.maxProperties
  const pct    = max === Infinity ? 100 : Math.min(100, Math.round((used / max) * 100))

  return (
    <>
      <SectionHead title="Subscription" desc="Your current plan and available options" />

      {/* Current plan card */}
      <div className="rounded-2xl border p-5 mb-5" style={{ background: config.bg, borderColor: config.border }}>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest mb-1" style={{ color: config.color }}>Current Plan</p>
            <p className="text-xl font-black text-slate-800">{config.name}</p>
            <p className="text-sm text-slate-500 mt-0.5">
              ₹{config.price.toLocaleString('en-IN')}<span className="text-xs text-slate-400">/year</span>
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-3xl font-black leading-none" style={{ color: config.color }}>
              {used}{max !== Infinity && `/${max}`}
            </p>
            <p className="text-[11px] text-slate-400 mt-1">
              {max === Infinity ? 'Unlimited properties' : `Propert${used !== 1 ? 'ies' : 'y'} used`}
            </p>
          </div>
        </div>
        {max !== Infinity && (
          <div className="mt-4">
            <div className="flex justify-between text-[11px] text-slate-400 mb-1.5">
              <span>Property usage</span>
              <span style={{ color: pct >= 100 ? '#ef4444' : config.color }}>{pct}%</span>
            </div>
            <div className="h-2 bg-white/70 rounded-full overflow-hidden border" style={{ borderColor: config.border }}>
              <div className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, background: pct >= 100 ? '#ef4444' : config.color }} />
            </div>
            {pct >= 100 && (
              <p className="text-[11px] font-medium text-red-500 mt-1.5">Property limit reached — upgrade to add more.</p>
            )}
          </div>
        )}
      </div>

      {/* All plans comparison */}
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-3">Available Plans</p>
      <div className="space-y-2">
        {Object.entries(PLAN_CONFIG).map(([key, cfg]) => {
          const isCurrent = key === plan
          return (
            <div key={key}
              className="flex items-center gap-4 rounded-xl border px-4 py-3.5 transition-all"
              style={isCurrent
                ? { background: cfg.bg, borderColor: cfg.border }
                : { background: '#fff', borderColor: '#e2e8f0', opacity: 0.65 }
              }>
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: cfg.color }} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-slate-700">{cfg.name}</p>
                  {isCurrent && (
                    <span className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded-full text-white"
                      style={{ background: cfg.color }}>Active</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {cfg.maxProperties === Infinity ? 'Unlimited properties' : `Up to ${cfg.maxProperties} propert${cfg.maxProperties === 1 ? 'y' : 'ies'}`}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-black text-slate-700">₹{cfg.price.toLocaleString('en-IN')}</p>
                <p className="text-[10px] text-slate-400">/year</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* Upgrade note */}
      <div className="mt-5 rounded-xl bg-slate-50 border border-slate-200 px-4 py-4 text-center">
        <p className="text-[12px] text-slate-500 mb-1">To upgrade your plan, reach out to us</p>
        <a href="mailto:support@dormaxis.com"
          className="text-[12px] font-semibold transition-colors"
          style={{ color: '#60C3AD' }}>
          support@dormaxis.com
        </a>
      </div>
    </>
  )
}

// ── About panel ────────────────────────────────────────────────────────────────
const ISSUE_CATEGORIES = [
  { id: 'payment', label: 'Payment issue',  subject: 'Payment Issue - DormAxis',  body: 'Describe the payment issue:' },
  { id: 'tenant',  label: 'Tenant issue',   subject: 'Tenant Issue - DormAxis',   body: 'Describe the tenant issue:'  },
  { id: 'bug',     label: 'Bug / error',    subject: 'Bug Report - DormAxis',     body: 'Describe the bug or error:'  },
]

const AboutPanel = () => {
  const [category, setCategory] = useState('payment')

  const handleContact = () => {
    const cat = ISSUE_CATEGORIES.find(c => c.id === category)
    window.open(`mailto:support@tenantinnflow.com?subject=${encodeURIComponent(cat.subject)}&body=${encodeURIComponent(cat.body + '\n\n')}`, '_blank')
  }

  return (
    <>
      <SectionHead title="About" desc="DormAxis — PG & Hostel Management" />

      {/* App identity */}
      <div className="flex items-center gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200 mb-5">
        <div className="shrink-0 flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: 'rgba(96,195,173,0.12)', border: '1.5px solid rgba(96,195,173,0.25)' }}>
          <Building2 size={20} style={{ color: '#60C3AD' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-800">DormAxis</p>
          <p className="text-xs text-slate-400 mt-0.5">PG / Hostel Management Platform</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[12px] font-bold text-slate-700">1.0.0</p>
          <p className="text-[10px] font-semibold mt-0.5 px-2 py-0.5 rounded-full inline-block"
            style={{ background: 'rgba(96,195,173,0.12)', color: '#45a793' }}>
            Latest
          </p>
        </div>
      </div>

      {/* Support section */}
      <div className="rounded-xl border border-slate-100 overflow-hidden mb-2">
        <div className="px-4 py-3.5 bg-slate-50 border-b border-slate-100">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Support</p>
          <p className="text-sm font-medium text-slate-700 mt-1">Need help?</p>
          <a href="mailto:support@tenantinnflow.com"
            className="text-[12px] font-medium mt-0.5 inline-block transition-colors"
            style={{ color: '#60C3AD' }}>
            support@tenantinnflow.com
          </a>
        </div>

        {/* Category selector */}
        <div className="px-4 py-3.5 border-b border-slate-100">
          <p className="text-[11px] font-semibold text-slate-400 mb-2">What's the issue about?</p>
          <div className="flex gap-1.5 flex-wrap">
            {ISSUE_CATEGORIES.map(c => (
              <button key={c.id} type="button" onClick={() => setCategory(c.id)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                  category === c.id
                    ? 'text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
                style={category === c.id ? { background: '#60C3AD' } : {}}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="px-4 py-3.5">
          <button onClick={handleContact}
            className="w-full flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors"
            style={{ background: 'linear-gradient(135deg, #60C3AD 0%, #4aa897 100%)' }}>
            <Info size={13} /> Contact Support
          </button>
        </div>
      </div>
    </>
  )
}

// ── Logout modal ───────────────────────────────────────────────────────────────
const LogoutModal = ({ onCancel, onConfirm }) => createPortal(
  <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
    <div className="absolute inset-0 animate-fadeIn"
      style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
      onClick={onCancel} />
    <div className="relative w-full max-w-sm rounded-t-2xl sm:rounded-2xl bg-white animate-scaleIn p-6 space-y-4"
      style={{ border: '1px solid #E2E8F0', boxShadow: '0 8px 32px rgba(0,0,0,0.10)' }}>
      <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3.5">
        <LogOut size={18} className="text-red-500 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-red-700">Sign out?</p>
          <p className="text-xs text-red-600/80 mt-1 leading-relaxed">You'll be returned to the login screen.</p>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel}
          className="flex-1 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
          Cancel
        </button>
        <button onClick={onConfirm}
          className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 transition-colors">
          Sign out
        </button>
      </div>
    </div>
  </div>,
  document.body
)

// ── Nav items ──────────────────────────────────────────────────────────────────
const SECTIONS = [
  { id: 'profile',      label: 'Profile',       icon: User        },
  { id: 'subscription', label: 'Subscription',  icon: Layers      },
  { id: 'payments',     label: 'Payments',      icon: IndianRupee },
  { id: 'howitworks',   label: 'Billing Rules', icon: Info        },
  { id: 'security',     label: 'Security',      icon: Lock        },
  { id: 'about',        label: 'About',         icon: Building2   },
]

// ── Main ───────────────────────────────────────────────────────────────────────
const Settings = () => {
  const { user, logout, updateUser }           = useAuth()
  const { selectedProperty, properties }       = useProperty()
  const navigate                      = useNavigate()
  const [active, setActive]           = useState('profile')
  const [confirmLogout, setConfirmLogout] = useState(false)

  const handleLogout = () => { logout(); navigate('/login') }

  const renderPanel = () => {
    switch (active) {
      case 'profile':      return <ProfilePanel user={user} onUpdate={updateUser} />
      case 'subscription': return <SubscriptionPanel user={user} propertyCount={properties.length} />
      case 'payments':     return <PaymentsPanel selectedProperty={selectedProperty} />
      case 'howitworks':   return <HowBillingWorksPanel />
      case 'security':     return <SecurityPanel />
      case 'about':        return <AboutPanel />
      default:             return null
    }
  }

  return (
    <div className="flex gap-6 max-w-4xl" style={{ minHeight: 'calc(100vh - 120px)' }}>

      {/* Left nav */}
      <div className="w-52 shrink-0">
        <div className="card overflow-hidden sticky top-6">
          <nav className="p-2 space-y-0.5">
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const isActive = active === id
              return (
                <button key={id} onClick={() => setActive(id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all duration-150 ${
                    isActive ? 'text-[#45a793] font-semibold' : 'text-slate-500 font-medium hover:text-slate-700 hover:bg-slate-50'
                  }`}
                  style={isActive ? { background: 'rgba(96,195,173,0.10)' } : {}}>
                  <span className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg transition-colors"
                    style={isActive
                      ? { background: 'rgba(96,195,173,0.15)', color: '#60C3AD' }
                      : { background: '#f1f5f9', color: '#94a3b8' }}>
                    <Icon size={14} />
                  </span>
                  <span className="text-[13px] truncate">{label}</span>
                  {isActive && <ChevronRight size={13} className="ml-auto shrink-0" style={{ color: '#60C3AD' }} />}
                </button>
              )
            })}
          </nav>

          <div className="border-t border-slate-100 p-2">
            <button onClick={() => setConfirmLogout(true)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-slate-400 font-medium hover:text-red-500 hover:bg-red-50 transition-all duration-150 group">
              <span className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 group-hover:bg-red-100 transition-colors">
                <LogOut size={14} />
              </span>
              <span className="text-[13px]">Sign out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 min-w-0">
        <div className="card p-6">
          {renderPanel()}
        </div>
      </div>

      {confirmLogout && (
        <LogoutModal onCancel={() => setConfirmLogout(false)} onConfirm={handleLogout} />
      )}
    </div>
  )
}

export default Settings
