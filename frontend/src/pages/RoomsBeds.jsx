import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, BedDouble, Home, Users, Search, X,
  MoreVertical, Pencil, Trash2, Power, RotateCcw,
  Snowflake, Bath, StickyNote, Crown, FileText, SlidersHorizontal, Sparkles,
  UserPlus, CalendarClock, LogOut, Phone,
  IndianRupee, Calendar, AlertTriangle, Ban, Unlock,
  Lock, ArrowRightLeft, CheckCircle2,
} from 'lucide-react'
import {
  getRooms, createRoom, updateRoom, deleteRoom, getBeds,
  assignTenant, vacateCheck as vacateCheckApi, vacateBed as vacateBedApi,
  reserveBed as reserveBedApi, cancelReservation as cancelReservationApi,
  blockBed as blockBedApi, unblockBed as unblockBedApi,
  changeBed as changeBedApi, moveReservation as moveReservationApi,
  deleteBed as deleteBedApi, createExtraBed,
  rentPreview as rentPreviewApi, getRoomActivity,
  midStayDepositAdjust as midStayDepositAdjustApi,
} from '../api/rooms'
import { getTenants, getTenant, searchTenants as searchTenantsApi, createTenant as createTenantApi } from '../api/tenants'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'
import Drawer from '../components/ui/Drawer'
import PhoneInput from '../components/ui/PhoneInput'
import { TenantProfile } from './Tenants'
import { calculateRent, MIN_RENT } from '../utils/calculateRent'

