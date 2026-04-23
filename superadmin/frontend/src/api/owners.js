import api from './client'

export const getOwners      = (params)       => api.get('/api/superadmin/owners', { params }).then(r => r.data)
export const getOwner       = (id)           => api.get(`/api/superadmin/owners/${id}`).then(r => r.data.data)
export const toggleOwner    = (id, active)   => api.patch(`/api/superadmin/owners/${id}/status`, { active }).then(r => r.data)
export const deleteOwner    = (id)           => api.delete(`/api/superadmin/owners/${id}`).then(r => r.data)
export const updateOwnerPlan = (id, plan)    => api.patch(`/api/superadmin/owners/${id}/plan`, { plan }).then(r => r.data)
