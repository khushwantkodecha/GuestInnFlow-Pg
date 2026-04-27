// ── Base pulse block ──────────────────────────────────────────────────────────
export const Skeleton = ({ className = '' }) => (
  <div className={`animate-shimmer rounded-lg bg-slate-100 ${className}`} />
)

// ── Settings page skeleton ────────────────────────────────────────────────────
export const SettingsSkeleton = () => (
  <div className="max-w-4xl animate-fadeIn">

    {/* Desktop: left nav + right panel */}
    <div className="hidden md:flex gap-6">
      {/* Left nav card */}
      <div className="w-52 shrink-0">
        <div className="card overflow-hidden">
          <div className="p-2 space-y-0.5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
                <Skeleton className="h-7 w-7 rounded-lg shrink-0" />
                <Skeleton className="h-3 flex-1" />
              </div>
            ))}
          </div>
          <div className="border-t border-slate-100 p-2">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Skeleton className="h-7 w-7 rounded-lg shrink-0" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
        </div>
      </div>

      {/* Right panel card — profile section */}
      <div className="flex-1 min-w-0">
        <div className="card p-6 space-y-6">
          <div className="space-y-1.5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-48" />
          </div>
          {/* Avatar row */}
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-2xl shrink-0" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
          </div>
          {/* Form fields */}
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-1.5">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-10 w-full rounded-xl" />
            </div>
          ))}
          <Skeleton className="h-9 w-24 rounded-xl" />
        </div>
      </div>
    </div>

    {/* Mobile: list view */}
    <div className="md:hidden space-y-3">
      {/* User card */}
      <div className="bg-white rounded-2xl border border-slate-200 px-4 py-4 flex items-center gap-3">
        <Skeleton className="h-12 w-12 rounded-2xl shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-36" />
        </div>
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>

      {/* Section list */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3.5 px-4 py-3.5">
            <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
            <Skeleton className="h-3.5 flex-1" />
            <Skeleton className="h-4 w-4 rounded" />
          </div>
        ))}
      </div>

      {/* Sign out */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-center gap-3.5 px-4 py-3.5">
          <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
          <Skeleton className="h-3.5 w-16" />
        </div>
      </div>
    </div>
  </div>
)

// ── Property card skeleton ────────────────────────────────────────────────────
export const PropertyCardSkeleton = () => (
  <div className="rounded-2xl overflow-hidden bg-white border border-slate-200 flex flex-col">
    {/* Accent stripe */}
    <div className="h-1 w-full bg-slate-100 shrink-0" />

    {/* Header */}
    <div className="px-4 pt-4 pb-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
          <div className="space-y-1.5 min-w-0">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        <Skeleton className="h-5 w-14 rounded-full shrink-0 mt-0.5" />
      </div>
    </div>

    {/* Body */}
    <div className="flex-1 px-4 pb-3">
      <div className="border-t border-slate-100 pt-3 space-y-3">
        {/* 4-col KPI strip */}
        <div className="grid grid-cols-4 divide-x divide-slate-100 rounded-xl bg-slate-50 border border-slate-200 overflow-hidden">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col items-center py-2.5 px-1 gap-1">
              <Skeleton className="h-3.5 w-8" />
              <Skeleton className="h-2 w-10" />
            </div>
          ))}
        </div>

        {/* Occupancy bar */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-2.5 w-8" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-2 w-16" />
            <Skeleton className="h-2 w-14" />
          </div>
        </div>
      </div>
    </div>

    {/* Footer actions */}
    <div className="px-4 pb-4 pt-1 flex items-center gap-2">
      <Skeleton className="flex-1 h-9 rounded-xl" />
      <Skeleton className="h-9 w-20 rounded-xl shrink-0" />
      <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
    </div>
  </div>
)

// ── Stats mini-row skeleton (inside a loaded card while stats fetch) ──────────
export const StatsSkeleton = () => (
  <div className="grid grid-cols-4 divide-x divide-slate-100 rounded-xl bg-slate-50 border border-slate-200 overflow-hidden">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="flex flex-col items-center py-2.5 px-1 gap-1">
        <Skeleton className="h-3.5 w-8" />
        <Skeleton className="h-2 w-10" />
      </div>
    ))}
  </div>
)

