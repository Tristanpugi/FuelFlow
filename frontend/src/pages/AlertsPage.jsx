import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import * as api from '../services/api'
import './AlertsPage.css'

const FUEL_TYPES = [
  { label: 'Unleaded', value: 'unleaded' },
  { label: 'Premium', value: 'premium' },
  { label: 'Diesel', value: 'diesel' },
  { label: 'E10', value: 'e10' },
]

function timeAgo(dateStr) {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function AlertsPage() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [alerts, setAlerts] = useState([])
  const [notifications, setNotifications] = useState([])
  const [form, setForm] = useState({ fuel_type: 'unleaded', target_price: '', city: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    if (!isAuthenticated) { navigate('/login'); return }
    Promise.all([api.getAlerts(), api.getNotifications()])
      .then(([a, n]) => {
        setAlerts(a.data || [])
        setNotifications(n.data || [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [isAuthenticated, navigate])

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleCreate = async (e) => {
    e.preventDefault()
    setError(''); setSuccess('')
    try {
      const res = await api.createAlert({ ...form, target_price: Number(form.target_price) })
      setAlerts(a => [...a, res.data])
      setForm({ fuel_type: 'unleaded', target_price: '', city: '' })
      setSuccess('Alert created!')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) { setError(err.message) }
  }

  const handleDelete = async (id) => {
    try {
      await api.deleteAlert(id)
      setAlerts(a => a.filter(x => x.id !== id))
    } catch (err) { setError(err.message) }
  }

  const handleMarkRead = async (id) => {
    try {
      await api.markNotificationRead(id)
      setNotifications(n => n.map(x => x.id === id ? { ...x, is_read: true } : x))
    } catch {}
  }

  if (loading) return <div className="loading" style={{ marginTop: 80 }}>Loading...</div>

  return (
    <div className="alerts-page">
      <h1>Price Alerts</h1>
      {error && <div className="error-msg">{error}</div>}
      {success && <div className="success-msg">{success}</div>}

      <div className="alerts-layout">
        <div>
          <div className="card">
            <h3>Create Alert</h3>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label>Fuel Type</label>
              <select name="fuel_type" value={form.fuel_type} onChange={handleChange}>
                  {FUEL_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Target Price (cents)</label>
                <input name="targetPrice" type="number" value={form.targetPrice} onChange={handleChange}
                  required placeholder="e.g. 180" min="0" step="0.1" />
              </div>
              <div className="form-group">
                <label>City (optional)</label>
                <input name="city" type="text" value={form.city} onChange={handleChange} placeholder="e.g. Sydney" />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Create Alert</button>
            </form>
          </div>

          <div className="card" style={{ marginTop: 16 }}>
            <h3>Your Alerts</h3>
            {alerts.length === 0 ? (
              <p className="empty-state">No alerts yet. Create one above.</p>
            ) : (
              <div className="alert-list">
                {alerts.map(alert => (
                  <div key={alert._id || alert.id} className="alert-item">
                    <div>
                      <span className="badge badge-primary">{alert.fuelType}</span>
                      <span className="alert-price">under {alert.targetPrice}c/L</span>
                      {alert.city && <span className="alert-city">in {alert.city}</span>}
                    </div>
                    <button className="btn btn-danger btn-sm"
                      onClick={() => handleDelete(alert._id || alert.id)}>Delete</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h3>Recent Notifications</h3>
          {notifications.length === 0 ? (
            <p className="empty-state">No notifications yet.</p>
          ) : (
            <div className="notification-list">
              {notifications.map(n => (
                <div key={n._id || n.id}
                  className={`notification-item ${n.read ? '' : 'unread'}`}
                  onClick={() => !n.read && handleMarkRead(n._id || n.id)}
                >
                  {!n.read && <span className="unread-dot" />}
                  <div className="notification-content">
                    <p>{n.message}</p>
                    <span className="notification-time">{timeAgo(n.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
