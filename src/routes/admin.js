const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../middleware/auth');
const adminMiddleware = require('../middleware/admin');
const pool = require('../config/db');
const WhatsAppManager = require('../services/WhatsAppManager');
const SmsService = require('../services/SmsService');
const { getAppUrl } = require('../utils/appUrl');
const WalletService = require('../services/WalletService');
const FlutterwaveService = require('../services/FlutterwaveService');
const { normalizePhone } = require('../utils/phone');

const router = express.Router();

router.use(authMiddleware, adminMiddleware);
router.use('/gateways', require('./adminGateways'));

router.get('/users', async (req, res) => {
  const { plan, status, search } = req.query;
  let sql = `
    SELECT u.*,
      (SELECT COUNT(*) FROM wa_sessions ws WHERE ws.user_id = u.id AND ws.status = 'connected') as wa_connected,
      (SELECT ws.status FROM wa_sessions ws WHERE ws.user_id = u.id ORDER BY ws.status = 'connected' DESC, ws.id ASC LIMIT 1) as wa_status,
      (SELECT ws.phone_number FROM wa_sessions ws WHERE ws.user_id = u.id AND ws.status = 'connected' ORDER BY ws.id ASC LIMIT 1) as wa_phone
    FROM users u
    WHERE u.role = 'user'
  `;
  const params = [];

  if (plan) { sql += ' AND u.plan = ?'; params.push(plan); }
  if (status) { sql += ' AND u.status = ?'; params.push(status); }
  if (search) {
    sql += ' AND (u.name LIKE ? OR u.email LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }

  sql += ' ORDER BY u.created_at DESC';
  const [rows] = await pool.query(sql, params);
  res.json({ success: true, users: rows });
});

router.get('/users/:id', async (req, res) => {
  const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!users.length) return res.status(404).json({ success: false, message: 'User not found' });

  const [waSession] = await pool.query('SELECT * FROM wa_sessions WHERE user_id = ?', [req.params.id]);
  const [lists] = await pool.query('SELECT * FROM contact_lists WHERE user_id = ?', [req.params.id]);
  const [campaigns] = await pool.query(
    'SELECT * FROM campaigns WHERE user_id = ? ORDER BY created_at DESC LIMIT 20',
    [req.params.id]
  );

  res.json({
    success: true,
    user: users[0],
    wa_session: waSession[0] || null,
    contact_lists: lists,
    campaigns
  });
});

router.put('/users/:id/status', [body('status').isIn(['active', 'suspended', 'pending'])], async (req, res) => {
  await pool.query('UPDATE users SET status = ? WHERE id = ? AND role = ?', [
    req.body.status, req.params.id, 'user'
  ]);
  res.json({ success: true });
});

router.put('/users/:id/plan', [body('plan').isIn(['free', 'starter', 'business', 'enterprise'])], async (req, res) => {
  const limits = { free: 50, starter: 200, business: 500, enterprise: 2000 };
  await pool.query('UPDATE users SET plan = ? WHERE id = ?', [req.body.plan, req.params.id]);
  await pool.query('UPDATE wa_sessions SET daily_limit = ? WHERE user_id = ?', [
    limits[req.body.plan] || 200, req.params.id
  ]);
  res.json({ success: true });
});

router.post('/users/:id/credits', [body('amount').isFloat({ min: 1 })], async (req, res) => {
  const balance = await WalletService.credit(req.params.id, req.body.amount, {
    type: 'topup_admin',
    description: `Manual top-up by admin`,
    createdBy: req.user.id
  });
  res.json({ success: true, message: `Added UGX ${req.body.amount} to wallet`, wallet_balance: balance });
});

router.post('/users/:id/wallet', [body('amount').isFloat({ min: 1 })], async (req, res) => {
  const balance = await WalletService.credit(req.params.id, req.body.amount, {
    type: 'topup_admin',
    description: req.body.note || 'Manual top-up by admin',
    createdBy: req.user.id
  });
  res.json({ success: true, wallet_balance: balance });
});

