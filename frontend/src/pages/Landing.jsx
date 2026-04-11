import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2, ArrowRight, CheckCircle2, ChevronRight,
  Users, Bed, BarChart3, Bell, Shield, Wallet,
  Home, Star, Zap, Clock, CreditCard, PieChart,
  TrendingUp, Menu, X
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════════════════════════ */
const STATS = [
  { value: '500+',  label: 'PGs Registered',    icon: Building2 },
  { value: '12,000+', label: 'Beds Managed',    icon: Bed },
  { value: '₹8 Cr+',  label: 'Rent Processed',  icon: Wallet },
  { value: '99.9%',   label: 'Uptime',           icon: Zap },
]

const FEATURES = [
  {
    icon: Home,
    title: 'Property Management',
    desc: 'Manage multiple PG properties from a single dashboard. Track rooms, beds, floors, and occupancy in real time.',
    color: '#60c3ad',
    bg: 'rgba(96,195,173,.08)',
  },
  {
    icon: Users,
    title: 'Tenant Tracking',
    desc: 'Complete tenant lifecycle — from check-in to check-out. Store ID proofs, emergency contacts, and history.',
    color: '#4bab96',
    bg: 'rgba(75,171,150,.08)',
  },
  {
    icon: CreditCard,
    title: 'Rent & Payment Collection',
    desc: 'Automated rent tracking with due date alerts. Record partial payments, advances, and generate receipts instantly.',
    color: '#06b6d4',
    bg: 'rgba(6,182,212,.08)',
  },
  {
    icon: PieChart,
    title: 'Expense Management',
    desc: 'Log all property expenses — maintenance, utilities, staff salaries. Categorize and track spending trends.',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,.08)',
  },
  {
    icon: Bell,
    title: 'Smart Notifications',
    desc: 'Get automated alerts for overdue rent, expiring leases, vacant beds, and upcoming check-outs.',
    color: '#ef4444',
    bg: 'rgba(239,68,68,.08)',
  },
  {
    icon: BarChart3,
    title: 'Reports & Analytics',
    desc: 'Revenue reports, occupancy trends, expense breakdowns — all the insights you need to grow your PG business.',
    color: '#10b981',
    bg: 'rgba(16,185,129,.08)',
  },
]

const HOW_IT_WORKS = [
  { step: '01', title: 'Sign Up Free', desc: 'Create your account in under 30 seconds. No credit card required.' },
  { step: '02', title: 'Add Your Property', desc: 'Enter your PG details — rooms, beds, rent amounts. We auto-generate your dashboard.' },
  { step: '03', title: 'Start Managing', desc: 'Add tenants, collect rent, track expenses. Everything in one place, from day one.' },
]

const TESTIMONIALS = [
  {
    name: 'Rajesh Patel',
    role: 'PG Owner, Ahmedabad',
    text: 'GuestInnFlow cut my admin time by 70%. I used to spend hours on spreadsheets — now everything is automated.',
    rating: 5,
  },
  {
    name: 'Priya Sharma',
    role: 'Hostel Manager, Pune',
    text: 'The rent tracking and overdue alerts are a game-changer. I never miss a payment cycle anymore.',
    rating: 5,
  },
  {
    name: 'Amit Verma',
    role: 'PG Chain Owner, Bangalore',
    text: 'Managing 5 properties from one dashboard? That\'s exactly what I needed. The reports help me make smart decisions.',
    rating: 5,
  },
]

/* ── Animated counter hook ─────────────────────────────────────────────────── */
const useCounter = (end, duration = 2000) => {
  const [count, setCount] = useState(0)
  const ref = useRef(null)
  const started = useRef(false)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true
          const numericEnd = parseInt(end.replace(/[^0-9]/g, ''), 10)
          const startTime = performance.now()
          const animate = (now) => {
            const elapsed = now - startTime
            const progress = Math.min(elapsed / duration, 1)
            const ease = 1 - Math.pow(1 - progress, 3)
            setCount(Math.floor(ease * numericEnd))
            if (progress < 1) requestAnimationFrame(animate)
          }
          requestAnimationFrame(animate)
        }
      },
      { threshold: 0.3 }
    )
    if (ref.current) observer.observe(ref.current)
    return () => observer.disconnect()
  }, [end, duration])

  return { ref, count }
}


