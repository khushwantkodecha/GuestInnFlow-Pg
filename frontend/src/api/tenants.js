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
export const markDepositPaid = (propertyId, id, paid, depositAmount, paidAt = null) => {
  const body = { depositPaid: paid }
  if (paid && depositAmount) {
    body.depositBalance = depositAmount
    body.depositStatus  = 'held'          // "paid" in spec terms
    if (paidAt) body.depositPaidAt = paidAt
  } else if (!paid) {
    body.depositStatus  = 'pending'       // reset to pending when un-marking
    body.depositBalance = 0
    body.depositPaidAt  = null
  }
  return api.put(`/properties/${propertyId}/tenants/${id}`, body)
}
// Returns { data: rentRecords[], rentChanges: rentHistoryEntries[] }
export const getTenantRents = (propertyId, tenantId) =>
  api.get(`/properties/${propertyId}/tenants/${tenantId}/rents`)

export const getTenantAdvance = (propertyId, tenantId) =>
  api.get(`/properties/${propertyId}/tenants/${tenantId}/advance`)
export const applyTenantAdvance = (propertyId, tenantId) =>
  api.post(`/properties/${propertyId}/tenants/${tenantId}/advance/apply`)
export const refundTenantAdvance = (propertyId, tenantId) =>
  api.post(`/properties/${propertyId}/tenants/${tenantId}/advance/refund`)

export const adjustDeposit = (propertyId, tenantId, data = {}) =>
  api.post(`/properties/${propertyId}/tenants/${tenantId}/deposit/adjust`, data)
export const refundDeposit = (propertyId, tenantId) =>
  api.post(`/properties/${propertyId}/tenants/${tenantId}/deposit/refund`)

// Aggregated profile — single call replacing getTenantRents + getTenantLedger + getTenantAdvance + getInvoices
// Returns: { tenant, rents, ledger, advance, invoices }
export const getTenantProfile = (propertyId, tenantId) =>
  api.get(`/properties/${propertyId}/tenants/${tenantId}/profile`)

// Atomic vacate + optional payment
// Body: { vacateOption, paymentAmount, paymentMethod, checkOutDate?, notes?, depositAction? }
export const vacateWithPayment = (propertyId, tenantId, data) =>
  api.post(`/properties/${propertyId}/tenants/${tenantId}/vacate-with-payment`, data)
