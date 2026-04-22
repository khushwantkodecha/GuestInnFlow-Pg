import { createContext, useContext, useState, useEffect } from 'react'
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

  const loginUser = (token, userData) => {
    localStorage.setItem('token', token)
    localStorage.setItem('gif_login_ts', new Date().toISOString())
    setUser(userData)
  }

  const logout = () => {
    localStorage.removeItem('token')
    setUser(null)
  }

  const updateUser = async (data) => {
    const res = await updateMe(data)
    setUser(res.data.data)
    return res
  }

  return (
    <AuthContext.Provider value={{ user, loading, loginUser, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
