import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Building2, Eye, EyeOff, CheckCircle2, ArrowRight,
  Shield, Lock,
  User, Mail, KeyRound
} from 'lucide-react'
import { signup } from '../api/auth'
import { useAuth } from '../context/AuthContext'



/* ── Password strength logic ──────────────────────────────────────────────── */
const getStrength = (p) => {
  if (!p) return null
  let score = 0
  if (p.length >= 6) score++
  if (p.length >= 8) score++
  if (/[A-Z]/.test(p)) score++
  if (/[0-9]/.test(p)) score++
  if (/[^A-Za-z0-9]/.test(p)) score++

  if (score <= 1) return { label: 'Weak', pct: 25, color: '#ef4444', bg: 'rgba(239,68,68,.12)' }
  if (score <= 2) return { label: 'Fair', pct: 50, color: '#f59e0b', bg: 'rgba(245,158,11,.12)' }
  if (score <= 3) return { label: 'Good', pct: 75, color: '#22c55e', bg: 'rgba(34,197,94,.12)' }
  return              { label: 'Strong', pct: 100, color: '#10b981', bg: 'rgba(16,185,129,.12)' }
}

/* ═══════════════════════════════════════════════════════════════════════════ */
const Signup = () => {
  const { loginUser } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))
  const strength = getStrength(form.password)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (form.password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await signup(form)
      loginUser(res.data.token, res.data.data)
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.message || 'Signup failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen" id="signup-page">

      {/* ───────────────── LEFT PANEL (desktop) ───────────────── */}
      <div className="signup-hero hidden lg:flex lg:w-[46%] flex-col justify-between relative overflow-hidden">

        {/* Animated gradient mesh */}
        <div className="signup-gradient-orb signup-gradient-orb--1" />
        <div className="signup-gradient-orb signup-gradient-orb--2" />
        <div className="signup-gradient-orb signup-gradient-orb--3" />

        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.5) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        {/* Content */}
        <div className="relative z-10 px-12 pt-10">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 backdrop-blur-sm border border-white/20">
              <Building2 size={20} className="text-white" />
            </div>
            <span className="text-white font-semibold text-lg tracking-tight">TenantInnFlow</span>
          </div>
        </div>

        {/* Hero content */}
        <div className="relative z-10 px-12 flex-1 flex flex-col justify-center -mt-8">
          <h2 className="text-4xl font-bold text-white leading-[1.15] tracking-tight">
            Manage your PG / Hostel
            <br />
            <span className="signup-hero-gradient-text">like a pro.</span>
          </h2>
          <p className="mt-4 text-white/70 text-[15px] leading-relaxed max-w-sm">
            Join hundreds of PG / Hostel owners who simplified their operations with our all-in-one management platform.
          </p>

          {/* Perks list */}
          <ul className="mt-10 space-y-3">
            {['Effortless property management', 'Track rent & expenses seamlessly', 'Real-time occupancy insights'].map((perk) => (
              <li key={perk} className="flex items-center gap-3 text-sm text-white/80">
                <CheckCircle2 size={16} className="shrink-0 text-white/50" />
                {perk}
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="relative z-10 px-12 pb-8">
          <p className="text-[11px] text-white/40">© {new Date().getFullYear()} TenantInnFlow · All rights reserved</p>
        </div>
      </div>

      {/* ───────────────── RIGHT PANEL (form) ───────────────── */}
      <div className="flex flex-1 flex-col bg-gray-50/80 min-h-screen">

        {/* Top bar — mobile logo + desktop "already have account" */}
        <div className="flex items-center justify-between px-6 py-5 lg:px-10">
          <div className="flex items-center gap-2.5 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-600">
              <Building2 size={18} className="text-white" />
            </div>
            <span className="font-semibold text-gray-900">TenantInnFlow</span>
          </div>
          <div className="hidden lg:block" />
        </div>

        {/* Form area */}
        <div
          className="flex flex-1 items-center justify-center px-6 pb-10"
          style={{
            opacity: mounted ? 1 : 0,
            transform: mounted ? 'translateY(0)' : 'translateY(12px)',
            transition: 'opacity .45s ease, transform .45s ease',
          }}
        >
          <div className="w-full max-w-[420px]">

            {/* Heading */}
            <div className="mb-8">
              <h1 className="text-[28px] font-bold text-gray-900 tracking-tight">Create your account</h1>
              <p className="mt-2 text-[15px] text-gray-500">
                Sign up to start managing your properties in one place
              </p>
            </div>


            {/* Card */}
            <div className="signup-form-card">
              {/* Error */}
              {error && (
                <div className="mb-5 flex items-start gap-3 rounded-xl bg-red-50 border border-red-100 px-4 py-3.5 text-sm text-red-700 animate-pageIn">
                  <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100">
                    <span className="text-xs font-bold text-red-600">!</span>
                  </div>
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5" id="signup-form">

                {/* ── Name ── */}
                <div className="signup-field-group">
                  <label htmlFor="signup-name" className="signup-label">
                    <User size={14} className="text-gray-400" />
                    Full Name
                  </label>
                  <input
                    id="signup-name"
                    type="text"
                    className="signup-input"
                    placeholder="Rahul Sharma"
                    value={form.name}
                    onChange={(e) => set('name', e.target.value)}
                    required
                    autoFocus
                    autoComplete="name"
                  />
                </div>

                {/* ── Email ── */}
                <div className="signup-field-group">
                  <label htmlFor="signup-email" className="signup-label">
                    <Mail size={14} className="text-gray-400" />
                    Email address
                  </label>
                  <input
                    id="signup-email"
                    type="email"
                    className="signup-input"
                    placeholder="you@example.com"
                    value={form.email}
                    onChange={(e) => set('email', e.target.value)}
                    required
                    autoComplete="email"
                  />
                </div>

                {/* ── Password ── */}
                <div className="signup-field-group">
                  <label htmlFor="signup-password" className="signup-label">
                    <KeyRound size={14} className="text-gray-400" />
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="signup-password"
                      type={showPassword ? 'text' : 'password'}
                      className="signup-input pr-11"
                      placeholder="Min. 6 characters"
                      value={form.password}
                      onChange={(e) => set('password', e.target.value)}
                      required
                      minLength={6}
                      autoComplete="new-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-all"
                      tabIndex={-1}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>

                  {/* Strength meter */}
                  {strength && (
                    <div className="mt-2.5 flex items-center gap-3">
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500 ease-out"
                          style={{ width: `${strength.pct}%`, background: strength.color }}
                        />
                      </div>
                      <span
                        className="text-[11px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                        style={{ color: strength.color, background: strength.bg }}
                      >
                        {strength.label}
                      </span>
                    </div>
                  )}
                </div>

                {/* ── Submit ── */}
                <button
                  type="submit"
                  id="signup-submit"
                  className="signup-submit-btn group"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.4 0 0 5.4 0 12h4z" />
                      </svg>
                      Creating account…
                    </>
                  ) : (
                    <>
                      Create account
                      <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
                    </>
                  )}
                </button>
              </form>

              {/* Secure footer */}
              <div className="mt-6 flex items-center justify-center gap-2 text-xs text-gray-400">
                <Shield size={12} />
                <span>Your data is encrypted and secure</span>
              </div>
            </div>

            {/* Sign-in link */}
            <p className="mt-6 text-center text-sm text-gray-500">
              Already have an account?{' '}
              <Link to="/login" className="font-semibold text-primary-600 hover:text-primary-700">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>

      {/* ── Scoped styles ── */}
      <style>{`
        /* ── Hero panel gradient ── */
        .signup-hero {
          background: linear-gradient(145deg, #1a5c4e 0%, #358a79 40%, #60c3ad 100%);
        }

        .signup-gradient-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
          will-change: transform;
        }
        .signup-gradient-orb--1 {
          width: 400px; height: 400px;
          background: radial-gradient(circle, rgba(164,234,216,.4), transparent 70%);
          top: -80px; right: -100px;
          animation: orbFloat1 8s ease-in-out infinite;
        }
        .signup-gradient-orb--2 {
          width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(120,223,197,.35), transparent 70%);
          bottom: 10%; left: -60px;
          animation: orbFloat2 10s ease-in-out infinite;
        }
        .signup-gradient-orb--3 {
          width: 200px; height: 200px;
          background: radial-gradient(circle, rgba(96,195,173,.3), transparent 70%);
          top: 50%; right: 20%;
          animation: orbFloat3 12s ease-in-out infinite;
        }

        @keyframes orbFloat1 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(-30px, 40px) scale(1.1); }
        }
        @keyframes orbFloat2 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(40px, -30px) scale(1.15); }
        }
        @keyframes orbFloat3 {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50%      { transform: translate(-20px, -25px) scale(1.08); }
        }

        /* ── Gradient text ── */
        .signup-hero-gradient-text {
          background: linear-gradient(90deg, #d0f5eb, #effcf8, #a4ead8);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        /* ── Feature cards ── */
        .signup-feature-card {
          display: flex;
          align-items: flex-start;
          gap: 14px;
          padding: 14px 16px;
          border-radius: 14px;
          background: rgba(255,255,255,.06);
          border: 1px solid rgba(255,255,255,.08);
          backdrop-filter: blur(12px);
          animation: featureSlideIn .5s ease-out both;
        }
        @keyframes featureSlideIn {
          from { opacity: 0; transform: translateX(-16px); }
          to   { opacity: 1; transform: translateX(0); }
        }

        /* ── Form card ── */
        .signup-form-card {
          background: white;
          border-radius: 20px;
          border: 1px solid rgba(0,0,0,.06);
          padding: 32px;
          box-shadow:
            0 1px 2px rgba(0,0,0,.04),
            0 4px 12px rgba(0,0,0,.04),
            0 12px 40px rgba(96,195,173,.06);
        }

        /* ── Field group ── */
        .signup-field-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        /* ── Label ── */
        .signup-label {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          font-weight: 600;
          color: #374151;
          letter-spacing: .01em;
        }

        /* ── Input ── */
        .signup-input {
          display: block;
          width: 100%;
          border-radius: 12px;
          border: 1.5px solid #e5e7eb;
          background: #f9fafb;
          padding: 11px 14px;
          font-size: 14px;
          color: #111827;
          transition: all .2s ease;
        }
        .signup-input::placeholder {
          color: #9ca3af;
        }
        .signup-input:hover {
          border-color: #d1d5db;
          background: #fff;
        }
        .signup-input:focus {
          outline: none;
          border-color: #60c3ad;
          background: #fff;
          box-shadow: 0 0 0 3px rgba(96,195,173,.1);
        }

        /* ── Submit button ── */
        .signup-submit-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          width: 100%;
          padding: 12px 20px;
          border-radius: 12px;
          border: none;
          background: linear-gradient(135deg, #45a793, #60c3ad);
          color: white;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all .2s ease;
          box-shadow: 0 2px 8px rgba(96,195,173,.25);
          margin-top: 4px;
        }
        .signup-submit-btn:hover:not(:disabled) {
          background: linear-gradient(135deg, #358a79, #45a793);
          box-shadow: 0 4px 16px rgba(96,195,173,.35);
          transform: translateY(-1px);
        }
        .signup-submit-btn:active:not(:disabled) {
          transform: translateY(0) scale(.985);
        }
        .signup-submit-btn:disabled {
          opacity: .6;
          cursor: not-allowed;
        }
      `}</style>
    </div>
  )
}

export default Signup
