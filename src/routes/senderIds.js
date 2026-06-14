const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const pool = require('../config/db');
const NotificationService = require('../services/NotificationService');

const router = express.Router();

router.get('/', authMiddleware, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM user_sender_ids WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.id]
  );
  res.json({ success: true, sender_ids: rows });
});

router.post('/', authMiddleware, [
  body('sender_id').trim().isLength({ min: 3, max: 11 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Sender ID must be 3–11 characters' });
  }

  const senderId = String(req.body.sender_id).trim().toUpperCase();
  const [existing] = await pool.query(
    'SELECT id FROM user_sender_ids WHERE user_id = ? AND sender_id = ?',
    [req.user.id, senderId]
  );
  if (existing.length) {
    return res.status(400).json({ success: false, message: 'You already requested this sender ID' });
  }

  await pool.query(
    `INSERT INTO user_sender_ids (user_id, sender_id, status) VALUES (?, ?, 'pending')`,
    [req.user.id, senderId]
  );

  res.status(201).json({ success: true, message: 'Sender ID submitted for approval' });
});

router.get('/admin/pending', authMiddleware, adminMiddleware, async (_req, res) => {
  const [rows] = await pool.query(
    `SELECT s.*, u.name as user_name, u.email as user_email
     FROM user_sender_ids s JOIN users u ON s.user_id = u.id
     WHERE s.status = 'pending' ORDER BY s.created_at ASC`
  );
  res.json({ success: true, requests: rows });
});

router.put('/admin/:id', authMiddleware, adminMiddleware, [
  body('status').isIn(['approved', 'rejected']),
  body('notes').optional().trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'Invalid status' });
  }

  const [rows] = await pool.query('SELECT * FROM user_sender_ids WHERE id = ?', [req.params.id]);
  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Request not found' });
  }

  const request = rows[0];
  await pool.query(
    `UPDATE user_sender_ids SET status = ?, notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
    [req.body.status, req.body.notes || null, req.user.id, req.params.id]
  );

  const title = req.body.status === 'approved' ? 'Sender ID approved' : 'Sender ID rejected';
  const body = req.body.status === 'approved'
    ? `Your sender ID "${request.sender_id}" is approved and ready to use.`
    : `Your sender ID "${request.sender_id}" was not approved.${req.body.notes ? ' Reason: ' + req.body.notes : ''}`;

  await NotificationService.create(request.user_id, { title, body, type: req.body.status === 'approved' ? 'success' : 'warning' });

  res.json({ success: true, message: `Sender ID ${req.body.status}` });
});

module.exports = router;
