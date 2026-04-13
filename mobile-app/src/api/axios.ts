import axios, { InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { API_BASE_URL, TOKEN_KEY } from '@/constants/config'

// ─────────────────────────────────────────────────────────────────────────────
// Base Axios instance — mirrors the web app's api/axios.js exactly,
// but uses AsyncStorage instead of localStorage (no window object in RN).
// ─────────────────────────────────────────────────────────────────────────────

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000, // 15 s — important on mobile networks
})

// ── Request interceptor: attach Bearer token ──────────────────────────────────
api.interceptors.request.use(
  async (config: InternalAxiosRequestConfig) => {
    const token = await AsyncStorage.getItem(TOKEN_KEY)
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error: AxiosError) => Promise.reject(error),
)

// ── Response interceptor: handle 401 ─────────────────────────────────────────
// On 401 we clear the token. The navigation reset is handled by AuthContext
// (which watches the token state), so no direct navigation call needed here.
api.interceptors.response.use(
  (res: AxiosResponse) => res,
  async (error: AxiosError) => {
    if (error.response?.status === 401) {
      await AsyncStorage.removeItem(TOKEN_KEY)
      // AuthContext will react to the storage change and navigate to login.
    }
    return Promise.reject(error)
  },
)

export default api
