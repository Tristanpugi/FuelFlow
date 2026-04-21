import { useState, useEffect, useCallback } from 'react'
import * as api from '../services/api'

const FUEL_TYPES = [
  { label: 'Unleaded', value: 'unleaded' },
  { label: 'Premium', value: 'premium' },
  { label: 'Diesel', value: 'diesel' },
  { label: 'E10', value: 'e10' },
]

export default function PriceSubmitModal({ stationId, onClose, onSuccess }) {
  const [stations, setStations] = useState([])
  const [form, setForm] = useState({ station_id: stationId || '', fuel_type: 'unleaded', price: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!stationId) {
      api.getStations({}).then(data => {
        setStations(data.data || [])
      }).catch(() => {})
    }
  }, [stationId])

  const handleClose = useCallback(() => onClose(), [onClose])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') handleClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleClose])

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.submitPrice({ station_id: form.station_id, fuel_type: form.fuel_type, price: Number(form.price) })
      setSuccess(true)
      setTimeout(() => { onSuccess?.() }, 1500)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && handleClose()}>
      <div className="modal">
        <h2>Submit Fuel Price</h2>
        {success ? (
          <div className="success-msg">Price submitted! Thank you.</div>
        ) : (
          <form onSubmit={handleSubmit}>
            {error && <div className="error-msg">{error}</div>}
            {!stationId && (
              <div className="form-group">
                <label>Station</label>
                <select name="station_id" value={form.station_id} onChange={handleChange} required>
                  <option value="">Select station...</option>
                  {stations.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group">
              <label>Fuel Type</label>
              <select name="fuel_type" value={form.fuel_type} onChange={handleChange}>
                {FUEL_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Price (cents per litre)</label>
              <input name="price" type="number" value={form.price} onChange={handleChange}
                required placeholder="e.g. 189.9" min="0" step="0.1" />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button type="submit" className="btn btn-primary" disabled={loading} style={{ flex: 1 }}>
                {loading ? 'Submitting...' : 'Submit Price'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={handleClose}>Cancel</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
