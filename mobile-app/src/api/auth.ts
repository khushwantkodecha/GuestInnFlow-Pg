// ─────────────────────────────────────────────────────────────────────────────
// Auth API — matches web app's frontend/src/api/auth.js exactly.
// Same endpoints, same payloads.
// ─────────────────────────────────────────────────────────────────────────────

import api from './axios'

export interface SignupPayload {
  name: string
  email: string
  password: string
}

export interface LoginPayload {
  email: string
  password: string
}

export interface AuthResponse {
  token: string
  data: {
    _id: string
    name: string
    email: string
    phone?: string
    role: string
  }
}

// POST /auth/signup  — same as web `signup(data)`
export const signup = (data: SignupPayload) =>
  api.post<AuthResponse>('/auth/signup', data)

// POST /auth/register  — same as web `register(data)`
export const register = (data: SignupPayload) =>
  api.post<AuthResponse>('/auth/register', data)

// POST /auth/login  — same as web `login(data)`
export const login = (data: LoginPayload) =>
  api.post<AuthResponse>('/auth/login', data)

// GET /auth/me  — same as web `getMe()`
export const getMe = () => api.get<{ data: AuthResponse['data'] }>('/auth/me')