/* ── Stat card component ──────────────────────────────────────────────────── */
const StatCard = ({ value, label, icon: Icon }) => {
  const { ref, count } = useCounter(value)
  const suffix = value.replace(/[0-9,]/g, '')

  return (
    <div ref={ref} className="landing-stat-card">
      <div className="landing-stat-icon">
        <Icon size={20} />
      </div>
      <p className="landing-stat-value">{count.toLocaleString()}{suffix}</p>
      <p className="landing-stat-label">{label}</p>
    </div>
  )
}


/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
const Landing = () => {
  const [mobileMenu, setMobileMenu] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="landing-page" id="landing-page">

      {/* ─────────────── NAVBAR ─────────────── */}
      <nav className={`landing-nav ${scrolled ? 'landing-nav--scrolled' : ''}`}>
        <div className="landing-container flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-600">
              <Building2 size={18} className="text-white" />
            </div>
            <span className="font-bold text-lg text-gray-900 tracking-tight">GuestInnFlow</span>
          </Link>

          {/* Desktop nav links */}
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Features</a>
            <a href="#how-it-works" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">How it works</a>
            <a href="#testimonials" className="text-sm text-gray-600 hover:text-gray-900 transition-colors">Testimonials</a>
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-3">
            <Link to="/login" className="text-sm font-medium text-gray-700 hover:text-primary-600 px-4 py-2 transition-colors">
              Sign in
            </Link>
            <Link to="/signup" className="landing-cta-sm">
              Get Started Free
              <ArrowRight size={14} />
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button className="md:hidden p-2 text-gray-600" onClick={() => setMobileMenu(!mobileMenu)}>
            {mobileMenu ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenu && (
          <div className="md:hidden border-t border-gray-100 bg-white px-6 py-4 space-y-3 animate-pageIn">
            <a href="#features" className="block text-sm text-gray-700 py-2" onClick={() => setMobileMenu(false)}>Features</a>
            <a href="#how-it-works" className="block text-sm text-gray-700 py-2" onClick={() => setMobileMenu(false)}>How it works</a>
            <a href="#testimonials" className="block text-sm text-gray-700 py-2" onClick={() => setMobileMenu(false)}>Testimonials</a>
            <div className="pt-3 border-t border-gray-100 flex flex-col gap-2">
              <Link to="/login" className="text-sm font-medium text-gray-700 py-2">Sign in</Link>
              <Link to="/signup" className="landing-cta-sm w-full justify-center">Get Started Free <ArrowRight size={14} /></Link>
            </div>
          </div>
        )}
      </nav>


      {/* ─────────────── HERO ─────────────── */}
      <section className="landing-hero">
        {/* Background elements */}
        <div className="landing-hero-bg">
          <div className="landing-hero-orb landing-hero-orb--1" />
          <div className="landing-hero-orb landing-hero-orb--2" />
          <div className="landing-hero-orb landing-hero-orb--3" />
          <div className="landing-hero-grid" />
        </div>

        <div className="landing-container relative z-10 text-center pt-32 pb-20 md:pt-40 md:pb-28">
          {/* Badge */}
          <div className="landing-badge">
            <Zap size={13} />
            <span>Trusted by 500+ PG owners across India</span>
          </div>

          {/* Headline */}
          <h1 className="landing-hero-title mt-6">
            The smartest way to
            <br />
            <span className="landing-hero-gradient">manage your PG</span>
          </h1>

          <p className="mt-6 text-lg text-gray-500 max-w-2xl mx-auto leading-relaxed">
            From tenant check-ins to rent collection, expense tracking to analytics —
            GuestInnFlow is the all-in-one platform that makes PG management effortless.
          </p>

          {/* CTA row */}
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/signup" className="landing-cta-lg group">
              Start Free — No Card Needed
              <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <a href="#features" className="landing-cta-outline group">
              See All Features
              <ChevronRight size={16} className="group-hover:translate-x-0.5 transition-transform" />
            </a>
          </div>

          {/* Social proof */}
          <div className="mt-12 flex items-center justify-center gap-6 flex-wrap">
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <CheckCircle2 size={16} className="text-green-500" />
              Free forever plan
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <CheckCircle2 size={16} className="text-green-500" />
              Setup in 2 minutes
            </div>
            <div className="flex items-center gap-1.5 text-sm text-gray-500">
              <CheckCircle2 size={16} className="text-green-500" />
              No technical skills needed
            </div>
          </div>
        </div>
      </section>


      {/* ─────────────── STATS ─────────────── */}
      <section className="py-16 bg-white border-y border-gray-100">
        <div className="landing-container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {STATS.map((s) => (
              <StatCard key={s.label} {...s} />
            ))}
          </div>
        </div>
      </section>


      {/* ─────────────── FEATURES ─────────────── */}
      <section id="features" className="py-20 md:py-28 bg-gray-50/60">
        <div className="landing-container">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <div className="landing-section-badge">
              <Star size={13} />
              Features
            </div>
            <h2 className="landing-section-title mt-4">
              Everything you need to run
              <br className="hidden md:block" />
              your PG professionally
            </h2>
            <p className="mt-4 text-gray-500 text-[15px] leading-relaxed">
              Built specifically for PG and hostel owners. No bloated features — just what matters for your business.
            </p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="landing-feature-card group">
                <div className="landing-feature-icon" style={{ background: f.bg, color: f.color }}>
                  <f.icon size={22} />
                </div>
                <h3 className="mt-5 text-[17px] font-semibold text-gray-900">{f.title}</h3>
                <p className="mt-2.5 text-sm text-gray-500 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* ─────────────── HOW IT WORKS ─────────────── */}
      <section id="how-it-works" className="py-20 md:py-28 bg-white">
        <div className="landing-container">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <div className="landing-section-badge">
              <Clock size={13} />
              How it works
            </div>
            <h2 className="landing-section-title mt-4">
              Get started in 3 simple steps
            </h2>
            <p className="mt-4 text-gray-500 text-[15px] leading-relaxed">
              No complicated setup. No training needed. Start managing your PG in minutes.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {HOW_IT_WORKS.map((item, i) => (
              <div key={item.step} className="landing-step-card">
                <div className="landing-step-number">{item.step}</div>
                <h3 className="mt-5 text-lg font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-sm text-gray-500 leading-relaxed">{item.desc}</p>
                {i < HOW_IT_WORKS.length - 1 && (
                  <div className="landing-step-connector" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* ─────────────── TESTIMONIALS ─────────────── */}
      <section id="testimonials" className="py-20 md:py-28 bg-gray-50/60">
        <div className="landing-container">
          <div className="text-center max-w-2xl mx-auto mb-16">
            <div className="landing-section-badge">
              <Star size={13} />
              Testimonials
            </div>
            <h2 className="landing-section-title mt-4">
              Loved by PG owners everywhere
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="landing-testimonial-card">
                <div className="flex gap-0.5 mb-4">
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} size={15} className="fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="text-sm text-gray-600 leading-relaxed italic">"{t.text}"</p>
                <div className="mt-5 pt-5 border-t border-gray-100">
                  <p className="text-sm font-semibold text-gray-900">{t.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* ─────────────── CTA BANNER ─────────────── */}
      <section className="landing-cta-section">
        <div className="landing-cta-section-bg">
          <div className="landing-cta-orb landing-cta-orb--1" />
          <div className="landing-cta-orb landing-cta-orb--2" />
        </div>
        <div className="landing-container relative z-10 text-center py-20 md:py-28">
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            Ready to simplify your PG management?
          </h2>
          <p className="mt-4 text-white/70 text-[15px] max-w-xl mx-auto">
            Join 500+ PG owners who switched to GuestInnFlow and never looked back.
            Start free today — no credit card needed.
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/signup" className="landing-cta-white group">
              Get Started Free
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link to="/login" className="landing-cta-ghost">
              Sign in to your account
            </Link>
          </div>
        </div>
      </section>


      {/* ─────────────── FOOTER ─────────────── */}
      <footer className="bg-gray-900 text-gray-400 py-12">
        <div className="landing-container">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10">
                <Building2 size={16} className="text-white" />
              </div>
              <span className="font-semibold text-white">GuestInnFlow</span>
            </div>
            <div className="flex items-center gap-8 text-sm">
              <a href="#features" className="hover:text-white transition-colors">Features</a>
              <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
              <a href="#testimonials" className="hover:text-white transition-colors">Testimonials</a>
            </div>
            <p className="text-xs text-gray-500">© {new Date().getFullYear()} GuestInnFlow. All rights reserved.</p>
          </div>
        </div>
      </footer>


      {/* ═══════════════════════════════════════════
          SCOPED STYLES
          ═══════════════════════════════════════════ */}
      <style>{`
        /* ── Page base ── */
        .landing-page {
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          overflow-x: hidden;
        }

        /* ── Container ── */
        .landing-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 24px;
        }

        /* ── Navbar ── */
        .landing-nav {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 50;
          background: rgba(255,255,255,.8);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          transition: all .25s ease;
        }
        .landing-nav--scrolled {
          background: rgba(255,255,255,.95);
          box-shadow: 0 1px 3px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.04);
        }

        /* ── CTA buttons ── */
        .landing-cta-sm {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 18px;
          border-radius: 10px;
          background: linear-gradient(135deg, #45a793, #60c3ad);
          color: white;
          font-size: 14px;
          font-weight: 600;
          transition: all .2s;
          box-shadow: 0 2px 8px rgba(96,195,173,.2);
          text-decoration: none;
        }
        .landing-cta-sm:hover {
          box-shadow: 0 4px 16px rgba(96,195,173,.3);
          transform: translateY(-1px);
        }

        .landing-cta-lg {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          padding: 14px 32px;
          border-radius: 14px;
          background: linear-gradient(135deg, #45a793, #60c3ad);
          color: white;
          font-size: 16px;
          font-weight: 600;
          transition: all .2s;
          box-shadow: 0 4px 20px rgba(96,195,173,.3);
          text-decoration: none;
        }
        .landing-cta-lg:hover {
          box-shadow: 0 6px 30px rgba(96,195,173,.4);
          transform: translateY(-2px);
        }

        .landing-cta-outline {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 14px 28px;
          border-radius: 14px;
          border: 1.5px solid #e5e7eb;
          background: white;
          color: #374151;
          font-size: 15px;
          font-weight: 600;
          transition: all .2s;
          text-decoration: none;
        }
        .landing-cta-outline:hover {
          border-color: #d1d5db;
          box-shadow: 0 2px 8px rgba(0,0,0,.06);
        }

        .landing-cta-white {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 14px 32px;
          border-radius: 14px;
          background: white;
          color: #45a793;
          font-size: 16px;
          font-weight: 600;
          transition: all .2s;
          box-shadow: 0 4px 20px rgba(0,0,0,.15);
          text-decoration: none;
        }
        .landing-cta-white:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 30px rgba(0,0,0,.2);
        }

        .landing-cta-ghost {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 14px 28px;
          border-radius: 14px;
          border: 1.5px solid rgba(255,255,255,.2);
          color: white;
          font-size: 15px;
          font-weight: 500;
          transition: all .2s;
          text-decoration: none;
        }
        .landing-cta-ghost:hover {
          border-color: rgba(255,255,255,.4);
          background: rgba(255,255,255,.06);
        }

        /* ── Hero ── */
        .landing-hero {
          position: relative;
          background: linear-gradient(180deg, #f8fafc 0%, #fff 100%);
          overflow: hidden;
        }
        .landing-hero-bg {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .landing-hero-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(100px);
          will-change: transform;
        }
        .landing-hero-orb--1 {
          width: 600px; height: 600px;
          background: radial-gradient(circle, rgba(96,195,173,.12), transparent 70%);
          top: -200px; right: -100px;
          animation: heroOrb1 10s ease-in-out infinite;
        }
        .landing-hero-orb--2 {
          width: 500px; height: 500px;
          background: radial-gradient(circle, rgba(120,223,197,.1), transparent 70%);
          bottom: -100px; left: -150px;
          animation: heroOrb2 12s ease-in-out infinite;
        }
        .landing-hero-orb--3 {
          width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(6,182,212,.08), transparent 70%);
          top: 30%; left: 50%;
          animation: heroOrb3 8s ease-in-out infinite;
        }
        .landing-hero-grid {
          position: absolute;
          inset: 0;
          opacity: .025;
          background-image:
            linear-gradient(rgba(0,0,0,.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(0,0,0,.5) 1px, transparent 1px);
          background-size: 48px 48px;
        }

        @keyframes heroOrb1 {
          0%, 100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(-40px, 60px) scale(1.1); }
        }
        @keyframes heroOrb2 {
          0%, 100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(50px, -40px) scale(1.12); }
        }
        @keyframes heroOrb3 {
          0%, 100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(-30px, -20px) scale(1.08); }
        }

        /* ── Hero badge ── */
        .landing-badge {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 6px 16px 6px 12px;
          border-radius: 100px;
          background: rgba(96,195,173,.06);
          border: 1px solid rgba(96,195,173,.12);
          color: #45a793;
          font-size: 13px;
          font-weight: 600;
        }

        /* ── Hero title ── */
        .landing-hero-title {
          font-size: clamp(2.2rem, 5vw, 3.8rem);
          font-weight: 800;
          color: #111827;
          line-height: 1.1;
          letter-spacing: -.025em;
        }
        .landing-hero-gradient {
          background: linear-gradient(135deg, #45a793, #4bab96, #60c3ad);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }

        /* ── Section badge ── */
        .landing-section-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 14px 5px 10px;
          border-radius: 100px;
          background: rgba(96,195,173,.06);
          border: 1px solid rgba(96,195,173,.1);
          color: #45a793;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: .04em;
        }

        /* ── Section title ── */
        .landing-section-title {
          font-size: clamp(1.6rem, 3vw, 2.4rem);
          font-weight: 800;
          color: #111827;
          line-height: 1.2;
          letter-spacing: -.02em;
        }

        /* ── Stat cards ── */
        .landing-stat-card {
          text-align: center;
          padding: 24px 16px;
          border-radius: 16px;
          background: #f9fafb;
          border: 1px solid #f3f4f6;
          transition: all .25s ease;
        }
        .landing-stat-card:hover {
          background: white;
          box-shadow: 0 4px 20px rgba(0,0,0,.06);
          transform: translateY(-2px);
        }
        .landing-stat-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px;
          height: 44px;
          border-radius: 12px;
          background: rgba(96,195,173,.08);
          color: #60c3ad;
          margin: 0 auto 12px;
        }
        .landing-stat-value {
          font-size: 28px;
          font-weight: 800;
          color: #111827;
          letter-spacing: -.02em;
        }
        .landing-stat-label {
          font-size: 13px;
          color: #9ca3af;
          margin-top: 2px;
          font-weight: 500;
        }

        /* ── Feature cards ── */
        .landing-feature-card {
          padding: 28px;
          border-radius: 18px;
          background: white;
          border: 1px solid #f3f4f6;
          transition: all .25s ease;
        }
        .landing-feature-card:hover {
          border-color: #e5e7eb;
          box-shadow: 0 8px 30px rgba(0,0,0,.06);
          transform: translateY(-3px);
        }
        .landing-feature-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 48px;
          height: 48px;
          border-radius: 14px;
          transition: transform .2s;
        }
        .landing-feature-card:hover .landing-feature-icon {
          transform: scale(1.08);
        }

        /* ── Step cards ── */
        .landing-step-card {
          text-align: center;
          position: relative;
          padding: 32px 24px;
        }
        .landing-step-number {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 52px;
          height: 52px;
          border-radius: 16px;
          background: linear-gradient(135deg, #45a793, #60c3ad);
          color: white;
          font-size: 18px;
          font-weight: 800;
          box-shadow: 0 4px 16px rgba(96,195,173,.25);
        }
        .landing-step-connector {
          display: none;
        }
        @media (min-width: 768px) {
          .landing-step-connector {
            display: block;
            position: absolute;
            top: 56px;
            right: -16px;
            width: 32px;
            height: 2px;
            background: linear-gradient(90deg, #e5e7eb, #d1d5db);
            border-radius: 2px;
          }
        }

        /* ── Testimonial cards ── */
        .landing-testimonial-card {
          padding: 28px;
          border-radius: 18px;
          background: white;
          border: 1px solid #f3f4f6;
          transition: all .25s ease;
        }
        .landing-testimonial-card:hover {
          box-shadow: 0 8px 30px rgba(0,0,0,.06);
          transform: translateY(-2px);
        }

        /* ── CTA Section ── */
        .landing-cta-section {
          position: relative;
          overflow: hidden;
          background: linear-gradient(145deg, #1a5c4e 0%, #358a79 40%, #60c3ad 100%);
        }
        .landing-cta-section-bg {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .landing-cta-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
        }
        .landing-cta-orb--1 {
          width: 400px; height: 400px;
          background: radial-gradient(circle, rgba(164,234,216,.35), transparent 70%);
          top: -100px; right: -50px;
          animation: heroOrb1 8s ease-in-out infinite;
        }
        .landing-cta-orb--2 {
          width: 300px; height: 300px;
          background: radial-gradient(circle, rgba(120,223,197,.3), transparent 70%);
          bottom: -80px; left: -40px;
          animation: heroOrb2 10s ease-in-out infinite;
        }

        /* ── Smooth scroll ── */
        html {
          scroll-behavior: smooth;
        }
      `}</style>
    </div>
  )
}

export default Landing
