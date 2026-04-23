import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Search, ChevronRight, Building2, Users, ChevronDown, ShieldCheck } from 'lucide-react'
import Badge   from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import { getOwners, toggleOwner } from '../api/owners'

const PLAN_STYLES = {
  standard:   { label: 'Standard',   color: '#64748b', bg: '#f1f5f9' },
  pro:        { label: 'Pro',        color: '#3b82f6', bg: '#eff6ff' },
  elite:      { label: 'Elite',      color: '#8b5cf6', bg: '#f5f3ff' },
  enterprise: { label: 'Enterprise', color: '#10b981', bg: '#ecfdf5' },
}

const PlanBadge = ({ plan }) => {
  const s = PLAN_STYLES[plan] ?? PLAN_STYLES.standard
  return (
    <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
      style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  )
}

const STATUS_OPTIONS = [
  { value: 'all',      label: 'All'      },
  { value: 'active',   label: 'Active'   },
  { value: 'inactive', label: 'Inactive' },
]

const SORT_OPTIONS = [
  { value: 'newest',    label: 'Newest first'  },
  { value: 'oldest',    label: 'Oldest first'  },
  { value: 'name_asc',  label: 'Name A → Z'    },
  { value: 'name_desc', label: 'Name Z → A'    },
]

export default function Owners() {
  const [data,        setData]        = useState({ owners: [], total: 0, page: 1, pages: 1 })
  const [search,      setSearch]      = useState('')
  const [status,      setStatus]      = useState('all')
  const [sort,        setSort]        = useState('newest')
  const [page,        setPage]        = useState(1)
  const [loading,     setLoading]     = useState(true)
  const [confirmOwner, setConfirmOwner] = useState(null)
  const [activating,   setActivating]  = useState(false)

  const reset = () => setPage(1)

  const handleActivateConfirm = async () => {
    if (!confirmOwner) return
    setActivating(true)
    try {
      await toggleOwner(confirmOwner._id, true)
      setConfirmOwner(null)
      load()
    } catch {}
    setActivating(false)
  }

  const load = useCallback(() => {
    setLoading(true)
    getOwners({ search, status, sort, page, limit: 20 })
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [search, status, sort, page])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-4">

      {/* ── Toolbar ── */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); reset() }}
            placeholder="Search by name or email…"
            className="w-full bg-white border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-sm outline-none focus:border-[#45a793] transition-colors"
          />
        </div>

        {/* Status filter */}
        <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden">
          {STATUS_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => { setStatus(o.value); reset() }}
              className={`px-3.5 py-2 text-xs font-semibold transition-colors ${
                status === o.value
                  ? 'bg-[#45a793] text-white'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="relative">
          <select
            value={sort}
            onChange={e => { setSort(e.target.value); reset() }}
            className="appearance-none bg-white border border-slate-200 rounded-xl pl-3.5 pr-8 py-2.5 text-xs font-medium text-slate-600 outline-none focus:border-[#45a793] transition-colors cursor-pointer"
          >
            {SORT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {/* Result count */}
        {!loading && (
          <p className="text-xs text-slate-400 ml-auto">
            {data.total} owner{data.total !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48"><Spinner size={28} /></div>
        ) : data.owners.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
            <Users size={28} />
            <p className="text-sm">No owners found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Owner</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden sm:table-cell">Plan</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">Properties</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden lg:table-cell">Tenants</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden sm:table-cell">Joined</th>
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.owners.map(owner => (
                <tr key={owner._id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex items-center justify-center w-8 h-8 rounded-full text-xs font-bold text-white shrink-0"
                        style={{ background: 'linear-gradient(135deg,#45a793,#60c3ad)' }}
                      >
                        {owner.name?.[0]?.toUpperCase() || 'U'}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800 leading-none">{owner.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{owner.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 hidden sm:table-cell">
                    <PlanBadge plan={owner.plan ?? 'standard'} />
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell">
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <Building2 size={13} /><span>{owner.propertyCount ?? 0}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 hidden lg:table-cell">
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <Users size={13} /><span>{owner.tenantCount ?? 0}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge variant={owner.isActive ? 'active' : 'inactive'}>
                      {owner.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-400 hidden sm:table-cell">
                    {new Date(owner.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center justify-end gap-2">
                      {!owner.isActive && (
                        <button
                          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirmOwner(owner) }}
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-emerald-200 text-emerald-700 bg-white hover:bg-emerald-50 transition-colors"
                        >
                          <ShieldCheck size={11} />
                          Activate
                        </button>
                      )}
                      <Link
                        to={`/owners/${owner._id}`}
                        className="text-slate-400 hover:text-slate-700 transition-colors"
                      >
                        <ChevronRight size={16} />
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Activate confirmation modal ── */}
      {confirmOwner && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
        >
          <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-xl p-6 space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3.5">
              <ShieldCheck size={18} className="text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-700">Activate account?</p>
                <p className="text-xs text-emerald-600/80 mt-1 leading-relaxed">
                  <span className="font-bold">{confirmOwner.name}</span>'s account and all their properties will be activated and they will be able to log in.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmOwner(null)}
                disabled={activating}
                className="flex-1 rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleActivateConfirm}
                disabled={activating}
                className="flex-1 rounded-xl px-4 py-2 text-sm font-semibold text-white bg-emerald-500 hover:bg-emerald-600 transition-colors disabled:opacity-60"
              >
                {activating ? 'Activating…' : 'Yes, activate'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Pagination ── */}
      {data.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{data.total} owners total</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50 transition-colors text-xs"
            >
              Prev
            </button>
            <span className="px-2 text-xs">{page} / {data.pages}</span>
            <button
              onClick={() => setPage(p => Math.min(data.pages, p + 1))}
              disabled={page === data.pages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50 transition-colors text-xs"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
