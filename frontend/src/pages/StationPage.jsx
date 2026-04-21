import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import * as api from '../services/api'
import PriceCard from '../components/PriceCard'
import PriceSubmitModal from '../components/PriceSubmitModal'
import './StationPage.css'

const FUEL_COLORS = {
  unleaded: '#2D6A4F', premium: '#52B788', diesel: '#FFC107', e10: '#17A2B8'
}

function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
}

export default function StationPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [station, setStation] = useState(null)
  const [history, setHistory] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.getStation(id)
      .then(stationRes => {
        const s = stationRes.data || stationRes
        setStation(s)
        setHistory(s.history || [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  const handleVote = async (priceId, vote) => {
    try { await api.votePrice(priceId, vote) } catch {}
  }

  const handleSuccess = () => {
    setShowModal(false)
    api.getStation(id).then(res => {
      const s = res.data || res
      setStation(s)
      setHistory(s.history || [])
    }).catch(() => {})
  }

  if (loading) return <div className="loading" style={{ marginTop: 80 }}>Loading station...</div>
  if (error) return <div className="error-msg" style={{ margin: '80px 24px 0' }}>{error}</div>
  if (!station) return null

  const fuelTypes = [...new Set(history.map(h => h.fuel_type))]
  const chartData = history.reduce((acc, h) => {
    const date = formatDate(h.created_at)
    let entry = acc.find(e => e.date === date)
    if (!entry) { entry = { date }; acc.push(entry) }
    entry[h.fuel_type] = h.price
    return acc
  }, [])

  const pricesArray = Object.values(station.prices || {})

  return (
    <div className="station-page">
      <div className="station-header">
        <button className="btn btn-secondary btn-sm back-btn" onClick={() => navigate(-1)}>← Back</button>
        <div className="station-title">
          <h1>{station.name}</h1>
          {station.brand && <span className="badge badge-primary">{station.brand}</span>}
        </div>
        <p className="station-address">{station.address}</p>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Submit Price</button>
      </div>

      <div className="price-grid">
        {pricesArray.map(price => (
          <PriceCard key={price.id || price.fuel_type} price={price} onVote={handleVote} />
        ))}
        {pricesArray.length === 0 && (
          <p className="empty-state">No prices reported yet.</p>
        )}
      </div>

      {chartData.length > 0 && (
        <div className="card chart-card">
          <h3>Price History</h3>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis unit="c" />
              <Tooltip formatter={(v) => `${v}c/L`} />
              <Legend />
              {fuelTypes.map(ft => (
                <Line key={ft} type="monotone" dataKey={ft} stroke={FUEL_COLORS[ft] || '#999'} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {showModal && (
        <PriceSubmitModal
          stationId={station._id || station.id}
          onClose={() => setShowModal(false)}
          onSuccess={handleSuccess}
        />
      )}
    </div>
  )
}
