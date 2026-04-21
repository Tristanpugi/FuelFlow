import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import * as api from '../services/api'
import PriceCard from '../components/PriceCard'
import PriceSubmitModal from '../components/PriceSubmitModal'
import './StationPage.css'

const FUEL_COLORS = {
  U91: '#2D6A4F', U95: '#52B788', U98: '#1B4332',
  Diesel: '#FFC107', E10: '#17A2B8', LPG: '#6F42C1'
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
    Promise.all([api.getStation(id), api.getPriceHistory(id)])
      .then(([stationData, histData]) => {
        setStation(stationData)
        setHistory(Array.isArray(histData) ? histData : histData.history || [])
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [id])

  const handleVote = async (priceId, vote) => {
    try { await api.votePrice(priceId, vote) } catch {}
  }

  const handleSuccess = () => {
    setShowModal(false)
    api.getStation(id).then(setStation).catch(() => {})
  }

  if (loading) return <div className="loading" style={{ marginTop: 80 }}>Loading station...</div>
  if (error) return <div className="error-msg" style={{ margin: '80px 24px 0' }}>{error}</div>
  if (!station) return null

  const fuelTypes = [...new Set(history.map(h => h.fuelType))]
  const chartData = history.reduce((acc, h) => {
    const date = formatDate(h.recordedAt || h.createdAt)
    let entry = acc.find(e => e.date === date)
    if (!entry) { entry = { date }; acc.push(entry) }
    entry[h.fuelType] = h.price
    return acc
  }, [])

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
        {(station.prices || []).map(price => (
          <PriceCard key={price._id || price.id || price.fuelType} price={price} onVote={handleVote} />
        ))}
        {(!station.prices || station.prices.length === 0) && (
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
