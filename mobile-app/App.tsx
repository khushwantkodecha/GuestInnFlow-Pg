// ─────────────────────────────────────────────────────────────────────────────
// App.tsx — entry point for the TenantInnFlow React Native app.
//
// Wraps everything in:
//   AuthProvider   → global auth state (token + user)
//   RootNavigator  → switches between Auth / Main stacks
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react'
import { AuthProvider } from '@/context/AuthContext'
import RootNavigator   from '@/navigation/RootNavigator'

export default function App() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  )
}
