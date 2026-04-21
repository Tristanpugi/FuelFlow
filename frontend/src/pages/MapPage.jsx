import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { MapContainer, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import * as api from '../services/api'
import PriceSubmitModal from '../components/PriceSubmitModal'
import StationMarker from '../components/StationMarker'
import './MapPage.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({ iconRetinaUrl: markerIcon2x, iconUrl: markerIcon, shadowUrl: markerShadow })

const FUEL_TYPES = [
  { label: 'Unleaded', value: 'unleaded' },
  { label: 'Premium', value: 'premium' },
  { label: 'Diesel', value: 'diesel' },
  { label: 'E10', value: 'e10' },
]

function RecenterMap({ center }) {
  const map = useMap()
  useEffect(() => {
    if (center) map.setView(center, map.getZoom())
  }, [center, map])
  return null
}

export default function MapPage() {
  const [stations, setStations] = useState([])
  const [fuelType, setFuelType] = useState('unleaded')
  const [sortBy, setSortBy] = useState('price')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [userCenter, setUserCenter] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [modalStationId, setModalStationId] = useState(null)

  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      (pos) => setUserCenter([pos.coords.latitude, pos.coords.longitude]),
      () => {}
    )
  }, [])

  useEffect(() => {
    setLoading(true)
    setError('')
    api.getStations({ fuel_type: fuelType, sort: sortBy })
      .then(data => setStations(data.data || []))
      .catch(err => setError(err.message))
      .finally(() => setLoading(false))
  }, [fuelType, sortBy])

  const openModal = (stationId = null) => {
    setModalStationId(stationId)
    setShowModal(true)
  }

  const getPrice = (station) => {
    const p = station.prices && station.prices[fuelType]
    return p ? `${p.price}c` : 'N/A'
  }

  return (
    <div className="map-page">
      <div className="map-sidebar">
        <h2 className="sidebar-title">Find Fuel</h2>
        <div className="form-group">
          <label>Fuel Type</label>
          <select value={fuelType} onChange={e => setFuelType(e.target.value)}>
            {FUEL_TYPES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Sort By</label>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
            <option value="price">Price (ascending)</option>
            <option value="distance">Distance</option>
          </select>
        </div>
        <button className="btn btn-primary" style={{ width: '100%', marginBottom: 16 }} onClick={() => openModal()}>
          + Submit Price
        </button>
        {loading && <div className="loading">Loading stations...</div>}
        {error && <div className="error-msg">{error}</div>}
        <div className="station-list">
          {stations.map(station => (
            <Link key={station._id || station.id} to={`/station/${station._id || station.id}`} className="station-list-item">
              <div className="station-list-name">{station.name}</div>
              <div className="station-list-address">{station.address}</div>
              <div className="station-list-price">{getPrice(station)}</div>
            </Link>
          ))}
          {!loading && stations.length === 0 && !error && (
            <p className="empty-state">No stations found.</p>
          )}
        </div>
      </div>
      <div className="map-container">
        <MapContainer
          center={userCenter || [-33.8688, 151.2093]}
          zoom={12}
          style={{ height: '100%', width: '100%' }}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          {userCenter && <RecenterMap center={userCenter} />}
          {stations.map(station => (
            <StationMarker
              key={station._id || station.id}
              station={station}
              selectedFuelType={fuelType}
              onClick={() => openModal(station._id || station.id)}
            />
          ))}
        </MapContainer>
      </div>
      {showModal && (
        <PriceSubmitModal
          stationId={modalStationId}
          onClose={() => setShowModal(false)}
          onSuccess={() => {
            setShowModal(false)
            api.getStations({ fuel_type: fuelType, sort: sortBy })
              .then(data => setStations(data.data || []))
              .catch(() => {})
          }}
        />
      )}
    </div>
  )
}
