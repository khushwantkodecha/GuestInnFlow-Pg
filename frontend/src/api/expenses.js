import api from './axios'

export const getExpenses      = (propertyId, params) =>
  api.get(`/properties/${propertyId}/expenses`, { params })

export const addExpense       = (propertyId, data) =>
  api.post(`/properties/${propertyId}/expenses`, data)

export const deleteExpense    = (propertyId, id) =>
  api.delete(`/properties/${propertyId}/expenses/${id}`)

export const approveExpense   = (propertyId, id) =>
  api.patch(`/properties/${propertyId}/expenses/${id}/approve`)

export const rejectExpense    = (propertyId, id, reason) =>
  api.patch(`/properties/${propertyId}/expenses/${id}/reject`, { reason })

export const toggleRecurring  = (propertyId, id) =>
  api.patch(`/properties/${propertyId}/expenses/${id}/toggle-recurring`)

export const getExpenseAnalytics = (propertyId, params) =>
  api.get(`/properties/${propertyId}/expenses/analytics`, { params })
