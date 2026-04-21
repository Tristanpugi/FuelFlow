const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

require('./database');

const authRoutes = require('./routes/auth');
const stationsRoutes = require('./routes/stations');
const pricesRoutes = require('./routes/prices');
const alertsRoutes = require('./routes/alerts');
const partnerRoutes = require('./routes/partner');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Strict limiter for auth endpoints (prevents brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});

// General API limiter
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/stations', apiLimiter, stationsRoutes);
app.use('/api/prices', apiLimiter, pricesRoutes);
app.use('/api/alerts', apiLimiter, alertsRoutes);
app.use('/api/partner', apiLimiter, partnerRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`FuelFlow backend running on port ${PORT}`);

  // Background job: mark prices older than 6 hours as outdated every 30 minutes
  const db = require('./database');
  const markOutdated = () => {
    db.prepare(
      "UPDATE fuel_prices SET is_outdated = 1 WHERE created_at < datetime('now', '-6 hours') AND is_outdated = 0"
    ).run();
  };
  markOutdated();
  setInterval(markOutdated, 30 * 60 * 1000);
});

module.exports = app;
