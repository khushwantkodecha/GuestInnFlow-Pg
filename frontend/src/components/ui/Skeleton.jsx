// ── Base pulse block ──────────────────────────────────────────────────────────
export const Skeleton = ({ className = '' }) => (
  <div className={`animate-shimmer rounded-lg bg-slate-100 ${className}`} />
)

// ── Property card skeleton ────────────────────────────────────────────────────
export const PropertyCardSkeleton = () => (
  <div className="card overflow-hidden">
    {/* Top colour bar */}
    <div className="h-1 w-full bg-slate-100" />

    <div className="p-5 space-y-4">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-2 flex-1">
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-7 rounded-md" />
            <Skeleton className="h-4 w-36" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
        <div className="flex gap-1">
          <Skeleton className="h-7 w-7 rounded-lg" />
          <Skeleton className="h-7 w-7 rounded-lg" />
        </div>
      </div>

      {/* Address line */}
      <Skeleton className="h-3 w-48" />

      {/* Stats row */}
      <div className="pt-3" style={{ borderTop: '1px solid #E2E8F0' }}>
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-5 w-8" />
              <Skeleton className="h-2.5 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
)

// ── Stats mini-row skeleton (inside a loaded card while stats fetch) ──────────
export const StatsSkeleton = () => (
  <div className="grid grid-cols-3 gap-3">
    {[0, 1, 2].map((i) => (
      <div key={i} className="space-y-1.5">
        <Skeleton className="h-5 w-8" />
        <Skeleton className="h-2.5 w-14" />
      </div>
    ))}
  </div>
)

// ── Dashboard skeleton ────────────────────────────────────────────────────────
export const DashboardSkeleton = () => (
  <div className="space-y-6 max-w-7xl animate-fadeIn">
    {/* Header */}
    <div className="flex items-center justify-between">
      <div className="space-y-2">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="h-9 w-24 rounded-xl" />
    </div>

    {/* KPI row 1 — 3 cards */}
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      {[0,1,2].map((i) => (
        <div key={i} className="card p-5 space-y-3">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-16" />
            </div>
          </div>
        </div>
      ))}
    </div>

    {/* KPI row 2 — 3 cards */}
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      {[0,1,2].map((i) => (
        <div key={i} className="card p-5 space-y-3">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-20" />
            </div>
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
      ))}
    </div>

    {/* Occupancy + Rent Collection */}
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card p-5 space-y-4">
        <Skeleton className="h-4 w-36" />
        <div className="flex gap-6">
          <Skeleton className="h-32 w-32 rounded-full shrink-0" />
          <div className="flex-1 space-y-3 pt-2">
            {[0,1,2].map(i => (
              <div key={i} className="flex items-center justify-between">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-10" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="card p-5 space-y-4">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-2 w-full rounded-full" />
        <div className="grid grid-cols-3 gap-3">
          {[0,1,2].map(i => <Skeleton key={i} className="h-20 rounded-xl" />)}
        </div>
      </div>
    </div>

    {/* Table skeleton */}
    <div className="card p-5 space-y-4">
      <Skeleton className="h-4 w-44" />
      {[0,1,2,3,4].map(i => (
        <div key={i} className="flex items-center gap-4">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-3 w-14" />
        </div>
      ))}
    </div>
  </div>
)
