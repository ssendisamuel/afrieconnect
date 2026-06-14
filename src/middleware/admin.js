const pool = require('../config/db');

async function adminMiddleware(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }

  const [rows] = await pool.query('SELECT role FROM users WHERE id = ?', [req.user.id]);
  if (!rows.length || rows[0].role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Admin access required' });
  }

  next();
}

module.exports = adminMiddleware;
