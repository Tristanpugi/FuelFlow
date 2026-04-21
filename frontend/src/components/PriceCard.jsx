import './PriceCard.css'

const FUEL_LABELS = {
  U91: 'Unleaded 91', U95: 'Unleaded 95', U98: 'Unleaded 98',
  Diesel: 'Diesel', E10: 'E10', LPG: 'LPG'
}

function timeAgo(dateStr) {
  if (!dateStr) return 'Unknown'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs !== 1 ? 's' : ''} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days !== 1 ? 's' : ''} ago`
}

export default function PriceCard({ price, onVote }) {
  const id = price._id || price.id
  const confidence = Math.min(100, Math.max(0, price.confidence || 50))

  return (
    <div className="price-card card">
      <div className="fuel-type-pill">{FUEL_LABELS[price.fuelType] || price.fuelType}</div>
      <div className="price-value">{price.price}<span className="price-unit">c/L</span></div>
      <div className="price-meta">
        <span>{timeAgo(price.updatedAt || price.createdAt)}</span>
        {price.source && <span className="price-source">{price.source}</span>}
      </div>
      <div className="confidence-bar">
        <div className="confidence-fill" style={{ width: `${confidence}%` }} />
      </div>
      <div className="confidence-label">Confidence: {confidence}%</div>
      <div className="vote-row">
        <button className="btn btn-sm vote-btn confirm" onClick={() => onVote(id, 'confirm')} title="Confirm price">
          👍
        </button>
        <button className="btn btn-sm vote-btn incorrect" onClick={() => onVote(id, 'incorrect')} title="Mark as incorrect">
          👎
        </button>
      </div>
    </div>
  )
}
