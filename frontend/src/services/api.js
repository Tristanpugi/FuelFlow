const BASE = '/api'

async function request(method, path, body, params) {
  const token = localStorage.getItem('fuelflow_token')
  const headers = {}
  if (token) headers['Authorization'] = `Bearer ${token}`

  let url = `${BASE}${path}`
  if (params) {
    const qs = new URLSearchParams(params).toString()
    if (qs) url += `?${qs}`
  }

  const options = { method, headers }
  if (body && ['POST', 'PATCH', 'PUT'].includes(method)) {
    headers['Content-Type'] = 'application/json'
    options.body = JSON.stringify(body)
  }

  const res = await fetch(url, options)
  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      msg = data.message || data.error || msg
    } catch {}
    throw new Error(msg)
  }
  return res.json()
}

export const getStations = (params) => request('GET', '/stations', null, params)
export const getStation = (id) => request('GET', `/stations/${id}`)
export const createStation = (data) => request('POST', '/stations', data)
export const submitPrice = (data) => request('POST', '/prices', data)
export const votePrice = (priceId, vote) => request('POST', `/prices/${priceId}/vote`, { vote })
export const getPriceHistory = (stationId) => request('GET', `/prices/history/${stationId}`)
export const getAlerts = () => request('GET', '/alerts')
export const createAlert = (data) => request('POST', '/alerts', data)
export const deleteAlert = (id) => request('DELETE', `/alerts/${id}`)
export const getNotifications = () => request('GET', '/alerts/notifications')
export const markNotificationRead = (id) => request('PATCH', `/alerts/notifications/${id}/read`)
export const login = (data) => request('POST', '/auth/login', data)
export const register = (data) => request('POST', '/auth/register', data)
export const getPartnerDashboard = () => request('GET', '/partner/dashboard')
export const bulkUpdatePrices = (data) => request('POST', '/partner/prices/bulk', data)
