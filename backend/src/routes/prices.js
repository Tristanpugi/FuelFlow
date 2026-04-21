const express = require('express');
const { body, validationResult } = require('express-validator');
const db = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

// POST /api/prices
router.post(
  '/',
  authenticate,
  [
    body('station_id').isInt({ min: 1 }).withMessage('Valid station_id is required'),
    body('fuel_type')
      .isIn(['unleaded', 'premium', 'diesel', 'e10'])
      .withMessage('fuel_type must be unleaded, premium, diesel, or e10'),
    body('price').isFloat({ min: 0.01 }).withMessage('Price must be a positive number'),
  ],
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: errors.array()[0].msg });
      }

      const { station_id, fuel_type, price } = req.body;

      const station = db.prepare('SELECT id FROM stations WHERE id = ?').get(station_id);
      if (!station) {
        return res.status(404).json({ success: false, error: 'Station not found' });
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

      const { checkAlerts } = require('./alerts');
      checkAlerts(db);

      return res.status(201).json({ success: true, data: newPrice });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// GET /api/prices/history/:stationId
router.get('/history/:stationId', (req, res) => {
  try {
    db.prepare(
      "UPDATE fuel_prices SET is_outdated = 1 WHERE created_at < datetime('now', '-6 hours') AND is_outdated = 0"
    ).run();

    const rows = db
      .prepare(
        "SELECT * FROM fuel_prices WHERE station_id = ? AND created_at >= datetime('now', '-30 days') ORDER BY created_at ASC"
      )
      .all(req.params.stationId);

    const grouped = { unleaded: [], premium: [], diesel: [], e10: [] };
    for (const row of rows) {
      if (grouped[row.fuel_type]) grouped[row.fuel_type].push(row);
    }

    return res.json({ success: true, data: grouped });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// POST /api/prices/:priceId/vote
router.post(
  '/:priceId/vote',
  authenticate,
  [body('vote').isIn(['confirm', 'deny']).withMessage('Vote must be confirm or deny')],
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: errors.array()[0].msg });
      }

      const { priceId } = req.params;
      const { vote } = req.body;

      const price = db.prepare('SELECT * FROM fuel_prices WHERE id = ?').get(priceId);
      if (!price) {
        return res.status(404).json({ success: false, error: 'Price not found' });
      }

      if (price.submitted_by === req.user.id) {
        return res.status(400).json({ success: false, error: 'Cannot vote on your own submission' });
      }

      const existing = db
        .prepare('SELECT * FROM price_votes WHERE price_id = ? AND user_id = ?')
        .get(priceId, req.user.id);

      if (existing) {
        if (existing.vote === vote) {
          return res.status(400).json({ success: false, error: 'Already voted this way' });
        }
        db.prepare('UPDATE price_votes SET vote = ? WHERE id = ?').run(vote, existing.id);
      } else {
        db.prepare('INSERT INTO price_votes (price_id, user_id, vote) VALUES (?, ?, ?)').run(
          priceId,
          req.user.id,
          vote
        );
      }

      // Recalculate counts from votes table
      db.prepare(
        `UPDATE fuel_prices SET
          confirmed_count = (SELECT COUNT(*) FROM price_votes WHERE price_id = ? AND vote = 'confirm'),
          denied_count = (SELECT COUNT(*) FROM price_votes WHERE price_id = ? AND vote = 'deny'),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
      ).run(priceId, priceId, priceId);

      const updated = db.prepare('SELECT * FROM fuel_prices WHERE id = ?').get(priceId);

      if (updated.confirmed_count >= 3) {
        db.prepare('UPDATE fuel_prices SET is_verified = 1 WHERE id = ?').run(priceId);
      }
      if (updated.denied_count >= 3) {
        db.prepare('UPDATE fuel_prices SET is_outdated = 1 WHERE id = ?').run(priceId);
      }

      // Update submitter reputation
      if (price.submitted_by) {
        const repChange = vote === 'confirm' ? 1 : -1;
        db.prepare('UPDATE users SET reputation = reputation + ? WHERE id = ?').run(
          repChange,
          price.submitted_by
        );
      }

      const final = db.prepare('SELECT * FROM fuel_prices WHERE id = ?').get(priceId);
      return res.json({ success: true, data: final });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

// GET /api/prices/outdated (admin only)
router.get('/outdated', authenticate, requireRole(['admin']), (req, res) => {
  try {
    const prices = db
      .prepare(
        `SELECT fp.*, s.name as station_name, s.city FROM fuel_prices fp
         JOIN stations s ON fp.station_id = s.id
         WHERE fp.is_outdated = 1
         ORDER BY fp.updated_at DESC`
      )
      .all();
    return res.json({ success: true, data: prices });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

module.exports = router;
