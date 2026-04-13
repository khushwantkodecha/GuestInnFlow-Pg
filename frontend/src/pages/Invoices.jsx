import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  FileText, Download, MessageCircle, Search, X,
  CheckCircle2, Clock, AlertTriangle, Zap, Filter,
  ChevronRight, Copy, Check, IndianRupee, Calendar,
  BedDouble, RotateCcw, Mail,
} from 'lucide-react'
import {
  getInvoices, generateInvoices, getInvoiceShareMessage, getInvoicePdfUrl,
} from '../api/invoices'
import useApi from '../hooks/useApi'
import { useProperty } from '../context/PropertyContext'
import { useToast } from '../context/ToastContext'
import Spinner from '../components/ui/Spinner'
import EmptyState from '../components/ui/EmptyState'
import Modal from '../components/ui/Modal'
import Drawer from '../components/ui/Drawer'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmt   = (n) => `₹${(n ?? 0).toLocaleString('en-IN')}`
const fdate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'

const MONTHS = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i).toLocaleString('default', { month: 'long' }),
}))
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// ── Status Pill ───────────────────────────────────────────────────────────────
const StatusPill = ({ status }) => {
  const cfg = {
    paid:    { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
    partial: { cls: 'bg-amber-50   text-amber-700   border-amber-200',   dot: 'bg-amber-400 animate-pulse' },
    unpaid:  { cls: 'bg-red-50     text-red-700     border-red-200',     dot: 'bg-red-500 animate-pulse' },
  }
  const c = cfg[status] ?? { cls: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold capitalize ${c.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {status}
    </span>
  )
}

// ── Summary Cards ─────────────────────────────────────────────────────────────
const SummaryCards = ({ invoices, statusFilter, onFilter }) => {
  const total   = invoices.reduce((s, i) => s + i.totalAmount, 0)
  const paid    = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.totalAmount, 0)
  const partial = invoices.filter(i => i.status === 'partial').reduce((s, i) => s + i.paidAmount, 0)
  const unpaid  = invoices.filter(i => i.status !== 'paid').reduce((s, i) => s + i.balance, 0)
  const rate    = total > 0 ? Math.round(((paid + partial) / total) * 100) : 0

  const cards = [
    { key: 'all',     label: 'Total Invoiced', value: fmt(total),   sub: `${invoices.length} invoices`,
      icon: FileText,     bg: 'bg-primary-50', color: 'text-primary-500', num: 'text-slate-800' },
    { key: 'paid',    label: 'Fully Paid',     value: fmt(paid),    sub: `${rate}% collection rate`,
      icon: CheckCircle2, bg: 'bg-emerald-50', color: 'text-emerald-500', num: 'text-emerald-600',
      extra: <div className="mt-2"><div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full bg-emerald-500 transition-all duration-700" style={{ width: `${rate}%` }} />
      </div></div> },
    { key: 'partial', label: 'Partial',        value: fmt(partial), sub: `${invoices.filter(i => i.status === 'partial').length} invoices`,
      icon: Clock,        bg: 'bg-amber-50',   color: 'text-amber-500',   num: 'text-amber-600' },
    { key: 'unpaid',  label: 'Unpaid',         value: fmt(unpaid),  sub: `${invoices.filter(i => i.status === 'unpaid').length} invoices`,
      icon: AlertTriangle, bg: 'bg-red-50',    color: 'text-red-500',     num: invoices.filter(i => i.status === 'unpaid').length > 0 ? 'text-red-600' : 'text-slate-300',
      highlight: invoices.filter(i => i.status === 'unpaid').length > 0 },
  ]

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map(({ key, label, value, sub, icon: Icon, bg, color, num, extra, highlight }) => (
        <button key={key} onClick={() => onFilter(key)}
          className={`card p-4 text-left transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.98]
            ${statusFilter === key ? 'ring-2 ring-primary-400 border-primary-300' : ''}
            ${highlight ? 'border-red-200 bg-red-50/50' : ''}`}>
          <div className="flex items-center gap-2 mb-2">
            <div className={`rounded-lg p-1.5 ${bg}`}><Icon size={14} className={color} /></div>
            <span className="text-xs text-slate-500 font-medium">{label}</span>
          </div>
          <p className={`text-xl font-bold tabular-nums ${num}`}>{value}</p>
          <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
          {extra}
        </button>
      ))}
    </div>
  )
}

