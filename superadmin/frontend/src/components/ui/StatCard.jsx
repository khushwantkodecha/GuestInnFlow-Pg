export default function StatCard({ icon: Icon, label, value, sub, color = '#45a793' }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-100 p-5 flex items-start gap-4 shadow-sm">
      <div
        className="flex items-center justify-center w-11 h-11 rounded-xl shrink-0"
        style={{ background: color + '18', color }}
      >
        <Icon size={20} />
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-800 tracking-tight leading-none">{value}</p>
        <p className="text-sm text-slate-500 font-medium mt-1">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}
