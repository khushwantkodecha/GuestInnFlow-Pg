import { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Bell, MessageCircle, CheckCircle2, XCircle, Clock,
  Settings, Zap, Search, X, RotateCcw, ChevronRight,
  AlertTriangle, IndianRupee, Calendar, BellOff, BellRing,
  Play, Eye, Copy, Check,
} from 'lucide-react'
import {
  getReminderLogs, getReminderStats, getReminderSettings,
  updateReminderSettings, triggerDailyReminders,
} from '../api/reminders'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'

// ── Helpers ───────────────────────────────────────────────────────────────────
const timeAgo = (d) => {
  if (!d) return '—'
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)   return `${days}d ago`
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

const fdate = (d) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

// ── Type Config ───────────────────────────────────────────────────────────────
const TYPE_CFG = {
  pre_due: {
    label: 'Pre-Due',
    short: 'Pre-Due',
    cls:   'bg-blue-50 text-blue-700 border-blue-200',
    icon:  Calendar,
  },
  due_day: {
    label: 'Due Today',
    short: 'Due Day',
    cls:   'bg-amber-50 text-amber-700 border-amber-200',
    icon:  Bell,
  },
  overdue: {
    label: 'Overdue',
    short: 'Overdue',
    cls:   'bg-red-50 text-red-700 border-red-200',
    icon:  AlertTriangle,
  },
  payment_confirmation: {
    label: 'Payment Confirmed',
    short: 'Payment',
    cls:   'bg-emerald-50 text-emerald-700 border-emerald-200',
    icon:  IndianRupee,
  },
}

const STATUS_CFG = {
  sent:    { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  failed:  { cls: 'bg-red-50 text-red-700 border-red-200',             icon: XCircle      },
  pending: { cls: 'bg-slate-100 text-slate-500 border-slate-200',      icon: Clock        },
}

// ── Type Pill ─────────────────────────────────────────────────────────────────
const TypePill = ({ type }) => {
  const cfg = TYPE_CFG[type] ?? { label: type, cls: 'bg-slate-100 text-slate-500 border-slate-200', icon: Bell }
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold ${cfg.cls}`}>
      <Icon size={10} />
      {cfg.short}
    </span>
  )
}

// ── Status Pill ───────────────────────────────────────────────────────────────
const StatusPill = ({ status }) => {
  const cfg = STATUS_CFG[status] ?? STATUS_CFG.pending
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold capitalize ${cfg.cls}`}>
      <Icon size={10} />
      {status}
    </span>
  )
}

// ── Message Preview Modal ─────────────────────────────────────────────────────
const MessageModal = ({ log, onClose }) => {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(log.message ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <Modal title="Message Preview" onClose={onClose}>
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-700">{log.tenant?.name ?? '—'}</p>
          <p className="text-xs text-slate-400 mt-0.5">{log.meta?.phone ?? log.tenant?.phone ?? '—'}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <TypePill type={log.type} />
          <StatusPill status={log.status} />
        </div>
      </div>

      <div className="mb-4 rounded-xl bg-slate-50 border border-slate-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
          <p className="text-xs font-semibold text-slate-500">Message</p>
          <button onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 transition-colors">
            {copied
              ? <><Check size={11} className="text-emerald-500" /><span className="text-emerald-600">Copied</span></>
              : <><Copy size={11} />Copy</>}
          </button>
        </div>
        <pre className="px-4 py-3 text-xs text-slate-600 whitespace-pre-wrap leading-relaxed font-sans">
          {log.message}
        </pre>
      </div>

      {log.meta?.waUrl && (
        <a href={log.meta.waUrl} target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-1.5 rounded-xl bg-green-500 hover:bg-green-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors">
          <MessageCircle size={14} /> Open in WhatsApp
        </a>
      )}

      <p className="mt-3 text-center text-xs text-slate-400">{fdate(log.sentAt ?? log.createdAt)}</p>
    </Modal>
  )
}

