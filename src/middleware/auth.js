const { verifyToken } = require('../utils/token');
const pool = require('../config/db');

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  try {
    const token = header.slice(7);
    const decoded = verifyToken(token);
    const [rows] = await pool.query(
      'SELECT id, name, email, phone, role, status, email_verified, api_key, sms_credits, wallet_balance, plan FROM users WHERE id = ?',
      [decoded.id]
    );

    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'User not found' });
    }

    if (rows[0].status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Account suspended' });
    }

    req.user = rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token' });
  }
}

async function apiKeyMiddleware(req, res, next) {
  const headerKey = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7)
    : null;
  const apiKey = req.headers['x-api-key'] || headerKey;

  if (!apiKey) {
    return res.status(401).json({ success: false, message: 'API key required (Authorization: Bearer YOUR_KEY or X-API-Key)' });
  }

  const [rows] = await pool.query(
    'SELECT id, name, email, phone, role, status, api_key, sms_credits, wallet_balance, plan FROM users WHERE api_key = ? AND status = ?',
    [apiKey, 'active']
  );

  if (!rows.length) {
    return res.status(401).json({ success: false, message: 'Invalid API key' });
  }

  req.user = rows[0];
  next();
}

module.exports = { authMiddleware, apiKeyMiddleware };
