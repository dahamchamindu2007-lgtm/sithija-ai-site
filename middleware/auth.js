const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config');

// Verifies the Bearer token sent by the frontend and attaches req.user
async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, config.jwtSecret);
    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ success: false, error: 'User not found' });
    }
    // Banned accounts keep a valid token but are blocked everywhere
    // requireAuth guards — chat, conversations, notifications, etc.
    if (user.isBanned) {
      return res.status(403).json({ success: false, banned: true, error: user.banReason || 'Your account has been banned.' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

// Must be used AFTER requireAuth
function requireOwner(req, res, next) {
  if (!req.user || !req.user.isOwner) {
    return res.status(403).json({ success: false, error: 'Owner access only' });
  }
  next();
}

module.exports = { requireAuth, requireOwner };
