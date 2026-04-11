import api from './axios'

export const getProperties        = ()         => api.get('/properties')
export const getAllProperties      = ()         => api.get('/properties/all')
export const getAllPropertyStats   = ()         => api.get('/properties/stats/all')
export const getProperty          = (id)       => api.get(`/properties/${id}`)
export const getPropertyStats     = (id)       => api.get(`/properties/${id}/stats`)
export const getPropertyAnalytics = (id)       => api.get(`/properties/${id}/analytics`)
export const createProperty       = (data)     => api.post('/properties', data)
export const updateProperty       = (id, data) => api.put(`/properties/${id}`, data)
export const deleteProperty       = (id)       => api.delete(`/properties/${id}`)
export const permanentDeleteProperty = (id)    => api.delete(`/properties/${id}/permanent`, {
  headers: { 'x-confirm-delete': 'PERMANENT' },
})
export const reactivateProperty   = (id)       => api.patch(`/properties/${id}/reactivate`)
