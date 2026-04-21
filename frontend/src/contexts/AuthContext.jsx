import { createContext, useContext, useState, useEffect } from 'react'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(null)

  useEffect(() => {
    const storedToken = localStorage.getItem('fuelflow_token')
    const storedUser = localStorage.getItem('fuelflow_user')
    if (storedToken && storedUser) {
      try {
        setToken(storedToken)
        setUser(JSON.parse(storedUser))
      } catch {
        localStorage.removeItem('fuelflow_token')
        localStorage.removeItem('fuelflow_user')
      }
    }
  }, [])

  const login = (newToken, newUser) => {
    setToken(newToken)
    setUser(newUser)
    localStorage.setItem('fuelflow_token', newToken)
    localStorage.setItem('fuelflow_user', JSON.stringify(newUser))
  }

  const logout = () => {
    setToken(null)
    setUser(null)
    localStorage.removeItem('fuelflow_token')
    localStorage.removeItem('fuelflow_user')
  }

  const value = {
    user,
    token,
    login,
    logout,
    isAuthenticated: !!token,
    isPartner: user?.role === 'partner',
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