router.post('/reconcile-payments', async (_req, res) => {
  try {
    const result = await FlutterwaveService.reconcilePendingPayments();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/sms/provider-stats', async (_req, res) => {
  const egosms = await SmsService.getBalance();
  const { planRate, DEFAULT_RATE } = require('../utils/smsCost');

  const [[lastSend]] = await pool.query(
    `SELECT cost, currency, sent_at FROM platform_sms_log
     WHERE status = 'sent' AND cost IS NOT NULL
     ORDER BY sent_at DESC LIMIT 1`
  );

  const providerPartCost = parseFloat(process.env.SMS_PROVIDER_COST_UGX || '0') || null;

  res.json({
    success: true,
    provider: {
      name: 'Pahappa / EgoSMS',
      balance: egosms.balance,
      currency: egosms.currency || 'UGX',
      ok: egosms.success,
      message: egosms.message || (egosms.disabled ? 'SMS gateway not configured or disabled' : null),
      last_send_cost: lastSend?.cost ? parseFloat(lastSend.cost) : null,
      estimated_part_cost: providerPartCost
    },
    user_rates: {
      free: planRate('free'),
      starter: planRate('starter'),
      business: planRate('business'),
      enterprise: planRate('enterprise'),
      default: DEFAULT_RATE
    }
  });
});

router.get('/dashboard', async (req, res) => {
  const stats = await WalletService.platformStats();
  const egosms = await SmsService.getBalance();

  const [recentTx] = await pool.query(
    `SELECT wt.*, u.name as user_name, u.email as user_email
     FROM wallet_transactions wt JOIN users u ON wt.user_id = u.id
     ORDER BY wt.created_at DESC LIMIT 20`
  );

  const [recentPayments] = await pool.query(
    `SELECT pt.*, u.name as user_name FROM payment_transactions pt
     JOIN users u ON pt.user_id = u.id ORDER BY pt.created_at DESC LIMIT 10`
  );

  const [[smsToday]] = await pool.query(
    "SELECT COUNT(*) as total FROM message_logs WHERE channel = 'sms' AND status = 'sent' AND DATE(sent_at) = CURDATE()"
  );

  res.json({
    success: true,
    stats: {
      ...stats,
      egosms_balance: egosms.balance,
      egosms_ok: egosms.success,
      egosms_message: egosms.message || null,
      sms_sent_today: smsToday.total
    },
    recent_transactions: recentTx,
    recent_payments: recentPayments
  });
});

router.get('/transactions', async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = (page - 1) * limit;

  const [rows] = await pool.query(
    `SELECT wt.*, u.name as user_name, u.email as user_email
     FROM wallet_transactions wt JOIN users u ON wt.user_id = u.id
     ORDER BY wt.created_at DESC LIMIT ? OFFSET ?`,
    [limit, offset]
  );

  res.json({ success: true, transactions: rows, pagination: { page, limit } });
});

router.get('/users/:id/sessions', async (req, res) => {
  const status = await WhatsAppManager.getStatus(req.params.id);
  res.json({ success: true, ...status });
});

router.post('/wa/send', [
  body('user_id').isInt(),
  body('phone').notEmpty(),
  body('message').notEmpty()
], async (req, res) => {
  try {
    const { user_id, phone, message } = req.body;
    await WhatsAppManager.sendWithRotation(user_id, phone, message);

    await pool.query(
      `INSERT INTO message_logs (user_id, phone, channel, message, status, sent_at)
       VALUES (?, ?, 'whatsapp', ?, 'sent', NOW())`,
      [user_id, normalizePhone(phone), message]
    );

    res.json({ success: true, message: 'Message sent on behalf of user' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/sms/send', [
  body('recipients').notEmpty(),
  body('message').notEmpty()
], async (req, res) => {
  const { recipients, message, sender_id } = req.body;
  const phones = recipients.split(/[\n,;]+/).map(p => normalizePhone(p.trim())).filter(Boolean);

  if (!phones.length) {
    return res.status(400).json({ success: false, message: 'No valid recipients' });
  }

  const result = await SmsService.sendBulk(phones, message, sender_id || 'AfrieCon');

  await pool.query(
    `INSERT INTO platform_sms_log (admin_id, recipients, message, sender_id, status, cost, currency, tracking_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id,
      phones.join(', '),
      message,
      sender_id || 'AfrieCon',
      result.success ? 'sent' : 'failed',
      result.cost || null,
      result.currency || 'UGX',
      result.tracking_code || null
    ]
  );

  res.json(result);
});

router.get('/stats', async (req, res) => {
  const [[users]] = await pool.query('SELECT COUNT(*) as total FROM users WHERE role = ?', ['user']);
  const [[activeUsers]] = await pool.query("SELECT COUNT(*) as total FROM users WHERE status = 'active'");
  const [[campaigns]] = await pool.query('SELECT COUNT(*) as total FROM campaigns');
  const [[messages]] = await pool.query("SELECT COUNT(*) as total FROM message_logs WHERE status = 'sent'");
  const [[waConnected]] = await pool.query("SELECT COUNT(*) as total FROM wa_sessions WHERE status = 'connected'");

  const [recentCampaigns] = await pool.query(
    'SELECT DATE(created_at) as date, COUNT(*) as count FROM campaigns WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at)'
  );

  res.json({
    success: true,
    stats: {
      total_users: users.total,
      active_users: activeUsers.total,
      total_campaigns: campaigns.total,
      messages_sent: messages.total,
      wa_connected: waConnected.total
    },
    recent_campaigns: recentCampaigns
  });
});

router.get('/logs', async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = (page - 1) * limit;
  const { user_id, channel, status } = req.query;

  let sql = `
    SELECT ml.*, u.name as user_name, u.email as user_email
    FROM message_logs ml
    JOIN users u ON ml.user_id = u.id
    WHERE 1=1
  `;
  const params = [];

  if (user_id) { sql += ' AND ml.user_id = ?'; params.push(user_id); }
  if (channel) { sql += ' AND ml.channel = ?'; params.push(channel); }
  if (status) { sql += ' AND ml.status = ?'; params.push(status); }

  sql += ' ORDER BY ml.created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const [logs] = await pool.query(sql, params);
  res.json({ success: true, logs, pagination: { page, limit } });
});

router.get('/platform-sms-logs', async (req, res) => {
  const [logs] = await pool.query(
    `SELECT psl.*, u.name as admin_name FROM platform_sms_log psl
     JOIN users u ON psl.admin_id = u.id
     ORDER BY psl.sent_at DESC LIMIT 100`
  );
  res.json({ success: true, logs });
});

module.exports = router;
