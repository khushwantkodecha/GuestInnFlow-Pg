import axios from 'axios'

const api = axios.create({ baseURL: '/' })

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('sa_token')
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
