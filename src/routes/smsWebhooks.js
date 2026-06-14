const express = require('express');
const pool = require('../config/db');
const { normalizePhone } = require('../utils/phone');
const GatewayConfigService = require('../services/GatewayConfigService');

const router = express.Router();

function verifyWebhookSecret(req) {
  const secret = process.env.SMS_WEBHOOK_SECRET;
  if (!secret) return true;
  const provided = req.query.secret || req.headers['x-sms-webhook-secret'];
  return provided === secret;
}

function pickField(body, keys) {
  for (const key of keys) {
    if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
      return body[key];
    }
  }
  return null;
}

router.post('/dlr', async (req, res) => {
  if (!verifyWebhookSecret(req)) {
    return res.status(401).json({ success: false, message: 'Invalid webhook secret' });
  }

  try {
    const body = { ...req.body, ...(req.query || {}) };
    const trackingCode = pickField(body, [
      'MsgFollowUpUniqueCode', 'msgFollowUpUniqueCode', 'tracking_code', 'messageId', 'message_id'
    ]);
    const phone = normalizePhone(pickField(body, ['number', 'phone', 'msisdn', 'recipient']) || '');
    const rawStatus = String(pickField(body, ['status', 'Status', 'delivery_status']) || '').toLowerCase();

    let status = 'sent';
    if (/deliver|success|ok/.test(rawStatus)) status = 'delivered';
    else if (/fail|reject|undeliver|expir/.test(rawStatus)) status = 'failed';

    let affected = 0;
    if (trackingCode) {
      const [result] = await pool.query(
        `UPDATE message_logs SET status = ?
         WHERE tracking_code = ? AND channel = 'sms' AND status IN ('sent','queued','delivered')`,
        [status, trackingCode]
      );
      affected = result.affectedRows;
    } else if (phone) {
      const [result] = await pool.query(
        `UPDATE message_logs SET status = ?
         WHERE phone = ? AND channel = 'sms' AND status = 'sent'
         ORDER BY sent_at DESC LIMIT 1`,
        [status, phone]
      );
      affected = result.affectedRows;
    }

    res.json({ success: true, updated: affected, status });
  } catch (err) {
    console.error('[SMS Webhook] DLR error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/inbound', async (req, res) => {
  if (!verifyWebhookSecret(req)) {
    return res.status(401).json({ success: false, message: 'Invalid webhook secret' });
  }

  try {
    const body = { ...req.body, ...(req.query || {}) };
    const phone = normalizePhone(pickField(body, ['number', 'phone', 'from', 'sender', 'msisdn']) || '');
    const message = pickField(body, ['message', 'Message', 'text', 'body', 'content']);
    const senderId = pickField(body, ['senderid', 'sender_id', 'to', 'shortcode']);

    if (!phone || !message) {
      return res.status(400).json({ success: false, message: 'phone and message required' });
    }

    let userId = null;
    if (senderId) {
      const [rows] = await pool.query(
        `SELECT user_id FROM user_sender_ids
         WHERE sender_id = ? AND status = 'approved' LIMIT 1`,
        [String(senderId).slice(0, 11)]
      );
      if (rows.length) userId = rows[0].user_id;
    }

    if (!userId) {
      const smsConfig = GatewayConfigService.getSmsConfigSync();
      const defaultSender = smsConfig?.sender_id;
      if (defaultSender) {
        const [rows] = await pool.query(
          `SELECT user_id FROM user_sender_ids
           WHERE sender_id = ? AND status = 'approved' LIMIT 1`,
          [defaultSender]
        );
        if (rows.length) userId = rows[0].user_id;
      }
    }

    if (!userId) {
      const [[admin]] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active' LIMIT 1");
      userId = admin?.id || null;
    }

    if (!userId) {
      return res.status(422).json({ success: false, message: 'No user mapped for inbound SMS' });
    }

    await pool.query(
      `INSERT INTO sms_inbox (user_id, phone, message, received_at, is_read)
       VALUES (?, ?, ?, NOW(), 0)`,
      [userId, phone, message]
    );

    res.json({ success: true, message: 'Inbound SMS stored' });
  } catch (err) {
    console.error('[SMS Webhook] Inbound error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/dlr', (req, res) => {
  res.json({ success: true, service: 'AfrieConnect SMS DLR webhook', method: 'POST recommended' });
});

router.get('/inbound', (req, res) => {
  res.json({ success: true, service: 'AfrieConnect SMS inbound webhook', method: 'POST recommended' });
});

module.exports = router;
