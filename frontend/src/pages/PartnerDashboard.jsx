import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import * as api from '../services/api'
import './PartnerDashboard.css'

const FUEL_TYPES = [
  { label: 'Unleaded 91', value: 'U91' },
  { label: 'Unleaded 95', value: 'U95' },
  { label: 'Unleaded 98', value: 'U98' },
  { label: 'Diesel', value: 'Diesel' },
  { label: 'E10', value: 'E10' },
  { label: 'LPG', value: 'LPG' },
]

function timeAgo(dateStr) {
  if (!dateStr) return 'Never'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function PartnerDashboard() {
  const { isAuthenticated, isPartner } = useAuth()
  const navigate = useNavigate()
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bulkForm, setBulkForm] = useState({ stationId: '', fuelType: 'U91', price: '' })
  const [bulkMsg, setBulkMsg] = useState('')

  useEffect(() => {
    if (!isAuthenticated) { navigate('/login'); return }
    if (!isPartner) { navigate('/'); return }
    api.getPartnerDashboard()
      .then(data => setDashboard(data))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [isAuthenticated, isPartner, navigate])

  const handleBulkChange = (e) => setBulkForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleBulkSubmit = async (e) => {
    e.preventDefault()
    setBulkMsg('')
    try {
      await api.bulkUpdatePrices({ ...bulkForm, price: Number(bulkForm.price) })
      setBulkMsg('Price updated successfully!')
      setTimeout(() => setBulkMsg(''), 3000)
    } catch (err) { setBulkMsg(`Error: ${err.message}`) }
  }

  if (loading) return <div className="loading" style={{ marginTop: 80 }}>Loading dashboard...</div>
  if (error) return <div className="error-msg" style={{ margin: '80px 24px 0' }}>{error}</div>
  if (!dashboard) return null

  const { stats = {}, visitTrend = [], stations = [] } = dashboard

  return (
    <div className="partner-page">
      <h1>Partner Dashboard</h1>

      <div className="stats-row">
        <div className="card stat-card">
          <div className="stat-value">{stats.totalVisits ?? 0}</div>
          <div className="stat-label">Total Visits</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{stats.activeStations ?? stations.length}</div>
          <div className="stat-label">Active Stations</div>
        </div>
        <div className="card stat-card">
          <div className="stat-value">{stats.avgRating ? stats.avgRating.toFixed(1) : 'N/A'}</div>
          <div className="stat-label">Avg Rating</div>
        </div>
      </div>

      {visitTrend.length > 0 && (
        <div className="card chart-card">
          <h3>Visit Trend</h3>
          <ResponsiveContainer width="100%" height={250}>
            <AreaChart data={visitTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="visits" stroke="#2D6A4F" fill="#d8f3dc" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="partner-layout">
        <div className="card">
          <h3>Bulk Price Update</h3>
          {bulkMsg && <div className={bulkMsg.startsWith('Error') ? 'error-msg' : 'success-msg'}>{bulkMsg}</div>}
          <form onSubmit={handleBulkSubmit}>
            <div className="form-group">
              <label>Station</label>
              <select name="stationId" value={bulkForm.stationId} onChange={handleBulkChange} required>
                <option value="">Select station...</option>
                {stations.map(s => (
                  <option key={s._id || s.id} value={s._id || s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label>Fuel Type</label>
              <select name="fuelType" value={bulkForm.fuelType} onChange={handleBulkChange}>
                {FUEL_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Price (cents)</label>
              <input name="price" type="number" value={bulkForm.price} onChange={handleBulkChange}
                required placeholder="e.g. 189.9" min="0" step="0.1" />
            </div>
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Update Price</button>
          </form>
        </div>

        <div className="card">
          <h3>Your Stations</h3>
          {stations.length === 0 ? (
            <p className="empty-state">No stations yet.</p>
          ) : (
            <div className="stations-list">
              {stations.map(s => (
                <div key={s._id || s.id} className="partner-station-item">
                  <div>
                    <div className="station-name">{s.name}</div>
                    <div className="station-addr">{s.address}</div>
                  </div>
                  <div className="last-update">Updated {timeAgo(s.updatedAt)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
