import api from './axios'

export const getReminderLogs = (propertyId, params) =>
  api.get(`/properties/${propertyId}/reminders`, { params })

export const getReminderStats = (propertyId) =>
  api.get(`/properties/${propertyId}/reminders/stats`)

export const getReminderSettings = (propertyId) =>
  api.get(`/properties/${propertyId}/reminders/settings`)

export const updateReminderSettings = (propertyId, data) =>
  api.put(`/properties/${propertyId}/reminders/settings`, data)

export const triggerDailyReminders = (propertyId) =>
  api.post(`/properties/${propertyId}/reminders/trigger`)

export const sendReminderToTenant = (propertyId, tenantId) =>
  api.post(`/properties/${propertyId}/reminders/send`, { tenantId })
