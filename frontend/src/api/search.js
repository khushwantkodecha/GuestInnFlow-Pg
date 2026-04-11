import api from './axios'

export const globalSearch = (q) => api.get(`/search?q=${encodeURIComponent(q)}`)
