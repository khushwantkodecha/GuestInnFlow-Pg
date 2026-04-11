import api from './axios'

export const getRents = (propertyId, params) =>
  api.get(`/properties/${propertyId}/rents`, { params })
export const getPendingRents = (propertyId) =>
  api.get(`/properties/${propertyId}/rents/pending`)
export const getOverdueRents = (propertyId) =>
  api.get(`/properties/${propertyId}/rents/overdue`)
export const generateRent = (propertyId, data) =>
  api.post(`/properties/${propertyId}/rents/generate`, data)
export const markRentPaid = (propertyId, rentId, data) =>
  api.patch(`/properties/${propertyId}/rents/${rentId}/pay`, data)
export const sendRentReminder = (propertyId, tenantId) =>
  api.post(`/properties/${propertyId}/notifications/rent-reminder`, { tenantId })
