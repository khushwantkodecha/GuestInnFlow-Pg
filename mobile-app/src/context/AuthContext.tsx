// ─────────────────────────────────────────────────────────────────────────────
// AuthContext — mobile equivalent of web app's AuthContext.jsx.
// Uses AsyncStorage instead of localStorage.
// ─────────────────────────────────────────────────────────────────────────────

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { TOKEN_KEY } from '@/constants/config'

// ── Types ─────────────────────────────────────────────────────────────────────
interface UserData {
  _id: string
  name: string
  email: string
  phone?: string
  role: string
}

interface AuthContextValue {
  user: UserData | null
  token: string | null
  isLoading: boolean          // true while reading AsyncStorage on app start
  loginUser: (token: string, user: UserData) => Promise<void>
  logout: () => Promise<void>
}

// ── Context ───────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextValue | undefined>(undefined)

// ── Provider ──────────────────────────────────────────────────────────────────
export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser]       = useState<UserData | null>(null)
  const [token, setToken]     = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // On mount: hydrate state from AsyncStorage (equivalent to web reading localStorage)
  useEffect(() => {
    ;(async () => {
      try {
        const [storedToken, storedUser] = await Promise.all([
          AsyncStorage.getItem(TOKEN_KEY),
          AsyncStorage.getItem(`${TOKEN_KEY}_user`),
        ])
        if (storedToken && storedUser) {
          setToken(storedToken)
          setUser(JSON.parse(storedUser))
        }
      } catch {
        // Corrupted storage — start fresh
        await AsyncStorage.multiRemove([TOKEN_KEY, `${TOKEN_KEY}_user`])
      } finally {
        setIsLoading(false)
      }
    })()
  }, [])

  // Called after successful signup / login
  const loginUser = useCallback(async (newToken: string, userData: UserData) => {
    await Promise.all([
      AsyncStorage.setItem(TOKEN_KEY, newToken),
      AsyncStorage.setItem(`${TOKEN_KEY}_user`, JSON.stringify(userData)),
    ])
    setToken(newToken)
    setUser(userData)
  }, [])

  // Called on logout or 401
  const logout = useCallback(async () => {
    await AsyncStorage.multiRemove([TOKEN_KEY, `${TOKEN_KEY}_user`])
    setToken(null)
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, isLoading, loginUser, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
