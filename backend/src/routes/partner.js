const express = require('express');
const db = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');
const { checkAlerts } = require('./alerts');

const router = express.Router();

router.use(authenticate, requireRole(['partner', 'admin']));

// GET /api/partner/dashboard
router.get('/dashboard', (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin';
    const stations = isAdmin
      ? db.prepare('SELECT * FROM stations').all()
      : db.prepare('SELECT * FROM stations WHERE partner_id = ?').all(req.user.id);

    const stationsWithData = stations.map((station) => {
      const currentPrices = db
        .prepare('SELECT * FROM fuel_prices WHERE station_id = ? AND is_outdated = 0 ORDER BY created_at DESC')
        .all(station.id);

      const pricesByType = {};
      for (const p of currentPrices) {
        if (!pricesByType[p.fuel_type]) pricesByType[p.fuel_type] = p;
      }

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

      const weeklySubmissions = db
        .prepare(
          "SELECT COUNT(*) as count FROM fuel_prices WHERE station_id = ? AND created_at >= datetime('now', '-7 days')"
        )
        .get(station.id);

      return {
        ...station,
        prices: pricesByType,
        trends,
        weeklySubmissions: weeklySubmissions.count,
      };
    });

    // City averages
    const cityAvgRows = db
      .prepare(
        'SELECT s.city, fp.fuel_type, AVG(fp.price) as avg_price, COUNT(*) as count FROM fuel_prices fp JOIN stations s ON fp.station_id = s.id WHERE fp.is_outdated = 0 GROUP BY s.city, fp.fuel_type'
      )
      .all();

    const cityAverages = {};
    for (const row of cityAvgRows) {
      if (!cityAverages[row.city]) cityAverages[row.city] = {};
      cityAverages[row.city][row.fuel_type] = Math.round(row.avg_price * 10) / 10;
    }

    const totalWeeklySubmissions = db
      .prepare(
        "SELECT COUNT(*) as count FROM fuel_prices WHERE created_at >= datetime('now', '-7 days')"
      )
      .get();

    return res.json({
      success: true,
      data: {
        stations: stationsWithData,
        cityAverages,
        totalStations: stationsWithData.length,
        weeklySubmissions: totalWeeklySubmissions.count,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/partner/prices/bulk
router.post('/prices/bulk', (req, res) => {
  try {
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, error: 'updates must be a non-empty array' });
    }

    const isAdmin = req.user.role === 'admin';
    let count = 0;
    const results = [];

    for (const update of updates) {
      const { station_id, fuel_type, price } = update;

      if (!station_id || !fuel_type || price === undefined) {
        results.push({ station_id, fuel_type, success: false, error: 'Missing fields' });
        continue;
      }

      if (!['unleaded', 'premium', 'diesel', 'e10'].includes(fuel_type)) {
        results.push({ station_id, fuel_type, success: false, error: 'Invalid fuel_type' });
        continue;
      }

      if (typeof price !== 'number' || price <= 0) {
        results.push({ station_id, fuel_type, success: false, error: 'Invalid price' });
        continue;
      }

      const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(station_id);
      if (!station) {
        results.push({ station_id, fuel_type, success: false, error: 'Station not found' });
        continue;
      }

      if (!isAdmin && station.partner_id !== req.user.id) {
        results.push({ station_id, fuel_type, success: false, error: 'Not authorized for this station' });
        continue;
      }

      db.prepare(
        'UPDATE fuel_prices SET is_outdated = 1 WHERE station_id = ? AND fuel_type = ? AND is_outdated = 0'
      ).run(station_id, fuel_type);

      const result = db
        .prepare(
          'INSERT INTO fuel_prices (station_id, fuel_type, price, submitted_by) VALUES (?, ?, ?, ?)'
        )
        .run(station_id, fuel_type, price, req.user.id);

      const newPrice = db.prepare('SELECT * FROM fuel_prices WHERE id = ?').get(result.lastInsertRowid);
      results.push({ station_id, fuel_type, success: true, data: newPrice });
      count++;
    }

    checkAlerts(db);

    return res.json({ success: true, data: { updated: count, results } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
