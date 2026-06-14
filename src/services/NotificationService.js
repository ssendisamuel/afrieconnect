const pool = require('../config/db');

async function create(userId, { title, body, type = 'info' }) {
  const [result] = await pool.query(
    `INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, ?)`,
    [userId, title, body, type]
  );
  return result.insertId;
}

async function listForUser(userId, { limit = 30, unreadOnly = false } = {}) {
  let sql = 'SELECT * FROM notifications WHERE user_id = ?';
  const params = [userId];
  if (unreadOnly) sql += ' AND is_read = 0';
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function markRead(userId, id) {
  await pool.query(
    'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
    [id, userId]
  );
}

async function markAllRead(userId) {
  await pool.query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [userId]);
}

async function unreadCount(userId) {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) as total FROM notifications WHERE user_id = ? AND is_read = 0',
    [userId]
  );
  return row.total;
}

module.exports = { create, listForUser, markRead, markAllRead, unreadCount };