// ── Stats Cards ───────────────────────────────────────────────────────────────
const StatsCards = ({ stats }) => {
  const { thisMonth = {}, today = {}, byType = {} } = stats ?? {}
  const cards = [
    {
      label: 'Sent This Month',
      value: thisMonth.sent ?? 0,
      sub: `${today.total ?? 0} today`,
      icon: BellRing,
      bg: 'bg-primary-50', color: 'text-primary-500', num: 'text-slate-800',
    },
    {
      label: 'Payment Confirmations',
      value: byType.payment_confirmation ?? 0,
      sub: 'This month',
      icon: IndianRupee,
      bg: 'bg-emerald-50', color: 'text-emerald-500', num: 'text-emerald-700',
    },
    {
      label: 'Overdue Reminders',
      value: byType.overdue ?? 0,
      sub: 'This month',
      icon: AlertTriangle,
      bg: (byType.overdue ?? 0) > 0 ? 'bg-red-50' : 'bg-slate-50',
      color: (byType.overdue ?? 0) > 0 ? 'text-red-500' : 'text-slate-400',
      num: (byType.overdue ?? 0) > 0 ? 'text-red-600' : 'text-slate-300',
    },
    {
      label: 'Failed',
      value: thisMonth.failed ?? 0,
      sub: 'This month',
      icon: XCircle,
      bg: (thisMonth.failed ?? 0) > 0 ? 'bg-red-50' : 'bg-slate-50',
      color: (thisMonth.failed ?? 0) > 0 ? 'text-red-500' : 'text-slate-400',
      num: (thisMonth.failed ?? 0) > 0 ? 'text-red-600' : 'text-slate-300',
    },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ label, value, sub, icon: Icon, bg, color, num }) => (
        <div key={label} className="card p-4">
          <div className="flex items-center gap-2 mb-2">
            <div className={`rounded-lg p-1.5 ${bg}`}><Icon size={14} className={color} /></div>
            <span className="text-xs text-slate-500 font-medium">{label}</span>
          </div>
          <p className={`text-2xl font-bold tabular-nums ${num}`}>{value}</p>
          <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
        </div>
      ))}
    </div>
  )
}

