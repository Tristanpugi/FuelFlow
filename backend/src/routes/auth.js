const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const db = require('../database');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    body('role').optional().isIn(['user', 'partner']).withMessage('Role must be user or partner'),
  ],
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: errors.array()[0].msg });
      }

      const { name, email, password, role = 'user' } = req.body;

      const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
      if (existing) {
        return res.status(409).json({ success: false, error: 'Email already registered' });
      }

      const password_hash = bcrypt.hashSync(password, 10);
      const result = db.prepare(
        'INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)'
      ).run(email, password_hash, name, role);

      const user = { id: result.lastInsertRowid, email, name, role };
      const token = jwt.sign({ id: user.id, email, name, role }, JWT_SECRET, { expiresIn: '7d' });

      return res.status(201).json({ success: true, data: { token, user } });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ success: false, error: errors.array()[0].msg });
      }

      const { email, password } = req.body;
      const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
      if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
      }

      const valid = bcrypt.compareSync(password, user.password_hash);
      if (!valid) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' });
      }

      const payload = { id: user.id, email: user.email, name: user.name, role: user.role };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' });

      return res.json({
        success: true,
        data: {
          token,
          user: { id: user.id, email: user.email, name: user.name, role: user.role },
        },
      });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  }
);

module.exports = router;
