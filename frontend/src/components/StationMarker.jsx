import { Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import { Link } from 'react-router-dom'

export default function StationMarker({ station, selectedFuelType, onClick }) {
  const id = station._id || station.id
  const prices = station.prices || []
  const priceEntry = prices.find(p => p.fuelType === selectedFuelType)
  const priceText = priceEntry ? `${priceEntry.price}c` : ''
  const name = station.name?.length > 20 ? station.name.slice(0, 18) + '…' : (station.name || '')

  const icon = L.divIcon({
    className: '',
    html: `<div style="
      background: white;
      border: 2px solid #2D6A4F;
      border-radius: 8px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 600;
      color: #1B4332;
      box-shadow: 0 2px 6px rgba(0,0,0,0.15);
      white-space: nowrap;
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
    ">
      ${priceText ? `<span style="color:#2D6A4F;font-size:13px">${priceText}</span><br/>` : ''}
      <span style="font-weight:400;font-size:10px">${name}</span>
    </div>`,
    iconAnchor: [0, 0],
  })

  if (!station.location?.coordinates) return null
  const [lng, lat] = station.location.coordinates

  return (
    <Marker position={[lat, lng]} icon={icon}>
      <Popup>
        <strong>{station.name}</strong><br />
        <span style={{ fontSize: 12, color: '#6C757D' }}>{station.address}</span>
        {prices.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {prices.slice(0, 4).map(p => (
              <div key={p.fuelType} style={{ fontSize: 12 }}>
                {p.fuelType}: <strong>{p.price}c/L</strong>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
          <Link to={`/station/${id}`} style={{ fontSize: 12, color: '#2D6A4F' }}>View Details →</Link>
          <button onClick={onClick}
            style={{ fontSize: 12, background: 'none', border: 'none', color: '#52B788', cursor: 'pointer', padding: 0 }}>
            Submit Price
          </button>
        </div>
      </Popup>
    </Marker>
  )
}
