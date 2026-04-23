import { useEffect, useState, useCallback } from 'react'
import { Search, Building2, BedDouble, Users, ChevronDown } from 'lucide-react'
import Badge   from '../components/ui/Badge'
import Spinner from '../components/ui/Spinner'
import { getAllProperties } from '../api/properties'

const STATUS_OPTIONS = [
  { value: 'all',      label: 'All'      },
  { value: 'active',   label: 'Active'   },
  { value: 'inactive', label: 'Inactive' },
]

const TYPE_OPTIONS = [
  { value: 'all',    label: 'All types' },
  { value: 'pg',     label: 'PG'        },
  { value: 'hostel', label: 'Hostel'    },
]

const SORT_OPTIONS = [
  { value: 'newest',    label: 'Newest first' },
  { value: 'oldest',    label: 'Oldest first' },
  { value: 'name_asc',  label: 'Name A → Z'   },
  { value: 'name_desc', label: 'Name Z → A'   },
]

export default function Properties() {
  const [data,    setData]    = useState({ properties: [], total: 0, page: 1, pages: 1 })
  const [search,  setSearch]  = useState('')
  const [status,  setStatus]  = useState('all')
  const [type,    setType]    = useState('all')
  const [sort,    setSort]    = useState('newest')
  const [page,    setPage]    = useState(1)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')

  const reset = () => setPage(1)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    getAllProperties({ search, status, type, sort, page, limit: 20 })
      .then(setData)
      .catch(err => setError(err.response?.data?.message || 'Failed to load properties'))
      .finally(() => setLoading(false))
  }, [search, status, type, sort, page])

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
            placeholder="Search by name or owner…"
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

        {/* Type filter */}
        <div className="flex items-center bg-white border border-slate-200 rounded-xl overflow-hidden">
          {TYPE_OPTIONS.map(o => (
            <button
              key={o.value}
              onClick={() => { setType(o.value); reset() }}
              className={`px-3.5 py-2 text-xs font-semibold transition-colors ${
                type === o.value
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
            {data.total} propert{data.total !== 1 ? 'ies' : 'y'}
          </p>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* ── Table ── */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48"><Spinner size={28} /></div>
        ) : data.properties.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-400 gap-2">
            <Building2 size={28} />
            <p className="text-sm">No properties found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Property</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden md:table-cell">Owner</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden sm:table-cell">Type</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Beds</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider hidden lg:table-cell">Tenants</th>
                <th className="text-left px-5 py-3.5 text-xs font-semibold text-slate-400 uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.properties.map(p => (
                <tr key={p._id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-500 shrink-0">
                        <Building2 size={14} />
                      </div>
                      <div>
                        <p className="font-semibold text-slate-800 leading-none">{p.name}</p>
                        <p className="text-xs text-slate-400 mt-0.5 truncate max-w-[180px]">
                          {[p.address?.city, p.address?.state].filter(Boolean).join(', ') || '—'}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell">
                    <p className="text-slate-700 font-medium">{p.owner?.name}</p>
                    <p className="text-xs text-slate-400">{p.owner?.email}</p>
                  </td>
                  <td className="px-5 py-3.5 hidden sm:table-cell">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 bg-slate-100 px-2 py-0.5 rounded">
                      {p.type}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <BedDouble size={13} /><span>{p.bedCount ?? 0}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 hidden lg:table-cell">
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <Users size={13} /><span>{p.tenantCount ?? 0}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <Badge variant={p.isActive ? 'active' : 'inactive'}>
                      {p.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ── */}
      {data.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{data.total} properties total</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50 transition-colors text-xs"
            >Prev</button>
            <span className="px-2 text-xs">{page} / {data.pages}</span>
            <button
              onClick={() => setPage(p => Math.min(data.pages, p + 1))} disabled={page === data.pages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50 transition-colors text-xs"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  )
}
