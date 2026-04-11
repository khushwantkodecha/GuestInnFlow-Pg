import api from './axios'

export const login    = (data) => api.post('/auth/login', data)
export const register = (data) => api.post('/auth/register', data)
export const signup   = (data) => api.post('/auth/signup', data)
export const getMe    = () => api.get('/auth/me')
