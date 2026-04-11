const colorMap = {
  teal:   { bg: 'bg-primary-50',  icon: 'text-primary-500',  bar: 'bg-primary-500'  },
  green:  { bg: 'bg-emerald-50',  icon: 'text-emerald-500',  bar: 'bg-emerald-500'  },
  amber:  { bg: 'bg-amber-50',    icon: 'text-amber-500',    bar: 'bg-amber-500'    },
  red:    { bg: 'bg-red-50',      icon: 'text-red-500',      bar: 'bg-red-500'      },
  blue:   { bg: 'bg-blue-50',     icon: 'text-blue-500',     bar: 'bg-blue-500'     },
  indigo: { bg: 'bg-primary-50',  icon: 'text-primary-500',  bar: 'bg-primary-500'  },
}

const badgeColorMap = {
  green: 'bg-emerald-50 border border-emerald-200 text-emerald-700',
  amber: 'bg-amber-50 border border-amber-200 text-amber-700',
  red:   'bg-red-50 border border-red-200 text-red-600',
}

/**
 * StatCard
 * @param {string}  label
 * @param {any}     value
 * @param {string}  sub           — small muted line below value
 * @param {node}    icon          — lucide icon component
 * @param {string}  color         — teal | green | amber | red | blue
 * @param {number}  progress      — 0-100, renders a progress bar when provided
 * @param {string}  progressLabel
 * @param {string}  badge         — small pill top-right
 * @param {string}  badgeColor    — green | amber | red
 */
const StatCard = ({
  label, value, sub, icon: Icon,
  color = 'teal',
  progress, progressLabel,
  badge, badgeColor = 'green',
}) => {
  const c = colorMap[color] ?? colorMap.teal

  return (
    <div className="card card-hover p-5 flex flex-col gap-3 h-full">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          {Icon && (
            <div className={`shrink-0 rounded-xl p-2.5 ${c.bg}`}>
              <Icon size={18} className={c.icon} />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-xs font-medium text-slate-500 truncate mb-1">{label}</p>
            <p className="text-2xl font-bold text-slate-800 leading-tight">{value ?? '—'}</p>
            {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
          </div>
        </div>
        {badge && (
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${badgeColorMap[badgeColor] ?? badgeColorMap.green}`}>
            {badge}
          </span>
        )}
      </div>

      {progress !== undefined && (
        <div>
          <div className="flex justify-between text-xs text-slate-400 mb-1.5">
            <span>{progressLabel}</span>
            <span className="font-semibold text-slate-600">{Math.round(progress)}%</span>
          </div>
          <div className="h-1.5 w-full rounded-full bg-slate-100">
            <div
              className={`h-1.5 rounded-full transition-all duration-500 ${c.bar}`}
              style={{ width: `${Math.min(progress, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default StatCard
