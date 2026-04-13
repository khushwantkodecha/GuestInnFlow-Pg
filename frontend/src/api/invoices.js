import api from './axios'

export const getInvoices = (propertyId, params) =>
  api.get(`/properties/${propertyId}/invoices`, { params })

export const getInvoice = (propertyId, id) =>
  api.get(`/properties/${propertyId}/invoices/${id}`)

export const generateInvoices = (propertyId, data) =>
  api.post(`/properties/${propertyId}/invoices/generate`, data)

export const getInvoiceShareMessage = (propertyId, id) =>
  api.get(`/properties/${propertyId}/invoices/${id}/share`)

// PDF download — returns a full URL to open/anchor, not an axios call,
// because the browser needs to handle it as a binary file download.
export const getInvoicePdfUrl = (propertyId, id) =>
  `/api/properties/${propertyId}/invoices/${id}/pdf`