// ── Properties full-page skeleton ────────────────────────────────────────────
export const PropertiesSkeleton = () => (
  <div className="space-y-5 max-w-6xl animate-fadeIn">

    {/* Page header */}
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-1.5">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-9 w-32 rounded-xl shrink-0" />
    </div>

    {/* Portfolio KPI bar — 4 stat cards */}
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-2xl bg-white border border-slate-200 px-4 py-3.5 flex items-center gap-3 shadow-sm">
          <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-2.5 w-20" />
          </div>
        </div>
      ))}
    </div>

    {/* Search + filter bar */}
    <div className="flex flex-wrap items-center gap-2">
      <Skeleton className="h-9 flex-1 min-w-[180px]" />
      <Skeleton className="h-9 w-48 rounded-xl" />
    </div>

    {/* Property card grid */}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => <PropertyCardSkeleton key={i} />)}
    </div>
  </div>
)

// ── Rooms & Beds page skeleton ────────────────────────────────────────────────
export const RoomsBedsSkeleton = () => (
  <div className="space-y-3 sm:space-y-5 max-w-7xl animate-fadeIn">
    {/* Toolbar: property name + Add Room button */}
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-3 w-20" />
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-3 w-14" />)}
        </div>
        <Skeleton className="h-9 w-24 rounded-xl" />
      </div>
    </div>

    {/* Filter bar */}
    <div className="flex flex-wrap gap-2">
      <Skeleton className="h-9 flex-1 min-w-[180px]" />
      <Skeleton className="h-9 w-24 rounded-xl" />
      <Skeleton className="h-9 w-9 rounded-xl" />
    </div>

    {/* Room cards grid */}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-8 w-8 rounded-xl shrink-0" />
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-3 w-16" />
              </div>
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((j) => <Skeleton key={j} className="h-[76px] rounded-2xl" />)}
          </div>
          <div className="flex gap-4 pt-1">
            {[0, 1, 2].map(j => <Skeleton key={j} className="h-3 w-14" />)}
          </div>
        </div>
      ))}
    </div>
  </div>
)

// ── Tenants page skeleton ─────────────────────────────────────────────────────
export const TenantsSkeleton = () => (
  <div className="space-y-3 sm:space-y-5 max-w-7xl animate-fadeIn">
    {/* Header: subtitle + Add Tenant button */}
    <div className="flex items-center justify-between gap-3">
      <Skeleton className="h-3 w-48" />
      <Skeleton className="h-9 w-28 rounded-xl shrink-0" />
    </div>

    {/* Stat cards */}
    <div className="grid grid-cols-2 gap-3 sm:flex sm:gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card p-4 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-8 rounded-xl shrink-0" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-6 w-16" />
        </div>
      ))}
    </div>

    {/* Search + filter bar */}
    <div className="flex gap-2">
      <Skeleton className="h-9 flex-1" />
      <Skeleton className="h-9 w-24 rounded-xl" />
    </div>

    {/* Tenant rows */}
    <div className="card overflow-hidden !p-0">
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-50 last:border-0">
          <Skeleton className="h-9 w-9 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-2.5 w-24" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-3 w-20 hidden sm:block" />
          <Skeleton className="h-7 w-7 rounded-lg" />
        </div>
      ))}
    </div>
  </div>
)

// ── Rent page skeleton ────────────────────────────────────────────────────────
export const RentSkeleton = () => (
  <div className="space-y-3 sm:space-y-5 max-w-7xl animate-fadeIn">
    {/* Mobile header: month nav pill + Generate */}
    <div className="sm:hidden flex items-center bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <Skeleton className="h-14 w-10 rounded-none" />
      <div className="flex-1 flex justify-center">
        <Skeleton className="h-5 w-32" />
      </div>
      <Skeleton className="h-14 w-10 rounded-none" />
      <div className="w-px h-8 bg-slate-100 shrink-0" />
      <Skeleton className="h-14 w-20 rounded-none" />
    </div>

    {/* Desktop header: month nav pill + Generate */}
    <div className="hidden sm:flex items-center justify-between gap-3">
      <Skeleton className="h-10 w-52 rounded-2xl" />
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-3 w-14" />)}
        </div>
        <Skeleton className="h-9 w-24 rounded-xl" />
      </div>
    </div>

    {/* Summary cards */}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="card p-4 space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-2 w-full rounded-full" />
        </div>
      ))}
    </div>

    {/* Search + filter bar */}
    <div className="flex gap-2">
      <Skeleton className="h-9 flex-1" />
      <Skeleton className="h-9 w-28 rounded-xl" />
      <Skeleton className="h-9 w-28 rounded-xl" />
    </div>

    {/* Rent rows */}
    <div className="card overflow-hidden !p-0">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-50 last:border-0">
          <Skeleton className="h-9 w-9 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-2.5 w-20" />
          </div>
          <Skeleton className="h-3 w-16 hidden sm:block" />
          <Skeleton className="h-6 w-16 rounded-full" />
          <Skeleton className="h-7 w-20 rounded-xl" />
        </div>
      ))}
    </div>
  </div>
)

