const variants = {
  active:   'bg-green-100 border-green-200 text-green-700',
  vacant:   'bg-green-100 border-green-200 text-green-700',
  paid:     'bg-green-100 border-green-200 text-green-700',
  occupied: 'bg-blue-100 border-blue-200 text-blue-700',
  pending:  'bg-amber-100 border-amber-200 text-amber-700',
  notice:   'bg-amber-100 border-amber-200 text-amber-700',
  reserved: 'bg-purple-100 border-purple-200 text-purple-700',
  lead:     'bg-violet-100 border-violet-200 text-violet-700',
  overdue:  'bg-red-100 border-red-200 text-red-700',
  vacated:  'bg-slate-100 border-slate-200 text-slate-600',
  default:  'bg-slate-100 border-slate-200 text-slate-600',
}

const Badge = ({ status }) => {
  const cls = variants[status] ?? variants.default
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>
      {status}
    </span>
  )
}

export default Badge
