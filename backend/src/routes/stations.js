const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../database');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function attachPrices(stations) {
  const stationIds = stations.map((s) => s.id);
  if (stationIds.length === 0) return stations;

  const placeholders = stationIds.map(() => '?').join(',');
  const prices = db
    .prepare(
      `SELECT * FROM fuel_prices WHERE station_id IN (${placeholders}) AND is_outdated = 0 ORDER BY created_at DESC`
    )
    .all(...stationIds);

  const priceMap = {};
  for (const p of prices) {
    if (!priceMap[p.station_id]) priceMap[p.station_id] = {};
    if (!priceMap[p.station_id][p.fuel_type]) {
      priceMap[p.station_id][p.fuel_type] = p;
    }
  }

  return stations.map((s) => ({ ...s, prices: priceMap[s.id] || {} }));
}

// GET /api/stations
router.get('/', optionalAuth, (req, res) => {
  try {
    const { city, fuel_type, sort, lat, lng } = req.query;

    let query = 'SELECT * FROM stations WHERE 1=1';
    const params = [];

    if (city) {
      query += ' AND city LIKE ?';
      params.push(`%${city}%`);
    }

    let stations = db.prepare(query).all(...params);
    stations = attachPrices(stations);

    if (fuel_type) {
      stations = stations.filter((s) => s.prices && s.prices[fuel_type]);
    }

    const userLat = lat ? parseFloat(lat) : null;
    const userLng = lng ? parseFloat(lng) : null;

    if (userLat !== null && userLng !== null) {
      stations = stations.map((s) => ({
        ...s,
        distance_km: parseFloat(haversine(userLat, userLng, s.lat, s.lng).toFixed(2)),
      }));
    }

    if (sort === 'price' && fuel_type) {
      stations.sort((a, b) => {
        const pa = a.prices[fuel_type] ? a.prices[fuel_type].price : Infinity;
        const pb = b.prices[fuel_type] ? b.prices[fuel_type].price : Infinity;
        return pa - pb;
      });
    } else if (sort === 'distance' && userLat !== null) {
      stations.sort((a, b) => (a.distance_km || Infinity) - (b.distance_km || Infinity));
    }

    return res.json({ success: true, data: stations });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/stations/:id
router.get('/:id', optionalAuth, (req, res) => {
  try {
    const station = db.prepare('SELECT s.*, u.name as partner_name FROM stations s LEFT JOIN users u ON s.partner_id = u.id WHERE s.id = ?').get(req.params.id);
    if (!station) {
      return res.status(404).json({ success: false, error: 'Station not found' });
    }

    const currentPrices = db
      .prepare('SELECT * FROM fuel_prices WHERE station_id = ? AND is_outdated = 0 ORDER BY created_at DESC')
      .all(station.id);

    const pricesByType = {};
    for (const p of currentPrices) {
      if (!pricesByType[p.fuel_type]) pricesByType[p.fuel_type] = p;
    }

    const history = db
      .prepare(
        "SELECT * FROM fuel_prices WHERE station_id = ? AND created_at >= datetime('now', '-30 days') ORDER BY created_at ASC"
      )
      .all(station.id);

    const fuelTypes = ['unleaded', 'premium', 'diesel', 'e10'];
    const trends = {};

    for (const ft of fuelTypes) {
      const week = db
        .prepare(
          "SELECT * FROM fuel_prices WHERE station_id = ? AND fuel_type = ? AND created_at >= datetime('now', '-7 days') ORDER BY created_at ASC"
        )
        .all(station.id, ft);

      if (week.length >= 2) {
        const oldest = week[0].price;
        const newest = week[week.length - 1].price;
        trends[ft] = parseFloat((((newest - oldest) / oldest) * 100).toFixed(2));
      } else {
        trends[ft] = null;
      }
    }

    return res.json({
      success: true,
      data: {
        ...station,
        prices: pricesByType,
        history,
        trends,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/stations
router.post(
  '/',
  authenticate,
  requireRole(['partner', 'admin']),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('address').trim().notEmpty().withMessage('Address is required'),
    body('city').trim().notEmpty().withMessage('City is required'),
    body('lat').isFloat().withMessage('Valid latitude is required'),
    body('lng').isFloat().withMessage('Valid longitude is required'),
  ],
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: errors.array()[0].msg });
      }

      const { name, brand, address, city, lat, lng, phone } = req.body;
      const partner_id = req.user.role === 'partner' ? req.user.id : null;

      const result = db
        .prepare(
          'INSERT INTO stations (name, brand, address, city, lat, lng, phone, partner_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(name, brand || null, address, city, lat, lng, phone || null, partner_id);

      const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(result.lastInsertRowid);
      return res.status(201).json({ success: true, data: station });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// PUT /api/stations/:id
router.put(
  '/:id',
  authenticate,
  requireRole(['partner', 'admin']),
  [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('lat').optional().isFloat().withMessage('Valid latitude is required'),
    body('lng').optional().isFloat().withMessage('Valid longitude is required'),
  ],
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: errors.array()[0].msg });
      }

      const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(req.params.id);
      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found' });
      }

      if (req.user.role === 'partner' && station.partner_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'You do not own this station' });
      }

      const { name, brand, address, city, lat, lng, phone } = req.body;

      db.prepare(
        `UPDATE stations SET
          name = COALESCE(?, name),
          brand = COALESCE(?, brand),
          address = COALESCE(?, address),
          city = COALESCE(?, city),
          lat = COALESCE(?, lat),
          lng = COALESCE(?, lng),
          phone = COALESCE(?, phone)
        WHERE id = ?`
      ).run(
        name || null,
        brand !== undefined ? brand : null,
        address || null,
        city || null,
        lat !== undefined ? lat : null,
        lng !== undefined ? lng : null,
        phone !== undefined ? phone : null,
        req.params.id
      );

      const updated = db.prepare('SELECT * FROM stations WHERE id = ?').get(req.params.id);
      return res.json({ success: true, data: updated });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

module.exports = router;
