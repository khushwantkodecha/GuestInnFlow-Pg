// ─────────────────────────────────────────────────────────────────────────────
// storage.ts — typed AsyncStorage helpers
//
// Centralises all read/write/remove operations so nothing in the app
// calls AsyncStorage directly (easier to swap out later if needed).
// ─────────────────────────────────────────────────────────────────────────────

import AsyncStorage from '@react-native-async-storage/async-storage'
import { TOKEN_KEY } from '@/constants/config'

const USER_KEY = `${TOKEN_KEY}_user`

// ── Token ─────────────────────────────────────────────────────────────────────
export const saveToken = (token: string) =>
  AsyncStorage.setItem(TOKEN_KEY, token)

export const getToken = () =>
  AsyncStorage.getItem(TOKEN_KEY)

export const removeToken = () =>
  AsyncStorage.removeItem(TOKEN_KEY)

// ── User ──────────────────────────────────────────────────────────────────────
export const saveUser = (user: object) =>
  AsyncStorage.setItem(USER_KEY, JSON.stringify(user))

export const getUser = async <T = unknown>(): Promise<T | null> => {
  const raw = await AsyncStorage.getItem(USER_KEY)
  return raw ? (JSON.parse(raw) as T) : null
}

export const removeUser = () =>
  AsyncStorage.removeItem(USER_KEY)

// ── Clear session (logout) ────────────────────────────────────────────────────
export const clearSession = () =>
  AsyncStorage.multiRemove([TOKEN_KEY, USER_KEY])
