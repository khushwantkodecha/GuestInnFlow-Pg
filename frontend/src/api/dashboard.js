import api from './axios'

export const getDashboard = () => api.get('/dashboard')
export const getPropertyDashboard = (propertyId) => api.get(`/dashboard/property/${propertyId}`)