// ── Invoice Row ───────────────────────────────────────────────────────────────
const InvoiceRow = ({ inv, onDownload, onShare, onView }) => {
  const isUnpaid = inv.status === 'unpaid'

  return (
    <tr className="group transition-colors hover:bg-slate-50/80 cursor-pointer" onClick={() => onView(inv)}>
      {/* Invoice No */}
      <td className="px-4 py-3">
        <p className="text-xs font-mono font-semibold text-primary-600">{inv.invoiceNumber}</p>
        <p className="text-[10px] text-slate-400 mt-0.5">{fdate(inv.issuedAt)}</p>
      </td>

      {/* Tenant */}
      <td className="px-3 py-3">
        <p className="text-sm font-semibold text-slate-800 leading-tight">{inv.tenant?.name ?? '—'}</p>
        {inv.tenant?.phone && <p className="text-xs text-slate-400 mt-0.5">{inv.tenant.phone}</p>}
      </td>

      {/* Room */}
      <td className="px-3 py-3">
        {inv.room?.roomNumber
          ? <span className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5">
              <BedDouble size={11} />
              R{inv.room.roomNumber}{inv.bed?.bedNumber ? ` / B${inv.bed.bedNumber}` : ''}
            </span>
          : <span className="text-xs text-slate-300">—</span>
        }
      </td>

      {/* Period */}
      <td className="px-3 py-3">
        <p className="text-sm text-slate-600 font-medium">
          {inv.month ? `${MONTH_SHORT[inv.month - 1]} ${inv.year}` : '—'}
        </p>
        <p className="text-[10px] text-slate-400 mt-0.5">Due {fdate(inv.dueDate)}</p>
      </td>

      {/* Amount */}
      <td className="px-3 py-3">
        <p className="text-sm font-bold text-slate-800 tabular-nums">{fmt(inv.totalAmount)}</p>
      </td>

      {/* Paid */}
      <td className="px-3 py-3">
        <p className={`text-sm font-medium tabular-nums ${inv.paidAmount > 0 ? 'text-emerald-600' : 'text-slate-300'}`}>
          {fmt(inv.paidAmount)}
        </p>
      </td>

      {/* Balance */}
      <td className="px-3 py-3">
        <p className={`text-sm font-bold tabular-nums ${inv.balance > 0 ? 'text-red-600' : 'text-slate-300'}`}>
          {fmt(inv.balance)}
        </p>
      </td>

      {/* Status */}
      <td className="px-3 py-3">
        <StatusPill status={inv.status} />
      </td>

      {/* Actions */}
      <td className="px-3 py-3">
        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
          <button onClick={() => onDownload(inv)}
            title="Download PDF"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-primary-50 hover:text-primary-600 transition-colors">
            <Download size={13} />
          </button>
          <button onClick={() => onShare(inv)}
            title="WhatsApp share"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-green-50 hover:text-green-600 transition-colors">
            <MessageCircle size={13} />
          </button>
          <button onClick={() => onView(inv)}
            className="rounded-lg p-1.5 text-slate-300 hover:text-primary-500 hover:bg-primary-50 transition-colors">
            <ChevronRight size={13} />
          </button>
        </div>
      </td>
    </tr>
  )
}

