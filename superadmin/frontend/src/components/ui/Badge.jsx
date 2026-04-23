const VARIANTS = {
  active:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactive: 'bg-slate-100  text-slate-500  border-slate-200',
  warning:  'bg-amber-50   text-amber-700  border-amber-200',
  danger:   'bg-red-50     text-red-600    border-red-200',
}

export default function Badge({ variant = 'active', children }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${VARIANTS[variant]}`}>
      {children}
    </span>
  )
}
