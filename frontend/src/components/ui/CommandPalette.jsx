import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, LayoutDashboard, Building2, BedDouble, Users,
  CreditCard, Receipt, BarChart3, MapPin, Phone, Hash,
  ArrowRight, Loader2, SlidersHorizontal,
} from 'lucide-react'
import { globalSearch } from '../../api/search'
import { useCommandPalette } from '../../context/CommandPaletteContext'

// ── Static quick actions ──────────────────────────────────────────────────────
const QUICK_ACTIONS = [
  { id: 'nav-dashboard',  label: 'Go to Dashboard',   icon: LayoutDashboard, path: '/dashboard',  section: 'Navigate' },
  { id: 'nav-properties', label: 'Go to Properties',  icon: Building2,       path: '/properties', section: 'Navigate' },
  { id: 'nav-rooms',      label: 'Go to Rooms & Beds', icon: BedDouble,      path: '/rooms',      section: 'Navigate' },
  { id: 'nav-tenants',    label: 'Go to Tenants',     icon: Users,           path: '/tenants',    section: 'Navigate' },
  { id: 'nav-rent',       label: 'Go to Rent',        icon: CreditCard,      path: '/rent',       section: 'Navigate' },
  { id: 'nav-expenses',   label: 'Go to Expenses',    icon: Receipt,         path: '/expenses',   section: 'Navigate' },
  { id: 'nav-reports',    label: 'Go to Reports',     icon: BarChart3,       path: '/reports',    section: 'Navigate' },
]

// ── Single result row ─────────────────────────────────────────────────────────
const ResultRow = memo(({ item, isActive, onSelect, onHover }) => {
  const Icon = item.icon
  return (
    <button
      data-active={isActive}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors rounded-xl mx-1 ${
        isActive ? 'bg-primary-50' : 'hover:bg-slate-50'
      }`}
    >
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
        isActive ? 'bg-primary-100' : 'bg-slate-100'
      }`}>
        <Icon size={14} className={isActive ? 'text-primary-500' : 'text-slate-400'} />
      </span>
      <span className="flex-1 min-w-0">
        <span className={`block text-sm font-medium truncate ${isActive ? 'text-primary-600' : 'text-slate-700'}`}>
          {item.label}
        </span>
        {item.sub && (
          <span className="block text-xs text-slate-400 truncate mt-0.5">{item.sub}</span>
        )}
      </span>
      {isActive && (
        <ArrowRight size={13} className="shrink-0 text-primary-500" />
      )}
    </button>
  )
})
ResultRow.displayName = 'ResultRow'

// ── Section header ────────────────────────────────────────────────────────────
const SectionHeader = ({ label }) => (
  <p className="px-5 pb-1.5 pt-4 text-[10px] font-bold uppercase tracking-widest text-slate-400 first:pt-2">
    {label}
  </p>
)

