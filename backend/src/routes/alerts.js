const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

function checkAlerts(db) {
  try {
    const alerts = db.prepare('SELECT * FROM alerts WHERE is_active = 1').all();

    for (const alert of alerts) {
      let currentPrice = null;
      let stationName = null;

      if (alert.station_id) {
        const row = db
          .prepare(
            'SELECT fp.price, s.name as station_name FROM fuel_prices fp JOIN stations s ON fp.station_id = s.id WHERE fp.station_id = ? AND fp.fuel_type = ? AND fp.is_outdated = 0 ORDER BY fp.created_at DESC LIMIT 1'
          )
          .get(alert.station_id, alert.fuel_type);
        if (row) {
          currentPrice = row.price;
          stationName = row.station_name;
        }
      } else if (alert.city) {
        const row = db
          .prepare(
            'SELECT fp.price, s.name as station_name FROM fuel_prices fp JOIN stations s ON fp.station_id = s.id WHERE s.city LIKE ? AND fp.fuel_type = ? AND fp.is_outdated = 0 ORDER BY fp.price ASC LIMIT 1'
          )
          .get(`%${alert.city}%`, alert.fuel_type);
        if (row) {
          currentPrice = row.price;
          stationName = row.station_name;
        }
      }

      if (currentPrice !== null && currentPrice <= alert.target_price) {
        const recentNotif = db
          .prepare(
            "SELECT id FROM alerts WHERE id = ? AND notified_at > datetime('now', '-24 hours')"
          )
          .get(alert.id);

        if (!recentNotif) {
          const message = `${alert.fuel_type.charAt(0).toUpperCase() + alert.fuel_type.slice(1)} at ${stationName} is now ${currentPrice}c/L \u2014 at or below your target of ${alert.target_price}c/L`;

          db.prepare(
            'INSERT INTO notifications (user_id, alert_id, message, price, station_name) VALUES (?, ?, ?, ?, ?)'
          ).run(alert.user_id, alert.id, message, currentPrice, stationName);

          db.prepare('UPDATE alerts SET notified_at = CURRENT_TIMESTAMP WHERE id = ?').run(alert.id);
        }
      }
    }
  } catch (err) {
    console.error('checkAlerts error:', err);
  }
}

// GET /api/alerts
router.get('/', authenticate, (req, res) => {
  try {
    const alerts = db.prepare('SELECT * FROM alerts WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC').all(req.user.id);
    return res.json({ success: true, data: alerts });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/alerts
router.post(
  '/',
  authenticate,
  [
    body('fuel_type')
      .isIn(['unleaded', 'premium', 'diesel', 'e10'])
      .withMessage('fuel_type must be unleaded, premium, diesel, or e10'),
    body('target_price').isFloat({ min: 0.01 }).withMessage('target_price must be a positive number'),
  ],
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: errors.array()[0].msg });
      }

      const { fuel_type, target_price, city, station_id } = req.body;

      if (!city && !station_id) {
        return res.status(400).json({ success: false, error: 'Either city or station_id is required' });
      }

      const result = db
        .prepare(
          'INSERT INTO alerts (user_id, station_id, city, fuel_type, target_price) VALUES (?, ?, ?, ?, ?)'
        )
        .run(req.user.id, station_id || null, city || null, fuel_type, target_price);

      const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(result.lastInsertRowid);
      return res.status(201).json({ success: true, data: alert });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// DELETE /api/alerts/:id
router.delete('/:id', authenticate, (req, res) => {
  try {
    const alert = db.prepare('SELECT * FROM alerts WHERE id = ?').get(req.params.id);
    if (!alert) {
      return res.status(404).json({ success: false, error: 'Alert not found' });
    }
    if (alert.user_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    db.prepare('UPDATE alerts SET is_active = 0 WHERE id = ?').run(req.params.id);
    return res.json({ success: true, data: { message: 'Alert deleted' } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// GET /api/alerts/notifications
router.get('/notifications', authenticate, (req, res) => {
  try {
    const notifications = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC')
      .all(req.user.id);
    return res.json({ success: true, data: notifications });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// PATCH /api/alerts/notifications/:id/read
router.patch('/notifications/:id/read', authenticate, (req, res) => {
  try {
    const notif = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
    if (!notif) {
      return res.status(404).json({ success: false, error: 'Notification not found' });
    }
    if (notif.user_id !== req.user.id) {
      return res.status(403).json({ success: false, error: 'Not authorized' });
    }
    db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
    const updated = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
    return res.json({ success: true, data: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/alerts/check
router.post('/check', authenticate, (req, res) => {
  try {
    checkAlerts(db);
    return res.json({ success: true, data: { message: 'Alert check complete' } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.checkAlerts = checkAlerts;
