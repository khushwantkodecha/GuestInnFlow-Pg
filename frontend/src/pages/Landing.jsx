import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2, ArrowRight, CheckCircle2, ChevronRight,
  Users, Bed, BarChart3, Bell,
  Home, Star, Zap, Clock, CreditCard, PieChart,
  TrendingUp, Menu, X, IndianRupee,
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════════════════
   DATA
   ═══════════════════════════════════════════════════════════════════════════ */
const STATS = [
  { value: '500+',    label: 'PGs / Hostels',   icon: Building2  },
  { value: '12000+', label: 'Beds Managed',     icon: Bed        },
  { value: '8',      label: 'Cr+ Rent Processed', icon: IndianRupee },
  { value: '99',     label: '% Uptime',         icon: Zap        },
]

const FEATURES = [
  {
    icon: Home,
    title: 'Property Management',
    desc: 'Manage multiple PG / Hostel properties from a single dashboard. Track rooms, beds, floors, and occupancy in real time.',
    color: '#60c3ad',
    bg: 'rgba(96,195,173,.10)',
    border: 'rgba(96,195,173,.15)',
  },
  {
    icon: Users,
    title: 'Tenant Tracking',
    desc: 'Complete tenant lifecycle — from check-in to check-out. Store ID proofs, emergency contacts, and history.',
    color: '#4bab96',
    bg: 'rgba(75,171,150,.10)',
    border: 'rgba(75,171,150,.15)',
  },
  {
    icon: CreditCard,
    title: 'Rent & Payments',
    desc: 'Automated rent tracking with due date alerts. Record partial payments, advances, and generate receipts instantly.',
    color: '#6366f1',
    bg: 'rgba(99,102,241,.08)',
    border: 'rgba(99,102,241,.12)',
  },
  {
    icon: PieChart,
    title: 'Expense Management',
    desc: 'Log all property expenses — maintenance, utilities, staff salaries. Categorize and track spending trends.',
    color: '#f59e0b',
    bg: 'rgba(245,158,11,.08)',
    border: 'rgba(245,158,11,.12)',
  },
  {
    icon: Bell,
    title: 'Smart Notifications',
    desc: 'Get automated alerts for overdue rent, expiring leases, vacant beds, and upcoming check-outs.',
    color: '#ef4444',
    bg: 'rgba(239,68,68,.08)',
    border: 'rgba(239,68,68,.12)',
  },
  {
    icon: BarChart3,
    title: 'Reports & Analytics',
    desc: 'Revenue reports, occupancy trends, expense breakdowns — all the insights you need to grow your business.',
    color: '#10b981',
    bg: 'rgba(16,185,129,.08)',
    border: 'rgba(16,185,129,.12)',
  },
]

const HOW_IT_WORKS = [
  {
    step: '01',
    title: 'Sign Up Free',
    desc: 'Create your account in under 30 seconds. No credit card required.',
    icon: Zap,
  },
  {
    step: '02',
    title: 'Add Your Property',
    desc: 'Enter your PG / Hostel details — rooms, beds, rent amounts. We auto-generate your dashboard.',
    icon: Building2,
  },
  {
    step: '03',
    title: 'Start Managing',
    desc: 'Add tenants, collect rent, track expenses. Everything in one place, from day one.',
    icon: TrendingUp,
  },
]

