// ─────────────────────────────────────────────────────────────────────────────
// Navigation type definitions — keeps all route names + param types in one place.
// Import these wherever you use navigation hooks / Link components.
// ─────────────────────────────────────────────────────────────────────────────

// ── Auth Stack ────────────────────────────────────────────────────────────────
export type AuthStackParamList = {
  Login:  undefined
  Signup: undefined
}

// ── Main Stack (expand as you add more screens) ───────────────────────────────
export type MainStackParamList = {
  Dashboard: undefined
  // Properties, RoomsBeds, Tenants, Rent… will be added in future steps
}

// ── Root Navigator ────────────────────────────────────────────────────────────
export type RootStackParamList = {
  Auth: undefined   // Auth stack
  Main: undefined   // Main (authenticated) stack
}
