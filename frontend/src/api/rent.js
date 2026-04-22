import api from './axios'

export const getRents = (propertyId, params) =>
  api.get(`/properties/${propertyId}/rents`, { params })
export const getPendingRents = (propertyId) =>
  api.get(`/properties/${propertyId}/rents/pending`)
export const getOverdueRents = (propertyId) =>
  api.get(`/properties/${propertyId}/rents/overdue`)
export const generateRent = (propertyId, data) =>
  api.post(`/properties/${propertyId}/rents/generate`, data)

// Full financial tracking: allocates oldest-first, writes LedgerEntry + Payment
export const recordPayment = (propertyId, data) =>
  api.post(`/properties/${propertyId}/rents/payments`, data)

// Tenant ledger timeline (LedgerEntry records + current balance)
// Optional params: { from, to, type, page, limit }
export const getTenantLedger = (propertyId, tenantId, params) =>
  api.get(`/properties/${propertyId}/rents/tenants/${tenantId}/ledger`, { params })

// Record a manual debit charge (damage, extra, etc.)
export const addCharge = (propertyId, tenantId, data) =>
  api.post(`/properties/${propertyId}/rents/tenants/${tenantId}/charge`, data)

// Reverse a previously recorded payment (creates a reversal LedgerEntry)
export const reversePayment = (propertyId, paymentId, data) =>
  api.post(`/properties/${propertyId}/rents/payments/${paymentId}/reverse`, data)

// Legacy — prefer recordPayment
export const markRentPaid = (propertyId, rentId, data) =>
  api.patch(`/properties/${propertyId}/rents/${rentId}/pay`, data)

