import api from './client'

export const getPlatformStats = () =>
  api.get('/api/superadmin/stats').then(r => r.data.data)
