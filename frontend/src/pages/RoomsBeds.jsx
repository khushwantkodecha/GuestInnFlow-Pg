import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, BedDouble, Home, Users, Search, X,
  MoreVertical, Pencil, Trash2, Power, RotateCcw,
  Snowflake, Bath, StickyNote, Crown, FileText, SlidersHorizontal,
  UserPlus, CalendarClock, LogOut, Phone,
  IndianRupee, Calendar, AlertTriangle, Ban, Unlock,
} from 'lucide-react'
import {
  getRooms, createRoom, updateRoom, deleteRoom, getBeds,
  assignTenant, vacateCheck as vacateCheckApi, vacateBed as vacateBedApi,
  reserveBed as reserveBedApi, cancelReservation as cancelReservationApi,
  blockBed as blockBedApi, unblockBed as unblockBedApi,
} from '../api/rooms'
import { getTenants, getTenant, createTenant as createTenantApi } from '../api/tenants'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'
import Drawer from '../components/ui/Drawer'
import PhoneInput from '../components/ui/PhoneInput'
import { TenantProfile } from './Tenants'

// ── Status theme ──────────────────────────────────────────────────────────────
const BED_STATUS = {
  vacant:   { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  occupied: { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-700',     dot: 'bg-red-500'    },
  reserved: { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   dot: 'bg-amber-400'  },
  blocked:  { bg: 'bg-slate-100',  border: 'border-slate-200',   text: 'text-slate-500',   dot: 'bg-slate-300'  },
}

// ══════════════════════════════════════════════════════════════════════════════
//  DropdownMenu — 3-dot menu with click-outside close
// ══════════════════════════════════════════════════════════════════════════════
const DropdownMenu = ({ items }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}
        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all duration-150 active:scale-90"
        aria-label="Room menu"
      >
        <MoreVertical size={15} />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1.5 z-30 w-[180px] rounded-xl bg-white border border-slate-200/80 py-1 animate-scaleIn"
          style={{ boxShadow: '0 10px 30px rgba(0,0,0,.10), 0 2px 8px rgba(0,0,0,.05)' }}>
          {items.map(({ label, icon: Icon, onClick, danger, disabled, tooltip }) => (
            <div key={label}>
              {danger && <div className="my-1 border-t border-slate-100" />}
              <button
                type="button"
                disabled={disabled}
                onClick={(e) => { e.stopPropagation(); if (!disabled) { setOpen(false); onClick?.() } }}
                className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-[13px] font-medium transition-colors duration-100
                  ${disabled
                    ? 'text-slate-300 cursor-not-allowed'
                    : danger
                      ? 'text-red-600 hover:bg-red-50'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                  }`}
              >
                {Icon && <Icon size={14} className={disabled ? 'text-slate-300' : danger ? 'text-red-400' : 'text-slate-400'} />}
                <span className="flex-1 text-left">{label}</span>
              </button>
              {disabled && tooltip && (
                <p className="px-3.5 -mt-0.5 pb-1.5 text-[10px] text-amber-600 font-medium">⚠ {tooltip}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  BedItem — premium, interactive bed chip
// ══════════════════════════════════════════════════════════════════════════════
const BedItem = ({ bed, onClick, disabled }) => {
  const s = BED_STATUS[bed.status] ?? BED_STATUS.vacant

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onClick?.(bed)}
      className={`
        group relative flex flex-col items-center justify-center gap-0.5
        rounded-xl border min-w-[60px] px-3 py-2.5
        cursor-pointer select-none
        transition-all duration-200 ease-out
        focus:outline-none focus:ring-2 focus:ring-primary-400/40
        ${s.bg} ${s.border}
        ${disabled
          ? 'opacity-40 cursor-not-allowed !shadow-none'
          : 'hover:shadow-lg hover:scale-[1.05] hover:-translate-y-0.5 active:scale-[0.97]'
        }
      `}
    >
      {/* Status dot */}
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} transition-transform duration-200 group-hover:scale-125`} />

      {/* Bed number */}
      <span className={`text-xs font-bold tracking-wide ${s.text} leading-none mt-0.5`}>{bed.bedNumber}</span>

      {/* Tenant name (occupied only) */}
      {bed.status === 'occupied' && (
        <span className="text-[10px] text-slate-500 truncate w-full text-center leading-tight mt-0.5 font-medium">
          {bed.tenant?.name
            ? bed.tenant.name.split(' ')[0]
            : 'Occupied'}
        </span>
      )}

      {/* Incomplete profile warning dot */}
      {bed.status === 'occupied' && bed.tenant?.profileStatus !== 'complete' && (
        <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-amber-400 border-2 border-white flex items-center justify-center">
          <AlertTriangle size={7} className="text-white" />
        </span>
      )}

      {/* Lead name (reserved only) */}
      {bed.status === 'reserved' && bed.reservation?.name && (
        <span className="text-[10px] text-amber-600 truncate w-full text-center leading-tight mt-0.5 font-medium">
          {bed.reservation.name.split(' ')[0]}
        </span>
      )}

      {/* Blocked label */}
      {bed.status === 'blocked' && (
        <span className="text-[10px] text-slate-400 truncate w-full text-center leading-tight mt-0.5 font-medium">
          Blocked
        </span>
      )}

      {/* Hover glow ring */}
      {!disabled && (
        <span className={`absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none
          ring-1 ${
            bed.status === 'vacant'   ? 'ring-emerald-300' :
            bed.status === 'occupied' ? 'ring-red-300'     :
            bed.status === 'reserved' ? 'ring-amber-300'   :
            'ring-slate-300'
          }`}
        />
      )}
    </button>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  RoomCard — production-level with menu, inactive state, premium polish
// ══════════════════════════════════════════════════════════════════════════════
const RoomCard = ({ room, propertyId, onBedClick, onStatsReady, onEditRoom, onDeleteRoom, onToggleActive, onReactivate }) => {
  const { data, loading, refetch } = useApi(
    () => getBeds(propertyId, room._id),
    [propertyId, room._id]
  )

  const beds            = data?.data ?? []
  const occupied        = beds.filter(b => b.status === 'occupied').length
  const vacant          = beds.filter(b => b.status === 'vacant').length
  const reserved        = beds.filter(b => b.status === 'reserved').length
  const total           = beds.length
  const pct             = total > 0 ? Math.round((occupied / total) * 100) : 0
  const incompleteCount = beds.filter(b => b.status === 'occupied' && b.tenant?.profileStatus === 'incomplete').length

  const isInactive = room.isActive === false || room.status === 'maintenance' || room.status === 'blocked'

  useEffect(() => {
    if (!loading && data) {
      onStatsReady?.(room._id, { occupied, vacant, reserved, total })
    }
  }, [loading, data, occupied, vacant, reserved, total, room._id])

  // Active cards: Edit + Deactivate. Inactive: no dropdown (actions in footer).
  const menuItems = isInactive ? [] : [
    { label: 'Edit Room',       icon: Pencil, onClick: () => onEditRoom?.(room) },
    ...(occupied > 0
      ? [{ label: `Deactivate Room`, icon: Power, disabled: true,
           tooltip: `${occupied} tenant${occupied > 1 ? 's' : ''} assigned` }]
      : [{ label: 'Deactivate Room', icon: Power, onClick: () => onToggleActive?.(room) }]),
  ]

  return (
    <div className={`
      bg-white rounded-2xl border overflow-visible flex flex-col
      transition-all duration-300 ease-out group/card
      ${isInactive
        ? 'border-slate-200/70 opacity-[0.55] grayscale-[20%]'
        : 'border-slate-200 shadow-sm hover:shadow-[0_8px_30px_rgba(0,0,0,.08)] hover:-translate-y-1.5 hover:border-slate-300/80'
      }
    `}>
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2 px-5 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-200 ${
            isInactive ? 'bg-slate-100' : 'bg-primary-50 group-hover/card:bg-primary-100/60'
          }`}>
            <Home size={17} className={`transition-colors duration-200 ${isInactive ? 'text-slate-400' : 'text-primary-500'}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-slate-800 text-base leading-tight tracking-tight">Room {room.roomNumber}</h3>
              {isInactive && (
                <span className="inline-flex items-center rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                  Inactive
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 font-medium">Floor {room.floor ?? 0}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Bed count badge */}
          <span className="flex items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-500 tabular-nums">
            <BedDouble size={12} className="text-slate-400" />
            {total} {total === 1 ? 'Bed' : 'Beds'}
          </span>

          {/* 3-dot menu (only for active rooms) */}
          {!isInactive && <DropdownMenu items={menuItems} />}

          {/* Reactivate button for inactive rooms */}
          {isInactive && (
            <button onClick={() => onReactivate?.(room)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors" title="Reactivate">
              <RotateCcw size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Occupancy summary ─────────────────────────────────────────── */}
      {!loading && total > 0 && (
        <div className="px-5 pt-3 pb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-slate-400 font-medium tracking-wide">
              {total} Beds  •  {occupied} Occupied
            </span>
            <span className={`text-[11px] font-bold tabular-nums ${
              pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-600' : 'text-red-500'
            }`}>{pct}%</span>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-[5px] overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-700 ease-out ${
                pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>

          {incompleteCount > 0 && !isInactive && (
            <div className="flex items-center gap-1.5 mt-2">
              <AlertTriangle size={10} className="text-amber-500 shrink-0" />
              <span className="text-[11px] font-medium text-amber-600">
                {incompleteCount} incomplete profile{incompleteCount > 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Bed grid ──────────────────────────────────────────────────── */}
      <div className="flex-1 px-5 pt-3 pb-4">
        {loading ? (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {Array.from({ length: room.capacity || 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 h-[56px] animate-pulse" />
            ))}
          </div>
        ) : beds.length === 0 ? (
          <p className="text-center text-xs text-slate-300 py-4">No beds added yet</p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
            {beds.map(bed => (
              <BedItem
                key={bed._id}
                bed={bed}
                disabled={isInactive}
                onClick={() => onBedClick(bed, room, refetch)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      {isInactive ? (
        /* Inactive: Reactivate + Delete Forever (Properties pattern) */
        <div className="flex items-center justify-between gap-2 px-5 py-2.5 border-t border-slate-100">
          <button onClick={() => onReactivate?.(room)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200 transition-colors">
            <RotateCcw size={12} /> Reactivate
          </button>
          <button onClick={() => onDeleteRoom?.(room)}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 transition-colors">
            <Trash2 size={12} /> Delete Forever
          </button>
        </div>
      ) : (
        /* Active: legend */
        <div className="flex items-center justify-center gap-6 px-5 py-2.5 border-t border-slate-100/80 bg-gradient-to-b from-slate-50/30 to-slate-50/60">
          {[
            { label: 'Vacant',   dot: 'bg-emerald-500' },
            { label: 'Occupied', dot: 'bg-red-500' },
            { label: 'Reserved', dot: 'bg-amber-400' },
          ].map(({ label, dot }) => (
            <span key={label} className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 tracking-wide">
              <span className={`h-[5px] w-[5px] rounded-full ${dot}`} />
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  StatusBadge — contextual status pill
// ══════════════════════════════════════════════════════════════════════════════
const StatusBadge = ({ status }) => {
  const s = BED_STATUS[status] ?? BED_STATUS.vacant
  return (
    <div className={`inline-flex items-center gap-2.5 px-4 py-2.5 rounded-xl border ${s.bg} ${s.border} transition-colors duration-200`}>
      <span className={`h-2.5 w-2.5 rounded-full ${s.dot} animate-pulse`} />
      <span className={`text-sm font-semibold capitalize ${s.text}`}>{status}</span>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  ActionButton — stylized action button with icon + micro-interactions
// ══════════════════════════════════════════════════════════════════════════════
const ActionButton = ({ icon: Icon, label, onClick, disabled, variant = 'secondary', loading }) => {
  const variants = {
    primary:      'bg-primary-600 text-white hover:bg-primary-700 hover:shadow-md hover:shadow-primary-200/50 border-primary-600',
    secondary:    'bg-white text-slate-700 hover:bg-slate-50 hover:shadow-sm border-slate-200 hover:border-slate-300',
    danger:       'bg-red-600 text-white hover:bg-red-700 hover:shadow-md hover:shadow-red-200/50 border-red-600',
    'danger-light': 'bg-red-50 text-red-600 hover:bg-red-100 hover:shadow-sm border-red-200 hover:border-red-300',
    warning:      'bg-amber-500 text-white hover:bg-amber-600 hover:shadow-md hover:shadow-amber-200/50 border-amber-500',
    success:      'bg-emerald-600 text-white hover:bg-emerald-700 hover:shadow-md hover:shadow-emerald-200/50 border-emerald-600',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      className={`flex items-center justify-center gap-2.5 w-full rounded-xl border px-4 py-2.5 text-sm font-semibold
        transition-all duration-150 ease-out
        hover:shadow-md
        active:scale-[0.95] active:shadow-none
        disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none disabled:active:scale-100
        ${variants[variant]}`}
    >
      {Icon && <Icon size={15} className={loading ? 'animate-spin' : 'transition-transform duration-150'} />}
      {loading ? 'Processing…' : label}
    </button>
  )
}


// ══════════════════════════════════════════════════════════════════════════════
//  BedActionModal — Smart Bed Control Panel
// ══════════════════════════════════════════════════════════════════════════════
const BedActionModal = ({ bed, room, propertyId, onClose, onSuccess, occupancy, onViewTenant }) => {
  const toast = useToast()
  const [view, setView]               = useState('actions')
  const [submitting, setSubmitting]   = useState(false)

  // Assign state
  const [tenants, setTenants]             = useState([])
  const [tenantsLoading, setTenantsLoading] = useState(false)
  const [tenantSearch, setTenantSearch]   = useState('')
  const [selectedTenantId, setSelectedTenantId] = useState('')
  const [rentOverride, setRentOverride]   = useState('')
  const [moveInDate, setMoveInDate]       = useState(() => new Date().toISOString().split('T')[0])

  // Block state
  const [blockReason, setBlockReason]     = useState('')
  const [blockNotes, setBlockNotes]       = useState('')

  // Vacate state
  const [vacateCheck, setVacateCheck]         = useState(null)   // preflight data
  const [vacateCheckLoading, setVacateCheckLoading] = useState(false)
  const [depositReturned, setDepositReturned] = useState(false)
  const [vacateNotes, setVacateNotes]         = useState('')

  // Reserve state
  const [reservedTill, setReservedTill]   = useState('')
  const [resName, setResName]             = useState('')
  const [resPhone, setResPhone]           = useState('')
  const [resMoveIn, setResMoveIn]         = useState('')
  const [resNotes, setResNotes]           = useState('')

  // New tenant inline form
  const [showNewForm, setShowNewForm]     = useState(false)
  const [newName, setNewName]             = useState('')
  const [newPhone, setNewPhone]           = useState('')
  const [creatingTenant, setCreatingTenant] = useState(false)

  // Fetch vacate preflight when entering the vacate view
  useEffect(() => {
    if (view !== 'vacate') return
    setVacateCheck(null)
    setVacateCheckLoading(true)
    vacateCheckApi(propertyId, room._id, bed._id)
      .then(r => {
        setVacateCheck(r.data?.data ?? null)
        setDepositReturned(r.data?.data?.tenant?.depositReturned ?? false)
      })
      .catch(() => {}) // non-fatal — UI still allows confirm without preflight data
      .finally(() => setVacateCheckLoading(false))
  }, [view])

  useEffect(() => {
    if (view !== 'assign') return
    setTenantsLoading(true)
    getTenants(propertyId)
      .then(r => setTenants((r.data?.data ?? []).filter(t => t.status === 'vacated' && !t.bed)))
      .catch(() => toast('Failed to load tenants', 'error'))
      .finally(() => setTenantsLoading(false))
  }, [view, propertyId])

  const call = async (fn, msg) => {
    setSubmitting(true)
    try {
      await fn()
      toast(msg, 'success')
      onSuccess()
    } catch (err) {
      toast(err.response?.data?.message || 'Something went wrong', 'error')
    } finally {
      setSubmitting(false)
    }
  }

  const filtered = tenants.filter(t =>
    t.name.toLowerCase().includes(tenantSearch.toLowerCase()) ||
    (t.phone ?? '').includes(tenantSearch)
  )

  const baseRent = room.baseRent ?? room.rent ?? 0
  const displayRent = bed.tenant?.rentAmount || bed.rentOverride || baseRent
  const hasCustomRent = bed.rentOverride && bed.rentOverride !== baseRent
  const TITLES = {
    actions:        `Room ${room.roomNumber} • Bed ${bed.bedNumber}`,
    assign:         `Assign Tenant — Bed ${bed.bedNumber}`,
    reserve:        `Reserve — Bed ${bed.bedNumber}`,
    vacate:         `Vacate — Bed ${bed.bedNumber}`,
    confirmBlock:   `Block — Bed ${bed.bedNumber}`,
    confirmUnblock: `Unblock — Bed ${bed.bedNumber}`,
  }

  return (
    <Modal title={TITLES[view]} onClose={onClose} size="sm">

      {/* ── MAIN ACTIONS VIEW ── */}
      {view === 'actions' && (() => {
        const occPct = occupancy?.total > 0
          ? Math.round((occupancy.occupied / occupancy.total) * 100) : 0

        // Status-driven theme for the hero strip
        const heroTheme = {
          vacant:   { strip: 'from-emerald-500 to-teal-500',    avatarBg: 'from-emerald-400 to-teal-500',    bar: 'bg-emerald-400' },
          occupied: { strip: 'from-primary-500 to-primary-600', avatarBg: 'from-primary-400 to-primary-600', bar: 'bg-primary-400' },
          reserved: { strip: 'from-amber-400 to-orange-400',    avatarBg: 'from-amber-400 to-orange-400',    bar: 'bg-amber-400'   },
          blocked:  { strip: 'from-slate-400 to-slate-500',     avatarBg: 'from-slate-400 to-slate-500',     bar: 'bg-slate-400'   },
        }[bed.status] ?? { strip: 'from-slate-400 to-slate-500', avatarBg: 'from-slate-400 to-slate-500', bar: 'bg-slate-400' }

        return (
        <div className="space-y-4">

          {/* ── Hero strip ── */}
          <div className={`relative rounded-2xl overflow-hidden bg-gradient-to-r ${heroTheme.strip} px-5 py-4`}>
            {/* Dot pattern overlay */}
            <div className="absolute inset-0 opacity-[0.08]"
              style={{ backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '18px 18px' }} />
            <div className="relative flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={bed.status} />
                  {occupancy && (
                    <span className="text-[11px] font-semibold text-white/80 tabular-nums">
                      {occupancy.occupied} of {occupancy.total} occupied
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-white/70 mt-2 capitalize">
                  {room.type} · {room.capacity} beds · {room.rentType === 'per_room' ? 'Per Room pricing' : 'Per Bed pricing'}
                </p>
                {occupancy && occupancy.total > 0 && (
                  <div className="mt-2.5">
                    <div className="h-1 w-full rounded-full bg-white/20 overflow-hidden">
                      <div className="h-1 rounded-full bg-white/80 transition-all duration-700"
                        style={{ width: `${occPct}%` }} />
                    </div>
                  </div>
                )}
              </div>
              <div className="h-12 w-12 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center shrink-0">
                <BedDouble size={20} className="text-white" />
              </div>
            </div>
          </div>

          {/* ── Tenant card (occupied) ── */}
          {bed.status === 'occupied' && bed.tenant && (
            <div className="flex items-center gap-3.5 rounded-2xl border border-slate-100 bg-gradient-to-r from-slate-50/80 to-white px-4 py-3.5 shadow-sm">
              <div className={`h-11 w-11 rounded-full bg-gradient-to-br ${heroTheme.avatarBg} flex items-center justify-center shrink-0 shadow-md`}>
                <span className="text-sm font-bold text-white tracking-wide">
                  {(bed.tenant.name ?? '?').slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">{bed.tenant.name}</p>
                {bed.tenant.phone && (
                  <p className="text-xs text-slate-400 mt-0.5 font-medium">{bed.tenant.phone}</p>
                )}
              </div>
              {bed.tenant.checkInDate && (
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-slate-400 mb-0.5">Since</p>
                  <p className="text-xs font-bold text-slate-600">
                    {new Date(bed.tenant.checkInDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Reservation lead card (reserved) ── */}
          {bed.status === 'reserved' && bed.reservation?.name && (() => {
            const daysLeft = bed.reservedTill
              ? Math.max(0, Math.ceil((new Date(bed.reservedTill) - new Date()) / 86400000))
              : null
            return (
              <div className="rounded-2xl border border-amber-100 bg-gradient-to-r from-amber-50/80 to-white px-4 py-3.5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Lead · Reserved</span>
                  {daysLeft !== null && (
                    <span className={`text-[11px] font-bold tabular-nums px-2 py-0.5 rounded-full ${
                      daysLeft <= 1 ? 'bg-red-50 text-red-600 border border-red-200'
                        : daysLeft <= 3 ? 'bg-amber-50 text-amber-700 border border-amber-200'
                        : 'bg-slate-50 text-slate-500 border border-slate-200'
                    }`}>
                      {daysLeft === 0 ? 'Expires today' : `${daysLeft}d left`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3.5">
                  <div className={`h-11 w-11 rounded-full bg-gradient-to-br ${heroTheme.avatarBg} flex items-center justify-center shrink-0 shadow-md`}>
                    <span className="text-sm font-bold text-white">{(bed.reservation.name ?? '?').slice(0, 2).toUpperCase()}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{bed.reservation.name}</p>
                    {bed.reservation.phone && (
                      <p className="text-xs text-slate-400 mt-0.5">{bed.reservation.phone}</p>
                    )}
                  </div>
                  {bed.reservation.moveInDate && (
                    <div className="text-right shrink-0">
                      <p className="text-[10px] text-slate-400 mb-0.5">Move-in</p>
                      <p className="text-xs font-bold text-slate-600">
                        {new Date(bed.reservation.moveInDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })}
                      </p>
                    </div>
                  )}
                </div>
                {bed.reservation.notes && (
                  <p className="text-[11px] text-slate-400 italic leading-relaxed border-t border-amber-100 pt-2.5">
                    {bed.reservation.notes}
                  </p>
                )}
              </div>
            )
          })()}

          {/* ── Blocked info ── */}
          {bed.status === 'blocked' && (bed.blockReason || bed.blockNotes) && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 space-y-1">
              {bed.blockReason && (
                <p className="text-xs text-slate-600">
                  <span className="font-semibold">Reason:</span>{' '}
                  <span className="capitalize">{bed.blockReason}</span>
                </p>
              )}
              {bed.blockNotes && (
                <p className="text-xs text-slate-500 italic leading-relaxed">{bed.blockNotes}</p>
              )}
            </div>
          )}

          {/* ── Rent row ── */}
          <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-primary-50 border border-primary-100 flex items-center justify-center shrink-0">
                <IndianRupee size={12} className="text-primary-500" />
              </div>
              <span className="text-xs font-semibold text-slate-500">Monthly Rent</span>
            </div>
            <div className="text-right">
              <div className="flex items-baseline gap-1">
                <span className="text-base font-extrabold text-slate-800 tabular-nums tracking-tight">
                  ₹{displayRent?.toLocaleString('en-IN')}
                </span>
                <span className="text-xs text-slate-400">/mo</span>
              </div>
              {bed.status === 'occupied' && bed.tenant?.billingSnapshot ? (() => {
                const snap = bed.tenant.billingSnapshot
                return (
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {snap.overrideApplied
                      ? `Override · Base ₹${snap.baseRent?.toLocaleString('en-IN')}`
                      : snap.rentType === 'per_room'
                        ? `÷${snap.divisorUsed} tenants`
                        : 'Per Bed · Fixed'
                    }
                    {snap.isEarlyOccupant && ' · Early occupant'}
                  </p>
                )
              })() : (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {hasCustomRent ? 'Custom override'
                    : room.rentType === 'per_room'
                      ? occupancy ? `÷${occupancy.occupied + 1} estimated` : 'Per Room'
                      : 'Per Bed · Fixed'}
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Actions ── */}
          <div className="flex flex-col gap-2 pb-1">

            {/* VACANT */}
            {bed.status === 'vacant' && (
              <>
                <ActionButton icon={UserPlus}     label="Assign Tenant" variant="primary"      onClick={() => setView('assign')} />
                <ActionButton icon={CalendarClock} label="Reserve Bed"   variant="secondary"    onClick={() => setView('reserve')} />
                <ActionButton icon={Ban}           label="Block Bed"     variant="danger-light" onClick={() => setView('confirmBlock')} />
              </>
            )}

            {/* RESERVED */}
            {bed.status === 'reserved' && (
              <>
                <ActionButton icon={UserPlus} label="Convert to Tenant" variant="primary"
                  onClick={() => {
                    if (bed.reservation?.name)     setNewName(bed.reservation.name)
                    if (bed.reservation?.phone)    setNewPhone(bed.reservation.phone)
                    if (bed.reservation?.moveInDate) setMoveInDate(new Date(bed.reservation.moveInDate).toISOString().split('T')[0])
                    setShowNewForm(true)
                    setView('assign')
                  }} />
                {bed.reservation?.phone && (
                  <ActionButton icon={Phone} label="Chat on WhatsApp" variant="secondary"
                    onClick={() => {
                      const ph  = bed.reservation.phone.replace(/[^0-9]/g, '')
                      const msg = encodeURIComponent(`Hi ${bed.reservation.name}, this is regarding your bed reservation at Room ${room.roomNumber}. Please let us know when you'd like to move in.`)
                      window.open(`https://wa.me/${ph}?text=${msg}`, '_blank')
                    }} />
                )}
                <ActionButton icon={X}   label="Cancel Reservation" variant="danger-light" disabled={submitting} loading={submitting}
                  onClick={() => call(() => cancelReservationApi(propertyId, room._id, bed._id), 'Reservation cancelled')} />
                <ActionButton icon={Ban} label="Block Bed"           variant="danger-light" onClick={() => setView('confirmBlock')} />
              </>
            )}

            {/* OCCUPIED */}
            {bed.status === 'occupied' && (() => {
              const isIncomplete = bed.tenant?.profileStatus !== 'complete'
              const completion   = bed.tenant?.profileCompletion
              return (
                <>
                  {/* Profile incomplete banner */}
                  {isIncomplete && (
                    <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                        <p className="text-xs font-bold text-amber-800">Profile incomplete</p>
                        {completion?.percent != null && (
                          <span className="ml-auto text-[10px] font-bold text-amber-700">{completion.percent}%</span>
                        )}
                      </div>
                      {completion?.missing?.length > 0 && (
                        <p className="text-[11px] text-amber-600 leading-relaxed pl-5">
                          Missing: {completion.missing.join(' · ')}
                        </p>
                      )}
                      {completion?.percent != null && (
                        <div className="h-1 w-full rounded-full bg-amber-200 overflow-hidden">
                          <div className="h-full rounded-full bg-amber-500 transition-all duration-500" style={{ width: `${completion.percent}%` }} />
                        </div>
                      )}
                    </div>
                  )}
                  {isIncomplete
                    ? <ActionButton icon={FileText} label="Complete Profile"  variant="warning"   onClick={() => onViewTenant?.(bed.tenant?._id || bed.tenant)} />
                    : <ActionButton icon={Users}    label="View Tenant"       variant="primary"   onClick={() => onViewTenant?.(bed.tenant?._id || bed.tenant)} />
                  }
                  {bed.tenant?.phone && (
                    <ActionButton icon={Phone} label="WhatsApp Tenant" variant="secondary"
                      onClick={() => window.open(`https://wa.me/${bed.tenant.phone.replace(/[^0-9]/g, '')}`, '_blank')} />
                  )}
                  <ActionButton icon={LogOut} label="Vacate Bed" variant="danger" onClick={() => setView('vacate')} />
                </>
              )
            })()}

            {/* BLOCKED */}
            {bed.status === 'blocked' && (
              <ActionButton icon={Unlock} label="Unblock Bed" variant="success"
                onClick={() => setView('confirmUnblock')} />
            )}
          </div>
        </div>
        )
      })()}

      {/* ── BLOCK CONFIRM ── */}
      {view === 'confirmBlock' && (
        <div className="space-y-4">

          {/* Reserved warning */}
          {bed.status === 'reserved' && (
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 font-medium leading-relaxed">
                This bed has an active reservation. Blocking will <span className="font-bold">cancel the reservation</span> for {bed.reservation?.name || 'the lead'}.
              </p>
            </div>
          )}

          {/* Info message */}
          <div className="flex items-start gap-3 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3.5">
            <Ban size={16} className="text-slate-500 mt-0.5 shrink-0" />
            <p className="text-xs text-slate-600 leading-relaxed">
              This bed will not be available for assignment or reservation.
            </p>
          </div>

          {/* Reason dropdown */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">Reason <span className="text-slate-400 font-normal">(optional)</span></label>
            <select
              className="input text-sm"
              value={blockReason}
              onChange={e => setBlockReason(e.target.value)}
            >
              <option value="">Select reason…</option>
              <option value="maintenance">Maintenance</option>
              <option value="cleaning">Cleaning</option>
              <option value="personal">Personal</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Notes textarea */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-600">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
            <textarea
              className="input text-sm resize-none"
              rows={2}
              placeholder="Add any notes…"
              value={blockNotes}
              onChange={e => setBlockNotes(e.target.value)}
            />
          </div>

          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setView('actions')}>Cancel</button>
            <button
              className="flex-1 rounded-xl border border-slate-300 bg-slate-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 transition-all duration-200 active:scale-[0.96] disabled:opacity-50"
              disabled={submitting}
              onClick={() => call(
                () => blockBedApi(propertyId, room._id, bed._id, { blockReason: blockReason || undefined, blockNotes: blockNotes || undefined }),
                'Bed blocked'
              )}
            >
              {submitting ? 'Blocking…' : 'Block Bed'}
            </button>
          </div>
        </div>
      )}

      {/* ── VACATE CONFIRM ── */}
      {view === 'vacate' && (() => {
        const vc               = vacateCheck
        const pendingCount     = vc?.pendingRentCount ?? 0
        const totalPending     = vc?.totalPendingAmount ?? 0
        const deposit          = vc?.tenant?.depositAmount ?? bed.tenant?.depositAmount ?? 0
        const depositPaid      = vc?.tenant?.depositPaid  ?? bed.tenant?.depositPaid   ?? false
        const tenantName       = bed.tenant?.name ?? 'Tenant'
        const tenantPhone      = bed.tenant?.phone
        const rentAmount       = vc?.tenant?.rentAmount   ?? bed.tenant?.rentAmount    ?? 0

        return (
        <div className="space-y-4">

          {/* ── Tenant identity ── */}
          <div className="flex items-center gap-3.5 rounded-2xl border border-slate-100 bg-gradient-to-r from-slate-50/80 to-white px-4 py-3.5 shadow-sm">
            <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shrink-0 shadow-md">
              <span className="text-sm font-bold text-white tracking-wide">
                {tenantName.slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800">{tenantName}</p>
              {tenantPhone && <p className="text-xs text-slate-400 mt-0.5">{tenantPhone}</p>}
            </div>
            {rentAmount > 0 && (
              <div className="text-right shrink-0">
                <p className="text-[10px] text-slate-400 mb-0.5">Monthly Rent</p>
                <p className="text-sm font-bold text-slate-700">₹{rentAmount.toLocaleString('en-IN')}</p>
              </div>
            )}
          </div>

          {/* ── Pending rent warning ── */}
          {vacateCheckLoading ? (
            <div className="h-10 flex items-center justify-center">
              <Spinner />
            </div>
          ) : pendingCount > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-amber-800">
                  {pendingCount} unpaid rent record{pendingCount > 1 ? 's' : ''}
                </p>
                <p className="text-[11px] text-amber-600 mt-0.5">
                  ₹{totalPending.toLocaleString('en-IN')} outstanding — collect before vacating if needed.
                </p>
              </div>
            </div>
          )}

          {/* ── Deposit row ── */}
          {deposit > 0 && (
            <div className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
              <div>
                <p className="text-xs font-semibold text-slate-700">
                  Deposit: ₹{deposit.toLocaleString('en-IN')}
                  {!depositPaid && <span className="ml-1.5 text-[10px] text-amber-600 font-medium">(not yet paid)</span>}
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">Mark as returned to tenant?</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={depositReturned}
                onClick={() => setDepositReturned(v => !v)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${depositReturned ? 'bg-emerald-500' : 'bg-slate-200'}`}
              >
                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${depositReturned ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
              </button>
            </div>
          )}

          {/* ── Notes ── */}
          <div>
            <label className="label">Notes <span className="text-slate-400 font-normal text-xs">(optional)</span></label>
            <textarea
              className="input resize-none text-sm"
              rows={2}
              placeholder="Reason for vacating, final inspection notes…"
              value={vacateNotes}
              onChange={e => setVacateNotes(e.target.value)}
            />
          </div>

          {/* ── What happens ── */}
          <div className="rounded-xl bg-red-50 border border-red-100 px-3.5 py-3 space-y-1.5">
            {[
              'Tenant status → vacated, check-out date set to today',
              'Bed status → vacant, ready for new assignment',
              'Tenant record is preserved — data is never deleted',
            ].map(item => (
              <div key={item} className="flex items-start gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-red-400 shrink-0" />
                <p className="text-xs text-red-600/80 leading-relaxed">{item}</p>
              </div>
            ))}
          </div>

          {/* ── Buttons ── */}
          <div className="flex gap-2.5 pt-1">
            <button className="btn-secondary flex-1" onClick={() => setView('actions')}>
              Cancel
            </button>
            <button
              className="flex-1 rounded-xl bg-red-500 border border-red-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 transition-all duration-200 active:scale-[0.96] disabled:opacity-50 flex items-center justify-center gap-2"
              disabled={submitting}
              onClick={() => call(
                () => vacateBedApi(propertyId, room._id, bed._id, {
                  depositReturned,
                  ...(vacateNotes.trim() && { notes: vacateNotes.trim() }),
                }),
                'Bed vacated'
              )}
            >
              <LogOut size={14} />
              {submitting ? 'Vacating…' : 'Confirm Vacate'}
            </button>
          </div>
        </div>
        )
      })()}

      {/* ── UNBLOCK CONFIRM ── */}
      {view === 'confirmUnblock' && (
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3.5">
            <Unlock size={16} className="text-emerald-600 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-bold text-emerald-800">Unblock Bed {bed.bedNumber}?</p>
              <p className="text-xs text-emerald-700/80 mt-1 leading-relaxed">
                The bed will be set back to vacant and available for assignment.
              </p>
            </div>
          </div>
          {(bed.blockReason || bed.blockNotes) && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-3 space-y-1">
              {bed.blockReason && (
                <p className="text-xs text-slate-600">
                  <span className="font-semibold">Reason:</span>{' '}
                  <span className="capitalize">{bed.blockReason}</span>
                </p>
              )}
              {bed.blockNotes && (
                <p className="text-xs text-slate-500 italic">{bed.blockNotes}</p>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn-secondary flex-1" onClick={() => setView('actions')}>Cancel</button>
            <button
              className="flex-1 rounded-xl border border-emerald-200 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 transition-all duration-200 active:scale-[0.96] disabled:opacity-50"
              disabled={submitting}
              onClick={() => call(() => unblockBedApi(propertyId, room._id, bed._id), 'Bed unblocked')}
            >
              {submitting ? 'Unblocking…' : 'Confirm Unblock'}
            </button>
          </div>
        </div>
      )}

      {/* ── ASSIGN ── */}
      {view === 'assign' && (
        <div className="space-y-5">

          {/* Context subtitle */}
          <div className="flex items-center gap-2 text-xs text-slate-400 font-medium">
            <Home size={12} />
            <span>Room {room.roomNumber} • Bed {bed.bedNumber}</span>
          </div>

          {/* ── Section: Select Tenant ── */}
          <div className="space-y-2.5">
            <SectionHeader icon={Users} title="Select Tenant" />

            {!showNewForm ? (
              <>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input className="input pl-8 text-sm" placeholder="Search by name or phone…"
                    value={tenantSearch} onChange={e => setTenantSearch(e.target.value)} autoFocus />
                </div>

                <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {tenantsLoading ? (
                    <div className="flex justify-center py-4"><Spinner /></div>
                  ) : filtered.length === 0 ? (
                    <p className="text-center text-xs text-slate-400 py-4">No available tenants</p>
                  ) : filtered.map(t => (
                    <button key={t._id} type="button"
                      className={`w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-all duration-150 flex items-center gap-3 ${
                        selectedTenantId === t._id ? 'bg-primary-50 border-l-2 border-primary-500' : ''
                      }`}
                      onClick={() => { setSelectedTenantId(t._id); setShowNewForm(false) }}>
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-50 text-primary-600 font-bold text-xs shrink-0">
                        {t.name?.charAt(0)?.toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-800 truncate">{t.name}</p>
                        <p className="text-xs text-slate-400">{t.phone}</p>
                      </div>
                      {selectedTenantId === t._id && (
                        <span className="ml-auto text-primary-500 text-xs font-semibold">Selected</span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Add New Tenant trigger */}
                <button
                  type="button"
                  onClick={() => { setShowNewForm(true); setSelectedTenantId('') }}
                  className="flex items-center gap-2 w-full rounded-xl border border-dashed border-slate-300 px-3.5 py-2.5
                    text-sm font-medium text-slate-500 hover:border-primary-400 hover:text-primary-600 hover:bg-primary-50/50
                    transition-all duration-150 active:scale-[0.98]"
                >
                  <Plus size={14} />
                  Add New Tenant
                </button>
              </>
            ) : (
              /* Inline New Tenant Form */
              <div className="space-y-2.5 rounded-xl border border-primary-200 bg-primary-50/30 p-3.5">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-primary-700">New Tenant</p>
                  <button type="button" onClick={() => { setShowNewForm(false); setNewName(''); setNewPhone('') }}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Cancel</button>
                </div>
                <div className="space-y-2.5">
                  <div>
                    <label className="label text-xs">Name *</label>
                    <input className="input text-sm" placeholder="Full name"
                      value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
                  </div>
                  <div>
                    <label className="label text-xs">Phone *</label>
                    <PhoneInput value={newPhone} onChange={setNewPhone} placeholder="Mobile number" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Section: Rent Calculation ── */}
          <div className="space-y-2.5">
            <SectionHeader icon={IndianRupee} title="Rent Calculation" />

            {/* Rent type + base info */}
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Room Rent</span>
                <span className="text-sm font-bold text-slate-700 tabular-nums">₹{baseRent.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Rent Type</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  room.rentType === 'per_room'
                    ? 'bg-blue-50 text-blue-600 border border-blue-200'
                    : 'bg-slate-100 text-slate-600 border border-slate-200'
                }`}>
                  {room.rentType === 'per_room' ? 'Per Room' : 'Per Bed'}
                </span>
              </div>
              {room.rentType === 'per_room' && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wider">Capacity</span>
                  <span className="text-xs font-medium text-slate-600">{room.capacity} beds</span>
                </div>
              )}
            </div>

            {/* Per-room explanation */}
            {room.rentType === 'per_room' && !rentOverride && (
              <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2">
                <AlertTriangle size={13} className="text-blue-500 mt-0.5 shrink-0" />
                <p className="text-[11px] text-blue-700 leading-relaxed">
                  Rent will be divided among current occupants at assignment time.
                  Final amount is calculated by the server and <span className="font-semibold">locked permanently</span>.
                </p>
              </div>
            )}

            {/* Override input */}
            <div>
              <label className="label text-xs">Rent Override (optional)</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">₹</span>
                <input type="number" min="0" className="input text-sm py-1.5 pl-6 tabular-nums"
                  placeholder={`${baseRent} (default)`}
                  value={rentOverride} onChange={e => setRentOverride(e.target.value)} />
              </div>
              {rentOverride && (
                <p className="mt-1 text-[11px] text-amber-600 font-medium">
                  ⚡ Override active — rentType formula will be bypassed
                </p>
              )}
            </div>
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Section: Move-in Date ── */}
          <div className="space-y-2">
            <SectionHeader icon={Calendar} title="Move-in Date" />
            <input type="date" className="input text-sm py-1.5"
              value={moveInDate} onChange={e => setMoveInDate(e.target.value)} />
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Assign Button ── */}
          <ActionButton
            icon={UserPlus}
            label={submitting || creatingTenant ? 'Assigning…' : 'Assign Tenant'}
            variant="primary"
            disabled={(!selectedTenantId && (!showNewForm || !newName.trim() || !newPhone)) || submitting || creatingTenant}
            loading={submitting || creatingTenant}
            onClick={async () => {
              let tenantId = selectedTenantId

              // If adding new, create first then assign
              if (showNewForm && !selectedTenantId) {
                setCreatingTenant(true)
                try {
                  const res = await createTenantApi(propertyId, {
                    name:        newName.trim(),
                    phone:       newPhone.trim(),
                    rentAmount:  rentOverride ? Number(rentOverride) : baseRent,
                    checkInDate: moveInDate || new Date().toISOString().split('T')[0],
                  })
                  tenantId = res.data?.data?._id
                  if (!tenantId) throw new Error('Failed to create tenant')
                } catch (err) {
                  toast(err.response?.data?.message || 'Failed to create tenant', 'error')
                  setCreatingTenant(false)
                  return
                }
                setCreatingTenant(false)
              }

              call(
                () => assignTenant(propertyId, room._id, bed._id, {
                  tenantId,
                  rentOverride: rentOverride ? Number(rentOverride) : undefined,
                  moveInDate:   moveInDate || undefined,
                }),
                'Tenant assigned successfully'
              )
            }}
          />
        </div>
      )}

      {/* ── RESERVE ── */}
      {view === 'reserve' && (() => {
        const addDays = (d) => {
          const dt = new Date()
          dt.setDate(dt.getDate() + d)
          return dt.toISOString().split('T')[0]
        }
        const quickDays = [
          { label: '1 Day',   val: 1  },
          { label: '3 Days',  val: 3  },
          { label: '7 Days',  val: 7  },
          { label: '14 Days', val: 14 },
        ]
        return (
        <div className="space-y-5">

          {/* Context bar */}
          <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
            <div className="h-8 w-8 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0">
              <CalendarClock size={14} className="text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-700">Room {room.roomNumber} · Bed {bed.bedNumber}</p>
              <p className="text-[11px] text-slate-400 capitalize mt-0.5">{room.type ?? 'Room'} · {room.capacity} beds</p>
            </div>
            <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1">
              Hold
            </span>
          </div>

          {/* ── Lead Info ── */}
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Lead Info</p>
            <div>
              <label className="label">Name *</label>
              <input className="input" placeholder="e.g. Rahul Sharma"
                value={resName} onChange={e => setResName(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="label">Phone *</label>
              <PhoneInput value={resPhone} onChange={setResPhone} />
            </div>
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Duration ── */}
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Duration</p>

            {/* Quick-select chips */}
            <div className="grid grid-cols-4 gap-1.5">
              {quickDays.map(({ label, val }) => (
                <button key={val} type="button"
                  onClick={() => setReservedTill(addDays(val))}
                  className={`rounded-lg border py-2 text-xs font-semibold transition-all duration-150 ${
                    reservedTill === addDays(val)
                      ? 'border-amber-400 bg-amber-50 text-amber-700 shadow-sm'
                      : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                  }`}>
                  {label}
                </button>
              ))}
            </div>

            {/* Date pickers */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Reserve Until *</label>
                <input type="date" className="input"
                  min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                  value={reservedTill} onChange={e => setReservedTill(e.target.value)} />
                <p className="mt-1 text-[11px] text-slate-400">Auto-released after</p>
              </div>
              <div>
                <label className="label">
                  Move-in <span className="text-slate-400 font-normal text-xs">(optional)</span>
                </label>
                <input type="date" className="input"
                  value={resMoveIn} onChange={e => setResMoveIn(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100" />

          {/* Notes */}
          <div>
            <label className="label">
              Notes <span className="text-slate-400 font-normal text-xs">(optional)</span>
            </label>
            <input className="input" placeholder="e.g. Referred by existing tenant"
              value={resNotes} onChange={e => setResNotes(e.target.value)} />
          </div>

          {/* Footer */}
          <div className="flex gap-2 pt-1">
            <button className="btn-secondary flex-1" onClick={() => setView('actions')}>Cancel</button>
            <ActionButton
              icon={CalendarClock}
              label={submitting ? 'Reserving…' : 'Reserve Bed'}
              variant="primary"
              disabled={!reservedTill || !resName.trim() || !resPhone || submitting}
              loading={submitting}
              onClick={() => call(
                () => reserveBedApi(propertyId, room._id, bed._id, {
                  reservedTill,
                  name:  resName.trim(),
                  phone: resPhone.trim(),
                  ...(resMoveIn        && { moveInDate: resMoveIn }),
                  ...(resNotes.trim()  && { notes: resNotes.trim() }),
                }),
                'Bed reserved'
              )}
            />
          </div>
        </div>
        )
      })()}
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  Summary KPI Cards
// ══════════════════════════════════════════════════════════════════════════════
const SummaryCards = ({ stats }) => {
  const pct = stats.beds > 0 ? Math.round((stats.occupied / stats.beds) * 100) : 0
  const cards = [
    { label: 'Total Rooms', value: stats.rooms, icon: Home, iconBg: 'bg-primary-50', iconColor: 'text-primary-500' },
    { label: 'Total Beds',  value: stats.beds,  icon: BedDouble, iconBg: 'bg-slate-50', iconColor: 'text-slate-500' },
    { label: 'Occupied',    value: stats.occupied, icon: Users, iconBg: 'bg-red-50', iconColor: 'text-red-500',
      badge: `${pct}%`, badgeBg: 'bg-red-50 border border-red-200 text-red-700',
      bar: pct, barColor: 'bg-red-500' },
    { label: 'Vacant', value: stats.vacant, icon: BedDouble, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-500',
      bar: stats.beds > 0 ? Math.round((stats.vacant / stats.beds) * 100) : 0, barColor: 'bg-emerald-500' },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ label, value, icon: Icon, iconBg, iconColor, badge, badgeBg, bar, barColor }) => (
        <div key={label} className="card p-4 flex flex-col gap-2.5 transition-all duration-200 hover:shadow-md hover:-translate-y-0.5">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2.5 min-w-0">
              <div className={`shrink-0 rounded-xl p-2 ${iconBg}`}>
                <Icon size={16} className={iconColor} />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-slate-400 truncate uppercase tracking-wider">{label}</p>
                <p className="text-xl font-extrabold text-slate-800 leading-tight tabular-nums">{value ?? 0}</p>
              </div>
            </div>
            {badge && (
              <span className={`shrink-0 text-[11px] font-semibold rounded-full px-2 py-0.5 ${badgeBg}`}>{badge}</span>
            )}
          </div>
          {bar !== undefined && (
            <div className="h-1 w-full rounded-full bg-slate-100">
              <div className={`h-1 rounded-full transition-all duration-700 ${barColor}`}
                style={{ width: `${Math.min(bar, 100)}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  Section Header — visual grouping for form sections
// ══════════════════════════════════════════════════════════════════════════════
const SectionHeader = ({ icon: Icon, title, subtitle }) => (
  <div className="flex items-center gap-2 pb-1">
    {Icon && (
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50">
        <Icon size={14} className="text-primary-500" />
      </div>
    )}
    <div>
      <h4 className="text-[13px] font-bold text-slate-700 tracking-tight">{title}</h4>
      {subtitle && <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
  </div>
)

// ══════════════════════════════════════════════════════════════════════════════
//  SelectableChip — toggle chip for amenities / gender
// ══════════════════════════════════════════════════════════════════════════════
const SelectableChip = ({ label, icon: Icon, active, onClick, color = 'primary' }) => {
  const colors = {
    primary: active
      ? 'bg-primary-50 border-primary-300 text-primary-700 shadow-sm'
      : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50',
    blue: active
      ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-sm'
      : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50',
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-all duration-150 active:scale-[0.97] ${colors[color]}`}
    >
      {Icon && <Icon size={13} className={active ? '' : 'text-slate-400'} />}
      {label}
    </button>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  RoomFormModal — reusable for Add + Edit
// ══════════════════════════════════════════════════════════════════════════════
const RoomFormModal = ({ mode = 'add', initialData, onSubmit, onClose, saving, occupiedBeds = 0 }) => {
  const isEdit = mode === 'edit'
  const rentTypeLocked = isEdit && occupiedBeds > 0

  const [form, setForm] = useState({
    roomNumber:          initialData?.roomNumber ?? '',
    type:                initialData?.type ?? 'single',
    capacity:            String(initialData?.capacity ?? 1),
    floor:               String(initialData?.floor ?? 0),
    baseRent:            initialData?.baseRent != null ? String(initialData.baseRent) : '',
    rentType:            initialData?.rentType ?? 'per_bed',
    gender:              initialData?.gender ?? 'unisex',
    hasAC:               initialData?.hasAC ?? false,
    hasAttachedBathroom: initialData?.hasAttachedBathroom ?? false,
    category:            initialData?.category ?? 'standard',
    notes:               initialData?.notes ?? '',
  })
  const [errors, setErrors] = useState({})

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    if (errors[k]) setErrors(e => ({ ...e, [k]: '' }))
  }

  const toggle = (k) => set(k, !form[k])

  const CAPACITY_DEFAULT = { single: 1, double: 2, triple: 3 }
  const handleTypeChange = (v) => {
    const cap = CAPACITY_DEFAULT[v]
    if (cap !== undefined) {
      // Fixed-capacity type: auto-set
      setForm(f => ({ ...f, type: v, capacity: String(cap) }))
    } else {
      // Dormitory: keep current capacity if editing, default to 4 for new
      setForm(f => ({ ...f, type: v, capacity: f.capacity || String(initialData?.capacity ?? 4) }))
    }
  }

  const validate = () => {
    const errs = {}
    if (!form.roomNumber.trim()) errs.roomNumber = 'Room number is required'
    if (!form.baseRent || Number(form.baseRent) < 0) errs.baseRent = 'Rent is required'
    if (form.type === 'dormitory') {
      const cap = Number(form.capacity)
      if (!form.capacity || isNaN(cap) || cap < 1) errs.capacity = 'Min 1'
    }
    return errs
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    onSubmit({
      roomNumber:          form.roomNumber.trim().toUpperCase(),
      type:                form.type,
      capacity:            Number(form.capacity),
      floor:               Number(form.floor),
      baseRent:            Number(form.baseRent),
      rentType:            form.rentType,
      gender:              form.gender,
      hasAC:               form.hasAC,
      hasAttachedBathroom: form.hasAttachedBathroom,
      category:            form.category,
      notes:               form.notes.trim(),
    })
  }

  const isDorm = form.type === 'dormitory'

  return (
    <Modal
      title={isEdit ? `Edit Room ${initialData?.roomNumber ?? ''}` : 'Add New Room'}
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── Section 1: Basic Info ─────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader icon={Home} title="Basic Information" subtitle="Room identity & layout" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Room Number *</label>
              <input
                className={`input uppercase tracking-wider font-semibold ${errors.roomNumber ? 'border-red-400 focus:ring-red-200' : ''}`}
                placeholder="e.g. 101"
                value={form.roomNumber}
                onChange={e => set('roomNumber', e.target.value)}
                autoFocus
                disabled={isEdit}
              />
              {errors.roomNumber && <p className="mt-1 text-[11px] text-red-500 font-medium">{errors.roomNumber}</p>}
            </div>
            <div>
              <label className="label">Floor</label>
              <input type="number" min="0" className="input" value={form.floor}
                onChange={e => set('floor', e.target.value)} />
            </div>
            <div>
              <label className="label">Room Type</label>
              <select
                className="input"
                value={form.type}
                onChange={e => handleTypeChange(e.target.value)}
              >
                <option value="single">Single</option>
                <option value="double">Double</option>
                <option value="triple">Triple</option>
                <option value="dormitory">Dormitory</option>
              </select>
            </div>
            <div>
              <label className="label">Capacity {isDorm ? '*' : '(auto)'}</label>
              <input type="number" min="1" max="20"
                className={`input ${
                  !isDorm ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''
                } ${errors.capacity ? 'border-red-400' : ''}`}
                value={form.capacity}
                onChange={e => isDorm && set('capacity', e.target.value)}
                readOnly={!isDorm}
              />
              {errors.capacity && <p className="mt-1 text-[11px] text-red-500 font-medium">{errors.capacity}</p>}
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100" />

        {/* ── Section 2: Rent Details ───────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader icon={FileText} title="Rent Details" subtitle="Pricing & billing" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Base Rent (₹) *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm font-medium pointer-events-none">₹</span>
                <input type="number" min="0"
                  className={`input pl-7 tabular-nums ${errors.baseRent ? 'border-red-400 focus:ring-red-200' : ''}`}
                  placeholder="8000"
                  value={form.baseRent}
                  onChange={e => set('baseRent', e.target.value)}
                />
              </div>
              {errors.baseRent && <p className="mt-1 text-[11px] text-red-500 font-medium">{errors.baseRent}</p>}
            </div>
            <div>
              <label className="label">Rent Type</label>
              <select
                className={`input ${rentTypeLocked ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`}
                value={form.rentType}
                onChange={e => !rentTypeLocked && set('rentType', e.target.value)}
                disabled={rentTypeLocked}
              >
                <option value="per_bed">Per Bed</option>
                <option value="per_room">Per Room</option>
              </select>
              {rentTypeLocked && (
                <p className="mt-1.5 text-[11px] text-amber-600 font-medium leading-relaxed">
                  ⚠ Cannot change rent type while {occupiedBeds} tenant{occupiedBeds > 1 ? 's are' : ' is'} assigned. Vacate all tenants first.
                </p>
              )}
            </div>
            <div className="col-span-2">
              <label className="label">Category</label>
              <div className="flex gap-2">
                {[
                  { value: 'standard', label: 'Standard',  icon: Home },
                  { value: 'premium',  label: 'Premium',   icon: Crown },
                  { value: 'luxury',   label: 'Luxury',    icon: Crown },
                ].map(opt => (
                  <SelectableChip
                    key={opt.value}
                    label={opt.label}
                    icon={opt.icon}
                    active={form.category === opt.value}
                    onClick={() => set('category', opt.value)}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100" />

        {/* ── Section 3: Amenities ─────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader icon={Snowflake} title="Amenities" subtitle="Room features" />
          <div className="flex flex-wrap gap-2">
            <SelectableChip
              label="AC"
              icon={Snowflake}
              active={form.hasAC}
              onClick={() => toggle('hasAC')}
              color="blue"
            />
            <SelectableChip
              label="Attached Bath"
              icon={Bath}
              active={form.hasAttachedBathroom}
              onClick={() => toggle('hasAttachedBathroom')}
              color="blue"
            />
          </div>
        </div>

        <div className="border-t border-slate-100" />

        {/* ── Section 4: Additional Info ───────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader icon={StickyNote} title="Additional Info" subtitle="Gender & notes" />

          {/* Gender chips */}
          <div>
            <label className="label">Gender Type</label>
            <div className="flex gap-2">
              {[
                { value: 'male',   label: 'Male' },
                { value: 'female', label: 'Female' },
                { value: 'unisex', label: 'Unisex' },
              ].map(opt => (
                <SelectableChip
                  key={opt.value}
                  label={opt.label}
                  active={form.gender === opt.value}
                  onClick={() => set('gender', opt.value)}
                />
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="label">Notes (optional)</label>
            <textarea
              className="input min-h-[72px] resize-none text-sm"
              placeholder="Any special notes about this room…"
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
              rows={3}
            />
          </div>
        </div>

        {/* ── Actions ──────────────────────────────────────────────── */}
        <div className="flex gap-2 pt-2 border-t border-slate-100">
          <button type="button" className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn-primary flex-1" disabled={saving}>
            {saving
              ? (isEdit ? 'Saving…' : 'Adding…')
              : (isEdit ? 'Save Changes' : 'Add Room')
            }
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  FiltersBar
// ══════════════════════════════════════════════════════════════════════════════
const FILTER_DEFAULTS = {
  search: '', status: 'all', occupancy: 'all',
  type: 'all', gender: 'all', amenities: [], sortBy: 'default', floor: 'all',
}

const SELECT_CLS =
  'rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 ' +
  'focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-400 cursor-pointer ' +
  'transition-colors hover:border-slate-300'

const FiltersBar = ({ filters, floors, onSearchChange, onFilterChange, onReset, hasActiveFilters, showFilters, onToggleFilters }) => {
  const toggleAmenity = (key) => {
    const cur = filters.amenities
    onFilterChange('amenities', cur.includes(key) ? cur.filter(a => a !== key) : [...cur, key])
  }

  const nonSearchActive = filters.status !== 'all' || filters.occupancy !== 'all' ||
    filters.type !== 'all' || filters.gender !== 'all' || filters.amenities.length > 0 ||
    filters.sortBy !== 'default' || filters.floor !== 'all'

  return (
    <div className="space-y-2">
      {/* Search row — always visible */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            className="input pl-7 py-1.5 text-sm w-full"
            placeholder="Search rooms…"
            value={filters.search}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>

        {/* Mobile filter toggle */}
        <button
          onClick={onToggleFilters}
          className={`sm:hidden relative flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-medium transition-colors shrink-0 ${
            showFilters ? 'border-primary-300 bg-primary-50 text-primary-600' : 'border-slate-200 bg-white text-slate-500'
          }`}
        >
          <SlidersHorizontal size={13} />
          Filters
          {nonSearchActive && (
            <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary-500 ring-2 ring-white" />
          )}
        </button>
      </div>

      {/* Mobile filter modal (bottom sheet) */}
      {showFilters && createPortal(
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
          onClick={onToggleFilters}>
          <div className="w-full bg-white rounded-t-2xl overflow-y-auto max-h-[85vh]"
            onClick={e => e.stopPropagation()}>
            {/* Handle + header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={15} className="text-primary-500" />
                <span className="text-sm font-semibold text-slate-800">Filters</span>
              </div>
              <button onClick={onToggleFilters} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="p-4 space-y-4">
              {/* Status + Occupancy */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Status</p>
                  <div className="flex flex-col gap-1.5">
                    {[['all','All'],['available','Available'],['maintenance','Maintenance'],['blocked','Blocked']].map(([v,l]) => (
                      <button key={v} onClick={() => onFilterChange('status', v)}
                        className={`rounded-xl px-3 py-2 text-xs font-medium text-left border transition-colors ${
                          filters.status === v ? 'bg-primary-50 border-primary-300 text-primary-600' : 'bg-slate-50 border-slate-200 text-slate-500'
                        }`}>{l}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Occupancy</p>
                  <div className="flex flex-col gap-1.5">
                    {[['all','All'],['vacant','Vacant'],['partial','Partial'],['full','Full']].map(([v,l]) => (
                      <button key={v} onClick={() => onFilterChange('occupancy', v)}
                        className={`rounded-xl px-3 py-2 text-xs font-medium text-left border transition-colors ${
                          filters.occupancy === v ? 'bg-primary-50 border-primary-300 text-primary-600' : 'bg-slate-50 border-slate-200 text-slate-500'
                        }`}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Floor */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Floor</p>
                <div className="flex flex-wrap gap-1.5">
                  {[{ val: 'all', label: 'All' }, ...floors.map(f => ({ val: String(f), label: `Floor ${f}` }))].map(({ val, label }) => (
                    <button key={val} onClick={() => onFilterChange('floor', val)}
                      className={`rounded-xl px-3 py-2 text-xs font-medium border transition-colors ${
                        filters.floor === val ? 'bg-primary-50 border-primary-300 text-primary-600' : 'bg-slate-50 border-slate-200 text-slate-500'
                      }`}>{label}</button>
                  ))}
                </div>
              </div>

              {/* Type */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Room Type</p>
                <div className="grid grid-cols-5 gap-1.5">
                  {[{val:'all',label:'All'},{val:'single',label:'Single'},{val:'double',label:'Double'},{val:'triple',label:'Triple'},{val:'dormitory',label:'Dorm'}].map(({ val, label }) => (
                    <button key={val} onClick={() => onFilterChange('type', val)}
                      className={`rounded-xl py-2 text-[10px] font-medium text-center border transition-colors ${
                        filters.type === val ? 'bg-primary-50 border-primary-300 text-primary-600' : 'bg-slate-50 border-slate-200 text-slate-500'
                      }`}>{label}</button>
                  ))}
                </div>
              </div>

              {/* Gender */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Gender</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {[{val:'all',label:'All'},{val:'male',label:'Male'},{val:'female',label:'Female'},{val:'unisex',label:'Unisex'}].map(({ val, label }) => (
                    <button key={val} onClick={() => onFilterChange('gender', val)}
                      className={`rounded-xl py-2 text-xs font-medium text-center border transition-colors ${
                        filters.gender === val ? 'bg-primary-50 border-primary-300 text-primary-600' : 'bg-slate-50 border-slate-200 text-slate-500'
                      }`}>{label}</button>
                  ))}
                </div>
              </div>

              {/* Amenities + Sort */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Amenities</p>
                  <div className="flex flex-col gap-1.5">
                    {[{key:'ac',label:'AC',icon:Snowflake},{key:'bath',label:'Attached Bath',icon:Bath}].map(({ key, label, icon: Icon }) => (
                      <button key={key} onClick={() => toggleAmenity(key)}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium border transition-colors ${
                          filters.amenities.includes(key) ? 'bg-primary-50 border-primary-300 text-primary-600' : 'bg-slate-50 border-slate-200 text-slate-500'
                        }`}><Icon size={12} />{label}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">Sort By</p>
                  <div className="flex flex-col gap-1.5">
                    {[['default','Default'],['rent_asc','Rent ↑'],['rent_desc','Rent ↓'],['occ_desc','Occupancy ↓']].map(([v,l]) => (
                      <button key={v} onClick={() => onFilterChange('sortBy', v)}
                        className={`rounded-xl px-3 py-2 text-xs font-medium text-left border transition-colors ${
                          filters.sortBy === v ? 'bg-primary-50 border-primary-300 text-primary-600' : 'bg-slate-50 border-slate-200 text-slate-500'
                        }`}>{l}</button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1 pb-2">
                {hasActiveFilters && (
                  <button onClick={() => { onReset(); onToggleFilters() }}
                    className="flex-1 rounded-xl border border-slate-200 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-50 transition-colors">
                    Reset
                  </button>
                )}
                <button onClick={onToggleFilters}
                  className="flex-1 rounded-xl bg-primary-500 hover:bg-primary-600 py-2.5 text-sm font-semibold text-white transition-colors">
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Desktop filter rows — always visible on sm+ */}
      <div className="hidden sm:block bg-white border border-slate-200 rounded-xl p-3 space-y-2.5">
        {/* Row 1: dropdowns + reset */}
        <div className="flex flex-wrap items-center gap-2">
          <select value={filters.status} onChange={e => onFilterChange('status', e.target.value)} className={SELECT_CLS}>
            <option value="all">All Status</option>
            <option value="available">Available</option>
            <option value="maintenance">Maintenance</option>
            <option value="blocked">Blocked</option>
          </select>
          <select value={filters.occupancy} onChange={e => onFilterChange('occupancy', e.target.value)} className={SELECT_CLS}>
            <option value="all">All Occupancy</option>
            <option value="vacant">Vacant</option>
            <option value="partial">Partially Occupied</option>
            <option value="full">Fully Occupied</option>
          </select>
          <select value={filters.floor} onChange={e => onFilterChange('floor', e.target.value)} className={SELECT_CLS}>
            <option value="all">All Floors</option>
            {floors.map(f => (
              <option key={f} value={String(f)}>Floor {f}</option>
            ))}
          </select>
          <select value={filters.sortBy} onChange={e => onFilterChange('sortBy', e.target.value)} className={SELECT_CLS}>
            <option value="default">Sort: Default</option>
            <option value="rent_asc">Rent: Low → High</option>
            <option value="rent_desc">Rent: High → Low</option>
            <option value="occ_desc">Occupancy: High → Low</option>
          </select>
          {hasActiveFilters && (
            <button onClick={onReset}
              className="ml-auto flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-red-50 hover:border-red-200 hover:text-red-500 transition-colors">
              <X size={12} /> Reset filters
            </button>
          )}
        </div>
        {/* Row 2: Type + Gender + Amenities chips */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-400 font-medium shrink-0">Type:</span>
          {[{val:'all',label:'All'},{val:'single',label:'Single'},{val:'double',label:'Double'},{val:'triple',label:'Triple'},{val:'dormitory',label:'Dormitory'}].map(({ val, label }) => (
            <SelectableChip key={val} label={label} active={filters.type === val} onClick={() => onFilterChange('type', val)} />
          ))}
          <span className="h-4 w-px bg-slate-200 mx-1 shrink-0" />
          <span className="text-xs text-slate-400 font-medium shrink-0">Gender:</span>
          {[{val:'all',label:'All'},{val:'male',label:'Male'},{val:'female',label:'Female'},{val:'unisex',label:'Unisex'}].map(({ val, label }) => (
            <SelectableChip key={val} label={label} active={filters.gender === val} onClick={() => onFilterChange('gender', val)} />
          ))}
          <span className="h-4 w-px bg-slate-200 mx-1 shrink-0" />
          <SelectableChip label="AC" icon={Snowflake} active={filters.amenities.includes('ac')} onClick={() => toggleAmenity('ac')} />
          <SelectableChip label="Attached Bath" icon={Bath} active={filters.amenities.includes('bath')} onClick={() => toggleAmenity('bath')} />
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  Main Page
// ══════════════════════════════════════════════════════════════════════════════
const RoomsBeds = () => {
  const { selectedProperty } = useProperty()
  const propertyId = selectedProperty?._id ?? ''
  const toast = useToast()

  const [showAddRoom,    setShowAddRoom]    = useState(false)
  const [editRoom,       setEditRoom]       = useState(null)
  const [confirmDelete,  setConfirmDelete]  = useState(null)
  const [saving,         setSaving]         = useState(false)
  const [filters,        setFilters]        = useState(FILTER_DEFAULTS)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchDebounceRef = useRef(null)
  const [showFilters,    setShowFilters]    = useState(false)
  const [bedStats,       setBedStats]       = useState({})
  const [modalBed,       setModalBed]       = useState(null)
  const [viewTenant,     setViewTenant]     = useState(null)

  const { data: roomData, loading: roomLoading, refetch: refetchRooms } = useApi(
    () => propertyId ? getRooms(propertyId) : Promise.resolve({ data: null }),
    [propertyId]
  )

  const rooms = roomData?.data ?? []

  const handleSearchChange = useCallback((val) => {
    setFilters(f => ({ ...f, search: val }))
    clearTimeout(searchDebounceRef.current)
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(val), 300)
  }, [])

  const handleFilterChange = useCallback((key, val) => {
    setFilters(f => ({ ...f, [key]: val }))
  }, [])

  const handleResetFilters = useCallback(() => {
    setFilters(FILTER_DEFAULTS)
    setDebouncedSearch('')
    clearTimeout(searchDebounceRef.current)
  }, [])

  const hasActiveFilters = useMemo(() =>
    filters.search !== '' ||
    filters.status !== 'all' ||
    filters.occupancy !== 'all' ||
    filters.type !== 'all' ||
    filters.gender !== 'all' ||
    filters.amenities.length > 0 ||
    filters.sortBy !== 'default' ||
    filters.floor !== 'all'
  , [filters])

  const filteredRooms = useMemo(() => {
    let list = [...rooms]

    // Search (debounced)
    const q = debouncedSearch.trim().toLowerCase()
    if (q) {
      list = list.filter(r =>
        r.roomNumber.toLowerCase().includes(q) ||
        `floor ${r.floor}`.includes(q)
      )
    }

    // Floor
    if (filters.floor !== 'all') {
      list = list.filter(r => String(r.floor ?? 0) === filters.floor)
    }

    // Status
    if (filters.status !== 'all') {
      list = list.filter(r => r.status === filters.status)
    }

    // Type
    if (filters.type !== 'all') {
      list = list.filter(r => r.type === filters.type)
    }

    // Gender
    if (filters.gender !== 'all') {
      list = list.filter(r => r.gender === filters.gender)
    }

    // Amenities
    if (filters.amenities.includes('ac'))   list = list.filter(r => r.hasAC)
    if (filters.amenities.includes('bath')) list = list.filter(r => r.hasAttachedBathroom)

    // Occupancy (uses bedStats — may be empty on first render, filter gracefully)
    if (filters.occupancy !== 'all') {
      list = list.filter(r => {
        const s = bedStats[r._id]
        if (!s || s.total === 0) return filters.occupancy === 'vacant'
        const active = s.occupied + s.reserved
        if (filters.occupancy === 'vacant')  return active === 0
        if (filters.occupancy === 'partial') return active > 0 && s.occupied < s.total
        if (filters.occupancy === 'full')    return s.occupied === s.total
        return true
      })
    }

    // Sort
    if (filters.sortBy === 'rent_asc')  list.sort((a, b) => a.baseRent - b.baseRent)
    if (filters.sortBy === 'rent_desc') list.sort((a, b) => b.baseRent - a.baseRent)
    if (filters.sortBy === 'occ_desc') {
      list.sort((a, b) => {
        const aR = bedStats[a._id]?.total ? bedStats[a._id].occupied / bedStats[a._id].total : 0
        const bR = bedStats[b._id]?.total ? bedStats[b._id].occupied / bedStats[b._id].total : 0
        return bR - aR
      })
    }

    return list
  }, [rooms, debouncedSearch, filters, bedStats])

  const summaryStats = useMemo(() => {
    const all = Object.values(bedStats)
    return {
      rooms:    rooms.length,
      beds:     all.reduce((s, b) => s + b.total, 0),
      occupied: all.reduce((s, b) => s + b.occupied, 0),
      vacant:   all.reduce((s, b) => s + b.vacant, 0),
      reserved: all.reduce((s, b) => s + b.reserved, 0),
    }
  }, [bedStats, rooms.length])

  const handleStatsReady = useCallback((roomId, stats) => {
    setBedStats(prev => {
      const cur = prev[roomId]
      if (cur && cur.occupied === stats.occupied && cur.vacant === stats.vacant &&
          cur.reserved === stats.reserved && cur.total === stats.total) return prev
      return { ...prev, [roomId]: stats }
    })
  }, [])

  const handleBedClick = (bed, room, refetch) => {
    setModalBed({ bed, room, refetch })
  }

  const handleAddRoom = async (form) => {
    setSaving(true)
    try {
      await createRoom(propertyId, form)
      setShowAddRoom(false)
      refetchRooms()
      toast(`Room ${form.roomNumber} added`, 'success')
    } catch (err) {
      toast(err.response?.data?.message || 'Error adding room', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ── 3-dot menu handlers ─────────────────────────────────────────────────
  const handleEditRoom = (room) => {
    console.log('[RoomMenu] Edit Room:', room.roomNumber, room._id)
    setEditRoom(room)
  }

  const handleSaveEdit = async (formData) => {
    if (!editRoom) return
    setSaving(true)
    try {
      await updateRoom(propertyId, editRoom._id, formData)
      setEditRoom(null)
      refetchRooms()
      toast(`Room ${formData.roomNumber} updated`, 'success')
    } catch (err) {
      toast(err.response?.data?.message || 'Error updating room', 'error')
    } finally {
      setSaving(false)
    }
  }

  // Deactivate: show confirmation modal first (Properties pattern)
  const [confirmDeactivate, setConfirmDeactivate] = useState(null)

  const handleToggleActive = (room) => {
    console.log('[RoomMenu] Deactivate Room:', room.roomNumber, room._id)
    setConfirmDeactivate(room)
  }

  const confirmDeactivateAction = async () => {
    if (!confirmDeactivate) return
    try {
      await updateRoom(propertyId, confirmDeactivate._id, { isActive: false })
      setConfirmDeactivate(null)
      refetchRooms()
      toast(`Room ${confirmDeactivate.roomNumber} deactivated`, 'info')
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to deactivate room', 'error')
    }
  }

  // Reactivate: direct API call (Properties pattern)
  const handleReactivateRoom = async (room) => {
    console.log('[RoomMenu] Reactivate Room:', room.roomNumber, room._id)
    try {
      await updateRoom(propertyId, room._id, { isActive: true })
      refetchRooms()
      toast(`Room ${room.roomNumber} reactivated`, 'success')
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to reactivate room', 'error')
    }
  }

  // Delete Forever: show confirmation (only from inactive state)
  const handleDeleteRoom = (room) => {
    console.log('[RoomMenu] Delete Forever:', room.roomNumber, room._id)
    setConfirmDelete(room)
  }

  const confirmDeleteAction = async () => {
    if (!confirmDelete) return
    console.log('[RoomMenu] Confirm Delete:', confirmDelete.roomNumber)
    try {
      await deleteRoom(propertyId, confirmDelete._id)
      setConfirmDelete(null)
      refetchRooms()
      toast(`Room ${confirmDelete.roomNumber} permanently deleted`, 'info')
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to delete room', 'error')
    }
  }

  return (
    <div className="space-y-5 max-w-7xl animate-pageIn">

      {/* Toolbar */}
      {propertyId && (
        <div className="space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-semibold text-slate-800">{selectedProperty.name}</h2>
              <p className="text-sm text-slate-400">
                {filteredRooms.length} room{rooms.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {/* Legend */}
              <div className="hidden sm:flex items-center gap-3">
                {[
                  { dot: 'bg-emerald-500', label: 'Vacant' },
                  { dot: 'bg-red-500',     label: 'Occupied' },
                  { dot: 'bg-amber-400',   label: 'Reserved' },
                ].map(({ dot, label }) => (
                  <span key={label} className="flex items-center gap-1.5 text-xs text-slate-500">
                    <span className={`h-2 w-2 rounded-full ${dot}`} />{label}
                  </span>
                ))}
              </div>
              <button className="btn-primary" onClick={() => setShowAddRoom(true)}>
                <Plus size={16} /> Add Room
              </button>
            </div>
          </div>

          {/* Summary KPIs */}
          {rooms.length > 0 && Object.keys(bedStats).length > 0 && (
            <div className="hidden sm:block">
              <SummaryCards stats={summaryStats} />
            </div>
          )}

          {/* Filters */}
          {rooms.length > 0 && (
            <FiltersBar
              filters={filters}
              floors={[...new Set(rooms.map(r => r.floor ?? 0))].sort((a, b) => a - b)}
              onSearchChange={handleSearchChange}
              onFilterChange={handleFilterChange}
              onReset={handleResetFilters}
              hasActiveFilters={hasActiveFilters}
              showFilters={showFilters}
              onToggleFilters={() => setShowFilters(v => !v)}
            />
          )}
        </div>
      )}

      {/* Content */}
      {!propertyId ? (
        <div className="card"><EmptyState message="No property selected. Choose one from the sidebar." /></div>
      ) : roomLoading ? (
        <Spinner />
      ) : rooms.length === 0 ? (
        <div className="card py-16">
          <div className="flex flex-col items-center text-center gap-4 max-w-sm mx-auto">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 border border-primary-100">
              <BedDouble size={28} className="text-primary-500" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-slate-800 mb-1">No rooms added yet</h3>
              <p className="text-sm text-slate-500">Add your first room to start managing beds and tenants.</p>
            </div>
            <button className="btn-primary" onClick={() => setShowAddRoom(true)}>
              <Plus size={16} /> Add Your First Room
            </button>
          </div>
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="card py-10 text-center">
          <p className="text-sm text-slate-500 font-medium mb-2">No rooms match your filters</p>
          <button className="text-xs text-primary-600 hover:underline" onClick={handleResetFilters}>
            Reset filters
          </button>
        </div>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filteredRooms.map(r => (
            <RoomCard
              key={r._id}
              room={r}
              propertyId={propertyId}
              onBedClick={handleBedClick}
              onStatsReady={handleStatsReady}
              onEditRoom={handleEditRoom}
              onDeleteRoom={handleDeleteRoom}
              onToggleActive={handleToggleActive}
              onReactivate={handleReactivateRoom}
            />
          ))}
        </div>
      )}

      {/* Add Room Modal */}
      {showAddRoom && (
        <RoomFormModal
          mode="add"
          onSubmit={handleAddRoom}
          onClose={() => setShowAddRoom(false)}
          saving={saving}
        />
      )}

      {/* Edit Room Modal */}
      {editRoom && (
        <RoomFormModal
          mode="edit"
          initialData={editRoom}
          onSubmit={handleSaveEdit}
          onClose={() => setEditRoom(null)}
          saving={saving}
          occupiedBeds={bedStats[editRoom._id]?.occupied ?? 0}
        />
      )}

      {/* Bed Action Modal */}
      {modalBed && (
        <BedActionModal
          bed={modalBed.bed}
          room={modalBed.room}
          propertyId={propertyId}
          occupancy={bedStats[modalBed.room._id] ?? null}
          onClose={() => setModalBed(null)}
          onSuccess={() => {
            setModalBed(null)
            modalBed.refetch()
          }}
          onViewTenant={async (id) => {
            try {
              const res = await getTenant(propertyId, id)
              setViewTenant(res.data?.data ?? null)
            } catch {
              setViewTenant(null)
            }
          }}
        />
      )}

      {/* Deactivate Confirmation Modal (Properties pattern) */}
      {confirmDeactivate && (() => {
        const occCount = bedStats[confirmDeactivate._id]?.occupied ?? 0
        return (
        <Modal title="Deactivate Room" onClose={() => setConfirmDeactivate(null)} size="sm">
          <div className="space-y-4">
            {occCount > 0 ? (
              <div className="flex items-start gap-3 rounded-xl bg-amber-50 border border-amber-200 px-4 py-3.5">
                <AlertTriangle size={18} className="text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">Room {confirmDeactivate.roomNumber}</p>
                  <p className="text-xs text-amber-700 mt-1 leading-relaxed font-medium">
                    Cannot deactivate — {occCount} tenant{occCount > 1 ? 's are' : ' is'} currently assigned.
                    Vacate all tenants first.
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3.5">
                <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">Room {confirmDeactivate.roomNumber}</p>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    This room will be hidden from assignments and grayed out. You can reactivate it anytime.
                  </p>
                </div>
              </div>
            )}
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setConfirmDeactivate(null)}>Cancel</button>
              {occCount === 0 && (
                <button className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm"
                  onClick={confirmDeactivateAction}>
                  <Trash2 size={14} /> Deactivate
                </button>
              )}
            </div>
          </div>
        </Modal>
        )
      })()}

      {/* Delete Forever Confirmation Modal */}
      {confirmDelete && (
        <Modal title="Permanently Delete Room" onClose={() => setConfirmDelete(null)} size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3.5">
              <Trash2 size={18} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-bold text-red-700">
                  This action is irreversible
                </p>
                <p className="text-xs text-red-600/80 mt-1 leading-relaxed">
                  Permanently deleting <span className="font-semibold">Room {confirmDelete.roomNumber}</span> will also remove all its beds. Tenant history and rent records are kept.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm"
                onClick={confirmDeleteAction}>
                <Trash2 size={14} /> Delete Forever
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Tenant Profile Drawer */}
      {viewTenant && (
        <Drawer
          title="Tenant Profile"
          subtitle={viewTenant.checkInDate ? `Since ${new Date(viewTenant.checkInDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}` : undefined}
          onClose={() => setViewTenant(null)}
        >
          <TenantProfile
            tenant={viewTenant}
            propertyId={propertyId}
            onVacate={() => setViewTenant(null)}
            onDepositToggle={() => {}}
            onRefetch={() => getTenant(propertyId, viewTenant._id).then(r => setViewTenant(r.data?.data ?? viewTenant)).catch(() => {})}
          />
        </Drawer>
      )}

    </div>
  )
}

export default RoomsBeds

