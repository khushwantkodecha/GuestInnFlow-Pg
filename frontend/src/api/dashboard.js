import api from './axios'

export const getPropertyDashboard  = (propertyId) => api.get(`/dashboard/property/${propertyId}`)
export const getRecentActivity      = (propertyId) => api.get(`/dashboard/property/${propertyId}/recent-activity`)