const TESTIMONIALS = [
  {
    name: 'Rajesh Patel',
    role: 'PG Owner · Ahmedabad',
    text: 'TenantInnFlow cut my admin time by 70%. I used to spend hours on spreadsheets — now everything is automated.',
    rating: 5,
    initials: 'RP',
    color: '#60c3ad',
  },
  {
    name: 'Priya Sharma',
    role: 'Hostel Manager · Pune',
    text: 'The rent tracking and overdue alerts are a game-changer. I never miss a payment cycle anymore.',
    rating: 5,
    initials: 'PS',
    color: '#6366f1',
  },
  {
    name: 'Amit Verma',
    role: 'PG Chain Owner · Bangalore',
    text: "Managing 5 properties from one dashboard? That's exactly what I needed. The reports help me make smart decisions.",
    rating: 5,
    initials: 'AV',
    color: '#f59e0b',
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

/* ── Stat card ──────────────────────────────────────────────────────────── */
const StatCard = ({ value, label, icon: Icon }) => {
  const { ref, count } = useCounter(value)
  const prefix = label.startsWith('Cr+') ? '₹' : ''
  const suffix = value.replace(/[0-9,]/g, '')

  return (
    <div ref={ref} className="l-stat">
      <div className="l-stat__icon">
        <Icon size={18} />
      </div>
      <p className="l-stat__value">{prefix}{count.toLocaleString()}{suffix}</p>
      <p className="l-stat__label">{label}</p>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPONENT
   ═══════════════════════════════════════════════════════════════════════════ */
const Landing = () => {
  const [mobileMenu, setMobileMenu] = useState(false)
  const [scrolled, setScrolled]     = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div className="l-page" id="landing-page">

      {/* ───────────────── NAVBAR ───────────────── */}
      <nav className={`l-nav${scrolled ? ' l-nav--scrolled' : ''}`}>
        <div className="l-wrap l-nav__inner">
          <Link to="/" className="l-nav__logo">
            <div className="l-nav__logo-icon">
              <Building2 size={16} />
            </div>
            <span>TenantInnFlow</span>
          </Link>

          <div className="l-nav__links">
            <a href="#features"      onClick={() => setMobileMenu(false)}>Features</a>
            <a href="#how-it-works"  onClick={() => setMobileMenu(false)}>How it works</a>
            <a href="#testimonials"  onClick={() => setMobileMenu(false)}>Testimonials</a>
          </div>

          <div className="l-nav__actions">
            <Link to="/login"  className="l-nav__signin">Sign in</Link>
            <Link to="/signup" className="l-btn l-btn--sm">
              Get Started Free <ArrowRight size={13} />
            </Link>
          </div>

          <button className="l-nav__burger" onClick={() => setMobileMenu(!mobileMenu)} aria-label="Toggle menu">
            {mobileMenu ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {mobileMenu && (
          <div className="l-nav__mobile">
            <a href="#features"     className="l-nav__mobile-link" onClick={() => setMobileMenu(false)}>Features</a>
            <a href="#how-it-works" className="l-nav__mobile-link" onClick={() => setMobileMenu(false)}>How it works</a>
            <a href="#testimonials" className="l-nav__mobile-link" onClick={() => setMobileMenu(false)}>Testimonials</a>
            <div className="l-nav__mobile-ctas">
              <Link to="/login"  className="l-nav__mobile-link">Sign in</Link>
              <Link to="/signup" className="l-btn l-btn--sm" style={{ justifyContent: 'center' }}>
                Get Started Free <ArrowRight size={13} />
              </Link>
            </div>
          </div>
        )}
      </nav>


      {/* ───────────────── HERO ───────────────── */}
      <section className="l-hero">
        <div className="l-hero__bg">
          <div className="l-orb l-orb--1" />
          <div className="l-orb l-orb--2" />
          <div className="l-orb l-orb--3" />
          <div className="l-grid" />
        </div>

        <div className="l-wrap l-hero__body">
          <div className="l-badge">
            <Zap size={12} />
            Trusted by 500+ PG &amp; Hostel owners across India
          </div>

          <h1 className="l-hero__title">
            The smartest way to manage
            <br />
            <span className="l-gradient-text">your PG &amp; Hostel</span>
          </h1>

          <p className="l-hero__sub">
            From tenant check-ins to rent collection, expense tracking to analytics —
            TenantInnFlow is the all-in-one platform built for PG &amp; Hostel owners.
          </p>

          <div className="l-hero__ctas">
            <Link to="/signup" className="l-btn l-btn--lg group">
              Start Free — No Card Needed
              <ArrowRight size={17} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <a href="#features" className="l-btn l-btn--outline group">
              See All Features
              <ChevronRight size={15} className="group-hover:translate-x-0.5 transition-transform" />
            </a>
          </div>

          <div className="l-hero__trust">
            {[
              'Free forever plan',
              'Setup in 2 minutes',
              'No technical skills needed',
            ].map((t) => (
              <div key={t} className="l-hero__trust-item">
                <CheckCircle2 size={15} />
                {t}
              </div>
            ))}
          </div>

          {/* Mini dashboard preview */}
          <div className="l-hero__preview">
            <div className="l-preview__bar">
              <div className="l-preview__dots">
                <span /><span /><span />
              </div>
              <span className="l-preview__url">app.tenantinnflow.com</span>
            </div>
            <div className="l-preview__body">
              <div className="l-preview__sidebar">
                {['Dashboard', 'Tenants', 'Rooms', 'Rent', 'Reports'].map((item, i) => (
                  <div key={item} className={`l-preview__nav-item${i === 0 ? ' l-preview__nav-item--active' : ''}`}>
                    <div className="l-preview__nav-dot" />
                    {item}
                  </div>
                ))}
              </div>
              <div className="l-preview__content">
                <div className="l-preview__stats">
                  {[
                    { label: 'Total Tenants', val: '24', color: '#60c3ad' },
                    { label: 'Collected',     val: '₹72K', color: '#10b981' },
                    { label: 'Vacant Beds',   val: '6',    color: '#6366f1' },
                  ].map((s) => (
                    <div key={s.label} className="l-preview__stat">
                      <p className="l-preview__stat-val" style={{ color: s.color }}>{s.val}</p>
                      <p className="l-preview__stat-lbl">{s.label}</p>
                    </div>
                  ))}
                </div>
                <div className="l-preview__bars">
                  {[85, 60, 90, 45, 70, 55, 80].map((h, i) => (
                    <div key={i} className="l-preview__bar-col">
                      <div className="l-preview__bar-fill" style={{ height: `${h}%` }} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* ───────────────── STATS ───────────────── */}
      <section className="l-stats">
        <div className="l-wrap l-stats__grid">
          {STATS.map((s) => <StatCard key={s.label} {...s} />)}
        </div>
      </section>


      {/* ───────────────── FEATURES ───────────────── */}
      <section id="features" className="l-section l-section--alt">
        <div className="l-wrap">
          <div className="l-section__head">
            <div className="l-pill"><Star size={12} /> Features</div>
            <h2 className="l-section__title">
              Everything you need to run
              <br className="hidden md:block" />
              your PG &amp; Hostel professionally
            </h2>
            <p className="l-section__sub">
              Built specifically for PG &amp; Hostel owners. No bloated features — just what matters.
            </p>
          </div>

          <div className="l-features">
            {FEATURES.map((f) => (
              <div key={f.title} className="l-feature">
                <div className="l-feature__icon" style={{ background: f.bg, color: f.color, border: `1px solid ${f.border}` }}>
                  <f.icon size={20} />
                </div>
                <h3 className="l-feature__title">{f.title}</h3>
                <p className="l-feature__desc">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* ───────────────── HOW IT WORKS ───────────────── */}
      <section id="how-it-works" className="l-section">
        <div className="l-wrap">
          <div className="l-section__head">
            <div className="l-pill"><Clock size={12} /> How it works</div>
            <h2 className="l-section__title">Up and running in 3 steps</h2>
            <p className="l-section__sub">
              No complicated setup. No training needed. Start managing your PG in minutes.
            </p>
          </div>

          <div className="l-steps">
            {HOW_IT_WORKS.map((item, i) => (
              <div key={item.step} className="l-step">
                <div className="l-step__num">{item.step}</div>
                {i < HOW_IT_WORKS.length - 1 && <div className="l-step__line" />}
                <div className="l-step__icon-wrap">
                  <item.icon size={20} />
                </div>
                <h3 className="l-step__title">{item.title}</h3>
                <p className="l-step__desc">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* ───────────────── TESTIMONIALS ───────────────── */}
      <section id="testimonials" className="l-section l-section--alt">
        <div className="l-wrap">
          <div className="l-section__head">
            <div className="l-pill"><Star size={12} /> Testimonials</div>
            <h2 className="l-section__title">Loved by PG &amp; Hostel owners</h2>
            <p className="l-section__sub">
              Real feedback from owners who switched from spreadsheets to TenantInnFlow.
            </p>
          </div>

          <div className="l-testimonials">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="l-testimonial">
                <div className="l-testimonial__stars">
                  {Array.from({ length: t.rating }).map((_, i) => (
                    <Star key={i} size={14} className="fill-amber-400 text-amber-400" />
                  ))}
                </div>
                <p className="l-testimonial__text">"{t.text}"</p>
                <div className="l-testimonial__author">
                  <div className="l-testimonial__avatar" style={{ background: t.color }}>
                    {t.initials}
                  </div>
                  <div>
                    <p className="l-testimonial__name">{t.name}</p>
                    <p className="l-testimonial__role">{t.role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>


      {/* ───────────────── CTA BANNER ───────────────── */}
      <section className="l-cta-section">
        <div className="l-cta-section__bg">
          <div className="l-cta-orb l-cta-orb--1" />
          <div className="l-cta-orb l-cta-orb--2" />
        </div>
        <div className="l-wrap l-cta-section__body">
          <div className="l-pill l-pill--white"><Zap size={12} /> Join 500+ owners</div>
          <h2 className="l-cta-section__title">
            Ready to simplify your
            <br />
            PG &amp; Hostel management?
          </h2>
          <p className="l-cta-section__sub">
            Join PG &amp; Hostel owners who switched to TenantInnFlow and never looked back.
            Start free today — no credit card needed.
          </p>
          <div className="l-cta-section__btns">
            <Link to="/signup" className="l-btn l-btn--white group">
              Get Started Free
              <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link to="/login" className="l-btn l-btn--ghost">
              Sign in to your account
            </Link>
          </div>
        </div>
      </section>


      {/* ───────────────── FOOTER ───────────────── */}
      <footer className="l-footer">
        <div className="l-wrap">
          <div className="l-footer__top">
            {/* Brand column */}
            <div className="l-footer__brand-col">
              <div className="l-footer__brand">
                <div className="l-footer__logo">
                  <Building2 size={16} />
                </div>
                <span>TenantInnFlow</span>
              </div>
              <p className="l-footer__tagline">
                The all-in-one platform for PG owners and hostel managers to run their properties effortlessly.
              </p>
              <div className="l-footer__badges">
                <span className="l-footer__badge">✓ Free to start</span>
                <span className="l-footer__badge">✓ No credit card</span>
              </div>
            </div>

            {/* Links columns */}
            <div className="l-footer__cols">
              <div className="l-footer__col">
                <h4 className="l-footer__col-title">Product</h4>
                <a href="#features">Features</a>
                <a href="#how-it-works">How it works</a>
                <a href="#testimonials">Testimonials</a>
              </div>
              <div className="l-footer__col">
                <h4 className="l-footer__col-title">Account</h4>
                <Link to="/login">Sign in</Link>
                <Link to="/signup">Create account</Link>
              </div>
            </div>
          </div>

          <div className="l-footer__bottom">
            <p className="l-footer__copy">
              © {new Date().getFullYear()} TenantInnFlow. All rights reserved.
            </p>
            <p className="l-footer__made">
              Made with care for PG owners across India 🇮🇳
            </p>
          </div>
        </div>
      </footer>


      {/* ═══════════════════════════════════════════
          SCOPED STYLES
          ═══════════════════════════════════════════ */}
      <style>{`
        /* ── Reset / base ───────────────────────── */
        .l-page {
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          overflow-x: hidden;
          color: #111827;
          background: #fff;
        }
        .l-page *, .l-page *::before, .l-page *::after { box-sizing: border-box; }
        html { scroll-behavior: smooth; }

        /* ── Layout wrapper ─────────────────────── */
        .l-wrap {
          max-width: 1160px;
          margin: 0 auto;
          padding: 0 28px;
        }

        /* ── Navbar ─────────────────────────────── */
        .l-nav {
          position: fixed;
          top: 0; left: 0; right: 0;
          z-index: 100;
          background: rgba(255,255,255,.7);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-bottom: 1px solid transparent;
          transition: background .25s, border-color .25s, box-shadow .25s;
        }
        .l-nav--scrolled {
          background: rgba(255,255,255,.92);
          border-color: rgba(0,0,0,.06);
          box-shadow: 0 2px 16px rgba(0,0,0,.05);
        }
        .l-nav__inner {
          display: flex;
          align-items: center;
          justify-content: space-between;
          height: 64px;
        }
        .l-nav__logo {
          display: flex;
          align-items: center;
          gap: 10px;
          text-decoration: none;
          font-size: 16px;
          font-weight: 700;
          color: #111827;
          letter-spacing: -.015em;
        }
        .l-nav__logo-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 34px; height: 34px;
          border-radius: 10px;
          background: linear-gradient(135deg, #45a793, #60c3ad);
          color: white;
          box-shadow: 0 2px 8px rgba(96,195,173,.3);
        }
        .l-nav__links {
          display: none;
        }
        @media (min-width: 768px) {
          .l-nav__links {
            display: flex;
            align-items: center;
            gap: 32px;
          }
          .l-nav__links a {
            font-size: 14px;
            font-weight: 500;
            color: #6b7280;
            text-decoration: none;
            transition: color .15s;
          }
          .l-nav__links a:hover { color: #111827; }
        }
        .l-nav__actions {
          display: none;
          align-items: center;
          gap: 8px;
        }
        @media (min-width: 768px) { .l-nav__actions { display: flex; } }
        .l-nav__signin {
          font-size: 14px;
          font-weight: 500;
          color: #6b7280;
          text-decoration: none;
          padding: 6px 12px;
          border-radius: 8px;
          transition: color .15s, background .15s;
        }
        .l-nav__signin:hover { color: #111827; background: #f9fafb; }
        .l-nav__burger {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px; height: 36px;
          border-radius: 8px;
          border: none;
          background: transparent;
          color: #6b7280;
          cursor: pointer;
          transition: background .15s;
        }
        .l-nav__burger:hover { background: #f3f4f6; }
        @media (min-width: 768px) { .l-nav__burger { display: none; } }
        .l-nav__mobile {
          border-top: 1px solid #f3f4f6;
          background: white;
          padding: 12px 28px 20px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          animation: fadeDown .15s ease;
        }
        .l-nav__mobile-link {
          display: block;
          font-size: 14px;
          font-weight: 500;
          color: #374151;
          text-decoration: none;
          padding: 10px 0;
          border-bottom: 1px solid #f9fafb;
          transition: color .15s;
        }
        .l-nav__mobile-link:hover { color: #111827; }
        .l-nav__mobile-ctas {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin-top: 12px;
        }
        @keyframes fadeDown {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }

        /* ── Buttons ────────────────────────────── */
        .l-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          text-decoration: none;
          transition: all .2s;
          cursor: pointer;
          border: none;
          outline: none;
        }
        .l-btn--sm {
          padding: 8px 18px;
          border-radius: 10px;
          font-size: 13.5px;
          background: linear-gradient(135deg, #45a793, #60c3ad);
          color: white;
          box-shadow: 0 2px 10px rgba(96,195,173,.25);
        }
        .l-btn--sm:hover {
          box-shadow: 0 4px 18px rgba(96,195,173,.35);
          transform: translateY(-1px);
        }
        .l-btn--lg {
          padding: 15px 34px;
          border-radius: 14px;
          font-size: 15.5px;
          background: linear-gradient(135deg, #45a793, #60c3ad);
          color: white;
          box-shadow: 0 4px 24px rgba(96,195,173,.35);
        }
        .l-btn--lg:hover {
          box-shadow: 0 8px 32px rgba(96,195,173,.45);
          transform: translateY(-2px);
        }
        .l-btn--outline {
          padding: 15px 30px;
          border-radius: 14px;
          font-size: 15px;
          background: white;
          color: #374151;
          border: 1.5px solid #e5e7eb;
          box-shadow: 0 1px 4px rgba(0,0,0,.04);
        }
        .l-btn--outline:hover {
          border-color: #d1d5db;
          box-shadow: 0 4px 12px rgba(0,0,0,.06);
          transform: translateY(-1px);
        }
        .l-btn--white {
          padding: 15px 34px;
          border-radius: 14px;
          font-size: 15.5px;
          background: white;
          color: #1a5c4e;
          box-shadow: 0 4px 24px rgba(0,0,0,.15);
        }
        .l-btn--white:hover {
          box-shadow: 0 8px 32px rgba(0,0,0,.2);
          transform: translateY(-2px);
        }
        .l-btn--ghost {
          padding: 15px 30px;
          border-radius: 14px;
          font-size: 15px;
          color: rgba(255,255,255,.85);
          border: 1.5px solid rgba(255,255,255,.2);
          font-weight: 500;
        }
        .l-btn--ghost:hover {
          background: rgba(255,255,255,.08);
          border-color: rgba(255,255,255,.35);
          color: white;
        }

        /* ── Pill badge ─────────────────────────── */
        .l-pill {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 5px 14px;
          border-radius: 100px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: .03em;
          text-transform: uppercase;
          background: rgba(96,195,173,.07);
          border: 1px solid rgba(96,195,173,.14);
          color: #3d9e8a;
        }
        .l-pill--white {
          background: rgba(255,255,255,.15);
          border-color: rgba(255,255,255,.25);
          color: rgba(255,255,255,.9);
        }

        /* ── Section base ───────────────────────── */
        .l-section {
          padding: 96px 0;
        }
        .l-section--alt {
          background: #f8fafc;
        }
        .l-section__head {
          text-align: center;
          max-width: 600px;
          margin: 0 auto 64px;
        }
        .l-section__title {
          font-size: clamp(1.7rem, 3.2vw, 2.5rem);
          font-weight: 800;
          color: #111827;
          letter-spacing: -.025em;
          line-height: 1.18;
          margin-top: 16px;
        }
        .l-section__sub {
          margin-top: 16px;
          font-size: 16px;
          color: #6b7280;
          line-height: 1.65;
        }

        /* ── Hero ───────────────────────────────── */
        .l-hero {
          position: relative;
          min-height: 100vh;
          display: flex;
          align-items: center;
          background: linear-gradient(175deg, #f0fdf9 0%, #ffffff 55%, #f8fafc 100%);
          overflow: hidden;
        }
        .l-hero__bg {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .l-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(90px);
        }
        .l-orb--1 {
          width: 700px; height: 700px;
          background: radial-gradient(circle, rgba(96,195,173,.14) 0%, transparent 68%);
          top: -250px; right: -100px;
          animation: orb1 11s ease-in-out infinite;
        }
        .l-orb--2 {
          width: 500px; height: 500px;
          background: radial-gradient(circle, rgba(99,102,241,.07) 0%, transparent 68%);
          bottom: -100px; left: -150px;
          animation: orb2 13s ease-in-out infinite;
        }
        .l-orb--3 {
          width: 350px; height: 350px;
          background: radial-gradient(circle, rgba(6,182,212,.07) 0%, transparent 68%);
          top: 35%; left: 45%;
          animation: orb3 9s ease-in-out infinite;
        }
        .l-grid {
          position: absolute;
          inset: 0;
          opacity: .022;
          background-image:
            linear-gradient(#000 1px, transparent 1px),
            linear-gradient(90deg, #000 1px, transparent 1px);
          background-size: 52px 52px;
        }
        @keyframes orb1 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(-40px,55px) scale(1.08); }
        }
        @keyframes orb2 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(50px,-40px) scale(1.1); }
        }
        @keyframes orb3 {
          0%,100% { transform: translate(0,0) scale(1); }
          50%      { transform: translate(-25px,-20px) scale(1.07); }
        }
        .l-hero__body {
          position: relative;
          z-index: 10;
          padding-top: 112px;
          padding-bottom: 72px;
          text-align: center;
          width: 100%;
        }
        .l-hero__title {
          margin-top: 24px;
          font-size: clamp(2.4rem, 5.5vw, 4rem);
          font-weight: 800;
          color: #0f172a;
          line-height: 1.08;
          letter-spacing: -.03em;
        }
        .l-gradient-text {
          background: linear-gradient(135deg, #2e8b78 0%, #4bab96 40%, #60c3ad 70%, #45a793 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .l-hero__sub {
          margin-top: 24px;
          font-size: 17px;
          color: #6b7280;
          max-width: 560px;
          margin-left: auto;
          margin-right: auto;
          line-height: 1.65;
        }
        .l-hero__ctas {
          margin-top: 40px;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 14px;
        }
        .l-hero__trust {
          margin-top: 36px;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 20px;
        }
        .l-hero__trust-item {
          display: flex;
          align-items: center;
          gap: 7px;
          font-size: 13.5px;
          color: #6b7280;
          font-weight: 500;
        }
        .l-hero__trust-item svg { color: #22c55e; }

        /* ── Dashboard preview mockup ─────────── */
        .l-hero__preview {
          margin-top: 60px;
          max-width: 780px;
          margin-left: auto;
          margin-right: auto;
          border-radius: 16px;
          overflow: hidden;
          box-shadow: 0 24px 80px rgba(0,0,0,.12), 0 4px 16px rgba(0,0,0,.06);
          border: 1px solid rgba(0,0,0,.07);
        }
        .l-preview__bar {
          background: #f1f5f9;
          padding: 10px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          border-bottom: 1px solid #e2e8f0;
        }
        .l-preview__dots {
          display: flex;
          gap: 5px;
        }
        .l-preview__dots span {
          display: block;
          width: 10px; height: 10px;
          border-radius: 50%;
          background: #e2e8f0;
        }
        .l-preview__dots span:nth-child(1) { background: #f87171; }
        .l-preview__dots span:nth-child(2) { background: #fbbf24; }
        .l-preview__dots span:nth-child(3) { background: #34d399; }
        .l-preview__url {
          font-size: 11px;
          color: #94a3b8;
          font-weight: 500;
          letter-spacing: .01em;
        }
        .l-preview__body {
          display: flex;
          background: white;
          height: 200px;
        }
        .l-preview__sidebar {
          width: 130px;
          background: #f8fafc;
          border-right: 1px solid #f1f5f9;
          padding: 16px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex-shrink: 0;
        }
        .l-preview__nav-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 7px 10px;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 500;
          color: #94a3b8;
          transition: all .15s;
        }
        .l-preview__nav-item--active {
          background: rgba(96,195,173,.1);
          color: #3d9e8a;
          font-weight: 600;
        }
        .l-preview__nav-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          background: currentColor;
          opacity: .5;
          flex-shrink: 0;
        }
        .l-preview__nav-item--active .l-preview__nav-dot { opacity: 1; }
        .l-preview__content {
          flex: 1;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
          overflow: hidden;
        }
        .l-preview__stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .l-preview__stat {
          background: #f8fafc;
          border-radius: 10px;
          padding: 12px;
          border: 1px solid #f1f5f9;
        }
        .l-preview__stat-val {
          font-size: 15px;
          font-weight: 700;
          letter-spacing: -.01em;
        }
        .l-preview__stat-lbl {
          font-size: 9.5px;
          color: #94a3b8;
          margin-top: 2px;
          font-weight: 500;
        }
        .l-preview__bars {
          display: flex;
          align-items: flex-end;
          gap: 6px;
          height: 52px;
          padding: 0 4px;
        }
        .l-preview__bar-col {
          flex: 1;
          height: 100%;
          display: flex;
          align-items: flex-end;
        }
        .l-preview__bar-fill {
          width: 100%;
          border-radius: 4px 4px 0 0;
          background: linear-gradient(180deg, rgba(96,195,173,.5) 0%, rgba(96,195,173,.2) 100%);
          transition: height .3s;
        }
        @media (max-width: 640px) {
          .l-hero__preview { display: none; }
        }

        /* ── Stats strip ────────────────────────── */
        .l-stats {
          background: white;
          border-top: 1px solid #f1f5f9;
          border-bottom: 1px solid #f1f5f9;
          padding: 48px 0;
        }
        .l-stats__grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
        }
        @media (min-width: 768px) {
          .l-stats__grid { grid-template-columns: repeat(4, 1fr); }
        }
        .l-stat {
          text-align: center;
          padding: 28px 20px;
          border-radius: 18px;
          background: #f9fafb;
          border: 1px solid #f3f4f6;
          transition: all .25s;
        }
        .l-stat:hover {
          background: white;
          border-color: rgba(96,195,173,.2);
          box-shadow: 0 4px 24px rgba(0,0,0,.05);
          transform: translateY(-3px);
        }
        .l-stat__icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 42px; height: 42px;
          border-radius: 12px;
          background: rgba(96,195,173,.08);
          color: #60c3ad;
          margin: 0 auto 14px;
          border: 1px solid rgba(96,195,173,.1);
        }
        .l-stat__value {
          font-size: 30px;
          font-weight: 800;
          color: #0f172a;
          letter-spacing: -.025em;
          line-height: 1;
        }
        .l-stat__label {
          font-size: 13px;
          color: #9ca3af;
          margin-top: 6px;
          font-weight: 500;
        }

        /* ── Features grid ──────────────────────── */
        .l-features {
          display: grid;
          gap: 18px;
          grid-template-columns: 1fr;
        }
        @media (min-width: 640px)  { .l-features { grid-template-columns: repeat(2, 1fr); } }
        @media (min-width: 1024px) { .l-features { grid-template-columns: repeat(3, 1fr); } }
        .l-feature {
          background: white;
          border-radius: 20px;
          padding: 32px;
          border: 1px solid #f3f4f6;
          transition: all .25s;
        }
        .l-feature:hover {
          border-color: #e5e7eb;
          box-shadow: 0 8px 32px rgba(0,0,0,.06);
          transform: translateY(-4px);
        }
        .l-feature__icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 48px; height: 48px;
          border-radius: 14px;
          transition: transform .2s;
        }
        .l-feature:hover .l-feature__icon { transform: scale(1.08); }
        .l-feature__title {
          margin-top: 20px;
          font-size: 16.5px;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -.01em;
        }
        .l-feature__desc {
          margin-top: 10px;
          font-size: 14px;
          color: #6b7280;
          line-height: 1.65;
        }

        /* ── Steps ──────────────────────────────── */
        .l-steps {
          display: grid;
          gap: 32px;
          max-width: 880px;
          margin: 0 auto;
          grid-template-columns: 1fr;
        }
        @media (min-width: 768px) {
          .l-steps { grid-template-columns: repeat(3, 1fr); gap: 0; }
        }
        .l-step {
          text-align: center;
          position: relative;
          padding: 0 24px;
        }
        .l-step__num {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 56px; height: 56px;
          border-radius: 18px;
          background: linear-gradient(135deg, #2e8b78, #60c3ad);
          color: white;
          font-size: 17px;
          font-weight: 800;
          letter-spacing: -.02em;
          box-shadow: 0 6px 20px rgba(96,195,173,.3);
          margin-bottom: 20px;
        }
        .l-step__line {
          display: none;
        }
        @media (min-width: 768px) {
          .l-step__line {
            display: block;
            position: absolute;
            top: 28px;
            right: -12px;
            width: 24px;
            height: 2px;
            background: linear-gradient(90deg, #e2e8f0, #cbd5e1);
            border-radius: 2px;
          }
        }
        .l-step__icon-wrap {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 44px; height: 44px;
          border-radius: 12px;
          background: #f0fdf9;
          color: #3d9e8a;
          border: 1px solid rgba(96,195,173,.15);
          margin-bottom: 16px;
        }
        .l-step__title {
          font-size: 17px;
          font-weight: 700;
          color: #0f172a;
          letter-spacing: -.01em;
          margin-bottom: 10px;
        }
        .l-step__desc {
          font-size: 14px;
          color: #6b7280;
          line-height: 1.65;
        }

        /* ── Testimonials ───────────────────────── */
        .l-testimonials {
          display: grid;
          gap: 20px;
          grid-template-columns: 1fr;
          max-width: 1000px;
          margin: 0 auto;
        }
        @media (min-width: 768px) { .l-testimonials { grid-template-columns: repeat(3, 1fr); } }
        .l-testimonial {
          background: white;
          border-radius: 20px;
          padding: 32px;
          border: 1px solid #f3f4f6;
          display: flex;
          flex-direction: column;
          transition: all .25s;
        }
        .l-testimonial:hover {
          box-shadow: 0 8px 32px rgba(0,0,0,.06);
          transform: translateY(-3px);
          border-color: #e5e7eb;
        }
        .l-testimonial__stars {
          display: flex;
          gap: 3px;
          margin-bottom: 18px;
        }
        .l-testimonial__text {
          font-size: 14.5px;
          color: #374151;
          line-height: 1.7;
          flex: 1;
          font-style: italic;
        }
        .l-testimonial__author {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px solid #f3f4f6;
        }
        .l-testimonial__avatar {
          width: 40px; height: 40px;
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 12px;
          font-weight: 700;
          color: white;
          flex-shrink: 0;
          opacity: .85;
        }
        .l-testimonial__name {
          font-size: 14px;
          font-weight: 700;
          color: #111827;
        }
        .l-testimonial__role {
          font-size: 12px;
          color: #9ca3af;
          margin-top: 2px;
          font-weight: 500;
        }

        /* ── CTA section ────────────────────────── */
        .l-cta-section {
          position: relative;
          overflow: hidden;
          background: linear-gradient(145deg, #134e41 0%, #1e7a65 35%, #2e9e88 65%, #60c3ad 100%);
        }
        .l-cta-section__bg {
          position: absolute;
          inset: 0;
          pointer-events: none;
        }
        .l-cta-orb {
          position: absolute;
          border-radius: 50%;
          filter: blur(80px);
        }
        .l-cta-orb--1 {
          width: 500px; height: 500px;
          background: radial-gradient(circle, rgba(164,234,216,.3), transparent 70%);
          top: -150px; right: -80px;
          animation: orb1 9s ease-in-out infinite;
        }
        .l-cta-orb--2 {
          width: 380px; height: 380px;
          background: radial-gradient(circle, rgba(120,223,197,.25), transparent 70%);
          bottom: -100px; left: -60px;
          animation: orb2 11s ease-in-out infinite;
        }
        .l-cta-section__body {
          position: relative;
          z-index: 10;
          padding: 96px 28px;
          text-align: center;
        }
        .l-cta-section__title {
          margin-top: 20px;
          font-size: clamp(2rem, 4vw, 3rem);
          font-weight: 800;
          color: white;
          letter-spacing: -.025em;
          line-height: 1.15;
        }
        .l-cta-section__sub {
          margin-top: 18px;
          font-size: 16px;
          color: rgba(255,255,255,.7);
          max-width: 480px;
          margin-left: auto;
          margin-right: auto;
          line-height: 1.65;
        }
        .l-cta-section__btns {
          margin-top: 40px;
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          justify-content: center;
          gap: 14px;
        }

        /* ── Footer ─────────────────────────────── */
        .l-footer {
          background: #0a0f1a;
          border-top: 1px solid rgba(255,255,255,.06);
          padding: 64px 0 0;
        }
        .l-footer__top {
          display: grid;
          grid-template-columns: 1fr;
          gap: 48px;
          padding-bottom: 48px;
        }
        @media (min-width: 768px) {
          .l-footer__top {
            grid-template-columns: 1.6fr 1fr;
            gap: 64px;
          }
        }
        .l-footer__brand-col {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .l-footer__brand {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          font-size: 16px;
          font-weight: 700;
          color: white;
        }
        .l-footer__logo {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 34px; height: 34px;
          border-radius: 9px;
          background: linear-gradient(135deg, rgba(96,195,173,.25), rgba(96,195,173,.1));
          color: #60c3ad;
          border: 1px solid rgba(96,195,173,.2);
        }
        .l-footer__tagline {
          font-size: 14px;
          color: #64748b;
          line-height: 1.7;
          max-width: 340px;
          margin: 0;
        }
        .l-footer__badges {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .l-footer__badge {
          font-size: 12px;
          font-weight: 500;
          color: #60c3ad;
          background: rgba(96,195,173,.08);
          border: 1px solid rgba(96,195,173,.15);
          padding: 4px 12px;
          border-radius: 20px;
        }
        .l-footer__cols {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 40px;
        }
        .l-footer__col {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .l-footer__col-title {
          font-size: 12px;
          font-weight: 600;
          letter-spacing: .08em;
          text-transform: uppercase;
          color: #94a3b8;
          margin: 0 0 4px;
        }
        .l-footer__col a {
          font-size: 14px;
          color: #475569;
          text-decoration: none;
          transition: color .15s;
        }
        .l-footer__col a:hover { color: #cbd5e1; }
        .l-footer__bottom {
          border-top: 1px solid rgba(255,255,255,.06);
          padding: 20px 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          text-align: center;
        }
        @media (min-width: 768px) {
          .l-footer__bottom {
            flex-direction: row;
            justify-content: space-between;
            text-align: left;
          }
        }
        .l-footer__copy {
          font-size: 13px;
          color: #334155;
          margin: 0;
        }
        .l-footer__made {
          font-size: 13px;
          color: #334155;
          margin: 0;
        }
      `}</style>
    </div>
  )
}

export default Landing
