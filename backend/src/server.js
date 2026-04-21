const express = require('express');
const cors = require('cors');

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

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/stations', stationsRoutes);
app.use('/api/prices', pricesRoutes);
app.use('/api/alerts', alertsRoutes);
app.use('/api/partner', partnerRoutes);

app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`FuelFlow backend running on port ${PORT}`);
});

module.exports = app;
