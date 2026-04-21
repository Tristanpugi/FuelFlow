import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import Navbar from './components/Navbar'
import MapPage from './pages/MapPage'
import StationPage from './pages/StationPage'
import AlertsPage from './pages/AlertsPage'
import PartnerDashboard from './pages/PartnerDashboard'
import LoginPage from './pages/LoginPage'

function ProtectedRoute({ children, requirePartner = false }) {
  const { isAuthenticated, isPartner } = useAuth()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (requirePartner && !isPartner) return <Navigate to="/" replace />
  return children
}

function AppRoutes() {
  return (
    <>
      <Navbar />
      <Routes>
        <Route path="/" element={<MapPage />} />
        <Route path="/station/:id" element={<StationPage />} />
        <Route path="/alerts" element={
          <ProtectedRoute><AlertsPage /></ProtectedRoute>
        } />
        <Route path="/partner" element={
          <ProtectedRoute requirePartner><PartnerDashboard /></ProtectedRoute>
        } />
        <Route path="/login" element={<LoginPage />} />
      </Routes>
    </>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
