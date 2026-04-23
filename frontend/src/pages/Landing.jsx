import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Users, BarChart3, Bell, Home, CreditCard, PieChart,
  Menu, X, TrendingUp, IndianRupee, Building2,
} from 'lucide-react'
import DormAxisIcon from '../components/ui/DormAxisIcon'

/* ─── Data ─────────────────────────────────────────────────────────── */
const FEATURES = [
  { icon: Home,       title: 'Property Management',  desc: 'Manage multiple PGs from one dashboard. Rooms, beds, floors — all in real time.' },
  { icon: Users,      title: 'Tenant Tracking',      desc: 'Full lifecycle from check-in to check-out. Store IDs, contacts, and history.' },
  { icon: CreditCard, title: 'Rent & Payments',      desc: 'Auto rent tracking with due-date alerts. Record partial payments, generate receipts.' },
  { icon: PieChart,   title: 'Expense Management',   desc: 'Categorise every expense. Know exactly where your money goes each month.' },
  { icon: Bell,       title: 'Smart Alerts',         desc: 'Overdue rent, expiring leases, vacant beds — get notified before it becomes a problem.' },
  { icon: BarChart3,  title: 'Reports & Analytics',  desc: 'Revenue trends, occupancy rates, expense breakdowns — all the numbers you need.' },
]

const STEPS = [
  { n: '01', title: 'Create your account',  desc: 'Sign up free in under a minute. Up and running instantly.' },
  { n: '02', title: 'Add your property',    desc: 'Enter rooms, beds, and rent amounts. Dashboard is ready instantly.' },
  { n: '03', title: 'Start managing',       desc: 'Add tenants, collect rent, track expenses — everything in one place.' },
]

const STATS = [
  { icon: Building2,    value: '500+',    label: 'Properties' },
  { icon: Users,        value: '12,000+', label: 'Beds tracked' },
  { icon: IndianRupee,  value: '₹8 Cr+',  label: 'Rent processed' },
  { icon: TrendingUp,   value: '99.9%',   label: 'Uptime' },
]

