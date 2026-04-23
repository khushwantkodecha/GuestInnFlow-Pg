import api from './client'

export const getPlans    = ()           => api.get('/api/superadmin/plans').then(r => r.data.plans)
export const updatePlan  = (key, data)  => api.patch(`/api/superadmin/plans/${key}`, data).then(r => r.data)
