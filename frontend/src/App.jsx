import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { PropertyProvider } from './context/PropertyContext'
import { ToastProvider } from './context/ToastContext'
import { CommandPaletteProvider } from './context/CommandPaletteContext'
import AppLayout from './components/layout/AppLayout'
import Spinner from './components/ui/Spinner'

// Eagerly load lightweight / above-the-fold pages
import Landing    from './pages/Landing'
import Login      from './pages/Login'
import Signup     from './pages/Signup'
import Dashboard  from './pages/Dashboard'

// Lazy-load heavier pages (charts, large tables)
const Properties = lazy(() => import('./pages/Properties'))
const RoomsBeds  = lazy(() => import('./pages/RoomsBeds'))
const Tenants    = lazy(() => import('./pages/Tenants'))
const Rent       = lazy(() => import('./pages/Rent'))
const Expenses    = lazy(() => import('./pages/Expenses'))
const Accounting  = lazy(() => import('./pages/Accounting'))
const Reports    = lazy(() => import('./pages/Reports'))
const Settings   = lazy(() => import('./pages/Settings'))
const Invoices   = lazy(() => import('./pages/Invoices'))
const Reminders  = lazy(() => import('./pages/Reminders'))

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth()
  if (loading) return <Spinner />
  if (!user) return <Navigate to="/login" replace />
  return children
}

const AppRoutes = () => (
  <Routes>
    <Route path="/"      element={<Landing />} />
    <Route path="/login"  element={<Login />} />
    <Route path="/signup" element={<Signup />} />
    <Route
      element={
        <ProtectedRoute>
          <AppLayout />
        </ProtectedRoute>
      }
    >
      <Route path="/dashboard"   element={<Dashboard />} />
      <Route path="/properties"  element={<Suspense fallback={<Spinner />}><Properties /></Suspense>} />
      <Route path="/rooms"       element={<Suspense fallback={<Spinner />}><RoomsBeds /></Suspense>} />
      <Route path="/tenants"     element={<Suspense fallback={<Spinner />}><Tenants /></Suspense>} />
      <Route path="/rent"        element={<Suspense fallback={<Spinner />}><Rent /></Suspense>} />
      <Route path="/expenses"    element={<Suspense fallback={<Spinner />}><Expenses /></Suspense>} />
      <Route path="/accounting" element={<Suspense fallback={<Spinner />}><Accounting /></Suspense>} />
      <Route path="/invoices"   element={<Suspense fallback={<Spinner />}><Invoices /></Suspense>} />
      <Route path="/reminders"  element={<Suspense fallback={<Spinner />}><Reminders /></Suspense>} />
      <Route path="/reports"     element={<Suspense fallback={<Spinner />}><Reports /></Suspense>} />
      <Route path="/settings"    element={<Suspense fallback={<Spinner />}><Settings /></Suspense>} />
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
)

const App = () => (
  <BrowserRouter>
    <AuthProvider>
      <PropertyProvider>
        <ToastProvider>
          <CommandPaletteProvider>
            <AppRoutes />
          </CommandPaletteProvider>
        </ToastProvider>
      </PropertyProvider>
    </AuthProvider>
  </BrowserRouter>
)

export default App
