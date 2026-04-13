import api from './axios'

export const getTenants = (propertyId, params) =>
  api.get(`/properties/${propertyId}/tenants`, { params })
export const getTenant = (propertyId, id) =>
  api.get(`/properties/${propertyId}/tenants/${id}`)
// Search by phone (exact prefix) or name (case-insensitive substring).
// Used by the Assign Tenant modal for duplicate detection.
export const searchTenants = (propertyId, params) =>
  api.get(`/properties/${propertyId}/tenants/search`, { params })
export const createTenant = (propertyId, data) =>
  api.post(`/properties/${propertyId}/tenants`, data)
export const updateTenant = (propertyId, id, data) =>
  api.put(`/properties/${propertyId}/tenants/${id}`, data)
export const vacateTenant = (propertyId, id) =>
  api.delete(`/properties/${propertyId}/tenants/${id}`)
export const markDepositPaid = (propertyId, id, paid, depositAmount) => {
  const body = { depositPaid: paid }
  if (paid && depositAmount) {
    body.depositBalance = depositAmount
    body.depositStatus  = 'held'
  }
  return api.put(`/properties/${propertyId}/tenants/${id}`, body)
}
export const getTenantRents = (propertyId, tenantId) =>
  api.get(`/properties/${propertyId}/tenants/${tenantId}/rents`)

export const getTenantAdvance = (propertyId, tenantId) =>
  api.get(`/properties/${propertyId}/tenants/${tenantId}/advance`)
export const applyTenantAdvance = (propertyId, tenantId) =>
  api.post(`/properties/${propertyId}/tenants/${tenantId}/advance/apply`)
export const refundTenantAdvance = (propertyId, tenantId) =>
  api.post(`/properties/${propertyId}/tenants/${tenantId}/advance/refund`)

export const adjustDeposit = (propertyId, tenantId) =>
  api.post(`/properties/${propertyId}/tenants/${tenantId}/deposit/adjust`)
export const refundDeposit = (propertyId, tenantId) =>
  api.post(`/properties/${propertyId}/tenants/${tenantId}/deposit/refund`)
