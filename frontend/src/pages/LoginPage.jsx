import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import * as api from '../services/api'
import './LoginPage.css'

export default function LoginPage() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'user' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const auth = useAuth()
  const navigate = useNavigate()

  const handleChange = (e) => setForm(f => ({ ...f, [e.target.name]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      let res
      if (mode === 'login') {
        res = await api.login({ email: form.email, password: form.password })
      } else {
        res = await api.register({ name: form.name, email: form.email, password: form.password, role: form.role })
      }
      if (res.token) {
        auth.login(res.token, res.user)
        navigate('/')
      } else {
        setError('Unexpected response from server')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="card login-card">
        <h2>{mode === 'login' ? 'Sign In' : 'Create Account'}</h2>
        {error && <div className="error-msg">{error}</div>}
        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="form-group">
              <label>Name</label>
              <input name="name" type="text" value={form.name} onChange={handleChange} required placeholder="Your name" />
            </div>
          )}
          <div className="form-group">
            <label>Email</label>
            <input name="email" type="email" value={form.email} onChange={handleChange} required placeholder="you@example.com" />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input name="password" type="password" value={form.password} onChange={handleChange} required placeholder="••••••••" />
          </div>
          {mode === 'register' && (
            <div className="form-group">
              <label>Account Type</label>
              <select name="role" value={form.role} onChange={handleChange}>
                <option value="user">User</option>
                <option value="partner">Gas Station Partner</option>
              </select>
            </div>
          )}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>
        <p className="login-toggle">
          {mode === 'login' ? (
            <>Don&apos;t have an account? <button className="link-btn" onClick={() => { setMode('register'); setError('') }}>Register</button></>
          ) : (
            <>Already have an account? <button className="link-btn" onClick={() => { setMode('login'); setError('') }}>Sign In</button></>
          )}
        </p>
      </div>
    </div>
  )
}