// ── Status theme ──────────────────────────────────────────────────────────────
const BED_STATUS = {
  vacant:   { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  occupied: { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-700',     dot: 'bg-red-500'    },
  reserved: { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-700',   dot: 'bg-amber-400'  },
  blocked:  { bg: 'bg-slate-100',  border: 'border-slate-200',   text: 'text-slate-500',   dot: 'bg-slate-300'  },
}

// ── Rent engine source → human-readable label ─────────────────────────────────
// Maps calculateRent() source tokens to display strings used throughout the UI.
const SOURCE_LABELS = {
  per_bed:        'Fixed per bed',
  per_room_split: 'Split by occupancy',
  override:       'Manual override',
  extra_custom:   'Extra bed custom',
  extra_fallback: 'Extra bed default',
  extra_free:     'Free (non-chargeable)',
}

// ── Debug mode ─────────────────────────────────────────────────────────────────
// When true, shows raw engine source token + meta.divisor in rent preview panels.
// Flip to true during local development to diagnose calculation edge cases.
const DEBUG_RENT = false

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
//  sortBeds — natural numeric ordering: normal beds first, then extra beds
//  Handles: "1","2","10" (numeric), "A","B" (alpha), "X1","X2" (extra)
// ══════════════════════════════════════════════════════════════════════════════
const sortBeds = (a, b) => {
  const numA = String(a.bedNumber ?? '')
  const numB = String(b.bedNumber ?? '')
  const isExtraA = numA.toUpperCase().startsWith('X')
  const isExtraB = numB.toUpperCase().startsWith('X')
  if (isExtraA && !isExtraB) return 1
  if (!isExtraA && isExtraB) return -1
  return numA.localeCompare(numB, undefined, { numeric: true, sensitivity: 'base' })
}

// ══════════════════════════════════════════════════════════════════════════════
//  BedCard — premium interactive bed with hover actions + tooltip
// ══════════════════════════════════════════════════════════════════════════════

const BED_SCHEME = {
  vacant:   { bg: 'bg-emerald-50', border: 'border-emerald-300', dot: 'bg-emerald-500', text: 'text-emerald-700', tag: 'bg-emerald-100 text-emerald-600', actions: 'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-200' },
  occupied: { bg: 'bg-red-50',     border: 'border-red-300',     dot: 'bg-red-500',     text: 'text-red-700',     tag: 'bg-red-100 text-red-600',         actions: 'bg-red-500/10     text-red-700     hover:bg-red-200'     },
  reserved: { bg: 'bg-yellow-50',  border: 'border-yellow-300',  dot: 'bg-yellow-400',  text: 'text-yellow-700',  tag: 'bg-yellow-100 text-yellow-700',   actions: 'bg-yellow-500/10 text-yellow-700 hover:bg-yellow-200' },
  blocked:  { bg: 'bg-slate-100',  border: 'border-slate-200',   dot: 'bg-slate-300',   text: 'text-slate-400',   tag: 'bg-slate-200 text-slate-500',     actions: '' },
  extra:    { bg: 'bg-violet-50',  border: 'border-violet-300',  dot: 'bg-violet-400',  text: 'text-violet-700',  tag: 'bg-violet-100 text-violet-600',   actions: 'bg-violet-500/10 text-violet-700 hover:bg-violet-200' },
}

// Detect touch-only devices once at module level (no hover capability)
const IS_TOUCH_DEVICE = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches

const BedCard = React.memo(function BedCard({ bed, onClick, disabled, isLoading = false, index = 0, compact = false }) {
  const [hovered, setHovered]   = useState(false)
  const [pressed, setPressed]   = useState(false)
  const [ripple,  setRipple]    = useState(false)
  const [nameAnim,  setNameAnim]  = useState(null)  // 'in' | 'out' | null
  const [dotPulse,  setDotPulse]  = useState(false) // pulse on reserved→occupied confirm
  const busyRef      = useRef(false)
  const longPressRef = useRef(null)
  const prevStatusRef = useRef(bed.status)

  // ── State-change animations ──────────────────────────────────────────────────
  useEffect(() => {
    const prev = prevStatusRef.current
    const curr = bed.status
    if (prev === curr) return
    prevStatusRef.current = curr

    if (curr === 'occupied') {
      setNameAnim('in')
      if (prev === 'reserved') setDotPulse(true) // reserved→occupied: confirm pulse
    } else if (prev === 'occupied') {
      setNameAnim('out')                          // vacate: tenant name fades out
    }

    const t = setTimeout(() => { setNameAnim(null); setDotPulse(false) }, 500)
    return () => clearTimeout(t)
  }, [bed.status])

  const isOccupied = bed.status === 'occupied'
  const isVacant   = bed.status === 'vacant'
  const isReserved = bed.status === 'reserved'
  const isBlocked  = bed.status === 'blocked'
  const isExtra    = bed.isExtra

  const scheme = isExtra ? BED_SCHEME.extra : (BED_SCHEME[bed.status] ?? BED_SCHEME.vacant)

  const displayName =
    isOccupied ? (bed.tenant?.name?.split(' ')[0] ?? 'Occupied') :
    isReserved ? (bed.reservation?.name?.split(' ')[0] ?? 'Reserved') :
    isBlocked  ? 'Blocked' : 'Vacant'

  const rent = bed.tenant?.rentAmount ?? 0
  const dues = bed.tenant?.ledgerBalance ?? 0

  const quickActions =
    isVacant   ? ['Assign', 'Reserve'] :
    isOccupied ? ['View', 'Change Room', 'Vacate']    :
    isReserved ? ['Confirm', 'Move Reservation', 'Cancel'] :
    []

  // Debounced fire — passes action label so parent can route to the right modal view
  const fire = (action = null) => {
    if (disabled || busyRef.current) return
    busyRef.current = true
    setRipple(true)
    onClick?.(bed, action)
    setTimeout(() => { busyRef.current = false }, 400)
    setTimeout(() => setRipple(false), 350)
  }

  // Long-press on touch devices — fires generic click after 500 ms hold
  const handleTouchStart = () => {
    if (disabled) return
    longPressRef.current = setTimeout(() => {
      longPressRef.current = null
      fire(null)
    }, 500)
  }
  const handleTouchEnd = () => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current)
      longPressRef.current = null
    }
  }

  // On touch devices quick actions are always visible; on pointer devices they appear on hover
  const showActions = IS_TOUCH_DEVICE || hovered

  return (
    <div
      className="relative"
      onMouseEnter={() => !disabled && setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false) }}
    >
      {/* ── Tooltip (occupied only, above card, pointer devices) ── */}
      {hovered && !IS_TOUCH_DEVICE && isOccupied && bed.tenant?.name && (
        <div className="absolute z-50 bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 pointer-events-none" style={{ minWidth: '130px' }}>
          <div className="bg-slate-800 text-white rounded-xl px-3 py-2 text-[10px] shadow-2xl space-y-0.5">
            <p className="font-bold truncate">{bed.tenant.name}</p>
            {rent > 0 && <p className="text-slate-300">Rent: ₹{rent.toLocaleString('en-IN')}</p>}
            {dues > 0  && <p className="text-red-300">Due: ₹{dues.toLocaleString('en-IN')}</p>}
            {dues < 0  && <p className="text-emerald-300">Adv: ₹{Math.abs(dues).toLocaleString('en-IN')}</p>}
          </div>
          <div className="w-2.5 h-2.5 bg-slate-800 rotate-45 mx-auto -mt-[5px]" />
        </div>
      )}

      {/* ── Card ── */}
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => fire(null)}
        onMouseDown={() => !disabled && setPressed(true)}
        onMouseUp={() => setPressed(false)}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onKeyDown={(e) => e.key === 'Enter' && fire(null)}
        style={{ animationDelay: `${index * 40}ms`, animationFillMode: 'both' }}
        className={[
          'relative flex flex-col rounded-2xl border-2 select-none overflow-hidden',
          'transition-all duration-300 ease-out outline-none',
          'focus-visible:ring-2 focus-visible:ring-primary-400/50',
          'animate-bedIn',
          compact ? 'p-2.5 gap-1.5 min-h-[76px]' : 'p-3 gap-2 min-h-[96px]',
          scheme.bg,
          isExtra ? `border-dashed ${scheme.border}` : scheme.border,
          disabled  ? 'opacity-40 cursor-not-allowed' :
          pressed   ? 'scale-[0.95] shadow-sm cursor-pointer' :
          hovered   ? 'scale-[1.04] shadow-xl -translate-y-0.5 cursor-pointer' :
                      'shadow-sm cursor-pointer',
        ].join(' ')}
      >
        {/* Click ripple overlay */}
        {ripple && (
          <span
            className="absolute inset-0 rounded-2xl pointer-events-none animate-rippleFade"
            style={{ background: 'rgba(255,255,255,0.45)' }}
          />
        )}

        {/* Per-bed loading overlay — shown while network operation is in flight */}
        {isLoading && (
          <div className="absolute inset-0 z-20 flex items-center justify-center rounded-2xl bg-white/60 backdrop-blur-[2px]">
            <svg className="animate-spin h-5 w-5 text-slate-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
          </div>
        )}

        {/* Top-right status dot */}
        <span className={[
          'absolute top-2.5 right-2.5 h-2 w-2 rounded-full transition-colors duration-500',
          scheme.dot,
          isOccupied && !dotPulse ? 'animate-pulse' : '',
          dotPulse ? 'animate-dotPulseConfirm' : '',
        ].join(' ')} />

        {/* Extra bed badge (top-left) */}
        {isExtra && (
          <span className="absolute -top-1 -left-1 h-4 w-4 rounded-full bg-violet-500 border-2 border-white flex items-center justify-center z-10 shadow">
            <span className="text-[6px] font-black text-white leading-none">X</span>
          </span>
        )}

        {/* Incomplete profile dot (top-right, offset from status dot) */}
        {isOccupied && bed.tenant?.profileStatus !== 'complete' && (
          <span className="absolute top-2 right-6 h-3 w-3 rounded-full bg-amber-400 border-2 border-white z-10 flex items-center justify-center">
            <AlertTriangle size={6} className="text-white" />
          </span>
        )}

        {/* Bed label */}
        <span className={`${compact ? 'text-sm' : 'text-base'} font-black tracking-tight leading-none pr-5 ${scheme.text}`}>
          {bed.bedNumber}
        </span>

        {/* Tenant name / status label — animated on state change */}
        <div className="flex-1 flex items-center min-h-0">
          <p className={[
            'truncate leading-snug font-semibold transition-colors duration-300',
            compact ? 'text-[10px]' : 'text-[11px]',
            isOccupied ? 'text-slate-700' :
            isReserved ? 'text-amber-600' :
            isBlocked  ? 'text-slate-400' :
                         'text-emerald-600',
            nameAnim === 'in'  ? 'animate-nameIn'  : '',
            nameAnim === 'out' ? 'animate-nameOut' : '',
          ].join(' ')}>
            {displayName}
          </p>
        </div>

        {/* Status tag (non-compact only) */}
        {!compact && (
          <span className={`self-start rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide ${scheme.tag}`}>
            {isExtra ? 'Extra' : isOccupied ? 'Active' : isReserved ? 'Reserved' : isBlocked ? 'Blocked' : 'Vacant'}
          </span>
        )}

        {/* Quick action buttons — each fires with its own action label */}
        {!disabled && !isBlocked && quickActions.length > 0 && (
          <div className={[
            'absolute inset-x-0 bottom-0 flex gap-1 px-1.5 pb-1.5 pt-3',
            'transition-all duration-200',
            showActions ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none',
          ].join(' ')}
            style={{ background: `linear-gradient(to top, ${isVacant ? '#f0fdf4' : isOccupied ? '#fff1f2' : '#fefce8'} 60%, transparent)` }}
          >
            {quickActions.map(label => (
              <button
                key={label}
                type="button"
                onClick={(e) => { e.stopPropagation(); fire(label) }}
                className={`flex-1 rounded-lg py-1 text-[9px] font-bold bg-white/70 backdrop-blur-sm border border-white/80 transition-all duration-100 active:scale-95 ${scheme.actions}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

// ══════════════════════════════════════════════════════════════════════════════
//  BedGrid — responsive layout + smart state banners
// ══════════════════════════════════════════════════════════════════════════════
const BedGrid = ({ normalBeds = [], extraBeds = [], room, onBedClick, disabled, loading, compact = false, loadingBedId = null }) => {
  const allBeds     = [...normalBeds, ...extraBeds]
  const totalNormal = normalBeds.length
  const allFull     = totalNormal > 0 && normalBeds.every(b => b.status === 'occupied') && extraBeds.every(b => b.status === 'occupied' || b.status === 'reserved')
  const overCap     = totalNormal > (room?.capacity ?? totalNormal)

  const colClass =
    room?.type === 'single'   ? 'grid-cols-1'               :
    room?.type === 'double'   ? 'grid-cols-2'               :
    room?.type === 'triple'   ? 'grid-cols-3'               :
    totalNormal <= 2           ? 'grid-cols-2'               :
    totalNormal <= 4           ? 'grid-cols-2 sm:grid-cols-4':
    totalNormal <= 6           ? 'grid-cols-3'               :
                                  'grid-cols-4'

  if (loading) {
    return (
      <div className={`grid gap-2 ${colClass}`}>
        {Array.from({ length: room?.capacity || 3 }).map((_, i) => (
          <div key={i} className={`rounded-2xl bg-slate-100 animate-pulse ${compact ? 'h-[76px]' : 'h-[96px]'}`}
            style={{ animationDelay: `${i * 60}ms` }} />
        ))}
      </div>
    )
  }

  if (allBeds.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 rounded-2xl border-2 border-dashed border-slate-200 gap-1.5">
        <BedDouble size={20} className="text-slate-300" />
        <p className="text-xs text-slate-400 font-medium">No beds available</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Smart state banners */}
      {allFull && !overCap && (
        <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-100 px-3 py-1.5">
          <span className="h-2 w-2 rounded-full bg-red-400 animate-pulse shrink-0" />
          <span className="text-xs font-semibold text-red-600">Room Full</span>
        </div>
      )}
      {overCap && (
        <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-100 px-3 py-1.5">
          <AlertTriangle size={11} className="text-amber-500 shrink-0" />
          <span className="text-xs font-semibold text-amber-600">Extra beds in use</span>
        </div>
      )}

      {/* Normal beds */}
      <div className={`grid gap-2 ${colClass}`}>
        {normalBeds.map((bed, i) => (
          <BedCard key={bed._id} bed={bed} index={i} disabled={disabled} compact={compact}
            isLoading={loadingBedId === bed._id}
            onClick={onBedClick} />
        ))}
      </div>

      {/* Extra beds — visually separated */}
      {extraBeds.length > 0 && (
        <>
          <div className="flex items-center gap-2 py-0.5">
            <div className="flex-1 h-px bg-violet-100" />
            <span className="text-[10px] text-violet-400 font-semibold tracking-wide uppercase">Extra</span>
            <div className="flex-1 h-px bg-violet-100" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {extraBeds.map((bed, i) => (
              <BedCard key={bed._id} bed={bed} index={normalBeds.length + i} disabled={disabled} compact={compact}
                isLoading={loadingBedId === bed._id}
                onClick={onBedClick} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// CSS injected once — animation keyframe for bed cards
const BED_GRID_STYLES = `
  @keyframes bedIn {
    from { opacity: 0; transform: translateY(10px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0)    scale(1);    }
  }
  .animate-bedIn { animation: bedIn 0.22s cubic-bezier(0.16,1,0.3,1) both; }

  @keyframes rippleFade {
    0%   { opacity: 0.6; transform: scale(0.92); }
    60%  { opacity: 0.15; transform: scale(1);    }
    100% { opacity: 0;    transform: scale(1);    }
  }
  .animate-rippleFade { animation: rippleFade 0.35s ease-out forwards; }

  /* State-change: tenant name fades in (vacant/reserved → occupied) */
  @keyframes nameIn {
    from { opacity: 0; transform: translateX(-6px); }
    to   { opacity: 1; transform: translateX(0);    }
  }
  .animate-nameIn { animation: nameIn 0.3s ease-out both; }

  /* State-change: tenant name fades out (occupied → vacant) */
  @keyframes nameOut {
    from { opacity: 1; transform: translateX(0);   }
    to   { opacity: 0; transform: translateX(6px); }
  }
  .animate-nameOut { animation: nameOut 0.25s ease-in both; }

  /* Tenant mode switch: list ↔ create panel fade+slide */
  @keyframes modeIn {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0);   }
  }
  .animate-modeIn { animation: modeIn 0.18s ease-out both; }

  /* State-change: status dot burst on reserved→occupied confirm */
  @keyframes dotPulseConfirm {
    0%, 100% { transform: scale(1);   opacity: 1;   }
    40%      { transform: scale(2.8); opacity: 0.35; }
    70%      { transform: scale(1.4); opacity: 0.75; }
  }
  .animate-dotPulseConfirm { animation: dotPulseConfirm 0.55s ease-in-out 2; }
`

// ══════════════════════════════════════════════════════════════════════════════
//  RoomCard
// ══════════════════════════════════════════════════════════════════════════════
const RoomCard = ({ room, propertyId, onBedClick, onStatsReady, onEditRoom, onDeleteRoom, onToggleActive, onReactivate, onAddExtraBed, onRoomClick, loadingBedId = null, refreshKey = 0 }) => {
  const { data, loading, refetch } = useApi(
    () => getBeds(propertyId, room._id),
    [propertyId, room._id, refreshKey]
  )

  const beds              = [...(data?.data ?? [])].sort(sortBeds)
  const normalBeds        = beds.filter(b => !b.isExtra)
  const extraBeds         = beds.filter(b => b.isExtra)
  const occupied          = beds.filter(b => b.status === 'occupied').length
  const vacant            = beds.filter(b => b.status === 'vacant').length
  const reserved          = beds.filter(b => b.status === 'reserved').length
  const total             = beds.length
  const normalTotal       = normalBeds.length
  const pct               = normalTotal > 0 ? Math.round((normalBeds.filter(b => b.status === 'occupied').length / normalTotal) * 100) : 0
  const incompleteCount   = beds.filter(b => b.status === 'occupied' && b.tenant?.profileStatus === 'incomplete').length
  const overCapacity      = !loading && normalTotal > room.capacity
  const overBy            = overCapacity ? normalTotal - room.capacity : 0
  const vacantNormalCount = normalBeds.filter(b => b.status === 'vacant').length
  const totalRent         = beds
    .filter(b => b.status === 'occupied')
    .reduce((sum, b) => sum + (b.tenant?.rentAmount ?? 0), 0)

  const isInactive = room.isActive === false || room.status === 'maintenance' || room.status === 'blocked'

  const extraActive = extraBeds.filter(b => b.status === 'occupied' || b.status === 'reserved').length

  useEffect(() => {
    if (!loading && data) {
      onStatsReady?.(room._id, { occupied, vacant, reserved, total, extraActive })
    }
  }, [loading, data, occupied, vacant, reserved, total, extraActive, room._id])

  const menuItems = isInactive ? [] : [
    { label: 'Edit Room',       icon: Pencil, onClick: () => onEditRoom?.(room) },
    ...(occupied > 0
      ? [{ label: 'Deactivate Room', icon: Power, disabled: true,
           tooltip: `${occupied} tenant${occupied > 1 ? 's' : ''} assigned` }]
      : [{ label: 'Deactivate Room', icon: Power, onClick: () => onToggleActive?.(room) }]),
  ]

  const barColor  = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-400'
  const pctColor  = pct >= 80 ? 'text-emerald-600' : pct >= 50 ? 'text-amber-500' : 'text-red-500'
  const roomLabel = [
    room.floor != null ? `Floor ${room.floor}` : null,
    room.type  ? (room.type.charAt(0).toUpperCase() + room.type.slice(1)) : null,
  ].filter(Boolean).join(' · ')

  return (
    <div className={`
      bg-white rounded-2xl border flex flex-col overflow-visible
      transition-all duration-300 ease-out group/card
      ${isInactive
        ? 'border-slate-200 opacity-55 grayscale-[20%]'
        : 'border-slate-200 shadow-sm hover:shadow-[0_8px_32px_rgba(0,0,0,.10)] hover:-translate-y-1'
      }
    `}>

      {/* ── Header ── */}
      <div className="px-4 pt-4 pb-3 border-b border-slate-100">
        <div className="flex items-start justify-between gap-3">

          {/* Left: icon + name + subtitle — click to open Room Details panel */}
          <div
            className={`flex items-center gap-2.5 ${!isInactive ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''}`}
            onClick={() => !isInactive && onRoomClick?.(room)}
            title={!isInactive ? `View Room ${room.roomNumber} details` : undefined}
          >
            <div className={`
              h-9 w-9 shrink-0 rounded-xl flex items-center justify-center
              ${isInactive
                ? 'bg-slate-100'
                : 'bg-gradient-to-br from-primary-50 to-primary-100 shadow-sm shadow-primary-100/60'
              }
            `}>
              <Home size={15} className={isInactive ? 'text-slate-400' : 'text-primary-600'} />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h3 className="text-[15px] font-bold text-slate-800 leading-tight tracking-tight">
                  Room {room.roomNumber}
                </h3>
                {isInactive && (
                  <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400 bg-slate-100 border border-slate-200 rounded-full px-1.5 py-0.5">
                    Inactive
                  </span>
                )}
              </div>
              {roomLabel && (
                <p className="text-[11px] text-slate-400 mt-0.5">{roomLabel}</p>
              )}
            </div>
          </div>

          {/* Right: beds pill + menu */}
          <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
            <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-[5px] text-[11px] font-semibold tabular-nums ${
              overCapacity && !isInactive
                ? 'bg-red-50 border-red-200 text-red-500'
                : 'bg-slate-50 border-slate-200 text-slate-500'
            }`}>
              <BedDouble size={11} className={overCapacity && !isInactive ? 'text-red-400' : 'text-slate-400'} />
              {normalTotal} Bed{normalTotal !== 1 ? 's' : ''}
            </span>
            {!isInactive && <DropdownMenu items={menuItems} />}
            {isInactive && (
              <button onClick={() => onReactivate?.(room)} title="Reactivate"
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors">
                <RotateCcw size={14} />
              </button>
            )}
          </div>
        </div>

        {/* ── Occupancy row ── */}
        {!loading && normalTotal > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500 font-medium">
                {overCapacity
                  ? <span className="text-red-500 font-semibold">{normalBeds.filter(b => b.status === 'occupied').length} of {normalTotal} · Over by +{overBy}</span>
                  : <>Occupancy: <span className={`font-semibold ${pctColor}`}>{pct}%</span> ({normalBeds.filter(b => b.status === 'occupied').length} of {normalTotal})</>
                }
              </span>
              {/* Inline warning + extra chip */}
              <div className="flex items-center gap-1.5">
                {overCapacity && !isInactive && (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-red-500">
                    <AlertTriangle size={9} />⚠ Over capacity
                  </span>
                )}
                {extraBeds.length > 0 && (
                  <span className="flex items-center gap-1 rounded-full bg-violet-50 border border-violet-200 px-2 py-0.5 text-[9px] font-bold text-violet-500">
                    +{extraBeds.length} extra
                  </span>
                )}
              </div>
            </div>
            <div className="w-full h-[5px] rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ease-out ${overCapacity ? 'bg-red-400' : barColor}`}
                style={{ width: `${Math.min(pct, 100)}%` }}
              />
            </div>
            {incompleteCount > 0 && !isInactive && (
              <div className="flex items-center gap-1 pt-0.5">
                <AlertTriangle size={9} className="text-amber-500 shrink-0" />
                <span className="text-[10px] font-medium text-amber-600">
                  {incompleteCount} incomplete profile{incompleteCount > 1 ? 's' : ''}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Bed Grid ── */}
      <div className="flex-1 px-4 pt-3 pb-4 space-y-3">
        <style>{BED_GRID_STYLES}</style>
        <BedGrid
          normalBeds={normalBeds}
          extraBeds={extraBeds}
          room={room}
          disabled={isInactive}
          loading={loading}
          compact
          onBedClick={(bed, action) => onBedClick(bed, room, refetch, action)}
          loadingBedId={loadingBedId}
        />

        {/* Add Extra Bed CTA */}
        {!loading && !isInactive && extraBeds.length < 2 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddExtraBed?.(room, extraBeds.length, vacantNormalCount) }}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-violet-300 bg-violet-50/50 px-3 py-2 text-xs font-semibold text-violet-600 hover:bg-violet-50 hover:border-violet-400 transition-all duration-150 active:scale-[0.98]"
          >
            <Plus size={12} />
            Add Extra Bed
          </button>
        )}
      </div>

      {/* ── Footer ── */}
      {isInactive ? (
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-slate-100">
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
        <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl">
          {loading ? (
            <div className="h-3.5 w-24 rounded-md bg-slate-200 animate-pulse" />
          ) : occupied > 0 ? (
            <span className="flex items-center gap-1 text-xs font-bold text-slate-700">
              <IndianRupee size={11} className="text-primary-500" />
              {totalRent.toLocaleString('en-IN')}/mo
            </span>
          ) : (
            <span className="text-[11px] text-slate-400">No tenants yet</span>
          )}
          <span className="flex items-center gap-1 text-[11px] text-slate-400">
            <Users size={11} />
            {occupied} tenant{occupied !== 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  RoomDetailDrawer — side panel opened by clicking a room card header
// ══════════════════════════════════════════════════════════════════════════════
// Relative time helper (no external lib needed)
const timeAgo = (dateStr) => {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins  = Math.floor(diff / 60000)
  const hrs   = Math.floor(diff / 3600000)
  const days  = Math.floor(diff / 86400000)
  if (mins < 2)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hrs  < 24)  return `${hrs}h ago`
  if (days < 30)  return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

// Activity event → icon + colours
const ACTIVITY_META = {
  check_in:          { icon: UserPlus,       bg: 'bg-emerald-100', text: 'text-emerald-600', label: 'Check-in'   },
  rent_record:       { icon: Calendar,       bg: 'bg-slate-100',   text: 'text-slate-500',   label: 'Rent'       },
  payment:           { icon: CheckCircle2,   bg: 'bg-emerald-100', text: 'text-emerald-600', label: 'Payment'    },
  adjustment:        { icon: AlertTriangle,  bg: 'bg-amber-100',   text: 'text-amber-600',   label: 'Charge'     },
  deposit_collected: { icon: IndianRupee,    bg: 'bg-blue-100',    text: 'text-blue-600',    label: 'Deposit'    },
  deposit_refunded:  { icon: ArrowRightLeft, bg: 'bg-red-100',     text: 'text-red-500',     label: 'Refund'     },
  deposit_adjusted:  { icon: ArrowRightLeft, bg: 'bg-amber-100',   text: 'text-amber-600',   label: 'Adj.'       },
  reservation_paid:     { icon: CalendarClock, bg: 'bg-violet-100',  text: 'text-violet-600',  label: 'Advance'    },
  reservation_advance:  { icon: CalendarClock, bg: 'bg-violet-100',  text: 'text-violet-600',  label: 'Advance'    }, // legacy
  reservation_forfeited:{ icon: Ban,          bg: 'bg-red-100',     text: 'text-red-600',     label: 'Forfeited'  },
  refund:               { icon: ArrowRightLeft, bg: 'bg-red-100',   text: 'text-red-500',     label: 'Refund'     },
}

const RoomDetailDrawer = ({ room, propertyId, onClose, onBedClick, onEditRoom, onAddExtraBed, loadingBedId = null }) => {
  const { data, loading, refetch } = useApi(
    () => getBeds(propertyId, room._id),
    [propertyId, room._id]
  )

  const { data: activityData, loading: activityLoading } = useApi(
    () => getRoomActivity(propertyId, room._id),
    [propertyId, room._id]
  )
  const activityItems = activityData?.data ?? []

  const beds          = [...(data?.data ?? [])].sort(sortBeds)
  const normalBeds    = beds.filter(b => !b.isExtra)
  const extraBeds     = beds.filter(b => b.isExtra)
  const occupied      = beds.filter(b => b.status === 'occupied').length
  const vacant        = beds.filter(b => b.status === 'vacant').length
  const reserved      = beds.filter(b => b.status === 'reserved').length
  const activeTenants = beds.filter(b => b.status === 'occupied' && b.tenant)
  const totalRent     = activeTenants.reduce((sum, b) => sum + (b.tenant?.rentAmount ?? 0), 0)
  const firstVacant   = normalBeds.find(b => b.status === 'vacant')

  const roomTypeLabel = room.type
    ? room.type.charAt(0).toUpperCase() + room.type.slice(1)
    : '—'
  const rentTypeLabel =
    room.rentType === 'per_bed'  ? 'Fixed per bed' :
    room.rentType === 'per_room' ? 'Split by occupancy' : '—'

  const subtitle = [
    room.floor != null ? `Floor ${room.floor}` : null,
    roomTypeLabel !== '—' ? roomTypeLabel : null,
  ].filter(Boolean).join(' · ')

  // ── Status badge logic ────────────────────────────────────────────────────
  const statusBadge = !loading && beds.length > 0
    ? occupied === beds.length
      ? { label: 'Full',    cls: 'bg-red-100 text-red-600 border-red-200',         dot: 'bg-red-500'     }
      : occupied === 0 && reserved === 0
        ? { label: 'Vacant',  cls: 'bg-emerald-100 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' }
        : { label: 'Partial', cls: 'bg-amber-100 text-amber-700 border-amber-200',   dot: 'bg-amber-400'   }
    : null

  const categoryLabel = room.category
    ? room.category.charAt(0).toUpperCase() + room.category.slice(1)
    : '—'

  const configRows = [
    { label: 'Type',          value: roomTypeLabel },
    { label: 'Category',      value: categoryLabel },
    { label: 'Capacity',      value: `${room.capacity} bed${room.capacity !== 1 ? 's' : ''}` },
    { label: 'Rent Type',     value: rentTypeLabel },
    { label: 'Base Rent',     value: room.baseRent ? `₹${room.baseRent.toLocaleString('en-IN')}` : '—' },
    { label: 'Floor',         value: room.floor != null ? `Floor ${room.floor}` : '—' },
    { label: 'Gender',        value: room.gender ? (room.gender.charAt(0).toUpperCase() + room.gender.slice(1)) : '—' },
    ...(room.hasAC !== undefined              ? [{ label: 'Air Conditioning', value: room.hasAC ? 'Yes' : 'No' }] : []),
    ...(room.hasAttachedBathroom !== undefined ? [{ label: 'Attached Bath',   value: room.hasAttachedBathroom ? 'Yes' : 'No' }] : []),
    ...(room.amenities?.length > 0 ? [{ label: 'Amenities', value: room.amenities.join(', ') }] : []),
    ...(room.notes ? [{ label: 'Notes', value: room.notes }] : []),
  ]

  return (
    <Drawer title={`Room ${room.roomNumber}`} subtitle={subtitle} onClose={onClose} width="max-w-xl">

      {/* ── Scrollable body ── */}
      <div className="p-5 space-y-6 pb-4">

        {/* ── Status badge row ── */}
        {statusBadge && (
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${statusBadge.cls}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${statusBadge.dot}`} />
              {statusBadge.label}
            </span>
            {room.gender && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
                {room.gender.charAt(0).toUpperCase() + room.gender.slice(1)}
              </span>
            )}
            {room.hasAC && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-500">
                <Snowflake size={10} /> AC
              </span>
            )}
            {room.hasAttachedBathroom && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-100 bg-cyan-50 px-3 py-1 text-xs font-semibold text-cyan-600">
                <Bath size={10} /> Bath
              </span>
            )}
          </div>
        )}

        {/* ── Occupancy Stats ── */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { count: occupied, label: 'Occupied', bg: 'bg-red-50',     border: 'border-red-100',     text: 'text-red-600',     sub: 'text-red-400'     },
            { count: vacant,   label: 'Vacant',   bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-600', sub: 'text-emerald-400' },
            { count: reserved, label: 'Reserved', bg: 'bg-amber-50',   border: 'border-amber-100',   text: 'text-amber-600',   sub: 'text-amber-400'   },
          ].map(({ count, label, bg, border, text, sub }) => (
            <div key={label} className={`rounded-xl ${bg} border ${border} px-3 py-3 text-center`}>
              {loading
                ? <div className="h-7 w-8 mx-auto rounded-md bg-slate-200/70 animate-pulse mb-1" />
                : <p className={`text-2xl font-bold ${text}`}>{count}</p>
              }
              <p className={`text-[11px] ${sub} font-medium mt-0.5`}>{label}</p>
            </div>
          ))}
        </div>

        {/* ── Bed Layout ── */}
        <div>
          <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Bed Layout</h3>
          <BedGrid
            normalBeds={normalBeds}
            extraBeds={extraBeds}
            room={room}
            loading={loading}
            onBedClick={(bed, action) => onBedClick(bed, room, refetch, action)}
            loadingBedId={loadingBedId}
          />
        </div>

        {/* ── Rent Summary ── always visible ── */}
        {!loading && (
          <div>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Rent Summary</h3>
            <div className="rounded-xl bg-gradient-to-r from-primary-50 to-primary-50/60 border border-primary-100 px-4 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] text-primary-400 font-medium">
                    {occupied > 0 ? 'Current Revenue' : 'No tenants yet'}
                  </p>
                  <p className="text-2xl font-bold text-primary-700 mt-0.5 flex items-center gap-1">
                    <IndianRupee size={16} className="text-primary-500" />
                    {totalRent.toLocaleString('en-IN')}
                    <span className="text-xs font-normal text-primary-400">/mo</span>
                  </p>
                </div>
                {room.baseRent > 0 && (
                  <div className="text-right">
                    <p className="text-[11px] text-primary-400 font-medium">Potential</p>
                    <p className="text-sm font-bold text-primary-500 mt-0.5">
                      ₹{(room.baseRent * room.capacity).toLocaleString('en-IN')}
                    </p>
                    <p className="text-[10px] text-primary-300">at full occupancy</p>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-primary-100/60 pt-2.5">
                <span className="text-[11px] text-primary-400 font-medium">Rent Type</span>
                <span className="text-[11px] text-primary-600 font-semibold">{rentTypeLabel}</span>
              </div>
              {room.baseRent > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-primary-400 font-medium">Base Rent</span>
                  <span className="text-[11px] text-primary-600 font-semibold">
                    ₹{room.baseRent.toLocaleString('en-IN')} / bed
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Active Tenants (with rent + dues) ── */}
        {!loading && activeTenants.length > 0 && (
          <div>
            <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
              Active Tenants ({activeTenants.length})
            </h3>
            <div className="space-y-2">
              {activeTenants.map(bed => {
                const dues    = bed.tenant?.ledgerBalance ?? 0
                const hasDues = dues > 0
                const hasAdv  = dues < 0
                return (
                  <button
                    key={bed._id}
                    type="button"
                    onClick={() => onBedClick(bed, room, refetch, null)}
                    className="w-full flex items-center justify-between gap-3 rounded-xl bg-white border border-slate-200 px-3.5 py-3 hover:border-primary-200 hover:shadow-sm transition-all text-left group"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`h-8 w-8 shrink-0 rounded-full flex items-center justify-center ${hasDues ? 'bg-red-100' : 'bg-primary-100'}`}>
                        <span className={`text-xs font-bold ${hasDues ? 'text-red-600' : 'text-primary-600'}`}>
                          {bed.tenant?.name?.charAt(0)?.toUpperCase() ?? '?'}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate group-hover:text-primary-700 transition-colors">
                          {bed.tenant?.name ?? 'Unknown'}
                        </p>
                        <p className="text-[11px] text-slate-400">
                          Bed {bed.bedNumber}
                          {bed.tenant?.phone ? ` · ${bed.tenant.phone}` : ''}
                        </p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 space-y-0.5">
                      <p className="text-sm font-bold text-slate-700">
                        ₹{(bed.tenant?.rentAmount ?? 0).toLocaleString('en-IN')}
                        <span className="text-[10px] font-normal text-slate-400">/mo</span>
                      </p>
                      {hasDues && (
                        <p className="text-[11px] font-semibold text-red-500">
                          ₹{dues.toLocaleString('en-IN')} dues
                        </p>
                      )}
                      {hasAdv && (
                        <p className="text-[11px] font-semibold text-emerald-600">
                          ₹{Math.abs(dues).toLocaleString('en-IN')} advance
                        </p>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* ── Room Configuration ── */}
        <div>
          <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Room Configuration</h3>
          <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 overflow-hidden">
            {configRows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-xs text-slate-500 font-medium">{label}</span>
                <span className="text-xs text-slate-800 font-semibold text-right max-w-[60%] truncate">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Activity Feed ── */}
        <div>
          <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">Recent Activity</h3>

          {activityLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="h-7 w-7 rounded-full bg-slate-100 animate-pulse shrink-0" />
                  <div className="flex-1 space-y-1.5 pt-0.5">
                    <div className="h-3 w-3/4 rounded bg-slate-100 animate-pulse" />
                    <div className="h-2.5 w-1/3 rounded bg-slate-100 animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          ) : activityItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-6 text-center">
              <p className="text-xs text-slate-400">No recent activity for this room.</p>
            </div>
          ) : (
            <div className="relative">
              {/* Vertical timeline line */}
              <div className="absolute left-3.5 top-3.5 bottom-3.5 w-px bg-slate-100" aria-hidden />

              <div className="space-y-1">
                {activityItems.map((item, idx) => {
                  const meta    = ACTIVITY_META[item.type] ?? ACTIVITY_META.adjustment
                  const Icon    = meta.icon
                  const isDebit = item.entryType === 'debit' || item.type === 'check_in'
                  const showAmt = item.amount != null && item.amount > 0

                  return (
                    <div key={item._id ?? idx} className="flex items-start gap-3 pl-0.5 group">
                      {/* Icon dot */}
                      <div className={`relative z-10 h-7 w-7 shrink-0 rounded-full ${meta.bg} flex items-center justify-center shadow-sm border border-white`}>
                        <Icon size={12} className={meta.text} />
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0 pb-3 border-b border-slate-50 last:border-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-700 truncate leading-snug">
                              {item.tenantName}
                            </p>
                            <p className="text-[11px] text-slate-400 leading-snug mt-0.5 truncate">
                              {item.description}
                              {item.bedNumber ? ` · Bed ${item.bedNumber}` : ''}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            {showAmt && (
                              <p className={`text-xs font-bold ${isDebit ? 'text-red-500' : 'text-emerald-600'}`}>
                                {isDebit ? '+' : '−'}₹{item.amount.toLocaleString('en-IN')}
                              </p>
                            )}
                            <p className="text-[10px] text-slate-300 mt-0.5">{timeAgo(item.timestamp)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* ── Sticky Quick Actions footer ── */}
      <div className="sticky bottom-0 bg-white border-t border-slate-100 px-5 py-4"
        style={{ boxShadow: '0 -4px 16px rgba(0,0,0,0.06)' }}>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2.5">Quick Actions</p>
        <div className="grid grid-cols-2 gap-2">
          {firstVacant ? (
            <>
              <button
                type="button"
                onClick={() => onBedClick(firstVacant, room, refetch, 'Assign')}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-primary-200 bg-primary-50 px-3 py-2.5 text-xs font-semibold text-primary-700 hover:bg-primary-100 transition-colors"
              >
                <UserPlus size={13} /> Assign Tenant
              </button>
              <button
                type="button"
                onClick={() => onBedClick(firstVacant, room, refetch, 'Reserve')}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition-colors"
              >
                <CalendarClock size={13} /> Reserve Bed
              </button>
            </>
          ) : (
            <div className="col-span-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-center">
              <p className="text-[11px] text-slate-400 font-medium">No vacant beds available</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => { onEditRoom(room); onClose() }}
            className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <Pencil size={13} /> Edit Room
          </button>
          {extraBeds.length < 2 && (
            <button
              type="button"
              onClick={() => {
                onAddExtraBed(room, extraBeds.length, normalBeds.filter(b => b.status === 'vacant').length)
                onClose()
              }}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs font-semibold text-violet-700 hover:bg-violet-100 transition-colors"
            >
              <Plus size={13} /> Add Extra Bed
            </button>
          )}
        </div>
      </div>

    </Drawer>
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
//  Shared utilities
// ══════════════════════════════════════════════════════════════════════════════

// Wraps the matching portion of `text` in a <mark> for search highlighting.
const highlightMatch = (text, query) => {
  if (!query || !text) return text
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return text
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-primary-100 text-primary-700 not-italic rounded px-0.5">
        {text.slice(idx, idx + query.length)}
      </mark>
      {text.slice(idx + query.length)}
    </>
  )
}

// Status badge colours
const STATUS_BADGE = {
  active:  'bg-emerald-50 text-emerald-700',
  notice:  'bg-amber-50 text-amber-700',
  vacated: 'bg-slate-100 text-slate-500',
  reserved: 'bg-violet-50 text-violet-700',
}
const STATUS_LABEL = { active: 'Active', notice: 'Notice', vacated: 'Vacated', reserved: 'Reserved' }

// ── TenantSearch ─────────────────────────────────────────────────────────────
// Self-contained API-driven search. Loads recent tenants on mount, then
// switches to debounced backend search once the user types 2+ characters.
// Supports keyboard navigation (↑ ↓ Enter Escape).
const TenantSearch = ({
  propertyId,
  assignable      = false,
  excludeReserved = false,
  reservedBedId   = null,  // pass when confirming a reservation so reserved tenant is visible
  selectedId,
  onSelect,
  onAddNew,
  autoFocus    = false,
}) => {
  const [query,      setQuery]      = useState('')
  const [results,    setResults]    = useState([])
  const [recent,     setRecent]     = useState([])
  const [loading,    setLoading]    = useState(false)
  const [focusedIdx, setFocusedIdx] = useState(-1)
  const debounceRef  = useRef(null)
  const listRef      = useRef(null)
  const inputRef     = useRef(null)

  const baseParams = {
    ...(assignable      && { assignable:      'true' }),
    ...(excludeReserved && { excludeReserved: 'true' }),
    ...(reservedBedId   && { reservedBedId }),
  }

  // Load recent tenants on mount (no query)
  useEffect(() => {
    searchTenantsApi(propertyId, { ...baseParams, limit: 5 })
      .then(r => setRecent(r.data?.data ?? []))
      .catch(() => {})
  }, [propertyId]) // eslint-disable-line

  // Debounced search — triggers at 2+ chars
  useEffect(() => {
    clearTimeout(debounceRef.current)
    if (query.length < 2) { setResults([]); setLoading(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(() => {
      searchTenantsApi(propertyId, { ...baseParams, q: query.trim(), limit: 10 })
        .then(r => setResults(r.data?.data ?? []))
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, propertyId]) // eslint-disable-line

  const isSearching  = query.length >= 2
  const displayList  = isSearching ? results : recent
  const activeList   = displayList.filter(t => t.status === 'active' || t.status === 'notice' || t.status === 'reserved')
  const vacatedList  = displayList.filter(t => t.status === 'vacated')

  // Keyboard navigation
  const handleKeyDown = (e) => {
    const selectable = displayList.filter(t => !t.bed)
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIdx(i => {
        const next = Math.min(i + 1, selectable.length - 1)
        listRef.current?.children[next]?.scrollIntoView({ block: 'nearest' })
        return next
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIdx(i => {
        const prev = Math.max(i - 1, -1)
        if (prev >= 0) listRef.current?.children[prev]?.scrollIntoView({ block: 'nearest' })
        return prev
      })
    } else if (e.key === 'Enter' && focusedIdx >= 0) {
      e.preventDefault()
      const t = selectable[focusedIdx]
      if (t) onSelect(t)
    } else if (e.key === 'Escape') {
      setQuery(''); setFocusedIdx(-1); inputRef.current?.blur()
    }
  }

  const renderItem = (t, idx) => {
    const isSelected  = selectedId === t._id
    const isOccupied  = !!t.bed
    const isFocused   = displayList.filter(x => !x.bed).indexOf(t) === focusedIdx

    return (
      <button key={t._id} type="button"
        disabled={isOccupied}
        onClick={() => !isOccupied && onSelect(t)}
        className={`group w-full text-left rounded-xl border px-3 py-2.5 transition-all duration-150 flex items-center gap-3 ${
          isOccupied
            ? 'bg-slate-50 border-slate-100 opacity-60 cursor-not-allowed'
            : isSelected
              ? 'bg-primary-50 border-primary-300 shadow-sm shadow-primary-100/60'
              : isFocused
                ? 'bg-primary-50/60 border-primary-200 shadow-sm'
                : 'bg-white border-slate-200 hover:border-primary-200 hover:bg-primary-50/30 hover:shadow-sm active:scale-[0.99]'
        }`}>
        {/* Avatar */}
        <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
          isSelected    ? 'bg-primary-600 text-white'
          : isOccupied  ? 'bg-slate-200 text-slate-400'
          : isFocused   ? 'bg-primary-100 text-primary-600'
          : 'bg-slate-100 text-slate-600 group-hover:bg-primary-100 group-hover:text-primary-600'
        }`}>
          {t.name?.charAt(0)?.toUpperCase()}
        </div>
        {/* Info */}
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-semibold truncate ${isSelected ? 'text-primary-800' : isOccupied ? 'text-slate-400' : 'text-slate-800'}`}>
            {highlightMatch(t.name, query)}
          </p>
          <p className={`text-[11px] tabular-nums ${isOccupied ? 'text-slate-300' : 'text-slate-400'}`}>
            {highlightMatch(t.phone ?? '', query)}
          </p>
        </div>
        {/* Right: status + occupied reason or check */}
        <div className="flex flex-col items-end gap-0.5 shrink-0">
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${STATUS_BADGE[t.status] ?? STATUS_BADGE.vacated}`}>
            {STATUS_LABEL[t.status] ?? t.status}
          </span>
          {isOccupied
            ? <span className="text-[9px] text-slate-400 font-medium">Already assigned</span>
            : isSelected
              ? <CheckCircle2 size={13} className="text-primary-500 mt-0.5" />
              : null
          }
        </div>
      </button>
    )
  }

  return (
    <div className="space-y-2">
      {/* Search input */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef}
          className="input pl-8 pr-8 text-sm"
          placeholder="Search by name or phone…"
          value={query}
          onChange={e => { setQuery(e.target.value); setFocusedIdx(-1) }}
          onKeyDown={handleKeyDown}
          autoFocus={autoFocus}
        />
        {loading && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <Spinner />
          </span>
        )}
        {!loading && query && (
          <button type="button" onClick={() => { setQuery(''); setFocusedIdx(-1) }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition-colors">
            <X size={13} />
          </button>
        )}
      </div>

      {/* Results list */}
      {query.length !== 1 && (
        <div ref={listRef} className="max-h-48 overflow-y-auto space-y-1.5 pr-0.5">
          {/* Recent tenants (idle state) */}
          {!isSearching && recent.length > 0 && (
            <>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 px-0.5 pb-0.5">Recent</p>
              {recent.map((t, i) => renderItem(t, i))}
            </>
          )}

          {/* Idle, no recents yet */}
          {!isSearching && recent.length === 0 && (
            <p className="text-center text-[11px] text-slate-400 py-3">
              No recent tenants — search above or create below
            </p>
          )}

          {/* Searching */}
          {isSearching && loading && (
            <div className="flex justify-center py-5"><Spinner /></div>
          )}

          {/* No search results */}
          {isSearching && !loading && displayList.length === 0 && (
            <p className="text-center text-[11px] text-slate-400 py-3">
              No match for "{query}" — create below
            </p>
          )}

          {/* Active + reserved */}
          {isSearching && !loading && activeList.length > 0 && (
            <>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 px-0.5 pb-0.5">Active</p>
              {activeList.map((t, i) => renderItem(t, i))}
            </>
          )}

          {/* Vacated */}
          {isSearching && !loading && vacatedList.length > 0 && (
            <>
              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 px-0.5 pt-1 pb-0.5">Vacated</p>
              {vacatedList.map((t, i) => renderItem(t, i))}
            </>
          )}
        </div>
      )}

      {/* Hint: need one more character */}
      {query.length === 1 && (
        <p className="text-center text-[11px] text-slate-400 py-2">Type one more character to search…</p>
      )}

      {/* Create New Tenant — always visible */}
      {onAddNew && (
        <button type="button" onClick={() => onAddNew(query)}
          className="group flex items-center gap-3 w-full rounded-xl border border-dashed border-slate-300 px-3.5 py-2.5
            hover:border-primary-400 hover:bg-primary-50/50 transition-all duration-150 active:scale-[0.99]">
          <div className="h-7 w-7 rounded-lg bg-slate-100 group-hover:bg-primary-100 flex items-center justify-center shrink-0 transition-colors">
            <Plus size={13} className="text-slate-500 group-hover:text-primary-600 transition-colors" />
          </div>
          <div className="text-left min-w-0">
            <p className="text-[12px] font-semibold text-slate-600 group-hover:text-primary-700 transition-colors leading-tight">
              Create New Tenant
            </p>
            <p className="text-[10px] text-slate-400 group-hover:text-primary-400 transition-colors leading-tight">
              Not in the list? Add instantly
            </p>
          </div>
        </button>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  BedActionModal — Smart Bed Control Panel
// ══════════════════════════════════════════════════════════════════════════════
const BedActionModal = ({ bed, room, propertyId, onClose, onSuccess, occupancy, onViewTenant, allRooms = [], initialView = 'actions' }) => {
  const toast = useToast()
  const [view, setView]               = useState(initialView)
  const [submitting, setSubmitting]   = useState(false)

  // Assign state
  const [selectedTenantId, setSelectedTenantId]   = useState('')
  const [selectedTenantObj, setSelectedTenantObj] = useState(null) // full object for preview
  const [rentOverride, setRentOverride]           = useState('')
  const [depositInput, setDepositInput]           = useState('')
  const [depositEnabled, setDepositEnabled]       = useState(false)
  const [moveInDate, setMoveInDate]               = useState(() => new Date().toISOString().split('T')[0])

  // Block state
  const [blockReason, setBlockReason]     = useState('')
  const [blockNotes, setBlockNotes]       = useState('')

  // Vacate state
  const [vacateCheck, setVacateCheck]               = useState(null)
  const [vacateCheckLoading, setVacateCheckLoading] = useState(false)
  const [vacateNotes, setVacateNotes]               = useState('')
  // 'collect' | 'adjust_deposit' | 'refund_deposit' | 'vacate_anyway' | null
  const [settlementOption, setSettlementOption]     = useState(null)
  const [collectAmount, setCollectAmount]           = useState('')
  const [collectMethod, setCollectMethod]           = useState('cash')
  const [refundAmount, setRefundAmount]             = useState('')
  const [refundMethod, setRefundMethod]             = useState('cash')

  // Mid-stay deposit adjustment state
  const [useDepositAmount, setUseDepositAmount] = useState('')

  // Reserve state
  const [reservedTill, setReservedTill]   = useState('')
  const [resMoveIn, setResMoveIn]         = useState('')
  const [resNotes, setResNotes]           = useState('')
  const [resMode, setResMode] = useState('list')  // 'list' | 'create'
  const [resStep, setResStep]             = useState('tenant')   // 'tenant' | 'duration' | 'confirm'
  const [resNotesOpen, setResNotesOpen]   = useState(false)
  // Cancel reservation — forfeit or refund choice
  const [cancelForfeitMode, setCancelForfeitMode] = useState('refund')  // 'refund' | 'forfeit'

  // Check-in advance disposition (when confirming a reserved bed with an advance)
  // 'adjust' = auto-offset against first rent | 'convert_deposit' = move to deposit | 'keep' = leave as ledger credit
  const [advanceDisposition, setAdvanceDisposition] = useState('adjust')

  // Advance (token amount) state
  const [resAdvanceEnabled, setResAdvanceEnabled] = useState(false)
  const [resAdvanceAmount, setResAdvanceAmount]   = useState('')
  const [resAdvanceMode, setResAdvanceMode]       = useState('adjust')  // 'adjust' | 'refund'

  // Reserve — tenant selection
  const [resTenantId, setResTenantId]                   = useState(null)
  const [resSelectedTenant, setResSelectedTenant]       = useState(null)
  const [resExistingReservation, setResExistingReservation] = useState(null)

  const [dueDay, setDueDay] = useState(5)  // grace days after cycle start before rent is due (0–28)

  // New tenant inline form
  const [assignMode, setAssignMode]       = useState('list')  // 'list' | 'create'
  const [newName, setNewName]             = useState('')
  const [newPhone, setNewPhone]           = useState('')
  const [creatingTenant, setCreatingTenant] = useState(false)

  // Phone duplicate detection (fires while typing in the new-tenant form)
  const [phoneConflict, setPhoneConflict]         = useState(null)  // conflicting tenant doc or null
  const [phoneChecking, setPhoneChecking]         = useState(false)
  const phoneDebounceRef  = useRef(null)
  // Prevents the reserve-state reset from firing more than once per open.
  // Without this guard, any view change (e.g. a parent re-render) would wipe
  // mid-flow state (selected tenant, current step, etc.).
  const resInitialized    = useRef(false)

  // Change room state
  const [targetRoomId, setTargetRoomId]     = useState('')
  const [allTargetBeds, setAllTargetBeds]   = useState([])
  const [bedsLoading, setBedsLoading]       = useState(false)
  const [selectedBedId, setSelectedBedId]   = useState('')

  // Rent preview (loaded once on mount for vacant/reserved beds)
  const [rentPreview, setRentPreview]             = useState(null)
  const [rentPreviewLoading, setRentPreviewLoading] = useState(false)

  // Change-room: predicted rent for the selected target bed
  const [crRentPreview, setCrRentPreview]         = useState(null)
  const [crRentLoading, setCrRentLoading]         = useState(false)

  // Load rent preview once when the modal opens for an assignable bed
  useEffect(() => {
    if (bed.status !== 'vacant' && bed.status !== 'reserved') return
    setRentPreviewLoading(true)
    rentPreviewApi(propertyId, room._id, bed._id)
      .then(r => setRentPreview(r.data?.data ?? null))
      .catch(() => {})
      .finally(() => setRentPreviewLoading(false))
  }, [bed._id]) // eslint-disable-line

  // Fetch vacate preflight when entering the vacate view
  useEffect(() => {
    if (view !== 'vacate') return
    setVacateCheck(null)
    setVacateCheckLoading(true)
    setVacateNotes('')
    setSettlementOption(null)
    setCollectAmount('')
    setCollectMethod('cash')
    setRefundAmount('')
    setRefundMethod('cash')
    vacateCheckApi(propertyId, room._id, bed._id)
      .then(r => {
        const data = r.data?.data ?? null
        setVacateCheck(data)
        const pending   = data?.totalPendingAmount ?? 0
        const depBal    = data?.tenant?.depositBalance ?? 0
        const depPaid   = data?.tenant?.depositPaid ?? false
        const depStatus = data?.tenant?.depositStatus
        const hasD = depPaid && depBal > 0 && depStatus !== 'refunded' && depStatus !== 'adjusted'
        // Set smart default
        if (pending > 0) {
          setSettlementOption('collect')
          setCollectAmount(String(pending))
        } else if (hasD) {
          setSettlementOption('refund_deposit')
          setRefundAmount(String(depBal))
        }
      })
      .catch(() => {})
      .finally(() => setVacateCheckLoading(false))
  }, [view])

  useEffect(() => {
    if (view !== 'assign') {
      setPhoneConflict(null)
      setPhoneChecking(false)
      clearTimeout(phoneDebounceRef.current)
      setDepositInput('')
      setDepositEnabled(false)
      setDueDay(1)
    } else if (bed.status === 'reserved' && bed.tenant?._id) {
      // Reserved bed: auto-select the linked reserved tenant so the user doesn't need
      // to search for them manually (they are filtered out of TenantSearch by
      // assignable=true because their tenant.bed is already set to this bed).
      setSelectedTenantId(bed.tenant._id)
      setSelectedTenantObj(bed.tenant)
    }
  }, [view])

  // Fetch beds for target room when change-room or move-reservation room selector changes
  useEffect(() => {
    if (view !== 'changeRoom' && view !== 'moveReservation') return
    if (!targetRoomId) { setAllTargetBeds([]); setSelectedBedId(''); setCrRentPreview(null); return }
    setBedsLoading(true)
    setSelectedBedId('')
    setCrRentPreview(null)
    getBeds(propertyId, targetRoomId)
      .then(r => setAllTargetBeds([...(r.data?.data ?? [])].sort(sortBeds)))
      .catch(() => toast('Failed to load beds', 'error'))
      .finally(() => setBedsLoading(false))
  }, [view, targetRoomId, propertyId])

  // Fetch predicted rent whenever a target bed is selected in change-room flow
  useEffect(() => {
    if (view !== 'changeRoom' || !selectedBedId || !targetRoomId) {
      setCrRentPreview(null)
      return
    }
    setCrRentLoading(true)
    rentPreviewApi(propertyId, targetRoomId, selectedBedId)
      .then(r => setCrRentPreview(r.data?.data ?? null))
      .catch(() => setCrRentPreview(null))
      .finally(() => setCrRentLoading(false))
  }, [view, selectedBedId, targetRoomId, propertyId])

  // Reset reserve state only on the FIRST entry into the reserve view.
  // The guard prevents a React re-render (e.g. parent refetch, Strict Mode
  // double-invoke) from wiping mid-flow state — selected tenant, current step, etc.
  // Clearing the guard when leaving ensures a fresh reset next time it opens.
  useEffect(() => {
    if (view !== 'reserve') {
      resInitialized.current = false   // clear guard so next open resets cleanly
      return
    }
    if (resInitialized.current) return  // already initialised — do nothing mid-flow

    setResTenantId(null)
    setResSelectedTenant(null)
    setResExistingReservation(null)
    setResMode('list')
    setResStep('tenant')
    setResNotesOpen(false)
    setResAdvanceEnabled(false)
    setResAdvanceAmount('')
    setResAdvanceMode('adjust')
    resInitialized.current = true
  }, [view])

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

  const baseRent = room.baseRent ?? room.rent ?? 0
  // Occupied: tenant.rentAmount is the ONLY source of truth (locked at assignment).
  // billingSnapshot.finalRent is a safety fallback if rentAmount is somehow missing.
  // Non-occupied extra: routed through calculateRent so the engine stays the
  //   single source — no inline duplication of isChargeable/extraCharge logic.
  // Non-occupied normal: show baseRent as an estimate (no locked value exists yet).
  const displayRent = bed.status === 'occupied'
    ? (bed.tenant?.rentAmount ?? bed.tenant?.billingSnapshot?.finalRent ?? baseRent)
    : bed.isExtra
      ? calculateRent({
          room: { baseRent, rentType: room.rentType },
          bed,
          normalOccupied: 0,
        }).finalRent
      : (bed.rentOverride || baseRent)
  const hasCustomRent = !bed.isExtra && bed.rentOverride && bed.rentOverride !== baseRent
  const TITLES = {
    actions:        `Room ${room.roomNumber} • Bed ${bed.bedNumber}`,
    assign:         `Assign Tenant — Bed ${bed.bedNumber}`,
    reserve:        `Reserve — Bed ${bed.bedNumber}`,
    vacate:         `Vacate — Bed ${bed.bedNumber}`,
    confirmBlock:        `Block — Bed ${bed.bedNumber}`,
    confirmUnblock:      `Unblock — Bed ${bed.bedNumber}`,
    changeRoom:          `Change Room — ${bed.tenant?.name ?? 'Tenant'}`,
    moveReservation:     `Move Reservation — ${bed.reservation?.name ?? 'Lead'}`,
    cancelReservation:   `Cancel Reservation — Bed ${bed.bedNumber}`,
    useDeposit:          `Use Deposit — ${bed.tenant?.name ?? 'Tenant'}`,
    confirmDeleteExtra:  `Remove Extra Bed ${bed.bedNumber}`,
  }

  return (
    <Modal title={TITLES[view]} onClose={onClose} size={view === 'changeRoom' || view === 'moveReservation' ? 'md' : 'sm'}>

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
          <div className={`relative rounded-2xl overflow-hidden bg-gradient-to-br ${heroTheme.strip} px-5 py-4`}>
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
                <p className="text-[11px] text-white/70 mt-2 capitalize flex items-center gap-2 flex-wrap">
                  {room.type} · {room.capacity} beds · {room.rentType === 'per_room' ? 'Per Room pricing' : 'Per Bed pricing'}
                  {bed.isExtra && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/25 border border-white/40 px-2 py-0.5 text-[9px] font-bold text-white normal-case tracking-wider">
                      ✦ Extra Bed
                    </span>
                  )}
                </p>
                {occupancy && occupancy.total > 0 && (
                  <div className="mt-2.5">
                    <div className="h-1 w-full rounded-full bg-white/20 overflow-hidden">
                      <div className="h-1 rounded-full bg-white/80 transition-all duration-700"
                        style={{ width: `${occPct}%` }} />
                    </div>
                  </div>
                )}
                {bed.status === 'vacant' && (
                  <p className="text-[11px] text-white/90 font-semibold mt-2.5">
                    Ready to assign — bed is available now
                  </p>
                )}
              </div>
              <div className="h-12 w-12 rounded-2xl bg-white/20 backdrop-blur-sm border border-white/30 flex items-center justify-center shrink-0">
                <BedDouble size={20} className="text-white" />
              </div>
            </div>
          </div>

          {/* ── Over-capacity warning ── */}
          {occupancy && occupancy.total > room.capacity && (
            <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-3.5 py-3">
              <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-red-700">Room Over Capacity</p>
                <p className="text-[11px] text-red-600 mt-0.5 leading-relaxed">
                  {occupancy.total} beds in a {room.capacity}-bed room ({occupancy.total - room.capacity} over).
                  Consider removing extra beds or updating room capacity.
                </p>
              </div>
            </div>
          )}

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

          {/* ── Reservation card (reserved tenant) ── */}
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
                {(bed.reservation.notes || (bed.reservation.reservationAmount > 0)) && (
                  <div className="border-t border-amber-100 pt-2.5 space-y-2">
                    {bed.reservation.reservationAmount > 0 && (() => {
                      const advAmt    = bed.reservation.reservationAmount
                      const advMode   = bed.reservation.reservationMode
                      const advStatus = bed.reservation.reservationStatus
                      return (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <div className="h-5 w-5 rounded-md bg-emerald-100 flex items-center justify-center shrink-0">
                                <IndianRupee size={10} className="text-emerald-600" />
                              </div>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                                Advance Collected
                              </span>
                            </div>
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${
                              advStatus === 'converted' ? 'bg-blue-50 border-blue-200 text-blue-700' :
                              advStatus === 'cancelled' ? 'bg-slate-50 border-slate-200 text-slate-500' :
                              'bg-amber-50 border-amber-200 text-amber-700'
                            }`}>
                              {advStatus === 'converted' ? 'Applied' : advStatus === 'cancelled' ? 'Cancelled' : 'Held'}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xl font-bold text-emerald-700 tabular-nums">
                              ₹{advAmt.toLocaleString('en-IN')}
                            </span>
                            <div className="text-right">
                              <p className="text-[10px] text-slate-500 font-medium">
                                {advMode === 'adjust' ? 'Adjust → first rent' : 'Refund on cancel'}
                              </p>
                            </div>
                          </div>
                        </div>
                      )
                    })()}
                    {bed.reservation.notes && (
                      <p className="text-[11px] text-slate-400 italic leading-relaxed">
                        {bed.reservation.notes}
                      </p>
                    )}
                  </div>
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
                if (snap.isExtra) {
                  return (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {!snap.isChargeable
                        ? 'Extra Bed · Free'
                        : snap.extraCharge > 0
                          ? 'Extra Bed · Fixed charge'
                          : 'Extra Bed · Uses room base rent'}
                    </p>
                  )
                }
                if (snap.overrideApplied) {
                  return (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Override · Base ₹{snap.baseRent?.toLocaleString('en-IN')}
                    </p>
                  )
                }
                if (snap.rentType === 'per_room') {
                  return (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      Equal Split · ₹{snap.baseRent?.toLocaleString('en-IN')} ÷ {snap.divisorUsed}
                    </p>
                  )
                }
                return (
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    Per Bed · Fixed
                  </p>
                )
              })() : bed.status === 'vacant' ? (() => {
                if (bed.isExtra) {
                  return (
                    <p className="text-[10px] text-slate-400 mt-0.5">
                      {!bed.isChargeable ? 'Extra Bed · Free' : bed.extraCharge > 0 ? 'Extra Bed · Fixed charge' : 'Extra Bed · Uses room base rent'}
                    </p>
                  )
                }
                if (hasCustomRent) {
                  return <p className="text-[10px] text-slate-400 mt-0.5">Custom override · Locked at assignment</p>
                }
                if (room.rentType === 'per_room') {
                  const currentOcc   = occupancy?.occupied ?? 0
                  // Route through the shared engine so MIN_RENT floor is applied
                  const estPerPerson = calculateRent({
                    room: { baseRent, rentType: room.rentType },
                    bed:  { isExtra: false, rentOverride: null, isChargeable: true, extraCharge: 0 },
                    normalOccupied: currentOcc + 1,
                  }).finalRent
                  return (
                    <div className="mt-1 space-y-0.5">
                      <p className="text-[10px] text-slate-400">Split equally at assignment</p>
                      <p className="text-[10px] font-semibold text-primary-500">
                        Est. ₹{estPerPerson.toLocaleString('en-IN')}/person after assign
                      </p>
                    </div>
                  )
                }
                return <p className="text-[10px] text-slate-400 mt-0.5">Per Bed · Locked at assignment</p>
              })() : (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {bed.isExtra
                    ? (!bed.isChargeable
                        ? 'Extra Bed · Free'
                        : bed.extraCharge > 0
                          ? 'Extra Bed · Fixed charge'
                          : 'Extra Bed · Uses room base rent')
                    : hasCustomRent
                      ? 'Custom override'
                      : room.rentType === 'per_room'
                        ? 'Per Room · final at assign'
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
              <div className="space-y-3">

                {/* Primary CTA */}
                <button
                  type="button"
                  onClick={() => setView('assign')}
                  className="group relative w-full flex items-center justify-center gap-2.5 rounded-2xl bg-primary-600 hover:bg-primary-700 px-5 py-3.5 text-sm font-bold text-white shadow-md shadow-primary-200/60 hover:shadow-lg hover:shadow-primary-200/70 transition-all duration-200 active:scale-[0.98]"
                >
                  <UserPlus size={17} className="transition-transform duration-200 group-hover:scale-110" />
                  Assign Tenant
                  <span className="ml-auto text-[10px] font-normal text-primary-200 group-hover:text-primary-100">
                    Move in now →
                  </span>
                </button>

                {/* Secondary card actions */}
                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setView('reserve')}
                    className="group flex flex-col items-start gap-2 rounded-2xl border border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/40 px-3.5 py-3 transition-all duration-200 active:scale-[0.98] hover:shadow-sm"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <div className="h-7 w-7 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0 group-hover:bg-amber-100 transition-colors">
                        <CalendarClock size={13} className="text-amber-500" />
                      </div>
                      <span className="text-xs font-bold text-slate-700 group-hover:text-amber-700 transition-colors">Reserve</span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-tight group-hover:text-amber-600/70 transition-colors">
                      Hold for an upcoming tenant
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setView('confirmBlock')}
                    className="group flex flex-col items-start gap-2 rounded-2xl border border-slate-200 bg-white hover:border-red-200 hover:bg-red-50/40 px-3.5 py-3 transition-all duration-200 active:scale-[0.98] hover:shadow-sm"
                  >
                    <div className="flex items-center gap-2 w-full">
                      <div className="h-7 w-7 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center shrink-0 group-hover:bg-red-100 group-hover:border-red-200 transition-colors">
                        <Ban size={13} className="text-slate-400 group-hover:text-red-500 transition-colors" />
                      </div>
                      <span className="text-xs font-bold text-slate-700 group-hover:text-red-600 transition-colors">Block</span>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-tight group-hover:text-red-500/70 transition-colors">
                      Mark unavailable temporarily
                    </p>
                  </button>
                </div>

                {/* Remove extra bed — danger, below the grid */}
                {bed.isExtra && (
                  <button
                    type="button"
                    onClick={() => setView('confirmDeleteExtra')}
                    className="group w-full flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 px-4 py-2 text-xs font-semibold text-red-600 transition-all duration-150 active:scale-[0.98]"
                  >
                    <Trash2 size={13} />
                    Remove Extra Bed
                  </button>
                )}
              </div>
            )}

            {/* RESERVED */}
            {bed.status === 'reserved' && (
              <>
                {bed.isExtra && (
                  <div className="space-y-1.5">
                    <ActionButton icon={Trash2} label="Remove Extra Bed" variant="danger-light"
                      disabled />
                    <p className="flex items-center gap-1.5 text-[10px] text-amber-700 font-medium px-0.5">
                      <AlertTriangle size={10} className="shrink-0" />
                      Cancel the reservation first to remove this bed
                    </p>
                  </div>
                )}
                <ActionButton icon={UserPlus} label="Convert to Tenant" variant="primary"
                  onClick={() => {
                    if (bed.reservation?.name)     setNewName(bed.reservation.name)
                    if (bed.reservation?.phone)    setNewPhone(bed.reservation.phone)
                    if (bed.reservation?.moveInDate) setMoveInDate(new Date(bed.reservation.moveInDate).toISOString().split('T')[0])
                    // Default disposition to 'adjust' for adjust-mode reservations, else 'keep'
                    setAdvanceDisposition(bed.reservation?.reservationMode === 'adjust' ? 'adjust' : 'keep')
                    setAssignMode('create')
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
                <ActionButton icon={ArrowRightLeft} label="Move Reservation" variant="secondary"
                  onClick={() => { setTargetRoomId(''); setAllTargetBeds([]); setSelectedBedId(''); setView('moveReservation') }} />
                <ActionButton icon={X}   label="Cancel Reservation" variant="danger-light"
                  onClick={() => { setCancelForfeitMode('refund'); setView('cancelReservation') }} />
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
                  <ActionButton icon={ArrowRightLeft} label="Change Room" variant="secondary"
                    onClick={() => { setTargetRoomId(''); setAllTargetBeds([]); setSelectedBedId(''); setView('changeRoom') }} />
                  {/* Mid-stay deposit adjustment — only when deposit balance exists */}
                  {(bed.tenant?.depositBalance ?? 0) > 0 && (
                    <ActionButton icon={IndianRupee} label={`Use Deposit · ₹${(bed.tenant.depositBalance).toLocaleString('en-IN')}`}
                      variant="secondary"
                      onClick={() => setView('useDeposit')} />
                  )}
                  <ActionButton icon={LogOut} label="Vacate Bed" variant="danger" onClick={() => setView('vacate')} />
                  {bed.isExtra && (
                    <div className="space-y-1.5">
                      <ActionButton icon={Trash2} label="Remove Extra Bed" variant="danger-light" disabled />
                      <p className="flex items-center gap-1.5 text-[10px] text-amber-700 font-medium px-0.5">
                        <AlertTriangle size={10} className="shrink-0" />
                        Cannot remove — bed is occupied
                      </p>
                    </div>
                  )}
                </>
              )
            })()}

            {/* BLOCKED */}
            {bed.status === 'blocked' && (
              <>
                <ActionButton icon={Unlock} label="Unblock Bed" variant="success"
                  onClick={() => setView('confirmUnblock')} />
                {bed.isExtra && (
                  <div className="space-y-1.5">
                    <p className="flex items-center gap-1.5 text-[10px] text-amber-700 font-medium px-0.5">
                      <AlertTriangle size={10} className="shrink-0" />
                      Unblock this bed before removing it
                    </p>
                  </div>
                )}
              </>
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
                This bed has an active reservation. Blocking will <span className="font-bold">cancel the reservation</span> for {bed.reservation?.name || 'the tenant'}.
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
        const vc            = vacateCheck
        const totalPending  = vc?.totalPendingAmount  ?? 0
        const totalPaid     = vc?.totalPaidAmount     ?? 0
        const totalRent     = vc?.totalRentAmount     ?? 0
        const depositBal    = vc?.tenant?.depositBalance  ?? 0
        const depositAmt    = vc?.tenant?.depositAmount   ?? bed.tenant?.depositAmount ?? 0
        const depositPaid   = vc?.tenant?.depositPaid     ?? bed.tenant?.depositPaid   ?? false
        const depositStatus = vc?.tenant?.depositStatus   ?? null
        const tenantName    = bed.tenant?.name ?? 'Tenant'
        const tenantPhone   = bed.tenant?.phone
        const rentAmount    = vc?.tenant?.rentAmount ?? bed.tenant?.rentAmount ?? 0
        const bedLabel      = bed.room?.roomNumber
          ? `Room ${bed.room.roomNumber} · Bed ${bed.bedNumber}`
          : `Bed ${bed.bedNumber}`
        const hasPending    = totalPending > 0
        const hasDeposit    = depositPaid && depositBal > 0
          && depositStatus !== 'refunded' && depositStatus !== 'adjusted'

        // Derived amounts
        const collectAmt         = Number(collectAmount) || 0
        const adjustAmt          = Math.min(depositBal, totalPending)
        const remainingAfterCollect = Math.max(0, totalPending - collectAmt)
        const remainingAfterAdjust  = Math.max(0, totalPending - adjustAmt)
        const depositAfterAdjust    = Math.max(0, depositBal - adjustAmt)

        // Derived refund amount
        const refundAmt     = Number(refundAmount) || 0
        const refundExceeds = settlementOption === 'refund_deposit' && refundAmt > depositBal

        // Validation
        const collectExceeds = settlementOption === 'collect' && collectAmt > totalPending
        const canProceed = settlementOption === 'collect'
          ? collectAmt > 0 && !collectExceeds
          : settlementOption === 'refund_deposit'
          ? refundAmt > 0 && !refundExceeds
          : true

        // Dynamic button label
        const btnLabel = (() => {
          if (submitting) return 'Vacating…'
          switch (settlementOption) {
            case 'collect':
              if (collectAmt <= 0) return 'Confirm Vacate'
              return remainingAfterCollect > 0
                ? `Collect ₹${collectAmt.toLocaleString('en-IN')} & Vacate (₹${remainingAfterCollect.toLocaleString('en-IN')} due)`
                : `Collect ₹${collectAmt.toLocaleString('en-IN')} & Vacate`
            case 'adjust_deposit':
              return `Adjust ₹${adjustAmt.toLocaleString('en-IN')} & Vacate`
            case 'partial_refund': {
              const surplusAmt = Math.max(0, depositBal - totalPending)
              return `Clear Dues + Refund ₹${surplusAmt.toLocaleString('en-IN')} & Vacate`
            }
            case 'refund_deposit':
              return refundAmt > 0
                ? `Refund ₹${refundAmt.toLocaleString('en-IN')} & Vacate`
                : 'Confirm Vacate'
            case 'forfeit_deposit':
              return `Forfeit ₹${depositBal.toLocaleString('en-IN')} & Vacate`
            case 'vacate_anyway':
              return hasPending
                ? `Vacate with ₹${totalPending.toLocaleString('en-IN')} pending`
                : 'Confirm Vacate'
            default:
              return 'Confirm Vacate'
          }
        })()

        // API param mapping
        const vacateParams = (() => {
          switch (settlementOption) {
            case 'collect':
              return { vacateOption: 'collect', depositAction: null,
                       paymentAmount: collectAmt, paymentMethod: collectMethod }
            case 'adjust_deposit':
              return { vacateOption: 'proceed', depositAction: 'adjust' }
            case 'partial_refund':
              return { vacateOption: 'proceed', depositAction: 'adjust_and_refund', refundMethod }
            case 'refund_deposit':
              return { vacateOption: 'proceed', depositAction: 'refund',
                       refundAmount: refundAmt, refundMethod }
            case 'forfeit_deposit':
              return { vacateOption: 'proceed', depositAction: 'forfeit' }
            default:
              return { vacateOption: 'proceed', depositAction: null }
          }
        })()

        // Radio option renderer
        const RadioBtn = ({ value, active, color }) => (
          <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
            active ? `border-${color}-500` : 'border-slate-300'
          }`}>
            {active && <span className={`h-2 w-2 rounded-full bg-${color}-500 inline-block`} />}
          </div>
        )

        return (
        <div className="space-y-4">

          {/* ── Header: Tenant identity + pending warning ── */}
          <div className="rounded-2xl border border-slate-100 bg-gradient-to-r from-slate-50/80 to-white px-4 py-3.5 shadow-sm space-y-2.5">
            <div className="flex items-center gap-3.5">
              <div className="h-11 w-11 rounded-full bg-gradient-to-br from-red-400 to-red-600 flex items-center justify-center shrink-0 shadow-md">
                <span className="text-sm font-bold text-white tracking-wide">
                  {tenantName.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800">{tenantName}</p>
                <p className="text-xs text-slate-400 mt-0.5">
                  {[tenantPhone, bedLabel].filter(Boolean).join(' · ')}
                </p>
              </div>
              {rentAmount > 0 && (
                <div className="text-right shrink-0">
                  <p className="text-[10px] text-slate-400 mb-0.5">Monthly Rent</p>
                  <p className="text-sm font-bold text-slate-700">
                    ₹{rentAmount.toLocaleString('en-IN')}
                  </p>
                </div>
              )}
            </div>
            {hasPending && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                <AlertTriangle size={12} className="text-red-500 shrink-0" />
                <p className="text-xs font-bold text-red-700">
                  Pending dues: ₹{totalPending.toLocaleString('en-IN')}
                </p>
              </div>
            )}
          </div>

          {/* ── Financial Summary Card ── */}
          {vacateCheckLoading ? (
            <div className="h-12 flex items-center justify-center"><Spinner /></div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 overflow-hidden">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-4 pt-3 pb-1.5">
                Financial Summary
              </p>
              <div className="divide-y divide-slate-100">
                {[
                  { label: 'Total Rent Billed', value: totalRent, color: 'text-slate-700' },
                  { label: 'Amount Paid',        value: totalPaid, color: 'text-emerald-600' },
                  { label: 'Outstanding',        value: totalPending,
                    color: hasPending ? 'text-red-600 font-bold' : 'text-emerald-600' },
                  ...(depositAmt > 0 ? [{
                    label: 'Security Deposit', value: depositBal,
                    sub: !depositPaid ? '(not collected)'
                       : depositStatus === 'adjusted' ? '(adjusted)' : depositStatus === 'refunded' ? '(refunded)'
                       : '(held)',
                    color: hasDeposit ? 'text-violet-700 font-semibold' : 'text-slate-500',
                  }] : []),
                ].map(({ label, value, color, sub }) => (
                  <div key={label} className="flex items-center justify-between px-4 py-2">
                    <span className="text-xs text-slate-500">
                      {label}
                      {sub && <span className="ml-1 text-[10px] text-slate-400">{sub}</span>}
                    </span>
                    <span className={`text-sm tabular-nums ${color}`}>
                      ₹{value.toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Settlement Options (radio group) ── */}
          {!vacateCheckLoading && (hasPending || hasDeposit) && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-600">Settlement</p>

              {/* Option 1 — Collect Payment (when pending > 0) */}
              {hasPending && (
                <button type="button"
                  onClick={() => setSettlementOption('collect')}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                    settlementOption === 'collect'
                      ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}>
                  <div className="flex items-center gap-2.5">
                    <RadioBtn value="collect" active={settlementOption === 'collect'} color="emerald" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold ${settlementOption === 'collect' ? 'text-emerald-800' : 'text-slate-700'}`}>
                        Collect Payment
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Accept partial or full payment · Outstanding ₹{totalPending.toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>

                  {/* Inline fields when selected */}
                  {settlementOption === 'collect' && (
                    <div className="mt-3 space-y-2" onClick={e => e.stopPropagation()}>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="label text-xs">Amount (₹) *</label>
                          <input type="number" min="1" max={totalPending}
                            className={`input text-sm ${collectExceeds ? 'border-red-400 bg-red-50/30' : ''}`}
                            value={collectAmount}
                            onChange={e => setCollectAmount(e.target.value)}
                            autoFocus />
                        </div>
                        <div>
                          <label className="label text-xs">Method</label>
                          <select className="input text-sm" value={collectMethod}
                            onChange={e => setCollectMethod(e.target.value)}>
                            {[['cash','Cash'],['upi','UPI'],['bank_transfer','Bank Transfer'],['cheque','Cheque']].map(([v,l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {collectExceeds && (
                        <p className="text-[11px] text-red-500 font-medium">
                          Cannot exceed outstanding ₹{totalPending.toLocaleString('en-IN')}
                        </p>
                      )}
                      {collectAmt > 0 && !collectExceeds && (
                        <p className={`text-[11px] font-medium ${remainingAfterCollect > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
                          {remainingAfterCollect > 0
                            ? `Remaining after payment: ₹${remainingAfterCollect.toLocaleString('en-IN')}`
                            : 'Fully settles all dues'}
                        </p>
                      )}
                    </div>
                  )}
                </button>
              )}

              {/* Option 2 — Adjust from Deposit (when pending > 0 AND deposit > 0 AND deposit ≤ pending) */}
              {hasPending && hasDeposit && depositBal <= totalPending && (
                <button type="button"
                  onClick={() => setSettlementOption('adjust_deposit')}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                    settlementOption === 'adjust_deposit'
                      ? 'border-blue-400 bg-blue-50 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}>
                  <div className="flex items-center gap-2.5">
                    <RadioBtn value="adjust_deposit" active={settlementOption === 'adjust_deposit'} color="blue" />
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold ${settlementOption === 'adjust_deposit' ? 'text-blue-800' : 'text-slate-700'}`}>
                        Adjust from Deposit
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        ₹{adjustAmt.toLocaleString('en-IN')} applied from deposit
                        {remainingAfterAdjust > 0
                          ? ` · ₹${remainingAfterAdjust.toLocaleString('en-IN')} still outstanding`
                          : ' · Fully clears dues'}
                      </p>
                    </div>
                  </div>
                </button>
              )}

              {/* Option 2b — Partial Refund: clear dues + refund surplus (when deposit > pending) */}
              {hasPending && hasDeposit && depositBal > totalPending && (() => {
                const surplus = depositBal - totalPending
                return (
                  <button type="button"
                    onClick={() => setSettlementOption('partial_refund')}
                    className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                      settlementOption === 'partial_refund'
                        ? 'border-teal-400 bg-teal-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}>
                    <div className="flex items-center gap-2.5">
                      <RadioBtn value="partial_refund" active={settlementOption === 'partial_refund'} color="teal" />
                      <div className="flex-1 min-w-0">
                        <p className={`text-xs font-bold ${settlementOption === 'partial_refund' ? 'text-teal-800' : 'text-slate-700'}`}>
                          Clear Dues + Refund Surplus
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          ₹{totalPending.toLocaleString('en-IN')} clears dues · ₹{surplus.toLocaleString('en-IN')} refunded to tenant
                        </p>
                      </div>
                    </div>
                    {settlementOption === 'partial_refund' && (
                      <div className="mt-3 space-y-1.5" onClick={e => e.stopPropagation()}>
                        <label className="label text-xs">Refund Method</label>
                        <select className="input text-sm" value={refundMethod}
                          onChange={e => setRefundMethod(e.target.value)}>
                          {[['cash','Cash'],['upi','UPI'],['bank_transfer','Bank Transfer'],['cheque','Cheque']].map(([v,l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </button>
                )
              })()}

              {/* Option 3 — Refund Deposit (when NO pending AND deposit > 0) */}
              {!hasPending && hasDeposit && (
                <button type="button"
                  onClick={() => { setSettlementOption('refund_deposit'); setRefundAmount(String(depositBal)) }}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                    settlementOption === 'refund_deposit'
                      ? 'border-violet-400 bg-violet-50 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}>
                  <div className="flex items-center gap-2.5">
                    <RadioBtn value="refund_deposit" active={settlementOption === 'refund_deposit'} color="violet" />
                    <div>
                      <p className={`text-xs font-bold ${settlementOption === 'refund_deposit' ? 'text-violet-800' : 'text-slate-700'}`}>
                        Refund Deposit
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Return ₹{depositBal.toLocaleString('en-IN')} to tenant · No dues outstanding
                      </p>
                    </div>
                  </div>

                  {/* Inline fields when selected */}
                  {settlementOption === 'refund_deposit' && (
                    <div className="mt-3 space-y-2" onClick={e => e.stopPropagation()}>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="label text-xs">Refund Amount (₹) *</label>
                          <input type="number" min="1" max={depositBal}
                            className={`input text-sm ${refundExceeds ? 'border-red-400 bg-red-50/30' : ''}`}
                            value={refundAmount}
                            onChange={e => setRefundAmount(e.target.value)}
                            autoFocus />
                        </div>
                        <div>
                          <label className="label text-xs">Method</label>
                          <select className="input text-sm" value={refundMethod}
                            onChange={e => setRefundMethod(e.target.value)}>
                            {[['cash','Cash'],['upi','UPI'],['bank_transfer','Bank Transfer'],['cheque','Cheque']].map(([v,l]) => (
                              <option key={v} value={v}>{l}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {refundExceeds && (
                        <p className="text-[11px] text-red-500 font-medium">
                          Cannot exceed deposit balance ₹{depositBal.toLocaleString('en-IN')}
                        </p>
                      )}
                    </div>
                  )}
                </button>
              )}

              {/* Option 3b — Forfeit Deposit (when deposit > 0) */}
              {hasDeposit && (
                <button type="button"
                  onClick={() => setSettlementOption('forfeit_deposit')}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                    settlementOption === 'forfeit_deposit'
                      ? 'border-red-400 bg-red-50 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}>
                  <div className="flex items-center gap-2.5">
                    <RadioBtn value="forfeit_deposit" active={settlementOption === 'forfeit_deposit'} color="red" />
                    <div>
                      <p className={`text-xs font-bold ${settlementOption === 'forfeit_deposit' ? 'text-red-800' : 'text-slate-700'}`}>
                        Forfeit Deposit
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Keep ₹{depositBal.toLocaleString('en-IN')} — deposit retained by property (non-refundable)
                      </p>
                    </div>
                  </div>
                  {settlementOption === 'forfeit_deposit' && (
                    <div className="mt-2.5 rounded-lg bg-red-100 border border-red-200 px-3 py-2">
                      <p className="text-[11px] font-semibold text-red-700">
                        ₹{depositBal.toLocaleString('en-IN')} will be permanently forfeited. This cannot be undone.
                      </p>
                    </div>
                  )}
                </button>
              )}

              {/* Option 4 — Vacate Anyway / Handle Later */}
              <button type="button"
                onClick={() => setSettlementOption('vacate_anyway')}
                className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                  settlementOption === 'vacate_anyway'
                    ? 'border-amber-400 bg-amber-50 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}>
                <div className="flex items-center gap-2.5">
                  <RadioBtn value="vacate_anyway" active={settlementOption === 'vacate_anyway'} color="amber" />
                  <div>
                    <p className={`text-xs font-bold ${settlementOption === 'vacate_anyway' ? 'text-amber-800' : 'text-slate-700'}`}>
                      {hasPending ? 'Vacate with dues outstanding' : 'Handle deposit later'}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {hasPending
                        ? `₹${totalPending.toLocaleString('en-IN')} will remain unpaid — can be collected later`
                        : 'Skip for now — deposit can be refunded from Tenant Profile'}
                    </p>
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* ── Live Result Summary ── */}
          {!vacateCheckLoading && settlementOption && settlementOption !== 'vacate_anyway' && (
            <div className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white px-4 py-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5">After Vacating</p>
              <div className="space-y-1.5">
                {settlementOption === 'collect' && collectAmt > 0 && !collectExceeds && (<>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Paid Now</span>
                    <span className="font-bold text-emerald-600">₹{collectAmt.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Remaining Due</span>
                    <span className={`font-bold ${remainingAfterCollect > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      ₹{remainingAfterCollect.toLocaleString('en-IN')}
                    </span>
                  </div>
                  {hasDeposit && (
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Deposit Left</span>
                      <span className="font-semibold text-violet-700">₹{depositBal.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                </>)}
                {settlementOption === 'adjust_deposit' && (<>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Adjusted from Deposit</span>
                    <span className="font-bold text-blue-600">₹{adjustAmt.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Remaining Due</span>
                    <span className={`font-bold ${remainingAfterAdjust > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                      ₹{remainingAfterAdjust.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Deposit Left</span>
                    <span className="font-semibold text-violet-700">₹{depositAfterAdjust.toLocaleString('en-IN')}</span>
                  </div>
                </>)}
                {settlementOption === 'refund_deposit' && refundAmt > 0 && (<>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Deposit Refunded</span>
                    <span className="font-bold text-emerald-600">₹{refundAmt.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Remaining Due</span>
                    <span className="font-bold text-emerald-600">₹0</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Deposit Left</span>
                    <span className="font-semibold text-slate-400">₹0</span>
                  </div>
                </>)}
                {settlementOption === 'partial_refund' && (() => {
                  const surplus = Math.max(0, depositBal - totalPending)
                  return (<>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Adjusted from Deposit</span>
                      <span className="font-bold text-blue-600">₹{totalPending.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Remaining Due</span>
                      <span className="font-bold text-emerald-600">₹0</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Deposit Refunded</span>
                      <span className="font-bold text-emerald-600">₹{surplus.toLocaleString('en-IN')}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Deposit Left</span>
                      <span className="font-semibold text-slate-400">₹0</span>
                    </div>
                  </>)
                })()}
                {settlementOption === 'forfeit_deposit' && (<>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Deposit Forfeited</span>
                    <span className="font-bold text-red-600">₹{depositBal.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Deposit Left</span>
                    <span className="font-semibold text-slate-400">₹0</span>
                  </div>
                  {hasPending && (
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-500">Dues Outstanding</span>
                      <span className="font-bold text-amber-600">₹{totalPending.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                </>)}
              </div>
            </div>
          )}
          {!vacateCheckLoading && settlementOption === 'vacate_anyway' && hasPending && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 flex items-center gap-2">
              <AlertTriangle size={13} className="text-amber-500 shrink-0" />
              <p className="text-xs font-semibold text-amber-800">
                ₹{totalPending.toLocaleString('en-IN')} will remain as outstanding dues
              </p>
            </div>
          )}

          {/* ── Notes ── */}
          <div>
            <label className="label">Notes <span className="text-slate-400 font-normal text-xs">(optional)</span></label>
            <textarea className="input resize-none text-sm" rows={2}
              placeholder="Reason for vacating, final inspection notes…"
              value={vacateNotes} onChange={e => setVacateNotes(e.target.value)}
            />
          </div>

          {/* ── Final Warning ── */}
          <div className="rounded-xl bg-red-50 border border-red-100 px-3.5 py-3 space-y-1.5">
            {[
              'Tenant will be marked as vacated',
              'Bed will become available immediately',
              'Financial records will NOT be deleted',
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
              className={`flex-1 rounded-xl border px-4 py-2.5 text-xs font-bold text-white transition-all duration-200 active:scale-[0.96] disabled:opacity-50 flex items-center justify-center gap-2 leading-tight ${
                settlementOption === 'vacate_anyway'
                  ? 'bg-amber-500 border-amber-600 hover:bg-amber-600'
                  : settlementOption === 'forfeit_deposit'
                  ? 'bg-rose-600 border-rose-700 hover:bg-rose-700'
                  : settlementOption === 'partial_refund'
                  ? 'bg-teal-600 border-teal-700 hover:bg-teal-700'
                  : 'bg-red-500 border-red-600 hover:bg-red-600'
              }`}
              disabled={submitting || !canProceed}
              onClick={() => call(
                () => vacateBedApi(propertyId, room._id, bed._id, {
                  ...vacateParams,
                  ...(vacateNotes.trim() && { notes: vacateNotes.trim() }),
                }),
                'Bed vacated'
              )}
            >
              <LogOut size={14} className="shrink-0" />
              <span className="text-center">{btnLabel}</span>
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
      {view === 'assign' && (() => {
        const addDaysLocal = (d) => {
          const dt = new Date(); dt.setDate(dt.getDate() + d)
          return dt.toISOString().split('T')[0]
        }
        const quickDates = [
          { label: 'Today',    val: addDaysLocal(0) },
          { label: 'Tomorrow', val: addDaysLocal(1) },
          { label: '+3 Days',  val: addDaysLocal(3) },
          { label: '+7 Days',  val: addDaysLocal(7) },
        ]
        const selectedTenant   = selectedTenantObj
        const hasSelection     = !!selectedTenantId || (assignMode === 'create' && !!newName.trim() && !!newPhone)
        const canAssign        = hasSelection && !(!!phoneConflict && !phoneConflict.bed) && !phoneChecking && !submitting && !creatingTenant
        // Estimated rent — use backend preview; fall back to baseRent while loading
        const previewRent    = rentPreview?.finalRent ?? baseRent
        const estRent        = rentOverride ? Number(rentOverride) : previewRent
        // Per-room split display values (from API when available)
        const divisor        = rentPreview?.futureOccupied ?? ((occupancy?.occupied ?? 0) + 1)
        const splitPerPerson = rentOverride ? Number(rentOverride) : previewRent

        return (
        <div className="space-y-5">

          {/* Over-capacity advisory */}
          {occupancy && (occupancy.occupied + 1) > room.capacity && (
            <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3">
              <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-700 leading-relaxed">
                Assigning this bed will bring occupied count to {occupancy.occupied + 1}, exceeding the stated capacity of {room.capacity}.
              </p>
            </div>
          )}

          {/* ── Section: Select Tenant ── */}
          <div className="space-y-2.5">
            <SectionHeader icon={Users} title="Select Tenant" subtitle="Search existing or create new" />

            {/* Relative wrapper — list fades out while form slides in */}
            <div className="relative">
              {/* STATE 1 — LIST MODE: kept in DOM so it fades out on exit */}
              <div
                aria-hidden={assignMode === 'create'}
                className={`transition-opacity duration-150 ${
                  assignMode === 'create'
                    ? 'opacity-0 pointer-events-none absolute inset-x-0 top-0'
                    : 'opacity-100'
                }`}
              >
                <TenantSearch
                  propertyId={propertyId}
                  assignable
                  reservedBedId={bed.status === 'reserved' ? bed._id : null}
                  selectedId={selectedTenantId}
                  onSelect={t => { setSelectedTenantId(t._id); setSelectedTenantObj(t) }}
                  onAddNew={q => {
                    setAssignMode('create')
                    setSelectedTenantId(''); setSelectedTenantObj(null)
                    setNewName(''); setNewPhone('')
                    setPhoneConflict(null)
                    if (q) {
                      const digits = q.replace(/\D/g, '')
                      if (digits.length >= 6) setNewPhone(q)
                      else setNewName(q)
                    }
                  }}
                  autoFocus
                />
              </div>

              {/* STATE 2 — CREATE MODE */}
              {assignMode === 'create' && (
                <div className="animate-modeIn rounded-xl border border-primary-200 bg-white overflow-hidden">

                  {/* Header bar — mirrors Reserve style */}
                  <div className="flex items-center justify-between px-3.5 py-2.5 bg-primary-50/60 border-b border-primary-100">
                    <div>
                      <p className="text-xs font-bold text-primary-700">
                        {phoneConflict ? 'Tenant found' : 'New Tenant'}
                      </p>
                    </div>
                    <button type="button" onClick={() => {
                      setAssignMode('list'); setNewName(''); setNewPhone('')
                      setPhoneConflict(null)
                    }} className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition-colors">
                      Cancel
                    </button>
                  </div>

                  {/* FLOW A: No conflict — create form */}
                  {!phoneConflict && (
                    <div className="p-3.5 space-y-2.5">
                      <div>
                        <label className="label text-xs">Full Name *</label>
                        <input className="input text-sm" placeholder="e.g. Rahul Sharma"
                          value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
                      </div>
                      <div>
                        <label className="label text-xs">Phone Number *</label>
                        <div className="relative">
                          <PhoneInput
                            value={newPhone}
                            onChange={val => {
                              setNewPhone(val)
                              setPhoneConflict(null)
                              clearTimeout(phoneDebounceRef.current)
                              const digits = val.replace(/\D/g, '')
                              if (digits.length < 6) return
                              setPhoneChecking(true)
                              phoneDebounceRef.current = setTimeout(() => {
                                searchTenantsApi(propertyId, { phone: val.trim() })
                                  .then(r => {
                                    const active = (r.data?.data ?? []).find(
                                      t => t.status === 'active' || t.status === 'notice' || t.status === 'reserved'
                                    )
                                    setPhoneConflict(active ?? null)
                                  })
                                  .catch(() => {})
                                  .finally(() => setPhoneChecking(false))
                              }, 500)
                            }}
                            placeholder="Mobile number"
                          />
                          {phoneChecking && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 animate-pulse">
                              checking…
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Action buttons — matches Reserve layout exactly */}
                      <div className="flex gap-2 pt-0.5">
                        <button type="button"
                          onClick={() => { setAssignMode('list'); setNewName(''); setNewPhone(''); setPhoneConflict(null) }}
                          className="flex-1 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                          Cancel
                        </button>
                        <button type="button"
                          disabled={!newName.trim() || !newPhone || phoneChecking || creatingTenant}
                          className="flex-1 rounded-xl bg-primary-600 hover:bg-primary-700 py-2 text-xs font-bold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          onClick={async () => {
                            setCreatingTenant(true)
                            try {
                              const res = await createTenantApi(propertyId, {
                                name:   newName.trim(),
                                phone:  newPhone.trim(),
                                status: 'reserved',
                              })
                              const newTenant = res.data?.data ?? res.data
                              setSelectedTenantId(newTenant._id)
                              setSelectedTenantObj(newTenant)
                              setAssignMode('list')
                              setNewName(''); setNewPhone(''); setPhoneConflict(null)
                            } catch (err) {
                              toast(err.response?.data?.message || 'Failed to create tenant', 'error')
                            } finally {
                              setCreatingTenant(false)
                            }
                          }}>
                          {creatingTenant && (
                            <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                          )}
                          {creatingTenant ? 'Creating…' : 'Create & Continue'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* FLOW B: Conflict — available tenant */}
                  {phoneConflict && !phoneConflict.bed && (
                    <div className="p-3.5 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-amber-700">Tenant already exists</p>
                          <p className="text-[11px] text-amber-600 mt-0.5">
                            <span className="font-semibold">{phoneConflict.name}</span> · {phoneConflict.phone} · {phoneConflict.status}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button type="button"
                          onClick={() => { setPhoneConflict(null); setNewPhone('') }}
                          className="flex-1 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                          Different person
                        </button>
                        <button type="button"
                          onClick={() => {
                            setSelectedTenantId(phoneConflict._id)
                            setSelectedTenantObj(phoneConflict)
                            setAssignMode('list')
                            setNewName(''); setNewPhone(''); setPhoneConflict(null)
                          }}
                          className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 py-2 text-xs font-bold text-white transition-colors shadow-sm">
                          Select Existing
                        </button>
                      </div>
                    </div>
                  )}

                  {/* FLOW C: Conflict — occupied tenant */}
                  {phoneConflict && phoneConflict.bed && (
                    <div className="p-3.5 space-y-2">
                      <div className="flex items-start gap-2">
                        <AlertTriangle size={13} className="text-blue-500 shrink-0 mt-0.5" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-blue-700">Tenant is already assigned</p>
                          <p className="text-[11px] text-blue-600 mt-0.5">
                            <span className="font-semibold">{phoneConflict.name}</span> is in Bed {phoneConflict.bed.bedNumber}
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">If this is a different person, clear the number and try again.</p>
                        </div>
                      </div>
                      <button type="button"
                        onClick={() => { setPhoneConflict(null); setNewPhone('') }}
                        className="w-full rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                        Clear &amp; Try Again
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* ── Assignment Preview Card — shown once tenant is selected ── */}
          {selectedTenant && assignMode === 'list' && (
            <div className="rounded-2xl border border-primary-200 bg-gradient-to-br from-primary-50 to-white p-4 space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-widest text-primary-500">Assignment Preview</p>
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-full bg-primary-600 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-white">{selectedTenant.name?.slice(0, 2).toUpperCase()}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-slate-800 truncate">{selectedTenant.name}</p>
                  <p className="text-[11px] text-slate-400">{selectedTenant.phone}</p>
                </div>
                <button type="button" onClick={() => setSelectedTenantId('')}
                  className="text-[10px] font-semibold text-primary-600 hover:text-primary-700 transition-colors shrink-0">
                  Change
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-white border border-primary-100 px-3 py-2.5">
                  <p className="text-[10px] text-slate-400 mb-0.5">Monthly Rent</p>
                  <p className="text-sm font-bold text-slate-800 tabular-nums">₹{estRent.toLocaleString('en-IN')}</p>
                  {room.rentType === 'per_room' && !rentOverride && (
                    <p className="text-[9px] text-slate-400 mt-0.5">Est. · locked at assign</p>
                  )}
                </div>
                <div className="rounded-xl bg-white border border-primary-100 px-3 py-2.5">
                  <p className="text-[10px] text-slate-400 mb-0.5">Move-in</p>
                  <p className="text-sm font-bold text-slate-800">
                    {moveInDate
                      ? new Date(moveInDate + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
                      : 'Today'}
                  </p>
                </div>
                <div className="rounded-xl bg-white border border-primary-100 px-3 py-2.5">
                  <p className="text-[10px] text-slate-400 mb-0.5">Grace Days</p>
                  <p className="text-sm font-bold text-slate-800">{dueDay}<span className="text-xs font-normal text-slate-400"> day{dueDay !== 1 ? 's' : ''} after start</span></p>
                </div>
              </div>
            </div>
          )}

          <div className="border-t border-slate-100" />

          {/* ── Section: Rent Summary ── */}
          <div className="space-y-2.5">
            <SectionHeader icon={IndianRupee} title="Rent Summary" />

            {bed.isExtra ? (() => {
              const effectiveRent = calculateRent({
                room: { baseRent, rentType: room.rentType },
                bed,
                normalOccupied: 0,
              }).finalRent
              return (
                <>
                  <div className="rounded-xl border border-violet-100 bg-violet-50/60 px-3.5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center rounded-full bg-violet-100 border border-violet-200 px-2 py-0.5 text-[9px] font-bold text-violet-600 uppercase tracking-wider">✦ Extra Bed</span>
                      <span className="text-[11px] text-slate-400">
                        {!bed.isChargeable ? 'Free' : bed.extraCharge > 0 ? 'Fixed charge' : 'Room base rent'}
                      </span>
                    </div>
                    <span className="text-base font-bold text-slate-800 tabular-nums">₹{effectiveRent.toLocaleString('en-IN')}<span className="text-xs font-normal text-slate-400">/mo</span></span>
                  </div>
                  {/* Advanced: override */}
                  {bed.isChargeable && (
                    <details className="group">
                      <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-700 select-none list-none">
                        <SlidersHorizontal size={11} className="group-open:rotate-90 transition-transform" />
                        Advanced Options
                      </summary>
                      <div className="mt-2 space-y-1.5">
                        <label className="label text-xs">Rent Override <span className="text-slate-400 font-normal">(optional)</span></label>
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">₹</span>
                          <input type="number" min="0" className="input text-sm py-1.5 pl-6 tabular-nums"
                            placeholder={`${effectiveRent} (default)`}
                            value={rentOverride} onChange={e => setRentOverride(e.target.value)} />
                        </div>
                        {rentOverride && <p className="text-[11px] text-amber-600 font-medium">⚡ Override active — extra bed pricing bypassed</p>}
                      </div>
                    </details>
                  )}
                </>
              )
            })() : (
              <>
                {room.rentType === 'per_room' ? (
                  /* Per-room: show split math */
                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-3.5 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-blue-500">Per Room · Split Equally</span>
                      <span className="text-[10px] bg-blue-100 text-blue-600 font-semibold px-2 py-0.5 rounded-full border border-blue-200">
                        ÷ {rentPreview?.futureOccupied ?? divisor} occupant{(rentPreview?.futureOccupied ?? divisor) !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <div className="rounded-lg bg-white border border-blue-100 px-2.5 py-2 text-center">
                        <p className="text-[9px] text-slate-400 mb-0.5">Room Rent</p>
                        <p className="text-sm font-bold text-slate-700 tabular-nums">₹{baseRent.toLocaleString('en-IN')}</p>
                      </div>
                      <div className="text-center text-slate-400 text-sm font-bold">÷ {divisor}</div>
                      <div className="rounded-lg bg-primary-600 px-2.5 py-2 text-center">
                        <p className="text-[9px] text-primary-200 mb-0.5">Your Share</p>
                        <p className="text-sm font-bold text-white tabular-nums">₹{splitPerPerson.toLocaleString('en-IN')}</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-blue-600/80 leading-relaxed">
                      Final amount is calculated at assignment and <span className="font-semibold">locked permanently</span>.
                    </p>
                  </div>
                ) : (
                  /* Per-bed: fixed */
                  <div className="rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Per Bed · Fixed</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Locked at assignment, does not change</p>
                    </div>
                    <span className="text-base font-bold text-slate-800 tabular-nums">₹{(rentOverride ? Number(rentOverride) : baseRent).toLocaleString('en-IN')}<span className="text-xs font-normal text-slate-400">/mo</span></span>
                  </div>
                )}

                {/* Advanced: override */}
                <details className="group">
                  <summary className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-slate-500 hover:text-slate-700 select-none list-none">
                    <SlidersHorizontal size={11} className="group-open:rotate-90 transition-transform" />
                    Advanced Options
                    {rentOverride && <span className="ml-1 text-[9px] font-bold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5">Override active</span>}
                  </summary>
                  <div className="mt-2 space-y-1.5">
                    <label className="label text-xs">Rent Override <span className="text-slate-400 font-normal">(optional — bypasses all auto-calculation)</span></label>
                    <div className="relative">
                      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">₹</span>
                      <input type="number" min="0" className="input text-sm py-1.5 pl-6 tabular-nums"
                        placeholder={`${baseRent} (default)`}
                        value={rentOverride} onChange={e => setRentOverride(e.target.value)} />
                    </div>
                    {rentOverride && <p className="text-[11px] text-amber-600 font-medium">⚡ Server will use this value instead of auto-calculation</p>}
                  </div>
                </details>
              </>
            )}
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Section: Move-in Date ── */}
          <div className="space-y-2.5">
            <SectionHeader icon={Calendar} title="Move-in Date" />
            {/* Quick chips */}
            <div className="grid grid-cols-4 gap-1.5">
              {quickDates.map(({ label, val }) => (
                <button key={label} type="button"
                  onClick={() => setMoveInDate(val)}
                  className={`rounded-xl py-2 text-[11px] font-semibold transition-all duration-150 ${
                    moveInDate === val
                      ? 'bg-primary-600 text-white shadow-sm shadow-primary-200/60'
                      : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-primary-300 hover:text-primary-600 hover:bg-primary-50/50'
                  }`}>
                  {label}
                </button>
              ))}
            </div>
            <input type="date" className="input text-sm py-1.5"
              value={moveInDate} onChange={e => setMoveInDate(e.target.value)} />
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Section: Grace Days ── */}
          <div className="space-y-2.5">
            <SectionHeader icon={Calendar} title="Grace Days" subtitle="Days after cycle start before rent is due" />
            <div className="grid grid-cols-6 gap-1.5">
              {[0, 3, 5, 7, 10, 15].map(d => (
                <button key={d} type="button"
                  onClick={() => setDueDay(d)}
                  className={`rounded-xl py-2 text-[11px] font-semibold transition-all duration-150 ${
                    dueDay === d
                      ? 'bg-primary-600 text-white shadow-sm shadow-primary-200/60'
                      : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-primary-300 hover:text-primary-600 hover:bg-primary-50/50'
                  }`}>
                  {d}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number" min="0" max="28"
                className="input text-sm py-1.5 w-24 tabular-nums"
                value={dueDay}
                onChange={e => {
                  const v = Math.min(28, Math.max(0, Number(e.target.value) || 0))
                  setDueDay(v)
                }}
              />
              <p className="text-[11px] text-slate-400">days after cycle start <span className="text-slate-500 font-medium">(0–28)</span></p>
            </div>
            <p className="text-[10px] text-slate-400 bg-slate-50 border border-slate-100 rounded-lg px-2.5 py-2 leading-relaxed">
              Billing cycle starts from the move-in date and repeats monthly on the same day.
            </p>
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Reservation Advance Disposition (only when coming from a reserved bed) ── */}
          {bed.status === 'reserved' && (bed.reservation?.reservationAmount ?? 0) > 0 && (() => {
            const rAmt  = bed.reservation.reservationAmount
            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="h-5 w-5 rounded-md bg-violet-100 flex items-center justify-center shrink-0">
                      <IndianRupee size={10} className="text-violet-600" />
                    </div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-violet-700">
                      Reservation Advance · ₹{rAmt.toLocaleString('en-IN')}
                    </p>
                  </div>
                  <p className="text-[10px] text-violet-500">How should this be applied?</p>
                </div>
                <div className="space-y-1.5">
                  {/* Option A — Adjust against first rent */}
                  <button type="button"
                    onClick={() => setAdvanceDisposition('adjust')}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${
                      advanceDisposition === 'adjust'
                        ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}>
                    <div className="flex items-center gap-2.5">
                      <RadioBtn value="adjust" active={advanceDisposition === 'adjust'} color="emerald" />
                      <div>
                        <p className={`text-xs font-bold ${advanceDisposition === 'adjust' ? 'text-emerald-800' : 'text-slate-700'}`}>
                          Offset against first rent
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          ₹{rAmt.toLocaleString('en-IN')} will auto-reduce the first billing cycle
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* Option B — Convert to security deposit */}
                  <button type="button"
                    onClick={() => setAdvanceDisposition('convert_deposit')}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${
                      advanceDisposition === 'convert_deposit'
                        ? 'border-blue-400 bg-blue-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}>
                    <div className="flex items-center gap-2.5">
                      <RadioBtn value="convert_deposit" active={advanceDisposition === 'convert_deposit'} color="blue" />
                      <div>
                        <p className={`text-xs font-bold ${advanceDisposition === 'convert_deposit' ? 'text-blue-800' : 'text-slate-700'}`}>
                          Convert to security deposit
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Moves ₹{rAmt.toLocaleString('en-IN')} from rent ledger into deposit balance
                        </p>
                      </div>
                    </div>
                  </button>

                  {/* Option C — Keep as ledger credit */}
                  <button type="button"
                    onClick={() => setAdvanceDisposition('keep')}
                    className={`w-full text-left rounded-xl border px-3 py-2.5 transition-all ${
                      advanceDisposition === 'keep'
                        ? 'border-amber-400 bg-amber-50 shadow-sm'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}>
                    <div className="flex items-center gap-2.5">
                      <RadioBtn value="keep" active={advanceDisposition === 'keep'} color="amber" />
                      <div>
                        <p className={`text-xs font-bold ${advanceDisposition === 'keep' ? 'text-amber-800' : 'text-slate-700'}`}>
                          Keep as ledger credit
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5">
                          Stays as a general credit — apply or refund manually later
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )
          })()}

          {/* ── Section: Security Deposit (toggle) ── */}
          <div className="rounded-xl border border-slate-200 overflow-hidden">
            {/* Toggle header */}
            <button type="button"
              onClick={() => { setDepositEnabled(v => !v); if (depositEnabled) setDepositInput('') }}
              className="w-full flex items-center justify-between px-3.5 py-3 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2.5">
                <div className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
                  depositEnabled ? 'bg-emerald-500' : 'bg-slate-200'
                }`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${
                    depositEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                  }`} />
                </div>
                <span className="text-sm font-semibold text-slate-700">Collect Security Deposit</span>
                {depositEnabled && depositInput && (
                  <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
                    ₹{Number(depositInput).toLocaleString('en-IN')}
                  </span>
                )}
              </div>
            </button>
            {/* Expanded content when toggle ON */}
            {depositEnabled && (
              <div className="px-3.5 pb-3.5 pt-1 border-t border-slate-100">
                <label className="label text-xs">Amount collected (₹)</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">₹</span>
                  <input type="number" min="1" className="input text-sm pl-7" placeholder="e.g. 5000"
                    value={depositInput} onChange={e => setDepositInput(e.target.value)} autoFocus />
                </div>
                {Number(depositInput) > 0 && (
                  <p className="text-[11px] text-emerald-700 font-medium mt-1.5">
                    ₹{Number(depositInput).toLocaleString('en-IN')} will be recorded as security deposit
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="border-t border-slate-100" />

          {/* ── Assign Button ── */}
          <div className="space-y-2 pb-1">
            <ActionButton
              icon={UserPlus}
              label={submitting || creatingTenant ? 'Assigning…' : 'Assign Tenant'}
              variant="primary"
              disabled={!canAssign}
              loading={submitting || creatingTenant}
              onClick={async () => {
                let tenantId = selectedTenantId

                if (assignMode === 'create' && !selectedTenantId) {
                  setCreatingTenant(true)
                  try {
                    // estRent already uses the /rent-preview API (which runs calculateRent
                    // server-side) or falls back to baseRent. The backend overwrites
                    // rentAmount anyway during assignBed → recalculateRoomRent.
                    const res = await createTenantApi(propertyId, {
                      name:        newName.trim(),
                      phone:       newPhone.trim(),
                      rentAmount:  estRent,
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
                    rentOverride:        rentOverride ? Number(rentOverride) : undefined,
                    moveInDate:          moveInDate || undefined,
                    deposit:             depositInput ? Number(depositInput) : undefined,
                    dueDate:             dueDay,
                    advanceDisposition:  bed.status === 'reserved' && (bed.reservation?.reservationAmount ?? 0) > 0
                                           ? advanceDisposition
                                           : undefined,
                  }),
                  'Tenant assigned successfully'
                )
              }}
            />
            {!hasSelection && (
              <p className="text-center text-[11px] text-slate-400">
                Select or create a tenant above to enable
              </p>
            )}
          </div>
        </div>
        )
      })()}

      {/* ── CANCEL RESERVATION ── */}
      {view === 'cancelReservation' && (() => {
        const advAmt    = bed.reservation?.reservationAmount ?? 0
        const advMode   = bed.reservation?.reservationMode   ?? null
        const hasAdv    = advAmt > 0
        const forfeitMode    = cancelForfeitMode
        const setForfeitMode = setCancelForfeitMode

        const doCancel = async () => {
          setSubmitting(true)
          try {
            await cancelReservationApi(propertyId, room._id, bed._id, {
              forfeit: forfeitMode === 'forfeit',
            })
            toast(forfeitMode === 'forfeit'
              ? 'Reservation cancelled — advance forfeited'
              : 'Reservation cancelled', 'success')
            onSuccess()
          } catch (err) {
            toast(err.response?.data?.message || 'Something went wrong', 'error')
          } finally {
            setSubmitting(false)
          }
        }

        return (
          <div className="space-y-4">

            {/* Header */}
            <div className="flex items-center gap-3 rounded-2xl bg-red-50 border border-red-200 px-4 py-3.5">
              <div className="h-9 w-9 rounded-xl bg-red-100 border border-red-200 flex items-center justify-center shrink-0">
                <X size={15} className="text-red-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-red-800">Cancel Reservation</p>
                <p className="text-[11px] text-red-700 mt-0.5 leading-relaxed">
                  {bed.reservation?.name
                    ? <><span className="font-semibold">{bed.reservation.name}</span>'s reservation will be removed</>
                    : 'This reservation will be removed and the bed freed'
                  }
                </p>
              </div>
            </div>

            {/* Advance handling (only shown when advance was collected) */}
            {hasAdv && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-slate-600">
                  Advance of ₹{advAmt.toLocaleString('en-IN')} was collected — what happens to it?
                </p>

                {/* Refund option */}
                <button type="button"
                  onClick={() => setForfeitMode('refund')}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                    forfeitMode === 'refund'
                      ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}>
                  <div className="flex items-center gap-2.5">
                    <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      forfeitMode === 'refund' ? 'border-emerald-500' : 'border-slate-300'
                    }`}>
                      {forfeitMode === 'refund' && <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" />}
                    </div>
                    <div>
                      <p className={`text-xs font-bold ${forfeitMode === 'refund' ? 'text-emerald-800' : 'text-slate-700'}`}>
                        Refund ₹{advAmt.toLocaleString('en-IN')} to tenant
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Mark advance as returned · Ledger reversed to zero
                      </p>
                    </div>
                  </div>
                </button>

                {/* Forfeit option */}
                <button type="button"
                  onClick={() => setForfeitMode('forfeit')}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
                    forfeitMode === 'forfeit'
                      ? 'border-red-400 bg-red-50 shadow-sm'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}>
                  <div className="flex items-center gap-2.5">
                    <div className={`h-4 w-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                      forfeitMode === 'forfeit' ? 'border-red-500' : 'border-slate-300'
                    }`}>
                      {forfeitMode === 'forfeit' && <span className="h-2 w-2 rounded-full bg-red-500 inline-block" />}
                    </div>
                    <div>
                      <p className={`text-xs font-bold ${forfeitMode === 'forfeit' ? 'text-red-800' : 'text-slate-700'}`}>
                        Forfeit — keep ₹{advAmt.toLocaleString('en-IN')}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Property retains the advance · No refund issued
                      </p>
                    </div>
                  </div>
                </button>

                {/* Mode note */}
                {advMode === 'refund' && forfeitMode === 'forfeit' && (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                    <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-700 leading-relaxed">
                      This advance was marked as "refundable on cancel." Forfeiting overrides that agreement.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* No advance — simple confirm */}
            {!hasAdv && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">No advance was collected — bed will be freed immediately.</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button type="button"
                className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
                onClick={() => setView(null)}>
                Keep Reservation
              </button>
              <button type="button" disabled={submitting}
                className={`flex-1 rounded-xl py-2.5 text-sm font-bold text-white transition-colors shadow-md disabled:opacity-50 active:scale-[0.98] ${
                  forfeitMode === 'forfeit'
                    ? 'bg-red-600 hover:bg-red-700 shadow-red-200/40'
                    : 'bg-slate-700 hover:bg-slate-800 shadow-slate-200/40'
                }`}
                onClick={doCancel}>
                {submitting ? 'Cancelling…' : forfeitMode === 'forfeit' ? 'Cancel & Forfeit' : 'Cancel & Refund'}
              </button>
            </div>
          </div>
        )
      })()}

      {/* ── USE DEPOSIT (mid-stay) ── */}
      {view === 'useDeposit' && (() => {
        const tenantName  = bed.tenant?.name ?? 'Tenant'
        const depositBal  = bed.tenant?.depositBalance ?? 0
        const adjustAmt   = Number(useDepositAmount) || 0
        const exceedsDeposit = adjustAmt > depositBal
        const canApply    = adjustAmt > 0 && !exceedsDeposit && !submitting

        return (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3 rounded-2xl bg-violet-50 border border-violet-200 px-4 py-3.5">
              <div className="h-9 w-9 rounded-xl bg-violet-100 border border-violet-200 flex items-center justify-center shrink-0">
                <IndianRupee size={14} className="text-violet-600" />
              </div>
              <div>
                <p className="text-sm font-bold text-violet-800">Apply Deposit Against Dues</p>
                <p className="text-[11px] text-violet-700 mt-0.5">
                  {tenantName} · Available balance ₹{depositBal.toLocaleString('en-IN')}
                </p>
              </div>
            </div>

            {/* Amount input */}
            <div className="space-y-2">
              <label className="label text-xs">Amount to Apply (₹)</label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs pointer-events-none">₹</span>
                <input type="number" min="1" max={depositBal}
                  className={`input text-sm py-1.5 pl-6 tabular-nums ${exceedsDeposit ? 'border-red-400 bg-red-50/30' : ''}`}
                  placeholder={depositBal.toString()}
                  value={useDepositAmount}
                  onChange={e => setUseDepositAmount(e.target.value)}
                  autoFocus />
              </div>
              {exceedsDeposit && (
                <p className="text-[11px] text-red-500 font-medium">
                  Cannot exceed deposit balance ₹{depositBal.toLocaleString('en-IN')}
                </p>
              )}
              {adjustAmt > 0 && !exceedsDeposit && (
                <p className="text-[11px] text-violet-700 font-medium">
                  ₹{adjustAmt.toLocaleString('en-IN')} will be applied against outstanding dues
                  · Remaining balance: ₹{Math.max(0, depositBal - adjustAmt).toLocaleString('en-IN')}
                </p>
              )}
            </div>

            <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-2.5">
              <p className="text-[11px] text-slate-500 leading-relaxed">
                This applies the deposit balance directly against pending rent records.
                Any unapplied deposit balance is retained for vacate time.
              </p>
            </div>

            {/* Buttons */}
            <div className="flex gap-2.5 pt-1">
              <button className="btn-secondary flex-1" onClick={() => setView('actions')}>Cancel</button>
              <button
                className="flex-1 rounded-xl border border-violet-600 bg-violet-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-violet-700 transition-all duration-200 active:scale-[0.96] disabled:opacity-50"
                disabled={!canApply}
                onClick={async () => {
                  setSubmitting(true)
                  try {
                    const res = await midStayDepositAdjustApi(propertyId, room._id, bed._id, {
                      amount: adjustAmt || undefined,
                    })
                    toast(res.data?.message || 'Deposit applied successfully', 'success')
                    setUseDepositAmount('')
                    onSuccess()
                  } catch (err) {
                    toast(err.response?.data?.message || 'Failed to apply deposit', 'error')
                  } finally {
                    setSubmitting(false)
                  }
                }}
              >
                {submitting ? 'Applying…' : `Apply ₹${adjustAmt > 0 ? adjustAmt.toLocaleString('en-IN') : depositBal.toLocaleString('en-IN')}`}
              </button>
            </div>
          </div>
        )
      })()}

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

        const isBlocked    = !!(resTenantId && resSelectedTenant?.bed)
        const tenantReady  = !!resSelectedTenant && !isBlocked
        const durationReady = !!reservedTill
        const canReserve   = tenantReady && durationReady && !submitting

        const STEPS = ['Tenant', 'Duration', 'Confirm']
        const STEP_KEYS = ['tenant', 'duration', 'confirm']
        const currentStepIdx = STEP_KEYS.indexOf(resStep)

        const holdDays = reservedTill
          ? Math.max(1, Math.round((new Date(reservedTill) - new Date()) / 86400000))
          : 0

        const advAmt = resAdvanceEnabled && resAdvanceAmount ? Number(resAdvanceAmount) : 0

        const doReserve = async (opts = {}) => {
          setSubmitting(true)
          try {
            await reserveBedApi(propertyId, room._id, bed._id, {
              reservedTill,
              ...(resTenantId
                ? { tenantId: resTenantId }
                : { name: resSelectedTenant.name, phone: resSelectedTenant.phone }
              ),
              ...(resMoveIn       && { moveInDate: resMoveIn }),
              ...(resNotes.trim() && { notes: resNotes.trim() }),
              ...(advAmt > 0 && { reservationAmount: advAmt, reservationMode: resAdvanceMode }),
              ...opts,
            })
            toast(opts.replace ? 'Reservation replaced' : 'Bed reserved', 'success')
            onSuccess()
          } catch (err) {
            const code = err.response?.data?.code
            if (code === 'TENANT_ALREADY_RESERVED') {
              setResExistingReservation(err.response.data.existingReservation)
            } else {
              toast(err.response?.data?.message || 'Something went wrong', 'error')
            }
          } finally {
            setSubmitting(false)
          }
        }

        // ── Conflict overlay — replaces entire step flow ──────────────────────
        if (resExistingReservation) {
          const er = resExistingReservation
          const tillDate = er.reservedTill
            ? new Date(er.reservedTill).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
            : null

          return (
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-center gap-3 rounded-2xl bg-amber-50 border border-amber-200 px-4 py-4">
                <div className="h-9 w-9 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-800">Reservation conflict</p>
                  <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                    <span className="font-semibold">{resSelectedTenant?.name}</span> already holds
                    Bed {er.bedNumber}{er.roomNumber ? `, Room ${er.roomNumber}` : ''}
                    {tillDate ? ` until ${tillDate}` : ''}
                  </p>
                </div>
              </div>

              {/* What replace means */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5 space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">If you replace</p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0 inline-block" />
                    Bed {er.bedNumber} reservation will be cancelled
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0 inline-block" />
                    {resSelectedTenant?.name} will hold this bed instead
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <button type="button"
                  className="flex-1 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors shadow-sm"
                  onClick={() => setResExistingReservation(null)}>
                  Keep Existing
                </button>
                <button type="button" disabled={submitting}
                  className="flex-1 rounded-xl bg-amber-500 hover:bg-amber-600 py-2.5 text-sm font-bold text-white transition-colors shadow-md shadow-amber-200/40 disabled:opacity-50 active:scale-[0.98]"
                  onClick={() => doReserve({ tenantId: resTenantId, replace: true })}>
                  {submitting ? 'Replacing…' : 'Replace & Reserve'}
                </button>
              </div>
            </div>
          )
        }

        return (
          <div className="space-y-4">

            {/* ── Compact hero ── */}
            <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 to-orange-400 px-4 py-3 shadow-sm shadow-amber-200/40">
              <div className="absolute inset-0 opacity-10"
                style={{ backgroundImage: 'radial-gradient(circle at 75% 10%, white 0%, transparent 55%)' }} />
              <div className="relative flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
                    <CalendarClock size={15} className="text-white" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-white leading-tight">
                      Room {room.roomNumber} · Bed {bed.bedNumber}
                    </p>
                    <p className="text-[10px] text-amber-100 capitalize">
                      {room.type ?? 'Room'} · {room.capacity} {room.capacity === 1 ? 'bed' : 'beds'}
                    </p>
                  </div>
                </div>
                <span className="shrink-0 text-[9px] font-black uppercase tracking-widest text-amber-700 bg-white/90 rounded-full px-2.5 py-1">
                  Hold Mode
                </span>
              </div>
            </div>

            {/* ── Step indicator ── */}
            <div className="relative flex items-start justify-between px-1">
              {/* Track line */}
              <div className="absolute top-3.5 left-5 right-5 h-0.5 bg-slate-100 -z-0" />
              <div
                className="absolute top-3.5 left-5 h-0.5 bg-amber-400 transition-all duration-500 -z-0"
                style={{ width: currentStepIdx === 0 ? '0%' : currentStepIdx === 1 ? '50%' : '100%' }}
              />
              {STEPS.map((label, i) => {
                const done   = i < currentStepIdx
                const active = i === currentStepIdx
                return (
                  <div key={label} className="relative flex flex-col items-center gap-1.5 z-10">
                    <div className={`h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 border-2
                      ${done   ? 'bg-amber-500 border-amber-500 text-white' :
                        active ? 'bg-white border-amber-500 text-amber-600 shadow-md shadow-amber-100' :
                                 'bg-white border-slate-200 text-slate-300'}`}>
                      {done ? <CheckCircle2 size={14} /> : i + 1}
                    </div>
                    <span className={`text-[9px] font-bold uppercase tracking-wide transition-colors ${
                      active ? 'text-amber-600' : done ? 'text-amber-400' : 'text-slate-300'
                    }`}>{label}</span>
                  </div>
                )
              })}
            </div>

            {/* ══ STEP 1 — SELECT TENANT ══════════════════════════════════════ */}
            {resStep === 'tenant' && (
              <div className="space-y-3">

                {/* STATE 1 — LIST MODE (kept in DOM; fades out so exit is animated) */}
                <div className="relative">
                  <div
                    aria-hidden={resMode === 'create'}
                    className={`transition-opacity duration-150 ${
                      resMode === 'create'
                        ? 'opacity-0 pointer-events-none absolute inset-x-0 top-0'
                        : 'opacity-100'
                    }`}
                  >
                    <TenantSearch
                      propertyId={propertyId}
                      assignable
                      excludeReserved
                      selectedId={resTenantId}
                      onSelect={t => {
                        setResTenantId(t._id)
                        setResSelectedTenant(t)
                        setResExistingReservation(null)
                      }}
                      onAddNew={q => {
                        setResMode('create')
                        setNewName(''); setNewPhone(''); setPhoneConflict(null)
                        // Autofill: phone if mostly digits, else name
                        if (q) {
                          const digits = q.replace(/\D/g, '')
                          if (digits.length >= 6) setNewPhone(q)
                          else setNewName(q)
                        }
                      }}
                    />
                  </div>

                {/* STATE 2 — CREATE MODE */}
                {resMode === 'create' && (
                  <div className="animate-modeIn rounded-xl border bg-white overflow-hidden border-primary-200">

                    {/* ── Header bar ── */}
                    <div className="flex items-center justify-between px-3.5 py-2.5 bg-primary-50/60 border-b border-primary-100">
                      <p className="text-xs font-bold text-primary-700">
                        {phoneConflict ? 'Tenant found' : 'New Tenant'}
                      </p>
                      <button type="button"
                        onClick={() => {
                          setResMode('list')
                          setNewName(''); setNewPhone(''); setPhoneConflict(null)
                        }}
                        className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition-colors">
                        Cancel
                      </button>
                    </div>

                    {/* ── FLOW A: No conflict — show create form ── */}
                    {!phoneConflict && (
                      <div className="p-3.5 space-y-2.5">
                        <div>
                          <label className="label text-xs">Full Name *</label>
                          <input className="input text-sm" placeholder="e.g. Rahul Sharma"
                            value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
                        </div>
                        <div>
                          <label className="label text-xs">Phone Number *</label>
                          <div className="relative">
                            <PhoneInput
                              value={newPhone}
                              onChange={val => {
                                setNewPhone(val)
                                setPhoneConflict(null)
                                clearTimeout(phoneDebounceRef.current)
                                const digits = val.replace(/\D/g, '')
                                if (digits.length < 6) return
                                setPhoneChecking(true)
                                phoneDebounceRef.current = setTimeout(() => {
                                  searchTenantsApi(propertyId, { phone: val.trim() })
                                    .then(r => {
                                      const conflict = (r.data?.data ?? []).find(
                                        t => t.status === 'active' || t.status === 'notice' || t.status === 'reserved'
                                      )
                                      setPhoneConflict(conflict ?? null)
                                    })
                                    .catch(() => {})
                                    .finally(() => setPhoneChecking(false))
                                }, 500)
                              }}
                              placeholder="Mobile number"
                            />
                            {phoneChecking && (
                              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-slate-400 animate-pulse">
                                checking…
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex gap-2 pt-0.5">
                          <button type="button"
                            onClick={() => { setResMode('list'); setNewName(''); setNewPhone(''); setPhoneConflict(null) }}
                            className="flex-1 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                            Cancel
                          </button>
                          <button type="button"
                          disabled={!newName.trim() || !newPhone || phoneChecking || creatingTenant}
                          className="flex-1 rounded-xl bg-primary-600 hover:bg-primary-700 py-2 text-xs font-bold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                          onClick={async () => {
                            setCreatingTenant(true)
                            try {
                              const res = await createTenantApi(propertyId, {
                                name:   newName.trim(),
                                phone:  newPhone.trim(),
                                status: 'reserved',
                              })
                              const newTenant = res.data?.data ?? res.data
                              setResTenantId(newTenant._id)
                              setResSelectedTenant(newTenant)
                              setResMode('list')
                              setNewName(''); setNewPhone(''); setPhoneConflict(null)
                              setResStep('duration')
                            } catch (err) {
                              toast(err.response?.data?.message || 'Failed to create tenant', 'error')
                            } finally {
                              setCreatingTenant(false)
                            }
                          }}>
                          {creatingTenant && (
                            <svg className="animate-spin h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                          )}
                          {creatingTenant ? 'Creating…' : 'Create & Continue'}
                          </button>
                        </div>
                      </div>
                    )}

                    {/* ── FLOW B: Conflict — replace form with existing tenant card ── */}
                    {phoneConflict && (() => {
                      const isAssigned = !!phoneConflict.bed
                      const canSelect  = !isAssigned

                      return (
                        <div className="p-3.5 space-y-3">
                          {/* "Tenant already exists" warning — only when not assigned */}
                          {!isAssigned && (
                            <div className="flex items-start gap-2">
                              <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-amber-700">Tenant already exists</p>
                                <p className="text-[11px] text-amber-600 mt-0.5">
                                  A tenant with this phone number is already in the system.
                                </p>
                              </div>
                            </div>
                          )}

                          {/* Existing tenant card */}
                          <div className={`flex items-center gap-3 rounded-xl px-3.5 py-3 border
                            ${isAssigned
                              ? 'bg-slate-50 border-slate-200 opacity-70'
                              : 'bg-emerald-50 border-emerald-200'}`}>
                            <div className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 text-sm font-black
                              ${isAssigned ? 'bg-slate-200 text-slate-400' : 'bg-emerald-500 text-white shadow-sm'}`}>
                              {phoneConflict.name?.charAt(0)?.toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className={`text-sm font-bold truncate ${isAssigned ? 'text-slate-500' : 'text-slate-800'}`}>
                                {phoneConflict.name}
                              </p>
                              <p className="text-[11px] text-slate-400 tabular-nums">{phoneConflict.phone}</p>
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[phoneConflict.status] ?? STATUS_BADGE.vacated}`}>
                                  {STATUS_LABEL[phoneConflict.status] ?? phoneConflict.status}
                                </span>
                                {isAssigned && (
                                  <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                    Bed {phoneConflict.bed.bedNumber} · assigned
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Assigned warning — cannot select */}
                          {isAssigned && (
                            <div className="flex items-start gap-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
                              <AlertTriangle size={12} className="text-slate-400 shrink-0 mt-0.5" />
                              <p className="text-[11px] text-slate-500 leading-relaxed">
                                This tenant is already assigned to a bed and cannot be selected for reservation.
                                If this is a different person, clear the phone number and create a new entry.
                              </p>
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex gap-2">
                            <button type="button"
                              onClick={() => { setPhoneConflict(null); setNewPhone('') }}
                              className="flex-1 rounded-xl border border-slate-200 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                              Different person
                            </button>
                            {canSelect && (
                              <button type="button"
                                onClick={() => {
                                  setResTenantId(phoneConflict._id)
                                  setResSelectedTenant(phoneConflict)
                                  setResMode('list')
                                  setNewName(''); setNewPhone(''); setPhoneConflict(null)
                                }}
                                className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 py-2 text-xs font-bold text-white transition-colors shadow-sm">
                                Select Existing
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
                </div>{/* end .relative wrapper */}

                {/* Blocked: selected tenant already occupies a bed */}
                {isBlocked && (
                  <div className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3">
                    <Ban size={13} className="text-red-500 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-red-700 leading-relaxed">
                      <span className="font-bold">{resSelectedTenant.name}</span> is in Bed {resSelectedTenant.bed.bedNumber}. Vacate them first.
                    </p>
                  </div>
                )}

                {/* Step footer */}
                <div className="flex gap-2 pt-1">
                  <button type="button"
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
                    onClick={() => setView('actions')}>
                    Cancel
                  </button>
                  <button type="button" disabled={!tenantReady}
                    className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white bg-amber-500 hover:bg-amber-600
                      disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-amber-200/50 active:scale-[0.98]"
                    onClick={() => setResStep('duration')}>
                    Continue →
                  </button>
                </div>
              </div>
            )}

            {/* ══ STEP 2 — SELECT DURATION ════════════════════════════════════ */}
            {resStep === 'duration' && (
              <div className="space-y-4">
                {/* Quick chips */}
                <div className="grid grid-cols-4 gap-2">
                  {quickDays.map(({ label, val }) => {
                    const active = reservedTill === addDays(val)
                    return (
                      <button key={val} type="button"
                        onClick={() => setReservedTill(addDays(val))}
                        className={`rounded-xl py-2.5 text-xs font-bold transition-all duration-150 ${
                          active
                            ? 'bg-amber-500 text-white shadow-md shadow-amber-200/60 scale-[1.02]'
                            : 'bg-slate-50 border border-slate-200 text-slate-500 hover:border-amber-300 hover:text-amber-600 hover:bg-amber-50/40'
                        }`}>
                        {label}
                      </button>
                    )
                  })}
                </div>

                {/* Date pickers + release info */}
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3.5 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label text-xs">Hold Until *</label>
                      <input type="date" className="input text-sm" autoFocus
                        min={new Date(Date.now() + 86400000).toISOString().split('T')[0]}
                        value={reservedTill} onChange={e => setReservedTill(e.target.value)} />
                    </div>
                    <div>
                      <label className="label text-xs">
                        Move-in <span className="font-normal text-slate-400">(optional)</span>
                      </label>
                      <input type="date" className="input text-sm"
                        value={resMoveIn} onChange={e => setResMoveIn(e.target.value)} />
                    </div>
                  </div>

                  {reservedTill && (
                    <div className="flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-2">
                      <CalendarClock size={11} className="text-amber-500 shrink-0" />
                      <p className="text-[11px] text-amber-700 font-medium">
                        Auto-released on{' '}
                        <span className="font-bold">
                          {new Date(reservedTill).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                        {holdDays > 0 && <span className="text-amber-600 font-normal"> · {holdDays} day{holdDays !== 1 ? 's' : ''}</span>}
                      </p>
                    </div>
                  )}
                </div>

                {/* ── Collect Reservation Amount (toggle) ── */}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  {/* Toggle header */}
                  <button type="button"
                    onClick={() => { setResAdvanceEnabled(v => !v); if (resAdvanceEnabled) setResAdvanceAmount('') }}
                    className="w-full flex items-center justify-between px-3.5 py-3 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-2.5">
                      <div className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors duration-200 ${
                        resAdvanceEnabled ? 'bg-emerald-500' : 'bg-slate-200'
                      }`}>
                        <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200 ${
                          resAdvanceEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                        }`} />
                      </div>
                      <span className="text-sm font-semibold text-slate-700">Collect Reservation Amount</span>
                      {resAdvanceEnabled && resAdvanceAmount && (
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          ₹{Number(resAdvanceAmount).toLocaleString('en-IN')}
                        </span>
                      )}
                    </div>
                  </button>

                  {/* Expanded content when toggle ON */}
                  {resAdvanceEnabled && (
                    <div className="px-3.5 pb-3.5 pt-1 border-t border-slate-100 space-y-3">
                      <div>
                        <label className="label text-xs">Amount collected (₹)</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">₹</span>
                          <input type="number" min="1" className="input text-sm pl-7" placeholder="e.g. 2000"
                            value={resAdvanceAmount} onChange={e => setResAdvanceAmount(e.target.value)} autoFocus />
                        </div>
                      </div>
                      <div>
                        <label className="label text-xs mb-1.5">Apply as</label>
                        <div className="flex gap-2">
                          {[
                            { value: 'adjust', label: 'Adjust against rent', hint: 'Deducted from first month' },
                            { value: 'refund', label: 'Refund on cancel',    hint: 'Returned if reservation cancelled' },
                          ].map(opt => (
                            <button key={opt.value} type="button"
                              onClick={() => setResAdvanceMode(opt.value)}
                              className={`flex-1 rounded-xl border px-3 py-2.5 text-left transition-all ${
                                resAdvanceMode === opt.value
                                  ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                                  : 'border-slate-200 bg-white hover:border-slate-300'
                              }`}>
                              <p className={`text-xs font-bold ${resAdvanceMode === opt.value ? 'text-emerald-800' : 'text-slate-700'}`}>
                                {opt.label}
                              </p>
                              <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{opt.hint}</p>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Step footer */}
                <div className="flex gap-2">
                  <button type="button"
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
                    onClick={() => setResStep('tenant')}>
                    ← Back
                  </button>
                  <button type="button" disabled={!durationReady}
                    className="flex-1 rounded-xl py-2.5 text-sm font-bold text-white bg-amber-500 hover:bg-amber-600
                      disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-amber-200/50 active:scale-[0.98]"
                    onClick={() => setResStep('confirm')}>
                    Review →
                  </button>
                </div>
              </div>
            )}

            {/* ══ STEP 3 — CONFIRM ════════════════════════════════════════════ */}
            {resStep === 'confirm' && (
              <div className="space-y-3">
                {/* ── Summary pills ── */}
                <div className="space-y-2">

                  {/* Tenant pill */}
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                    <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shrink-0 shadow-sm">
                      <span className="text-xs font-black text-white">
                        {resSelectedTenant?.name?.charAt(0)?.toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{resSelectedTenant?.name}</p>
                      <p className="text-[11px] text-slate-400">{resSelectedTenant?.phone}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_BADGE[resSelectedTenant?.status] ?? STATUS_BADGE.vacated}`}>
                        {STATUS_LABEL[resSelectedTenant?.status] ?? resSelectedTenant?.status}
                      </span>
                      <button type="button"
                        onClick={() => setResStep('tenant')}
                        className="text-[11px] font-semibold text-primary-600 hover:text-primary-700 transition-colors">
                        Edit
                      </button>
                    </div>
                  </div>

                  {/* Duration pill */}
                  <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3">
                    <div className="h-8 w-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                      <CalendarClock size={14} className="text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800">
                        Until {new Date(reservedTill).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {holdDays} day{holdDays !== 1 ? 's' : ''} hold
                        {resMoveIn && ` · Move-in ${new Date(resMoveIn).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`}
                      </p>
                    </div>
                    <button type="button"
                      onClick={() => setResStep('duration')}
                      className="shrink-0 text-[11px] font-semibold text-primary-600 hover:text-primary-700 transition-colors">
                      Edit
                    </button>
                  </div>

                  {/* Advance pill — only shown if advance was entered */}
                  {advAmt > 0 && (
                    <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3">
                      <div className="h-8 w-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                        <IndianRupee size={14} className="text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-emerald-800">
                          ₹{advAmt.toLocaleString('en-IN')} advance collected
                        </p>
                        <p className="text-[11px] text-emerald-600">
                          {resAdvanceMode === 'adjust'
                            ? 'Will be adjusted against first month rent'
                            : 'Will be refunded if reservation is cancelled'}
                        </p>
                      </div>
                      <button type="button"
                        onClick={() => setResStep('duration')}
                        className="shrink-0 text-[11px] font-semibold text-primary-600 hover:text-primary-700 transition-colors">
                        Edit
                      </button>
                    </div>
                  )}
                </div>

                {/* ── Rent preview ── */}
                {rentPreviewLoading ? (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/40 px-3.5 py-3 flex items-center gap-2.5">
                    <Spinner />
                    <span className="text-[11px] text-slate-400">Calculating estimate…</span>
                  </div>
                ) : rentPreview ? (() => {
                  const rp = rentPreview
                  const typeLabel = rp.isExtra ? 'Extra Bed' : rp.rentType === 'per_room' ? 'Per Room' : 'Per Bed'
                  const isPerRoom = rp.rentType === 'per_room' && !rp.isExtra
                  return (
                    <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                          <IndianRupee size={9} /> Expected Rent
                        </p>
                        <span className="text-[9px] font-semibold text-slate-400 bg-slate-100 rounded-full px-2 py-0.5">
                          {typeLabel}
                        </span>
                      </div>

                      <div className="flex items-end justify-between gap-2">
                        <div>
                          <p className="text-2xl font-black text-slate-800 leading-none tabular-nums">
                            {rp.finalRent === 0
                              ? <span className="text-emerald-600">Free</span>
                              : <>₹{rp.finalRent.toLocaleString('en-IN')}<span className="text-sm font-semibold text-slate-400">/mo</span></>
                            }
                          </p>
                          <p className="text-[11px] text-slate-400 mt-1">{rp.formula}</p>
                        </div>
                        {isPerRoom && (
                          <div className="text-right shrink-0">
                            <p className="text-[10px] text-slate-400">Base</p>
                            <p className="text-sm font-bold text-slate-600">₹{rp.baseRent.toLocaleString('en-IN')}</p>
                          </div>
                        )}
                      </div>

                      {rp.isOverCapacity && (
                        <div className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5">
                          <AlertTriangle size={10} className="text-amber-500 shrink-0" />
                          <p className="text-[10px] text-amber-700 font-medium">
                            Over capacity — rent split may change at assignment
                          </p>
                        </div>
                      )}

                      <p className="text-[10px] text-slate-400 border-t border-slate-100 pt-2">
                        Final rent locked at time of assignment
                      </p>
                    </div>
                  )
                })() : null}

                {/* ── Notes — collapsible ── */}
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <button type="button"
                    onClick={() => setResNotesOpen(v => !v)}
                    className="w-full flex items-center justify-between px-3.5 py-2.5 hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                      <StickyNote size={13} className="text-slate-400" />
                      Notes
                      {resNotes.trim() && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                      )}
                    </div>
                    <span className="text-[10px] text-slate-400 font-medium">
                      {resNotesOpen ? 'Hide ▲' : 'Add ▼'}
                    </span>
                  </button>
                  {resNotesOpen && (
                    <div className="px-3.5 pb-3 border-t border-slate-100">
                      <textarea
                        className="input text-sm mt-2.5 resize-none"
                        rows={2}
                        placeholder="e.g. Referred by existing tenant, preferred move-in time…"
                        value={resNotes}
                        onChange={e => setResNotes(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {/* Step footer */}
                <div className="flex gap-2 pt-1">
                  <button type="button"
                    className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-500 hover:bg-slate-50 transition-colors"
                    onClick={() => setResStep('duration')}>
                    ← Back
                  </button>
                  <button type="button" disabled={!canReserve}
                    className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white transition-all
                      bg-amber-500 hover:bg-amber-600 shadow-md shadow-amber-200/50
                      disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none active:scale-[0.98]"
                    onClick={() => doReserve()}>
                    <CalendarClock size={15} />
                    {submitting ? 'Reserving…' : 'Reserve Bed'}
                  </button>
                </div>
              </div>
            )}

          </div>
        )
      })()}

      {/* ── REMOVE EXTRA BED CONFIRM ── */}
      {view === 'confirmDeleteExtra' && (() => {
        // Hard block: safety net for states that should not reach this view
        const isOccupied = bed.status === 'occupied'
        const isReserved = bed.status === 'reserved'
        const isBlocked  = isOccupied || isReserved

        if (isBlocked) {
          return (
            <div className="space-y-4">
              <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
                <div className="h-8 w-8 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center shrink-0">
                  <AlertTriangle size={15} className="text-amber-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-amber-800">Cannot remove this bed</p>
                  <p className="text-[11px] text-amber-700 mt-1 leading-relaxed">
                    {isOccupied
                      ? 'Vacate the tenant before removing this extra bed.'
                      : 'Cancel the reservation before removing this extra bed.'}
                  </p>
                </div>
              </div>
              <button className="btn-secondary w-full" onClick={() => setView('actions')}>← Back</button>
            </div>
          )
        }

        return (
          <div className="space-y-4">

            {/* Bed identity */}
            <div className="flex items-center gap-3.5 rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50 to-white px-4 py-3.5">
              <div className="h-11 w-11 rounded-xl bg-violet-100 border border-violet-200 flex items-center justify-center shrink-0">
                <span className="text-base font-black text-violet-600">{bed.bedNumber}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800">Extra Bed {bed.bedNumber}</p>
                <p className="text-xs text-slate-400 mt-0.5">Room {room.roomNumber}</p>
              </div>
              <div className="shrink-0 text-right">
                {bed.isChargeable
                  ? <p className="text-xs font-bold text-slate-600">
                      {bed.extraCharge > 0 ? `₹${bed.extraCharge.toLocaleString('en-IN')}/mo` : 'Base rent'}
                    </p>
                  : <p className="text-xs font-semibold text-emerald-600">Free</p>
                }
                <p className="text-[9px] text-slate-400 mt-0.5">
                  {bed.isChargeable ? 'Chargeable' : 'Not chargeable'}
                </p>
              </div>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-3.5 py-3">
              <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-red-700">Remove Extra Bed {bed.bedNumber}?</p>
                <p className="text-[11px] text-red-600 mt-0.5 leading-relaxed">
                  This bed will be permanently removed from Room {room.roomNumber}.
                  {occupancy && occupancy.total > room.capacity
                    ? ' Removing it will reduce the over-capacity count.'
                    : ' A new extra bed can be added later if needed.'}
                </p>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setView('actions')}>Cancel</button>
              <button
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-red-600 border border-red-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-700 transition-all duration-150 active:scale-[0.96] disabled:opacity-50"
                disabled={submitting}
                onClick={() => call(
                  () => deleteBedApi(propertyId, room._id, bed._id),
                  `Extra bed ${bed.bedNumber} removed`
                )}
              >
                <Trash2 size={14} />
                {submitting ? 'Removing…' : 'Remove Extra Bed'}
              </button>
            </div>
          </div>
        )
      })()}

      {/* ── CHANGE ROOM ── */}
      {view === 'changeRoom' && (() => {
        const otherRooms   = allRooms.filter(r => r._id !== room._id && r.isActive !== false && r.status === 'available')
        const targetRoom   = otherRooms.find(r => r._id === targetRoomId) ?? null
        const vacantBeds   = allTargetBeds.filter(b => b.status === 'vacant')

        const tenantName   = bed.tenant?.name ?? 'Tenant'
        const tenantGender = bed.tenant?.gender
        const currentRent  = bed.tenant?.rentAmount ?? 0
        const sameRoom     = targetRoomId === room._id

        // Gender mismatch: target room has explicit gender that doesn't match tenant
        const genderMismatch = targetRoom &&
          targetRoom.gender !== 'unisex' &&
          tenantGender && tenantGender !== 'unisex' &&
          targetRoom.gender !== tenantGender

        const canConfirm = !!selectedBedId && !genderMismatch && !submitting

        return (
        <div className="space-y-4">

          {/* ── Tenant identity card ── */}
          <div className="flex items-center gap-3.5 rounded-2xl border border-slate-100 bg-gradient-to-r from-slate-50/80 to-white px-4 py-3.5 shadow-sm">
            <div className="h-11 w-11 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center shrink-0 shadow-md">
              <span className="text-sm font-bold text-white tracking-wide">
                {tenantName.slice(0, 2).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{tenantName}</p>
              <p className="text-xs text-slate-400 mt-0.5">Room {room.roomNumber} · Bed {bed.bedNumber}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-[10px] text-slate-400 mb-0.5">Current Rent</p>
              <p className="text-sm font-bold text-slate-700">₹{currentRent.toLocaleString('en-IN')}</p>
            </div>
          </div>

          {/* ── Target room selector ── */}
          <div className="space-y-1.5">
            <SectionHeader icon={Home} title="Target Room" />
            {otherRooms.length === 0 ? (
              <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3">
                <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                <p className="text-xs text-amber-700 font-medium">No other available rooms in this property.</p>
              </div>
            ) : (
              <select
                className="input text-sm"
                value={targetRoomId}
                onChange={e => { setTargetRoomId(e.target.value); setSelectedBedId('') }}
              >
                <option value="">Choose a room…</option>
                {otherRooms.map(r => (
                  <option key={r._id} value={r._id}>
                    Room {r.roomNumber}
                    {r.floor !== undefined ? ` · Fl.${r.floor}` : ''}
                    {` · `}{r.type}
                    {` · ₹`}{r.baseRent?.toLocaleString('en-IN')}
                    {r.gender !== 'unisex' ? ` · ${r.gender}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* ── Bed grid ── */}
          {targetRoomId && (
            <div className="space-y-1.5">
              <SectionHeader icon={BedDouble} title="Select Bed" subtitle="Vacant beds only" />
              {bedsLoading ? (
                <div className="grid grid-cols-5 gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-14 rounded-xl bg-slate-50 border border-slate-200 animate-pulse" />
                  ))}
                </div>
              ) : vacantBeds.length === 0 ? (
                <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3">
                  <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                  <p className="text-xs text-amber-700 font-medium">No vacant beds in this room.</p>
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-2">
                  {vacantBeds.map(b => {
                    const isSelected = selectedBedId === b._id
                    return (
                      <button
                        key={b._id}
                        type="button"
                        onClick={() => setSelectedBedId(isSelected ? '' : b._id)}
                        className={`
                          relative flex flex-col items-center justify-center gap-1
                          rounded-xl border px-2 py-2.5 transition-all duration-150
                          focus:outline-none active:scale-95
                          ${isSelected
                            ? 'border-emerald-400 bg-emerald-50 ring-2 ring-emerald-200/70 shadow-sm'
                            : 'border-emerald-200 bg-emerald-50/60 hover:scale-[1.04] hover:border-emerald-300'
                          }
                        `}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span className="text-xs font-bold leading-none text-emerald-700">
                          {b.bedNumber}
                        </span>
                        {b.isExtra && (
                          <span className="text-[9px] text-slate-400 font-medium leading-none">Extra</span>
                        )}
                        {isSelected && (
                          <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 border-2 border-white">
                            <CheckCircle2 size={9} className="text-white" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Gender mismatch warning — blocks confirm ── */}
          {genderMismatch && (
            <div className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 px-3.5 py-3">
              <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold text-red-700">Gender mismatch — cannot move</p>
                <p className="text-[11px] text-red-600 mt-0.5 leading-relaxed">
                  Tenant is <span className="font-semibold capitalize">{tenantGender}</span> but the target room
                  only accepts <span className="font-semibold capitalize">{targetRoom?.gender}</span> tenants.
                </p>
              </div>
            </div>
          )}

          {/* ── Rent preview — shown once a bed is selected ── */}
          {selectedBedId && targetRoom && !genderMismatch && (
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-50 border-b border-slate-100">
                <IndianRupee size={12} className="text-primary-500" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Rent Preview</span>
              </div>
              <div className="px-4 py-3.5 space-y-2.5">
                <div className="flex items-center gap-3">
                  <div className="flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center">
                    <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider mb-1">Current</p>
                    <p className="text-lg font-extrabold text-slate-700 tabular-nums leading-none">
                      ₹{currentRent.toLocaleString('en-IN')}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">Room {room.roomNumber}</p>
                  </div>
                  <ArrowRightLeft size={15} className="text-slate-300 shrink-0" />
                  <div className="flex-1 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-center">
                    <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider mb-1">New</p>
                    {crRentLoading ? (
                      <div className="h-7 flex items-center justify-center">
                        <div className="h-4 w-16 rounded bg-blue-200/60 animate-pulse mx-auto" />
                      </div>
                    ) : crRentPreview ? (
                      <p className="text-lg font-extrabold text-blue-700 tabular-nums leading-none">
                        ₹{crRentPreview.finalRent?.toLocaleString('en-IN')}
                      </p>
                    ) : (
                      <p className="text-sm font-semibold text-blue-400">—</p>
                    )}
                    <p className="text-[10px] text-slate-400 mt-1">Room {targetRoom.roomNumber}</p>
                  </div>
                </div>
                {crRentPreview && (
                  <p className="text-[10px] text-slate-400 leading-relaxed">{crRentPreview.formula}</p>
                )}
                {!crRentPreview && !crRentLoading && (
                  <p className="text-[10px] text-slate-400 leading-relaxed">
                    {targetRoom.rentType === 'per_room'
                      ? `Equal split — ₹${targetRoom.baseRent?.toLocaleString('en-IN')} shared among all normal tenants`
                      : `Fixed — ₹${targetRoom.baseRent?.toLocaleString('en-IN')} per bed`
                    }
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── Deposit info — carried over without comparison (no room-level requirement) ── */}
          {selectedBedId && !genderMismatch && (() => {
            const depositBal  = bed.tenant?.depositBalance ?? bed.tenant?.depositAmount ?? 0
            const depositPaid = bed.tenant?.depositPaid ?? false
            if (!depositPaid && depositBal === 0) return null
            return (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 px-4 py-3">
                <IndianRupee size={13} className="text-slate-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-700 tabular-nums">₹{depositBal.toLocaleString('en-IN')}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Deposit carried over to new room</p>
                </div>
                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5 shrink-0">
                  Carried over
                </span>
              </div>
            )
          })()}

          {/* ── Impact on source room co-tenants ── */}
          {selectedBedId && !genderMismatch && !sameRoom && (() => {
            const sourceRentType = room.rentType
            if (sourceRentType !== 'per_room') return null
            const divisorNow  = bed.tenant?.billingSnapshot?.divisorUsed ?? 1
            if (divisorNow <= 1) return null  // only tenant; no one else affected
            const remaining   = divisorNow - 1
            const newSplitEst = Math.ceil((room.baseRent ?? 0) / remaining)
            return (
              <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3">
                <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-amber-800">Rent impact on Room {room.roomNumber}</p>
                  <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
                    {remaining} remaining tenant{remaining !== 1 ? 's' : ''} will see rent increase from{' '}
                    <span className="font-semibold">₹{currentRent.toLocaleString('en-IN')}</span> to approx.{' '}
                    <span className="font-semibold">₹{newSplitEst.toLocaleString('en-IN')}</span> (equal split).
                  </p>
                </div>
              </div>
            )
          })()}

          {/* ── Transfer summary + action ── */}
          {canConfirm && (() => {
            const selectedBed = vacantBeds.find(b => b._id === selectedBedId)
            const newRent     = crRentPreview?.finalRent
            const depositBal  = bed.tenant?.depositBalance ?? bed.tenant?.depositAmount ?? 0
            const depositPaid = bed.tenant?.depositPaid ?? false
            return (
              <div className="rounded-xl border border-primary-200 bg-primary-50/40 overflow-hidden">
                <div className="px-4 py-3 space-y-2.5">
                  {/* From → To */}
                  <div className="flex items-center gap-2 text-sm">
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">From</p>
                      <p className="font-bold text-slate-700 truncate">Room {room.roomNumber} · Bed {bed.bedNumber}</p>
                    </div>
                    <ArrowRightLeft size={14} className="text-primary-400 shrink-0" />
                    <div className="flex-1 min-w-0 text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">To</p>
                      <p className="font-bold text-primary-700 truncate">Room {targetRoom.roomNumber} · Bed {selectedBed?.bedNumber}</p>
                    </div>
                  </div>
                  {/* Financial impact */}
                  <div className="flex gap-2">
                    {newRent != null && (
                      <div className="flex-1 rounded-lg bg-white border border-primary-100 px-3 py-2">
                        <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">New Rent</p>
                        <p className="text-sm font-extrabold text-primary-700 tabular-nums mt-0.5">₹{newRent.toLocaleString('en-IN')}</p>
                      </div>
                    )}
                    {(depositPaid || depositBal > 0) && (
                      <div className="flex-1 rounded-lg bg-white border border-primary-100 px-3 py-2">
                        <p className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Deposit</p>
                        <p className="text-sm font-bold text-emerald-600 mt-0.5">₹{depositBal.toLocaleString('en-IN')} carried over</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })()}

          <div className="space-y-2 pt-1">
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setView('actions')}>
                Cancel
              </button>
              <button
                disabled={!canConfirm}
                className={`
                  flex-1 flex items-center justify-center gap-2
                  rounded-xl border px-4 py-2.5 text-sm font-semibold
                  transition-all duration-150 active:scale-[0.96]
                  disabled:opacity-50 disabled:cursor-not-allowed
                  ${canConfirm
                    ? 'bg-primary-600 border-primary-600 text-white hover:bg-primary-700 hover:shadow-md hover:shadow-primary-200/50'
                    : 'bg-slate-100 border-slate-200 text-slate-400'
                  }
                `}
                onClick={() => {
                  if (!canConfirm) return
                  setSubmitting(true)
                  changeBedApi(propertyId, room._id, bed._id, { targetBedId: selectedBedId })
                    .then(() => { toast('Tenant moved — rent updated for current cycle', 'success'); onSuccess({ targetRoomId }) })
                    .catch(err => {
                      toast(err.response?.data?.message || 'Failed to move tenant', 'error')
                      setSubmitting(false)
                    })
                }}
              >
                <ArrowRightLeft size={14} className={submitting ? 'animate-spin' : ''} />
                {submitting ? 'Moving…' : 'Move Tenant →'}
              </button>
            </div>
            {canConfirm && (
              <p className="text-center text-[10px] text-slate-400">
                New rent applies from the current billing cycle — no proration
              </p>
            )}
          </div>
        </div>
        )
      })()}

      {/* ── MOVE RESERVATION ── */}
      {view === 'moveReservation' && (() => {
        const otherRooms  = allRooms.filter(r => r._id !== room._id && r.isActive !== false && r.status === 'available')
        const vacantBeds  = allTargetBeds.filter(b => b.status === 'vacant')
        const reservantName = bed.reservation?.name ?? 'Tenant'
        const moveInDate  = bed.reservation?.moveInDate
        const canConfirm  = !!selectedBedId && !submitting

        return (
        <div className="space-y-4">

          {/* Tenant identity card */}
          <div className="flex items-center gap-3.5 rounded-2xl border border-violet-100 bg-violet-50/60 px-4 py-3.5">
            <div className="h-10 w-10 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-violet-700">{reservantName.slice(0, 2).toUpperCase()}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate">{reservantName}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Reserved · Room {room.roomNumber} · Bed {bed.bedNumber}
              </p>
            </div>
            {moveInDate && (
              <div className="text-right shrink-0">
                <p className="text-[10px] text-slate-400 mb-0.5">Move-in</p>
                <p className="text-xs font-semibold text-slate-700">
                  {new Date(moveInDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                </p>
              </div>
            )}
          </div>

          {/* Info note */}
          <div className="flex items-start gap-2.5 rounded-xl bg-blue-50 border border-blue-200 px-3.5 py-3">
            <AlertTriangle size={13} className="text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 leading-relaxed">
              Moves the reservation to a vacant bed. No rent is recalculated — the tenant hasn't moved in yet.
            </p>
          </div>

          {/* Target room selector */}
          <div className="space-y-1.5">
            <SectionHeader icon={Home} title="Target Room" />
            {otherRooms.length === 0 ? (
              <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3">
                <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                <p className="text-xs text-amber-700 font-medium">No other available rooms in this property.</p>
              </div>
            ) : (
              <select
                className="input text-sm"
                value={targetRoomId}
                onChange={e => { setTargetRoomId(e.target.value); setSelectedBedId('') }}
              >
                <option value="">Choose a room…</option>
                {otherRooms.map(r => (
                  <option key={r._id} value={r._id}>
                    Room {r.roomNumber}
                    {r.floor !== undefined ? ` · Fl.${r.floor}` : ''}
                    {` · `}{r.type}
                    {` · ₹`}{r.baseRent?.toLocaleString('en-IN')}
                    {r.gender !== 'unisex' ? ` · ${r.gender}` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Bed grid — vacant only */}
          {targetRoomId && (
            <div className="space-y-1.5">
              <SectionHeader icon={BedDouble} title="Select Bed" subtitle="Vacant beds only" />
              {bedsLoading ? (
                <div className="grid grid-cols-5 gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-14 rounded-xl bg-slate-50 border border-slate-200 animate-pulse" />
                  ))}
                </div>
              ) : vacantBeds.length === 0 ? (
                <div className="flex items-center gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3">
                  <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                  <p className="text-xs text-amber-700 font-medium">No vacant beds in this room.</p>
                </div>
              ) : (
                <div className="grid grid-cols-5 gap-2">
                  {vacantBeds.map(b => {
                    const isSelected = selectedBedId === b._id
                    return (
                      <button
                        key={b._id}
                        type="button"
                        onClick={() => setSelectedBedId(isSelected ? '' : b._id)}
                        className={`
                          relative flex flex-col items-center justify-center gap-1
                          rounded-xl border px-2 py-2.5 transition-all duration-150
                          focus:outline-none active:scale-95
                          ${isSelected
                            ? 'border-violet-400 bg-violet-50 ring-2 ring-violet-200/70 shadow-sm'
                            : 'border-emerald-200 bg-emerald-50/60 hover:scale-[1.04] hover:border-emerald-300'
                          }
                        `}
                      >
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                        <span className={`text-xs font-bold leading-none ${isSelected ? 'text-violet-700' : 'text-emerald-700'}`}>
                          {b.bedNumber}
                        </span>
                        {b.isExtra && (
                          <span className="text-[9px] text-slate-400 font-medium leading-none">Extra</span>
                        )}
                        {isSelected && (
                          <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 border-2 border-white">
                            <CheckCircle2 size={9} className="text-white" />
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* Transfer summary */}
          {canConfirm && (() => {
            const targetRoom    = allRooms.find(r => r._id === targetRoomId)
            const selectedBedObj = vacantBeds.find(b => b._id === selectedBedId)
            return (
              <div className="rounded-xl border border-violet-200 bg-violet-50/40 px-4 py-3 space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">From</p>
                    <p className="font-bold text-slate-700 truncate">Room {room.roomNumber} · Bed {bed.bedNumber}</p>
                  </div>
                  <ArrowRightLeft size={14} className="text-violet-400 shrink-0" />
                  <div className="flex-1 min-w-0 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5">To</p>
                    <p className="font-bold text-violet-700 truncate">
                      Room {targetRoom?.roomNumber} · Bed {selectedBedObj?.bedNumber}
                    </p>
                  </div>
                </div>
              </div>
            )
          })()}

          <div className="space-y-2 pt-1">
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setView('actions')}>Cancel</button>
              <button
                disabled={!canConfirm}
                className={`
                  flex-1 flex items-center justify-center gap-2
                  rounded-xl border px-4 py-2.5 text-sm font-semibold
                  transition-all duration-150 active:scale-[0.96]
                  disabled:opacity-50 disabled:cursor-not-allowed
                  ${canConfirm
                    ? 'bg-violet-600 border-violet-600 text-white hover:bg-violet-700 hover:shadow-md hover:shadow-violet-200/50'
                    : 'bg-slate-100 border-slate-200 text-slate-400'
                  }
                `}
                onClick={() => {
                  if (!canConfirm) return
                  setSubmitting(true)
                  moveReservationApi(propertyId, room._id, bed._id, selectedBedId)
                    .then(() => {
                      const targetRoom = allRooms.find(r => r._id === targetRoomId)
                      toast(`Reservation moved to Room ${targetRoom?.roomNumber ?? ''}`, 'success')
                      onSuccess({ targetRoomId })
                    })
                    .catch(err => {
                      toast(err.response?.data?.message || 'Failed to move reservation', 'error')
                      setSubmitting(false)
                    })
                }}
              >
                <ArrowRightLeft size={14} className={submitting ? 'animate-spin' : ''} />
                {submitting ? 'Moving…' : 'Move Reservation →'}
              </button>
            </div>
            <p className="text-center text-[10px] text-slate-400">
              Reservation data and move-in date carry over unchanged
            </p>
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
    red: active
      ? 'bg-red-50 border-red-300 text-red-700 shadow-sm'
      : 'bg-white border-slate-200 text-slate-500 hover:border-red-200 hover:bg-red-50/50 hover:text-red-600',
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
//  ExtraBedModal — create an extra overflow bed (max 2 per room)
// ══════════════════════════════════════════════════════════════════════════════
const ExtraBedModal = ({ room, propertyId, existingExtraCount = 0, vacantNormalCount = 0, onClose, onSuccess }) => {
  const toast = useToast()
  const [isChargeable, setIsChargeable] = useState(true)
  const [extraCharge, setExtraCharge]   = useState('')
  const [saving, setSaving]             = useState(false)

  const nextLabel   = existingExtraCount === 0 ? 'X1' : 'X2'
  const slotsLeft   = 2 - existingExtraCount
  const baseRent    = room.baseRent ?? 0
  const chargeValue = isChargeable ? (Number(extraCharge) || 0) : 0

  // Preview what the tenant will pay — routed through the shared engine
  // so isChargeable / extraCharge / baseRent-fallback logic stays in one place.
  const rentPreview = calculateRent({
    room: { baseRent, rentType: room.rentType },
    bed:  { isExtra: true, isChargeable, extraCharge: chargeValue, rentOverride: null },
    normalOccupied: 0,
  }).finalRent

  const handleSave = async () => {
    setSaving(true)
    try {
      await createExtraBed(propertyId, room._id, {
        isChargeable,
        extraCharge: chargeValue,
      })
      toast(`Extra bed ${nextLabel} added to Room ${room.roomNumber}`, 'success')
      onSuccess()
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to add extra bed', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Add Extra Bed — Room ${room.roomNumber}`} onClose={onClose} size="sm">
      <div className="space-y-5">

        {/* ── Context banner ── */}
        <div className="flex items-center gap-3.5 rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50 to-white px-4 py-3.5">
          <div className="h-11 w-11 rounded-xl bg-violet-100 border border-violet-200 flex items-center justify-center shrink-0">
            <span className="text-base font-black text-violet-600">{nextLabel}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800">
              Extra Bed <span className="text-violet-600">{nextLabel}</span>
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              Room {room.roomNumber} · {room.type} · {slotsLeft} slot{slotsLeft !== 1 ? 's' : ''} remaining after this
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-[10px] text-slate-400 mb-0.5">Base Rent</p>
            <p className="text-sm font-bold text-slate-600">₹{baseRent.toLocaleString('en-IN')}</p>
          </div>
        </div>

        {/* ── Vacant beds advisory (smart warning — does not block) ── */}
        {vacantNormalCount > 0 && (
          <div className="flex items-start gap-2.5 rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-3">
            <BedDouble size={14} className="text-slate-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-slate-600 leading-relaxed">
              This room still has <span className="font-semibold text-slate-700">{vacantNormalCount} vacant bed{vacantNormalCount > 1 ? 's' : ''}</span>.
              Extra beds are typically added when the room is fully occupied.
            </p>
          </div>
        )}

        {/* ── Over-capacity advisory ── */}
        <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3">
          <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
          <p className="text-[11px] text-amber-700 leading-relaxed">
            Adding {nextLabel} will bring this room to <span className="font-bold">{room.capacity + existingExtraCount + 1} total beds</span>, which is{' '}
            <span className="font-bold">{existingExtraCount + 1} over</span> the stated capacity of {room.capacity}.
          </p>
        </div>

        <div className="border-t border-slate-100" />

        {/* ── Chargeable toggle ── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
            <div>
              <p className="text-sm font-semibold text-slate-700">Chargeable?</p>
              <p className="text-xs text-slate-400 mt-0.5">Does this bed have a monthly charge?</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={isChargeable}
              onClick={() => setIsChargeable(v => !v)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ${isChargeable ? 'bg-violet-500' : 'bg-slate-200'}`}
            >
              <span className={`inline-block h-4.5 w-4.5 rounded-full bg-white shadow-md transition-transform duration-200 ${isChargeable ? 'translate-x-[22px]' : 'translate-x-[3px]'}`}
                style={{ height: '18px', width: '18px' }} />
            </button>
          </div>

          {/* Extra charge input */}
          {isChargeable ? (
            <div className="space-y-1.5">
              <label className="label">
                Monthly Charge <span className="text-slate-400 font-normal">(leave 0 to use room base rent)</span>
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm pointer-events-none">₹</span>
                <input
                  type="number"
                  min="0"
                  max="100000"
                  className="input pl-7 text-sm tabular-nums"
                  placeholder={`0 (uses ₹${baseRent.toLocaleString('en-IN')})`}
                  value={extraCharge}
                  onChange={e => setExtraCharge(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2 rounded-lg bg-primary-50 border border-primary-100 px-3 py-2">
                <IndianRupee size={12} className="text-primary-500 shrink-0" />
                <p className="text-[11px] text-primary-700 font-medium">
                  Tenant will pay{' '}
                  <span className="font-bold">₹{rentPreview.toLocaleString('en-IN')}/mo</span>
                  {chargeValue === 0 && (
                    <span className="text-slate-400"> (uses room base rent)</span>
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2.5 rounded-xl bg-emerald-50 border border-emerald-200 px-3.5 py-3">
              <span className="text-emerald-500 text-sm font-bold shrink-0">₹0</span>
              <p className="text-xs text-emerald-700 font-medium leading-relaxed">
                This bed is <span className="font-bold">free of charge</span> — no rent will be applied when assigning a tenant.
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100" />

        {/* ── Buttons ── */}
        <div className="flex gap-2">
          <button className="btn-secondary flex-1" onClick={onClose}>Cancel</button>
          <button
            className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-violet-600 border border-violet-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 hover:shadow-md hover:shadow-violet-200/50 transition-all duration-150 active:scale-[0.96] disabled:opacity-50"
            disabled={saving}
            onClick={handleSave}
          >
            <Plus size={14} className={saving ? 'animate-spin' : ''} />
            {saving ? 'Adding…' : `Add ${nextLabel}`}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  RoomFormModal — reusable for Add + Edit
// ══════════════════════════════════════════════════════════════════════════════
// ── Bed label preview — mirrors server generateBedLabel exactly ──────────────
const genBedLabel = (bnType, index) => {
  if (bnType === 'numeric') return String(index + 1)
  // Excel-column algorithm: A…Z, AA, AB…
  let label = '', n = index
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}
const previewBedLabels = (bnType, count = 4) =>
  Array.from({ length: count }, (_, i) => genBedLabel(bnType, i))

// ══════════════════════════════════════════════════════════════════════════════
//  AddRoomModal — Smart room creation wizard
// ══════════════════════════════════════════════════════════════════════════════
const AddRoomModal = ({ onSubmit, onClose, saving }) => {
  const [capChoice, setCapChoice] = useState('1')
  const [customCap, setCustomCap] = useState('4')
  const [bnType,    setBnType]    = useState('alphabet')
  const [notesOpen, setNotesOpen] = useState(false)
  const [form, setForm] = useState({
    roomNumber: '', floor: '0', baseRent: '',
    rentType: 'per_bed', hasAC: false, hasAttachedBathroom: false,
    category: 'standard', gender: 'unisex', notes: '',
  })
  const [errors, setErrors] = useState({})

  const capacity = capChoice === 'custom'
    ? Math.max(1, Math.min(20, Number(customCap) || 1))
    : Number(capChoice)

  const typeFromCapacity =
    capacity === 1 ? 'single' : capacity === 2 ? 'double' : capacity === 3 ? 'triple' : 'dormitory'

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => ({ ...e, [k]: null }))
  }

  // Rent preview — routed through the shared calculateRent engine.
  // normalOccupied for per_room preview = full capacity (worst case / "if full").
  // This guarantees the displayed numbers match what the backend will store.
  const baseRentNum = Number(form.baseRent) || 0
  const _previewBed = { isExtra: false, rentOverride: null, isChargeable: true, extraCharge: 0 }
  const _rentResult = baseRentNum > 0
    ? calculateRent({
        room:           { baseRent: baseRentNum, rentType: form.rentType },
        bed:            _previewBed,
        normalOccupied: form.rentType === 'per_room' ? Math.max(capacity, 1) : 1,
      })
    : null
  const perTenantRent   = _rentResult?.finalRent ?? 0
  const perTenantSource = _rentResult?.source     ?? null
  // totalIfFull: per_bed → each-tenant × beds; per_room → the fixed room total
  const totalIfFull = form.rentType === 'per_bed' ? perTenantRent * capacity : baseRentNum

  // Bed label preview — same algorithm as backend generateBedLabel
  const PREVIEW_MAX = 8
  const showCount   = Math.min(capacity, PREVIEW_MAX)
  const hiddenCount = capacity - showCount
  const bedLabels   = previewBedLabels(bnType, showCount)

  const validate = () => {
    const errs = {}
    if (!form.roomNumber.trim())                       errs.roomNumber = 'Room number is required'
    if (!form.baseRent || Number(form.baseRent) < 0)   errs.baseRent   = 'Base rent is required'
    if (capChoice === 'custom') {
      const c = Number(customCap)
      if (!customCap || isNaN(c) || c < 1 || c > 20)  errs.capacity   = 'Enter a number between 1 and 20'
    }
    return errs
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    onSubmit({
      roomNumber:          form.roomNumber.trim().toUpperCase(),
      type:                typeFromCapacity,
      capacity,
      floor:               Number(form.floor),
      baseRent:            Number(form.baseRent),
      rentType:            form.rentType,
      gender:              form.gender,
      hasAC:               form.hasAC,
      hasAttachedBathroom: form.hasAttachedBathroom,
      category:            form.category,
      notes:               form.notes.trim(),
      bedNumberingType:    bnType,
    })
  }

  const canSubmit = form.roomNumber.trim() && form.baseRent && !saving

  return (
    <Modal onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="-mx-5 -mt-5 flex flex-col">

        {/* ── Header ── */}
        <div className="shrink-0 rounded-t-2xl overflow-hidden border-b border-slate-100">
          <div className="h-0.5 w-full bg-gradient-to-r from-primary-400 via-primary-500 to-primary-600" />
          <div className="px-6 py-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 border border-primary-100 mt-0.5">
                <BedDouble size={18} className="text-primary-600" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 ring-[3px] ring-emerald-100 shrink-0" />
                  <h2 className="text-[16px] font-bold text-slate-800 leading-tight">Add New Room</h2>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 ml-4">Configure capacity, pricing and setup</p>
              </div>
            </div>
            <button type="button" onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors mt-0.5">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-6">

          {/* 1 — Basic Info */}
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Basic Info</p>

            {/* Row 1: Room Number + Floor */}
            <div className="flex gap-3 items-start">
              <div className="flex-1">
                <label className="label text-[11px]">
                  Room Number <span className="text-red-400">*</span>
                </label>
                <input
                  autoFocus
                  className={`input font-bold tracking-wider uppercase ${
                    errors.roomNumber ? 'border-red-400 focus:ring-red-400/20 focus:border-red-400' : ''
                  }`}
                  placeholder="e.g. 101, A1, G-02"
                  value={form.roomNumber}
                  onChange={e => set('roomNumber', e.target.value.toUpperCase())}
                />
                {errors.roomNumber && (
                  <p className="mt-1 text-[11px] text-red-500 font-medium flex items-center gap-1">
                    <AlertTriangle size={10} className="shrink-0" /> {errors.roomNumber}
                  </p>
                )}
              </div>
              <div className="w-24 shrink-0">
                <label className="label text-[11px]">Floor</label>
                <input type="number" min="0" className="input text-center"
                  value={form.floor} onChange={e => set('floor', e.target.value)} />
              </div>
            </div>

            {/* Row 2: Gender Restriction */}
            <div className="space-y-1.5">
              <label className="label text-[11px]">Gender</label>
              <div className="flex gap-2" role="group" aria-label="Gender restriction">
                {[
                  { v: 'male',   l: 'Male'   },
                  { v: 'female', l: 'Female' },
                  { v: 'unisex', l: 'Unisex' },
                ].map(({ v, l }) => (
                  <button
                    key={v}
                    type="button"
                    aria-selected={form.gender === v}
                    onClick={() => set('gender', v)}
                    className={`rounded-full border px-4 py-2 text-xs font-semibold transition-all duration-150 active:scale-[.96]
                      ${form.gender === v
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm shadow-emerald-100/60'
                        : 'border-slate-300 text-slate-600 bg-white hover:border-slate-400 hover:bg-slate-50'
                      }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">Optional — restrict who can stay in this room</p>
            </div>
          </div>

          <div className="h-px bg-slate-100" />

          {/* 2 — Capacity */}
          <div className="space-y-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Capacity</p>
              <p className="text-sm font-semibold text-slate-700 mt-1.5">
                How many tenants can stay in this room?
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2.5">
              {[
                { id: '1',      num: '1', label: 'Person',  sub: 'Single' },
                { id: '2',      num: '2', label: 'People',  sub: 'Shared' },
                { id: '3',      num: '3', label: 'People',  sub: 'Triple' },
                { id: 'custom', num: '+', label: 'Custom',  sub: 'Dormitory' },
              ].map(({ id, num, label, sub }) => {
                const active = capChoice === id
                return (
                  <button key={id} type="button"
                    onClick={() => { setCapChoice(id); setErrors(er => ({ ...er, capacity: null })) }}
                    className={`relative flex flex-col items-center justify-center text-center rounded-xl border-2 py-3.5 px-2 transition-all duration-150 active:scale-[.96]
                      ${active
                        ? 'border-primary-400 bg-primary-50 shadow-sm shadow-primary-200/50'
                        : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                      }`}>
                    {active && (
                      <span className="absolute top-2 right-2.5 h-1.5 w-1.5 rounded-full bg-primary-500" />
                    )}
                    <span className={`text-2xl font-black leading-none ${active ? 'text-primary-600' : 'text-slate-500'}`}>
                      {num}
                    </span>
                    <span className={`text-[11px] font-bold mt-0.5 ${active ? 'text-primary-700' : 'text-slate-600'}`}>
                      {label}
                    </span>
                    <span className={`text-[9px] mt-0.5 ${active ? 'text-primary-500' : 'text-slate-400'}`}>
                      {sub}
                    </span>
                  </button>
                )
              })}
            </div>

            {capChoice === 'custom' && (
              <div>
                <label className="label text-[11px]">Number of beds</label>
                <input type="number" min="1" max="20"
                  className={`input w-28 text-center font-semibold tabular-nums ${errors.capacity ? 'border-red-400 focus:ring-red-400/20' : ''}`}
                  placeholder="4"
                  value={customCap}
                  onChange={e => { setCustomCap(e.target.value); setErrors(er => ({ ...er, capacity: null })) }}
                />
                {errors.capacity && (
                  <p className="mt-1 text-[11px] text-red-500 font-medium flex items-center gap-1">
                    <AlertTriangle size={10} className="shrink-0" /> {errors.capacity}
                  </p>
                )}
                <p className="mt-1 text-[10px] text-slate-400">Min 1, max 20 beds</p>
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100" />

          {/* 3 — Bed Layout Preview */}
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Bed Layout Preview</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <p className="text-xs text-slate-500">
                    {capacity} bed{capacity !== 1 ? 's' : ''} will be created automatically
                  </p>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold
                    ${form.gender === 'male'   ? 'bg-sky-50 border-sky-200 text-sky-600' :
                      form.gender === 'female' ? 'bg-pink-50 border-pink-200 text-pink-600' :
                      'bg-slate-50 border-slate-200 text-slate-400'}
                  `}>
                    👤 {form.gender === 'male' ? 'Male Only' : form.gender === 'female' ? 'Female Only' : 'Unisex'}
                  </span>
                </div>
              </div>
              {/* Numbering style toggle */}
              <div className="flex items-center rounded-lg bg-slate-100 p-0.5 gap-0.5">
                {[
                  { v: 'alphabet', l: 'A, B, C' },
                  { v: 'numeric',  l: '1, 2, 3' },
                ].map(opt => (
                  <button key={opt.v} type="button" onClick={() => setBnType(opt.v)}
                    className={`rounded-md px-2.5 py-1 text-[10px] font-semibold transition-all ${
                      bnType === opt.v
                        ? 'bg-white text-primary-600 shadow-sm ring-1 ring-black/5'
                        : 'text-slate-500 hover:text-slate-700'
                    }`}>
                    {opt.l}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap gap-1.5 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3.5 min-h-[52px] items-center">
              {bedLabels.map((label, i) => (
                <span key={i}
                  className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-primary-50 border border-primary-200 text-primary-700 text-[11px] font-bold font-mono shadow-sm">
                  {label}
                </span>
              ))}
              {hiddenCount > 0 && (
                <span className="inline-flex items-center justify-center h-7 rounded-full border border-dashed border-slate-300 bg-white text-slate-400 text-[10px] font-medium px-2.5">
                  +{hiddenCount} more
                </span>
              )}
            </div>
          </div>

          <div className="h-px bg-slate-100" />

          {/* 4 — Rent Setup */}
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Rent Setup</p>

            <div className="flex gap-4 items-start">
              {/* Base Rent */}
              <div className="flex-1">
                <label className="label text-[11px]">Base Rent <span className="text-red-400">*</span></label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm pointer-events-none select-none">₹</span>
                  <input type="number" min="0"
                    className={`input pl-8 tabular-nums font-semibold text-slate-800 ${
                      errors.baseRent ? 'border-red-400 focus:ring-red-400/20 focus:border-red-400' : ''
                    }`}
                    placeholder="8000"
                    value={form.baseRent}
                    onChange={e => set('baseRent', e.target.value)}
                  />
                </div>
                {errors.baseRent && (
                  <p className="mt-1 text-[11px] text-red-500 font-medium flex items-center gap-1">
                    <AlertTriangle size={10} className="shrink-0" /> {errors.baseRent}
                  </p>
                )}
              </div>

              {/* Billing method */}
              <div className="shrink-0">
                <label className="label text-[11px]">Billing</label>
                <div className="flex gap-1.5">
                  {[
                    { v: 'per_bed',  l: 'Per Bed',   sub: 'Each tenant' },
                    { v: 'per_room', l: 'Split',      sub: 'Divide total' },
                  ].map(opt => (
                    <button key={opt.v} type="button" onClick={() => set('rentType', opt.v)}
                      className={`flex flex-col items-center text-center rounded-xl border px-3.5 py-2 transition-all duration-150 active:scale-[.97]
                        ${form.rentType === opt.v
                          ? 'border-primary-400 bg-primary-50 shadow-sm shadow-primary-200/30'
                          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                        }`}>
                      <span className={`text-[11px] font-bold leading-tight ${form.rentType === opt.v ? 'text-primary-700' : 'text-slate-600'}`}>
                        {opt.l}
                      </span>
                      <span className={`text-[9px] mt-0.5 ${form.rentType === opt.v ? 'text-primary-500' : 'text-slate-400'}`}>
                        {opt.sub}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* System rule note */}
            <p className="text-[10px] text-slate-400 flex items-center gap-1">
              <CheckCircle2 size={9} className="shrink-0 text-slate-300" />
              Rent is automatically calculated based on room configuration and occupancy.
            </p>

            {/* Live Rent Preview */}
            {baseRentNum > 0 && (
              <div className={`rounded-xl border px-5 py-4 transition-all duration-300 ${
                form.rentType === 'per_bed' ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'
              }`}>
                {form.rentType === 'per_bed' ? (
                  <div className="flex items-center gap-6">
                    <div className="flex-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 mb-1">Each tenant pays</p>
                      <p className="text-[28px] font-black text-emerald-700 leading-none tabular-nums">
                        ₹{perTenantRent.toLocaleString('en-IN')}
                        <span className="text-xs font-medium text-emerald-500 ml-1">/mo</span>
                      </p>
                      {perTenantSource && (
                        <p className="text-[9px] text-emerald-500 mt-0.5">{SOURCE_LABELS[perTenantSource] ?? perTenantSource}</p>
                      )}
                      {DEBUG_RENT && _rentResult && (
                        <div className="mt-1 rounded bg-slate-100 px-1.5 py-1 font-mono text-[9px] text-slate-500 space-y-0.5">
                          <p>Source: {_rentResult.source}</p>
                          {_rentResult.meta?.divisor != null && <p>Divisor: {_rentResult.meta.divisor}</p>}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 h-10 w-px bg-emerald-200" />
                    <div className="flex-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 mb-1">
                        Total if full ({capacity} bed{capacity !== 1 ? 's' : ''})
                      </p>
                      <p className="text-[18px] font-bold text-emerald-700 leading-none tabular-nums">
                        ₹{totalIfFull.toLocaleString('en-IN')}
                        <span className="text-xs font-medium text-emerald-500 ml-1">/mo</span>
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-6">
                    <div className="flex-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-blue-600 mb-1">Room rent</p>
                      <p className="text-[28px] font-black text-blue-700 leading-none tabular-nums">
                        ₹{totalIfFull.toLocaleString('en-IN')}
                        <span className="text-xs font-medium text-blue-500 ml-1">/mo</span>
                      </p>
                    </div>
                    <div className="shrink-0 h-10 w-px bg-blue-200" />
                    <div className="flex-1">
                      <p className="text-[9px] font-black uppercase tracking-widest text-blue-600 mb-1">
                        Per person (if full)
                      </p>
                      <p className="text-[18px] font-bold text-blue-700 leading-none tabular-nums">
                        ₹{perTenantRent.toLocaleString('en-IN')}
                        <span className="text-xs font-medium text-blue-500 ml-1">/mo</span>
                      </p>
                      {perTenantSource && (
                        <p className="text-[9px] text-blue-500 mt-0.5">{SOURCE_LABELS[perTenantSource] ?? perTenantSource}</p>
                      )}
                      {DEBUG_RENT && _rentResult && (
                        <div className="mt-1 rounded bg-slate-100 px-1.5 py-1 font-mono text-[9px] text-slate-500 space-y-0.5">
                          <p>Source: {_rentResult.source}</p>
                          {_rentResult.meta?.divisor != null && <p>Divisor: {_rentResult.meta.divisor}</p>}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="h-px bg-slate-100" />

          {/* 5 — Amenities + Category */}
          <div className="grid grid-cols-2 gap-5">
            {/* Amenities */}
            <div className="space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Amenities</p>
              <div className="flex flex-col gap-2">
                {[
                  { k: 'hasAC',               icon: Snowflake, label: 'Air Conditioning' },
                  { k: 'hasAttachedBathroom',  icon: Bath,      label: 'Attached Bathroom' },
                ].map(({ k, icon: Icon, label }) => (
                  <button key={k} type="button" onClick={() => set(k, !form[k])}
                    className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-all duration-150 active:scale-[.98]
                      ${form[k]
                        ? 'bg-blue-50 border-blue-300 shadow-sm'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}>
                    <Icon size={13} className={form[k] ? 'text-blue-500' : 'text-slate-400'} />
                    <span className={`text-xs font-semibold ${form[k] ? 'text-blue-700' : 'text-slate-500'}`}>
                      {label}
                    </span>
                    {form[k] && <CheckCircle2 size={12} className="ml-auto text-blue-400 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>

            {/* Category */}
            <div className="space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Category</p>
              <div className="flex flex-col gap-2">
                {[
                  { v: 'standard', label: 'Standard', icon: Home,     sub: 'Basic setup'   },
                  { v: 'premium',  label: 'Premium',  icon: Sparkles,  sub: 'Better amenities' },
                  { v: 'luxury',   label: 'Luxury',   icon: Crown,    sub: 'Top-tier'      },
                ].map(({ v, label, icon: Icon, sub }) => (
                  <button key={v} type="button" onClick={() => set('category', v)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-all duration-150 active:scale-[.98]
                      ${form.category === v
                        ? 'bg-primary-50 border-primary-300 shadow-sm'
                        : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}>
                    <Icon size={13} className={form.category === v ? 'text-primary-500' : 'text-slate-400'} />
                    <div className="flex-1 min-w-0">
                      <p className={`text-[11px] font-bold leading-tight ${form.category === v ? 'text-primary-700' : 'text-slate-600'}`}>
                        {label}
                      </p>
                      <p className={`text-[9px] ${form.category === v ? 'text-primary-500' : 'text-slate-400'}`}>
                        {sub}
                      </p>
                    </div>
                    {form.category === v && <CheckCircle2 size={12} className="shrink-0 text-primary-500" />}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="h-px bg-slate-100" />

          {/* 6 — Optional (collapsible) */}
          <div className="space-y-3">
            <button type="button" onClick={() => setNotesOpen(v => !v)}
              className="flex items-center justify-between w-full group">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 group-hover:text-slate-500 transition-colors">
                Additional Options
              </p>
              <span className={`text-[10px] text-slate-400 font-medium transition-transform duration-200 inline-block ${notesOpen ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </button>

            {notesOpen && (
              <div className="animate-scaleIn space-y-3">
                <div className="space-y-1.5">
                  <label className="label text-[11px]">Notes (optional)</label>
                  <textarea className="input resize-none text-sm"
                    rows={2}
                    placeholder="Any special notes about this room…"
                    value={form.notes}
                    onChange={e => set('notes', e.target.value)} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 px-6 pb-5 pt-4 border-t border-slate-100 flex items-center gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={!canSubmit}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white
              bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700
              disabled:opacity-40 disabled:cursor-not-allowed transition-all shadow-sm shadow-primary-200/50 active:scale-[0.98]">
            {saving ? (
              <>
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Creating…
              </>
            ) : (
              <><Plus size={15} /> Create Room</>
            )}
          </button>
        </div>

      </form>
    </Modal>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
//  EditRoomModal — Safe control panel for editing an existing room
// ══════════════════════════════════════════════════════════════════════════════
const EditRoomModal = ({ room: initial, propertyId, onSubmit, onClose, saving }) => {
  // ── Fetch live beds for impact simulation ──────────────────────────────────
  const { data: bedData, loading: bedsLoading } = useApi(
    () => getBeds(propertyId, initial._id),
    [propertyId, initial._id]
  )
  const beds         = bedData?.data ?? []
  const normalBeds   = beds.filter(b => !b.isExtra)
  const extraBeds    = beds.filter(b => b.isExtra)
  const occupiedBeds = beds.filter(b => b.status === 'occupied')
  const occupiedCount = occupiedBeds.length
  const extraCount    = extraBeds.length

  // ── Form state initialised from room ──────────────────────────────────────
  const initCapChoice = () => {
    const c = initial.capacity
    if (c === 1) return '1'
    if (c === 2) return '2'
    if (c === 3) return '3'
    return 'custom'
  }
  const [capChoice,  setCapChoice]  = useState(initCapChoice)
  const [customCap,  setCustomCap]  = useState(String(initial.capacity))
  const [form, setForm] = useState({
    floor:               String(initial.floor ?? 0),
    baseRent:            String(initial.baseRent ?? ''),
    rentType:            initial.rentType ?? 'per_bed',
    hasAC:               initial.hasAC ?? false,
    hasAttachedBathroom: initial.hasAttachedBathroom ?? false,
    category:            initial.category ?? 'standard',
    gender:              initial.gender ?? 'unisex',
    notes:               initial.notes ?? '',
  })
  const [notesOpen, setNotesOpen] = useState(!!initial.notes)
  const [errors, setErrors]       = useState({})

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => ({ ...e, [k]: null }))
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const newCapacity = capChoice === 'custom'
    ? Math.max(1, Math.min(20, Number(customCap) || 1))
    : Number(capChoice)
  const oldCapacity    = initial.capacity
  const newBaseRent    = Number(form.baseRent) || 0
  const oldBaseRent    = initial.baseRent ?? 0
  const newRentType    = form.rentType
  const oldRentType    = initial.rentType

  const typeFromCap = c =>
    c === 1 ? 'single' : c === 2 ? 'double' : c === 3 ? 'triple' : 'dormitory'
  const newType = typeFromCap(newCapacity)
  const oldType = initial.type

  // Rent type locked if any beds are occupied
  const rentTypeLocked = occupiedCount > 0

  // ── Change detection ───────────────────────────────────────────────────────
  const capacityChanged = newCapacity !== oldCapacity
  const baseRentChanged = newBaseRent !== oldBaseRent && newBaseRent > 0
  const rentTypeChanged = newRentType !== oldRentType
  const typeChanged     = newType !== oldType
  const amenitiesChanged = form.hasAC !== initial.hasAC ||
    form.hasAttachedBathroom !== initial.hasAttachedBathroom
  const otherChanged = form.floor !== String(initial.floor ?? 0) ||
    form.category !== initial.category || form.gender !== initial.gender ||
    (form.notes.trim() !== (initial.notes ?? '').trim())
  const anyChange = capacityChanged || baseRentChanged || rentTypeChanged ||
    amenitiesChanged || otherChanged

  // ── Change summary list ────────────────────────────────────────────────────
  // Ordered array of { label, from, to } — rendered in the "What Changed" block.
  const changeList = []
  if (capacityChanged)                               changeList.push({ label: 'Capacity',  from: `${oldCapacity} beds`,                                     to: `${newCapacity} beds` })
  if (baseRentChanged)                               changeList.push({ label: 'Base Rent', from: fmt(oldBaseRent),                                           to: fmt(newBaseRent) })
  if (rentTypeChanged)                               changeList.push({ label: 'Billing',   from: oldRentType === 'per_bed' ? 'Per Bed' : 'Split Room',       to: newRentType === 'per_bed' ? 'Per Bed' : 'Split Room' })
  if (form.gender !== initial.gender)                changeList.push({ label: 'Gender',    from: initial.gender,                                             to: form.gender })
  if (form.hasAC !== initial.hasAC)                  changeList.push({ label: 'AC',        from: initial.hasAC ? 'On' : 'Off',                              to: form.hasAC ? 'On' : 'Off' })
  if (form.hasAttachedBathroom !== initial.hasAttachedBathroom)
                                                     changeList.push({ label: 'Bathroom',  from: initial.hasAttachedBathroom ? 'Attached' : 'Shared',        to: form.hasAttachedBathroom ? 'Attached' : 'Shared' })
  if (form.category !== initial.category)            changeList.push({ label: 'Category',  from: initial.category,                                           to: form.category })
  if (form.floor !== String(initial.floor ?? 0))     changeList.push({ label: 'Floor',     from: String(initial.floor ?? 0),                                 to: form.floor })

  // ── Hard blocks ────────────────────────────────────────────────────────────
  const capacityTooLow    = newCapacity < occupiedCount
  const typeBlockOccupied = typeChanged && occupiedCount > 0
  const typeBlockExtra    = typeChanged && extraCount > 0
  const rentTypeBlock     = rentTypeChanged && occupiedCount > 0
  const isHardBlocked     = capacityTooLow || typeBlockOccupied || typeBlockExtra || rentTypeBlock

  // ── Capacity impact ────────────────────────────────────────────────────────
  const capDiff = newCapacity - oldCapacity  // +N or -N
  // Labels for the beds that would be ADDED (indices oldCapacity … newCapacity-1)
  const newBedLabels = capDiff > 0
    ? Array.from({ length: capDiff }, (_, i) =>
        genBedLabel(initial.bedNumberingType ?? 'alphabet', oldCapacity + i)
      )
    : []

  // ── Rent impact simulation ─────────────────────────────────────────────────
  // Routed through the shared calculateRent engine so that preview numbers
  // match the backend exactly (MIN_RENT floor, override handling, extra beds).
  // Returns the full engine result { finalRent, source, meta } for display.
  const simulateRent = (bed, normalOcc) => {
    if (!bed.tenant) return { finalRent: 0, source: null, meta: {} }
    const r = newBaseRent > 0 ? newBaseRent : oldBaseRent
    return calculateRent({
      room: { baseRent: r, rentType: newRentType },
      bed:  {
        isExtra:      bed.isExtra ?? false,
        isChargeable: bed.isChargeable ?? true,
        extraCharge:  bed.extraCharge  ?? 0,
        rentOverride: bed.rentOverride ?? null,
      },
      normalOccupied: normalOcc,
    })
  }

  const normalOccupied = occupiedBeds.filter(b => !b.isExtra).length
  const newNormalOcc   = typeChanged
    ? newCapacity   // after type change, all beds are new, so divisor = full capacity
    : normalOccupied

  const tenantImpact = occupiedBeds.map(bed => {
    const oldRent                        = bed.tenant?.rentAmount ?? 0
    const { finalRent: newRent, source } = simulateRent(bed, newNormalOcc)
    return { bed, oldRent, newRent, diff: newRent - oldRent, source }
  })

  // ── Bed preview (all beds after change) ───────────────────────────────────
  const PREVIEW_MAX = 10
  const allBedLabels = previewBedLabels(
    initial.bedNumberingType ?? 'alphabet',
    Math.min(newCapacity, PREVIEW_MAX)
  )
  const hiddenBeds = newCapacity - Math.min(newCapacity, PREVIEW_MAX)

  // ── Validation ─────────────────────────────────────────────────────────────
  const validate = () => {
    const errs = {}
    if (!form.baseRent || newBaseRent < 0) errs.baseRent = 'Base rent is required'
    if (capChoice === 'custom') {
      const c = Number(customCap)
      if (!customCap || isNaN(c) || c < 1 || c > 20) errs.capacity = 'Enter 1–20'
    }
    return errs
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!anyChange) return
    if (isHardBlocked) return
    const errs = validate()
    if (Object.keys(errs).length) { setErrors(errs); return }
    onSubmit({
      floor:               Number(form.floor),
      capacity:            newCapacity,
      type:                newType,
      baseRent:            newBaseRent,
      rentType:            newRentType,
      gender:              form.gender,
      hasAC:               form.hasAC,
      hasAttachedBathroom: form.hasAttachedBathroom,
      category:            form.category,
      notes:               form.notes.trim(),
    })
  }

  const isRiskyChange = typeChanged || (baseRentChanged && occupiedCount > 0)
  const canSubmit = anyChange && !isHardBlocked && !saving && (!bedsLoading)
  const fmt = n => `₹${(n ?? 0).toLocaleString('en-IN')}`

  // ── Final State Preview rent values (via shared engine) ───────────────────
  const _fspBed    = { isExtra: false, rentOverride: null, isChargeable: true, extraCharge: 0 }
  const _fspResult = newBaseRent > 0
    ? calculateRent({
        room:           { baseRent: newBaseRent, rentType: newRentType },
        bed:            _fspBed,
        normalOccupied: newRentType === 'per_room' ? Math.max(newCapacity, 1) : 1,
      })
    : null
  const fspPerTenant = _fspResult?.finalRent ?? 0
  const fspSource    = _fspResult?.source    ?? null
  const fspTotal     = newRentType === 'per_bed' ? fspPerTenant * newCapacity : newBaseRent

  return (
    <Modal onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="-mx-5 -mt-5 flex flex-col max-h-[90vh]">

        {/* ── Header ── */}
        <div className="shrink-0 rounded-t-2xl overflow-hidden border-b border-slate-100">
          <div className="h-0.5 w-full bg-gradient-to-r from-amber-400 via-amber-500 to-orange-500" />
          <div className="px-6 py-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 border border-amber-100 mt-0.5">
                <Pencil size={16} className="text-amber-600" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-amber-400 ring-[3px] ring-amber-100 shrink-0" />
                  <h2 className="text-[16px] font-bold text-slate-800 leading-tight">
                    Edit Room — {initial.roomNumber}
                  </h2>
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5 ml-4">Modify configuration safely</p>
              </div>
            </div>
            <button type="button" onClick={onClose}
              className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors mt-0.5">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">

          {/* ── SECTION 1: Room Snapshot ───────────────────────────────────── */}
          <div className="rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center gap-2">
              <Home size={12} className="text-slate-400" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Current State</p>
            </div>
            {bedsLoading ? (
              <div className="px-4 py-4 flex gap-3">
                {[1,2,3,4].map(i => (
                  <div key={i} className="flex-1 h-12 rounded-xl bg-slate-200/70 animate-pulse" />
                ))}
              </div>
            ) : (
              <>
                {/* KPI row */}
                <div className="grid grid-cols-4 divide-x divide-slate-200">
                  {[
                    { label: 'Capacity',   value: `${oldCapacity} beds`,    cls: 'text-slate-700' },
                    { label: 'Occupied',   value: occupiedCount,             cls: occupiedCount > 0 ? 'text-red-600' : 'text-slate-400' },
                    { label: 'Vacant',     value: normalBeds.filter(b => b.status === 'vacant').length, cls: 'text-emerald-600' },
                    { label: 'Extra Beds', value: extraCount,                cls: extraCount > 0 ? 'text-amber-600' : 'text-slate-400' },
                  ].map(({ label, value, cls }) => (
                    <div key={label} className="flex flex-col items-center py-3 px-2 text-center">
                      <span className={`text-[17px] font-black leading-none tabular-nums ${cls}`}>{value}</span>
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400 mt-0.5">{label}</span>
                    </div>
                  ))}
                </div>

                {/* Tenant list */}
                {beds.length > 0 && (
                  <div className="px-4 pb-3 pt-1 space-y-1.5">
                    <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-2">Tenants</p>
                    {beds.map(bed => (
                      <div key={bed._id} className="flex items-center gap-2.5">
                        <span className={`inline-flex items-center justify-center h-6 w-6 rounded-md text-[10px] font-black font-mono border shrink-0
                          ${bed.status === 'occupied' ? 'bg-red-50 border-red-200 text-red-700'
                            : bed.status === 'reserved' ? 'bg-amber-50 border-amber-200 text-amber-700'
                            : bed.isExtra ? 'bg-orange-50 border-orange-200 text-orange-700'
                            : 'bg-slate-100 border-slate-200 text-slate-400'}`}>
                          {bed.bedNumber}
                        </span>
                        {bed.tenant ? (
                          <>
                            <span className="text-xs font-semibold text-slate-700 truncate flex-1">{bed.tenant.name}</span>
                            <span className="text-[10px] font-bold text-slate-500 tabular-nums shrink-0">{fmt(bed.tenant.rentAmount)}</span>
                            {bed.isExtra && (
                              <span className="text-[9px] font-semibold bg-orange-100 text-orange-600 border border-orange-200 rounded-full px-1.5 py-0.5 shrink-0">extra</span>
                            )}
                          </>
                        ) : bed.status === 'reserved' ? (
                          <>
                            <span className="text-xs font-medium text-amber-600 italic flex-1">{bed.reservation?.name ?? 'Reserved'}</span>
                            <span className="text-[9px] font-semibold bg-amber-50 text-amber-600 border border-amber-200 rounded-full px-1.5 py-0.5 shrink-0">reserved</span>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400 italic flex-1">Vacant slot</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="h-px bg-slate-100" />

          {/* ── SECTION 2: Editable Fields ────────────────────────────────── */}
          <div className="space-y-5">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Configuration</p>

            {/* Row: Floor */}
            <div className="flex gap-4 items-start">
              <div className="w-28 shrink-0">
                <label className="label text-[11px]">Floor</label>
                <input type="number" min="0" className="input text-center"
                  value={form.floor} onChange={e => set('floor', e.target.value)} />
              </div>
              <div className="flex-1">
                <label className="label text-[11px]">Notes</label>
                <input className="input text-sm" placeholder="Optional notes…"
                  value={form.notes} onChange={e => set('notes', e.target.value)} />
              </div>
            </div>

            {/* Capacity picker */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="label text-[11px] mb-0">Capacity</label>
                <div className="flex items-center gap-1.5">
                  {capacityChanged && !typeBlockOccupied && !typeBlockExtra && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                      capDiff > 0
                        ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                        : 'bg-amber-50 border-amber-200 text-amber-600'
                    }`}>
                      {capDiff > 0 ? `+${capDiff} beds` : `${capDiff} beds`}
                    </span>
                  )}
                  {capacityChanged && (
                    <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600">
                      Updated
                    </span>
                  )}
                </div>
              </div>
              <div className={`grid grid-cols-4 gap-2 rounded-xl transition-all duration-200 ${capacityChanged ? 'ring-1 ring-emerald-300/50 ring-offset-2' : ''}`}>
                {[
                  { id: '1', num: '1', label: 'Person',  sub: 'Single' },
                  { id: '2', num: '2', label: 'People',  sub: 'Shared' },
                  { id: '3', num: '3', label: 'People',  sub: 'Triple' },
                  { id: 'custom', num: '+', label: 'Custom', sub: 'Dorm' },
                ].map(({ id, num, label, sub }) => {
                  const active = capChoice === id
                  const wasOrig = String(oldCapacity) === id || (oldCapacity > 3 && id === 'custom')
                  return (
                    <button key={id} type="button"
                      onClick={() => { setCapChoice(id); setErrors(er => ({ ...er, capacity: null })) }}
                      className={`relative flex flex-col items-center justify-center text-center rounded-xl border-2 py-3 px-2 transition-all duration-150 active:scale-[.96]
                        ${active
                          ? 'border-primary-400 bg-primary-50 shadow-sm'
                          : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                        }`}>
                      {wasOrig && !active && (
                        <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-slate-300" title="Current value" />
                      )}
                      {active && (
                        <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary-500" />
                      )}
                      <span className={`text-xl font-black leading-none ${active ? 'text-primary-600' : 'text-slate-500'}`}>{num}</span>
                      <span className={`text-[10px] font-bold mt-0.5 ${active ? 'text-primary-700' : 'text-slate-600'}`}>{label}</span>
                      <span className={`text-[9px] mt-0.5 ${active ? 'text-primary-500' : 'text-slate-400'}`}>{sub}</span>
                    </button>
                  )
                })}
              </div>

              {capChoice === 'custom' && (
                <div className="flex items-center gap-2">
                  <input type="number" min="1" max="20"
                    className={`input w-24 text-center font-semibold tabular-nums ${errors.capacity ? 'border-red-400' : ''}`}
                    value={customCap}
                    onChange={e => { setCustomCap(e.target.value); setErrors(er => ({ ...er, capacity: null })) }}
                  />
                  <span className="text-[10px] text-slate-400">beds (1–20)</span>
                  {errors.capacity && (
                    <p className="text-[11px] text-red-500 font-medium flex items-center gap-1">
                      <AlertTriangle size={10} /> {errors.capacity}
                    </p>
                  )}
                </div>
              )}

              {/* Hard block: capacity < occupied */}
              {capacityTooLow && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
                  <Ban size={13} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-xs font-semibold text-red-700">
                    Cannot reduce to {newCapacity} — {occupiedCount} bed{occupiedCount > 1 ? 's are' : ' is'} occupied. Vacate {occupiedCount - newCapacity} tenant{(occupiedCount - newCapacity) > 1 ? 's' : ''} first.
                  </p>
                </div>
              )}

              {/* Hard block: type change + occupied/extra */}
              {(typeBlockOccupied || typeBlockExtra) && (
                <div className="space-y-1.5">
                  {typeBlockOccupied && (
                    <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
                      <Ban size={13} className="text-red-500 shrink-0 mt-0.5" />
                      <p className="text-xs font-semibold text-red-700">
                        Cannot change capacity type — {occupiedCount} tenant{occupiedCount > 1 ? 's are' : ' is'} assigned. Vacate all tenants first.
                      </p>
                    </div>
                  )}
                  {typeBlockExtra && !typeBlockOccupied && (
                    <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 px-3 py-2.5">
                      <Ban size={13} className="text-red-500 shrink-0 mt-0.5" />
                      <p className="text-xs font-semibold text-red-700">
                        {extraCount} extra bed{extraCount > 1 ? 's' : ''} must be removed before changing capacity type.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ── Gender (under capacity) ── */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="label text-[11px] mb-0">Gender</label>
                {form.gender !== initial.gender && (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600">
                    Updated
                  </span>
                )}
              </div>
              <div className="flex gap-2" role="group" aria-label="Gender restriction">
                {[
                  { v: 'male',   l: 'Male'   },
                  { v: 'female', l: 'Female' },
                  { v: 'unisex', l: 'Unisex' },
                ].map(({ v, l }) => (
                  <button
                    key={v}
                    type="button"
                    aria-selected={form.gender === v}
                    onClick={() => set('gender', v)}
                    className={`rounded-full border px-4 py-2 text-xs font-semibold transition-all duration-150 active:scale-[.96]
                      ${form.gender === v
                        ? 'bg-emerald-50 border-emerald-500 text-emerald-700 shadow-sm shadow-emerald-100/60'
                        : 'border-slate-300 text-slate-600 bg-white hover:border-slate-400 hover:bg-slate-50'
                      }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-400">Optional — restrict who can stay in this room</p>
            </div>

            {/* Rent row */}
            <div className="flex gap-4 items-start">
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <label className="label text-[11px] mb-0">Base Rent <span className="text-red-400">*</span></label>
                  {baseRentChanged && (
                    <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600">
                      Updated
                    </span>
                  )}
                </div>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 font-semibold text-sm pointer-events-none">₹</span>
                  <input type="number" min="0"
                    className={`input pl-8 font-semibold tabular-nums ${errors.baseRent ? 'border-red-400' : baseRentChanged ? 'border-emerald-400 ring-1 ring-emerald-200/60' : ''}`}
                    placeholder={String(oldBaseRent)}
                    value={form.baseRent}
                    onChange={e => set('baseRent', e.target.value)}
                  />
                </div>
                {errors.baseRent && (
                  <p className="mt-1 text-[11px] text-red-500 font-medium flex items-center gap-1">
                    <AlertTriangle size={10} /> {errors.baseRent}
                  </p>
                )}
                {baseRentChanged && (
                  <p className="mt-1 text-[10px] text-slate-500 font-medium">
                    {fmt(oldBaseRent)} <span className="text-slate-300 mx-0.5">→</span> <span className="text-emerald-600 font-bold">{fmt(newBaseRent)}</span>
                  </p>
                )}
              </div>

              <div className="shrink-0">
                <div className="flex items-center justify-between mb-1 gap-3">
                  <label className="label text-[11px] mb-0">Billing</label>
                  {rentTypeChanged && !rentTypeBlock && (
                    <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-600">
                      Updated
                    </span>
                  )}
                </div>
                <div className="flex gap-1.5">
                  {[
                    { v: 'per_bed',  l: 'Per Bed',  sub: 'Each pays' },
                    { v: 'per_room', l: 'Split',     sub: 'Divided' },
                  ].map(opt => {
                    const active = newRentType === opt.v
                    const locked = rentTypeLocked && opt.v !== newRentType
                    return (
                      <button key={opt.v} type="button"
                        disabled={rentTypeLocked}
                        onClick={() => !rentTypeLocked && set('rentType', opt.v)}
                        className={`flex flex-col items-center text-center rounded-xl border px-3.5 py-2 transition-all duration-150
                          ${locked ? 'opacity-40 cursor-not-allowed border-slate-200 bg-slate-50'
                            : active
                              ? 'border-primary-400 bg-primary-50 shadow-sm active:scale-[.97]'
                              : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 active:scale-[.97]'
                          }`}>
                        <span className={`text-[11px] font-bold ${active && !locked ? 'text-primary-700' : 'text-slate-600'}`}>{opt.l}</span>
                        <span className={`text-[9px] mt-0.5 ${active && !locked ? 'text-primary-500' : 'text-slate-400'}`}>{opt.sub}</span>
                      </button>
                    )
                  })}
                </div>
                {rentTypeBlock && (
                  <p className="mt-1.5 text-[10px] text-amber-700 font-semibold flex items-center gap-1">
                    <Lock size={9} /> Vacate all tenants to change
                  </p>
                )}
                {rentTypeLocked && !rentTypeChanged && (
                  <p className="mt-1.5 text-[10px] text-slate-400 flex items-center gap-1">
                    <Lock size={9} /> Locked while occupied
                  </p>
                )}
                <p className="mt-1.5 text-[10px] text-slate-400 flex items-center gap-1">
                  <CheckCircle2 size={9} className="text-slate-300 shrink-0" />
                  Rent is automatically calculated based on room configuration and occupancy.
                </p>
              </div>
            </div>

            {/* Amenities + Category in 2 columns */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="label text-[11px] mb-0">Amenities</label>
                {[
                  { k: 'hasAC',               icon: Snowflake, label: 'Air Conditioning' },
                  { k: 'hasAttachedBathroom',  icon: Bath,      label: 'Attached Bathroom' },
                ].map(({ k, icon: Icon, label }) => (
                  <button key={k} type="button" onClick={() => set(k, !form[k])}
                    className={`w-full flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition-all duration-150 active:scale-[.98]
                      ${form[k] ? 'bg-blue-50 border-blue-300 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
                    <Icon size={13} className={form[k] ? 'text-blue-500' : 'text-slate-400'} />
                    <span className={`text-xs font-semibold flex-1 text-left ${form[k] ? 'text-blue-700' : 'text-slate-500'}`}>{label}</span>
                    {form[k] && <CheckCircle2 size={12} className="text-blue-400 shrink-0" />}
                  </button>
                ))}
              </div>

              <div className="space-y-2">
                <label className="label text-[11px] mb-0">Category</label>
                {[
                  { v: 'standard', l: 'Standard', icon: Home },
                  { v: 'premium',  l: 'Premium',  icon: Sparkles },
                  { v: 'luxury',   l: 'Luxury',   icon: Crown },
                ].map(({ v, l, icon: Icon }) => (
                  <button key={v} type="button" onClick={() => set('category', v)}
                    className={`w-full flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 transition-all duration-150 active:scale-[.98]
                      ${form.category === v ? 'bg-primary-50 border-primary-300 shadow-sm' : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}>
                    <Icon size={13} className={form.category === v ? 'text-primary-500' : 'text-slate-400'} />
                    <span className={`text-xs font-semibold flex-1 text-left ${form.category === v ? 'text-primary-700' : 'text-slate-500'}`}>{l}</span>
                    {form.category === v && <CheckCircle2 size={12} className="text-primary-500 shrink-0" />}
                  </button>
                ))}
              </div>
            </div>

          </div>

          {/* ── SECTION 3: Change Impact ───────────────────────────────────── */}
          {anyChange && !isHardBlocked && (
            <>
              <div className="h-px bg-slate-100" />
              <div className="space-y-3">

                {/* ── What Changed summary ── */}
                {changeList.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">What Changed</p>
                    <div className="space-y-1">
                      {changeList.map(({ label, from, to }) => (
                        <div key={label} className="flex items-center gap-1.5 text-[11px]">
                          <span className="text-slate-400 font-semibold shrink-0 w-[68px]">{label}</span>
                          <span className="text-slate-500 tabular-nums">{from}</span>
                          <span className="text-slate-300 mx-0.5">→</span>
                          <span className="text-slate-700 font-bold tabular-nums">{to}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-amber-600">Change Impact</p>
                </div>

                {/* Capacity impact */}
                {capacityChanged && capDiff > 0 && (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 space-y-2">
                    <p className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                      <CheckCircle2 size={12} /> Capacity {oldCapacity} → {newCapacity}
                    </p>
                    <p className="text-[11px] text-emerald-600">{capDiff} new bed{capDiff > 1 ? 's' : ''} will be created</p>
                    {newBedLabels.length > 0 && (
                      <div className="flex gap-1 flex-wrap">
                        <span className="text-[10px] text-emerald-600 font-medium mr-1">New beds:</span>
                        {newBedLabels.map((l, i) => (
                          <span key={i} className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-emerald-100 border border-emerald-300 text-emerald-700 text-[10px] font-black font-mono">
                            {l}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {capacityChanged && capDiff < 0 && !capacityTooLow && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <p className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
                      <AlertTriangle size={12} /> Capacity {oldCapacity} → {newCapacity}
                    </p>
                    <p className="text-[11px] text-amber-600 mt-1">
                      {Math.abs(capDiff)} vacant bed{Math.abs(capDiff) > 1 ? 's' : ''} will be removed
                    </p>
                  </div>
                )}

                {/* Before / After rent card */}
                {(baseRentChanged || rentTypeChanged) && (
                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-slate-200">
                      <div className="px-4 py-3 bg-slate-50">
                        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2">Before</p>
                        <p className="text-[15px] font-black text-slate-700 tabular-nums leading-none">
                          {fmt(oldBaseRent)}
                          <span className="text-[10px] font-medium text-slate-400 ml-1">/mo</span>
                        </p>
                        <p className="text-[10px] text-slate-400 mt-1">
                          {oldRentType === 'per_bed' ? 'Per Bed · each tenant' : 'Split · room total'}
                        </p>
                      </div>
                      <div className="px-4 py-3 bg-emerald-50/70">
                        <p className="text-[9px] font-black uppercase tracking-widest text-emerald-600 mb-2">After</p>
                        <p className="text-[15px] font-black text-emerald-700 tabular-nums leading-none">
                          {fmt(newBaseRent > 0 ? newBaseRent : oldBaseRent)}
                          <span className="text-[10px] font-medium text-emerald-400 ml-1">/mo</span>
                        </p>
                        <p className="text-[10px] text-emerald-600 mt-1">
                          {newRentType === 'per_bed' ? 'Per Bed · each tenant' : 'Split · room total'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Rent impact simulation */}
                {(baseRentChanged || rentTypeChanged) && tenantImpact.length > 0 && (
                  <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-slate-100 bg-slate-50">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Tenant Rent Impact</p>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {tenantImpact.map(({ bed, oldRent, newRent, diff, source }) => (
                        <div key={bed._id} className="flex items-center gap-3 px-4 py-2.5">
                          <span className="inline-flex items-center justify-center h-6 w-6 rounded-md bg-red-50 border border-red-200 text-red-700 text-[10px] font-black font-mono shrink-0">
                            {bed.bedNumber}
                          </span>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-semibold text-slate-700 truncate block">{bed.tenant?.name}</span>
                            {source && (
                              <span className="text-[9px] text-slate-400">{SOURCE_LABELS[source] ?? source}</span>
                            )}
                            {DEBUG_RENT && source && (
                              <span className="font-mono text-[8px] text-slate-300 ml-1">({source})</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-[11px] text-slate-400 tabular-nums line-through">{fmt(oldRent)}</span>
                            <span className="text-[10px] text-slate-300">→</span>
                            <span className={`text-[12px] font-bold tabular-nums ${diff > 0 ? 'text-red-600' : diff < 0 ? 'text-emerald-600' : 'text-slate-600'}`}>
                              {fmt(newRent)}
                            </span>
                            {diff !== 0 && (
                              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border tabular-nums ${
                                diff > 0
                                  ? 'bg-red-50 border-red-200 text-red-600'
                                  : 'bg-emerald-50 border-emerald-200 text-emerald-600'
                              }`}>
                                {diff > 0 ? '+' : ''}{fmt(diff)}
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recalculate notice when tenants exist + rent is changing */}
                {(baseRentChanged || rentTypeChanged) && tenantImpact.length > 0 && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 space-y-2.5">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-700 font-medium leading-relaxed">
                        Rent changes are applied automatically to all existing tenants when you save.
                        The simulation above shows their new amounts.
                      </p>
                    </div>
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <div className="h-4 w-4 rounded border-2 border-amber-400 bg-amber-400 flex items-center justify-center shrink-0">
                        <CheckCircle2 size={10} className="text-white" />
                      </div>
                      <span className="text-[11px] font-semibold text-amber-800">
                        Recalculate rent for existing tenants on save
                      </span>
                      <span className="ml-auto text-[9px] font-bold bg-amber-200 text-amber-700 rounded-full px-2 py-0.5">Auto</span>
                    </label>
                  </div>
                )}

                {/* Warning: rent change won't auto-apply unless backend recalculates */}
                {(baseRentChanged || rentTypeChanged) && tenantImpact.length === 0 && (
                  <div className="flex items-start gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2.5">
                    <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-amber-700">No tenants currently assigned — rent change will apply to new assignments.</p>
                  </div>
                )}

                {/* System confidence indicator */}
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-200 px-3 py-2">
                  <CheckCircle2 size={12} className="text-emerald-500 shrink-0" />
                  <p className="text-[11px] text-emerald-700 font-medium">
                    All rent calculations will be automatically updated on save.
                  </p>
                </div>
              </div>
            </>
          )}

          {/* ── SECTION 4: Live Final Preview ─────────────────────────────── */}
          {anyChange && !isHardBlocked && (
            <>
              <div className="h-px bg-slate-100" />
              <div className="space-y-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Final State Preview</p>

                {/* Bed pills */}
                <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-3 flex flex-wrap gap-1.5 min-h-[44px] items-center">
                  {allBedLabels.map((label, i) => {
                    const existingBed = normalBeds.find(b => b.bedNumber === label)
                    const isNew = i >= oldCapacity && capacityChanged && capDiff > 0
                    return (
                      <span key={i} className={`inline-flex items-center justify-center h-7 w-7 rounded-lg text-[11px] font-black font-mono border transition-all
                        ${isNew
                          ? 'bg-emerald-100 border-emerald-300 text-emerald-700 ring-1 ring-emerald-400/40'
                          : existingBed?.status === 'occupied'
                            ? 'bg-red-50 border-red-200 text-red-700'
                            : existingBed?.status === 'reserved'
                              ? 'bg-amber-50 border-amber-200 text-amber-700'
                              : 'bg-primary-50 border-primary-200 text-primary-700'
                        }`}>
                        {label}
                      </span>
                    )
                  })}
                  {hiddenBeds > 0 && (
                    <span className="inline-flex items-center justify-center h-7 rounded-full border border-dashed border-slate-300 bg-white text-slate-400 text-[10px] font-medium px-2.5">
                      +{hiddenBeds} more
                    </span>
                  )}
                  {/* Legend */}
                  <div className="ml-auto flex items-center gap-2.5 shrink-0">
                    {[
                      { cls: 'bg-red-50 border-red-200',      label: 'Occupied' },
                      { cls: 'bg-emerald-100 border-emerald-300', label: 'New' },
                      { cls: 'bg-primary-50 border-primary-200',  label: 'Vacant' },
                    ].map(({ cls, label }) => (
                      <span key={label} className="flex items-center gap-1 text-[9px] text-slate-400">
                        <span className={`inline-block h-3 w-3 rounded border ${cls}`} />{label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Rent preview — values from shared calculateRent engine */}
                {newBaseRent > 0 && (
                  <div className={`rounded-xl border px-4 py-3 flex items-center gap-5 ${
                    newRentType === 'per_bed' ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'
                  }`}>
                    <div>
                      <p className={`text-[9px] font-black uppercase tracking-widest mb-0.5 ${newRentType === 'per_bed' ? 'text-emerald-600' : 'text-blue-600'}`}>
                        {newRentType === 'per_bed' ? 'Each tenant pays' : 'Room rent'}
                      </p>
                      <p className={`text-[22px] font-black leading-none tabular-nums ${newRentType === 'per_bed' ? 'text-emerald-700' : 'text-blue-700'}`}>
                        {newRentType === 'per_bed' ? fmt(fspPerTenant) : fmt(newBaseRent)}
                        <span className={`text-[11px] font-medium ml-1 ${newRentType === 'per_bed' ? 'text-emerald-500' : 'text-blue-500'}`}>/mo</span>
                      </p>
                      {fspSource && (
                        <p className={`text-[9px] mt-0.5 ${newRentType === 'per_bed' ? 'text-emerald-500' : 'text-blue-500'}`}>
                          {SOURCE_LABELS[fspSource] ?? fspSource}
                        </p>
                      )}
                      {DEBUG_RENT && _fspResult && (
                        <div className="mt-1 rounded bg-slate-100 px-1.5 py-1 font-mono text-[9px] text-slate-500 space-y-0.5">
                          <p>Source: {_fspResult.source}</p>
                          {_fspResult.meta?.divisor != null && <p>Divisor: {_fspResult.meta.divisor}</p>}
                        </div>
                      )}
                    </div>
                    <div className={`h-10 w-px ${newRentType === 'per_bed' ? 'bg-emerald-200' : 'bg-blue-200'}`} />
                    <div>
                      <p className={`text-[9px] font-black uppercase tracking-widest mb-0.5 ${newRentType === 'per_bed' ? 'text-emerald-600' : 'text-blue-600'}`}>
                        {newRentType === 'per_bed' ? `Total (${newCapacity} beds)` : 'Per person (if full)'}
                      </p>
                      <p className={`text-[16px] font-bold leading-none tabular-nums ${newRentType === 'per_bed' ? 'text-emerald-700' : 'text-blue-700'}`}>
                        {newRentType === 'per_bed' ? fmt(fspTotal) : fmt(fspPerTenant)}
                        <span className={`text-[10px] font-medium ml-1 ${newRentType === 'per_bed' ? 'text-emerald-500' : 'text-blue-500'}`}>/mo</span>
                      </p>
                    </div>
                    <div className={`h-10 w-px ${newRentType === 'per_bed' ? 'bg-emerald-200' : 'bg-blue-200'}`} />
                    <div>
                      <p className={`text-[9px] font-black uppercase tracking-widest mb-0.5 ${newRentType === 'per_bed' ? 'text-emerald-600' : 'text-blue-600'}`}>
                        Occupancy
                      </p>
                      <p className={`text-[16px] font-bold leading-none tabular-nums ${newRentType === 'per_bed' ? 'text-emerald-700' : 'text-blue-700'}`}>
                        {occupiedCount} / {newCapacity}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Extra beds warning if risky change */}
          {extraCount > 0 && capacityChanged && (
            <div className="flex items-start gap-2 rounded-xl bg-orange-50 border border-orange-200 px-3 py-2.5">
              <AlertTriangle size={13} className="text-orange-500 shrink-0 mt-0.5" />
              <p className="text-xs text-orange-700 font-medium">
                {extraCount} extra bed{extraCount > 1 ? 's' : ''} active — extra beds are not affected by capacity changes.
              </p>
            </div>
          )}

          {/* No-change → Live Room Preview */}
          {!anyChange && !bedsLoading && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BedDouble size={12} className="text-slate-400" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Live Room Preview</p>
                </div>
                <span className="text-[10px] font-semibold text-slate-400 tabular-nums">
                  {occupiedCount} / {oldCapacity} occupied
                </span>
              </div>
              <div className="px-4 py-3 space-y-3">
                <div className="flex flex-wrap gap-1.5 min-h-[32px] items-center">
                  {normalBeds.map(bed => {
                    const s = BED_STATUS[bed.status] ?? BED_STATUS.vacant
                    return (
                      <span key={bed._id} className={`inline-flex items-center justify-center h-7 w-7 rounded-lg text-[11px] font-black font-mono border ${s.bg} ${s.border} ${s.text}`}>
                        {bed.bedNumber}
                      </span>
                    )
                  })}
                  {extraBeds.map(bed => (
                    <span key={bed._id} className="relative inline-flex items-center justify-center h-7 w-7 rounded-lg text-[11px] font-black font-mono border bg-violet-50 border-violet-200 text-violet-700">
                      {bed.bedNumber}
                      <span className="absolute -top-1.5 -left-1.5 h-3.5 w-3.5 rounded-full bg-violet-500 border-2 border-white flex items-center justify-center">
                        <span className="text-[7px] font-black text-white leading-none">X</span>
                      </span>
                    </span>
                  ))}
                  {beds.length === 0 && (
                    <span className="text-[11px] text-slate-400 italic">No beds yet</span>
                  )}
                </div>
                <p className="text-[10px] text-slate-400 flex items-center gap-1.5">
                  <span className="h-1 w-1 rounded-full bg-slate-300 shrink-0 inline-block" />
                  Make changes above to see impact
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="shrink-0 px-6 pb-5 pt-4 border-t border-slate-100 flex items-center gap-3">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!canSubmit}
            className={`flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold text-white
              transition-all shadow-sm active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed
              ${isRiskyChange
                ? 'bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 shadow-amber-200/50'
                : 'bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 shadow-primary-200/50'
              }`}>
            {saving ? (
              <>
                <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />
                Saving…
              </>
            ) : isRiskyChange ? (
              <><AlertTriangle size={14} /> Confirm Changes</>
            ) : (
              <><CheckCircle2 size={14} /> Save Changes</>
            )}
          </button>
        </div>
      </form>
    </Modal>
  )
}

const RoomFormModal = ({ mode = 'add', initialData, onSubmit, onClose, saving, occupiedBeds = 0 }) => {
  const isEdit         = mode === 'edit'
  const rentTypeLocked = isEdit && occupiedBeds > 0
  const bnLocked       = isEdit  // immutable after creation

  const [typeChangeAcknowledged, setTypeChangeAcknowledged] = useState(false)

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
    bedNumberingType:    initialData?.bedNumberingType ?? 'alphabet',
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
    setForm(f => ({
      ...f, type: v,
      capacity: cap !== undefined ? String(cap) : (f.capacity || String(initialData?.capacity ?? 4)),
    }))
    // Reset acknowledgment whenever type selection changes
    setTypeChangeAcknowledged(false)
  }

  // True when the user has selected a different type than the saved value
  const typeChanged = isEdit && form.type !== (initialData?.type ?? form.type)

  const bedPreview = previewBedLabels(form.bedNumberingType)

  const validate = () => {
    const errs = {}
    if (!form.roomNumber.trim()) errs.roomNumber = 'Room number is required'
    if (!form.baseRent || Number(form.baseRent) < 0) errs.baseRent = 'Rent is required'
    if (form.type === 'dormitory') {
      const cap = Number(form.capacity)
      if (!form.capacity || isNaN(cap) || cap < 1) errs.capacity = 'Min 1'
    }
    if (typeChanged && !typeChangeAcknowledged) errs.typeChange = 'Acknowledge the bed regeneration warning to continue'
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
      bedNumberingType:    form.bedNumberingType,
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
                className={`input uppercase tracking-wider font-semibold
                  ${errors.roomNumber ? 'border-red-400 focus:ring-red-200' : ''}
                  ${isEdit ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''}`}
                placeholder="e.g. 101"
                value={form.roomNumber}
                onChange={e => !isEdit && set('roomNumber', e.target.value)}
                readOnly={isEdit}
                autoFocus={!isEdit}
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
              <select className="input" value={form.type} onChange={e => handleTypeChange(e.target.value)}>
                <option value="single">Single</option>
                <option value="double">Double</option>
                <option value="triple">Triple</option>
                <option value="dormitory">Dormitory</option>
              </select>
            </div>
            <div>
              <label className="label">Capacity {isDorm ? '*' : '(auto)'}</label>
              <input type="number" min="1" max="20"
                className={`input ${!isDorm ? 'bg-slate-50 text-slate-400 cursor-not-allowed' : ''} ${errors.capacity ? 'border-red-400' : ''}`}
                value={form.capacity}
                onChange={e => isDorm && set('capacity', e.target.value)}
                readOnly={!isDorm}
              />
              {errors.capacity && <p className="mt-1 text-[11px] text-red-500 font-medium">{errors.capacity}</p>}
            </div>
          </div>
        </div>

        {/* ── Type change warning ──────────────────────────────────── */}
        {typeChanged && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle size={15} className="text-red-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold text-red-700">Changing room type will regenerate all beds</p>
                <ul className="mt-1.5 space-y-1">
                  {[
                    'All existing beds will be deleted and recreated',
                    `New capacity: ${CAPACITY_DEFAULT[form.type] ?? form.capacity} beds (${form.type})`,
                    'Tenant assignments must be cleared first',
                    'This cannot be undone',
                  ].map(item => (
                    <li key={item} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1 w-1 rounded-full bg-red-400 shrink-0" />
                      <span className="text-[11px] text-red-600 leading-relaxed">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={typeChangeAcknowledged}
                onChange={e => setTypeChangeAcknowledged(e.target.checked)}
                className="h-4 w-4 rounded border-red-300 accent-red-600 cursor-pointer"
              />
              <span className="text-xs font-semibold text-red-700">
                I understand all beds will be removed and recreated
              </span>
            </label>
          </div>
        )}

        <div className="border-t border-slate-100" />

        {/* ── Section 2: Bed Numbering ──────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader icon={BedDouble} title="Bed Numbering" subtitle={bnLocked ? 'Fixed after creation' : 'How beds in this room are labelled'} />
          {bnLocked ? (
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5">
              <Lock size={12} className="text-slate-400 shrink-0" />
              <span className="text-xs text-slate-500">
                {form.bedNumberingType === 'alphabet' ? 'Alphabet — A, B, C' : 'Numeric — 1, 2, 3'}
              </span>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'alphabet', label: 'Alphabet', hint: 'A, B, C …' },
                  { value: 'numeric',  label: 'Numeric',  hint: '1, 2, 3 …' },
                ].map(opt => (
                  <button key={opt.value} type="button"
                    onClick={() => set('bedNumberingType', opt.value)}
                    className={`flex items-center gap-3 rounded-xl border px-4 py-3 transition-all text-left
                      ${form.bedNumberingType === opt.value
                        ? 'border-primary-400 bg-primary-50 ring-2 ring-primary-200/60'
                        : 'border-slate-200 hover:bg-slate-50'}`}>
                    <div>
                      <p className="text-xs font-bold text-slate-700">{opt.label}</p>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5">{opt.hint}</p>
                    </div>
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-slate-400 font-medium mr-1">Preview:</span>
                {bedPreview.map((label, i) => (
                  <span key={i} className="inline-flex items-center justify-center rounded-lg border border-primary-200 bg-primary-50 text-primary-700 text-xs font-bold w-7 h-7 font-mono">
                    {label}
                  </span>
                ))}
                {Number(form.capacity) > 4 && (
                  <span className="text-[10px] text-slate-400">+{Number(form.capacity) - 4} more</span>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-slate-100" />

        {/* ── Section 3: Rent Details ───────────────────────────────── */}
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
                  { value: 'standard', label: 'Standard', icon: Home },
                  { value: 'premium',  label: 'Premium',  icon: Crown },
                  { value: 'luxury',   label: 'Luxury',   icon: Crown },
                ].map(opt => (
                  <SelectableChip key={opt.value} label={opt.label} icon={opt.icon}
                    active={form.category === opt.value} onClick={() => set('category', opt.value)} />
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100" />

        {/* ── Section 4: Amenities ─────────────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader icon={Snowflake} title="Amenities" subtitle="Room features" />
          <div className="flex flex-wrap gap-2">
            <SelectableChip label="AC" icon={Snowflake} active={form.hasAC} onClick={() => toggle('hasAC')} color="blue" />
            <SelectableChip label="Attached Bath" icon={Bath} active={form.hasAttachedBathroom} onClick={() => toggle('hasAttachedBathroom')} color="blue" />
          </div>
        </div>

        <div className="border-t border-slate-100" />

        {/* ── Section 5: Additional Info ───────────────────────────── */}
        <div className="space-y-3">
          <SectionHeader icon={StickyNote} title="Additional Info" subtitle="Gender & notes" />
          <div>
            <label className="label">Gender Type</label>
            <div className="flex gap-2">
              {[
                { value: 'male',   label: 'Male' },
                { value: 'female', label: 'Female' },
                { value: 'unisex', label: 'Unisex' },
              ].map(opt => (
                <SelectableChip key={opt.value} label={opt.label}
                  active={form.gender === opt.value} onClick={() => set('gender', opt.value)} />
              ))}
            </div>
          </div>
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
          <button
            type="submit"
            className={`btn-primary flex-1 transition-opacity ${typeChanged && !typeChangeAcknowledged ? 'opacity-40 cursor-not-allowed' : ''}`}
            disabled={saving || (typeChanged && !typeChangeAcknowledged)}
            title={typeChanged && !typeChangeAcknowledged ? 'Check the acknowledgment box above to continue' : undefined}
          >
            {saving
              ? (isEdit ? 'Saving…' : 'Adding…')
              : typeChanged
                ? 'Confirm Type Change'
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
  overCapacity: false,
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
    filters.sortBy !== 'default' || filters.floor !== 'all' || filters.overCapacity

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
                    <button onClick={() => onFilterChange('overCapacity', !filters.overCapacity)}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium border transition-colors ${
                        filters.overCapacity ? 'bg-red-50 border-red-300 text-red-600' : 'bg-slate-50 border-slate-200 text-slate-500'
                      }`}><AlertTriangle size={12} />Over Capacity</button>
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
          <span className="h-4 w-px bg-slate-200 mx-1 shrink-0" />
          <SelectableChip
            label="Over Capacity"
            icon={AlertTriangle}
            active={filters.overCapacity}
            onClick={() => onFilterChange('overCapacity', !filters.overCapacity)}
            color="red"
          />
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
  const [confirmDelete,     setConfirmDelete]     = useState(null)
  const [deleteConfirmText, setDeleteConfirmText] = useState('')
  const [saving,         setSaving]         = useState(false)
  const [filters,        setFilters]        = useState(FILTER_DEFAULTS)
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const searchDebounceRef = useRef(null)
  const [showFilters,    setShowFilters]    = useState(false)
  const [bedStats,       setBedStats]       = useState({})
  const [bedRefreshKeys, setBedRefreshKeys] = useState({})
  const [modalBed,       setModalBed]       = useState(null)
  const [loadingBedId,   setLoadingBedId]   = useState(null)
  const [selectedRoom,   setSelectedRoom]   = useState(null)
  const [viewTenant,     setViewTenant]     = useState(null)
  const [extraBedRoom,   setExtraBedRoom]   = useState(null)  // { room, existingExtraCount }

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
    filters.floor !== 'all' ||
    filters.overCapacity
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

    // Over Capacity
    if (filters.overCapacity) {
      list = list.filter(r => {
        const s = bedStats[r._id]
        return s && s.total > r.capacity
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
          cur.reserved === stats.reserved && cur.total === stats.total &&
          cur.extraActive === stats.extraActive) return prev
      return { ...prev, [roomId]: stats }
    })
  }, [])

  // Fetch tenant and open the profile drawer directly
  const handleViewTenant = async (tenantId) => {
    if (!tenantId) return
    try {
      const res = await getTenant(propertyId, tenantId)
      setViewTenant(res.data?.data ?? null)
    } catch {
      setViewTenant(null)
    }
  }

  // Map quick-action label → BedActionModal view
  const ACTION_VIEW = {
    Assign:        'assign',
    Reserve:       'reserve',
    Vacate:        'vacate',
    Confirm:       'assign',      // reserved → Convert to Tenant assign form
    Cancel:        'actions',     // open actions panel; "Cancel Reservation" button is there
    'Change Room':       'changeRoom',
    'Move Reservation':  'moveReservation',
  }

  const handleBedClick = (bed, room, refetch, action = null) => {
    // "View" button OR plain card click on an occupied bed → open tenant profile directly
    const isViewIntent = action === 'View' || (action === null && bed.status === 'occupied')
    if (isViewIntent && bed.tenant?._id) {
      handleViewTenant(bed.tenant._id)
      return
    }

    const initialView = (action && ACTION_VIEW[action]) || 'actions'
    setModalBed({ bed, room, refetch, initialView })
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
      // Trigger bed refetch for this room (type/capacity change syncs beds server-side)
      setBedRefreshKeys(prev => ({ ...prev, [editRoom._id]: (prev[editRoom._id] ?? 0) + 1 }))
      setEditRoom(null)
      refetchRooms()
      toast(`Room ${formData.roomNumber} updated`, 'success')
    } catch (err) {
      const errData = err.response?.data
      if (errData?.code === 'ROOM_TYPE_CHANGE_BLOCKED') {
        const REASON_LABELS = {
          occupied_beds: 'Vacate all tenants before changing room type',
          extra_beds:    'Remove all extra beds before changing room type',
        }
        const msgs = (errData.reasons ?? []).map(r => REASON_LABELS[r] ?? r)
        toast(msgs.length > 1 ? msgs.join(' · ') : msgs[0] ?? errData.message, 'error')
      } else if (errData?.code === 'RENT_TYPE_LOCKED') {
        toast('Cannot change rent type while tenants are assigned', 'error')
      } else if (errData?.code === 'CAPACITY_BELOW_OCCUPIED') {
        toast(`Capacity cannot be less than ${errData.meta?.occupiedBeds ?? 'current'} occupied beds`, 'error')
      } else {
        toast(errData?.message || 'Error updating room', 'error')
      }
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

  // Reactivate: show green confirmation modal
  const [confirmReactivate, setConfirmReactivate] = useState(null)

  const handleReactivateRoom = (room) => {
    setConfirmReactivate(room)
  }

  const confirmReactivateAction = async () => {
    if (!confirmReactivate) return
    try {
      await updateRoom(propertyId, confirmReactivate._id, { isActive: true })
      setConfirmReactivate(null)
      refetchRooms()
      toast(`Room ${confirmReactivate.roomNumber} reactivated`, 'success')
    } catch (err) {
      toast(err.response?.data?.message || 'Failed to reactivate room', 'error')
    }
  }

  // Delete Forever: show confirmation (only from inactive state)
  const handleDeleteRoom = (room) => {
    setDeleteConfirmText('')
    setConfirmDelete(room)
  }

  const confirmDeleteAction = async () => {
    if (!confirmDelete) return
    try {
      await deleteRoom(propertyId, confirmDelete._id)
      setConfirmDelete(null)
      setDeleteConfirmText('')
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
              onAddExtraBed={(room, existingExtraCount, vacantNormalCount) => setExtraBedRoom({ room, existingExtraCount, vacantNormalCount })}
              onRoomClick={room => setSelectedRoom(room)}
              loadingBedId={loadingBedId}
              refreshKey={bedRefreshKeys[r._id] ?? 0}
            />
          ))}
        </div>
      )}

      {/* Add Room Modal */}
      {showAddRoom && (
        <AddRoomModal
          onSubmit={handleAddRoom}
          onClose={() => setShowAddRoom(false)}
          saving={saving}
        />
      )}

      {/* Edit Room Modal */}
      {editRoom && (
        <EditRoomModal
          room={editRoom}
          propertyId={propertyId}
          onSubmit={handleSaveEdit}
          onClose={() => setEditRoom(null)}
          saving={saving}
        />
      )}

      {/* Bed Action Modal */}
      {modalBed && (
        <BedActionModal
          bed={modalBed.bed}
          room={modalBed.room}
          propertyId={propertyId}
          occupancy={bedStats[modalBed.room._id] ?? null}
          allRooms={rooms}
          initialView={modalBed.initialView}
          onClose={() => setModalBed(null)}
          onSuccess={async (opts) => {
            const bedId   = modalBed.bed._id
            const refetch = modalBed.refetch
            setModalBed(null)
            setLoadingBedId(bedId)
            try {
              await refetch()
            } finally {
              setLoadingBedId(null)
            }
            // If tenant moved to a different room, also refresh that room's card
            if (opts?.targetRoomId && opts.targetRoomId !== modalBed.room._id) {
              setBedRefreshKeys(prev => ({ ...prev, [opts.targetRoomId]: (prev[opts.targetRoomId] ?? 0) + 1 }))
            }
          }}
          onViewTenant={handleViewTenant}
        />
      )}

      {/* Extra Bed Modal */}
      {extraBedRoom && (
        <ExtraBedModal
          room={extraBedRoom.room}
          propertyId={propertyId}
          existingExtraCount={extraBedRoom.existingExtraCount}
          vacantNormalCount={extraBedRoom.vacantNormalCount ?? 0}
          onClose={() => setExtraBedRoom(null)}
          onSuccess={() => {
            setExtraBedRoom(null)
            refetchRooms()
          }}
        />
      )}

      {/* Deactivate Confirmation Modal */}
      {confirmDeactivate && (() => {
        const s           = bedStats[confirmDeactivate._id] ?? {}
        const occCount    = s.occupied    ?? 0
        const extraCount  = s.extraActive ?? 0
        const blocked     = occCount > 0 || extraCount > 0
        const blockMsg    = occCount > 0
          ? 'Cannot deactivate room with active tenants. Please vacate all tenants first.'
          : 'Remove or vacate extra beds before proceeding.'
        return (
        <Modal title="Deactivate Room" onClose={() => setConfirmDeactivate(null)} size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3.5">
              <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-800">Room {confirmDeactivate.roomNumber}</p>
                {blocked ? (
                  <p className="text-xs text-red-700 mt-1 leading-relaxed font-medium">{blockMsg}</p>
                ) : (
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    This room will be hidden from active view and cannot be assigned or reserved.
                    Existing tenants will remain unaffected.
                  </p>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setConfirmDeactivate(null)}>Cancel</button>
              {!blocked && (
                <button className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors shadow-sm"
                  onClick={confirmDeactivateAction}>
                  <Power size={14} /> Deactivate
                </button>
              )}
            </div>
          </div>
        </Modal>
        )
      })()}

      {/* Reactivate Confirmation Modal */}
      {confirmReactivate && (
        <Modal title="Reactivate Room" onClose={() => setConfirmReactivate(null)} size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3.5">
              <RotateCcw size={18} className="text-emerald-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-800">Room {confirmReactivate.roomNumber}</p>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  This room will be restored and available for assignments again.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => setConfirmReactivate(null)}>Cancel</button>
              <button className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors shadow-sm"
                onClick={confirmReactivateAction}>
                <RotateCcw size={14} /> Reactivate
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Forever Confirmation Modal */}
      {confirmDelete && (() => {
        const expectedText = `Room ${confirmDelete.roomNumber}`
        const canDelete    = deleteConfirmText === expectedText
        return (
        <Modal title="Permanent Delete Room" onClose={() => { setConfirmDelete(null); setDeleteConfirmText('') }} size="sm">
          <div className="space-y-4">
            <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3.5">
              <Trash2 size={18} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-bold text-red-700">This action is irreversible.</p>
                <p className="text-xs text-red-600/80 mt-1.5 leading-relaxed">
                  Deleting <span className="font-semibold">Room {confirmDelete.roomNumber}</span> will:
                </p>
                <ul className="mt-1.5 space-y-0.5 text-xs text-red-600/80 list-disc list-inside leading-relaxed">
                  <li>Remove all beds</li>
                  <li>Remove room configuration</li>
                </ul>
                <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                  Tenant history and rent records will be preserved.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-600">
                Type <span className="font-semibold text-slate-800">{expectedText}</span> to confirm
              </label>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={e => setDeleteConfirmText(e.target.value)}
                placeholder={expectedText}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100 transition"
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <button className="btn-secondary flex-1" onClick={() => { setConfirmDelete(null); setDeleteConfirmText('') }}>Cancel</button>
              <button
                disabled={!canDelete}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                onClick={confirmDeleteAction}>
                <Trash2 size={14} /> Delete Forever
              </button>
            </div>
          </div>
        </Modal>
        )
      })()}

      {/* Room Detail Drawer */}
      {selectedRoom && (
        <RoomDetailDrawer
          room={selectedRoom}
          propertyId={propertyId}
          onClose={() => setSelectedRoom(null)}
          onBedClick={handleBedClick}
          onEditRoom={handleEditRoom}
          onAddExtraBed={(room, existingExtraCount, vacantNormalCount) => setExtraBedRoom({ room, existingExtraCount, vacantNormalCount })}
          loadingBedId={loadingBedId}
        />
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

