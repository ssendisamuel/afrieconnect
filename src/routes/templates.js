const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../middleware/auth');
const pool = require('../config/db');

const router = express.Router();

router.use(authMiddleware);

router.get('/', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM templates WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json({ success: true, templates: rows });
});

router.post('/', [
  body('name').trim().notEmpty(),
  body('message').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { name, message, channel } = req.body;
  const [result] = await pool.query(
    'INSERT INTO templates (user_id, name, message, channel) VALUES (?, ?, ?, ?)',
    [req.user.id, name, message, channel || 'both']
  );

  res.status(201).json({ success: true, id: result.insertId });
});

router.put('/:id', async (req, res) => {
  const { name, message, channel } = req.body;
  await pool.query(
    'UPDATE templates SET name = COALESCE(?, name), message = COALESCE(?, message), channel = COALESCE(?, channel) WHERE id = ? AND user_id = ?',
    [name, message, channel, req.params.id, req.user.id]
  );
  res.json({ success: true });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM templates WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

module.exports = router;