// ── Invoice Detail Drawer ─────────────────────────────────────────────────────
const InvoiceDetail = ({ invoice: inv, propertyId, onDownload, onShare }) => {
  if (!inv) return null
  const periodLabel = inv.month ? `${MONTH_SHORT[inv.month - 1]} ${inv.year}` : '—'

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 py-5 bg-slate-50 border-b border-slate-100 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-base font-bold text-slate-800 font-mono">{inv.invoiceNumber}</p>
            <p className="text-xs text-slate-400 mt-0.5">Issued {fdate(inv.issuedAt)}</p>
          </div>
          <StatusPill status={inv.status} />
        </div>

        {/* Balance block */}
        <div className={`rounded-xl px-4 py-3 border ${
          inv.balance > 0 ? 'bg-red-50 border-red-200' : 'bg-emerald-50 border-emerald-200'
        }`}>
          <div className="flex items-center justify-between">
            <div>
              <p className={`text-xs font-medium ${inv.balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                {inv.balance > 0 ? 'Balance Due' : 'Fully Paid'}
              </p>
              <p className={`text-2xl font-bold tabular-nums ${inv.balance > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                {fmt(inv.balance > 0 ? inv.balance : inv.totalAmount)}
              </p>
            </div>
            <div className="text-right text-xs space-y-1">
              <p className="text-slate-500">Total: <span className="font-bold text-slate-700">{fmt(inv.totalAmount)}</span></p>
              <p className="text-slate-500">Paid: <span className="font-bold text-emerald-600">{fmt(inv.paidAmount)}</span></p>
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2">
          <button onClick={() => onDownload(inv)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary-500 hover:bg-primary-600 px-3 py-2 text-xs font-semibold text-white transition-colors">
            <Download size={12} /> Download PDF
          </button>
          <button onClick={() => onShare(inv)}
            className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-green-500 hover:bg-green-600 px-3 py-2 text-xs font-semibold text-white transition-colors">
            <MessageCircle size={12} /> WhatsApp
          </button>
        </div>
      </div>

      {/* Detail sections */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

        {/* Tenant + Room */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-slate-100 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Billed To</p>
            <p className="text-sm font-bold text-slate-800">{inv.tenant?.name ?? '—'}</p>
            {inv.tenant?.phone && <p className="text-xs text-slate-400 mt-0.5">{inv.tenant.phone}</p>}
          </div>
          <div className="rounded-xl border border-slate-100 bg-white px-4 py-3">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">Room</p>
            <p className="text-sm font-bold text-slate-800">
              {inv.room?.roomNumber ? `Room ${inv.room.roomNumber}` : '—'}
            </p>
            {inv.bed?.bedNumber && <p className="text-xs text-slate-400 mt-0.5">Bed {inv.bed.bedNumber}</p>}
          </div>
        </div>

        {/* Dates */}
        <div className="rounded-xl border border-slate-100 bg-white px-4 py-3 space-y-2">
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Billing Period</p>
          {[
            { label: 'Period',    value: periodLabel },
            { label: 'Issued',   value: fdate(inv.issuedAt) },
            { label: 'Due Date', value: fdate(inv.dueDate)  },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="text-xs font-semibold text-slate-700">{value}</p>
            </div>
          ))}
        </div>

        {/* Charges */}
        <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Charges</p>
          </div>
          <div className="divide-y divide-slate-100">
            {[
              { label: 'Monthly Rent',         amount: inv.rentAmount,        show: true },
              { label: 'Additional Charges',   amount: inv.additionalCharges, show: (inv.additionalCharges ?? 0) > 0 },
              { label: 'Discount',             amount: -inv.discount,         show: (inv.discount ?? 0) > 0 },
            ].filter(r => r.show).map(({ label, amount }) => (
              <div key={label} className="flex items-center justify-between px-4 py-3">
                <p className="text-sm text-slate-600">{label}</p>
                <p className="text-sm font-semibold text-slate-700 tabular-nums">{fmt(amount)}</p>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-3 bg-slate-50">
              <p className="text-sm font-bold text-slate-800">Total</p>
              <p className="text-sm font-bold text-slate-800 tabular-nums">{fmt(inv.totalAmount)}</p>
            </div>
          </div>
        </div>

        {/* Payment Summary */}
        <div className="rounded-xl border border-slate-100 bg-white overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
            <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">Payment Summary</p>
          </div>
          <div className="divide-y divide-slate-100">
            {[
              { label: 'Amount Billed', value: fmt(inv.totalAmount),  color: 'text-slate-700' },
              { label: 'Amount Paid',   value: fmt(inv.paidAmount),   color: 'text-emerald-600' },
              { label: 'Balance Due',   value: fmt(inv.balance),      color: inv.balance > 0 ? 'text-red-600' : 'text-slate-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="flex items-center justify-between px-4 py-3">
                <p className="text-sm text-slate-500">{label}</p>
                <p className={`text-sm font-bold tabular-nums ${color}`}>{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Share Modal ───────────────────────────────────────────────────────────────
const ShareModal = ({ invoice, propertyId, onClose }) => {
  const [msgData, setMsgData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [copied, setCopied]   = useState(false)
  const toast = useToast()

  useEffect(() => {
    getInvoiceShareMessage(propertyId, invoice._id)
      .then(res => setMsgData(res.data.data))
      .catch(() => toast('Could not load share message', 'error'))
      .finally(() => setLoading(false))
  }, [propertyId, invoice._id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = () => {
    navigator.clipboard.writeText(msgData?.message ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal title="Share Invoice" onClose={onClose}>
      {loading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : (
        <>
          <div className="mb-4 rounded-xl bg-slate-50 border border-slate-200 px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-600">Message Preview</p>
              <button onClick={handleCopy}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-700 transition-colors">
                {copied ? <><Check size={12} className="text-emerald-500" /><span className="text-emerald-600">Copied</span></> : <><Copy size={12} />Copy</>}
              </button>
            </div>
            <pre className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed font-sans">
              {msgData?.message}
            </pre>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              {msgData?.waUrl && (
                <a href={msgData.waUrl} target="_blank" rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-green-500 hover:bg-green-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors">
                  <MessageCircle size={14} /> WhatsApp
                </a>
              )}
              {msgData?.emailUrl && (
                <a href={msgData.emailUrl} target="_blank" rel="noreferrer"
                  className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-blue-500 hover:bg-blue-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors">
                  <Mail size={14} /> Email
                </a>
              )}
            </div>
            <button onClick={handleCopy}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              <Copy size={14} /> Copy Message
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const now = new Date()
const FILTERS = [
  { key: 'all',     label: 'All'     },
  { key: 'unpaid',  label: 'Unpaid'  },
  { key: 'partial', label: 'Partial' },
  { key: 'paid',    label: 'Paid'    },
]

const Invoices = () => {
  const { selectedProperty } = useProperty()
  const propertyId = selectedProperty?._id ?? ''
  const toast = useToast()

  const [month,        setMonth]        = useState(now.getMonth() + 1)
  const [year,         setYear]         = useState(now.getFullYear())
  const [statusFilter, setStatusFilter] = useState('all')
  const [search,       setSearch]       = useState('')
  const [generating,   setGenerating]   = useState(false)
  const [shareInvoice, setShareInvoice] = useState(null)
  const [viewInvoice,  setViewInvoice]  = useState(null)

  const { data, loading, refetch } = useApi(
    () => propertyId
      ? getInvoices(propertyId, { month, year })
      : Promise.resolve({ data: null }),
    [propertyId, month, year]
  )
  const allInvoices = data?.data ?? []

  const filtered = useMemo(() => {
    let list = statusFilter !== 'all'
      ? allInvoices.filter(i => i.status === statusFilter)
      : [...allInvoices]
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(i =>
      (i.invoiceNumber ?? '').toLowerCase().includes(q) ||
      (i.tenant?.name  ?? '').toLowerCase().includes(q) ||
      (i.tenant?.phone ?? '').includes(q)
    )
    return list
  }, [allInvoices, statusFilter, search])

  const counts = useMemo(() => ({
    all:     allInvoices.length,
    unpaid:  allInvoices.filter(i => i.status === 'unpaid').length,
    partial: allInvoices.filter(i => i.status === 'partial').length,
    paid:    allInvoices.filter(i => i.status === 'paid').length,
  }), [allInvoices])

  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res = await generateInvoices(propertyId, { month, year })
      toast(res.data.message, 'success')
      refetch()
    } catch (err) {
      toast(err.response?.data?.message || 'Error generating invoices', 'error')
    } finally {
      setGenerating(false)
    }
  }

  const handleDownload = useCallback((inv) => {
    const url = getInvoicePdfUrl(propertyId, inv._id)
    const a = document.createElement('a')
    a.href     = url
    a.download = `${inv.invoiceNumber}.pdf`
    a.target   = '_blank'
    a.click()
  }, [propertyId])

  const handleShare = useCallback((inv) => {
    setShareInvoice(inv)
  }, [])

  const onFilterTab = (key) => {
    setStatusFilter(key)
  }

  return (
    <div className="space-y-5 max-w-7xl">

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-800 leading-tight">Invoices</h2>
          {allInvoices.length > 0 && (
            <p className="text-sm text-slate-400 mt-0.5">
              {counts.paid} paid · {counts.partial} partial · {counts.unpaid} unpaid
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-32 text-sm" value={month} onChange={e => setMonth(Number(e.target.value))}>
            {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <input type="number" className="input w-20 text-sm" value={year}
            onChange={e => setYear(Number(e.target.value))} />
          {propertyId && (
            <button className="btn-primary" onClick={handleGenerate} disabled={generating}>
              <Zap size={15} /> {generating ? 'Generating…' : 'Generate'}
            </button>
          )}
        </div>
      </div>

      {!propertyId ? (
        <div className="card border-dashed">
          <EmptyState message="No property selected. Choose one from the sidebar." />
        </div>
      ) : loading ? (
        <div className="flex justify-center py-20"><Spinner /></div>
      ) : (
        <>
          {allInvoices.length > 0 && (
            <SummaryCards invoices={allInvoices} statusFilter={statusFilter} onFilter={onFilterTab} />
          )}

          {/* Overdue banner */}
          {counts.unpaid > 0 && (
            <div className="flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
              <AlertTriangle size={15} className="shrink-0 text-red-500" />
              <p className="flex-1 text-sm text-red-700 font-medium">
                {counts.unpaid} unpaid invoice{counts.unpaid !== 1 ? 's' : ''} this period
              </p>
              <button className="text-xs font-semibold text-red-600 hover:text-red-800"
                onClick={() => onFilterTab('unpaid')}>
                View →
              </button>
            </div>
          )}

          {/* Filter bar */}
          <div className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur-sm py-2 -mx-1 px-1 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-xl border border-slate-200 bg-white p-1">
              {FILTERS.map(({ key, label }) => (
                <button key={key} onClick={() => onFilterTab(key)}
                  className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                    statusFilter === key ? 'bg-primary-500 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50'
                  }`}>
                  {label}
                  {counts[key] > 0 && statusFilter !== key && (
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold leading-none ${
                      key === 'unpaid'  ? 'bg-red-100 text-red-600'
                      : key === 'partial' ? 'bg-amber-100 text-amber-600'
                      : 'bg-slate-100 text-slate-500'
                    }`}>{counts[key]}</span>
                  )}
                </button>
              ))}
            </div>

            <div className="relative flex-1 min-w-[180px]">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input className="input pl-8 py-1.5 text-sm w-full"
                placeholder="Search invoice no, name or phone…"
                value={search}
                onChange={e => setSearch(e.target.value)} />
              {search && (
                <button onClick={() => setSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
            <div className="card border-dashed">
              <EmptyState
                message={search || statusFilter !== 'all'
                  ? 'No invoices match'
                  : 'No invoices for this period'}
                action={
                  statusFilter === 'all' && !search
                    ? <button className="btn-primary" onClick={handleGenerate} disabled={generating}><Zap size={15} />Generate Invoices</button>
                    : <button className="btn-secondary" onClick={() => { setStatusFilter('all'); setSearch('') }}><RotateCcw size={13} />Clear filters</button>
                }
              />
            </div>
          ) : (
            <div className="card overflow-hidden !p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead>
                    <tr className="border-b border-slate-100 bg-slate-50/80">
                      {['Invoice No', 'Tenant', 'Room', 'Period', 'Amount', 'Paid', 'Balance', 'Status', ''].map(h => (
                        <th key={h} className="px-3 py-3 text-left text-[10px] font-bold text-slate-400 uppercase tracking-widest first:pl-4">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filtered.map(inv => (
                      <InvoiceRow
                        key={inv._id}
                        inv={inv}
                        onDownload={handleDownload}
                        onShare={handleShare}
                        onView={setViewInvoice}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-2.5 border-t border-slate-100 bg-white flex items-center justify-between text-xs text-slate-400">
                <span>{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}{(search || statusFilter !== 'all') && ` · filtered from ${allInvoices.length}`}</span>
                <span className="text-slate-500">
                  Total: <span className="font-bold text-slate-800 tabular-nums">
                    {fmt(filtered.reduce((s, i) => s + i.totalAmount, 0))}
                  </span>
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Invoice Detail Drawer */}
      {viewInvoice && (
        <Drawer
          title="Invoice Detail"
          subtitle={viewInvoice.invoiceNumber}
          onClose={() => setViewInvoice(null)}
        >
          <InvoiceDetail
            invoice={viewInvoice}
            propertyId={propertyId}
            onDownload={handleDownload}
            onShare={handleShare}
          />
        </Drawer>
      )}

      {/* Share Modal */}
      {shareInvoice && (
        <ShareModal
          invoice={shareInvoice}
          propertyId={propertyId}
          onClose={() => setShareInvoice(null)}
        />
      )}
    </div>
  )
}

export default Invoices
