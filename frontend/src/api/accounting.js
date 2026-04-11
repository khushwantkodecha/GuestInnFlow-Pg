import api from './axios'

export const getOverview  = (propertyId, params) =>
  api.get(`/properties/${propertyId}/accounting/overview`, { params })
export const getCashFlow  = (propertyId, params) =>
  api.get(`/properties/${propertyId}/accounting/cashflow`, { params })
export const getChartData = (propertyId, params) =>
  api.get(`/properties/${propertyId}/accounting/chart`, { params })
