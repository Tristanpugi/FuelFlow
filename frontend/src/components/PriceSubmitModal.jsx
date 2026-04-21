import { useState, useEffect, useCallback } from 'react'
import * as api from '../services/api'

const FUEL_TYPES = [
  { label: 'Unleaded 91', value: 'U91' },
  { label: 'Unleaded 95', value: 'U95' },
  { label: 'Unleaded 98', value: 'U98' },
  { label: 'Diesel', value: 'Diesel' },
  { label: 'E10', value: 'E10' },
  { label: 'LPG', value: 'LPG' },
]

export default function PriceSubmitModal({ stationId, onClose, onSuccess }) {
  const [stations, setStations] = useState([])
  const [form, setForm] = useState({ stationId: stationId || '', fuelType: 'U91', price: '' })
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!stationId) {
      api.getStations({}).then(data => {
        setStations(Array.isArray(data) ? data : data.stations || [])
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
      await api.submitPrice({ stationId: form.stationId, fuelType: form.fuelType, price: Number(form.price) })
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
                <select name="stationId" value={form.stationId} onChange={handleChange} required>
                  <option value="">Select station...</option>
                  {stations.map(s => (
                    <option key={s._id || s.id} value={s._id || s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="form-group">
              <label>Fuel Type</label>
              <select name="fuelType" value={form.fuelType} onChange={handleChange}>
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