/* ─── Component ─────────────────────────────────────────────────────── */
export default function Landing() {
  const [open,    setOpen]    = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 32)
    window.addEventListener('scroll', fn, { passive: true })
    return () => window.removeEventListener('scroll', fn)
  }, [])

  const close = () => setOpen(false)

  return (
    <div className="p">

      {/* ══ NAV ══════════════════════════════════════════════════════ */}
      <nav className={`nav${scrolled ? ' nav--up' : ''}`}>
        <div className="nav__wrap container">
          <Link to="/" className="nav__brand" onClick={close}>
            <span className="nav__icon"><DormAxisIcon size={18} color="white" /></span>
            DormAxis
          </Link>

          {/* desktop links */}
          <div className="nav__links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
          </div>

          {/* desktop actions */}
          <div className="nav__acts">
            <Link to="/login"  className="nav__in">Sign in</Link>
            <Link to="/signup" className="btn btn--sm">Get started</Link>
          </div>

          {/* burger */}
          <button className="nav__burger" onClick={() => setOpen(o => !o)} aria-label="menu">
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* mobile drawer */}
        {open && (
          <div className="nav__drawer">
            <div className="container">
              <a href="#features"     className="nav__dl" onClick={close}>Features</a>
              <a href="#how-it-works" className="nav__dl" onClick={close}>How it works</a>
              <div className="nav__dbtns">
                <Link to="/login"  className="nav__dl" onClick={close}>Sign in</Link>
                <Link to="/signup" className="btn btn--sm btn--full" onClick={close}>Get started free</Link>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* ══ HERO ══════════════════════════════════════════════════════ */}
      <section className="hero">
        <div className="hero__noise" aria-hidden />
        <div className="hero__orb hero__orb--a" aria-hidden />
        <div className="hero__orb hero__orb--b" aria-hidden />
        <div className="container hero__inner">

          {/* text */}
          <div className="hero__copy">
            <div className="chip">
              <span className="chip__pulse" />
              Built for PG &amp; Hostel owners
            </div>

            <h1 className="hero__h1">
              Run your PG like
              <br />
              <span className="grad">a pro, not a&nbsp;spreadsheet</span>
            </h1>

            <p className="hero__sub">
              Tenants, rent, expenses, and reports — all in one clean dashboard.
              Say goodbye to WhatsApp chaos and manual registers.
            </p>

            <div className="hero__btns">
              <Link to="/signup" className="btn btn--lg">
                Start free <ArrowRight size={16} />
              </Link>
              <a href="#features" className="btn btn--ghost">See features</a>
            </div>

          </div>

          {/* mockup */}
          <div className="hero__visual">
            {/* notification toast */}
            <div className="toast toast--top">
              <span className="toast__dot" />
              <span>Rent received</span>
              <strong>₹8,500</strong>
            </div>

            {/* main card */}
            <div className="mock">
              <div className="mock__bar">
                <span className="mock__dot mock__dot--r" />
                <span className="mock__dot mock__dot--y" />
                <span className="mock__dot mock__dot--g" />
                <span className="mock__url">dashboard · April 2025</span>
              </div>

              <div className="mock__body">
                <div className="mock__stats">
                  {[
                    { label: 'Tenants',   val: '24',   color: 'var(--p)' },
                    { label: 'Collected', val: '₹1.8L', color: '#10b981' },
                    { label: 'Vacant',    val: '4',    color: '#f59e0b' },
                  ].map(s => (
                    <div className="mock__stat" key={s.label}>
                      <span className="mock__stat-val" style={{ color: s.color }}>{s.val}</span>
                      <span className="mock__stat-lbl">{s.label}</span>
                    </div>
                  ))}
                </div>

                <div className="mock__occ">
                  <span>Occupancy</span><span>87%</span>
                  <div className="mock__bar2"><div className="mock__fill" style={{ width: '87%' }} /></div>
                </div>

                <p className="mock__section-title">Recent activity</p>
                {[
                  { init: 'P', name: 'Priya S.',  act: 'Paid rent',  amt: '₹9,000', c: '#10b981' },
                  { init: 'R', name: 'Rahul K.',  act: 'Check-in',   amt: 'Room 4B', c: 'var(--p)' },
                  { init: 'M', name: 'Meena R.',  act: 'Overdue',    amt: '₹6,500', c: '#ef4444' },
                ].map(a => (
                  <div className="mock__row" key={a.name}>
                    <span className="mock__avatar">{a.init}</span>
                    <span className="mock__name">{a.name}</span>
                    <span className="mock__act">{a.act}</span>
                    <span className="mock__amt" style={{ color: a.c }}>{a.amt}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* property badge */}
            <div className="toast toast--bot">
              <span style={{ fontSize: 16 }}>🏠</span>
              <div>
                <p className="toast__title">3 Properties</p>
                <p className="toast__sub">All running smoothly</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══ STATS ══════════════════════════════════════════════════════ */}
      <div className="stats">
        <div className="container stats__grid">
          {STATS.map((s, i) => (
            <div className="stat" key={s.label}>
              {i > 0 && <div className="stat__div" />}
              <div className="stat__icon"><s.icon size={15} /></div>
              <p className="stat__val">{s.value}</p>
              <p className="stat__lbl">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ══ FEATURES ════════════════════════════════════════════════════ */}
      <section id="features" className="section">
        <div className="container">
          <div className="section__hd">
            <p className="eyebrow">Features</p>
            <h2 className="section__h2">Everything your PG needs</h2>
            <p className="section__sub">No bloat. No learning curve. Just the tools that actually matter.</p>
          </div>
          <div className="feat-grid">
            {FEATURES.map(f => (
              <div className="feat" key={f.title}>
                <div className="feat__icon"><f.icon size={18} /></div>
                <h3 className="feat__h3">{f.title}</h3>
                <p className="feat__p">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ HOW IT WORKS ═══════════════════════════════════════════════ */}
      <section id="how-it-works" className="section section--tint">
        <div className="container">
          <div className="section__hd">
            <p className="eyebrow">How it works</p>
            <h2 className="section__h2">Up and running in 3 steps</h2>
            <p className="section__sub">No setup complexity. No training needed.</p>
          </div>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div className="step" key={s.n}>
                <div className="step__left">
                  <div className="step__badge">{s.n}</div>
                  {i < STEPS.length - 1 && <div className="step__line" />}
                </div>
                <div className="step__right">
                  <h3 className="step__h3">{s.title}</h3>
                  <p className="step__p">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ CTA ════════════════════════════════════════════════════════ */}
      <section className="cta">
        <div className="cta__glow" aria-hidden />
        <div className="container cta__inner">
          <p className="eyebrow eyebrow--white">Get started today</p>
          <h2 className="cta__h2">Ready to manage smarter?</h2>
          <p className="cta__sub">Join PG owners across India who ditched spreadsheets for DormAxis.</p>
          <Link to="/signup" className="btn btn--white btn--lg">
            Create free account <ArrowRight size={16} />
          </Link>
          <p className="cta__hint">
            Already have an account?{' '}
            <Link to="/login" className="cta__link">Sign in</Link>
          </p>
        </div>
      </section>

      {/* ══ FOOTER ═════════════════════════════════════════════════════ */}
      <footer className="foot">
        <div className="container foot__inner">
          <div className="foot__brand">
            <span className="foot__icon"><Building2 size={13} /></span>
            DormAxis
          </div>
          <nav className="foot__links">
            <a href="#features">Features</a>
            <a href="#how-it-works">How it works</a>
            <Link to="/login">Sign in</Link>
            <Link to="/signup">Get started</Link>
          </nav>
          <p className="foot__copy">© {new Date().getFullYear()} DormAxis</p>
        </div>
      </footer>

      {/* ══ STYLES ═════════════════════════════════════════════════════ */}
      <style>{`
        /* tokens */
        .p {
          --p:    #45a793;
          --p2:   #60c3ad;
          --p-bg: rgba(96,195,173,.1);
          --p-bd: rgba(96,195,173,.2);
          --ink:  #0a0f1e;
          --dim:  #64748b;
          --mute: #94a3b8;
          --bd:   #e8ecf0;
          --bg:   #ffffff;
          --tint: #f7faf9;

          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          -webkit-font-smoothing: antialiased;
          background: var(--bg);
          color: var(--ink);
          overflow-x: hidden;
        }
        .p *, .p *::before, .p *::after { box-sizing: border-box; margin: 0; padding: 0; }
        html { scroll-behavior: smooth; }

        /* layout */
        .container {
          width: 100%;
          max-width: 1100px;
          margin-inline: auto;
          padding-inline: 20px;
        }

        /* ── nav ── */
        .nav {
          position: fixed; inset-block-start: 0; inset-inline: 0; z-index: 300;
          background: rgba(255,255,255,.88);
          backdrop-filter: blur(18px); -webkit-backdrop-filter: blur(18px);
          border-bottom: 1px solid transparent;
          transition: border-color .2s, box-shadow .2s;
        }
        .nav--up {
          border-color: var(--bd);
          box-shadow: 0 2px 16px rgba(0,0,0,.06);
        }
        .nav__wrap {
          display: flex; align-items: center;
          height: 60px; gap: 12px;
        }
        .nav__brand {
          display: flex; align-items: center; gap: 8px;
          font-size: 15px; font-weight: 700; color: var(--ink);
          text-decoration: none; letter-spacing: -.02em;
          margin-right: auto; flex-shrink: 0;
        }
        .nav__icon {
          display: grid; place-items: center;
          width: 32px; height: 32px; border-radius: 8px;
          background: linear-gradient(135deg, var(--p), var(--p2));
          color: white; flex-shrink: 0;
          box-shadow: 0 2px 6px rgba(96,195,173,.35);
        }
        .nav__links, .nav__acts { display: none; }
        .nav__burger {
          display: grid; place-items: center;
          width: 38px; height: 38px; border-radius: 9px;
          border: 1px solid var(--bd); background: white;
          color: var(--dim); cursor: pointer;
          transition: background .15s;
        }
        .nav__burger:hover { background: var(--tint); }
        .nav__drawer {
          border-top: 1px solid var(--bd);
          background: white;
          box-shadow: 0 12px 32px rgba(0,0,0,.06);
        }
        .nav__drawer .container { padding-block: 12px 20px; }
        .nav__dl {
          display: block; font-size: 15px; font-weight: 500; color: #374151;
          text-decoration: none; padding: 12px 0;
          border-bottom: 1px solid #f5f7f8;
          transition: color .15s;
        }
        .nav__dl:hover { color: var(--ink); }
        .nav__dbtns { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }

        /* ── buttons ── */
        .btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 7px;
          font-weight: 600; font-size: 14px; text-decoration: none;
          border: none; cursor: pointer; border-radius: 11px;
          transition: all .18s; outline: none; white-space: nowrap;
        }
        .btn--sm { padding: 9px 18px; font-size: 13.5px; background: linear-gradient(135deg, var(--p), var(--p2)); color: white; box-shadow: 0 2px 8px rgba(96,195,173,.3); }
        .btn--sm:hover { box-shadow: 0 4px 16px rgba(96,195,173,.4); transform: translateY(-1px); }
        .btn--lg { padding: 15px 28px; font-size: 15px; background: linear-gradient(135deg, var(--p), var(--p2)); color: white; box-shadow: 0 4px 20px rgba(96,195,173,.35); }
        .btn--lg:hover { box-shadow: 0 8px 28px rgba(96,195,173,.45); transform: translateY(-2px); }
        .btn--ghost { padding: 15px 22px; font-size: 15px; font-weight: 500; color: var(--dim); background: white; border: 1.5px solid var(--bd); }
        .btn--ghost:hover { border-color: #c4cdd6; color: var(--ink); background: var(--tint); }
        .btn--white { padding: 15px 28px; font-size: 15px; background: white; color: var(--ink); box-shadow: 0 4px 20px rgba(0,0,0,.14); }
        .btn--white:hover { box-shadow: 0 8px 28px rgba(0,0,0,.2); transform: translateY(-2px); }
        .btn--full { width: 100%; }

        /* ── hero ── */
        .hero {
          position: relative;
          min-height: 100svh;
          display: flex; flex-direction: column; justify-content: center;
          padding-block: 96px 64px;
          background: #ffffff;
          overflow: hidden;
        }
        .hero__noise {
          position: absolute; inset: 0; pointer-events: none; opacity: .35;
          background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.04'/%3E%3C/svg%3E");
        }
        /* decorative background orbs */
        .hero__orb {
          position: absolute; pointer-events: none; border-radius: 50%;
          filter: blur(72px);
        }
        .hero__orb--a {
          width: 480px; height: 480px;
          top: -160px; left: 50%;
          transform: translateX(-50%);
          background: radial-gradient(circle, rgba(96,195,173,.18) 0%, transparent 70%);
        }
        .hero__orb--b {
          width: 320px; height: 320px;
          bottom: -80px; right: -80px;
          background: radial-gradient(circle, rgba(69,167,147,.12) 0%, transparent 70%);
        }
        .hero__inner {
          position: relative; z-index: 1;
          display: flex; flex-direction: column; gap: 36px;
          width: 100%;
        }
        .hero__copy {
          display: flex; flex-direction: column;
          align-items: center; text-align: center; gap: 0;
        }
        .hero__visual { display: none; }

        /* chip */
        .chip {
          display: inline-flex; align-items: center; gap: 8px;
          font-size: 11.5px; font-weight: 600; letter-spacing: .07em;
          text-transform: uppercase; color: var(--p);
          background: var(--p-bg); border: 1px solid var(--p-bd);
          padding: 6px 13px; border-radius: 100px; margin-bottom: 20px;
        }
        .chip__pulse {
          width: 6px; height: 6px; border-radius: 50%;
          background: var(--p2); flex-shrink: 0;
          box-shadow: 0 0 0 2px rgba(96,195,173,.3);
          animation: pulse 2s infinite;
        }
        @keyframes pulse {
          0%,100% { box-shadow: 0 0 0 2px rgba(96,195,173,.3); }
          50%      { box-shadow: 0 0 0 5px rgba(96,195,173,.12); }
        }

        .hero__h1 {
          font-size: clamp(2.4rem, 9vw, 3.8rem);
          font-weight: 800; color: var(--ink);
          line-height: 1.08; letter-spacing: -.035em;
          margin-bottom: 16px;
        }
        .grad {
          background: linear-gradient(120deg, #2e8b78 0%, var(--p) 45%, var(--p2) 100%);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        .hero__sub {
          font-size: 16px; color: var(--dim); line-height: 1.7;
          max-width: 520px; margin-bottom: 28px;
        }
        .hero__btns {
          display: flex; flex-direction: row; gap: 10px;
          justify-content: center; margin-bottom: 24px;
          flex-wrap: wrap;
        }
        .hero__btns .btn { flex: 1; min-width: 140px; max-width: 200px; justify-content: center; }
        .hero__trust {
          list-style: none; display: flex; flex-wrap: wrap;
          gap: 10px 20px; justify-content: center;
        }
        .hero__trust li {
          display: flex; align-items: center; gap: 6px;
          font-size: 12.5px; color: var(--mute); font-weight: 500;
        }
        .hero__trust li svg { color: var(--p); flex-shrink: 0; }

        /* mockup */
        .hero__visual { display: none; }
        .mock {
          background: white;
          border-radius: 18px;
          border: 1px solid var(--bd);
          box-shadow: 0 2px 4px rgba(0,0,0,.04), 0 20px 60px rgba(0,0,0,.09);
          overflow: hidden;
        }
        .mock__bar {
          display: flex; align-items: center; gap: 6px;
          background: #f5f7f8; padding: 10px 16px;
          border-bottom: 1px solid var(--bd);
        }
        .mock__dot {
          width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0;
        }
        .mock__dot--r { background: #ff5f57; }
        .mock__dot--y { background: #febc2e; }
        .mock__dot--g { background: #28c840; }
        .mock__url {
          font-size: 11px; color: var(--mute); font-weight: 500; margin-left: 6px;
        }
        .mock__body { padding: 18px; }
        .mock__stats {
          display: grid; grid-template-columns: repeat(3,1fr);
          gap: 8px; margin-bottom: 16px;
        }
        .mock__stat {
          background: var(--tint); border-radius: 10px;
          padding: 11px 8px; text-align: center;
          border: 1px solid #eef1f3;
        }
        .mock__stat-val { display: block; font-size: 17px; font-weight: 800; letter-spacing: -.02em; }
        .mock__stat-lbl { display: block; font-size: 9.5px; color: var(--mute); font-weight: 500; margin-top: 3px; }
        .mock__occ {
          display: grid; grid-template-columns: 1fr auto;
          align-items: center; gap: 4px;
          font-size: 11px; font-weight: 600; color: #475569;
          margin-bottom: 16px;
        }
        .mock__bar2 {
          grid-column: span 2;
          height: 5px; background: #eef1f3; border-radius: 99px; overflow: hidden;
        }
        .mock__fill {
          height: 100%; border-radius: 99px;
          background: linear-gradient(90deg, var(--p), var(--p2));
        }
        .mock__section-title {
          font-size: 10px; font-weight: 700; letter-spacing: .07em;
          text-transform: uppercase; color: var(--mute); margin-bottom: 8px;
        }
        .mock__row {
          display: grid; grid-template-columns: 26px 1fr auto auto;
          align-items: center; gap: 8px;
          padding: 7px 0; border-bottom: 1px solid #f5f7f8;
        }
        .mock__row:last-child { border-bottom: none; }
        .mock__avatar {
          width: 26px; height: 26px; border-radius: 7px;
          background: linear-gradient(135deg, #d8f3ec, #b8e8de);
          color: #2e8b78; font-size: 10.5px; font-weight: 700;
          display: grid; place-items: center;
        }
        .mock__name { font-size: 11.5px; font-weight: 600; color: var(--ink); }
        .mock__act  { font-size: 10.5px; color: var(--mute); }
        .mock__amt  { font-size: 11.5px; font-weight: 700; white-space: nowrap; }

        /* toasts */
        .toast {
          position: absolute; z-index: 10;
          display: flex; align-items: center; gap: 8px;
          background: white; border: 1px solid var(--bd);
          border-radius: 12px; padding: 9px 13px;
          box-shadow: 0 4px 20px rgba(0,0,0,.09);
          font-size: 12px; color: #374151;
          animation: floatY 3s ease-in-out infinite;
        }
        .toast--top { top: 4px; right: 4px; }
        .toast--bot { bottom: 4px; left: 4px; }
        .toast__dot {
          width: 7px; height: 7px; border-radius: 50%;
          background: #10b981; flex-shrink: 0;
          box-shadow: 0 0 6px rgba(16,185,129,.5);
        }
        .toast strong { color: #10b981; font-weight: 700; }
        .toast__title { font-size: 12px; font-weight: 700; color: var(--ink); }
        .toast__sub   { font-size: 10.5px; color: var(--mute); margin-top: 1px; }
        @keyframes floatY {
          0%,100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }

        /* ── stats ── */
        .stats {
          border-block: 1px solid var(--bd);
          background: var(--tint);
        }
        .stats__grid {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          padding-block: 28px;
        }
        .stat {
          display: flex; flex-direction: column; align-items: center;
          gap: 4px; padding: 20px 12px; text-align: center; position: relative;
        }
        .stat__div {
          display: none; position: absolute;
          left: 0; top: 50%; transform: translateY(-50%);
          height: 32px; width: 1px; background: var(--bd);
        }
        .stat__icon {
          display: grid; place-items: center;
          width: 32px; height: 32px; border-radius: 9px;
          background: var(--p-bg); color: var(--p);
          border: 1px solid var(--p-bd);
          margin-bottom: 4px;
        }
        .stat__val { font-size: 24px; font-weight: 800; color: var(--ink); letter-spacing: -.025em; line-height: 1; }
        .stat__lbl { font-size: 12px; color: var(--mute); font-weight: 500; }

        /* ── sections ── */
        .section { padding-block: 60px; background: var(--bg); }
        .section--tint { background: var(--tint); }
        .section__hd { text-align: center; max-width: 540px; margin-inline: auto; margin-bottom: 40px; }
        .eyebrow {
          display: inline-block;
          font-size: 11px; font-weight: 700; letter-spacing: .1em;
          text-transform: uppercase; color: var(--p);
          margin-bottom: 12px;
        }
        .eyebrow--white { color: rgba(255,255,255,.7); }
        .section__h2 {
          font-size: clamp(1.7rem, 5vw, 2.4rem); font-weight: 800;
          color: var(--ink); letter-spacing: -.025em; line-height: 1.15;
          margin-bottom: 12px;
        }
        .section__sub { font-size: 15px; color: var(--dim); line-height: 1.65; }

        /* ── features ── */
        .feat-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 14px;
        }
        .feat {
          background: white; border-radius: 16px;
          border: 1px solid var(--bd); padding: 22px 24px;
          transition: box-shadow .2s, border-color .2s, transform .2s;
        }
        .feat:hover { box-shadow: 0 8px 28px rgba(0,0,0,.07); border-color: rgba(96,195,173,.25); transform: translateY(-2px); }
        .feat__icon {
          display: grid; place-items: center;
          width: 40px; height: 40px; border-radius: 11px;
          background: var(--p-bg); color: var(--p);
          border: 1px solid var(--p-bd); margin-bottom: 14px;
        }
        .feat__h3 { font-size: 15px; font-weight: 700; color: var(--ink); letter-spacing: -.01em; margin-bottom: 6px; }
        .feat__p  { font-size: 13.5px; color: var(--dim); line-height: 1.6; }

        /* ── steps ── */
        .steps { display: flex; flex-direction: column; gap: 0; max-width: 600px; margin-inline: auto; }
        .step {
          display: flex; gap: 18px;
          padding-bottom: 28px;
        }
        .step:last-child { padding-bottom: 0; }
        .step__left { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
        .step__badge {
          width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0;
          display: grid; place-items: center;
          font-size: 12.5px; font-weight: 800; letter-spacing: -.02em;
          background: linear-gradient(135deg, var(--p), var(--p2));
          color: white;
          box-shadow: 0 3px 10px rgba(96,195,173,.35);
        }
        .step__line {
          flex: 1; width: 2px; margin-block: 6px;
          background: linear-gradient(180deg, rgba(96,195,173,.25) 0%, rgba(96,195,173,.04) 100%);
          border-radius: 2px; min-height: 20px;
        }
        .step__right { padding-top: 6px; }
        .step__h3 { font-size: 15.5px; font-weight: 700; color: var(--ink); letter-spacing: -.015em; margin-bottom: 5px; }
        .step__p  { font-size: 13.5px; color: var(--dim); line-height: 1.65; }

        /* ── cta ── */
        .cta {
          position: relative; overflow: hidden;
          background: linear-gradient(145deg, #1a6b59 0%, #2a9078 40%, var(--p) 80%, var(--p2) 100%);
          padding-block: 64px;
          text-align: center;
        }
        .cta__glow {
          position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(ellipse 70% 60% at 50% 0%, rgba(255,255,255,.12) 0%, transparent 65%);
        }
        .cta__inner { position: relative; z-index: 1; }
        .cta__h2 {
          font-size: clamp(1.8rem, 6vw, 3rem); font-weight: 800;
          color: white; letter-spacing: -.03em; line-height: 1.1;
          margin-bottom: 10px;
        }
        .cta__sub { font-size: 15px; color: rgba(255,255,255,.65); line-height: 1.65; max-width: 420px; margin-inline: auto; margin-bottom: 28px; }
        .cta__hint { margin-top: 16px; font-size: 13px; color: rgba(255,255,255,.4); }
        .cta__link { color: rgba(255,255,255,.75); font-weight: 600; text-decoration: none; transition: color .15s; }
        .cta__link:hover { color: white; }

        /* ── footer ── */
        .foot {
          background: #080d15; padding-block: 28px;
          border-top: 1px solid rgba(255,255,255,.05);
        }
        .foot__inner {
          display: flex; flex-direction: column;
          align-items: center; gap: 16px; text-align: center;
        }
        .foot__brand {
          display: flex; align-items: center; gap: 8px;
          font-size: 13.5px; font-weight: 700; color: rgba(255,255,255,.55);
        }
        .foot__icon {
          display: grid; place-items: center;
          width: 26px; height: 26px; border-radius: 6px;
          background: rgba(96,195,173,.1); color: var(--p2);
          border: 1px solid rgba(96,195,173,.15);
        }
        .foot__links {
          display: flex; flex-wrap: wrap; justify-content: center;
          gap: 4px 16px;
        }
        .foot__links a {
          font-size: 13px; color: rgba(255,255,255,.28);
          text-decoration: none; transition: color .15s;
        }
        .foot__links a:hover { color: rgba(255,255,255,.7); }
        .foot__copy { font-size: 12px; color: rgba(255,255,255,.2); }

        /* ══ TABLET  ≥ 640px ═══════════════════════════════════════════ */
        @media (min-width: 640px) {
          .container { padding-inline: 32px; }

          .nav__brand { margin-right: 0; }
          .nav__links {
            display: flex; align-items: center; gap: 28px; margin-inline: auto;
          }
          .nav__links a {
            font-size: 14px; font-weight: 500; color: var(--dim);
            text-decoration: none; transition: color .15s;
          }
          .nav__links a:hover { color: var(--ink); }
          .nav__acts { display: flex; align-items: center; gap: 6px; }
          .nav__in {
            font-size: 14px; font-weight: 500; color: var(--dim);
            text-decoration: none; padding: 7px 12px; border-radius: 8px;
            transition: all .15s;
          }
          .nav__in:hover { color: var(--ink); background: var(--tint); }
          .nav__burger { display: none; }

          .hero { min-height: auto; display: block; padding-block: 120px 80px; }
          .hero__inner { gap: 44px; }
          .hero__visual { display: block; position: relative; padding: 44px 8px; }
          .hero__copy { align-items: flex-start; text-align: left; }
          .hero__btns { justify-content: flex-start; }
          .hero__btns .btn { flex: none; max-width: none; }
          .hero__trust { justify-content: flex-start; }

          .feat-grid { grid-template-columns: repeat(2, 1fr); gap: 16px; }

          .stats__grid { grid-template-columns: repeat(4, 1fr); padding-block: 32px; }
          .stat { padding: 16px 20px; }
          .stat__div { display: block; }

          .section { padding-block: 72px; }
          .section__hd { margin-bottom: 48px; }

          .foot__inner { flex-direction: row; justify-content: space-between; text-align: left; }
        }

        /* ══ DESKTOP ≥ 960px ═══════════════════════════════════════════ */
        @media (min-width: 960px) {
          .container { padding-inline: 40px; }

          .hero { padding-block: 128px 88px; }
          .hero__inner { flex-direction: row; align-items: center; gap: 56px; }
          .hero__copy { flex: 1; }
          .hero__visual { flex: 1; padding: 44px 0 40px; display: block; }
          .toast--top { top: 4px; right: -12px; }
          .toast--bot { bottom: 4px; left: -12px; }

          .feat-grid { grid-template-columns: repeat(3, 1fr); gap: 18px; }
          .feat { padding: 26px 28px; }

          .section { padding-block: 88px; }
          .section__hd { margin-bottom: 56px; }

          .steps { flex-direction: row; gap: 0; max-width: 100%; }
          .step {
            flex: 1; flex-direction: column;
            gap: 14px; padding-bottom: 0; padding-inline: 20px;
          }
          .step:first-child { padding-left: 0; }
          .step:last-child  { padding-right: 0; }
          .step__left { flex-direction: row; align-items: center; }
          .step__line {
            flex: 1; width: auto; height: 2px; min-height: auto;
            margin-block: 0; margin-inline: 8px;
            background: linear-gradient(90deg, rgba(96,195,173,.3) 0%, rgba(96,195,173,.05) 100%);
          }
          .step__right { padding-top: 0; }

          .cta { padding-block: 88px; }
          .cta__sub { font-size: 16px; margin-bottom: 32px; }
        }
      `}</style>
    </div>
  )
}
