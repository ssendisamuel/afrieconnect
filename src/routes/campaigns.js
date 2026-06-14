const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../middleware/auth');
const pool = require('../config/db');
const CampaignRunner = require('../services/CampaignRunner');

const router = express.Router();

router.use(authMiddleware);

router.get('/', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*, cl.name as list_name FROM campaigns c
     LEFT JOIN contact_lists cl ON c.list_id = cl.id
     WHERE c.user_id = ? ORDER BY c.created_at DESC`,
    [req.user.id]
  );
  res.json({ success: true, campaigns: rows });
});

router.post('/', [
  body('name').trim().notEmpty(),
  body('message').notEmpty(),
  body('channel').isIn(['whatsapp', 'sms'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { name, list_id, message, channel, delay_seconds, daily_cap, scheduled_at } = req.body;

  const [result] = await pool.query(
    `INSERT INTO campaigns (user_id, list_id, name, message, channel, delay_seconds, daily_cap, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id,
      list_id || null,
      name,
      message,
      channel,
      delay_seconds || 6,
      daily_cap || 200,
      scheduled_at || null,
      scheduled_at ? 'queued' : 'draft'
    ]
  );

  res.status(201).json({ success: true, id: result.insertId });
});

router.post('/:id/send', async (req, res) => {
  const [campaigns] = await pool.query(
    'SELECT * FROM campaigns WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );

  if (!campaigns.length) {
    return res.status(404).json({ success: false, message: 'Campaign not found' });
  }

  if (['running'].includes(campaigns[0].status)) {
    return res.status(400).json({ success: false, message: 'Campaign already running' });
  }

  CampaignRunner.runCampaign(req.params.id).catch(err => {
    console.error('[Campaigns] Run error:', err.message);
  });

  res.json({ success: true, message: 'Campaign started' });
});

router.post('/:id/pause', async (req, res) => {
  await CampaignRunner.pauseCampaign(req.params.id);
  res.json({ success: true, message: 'Campaign paused' });
});

router.post('/:id/resume', async (req, res) => {
  await CampaignRunner.resumeCampaign(req.params.id);
  res.json({ success: true, message: 'Campaign resumed' });
});

router.get('/:id/logs', async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = (page - 1) * limit;

  const [logs] = await pool.query(
    `SELECT * FROM message_logs WHERE campaign_id = ? AND user_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [req.params.id, req.user.id, limit, offset]
  );

  const [count] = await pool.query(
    'SELECT COUNT(*) as total FROM message_logs WHERE campaign_id = ?',
    [req.params.id]
  );

  res.json({ success: true, logs, pagination: { page, limit, total: count[0].total } });
});

router.get('/:id/stats', async (req, res) => {
  const [campaign] = await pool.query(
    'SELECT sent_count, failed_count, total_contacts, status FROM campaigns WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );

  if (!campaign.length) {
    return res.status(404).json({ success: false, message: 'Campaign not found' });
  }

  const [statusCounts] = await pool.query(
    `SELECT status, COUNT(*) as count FROM message_logs WHERE campaign_id = ? GROUP BY status`,
    [req.params.id]
  );

  res.json({ success: true, campaign: campaign[0], breakdown: statusCounts });
});

router.delete('/:id', async (req, res) => {
  const [campaign] = await pool.query(
    'SELECT status FROM campaigns WHERE id = ? AND user_id = ?',
    [req.params.id, req.user.id]
  );

  if (!campaign.length) {
    return res.status(404).json({ success: false, message: 'Campaign not found' });
  }

  if (campaign[0].status === 'running') {
    CampaignRunner.stopCampaign(req.params.id);
  }

  await pool.query('DELETE FROM campaigns WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  res.json({ success: true });
});

module.exports = router;