// ── Settings Panel ────────────────────────────────────────────────────────────
const SettingsPanel = ({ propertyId, onSaved }) => {
  const toast = useToast()
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(null)

  const { data, loading } = useApi(
    () => propertyId ? getReminderSettings(propertyId) : Promise.resolve({ data: null }),
    [propertyId]
  )

  useEffect(() => {
    if (data?.data) {
      const s = data.data
      setForm({
        enabled:               s.enabled ?? true,
        channels:              s.channels ?? ['whatsapp'],
        preDueDays:            s.preDueDays ?? 2,
        overdueEscalationDays: (s.overdueEscalationDays ?? [1, 3, 7]).join(', '),
        maxOverdueReminders:   s.maxOverdueReminders ?? 3,
      })
    }
  }, [data])

  const handleSave = async () => {
    setSaving(true)
    try {
      const days = (form.overdueEscalationDays ?? '')
        .split(',')
        .map((d) => parseInt(d.trim()))
        .filter((d) => !isNaN(d) && d > 0)
        .sort((a, b) => a - b)

      await updateReminderSettings(propertyId, {
        enabled:               form.enabled,
        channels:              form.channels,
        preDueDays:            Number(form.preDueDays),
        overdueEscalationDays: days,
        maxOverdueReminders:   Number(form.maxOverdueReminders),
      })
      toast('Settings saved', 'success')
      onSaved?.()
    } catch {
      toast('Failed to save settings', 'error')
    } finally {
      setSaving(false)
    }
  }

  if (loading || !form) return (
    <div className="card p-6 flex justify-center"><Spinner /></div>
  )

  const toggleChannel = (ch) => {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(ch)
        ? f.channels.filter((c) => c !== ch)
        : [...f.channels, ch],
    }))
  }

  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-50">
            <Settings size={14} className="text-primary-500" />
          </div>
          <h3 className="text-sm font-bold text-slate-700">Reminder Settings</h3>
        </div>
        <button onClick={handleSave} disabled={saving}
          className="btn-primary text-xs py-1.5 px-3 disabled:opacity-60">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Enable toggle */}
      <div className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-700">Automated Reminders</p>
          <p className="text-xs text-slate-400 mt-0.5">Run daily at 9:00 AM IST</p>
        </div>
        <button
          onClick={() => setForm((f) => ({ ...f, enabled: !f.enabled }))}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
            form.enabled ? 'bg-primary-500' : 'bg-slate-200'
          }`}
        >
          <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200 ${
            form.enabled ? 'translate-x-5' : 'translate-x-0'
          }`} />
        </button>
      </div>

      <div className={`space-y-4 transition-opacity ${form.enabled ? '' : 'opacity-40 pointer-events-none'}`}>

        {/* Channels */}
        <div>
          <label className="label">Delivery Channel</label>
          <div className="flex gap-2">
            {[
              { key: 'whatsapp', label: 'WhatsApp', icon: MessageCircle },
              { key: 'sms',      label: 'SMS',       icon: Bell          },
              { key: 'email',    label: 'Email',      icon: Bell          },
            ].map(({ key, label, icon: Icon }) => (
              <button key={key} type="button"
                onClick={() => toggleChannel(key)}
                className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                  form.channels.includes(key)
                    ? 'border-primary-400 bg-primary-50 text-primary-600'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}>
                <Icon size={12} />
                {label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5">
            WhatsApp delivery requires <code className="bg-slate-100 px-1 rounded">WHATSAPP_PROVIDER</code> in .env. Messages are always logged regardless.
          </p>
        </div>

        {/* Timing */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Pre-Due Reminder</label>
            <div className="flex items-center gap-2">
              <input type="number" min="1" max="14" className="input w-16 text-center text-sm"
                value={form.preDueDays}
                onChange={(e) => setForm((f) => ({ ...f, preDueDays: e.target.value }))} />
              <span className="text-sm text-slate-500">days before due</span>
            </div>
          </div>
          <div>
            <label className="label">Max Overdue Reminders</label>
            <input type="number" min="1" max="10" className="input w-16 text-center text-sm"
              value={form.maxOverdueReminders}
              onChange={(e) => setForm((f) => ({ ...f, maxOverdueReminders: e.target.value }))} />
          </div>
        </div>

        <div>
          <label className="label">Overdue Escalation Days</label>
          <input className="input text-sm" placeholder="e.g. 1, 3, 7"
            value={form.overdueEscalationDays}
            onChange={(e) => setForm((f) => ({ ...f, overdueEscalationDays: e.target.value }))} />
          <p className="text-[11px] text-slate-400 mt-1">
            Comma-separated days after due date. Day 1 = gentle, 3 = warning, 7 = strong.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Log Row ───────────────────────────────────────────────────────────────────
const LogRow = ({ log, onView }) => (
  <tr className="group hover:bg-slate-50/80 transition-colors cursor-pointer" onClick={() => onView(log)}>
    {/* Tenant */}
    <td className="pl-4 pr-3 py-3">
      <p className="text-sm font-semibold text-slate-800 leading-tight">{log.tenant?.name ?? '—'}</p>
      {log.tenant?.phone && (
        <p className="text-xs text-slate-400 mt-0.5">{log.tenant.phone}</p>
      )}
    </td>

    {/* Type */}
    <td className="px-3 py-3">
      <TypePill type={log.type} />
    </td>

    {/* Channel */}
    <td className="px-3 py-3">
      <div className="flex items-center gap-1 text-xs text-slate-500">
        <MessageCircle size={11} className="text-green-500" />
        <span className="capitalize">{log.channel}</span>
      </div>
    </td>

    {/* Status */}
    <td className="px-3 py-3">
      <StatusPill status={log.status} />
    </td>

    {/* Time */}
    <td className="px-3 py-3">
      <p className="text-xs font-medium text-slate-600">{timeAgo(log.sentAt ?? log.createdAt)}</p>
      <p className="text-[10px] text-slate-400 mt-0.5">
        {log.sentAt
          ? new Date(log.sentAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
          : new Date(log.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
      </p>
    </td>

    {/* Message preview */}
    <td className="px-3 py-3 max-w-xs">
      <p className="text-xs text-slate-500 truncate leading-relaxed">
        {(log.message ?? '').split('\n').find((l) => l.trim()) ?? '—'}
      </p>
    </td>

    {/* Action */}
    <td className="px-3 py-3">
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onView(log)}
          className="rounded-lg p-1.5 text-slate-300 hover:text-primary-500 hover:bg-primary-50 transition-colors"
          title="View message">
          <Eye size={13} />
        </button>
        {log.meta?.waUrl && (
          <a href={log.meta.waUrl} target="_blank" rel="noreferrer"
            title="Open WhatsApp"
            className="rounded-lg p-1.5 text-slate-300 hover:text-green-600 hover:bg-green-50 transition-colors">
            <MessageCircle size={13} />
          </a>
        )}
      </div>
    </td>
  </tr>
)

// ── Main Page ─────────────────────────────────────────────────────────────────
const TYPE_FILTERS = [
  { key: 'all',                  label: 'All'          },
  { key: 'pre_due',              label: 'Pre-Due'      },
  { key: 'due_day',              label: 'Due Day'      },
  { key: 'overdue',              label: 'Overdue'      },
  { key: 'payment_confirmation', label: 'Payment'      },
]

const Reminders = () => {
  const { selectedProperty } = useProperty()
  const propertyId = selectedProperty?._id ?? ''
  const toast = useToast()

  const [typeFilter,   setTypeFilter]   = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [search,       setSearch]       = useState('')
  const [viewLog,      setViewLog]      = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [triggering,   setTriggering]   = useState(false)

  const { data: statsData, refetch: refetchStats } = useApi(
    () => propertyId ? getReminderStats(propertyId) : Promise.resolve({ data: null }),
    [propertyId]
  )
  const stats = statsData?.data

  const { data: logsData, loading: logsLoading, refetch: refetchLogs } = useApi(
    () => propertyId ? getReminderLogs(propertyId) : Promise.resolve({ data: null }),
    [propertyId]
  )
  const allLogs = logsData?.data ?? []

  const filtered = useMemo(() => {
    let list = [...allLogs]
    if (typeFilter !== 'all')   list = list.filter((l) => l.type   === typeFilter)
    if (statusFilter !== 'all') list = list.filter((l) => l.status === statusFilter)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((l) =>
      (l.tenant?.name  ?? '').toLowerCase().includes(q) ||
      (l.tenant?.phone ?? '').includes(q)
    )
    return list
  }, [allLogs, typeFilter, statusFilter, search])

  const counts = useMemo(() => ({
    all:                  allLogs.length,
    pre_due:              allLogs.filter((l) => l.type === 'pre_due').length,
    due_day:              allLogs.filter((l) => l.type === 'due_day').length,
    overdue:              allLogs.filter((l) => l.type === 'overdue').length,
    payment_confirmation: allLogs.filter((l) => l.type === 'payment_confirmation').length,
  }), [allLogs])

  const handleTrigger = async () => {
    setTriggering(true)
    try {
      const res = await triggerDailyReminders(propertyId)
      toast(res.data.message, 'success')
      refetchLogs()
      refetchStats()
    } catch (err) {
      toast(err.response?.data?.message || 'Error triggering reminders', 'error')
    } finally {
      setTriggering(false)
    }
  }

  return (
    <div className="space-y-5 max-w-7xl">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 leading-tight">Reminders</h2>
          {allLogs.length > 0 && (
            <p className="text-sm text-slate-400 mt-0.5">
              {stats?.today?.total ?? 0} sent today · {stats?.thisMonth?.sent ?? 0} this month
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSettings((v) => !v)}
            className={`btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 ${showSettings ? 'bg-slate-100 border-slate-300' : ''}`}>
            <Settings size={13} /> Settings
          </button>
          {propertyId && (
            <button onClick={handleTrigger} disabled={triggering}
              className="btn-primary flex items-center gap-1.5">
              <Play size={13} /> {triggering ? 'Running…' : 'Run Now'}
            </button>
          )}
        </div>
      </div>

      {!propertyId ? (
        <div className="card border-dashed">
          <EmptyState message="No property selected. Choose one from the sidebar." />
        </div>
      ) : (
        <>
          {/* Stats */}
          <StatsCards stats={stats} />

          {/* Settings Panel */}
          {showSettings && (
            <SettingsPanel
              propertyId={propertyId}
              onSaved={() => { refetchStats(); refetchLogs() }}
            />
          )}

          {/* Filter bar */}
          <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm py-2 -mx-1 px-1 flex flex-wrap items-center gap-3">
            {/* Type tabs */}
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {TYPE_FILTERS.map(({ key, label }) => (
                <button key={key} onClick={() => setTypeFilter(key)}
                  className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    typeFilter === key ? 'bg-primary-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
                  }`}>
                  {label}
                  {counts[key] > 0 && typeFilter !== key && (
                    <span className="rounded-full bg-slate-100 text-slate-500 px-1.5 py-0.5 text-[10px] font-bold leading-none">
                      {counts[key]}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Status filter */}
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {['all', 'sent', 'failed', 'pending'].map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition-colors ${
                    statusFilter === s ? 'bg-primary-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
                  }`}>
                  {s === 'all' ? 'All Status' : s}
                </button>
              ))}
            </div>

            {/* Search */}
            <div className="relative flex-1 min-w-[180px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input pl-8 py-1.5 text-sm w-full"
                placeholder="Search by tenant name or phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)} />
              {search && (
                <button onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          {logsLoading ? (
            <div className="flex justify-center py-20"><Spinner /></div>
          ) : filtered.length === 0 ? (
            <div className="card border-dashed">
              <EmptyState
                message={search || typeFilter !== 'all' || statusFilter !== 'all'
                  ? 'No reminders match'
                  : 'No reminders sent yet. Click "Run Now" to trigger the daily job.'}
                action={
                  typeFilter !== 'all' || statusFilter !== 'all' || search
                    ? <button className="btn-secondary" onClick={() => { setTypeFilter('all'); setStatusFilter('all'); setSearch('') }}>
                        <RotateCcw size={13} /> Clear filters
                      </button>
                    : <button className="btn-primary" onClick={handleTrigger} disabled={triggering}>
                        <Play size={13} /> Run Now
                      </button>
                }
              />
            </div>
          ) : (
            <div className="card overflow-hidden !p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      {['Tenant', 'Type', 'Channel', 'Status', 'Time', 'Message', ''].map((h) => (
                        <th key={h} className="px-3 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest first:pl-4">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filtered.map((log) => (
                      <LogRow key={log._id} log={log} onView={setViewLog} />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-slate-100 bg-white flex items-center justify-between text-xs text-slate-400">
                <span>
                  {filtered.length} reminder{filtered.length !== 1 ? 's' : ''}
                  {(search || typeFilter !== 'all' || statusFilter !== 'all') && ` · filtered from ${allLogs.length}`}
                </span>
                <span className="text-slate-500">
                  {allLogs.filter((l) => l.status === 'sent').length} sent ·{' '}
                  {allLogs.filter((l) => l.status === 'failed').length} failed
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Message Modal */}
      {viewLog && <MessageModal log={viewLog} onClose={() => setViewLog(null)} />}
    </div>
  )
}

export default Reminders
