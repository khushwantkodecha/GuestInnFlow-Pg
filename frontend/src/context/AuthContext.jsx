import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react'
import { getMe, updateMe } from '../api/auth'

const AuthContext = createContext(null)

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    if (!token) {
      setLoading(false)
      return
    }
    getMe()
      .then((res) => setUser(res.data.data))
      .catch(() => localStorage.removeItem('token'))
      .finally(() => setLoading(false))
  }, [])

  const loginUser = useCallback((token, userData) => {
    localStorage.setItem('token', token)
    localStorage.setItem('gif_login_ts', new Date().toISOString())
    setUser(userData)
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('token')
    setUser(null)
  }, [])

  const updateUser = useCallback(async (data) => {
    const res = await updateMe(data)
    setUser(res.data.data)
    return res
  }, [])

  const value = useMemo(
    () => ({ user, loading, loginUser, logout, updateUser }),
    [user, loading, loginUser, logout, updateUser]
  )

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
