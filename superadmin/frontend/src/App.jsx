import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import AppLayout from './components/layout/AppLayout'
import Spinner   from './components/ui/Spinner'
import Login         from './pages/Login'
import Dashboard     from './pages/Dashboard'
import Owners        from './pages/Owners'
import OwnerDetail   from './pages/OwnerDetail'
import Properties    from './pages/Properties'
import Subscriptions from './pages/Subscriptions'

const Guard = ({ children }) => {
  const { admin, loading } = useAuth()
  if (loading) return <div className="flex items-center justify-center h-screen"><Spinner /></div>
  if (!admin)  return <Navigate to="/login" replace />
  return children
}

const AppRoutes = () => (
  <Routes>
    <Route path="/login" element={<Login />} />
    <Route
      element={
        <Guard>
          <AppLayout />
        </Guard>
      }
    >
      <Route index                        element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard"            element={<Dashboard />} />
      <Route path="/owners"               element={<Owners />} />
      <Route path="/owners/:id"           element={<OwnerDetail />} />
      <Route path="/properties"           element={<Properties />} />
      <Route path="/subscriptions"        element={<Subscriptions />} />
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes>
)

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
