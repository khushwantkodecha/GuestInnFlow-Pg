import { useState, useCallback } from 'react'
import { User, Phone, FileText, IndianRupee, Calendar, UserPlus } from 'lucide-react'
import Modal from '../ui/Modal'
import PhoneInput from '../ui/PhoneInput'

const INITIAL_FORM = {
  fullName: '',
  phone: '',
  idProof: '',
  rent: '',
  dueDate: '',
  hasExtra: false,
  extraName: '',
  extraPhone: '',
}

const AssignTenantModal = ({ room, bed, onClose, onAssignTenant }) => {
  const [form, setForm] = useState(INITIAL_FORM)
  const [errors, setErrors] = useState({})

  const set = useCallback((key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    if (errors[key]) setErrors((prev) => ({ ...prev, [key]: '' }))
  }, [errors])

  const validate = () => {
    const errs = {}
    if (!form.fullName.trim()) errs.fullName = 'Name is required'
    if (!form.phone) errs.phone = 'Phone is required'
    if (!form.rent) errs.rent = 'Rent is required'
    else if (Number(form.rent) <= 0) errs.rent = 'Must be greater than 0'
    if (form.hasExtra) {
      if (!form.extraName.trim()) errs.extraName = 'Extra person name required'
      if (!form.extraPhone) errs.extraPhone = 'Extra person phone required'
    }
    return errs
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length) {
      setErrors(errs)
      return
    }
    const payload = {
      roomId: room?.id,
      bedId: bed?.id,
      fullName: form.fullName.trim(),
      phone: form.phone.trim(),
      idProof: form.idProof.trim(),
      rent: Number(form.rent),
      dueDate: form.dueDate || null,
      extraPerson: form.hasExtra
        ? { name: form.extraName.trim(), phone: form.extraPhone.trim() }
        : null,
    }
    if (onAssignTenant) {
      onAssignTenant(payload)
    }
  }

  return (
    <Modal title="Assign Tenant" onClose={onClose}>
      {/* Subtitle — Room & Bed context */}
      <div className="flex items-center gap-2 mb-5 -mt-1">
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-primary-50 border border-primary-100 px-2.5 py-1 text-xs font-medium text-primary-700">
          Room {room?.roomNumber ?? '—'}
        </span>
        <span className="text-slate-300">•</span>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600">
          Bed {bed?.bedNumber ?? '—'}
        </span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── Full Name ──────────────────────────────────────────────────── */}
        <div>
          <label className="label flex items-center gap-1.5">
            <User size={13} className="text-slate-400" />
            Full Name <span className="text-red-400">*</span>
          </label>
          <input
            className={`input ${errors.fullName ? 'border-red-400 focus:ring-red-400/20' : ''}`}
            placeholder="e.g. Aarav Patel"
            value={form.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            autoFocus
          />
          {errors.fullName && <p className="mt-1 text-xs text-red-500">{errors.fullName}</p>}
        </div>

        {/* ── Phone ──────────────────────────────────────────────────────── */}
        <div>
          <label className="label flex items-center gap-1.5">
            <Phone size={13} className="text-slate-400" />
            Phone Number <span className="text-red-400">*</span>
          </label>
          <PhoneInput
            value={form.phone}
            onChange={(v) => set('phone', v)}
            error={!!errors.phone}
          />
          {errors.phone && <p className="mt-1 text-xs text-red-500">{errors.phone}</p>}
        </div>

        {/* ── ID Proof ───────────────────────────────────────────────────── */}
        <div>
          <label className="label flex items-center gap-1.5">
            <FileText size={13} className="text-slate-400" />
            ID Proof
          </label>
          <input
            className="input"
            placeholder="Aadhaar / PAN / Passport number"
            value={form.idProof}
            onChange={(e) => set('idProof', e.target.value)}
          />
        </div>

        {/* ── Rent & Due Date (side by side) ──────────────────────────── */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label flex items-center gap-1.5">
              <IndianRupee size={13} className="text-slate-400" />
              Rent Amount <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              min="0"
              className={`input ${errors.rent ? 'border-red-400 focus:ring-red-400/20' : ''}`}
              placeholder="e.g. 8000"
              value={form.rent}
              onChange={(e) => set('rent', e.target.value)}
            />
            {errors.rent && <p className="mt-1 text-xs text-red-500">{errors.rent}</p>}
          </div>
          <div>
            <label className="label flex items-center gap-1.5">
              <Calendar size={13} className="text-slate-400" />
              Due Date
            </label>
            <input
              type="date"
              className="input"
              value={form.dueDate}
              onChange={(e) => set('dueDate', e.target.value)}
            />
          </div>
        </div>

        {/* ── Divider ────────────────────────────────────────────────────── */}
        <div className="border-t border-slate-100" />

        {/* ── Extra Person Toggle ─────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserPlus size={14} className="text-slate-400" />
            <span className="text-sm font-medium text-slate-600">Add Extra Person</span>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={form.hasExtra}
            onClick={() => set('hasExtra', !form.hasExtra)}
            className={`
              relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full
              transition-colors duration-200
              ${form.hasExtra ? 'bg-primary-500' : 'bg-slate-200'}
            `}
          >
            <span
              className={`
                inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm
                transition-transform duration-200
                ${form.hasExtra ? 'translate-x-[18px]' : 'translate-x-[3px]'}
              `}
            />
          </button>
        </div>

        {/* ── Extra Person Fields ─────────────────────────────────────── */}
        {form.hasExtra && (
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-3 animate-scaleIn">
            <div>
              <label className="label">Extra Person Name <span className="text-red-400">*</span></label>
              <input
                className={`input bg-white ${errors.extraName ? 'border-red-400 focus:ring-red-400/20' : ''}`}
                placeholder="Full name"
                value={form.extraName}
                onChange={(e) => set('extraName', e.target.value)}
              />
              {errors.extraName && <p className="mt-1 text-xs text-red-500">{errors.extraName}</p>}
            </div>
            <div>
              <label className="label">Extra Person Phone <span className="text-red-400">*</span></label>
              <PhoneInput
                value={form.extraPhone}
                onChange={(v) => set('extraPhone', v)}
                error={!!errors.extraPhone}
              />
              {errors.extraPhone && <p className="mt-1 text-xs text-red-500">{errors.extraPhone}</p>}
            </div>
            <p className="text-[11px] text-amber-600 font-medium">
              ⚡ Extra charges can be applied
            </p>
          </div>
        )}

        {/* ── Actions ─────────────────────────────────────────────────── */}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary">
            Assign Tenant
          </button>
        </div>
      </form>
    </Modal>
  )
}

export default AssignTenantModal