// ── Dashboard skeleton ────────────────────────────────────────────────────────
export const DashboardSkeleton = () => (
  <div className="space-y-3 sm:space-y-5 max-w-6xl animate-fadeIn">

    {/* Greeting */}
    <div className="space-y-1">
      <Skeleton className="h-6 w-52" />
      <Skeleton className="h-3 w-36" />
    </div>

    {/* Property header + refresh */}
    <div className="flex items-center justify-between">
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-8 w-20 rounded-xl" />
    </div>

    {/* Stats row — 4 cards (2×2 mobile, 4 in a row on sm+) */}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-2xl bg-white border border-slate-100 p-4 flex flex-col gap-3">
          <Skeleton className="h-9 w-9 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
      ))}
    </div>

    {/* Alert banner */}
    <Skeleton className="h-10 w-full rounded-xl" />

    {/* Main two-column grid — lg:grid-cols-5, 3:2 split */}
    <div className="grid gap-3 sm:gap-5 lg:grid-cols-5">

      {/* Left col (span-3): Financial Summary + Recent Activity */}
      <div className="lg:col-span-3 space-y-3 sm:space-y-5">

        {/* Financial Summary card */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3 w-16" />
          </div>
          {/* 3-col mini cards */}
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="rounded-xl bg-slate-50 border border-slate-100 p-3 space-y-1.5">
                <Skeleton className="h-2.5 w-full" />
                <Skeleton className="h-4 w-14 mx-auto" />
              </div>
            ))}
          </div>
          {/* Collection rate bar */}
          <div className="space-y-1.5">
            <div className="flex justify-between">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-2.5 w-8" />
            </div>
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
          {/* Net income row */}
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>

        {/* Recent Activity card */}
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-14" />
          </div>
          {/* Filter tabs */}
          <div className="flex gap-1 px-5 pt-3 pb-1">
            {[0, 1, 2].map(i => <Skeleton key={i} className="h-6 w-16 rounded-full" />)}
          </div>
          {/* Activity rows */}
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5 border-b border-slate-50 last:border-0">
              <Skeleton className="h-8 w-8 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-2.5 w-20" />
              </div>
              <div className="text-right space-y-1.5">
                <Skeleton className="h-3.5 w-16" />
                <Skeleton className="h-4 w-14 rounded-full ml-auto" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right col (span-2): Occupancy + Tenant Summary */}
      <div className="lg:col-span-2 space-y-3 sm:space-y-5">

        {/* Occupancy card */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-5 w-10 rounded-full" />
          </div>
          <div className="flex items-center gap-5">
            <Skeleton className="h-28 w-28 rounded-full shrink-0" />
            <div className="flex-1 space-y-3">
              {[0, 1, 2].map(i => (
                <div key={i} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-2.5 w-16" />
                    <Skeleton className="h-5 w-10 rounded-md" />
                  </div>
                  <Skeleton className="h-1.5 w-full rounded-full" />
                </div>
              ))}
            </div>
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>

        {/* Tenant Summary card */}
        <div className="card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex items-center justify-between rounded-xl bg-slate-50 border border-slate-100 px-3.5 py-2.5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-5 w-8" />
              </div>
            ))}
          </div>
          <Skeleton className="h-9 w-full rounded-xl" />
        </div>
      </div>
    </div>
  </div>
)
