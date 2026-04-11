import api from './axios'

export const getRooms = (propertyId) => api.get(`/properties/${propertyId}/rooms`)
export const createRoom = (propertyId, data) => api.post(`/properties/${propertyId}/rooms`, data)
export const updateRoom = (propertyId, id, data) => api.put(`/properties/${propertyId}/rooms/${id}`, data)
export const deleteRoom = (propertyId, id) => api.delete(`/properties/${propertyId}/rooms/${id}`)

export const getBeds = (propertyId, roomId) =>
  api.get(`/properties/${propertyId}/rooms/${roomId}/beds`)
export const createBed = (propertyId, roomId, data) =>
  api.post(`/properties/${propertyId}/rooms/${roomId}/beds`, data)
export const assignTenant = (propertyId, roomId, bedId, data) =>
  api.patch(`/properties/${propertyId}/rooms/${roomId}/beds/${bedId}/assign`, data)
export const checkoutBed = (propertyId, roomId, bedId) =>
  api.patch(`/properties/${propertyId}/rooms/${roomId}/beds/${bedId}/checkout`)
export const vacateCheck = (propertyId, roomId, bedId) =>
  api.get(`/properties/${propertyId}/rooms/${roomId}/beds/${bedId}/vacate-check`)
export const vacateBed = (propertyId, roomId, bedId, data) =>
  api.patch(`/properties/${propertyId}/rooms/${roomId}/beds/${bedId}/vacate`, data ?? {})
export const reserveBed = (propertyId, roomId, bedId, data) =>
  api.patch(`/properties/${propertyId}/rooms/${roomId}/beds/${bedId}/reserve`, data)
export const cancelReservation = (propertyId, roomId, bedId) =>
  api.patch(`/properties/${propertyId}/rooms/${roomId}/beds/${bedId}/unreserve`)
export const blockBed = (propertyId, roomId, bedId, data = {}) =>
  api.patch(`/properties/${propertyId}/rooms/${roomId}/beds/${bedId}/block`, data)
export const unblockBed = (propertyId, roomId, bedId) =>
  api.patch(`/properties/${propertyId}/rooms/${roomId}/beds/${bedId}/unblock`)

export const createExtraBed = (propertyId, roomId, data) =>
  api.post(`/properties/${propertyId}/rooms/${roomId}/beds/extra`, data)

export const getRoomAnalytics = (propertyId, roomId) =>
  api.get(`/properties/${propertyId}/rooms/${roomId}/analytics`)

export const getRoomFinancials = (propertyId, roomId) =>
  api.get(`/properties/${propertyId}/rooms/${roomId}/financials`)

// Bulk operations
export const bulkBlockBeds = (propertyId, roomId, bedIds) =>
  api.patch(`/properties/${propertyId}/rooms/${roomId}/beds/bulk/block`, { bedIds })
export const bulkUnblockBeds = (propertyId, roomId, bedIds) =>
  api.patch(`/properties/${propertyId}/rooms/${roomId}/beds/bulk/unblock`, { bedIds })
export const bulkVacateBeds = (propertyId, roomId, bedIds) =>
  api.patch(`/properties/${propertyId}/rooms/${roomId}/beds/bulk/vacate`, { bedIds })
