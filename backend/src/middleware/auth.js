const jwt = require('jsonwebtoken');
const db = require('../database');

const JWT_SECRET = process.env.JWT_SECRET || 'fuelflow-secret-key-change-in-production';

if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  console.error('FATAL: JWT_SECRET environment variable must be set in production.');
  process.exit(1);
} else if (!process.env.JWT_SECRET) {
  console.warn('WARNING: JWT_SECRET is not set. Using insecure default. Set JWT_SECRET before deploying to production.');
}

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email, name, role, reputation FROM users WHERE id = ?').get(decoded.id);
    if (!user) return res.status(401).json({ success: false, error: 'User not found' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid token' });
  }
};

const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT id, email, name, role, reputation FROM users WHERE id = ?').get(decoded.id);
    req.user = user || null;
  } catch (err) {
    req.user = null;
  }
  next();
};

const requireRole = (roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ success: false, error: 'Insufficient permissions' });
  next();
};

module.exports = { authenticate, optionalAuth, requireRole, JWT_SECRET };