// ── Main component ────────────────────────────────────────────────────────────
const CommandPalette = () => {
  const { open, close } = useCommandPalette()
  const navigate        = useNavigate()
  const inputRef        = useRef(null)
  const listRef         = useRef(null)

  const [query,     setQuery]     = useState('')
  const [results,   setResults]   = useState(null)   // null = no search yet
  const [loading,   setLoading]   = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)

  // Reset state each time palette opens
  useEffect(() => {
    if (open) {
      setQuery('')
      setResults(null)
      setActiveIdx(0)
      // Defer focus so the portal is mounted
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Debounced search (300 ms)
  useEffect(() => {
    const q = query.trim()
    if (!q || q.length < 2) {
      setResults(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await globalSearch(q)
        setResults(res.data.data)
        setActiveIdx(0)
      } catch {
        setResults({ properties: [], tenants: [], rooms: [] })
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  // Build flat item list for keyboard nav
  const items = useMemo(() => {
    if (!results) {
      // No query → show quick actions
      return QUICK_ACTIONS.map((a) => ({ ...a, kind: 'action' }))
    }

    const list = []

    results.properties.forEach((p) =>
      list.push({
        id: p._id, kind: 'property', label: p.name,
        sub: [p.address?.city, p.address?.state].filter(Boolean).join(', '),
        path: '/properties', icon: MapPin, section: 'Properties',
      })
    )
    results.rooms.forEach((r) =>
      list.push({
        id: r._id, kind: 'room', label: `Room ${r.roomNumber}`,
        sub: r.property?.name,
        path: '/rooms', icon: Hash, section: 'Rooms',
      })
    )
    results.tenants.forEach((t) =>
      list.push({
        id: t._id, kind: 'tenant', label: t.name,
        sub: t.phone,
        path: '/tenants', icon: Phone, section: 'Tenants',
      })
    )
    return list
  }, [results])

  const handleSelect = useCallback((item) => {
    navigate(item.path)
    close()
  }, [navigate, close])

  // Arrow + Enter keyboard nav
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx((i) => Math.min(i + 1, items.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (items[activeIdx]) handleSelect(items[activeIdx])
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, items, activeIdx, handleSelect])

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx])

  if (!open) return null

  const totalResults = results
    ? (results.properties.length + results.rooms.length + results.tenants.length)
    : 0
  const hasResults = results && totalResults > 0
  const noResults  = results && totalResults === 0

  // Group items by section for rendering with headers
  const grouped = useMemo(() => {
    if (!results) {
      return [{ section: 'Navigate', items: items.map((item, i) => ({ item, idx: i })) }]
    }
    const map = new Map()
    items.forEach((item, idx) => {
      if (!map.has(item.section)) map.set(item.section, [])
      map.get(item.section).push({ item, idx })
    })
    return Array.from(map.entries()).map(([section, rows]) => ({ section, items: rows }))
  }, [items, results])

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center pt-[12vh] px-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 animate-fadeIn"
        style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
        onClick={close}
      />

      {/* Panel */}
      <div className="relative w-full max-w-xl animate-scaleIn">
        <div className="overflow-hidden rounded-2xl bg-white"
          style={{ border: '1px solid #E2E8F0', boxShadow: '0 20px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)' }}>

          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-100">
            {loading
              ? <Loader2 size={16} className="shrink-0 text-primary-500 animate-spin" />
              : <Search   size={16} className="shrink-0 text-slate-300" />
            }
            <input
              ref={inputRef}
              type="text"
              placeholder="Search properties, tenants, rooms… or type a command"
              value={query}
              onChange={(e) => { setQuery(e.target.value); setActiveIdx(0) }}
              className="flex-1 bg-transparent text-sm text-slate-800 placeholder-slate-300 outline-none"
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setResults(null); inputRef.current?.focus() }}
                className="text-xs text-slate-300 hover:text-slate-600 transition-colors px-1"
              >
                Clear
              </button>
            )}
            <kbd className="hidden sm:inline-flex h-5 items-center rounded border border-slate-200 bg-slate-50 px-1.5 text-[10px] font-medium text-slate-400">
              ESC
            </kbd>
          </div>

          {/* Results list */}
          <div ref={listRef} className="max-h-[60vh] overflow-y-auto overscroll-contain py-2">
            {noResults ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <SlidersHorizontal size={20} className="text-slate-200" />
                <p className="text-sm text-slate-400">No results for <span className="font-medium text-slate-700">"{query}"</span></p>
              </div>
            ) : (
              grouped.map(({ section, items: rows }) => (
                <div key={section}>
                  <SectionHeader label={section} />
                  {rows.map(({ item, idx }) => (
                    <ResultRow
                      key={item.id ?? item.path}
                      item={item}
                      isActive={activeIdx === idx}
                      onHover={() => setActiveIdx(idx)}
                      onSelect={() => handleSelect(item)}
                    />
                  ))}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-4 py-2.5 flex items-center gap-4 text-[10px] text-slate-400 border-t border-slate-100">
            <span className="flex items-center gap-1.5">
              <kbd className="rounded bg-slate-100 px-1 py-0.5 font-medium text-slate-600">↑↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded bg-slate-100 px-1 py-0.5 font-medium text-slate-600">↵</kbd>
              select
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="rounded bg-slate-100 px-1 py-0.5 font-medium text-slate-600">⌘K</kbd>
              toggle
            </span>
            {hasResults && (
              <span className="ml-auto">{totalResults} result{totalResults !== 1 ? 's' : ''}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default CommandPalette
