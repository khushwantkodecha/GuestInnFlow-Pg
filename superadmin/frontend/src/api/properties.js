import api from './client'

export const getAllProperties = (params) => api.get('/api/superadmin/properties', { params }).then(r => r.data)
