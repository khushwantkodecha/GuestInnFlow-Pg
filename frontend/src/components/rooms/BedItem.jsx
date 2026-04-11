const STATUS_STYLES = {
  vacant: {
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    text: 'text-emerald-700',
    dot: 'bg-emerald-500',
  },
  occupied: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    dot: 'bg-red-500',
  },
  reserved: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    dot: 'bg-amber-400',
  },
}

const BedItem = ({ bed, onBedClick }) => {
  const s = STATUS_STYLES[bed.status] ?? STATUS_STYLES.vacant

  return (
    <button
      type="button"
      onClick={() => onBedClick(bed)}
      className={`
        flex flex-col items-center gap-0.5 rounded-lg border px-2 py-2
        transition-all duration-150
        hover:shadow-md hover:-translate-y-0.5 active:scale-95
        focus:outline-none focus:ring-2 focus:ring-primary-400/40
        ${s.bg} ${s.border}
      `}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      <span className={`text-xs font-semibold ${s.text}`}>{bed.bedNumber}</span>
      {bed.status === 'occupied' && bed.tenant?.name && (
        <span className="text-[10px] text-slate-400 truncate w-full text-center leading-tight">
          {bed.tenant.name.split(' ')[0]}
        </span>
      )}
      {bed.status === 'reserved' && bed.reservation?.name && (
        <span className="text-[10px] text-amber-600 truncate w-full text-center leading-tight">
          {bed.reservation.name.split(' ')[0]}
        </span>
      )}
    </button>
  )
}

export default BedItem
