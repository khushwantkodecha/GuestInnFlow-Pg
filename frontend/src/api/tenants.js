import api from './axios'

export const getTenants = (propertyId, params) =>
  api.get(`/properties/${propertyId}/tenants`, { params })
export const getTenant = (propertyId, id) =>
  api.get(`/properties/${propertyId}/tenants/${id}`)
export const createTenant = (propertyId, data) =>
  api.post(`/properties/${propertyId}/tenants`, data)
export const updateTenant = (propertyId, id, data) =>
  api.put(`/properties/${propertyId}/tenants/${id}`, data)
export const vacateTenant = (propertyId, id) =>
  api.delete(`/properties/${propertyId}/tenants/${id}`)
export const markDepositPaid = (propertyId, id, paid) =>
  api.put(`/properties/${propertyId}/tenants/${id}`, { depositPaid: paid })
export const getTenantRents = (propertyId, tenantId) =>
  api.get(`/properties/${propertyId}/tenants/${tenantId}/rents`)
