const colorMap = {
  teal:   { bg: 'bg-primary-50 border-primary-100', icon: 'text-primary-500',  bar: 'bg-primary-500'  },
  green:  { bg: 'bg-emerald-50 border-emerald-100', icon: 'text-emerald-500',  bar: 'bg-emerald-500'  },
  amber:  { bg: 'bg-amber-50 border-amber-100',     icon: 'text-amber-500',    bar: 'bg-amber-500'    },
  red:    { bg: 'bg-red-50 border-red-100',         icon: 'text-red-500',      bar: 'bg-red-500'      },
  blue:   { bg: 'bg-blue-50 border-blue-100',       icon: 'text-blue-500',     bar: 'bg-blue-500'     },
  indigo: { bg: 'bg-primary-50 border-primary-100', icon: 'text-primary-500',  bar: 'bg-primary-500'  },
}

const badgeColorMap = {
  green: 'bg-emerald-50 border border-emerald-200 text-emerald-700',
  amber: 'bg-amber-50 border border-amber-200 text-amber-700',
  red:   'bg-red-50 border border-red-200 text-red-600',
}

const StatCard = ({
  label, value, sub, icon: Icon,
  color = 'teal',
  progress,
  badge, badgeColor = 'green',
}) => {
  const c  = colorMap[color] ?? colorMap.teal
  const bc = badgeColorMap[badgeColor] ?? badgeColorMap.green

  return (
    <div className="rounded-2xl bg-white border border-slate-200 px-4 py-3.5 flex flex-col gap-2 shadow-sm transition-all duration-200 hover:shadow-md hover:-translate-y-0.5 hover:border-slate-300 h-full">
      <div className="flex items-center gap-3">
        {Icon && (
          <div className={`h-9 w-9 rounded-xl border flex items-center justify-center shrink-0 ${c.bg}`}>
            <Icon size={15} className={c.icon} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[18px] font-bold leading-none tabular-nums text-slate-800">{value ?? '—'}</p>
            {badge && (
              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${bc}`}>
                {badge}
              </span>
            )}
          </div>
          {sub && <p className="text-[10px] text-slate-400 mt-0.5 font-medium">{sub}</p>}
          <p className="text-[10px] text-slate-400 mt-0.5 font-medium">{label}</p>
        </div>
      </div>

      {progress !== undefined && (
        <div className="h-1 w-full rounded-full bg-slate-100">
          <div className={`h-1 rounded-full transition-all duration-500 ${c.bar}`}
            style={{ width: `${Math.min(progress, 100)}%` }} />
        </div>
      )}
    </div>
  )
}

export default StatCard
