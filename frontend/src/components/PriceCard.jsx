import './PriceCard.css'

const FUEL_LABELS = {
  unleaded: 'Unleaded', premium: 'Premium', diesel: 'Diesel', e10: 'E10'
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
  const id = price.id
  const total = price.confirmed_count + price.denied_count
  const confidence = total > 0 ? Math.round((price.confirmed_count / total) * 100) : 50

  return (
    <div className="price-card card">
      <div className="fuel-type-pill">{FUEL_LABELS[price.fuel_type] || price.fuel_type}</div>
      <div className="price-value">{price.price}<span className="price-unit">c/L</span></div>
      <div className="price-meta">
        <span>{timeAgo(price.updated_at || price.created_at)}</span>
        {price.is_verified ? <span className="price-source">✓ Verified</span> : null}
      </div>
      <div className="confidence-bar">
        <div className="confidence-fill" style={{ width: `${confidence}%` }} />
      </div>
      <div className="confidence-label">Confidence: {confidence}%</div>
      <div className="vote-row">
        <button className="btn btn-sm vote-btn confirm" onClick={() => onVote(id, 'confirm')} title="Confirm price">
          👍
        </button>
        <button className="btn btn-sm vote-btn incorrect" onClick={() => onVote(id, 'deny')} title="Mark as incorrect">
          👎
        </button>
      </div>
    </div>
  )
}
