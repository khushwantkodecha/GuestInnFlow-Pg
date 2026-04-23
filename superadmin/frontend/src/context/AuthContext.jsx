import { createContext, useContext, useState, useEffect } from 'react'
import api from '../api/client'

const Ctx = createContext(null)

export function AuthProvider({ children }) {
  const [admin,   setAdmin]   = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('sa_token')
    if (stored) {
      api.defaults.headers.common['Authorization'] = `Bearer ${stored}`
      api.get('/api/superadmin/me')
        .then(r => setAdmin(r.data.data))
        .catch(() => { localStorage.removeItem('sa_token') })
        .finally(() => setLoading(false))
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (email, password) => {
    const r = await api.post('/api/superadmin/login', { email, password })
    const { token, admin: a } = r.data
    localStorage.setItem('sa_token', token)
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`
    setAdmin(a)
  }

  const logout = () => {
    localStorage.removeItem('sa_token')
    delete api.defaults.headers.common['Authorization']
    setAdmin(null)
  }

  return <Ctx.Provider value={{ admin, loading, login, logout }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
