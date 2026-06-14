const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../middleware/auth');
const SmsService = require('../services/SmsService');
const CampaignRunner = require('../services/CampaignRunner');
const pool = require('../config/db');
const { normalizePhone } = require('../utils/phone');
const { smsParts } = require('../utils/smsParts');
const { parseContactsFromFile, personalizeMessage } = require('../utils/csv');
const WalletService = require('../services/WalletService');
const { estimateSendCost, costFromApiResponse } = require('../utils/smsCost');

const router = express.Router();
const upload = multer({ dest: path.join(__dirname, '../../uploads') });

router.use(authMiddleware);

function parseRecipients(input) {
  if (!input) return [];

  const values = Array.isArray(input)
    ? input
    : String(input).split(/[\n,;\t]+/);

  const phones = [];
  const seen = new Set();

  for (const value of values) {
    const phone = normalizePhone(String(value).trim());
    if (phone && !seen.has(phone)) {
      seen.add(phone);
      phones.push(phone);
    }
  }

  return phones;
}

async function createSmsCampaign(userId, {
  name,
  message,
  contacts,
  scheduled_at = null,
  campaign_url = null,
  delay_seconds = 0,
  plan = 'starter'
}) {
  const estimate = estimateSendCost(message, contacts.length, plan);

  const wallet = await WalletService.getBalance(userId);
  if (wallet.balance < estimate.totalCost) {
    throw new Error(
      `Insufficient wallet balance. Need UGX ${estimate.totalCost.toLocaleString()}, you have UGX ${wallet.balance.toLocaleString()}.`
    );
  }

  const [result] = await pool.query(
    `INSERT INTO campaigns (user_id, name, message, campaign_url, channel, status, delay_seconds, total_contacts, scheduled_at)
     VALUES (?, ?, ?, ?, 'sms', 'queued', ?, ?, ?)`,
    [userId, name, message, campaign_url || null, delay_seconds, contacts.length, scheduled_at || null]
  );

  const campaignId = result.insertId;

  for (const contact of contacts) {
    await pool.query(
      `INSERT INTO message_logs (campaign_id, user_id, phone, name, channel, message, status)
       VALUES (?, ?, ?, ?, 'sms', ?, 'queued')`,
      [campaignId, userId, contact.phone, contact.name || null, message]
    );
  }

  if (!scheduled_at) {
    CampaignRunner.runCampaign(campaignId).catch(console.error);
  }

  return { campaignId, estimatedCost: estimate.totalCost, parts: estimate.parts };
}

router.get('/balance', async (req, res) => {
  try {
    const wallet = await WalletService.getBalance(req.user.id);
    const { planRate } = require('../utils/smsCost');
    const smsRate = planRate(req.user.plan);
    res.json({
      success: true,
      wallet_balance: wallet.balance,
      currency: 'UGX',
      user_credits: wallet.balance,
      sms_rate: smsRate,
      estimated_sms_parts: smsRate > 0 ? Math.floor(wallet.balance / smsRate) : 0
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/outbox', async (req, res) => {
  const tab = req.query.tab || 'bulk';
  const search = req.query.search || '';
  const from = req.query.from || '';
  const to = req.query.to || '';
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '20', 10);
  const offset = (page - 1) * limit;

  let filters = "ml.user_id = ? AND ml.channel = 'sms' AND ml.status IN ('sent','failed')";
  const params = [req.user.id];

  if (tab === 'campaign') {
    filters += ' AND ml.campaign_id IS NOT NULL';
  } else if (tab === 'scheduled') {
    filters += ' AND c.scheduled_at IS NOT NULL';
  }

  if (search) {
    filters += ' AND ml.message LIKE ?';
    params.push(`%${search}%`);
  }
  if (from) {
    filters += ' AND DATE(COALESCE(ml.sent_at, ml.created_at)) >= ?';
    params.push(from);
  }
  if (to) {
    filters += ' AND DATE(COALESCE(ml.sent_at, ml.created_at)) <= ?';
    params.push(to);
  }

  const sql = `
    SELECT
      COALESCE(ml.batch_id, CONCAT('c-', IFNULL(ml.campaign_id, ml.id))) AS group_key,
      ml.campaign_id,
      c.name AS campaign_name,
      c.scheduled_at,
      SUBSTRING(MIN(ml.message), 1, 160) AS message,
      COUNT(*) AS recipient_count,
      SUM(CASE WHEN ml.status = 'sent' THEN 1 ELSE 0 END) AS sent_count,
      SUM(CASE WHEN ml.status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(COALESCE(ml.cost, 0)) AS local_cost,
      MIN(COALESCE(ml.sent_at, ml.created_at)) AS sent_at
    FROM message_logs ml
    LEFT JOIN campaigns c ON ml.campaign_id = c.id
    WHERE ${filters}
    GROUP BY group_key, ml.campaign_id, c.name, c.scheduled_at
    ORDER BY sent_at DESC
    LIMIT ? OFFSET ?
  `;

  params.push(limit, offset);
  const [rows] = await pool.query(sql, params);

  res.json({ success: true, batches: rows, pagination: { page, limit } });
});

router.get('/outbox/export', async (req, res) => {
  const [rows] = await pool.query(
    `SELECT phone, name, message, status, cost, currency, sent_at, created_at, tracking_code
     FROM message_logs WHERE user_id = ? AND channel = 'sms' AND status IN ('sent','failed')
     ORDER BY COALESCE(sent_at, created_at) DESC LIMIT 5000`,
    [req.user.id]
  );

  const header = 'Phone,Name,Message,Status,Cost,Currency,Sent At,Tracking Code\n';
  const lines = rows.map(r => {
    const msg = `"${String(r.message || '').replace(/"/g, '""')}"`;
    return [r.phone, r.name || '', msg, r.status, r.cost || '', r.currency || 'UGX', r.sent_at || r.created_at, r.tracking_code || ''].join(',');
  });

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="sms-outbox.csv"');
  res.send(header + lines.join('\n'));
});

router.get('/scheduled', async (req, res) => {
  const status = req.query.status || 'all';
  let sql = `
    SELECT c.*, COUNT(ml.id) AS recipient_count
    FROM campaigns c
    LEFT JOIN message_logs ml ON ml.campaign_id = c.id
    WHERE c.user_id = ? AND c.channel = 'sms' AND c.scheduled_at IS NOT NULL
  `;
  const params = [req.user.id];

  if (status === 'running') {
    sql += " AND c.status IN ('queued','running','paused')";
  } else if (status === 'completed') {
    sql += " AND c.status = 'completed'";
  } else if (status === 'cancelled') {
    sql += " AND c.status = 'cancelled'";
  }

  sql += ' GROUP BY c.id ORDER BY c.scheduled_at DESC LIMIT 100';
  const [rows] = await pool.query(sql, params);
  res.json({ success: true, scheduled: rows });
});

router.get('/inbox', async (req, res) => {
  const search = req.query.search || '';
  const from = req.query.from || '';
  const to = req.query.to || '';

  let sql = 'SELECT * FROM sms_inbox WHERE user_id = ?';
  const params = [req.user.id];

  if (search) {
    sql += ' AND (message LIKE ? OR phone LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (from) {
    sql += ' AND DATE(received_at) >= ?';
    params.push(from);
  }
  if (to) {
    sql += ' AND DATE(received_at) <= ?';
    params.push(to);
  }

  sql += ' ORDER BY received_at DESC LIMIT 100';
  const [rows] = await pool.query(sql, params);
  res.json({ success: true, messages: rows });
});

router.post('/send', [
  body('message').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const {
    phone, phones, recipients, message, sender_id,
    run_as_campaign, scheduled_at, campaign_name, campaign_url
  } = req.body;

  const recipientList = phones?.length
    ? parseRecipients(phones)
    : recipients
      ? parseRecipients(recipients)
      : phone
        ? parseRecipients([phone])
        : [];

  if (!recipientList.length) {
    return res.status(400).json({ success: false, message: 'Enter at least one valid phone number' });
  }

  const estimate = estimateSendCost(message, recipientList.length, req.user.plan);
  const contacts = recipientList.map(p => ({ phone: p, name: null }));

  try {
    if (run_as_campaign || scheduled_at || recipientList.length > 50) {
      const result = await createSmsCampaign(req.user.id, {
        name: campaign_name || (scheduled_at ? 'Scheduled SMS' : 'Bulk SMS'),
        message,
        contacts,
        scheduled_at: scheduled_at || null,
        campaign_url: campaign_url || null,
        plan: req.user.plan
      });

      return res.json({
        success: true,
        campaign_id: result.campaignId,
        scheduled: !!scheduled_at,
        recipients: recipientList.length,
        parts: estimate.parts,
        estimated_cost: result.estimatedCost
      });
    }

    const wallet = await WalletService.getBalance(req.user.id);
    if (wallet.balance < estimate.totalCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Need UGX ${estimate.totalCost.toLocaleString()}, you have UGX ${wallet.balance.toLocaleString()}.`
      });
    }

    const apiResult = recipientList.length === 1
      ? await SmsService.sendSingle(recipientList[0], message, sender_id)
      : await SmsService.sendBulk(recipientList, message, sender_id);

    if (!apiResult.success) {
      return res.status(400).json({ success: false, message: apiResult.message });
    }

    if (apiResult.mock) {
      return res.status(503).json({ success: false, message: 'SMS provider is not configured' });
    }

    const totalCharged = apiResult.cost ? parseFloat(apiResult.cost) : estimate.totalCost;
    const unitCost = totalCharged / recipientList.length;

    await WalletService.debit(req.user.id, totalCharged, {
      type: 'sms_send',
      reference: apiResult.tracking_code || null,
      description: `SMS to ${recipientList.length} recipient(s)`,
      meta: { parts: estimate.parts, recipients: recipientList.length }
    });

    const batchId = uuidv4();

    for (const recipient of recipientList) {
      await pool.query(
        `INSERT INTO message_logs (batch_id, user_id, phone, channel, message, status, tracking_code, cost, currency, sent_at)
         VALUES (?, ?, ?, 'sms', ?, 'sent', ?, ?, ?, NOW())`,
        [batchId, req.user.id, recipient, message, apiResult.tracking_code || null, unitCost, apiResult.currency || 'UGX']
      );
    }

    const newBalance = await WalletService.getBalance(req.user.id);

    res.json({
      success: true,
      recipients: recipientList.length,
      parts: estimate.parts,
      amount_charged: totalCharged,
      wallet_balance: newBalance.balance,
      batch_id: batchId,
      ...apiResult
    });
  } catch (err) {
    res.status(err.message.includes('Insufficient') ? 400 : 500).json({ success: false, message: err.message });
  }
});

router.post('/custom-send', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Upload a contact file (.xlsx or .csv)' });
  }

  const { message, sender_id, campaign_name, campaign_url, scheduled_at, run_as_campaign } = req.body;
  if (!message?.trim()) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ success: false, message: 'Message is required' });
  }

  try {
    const parsed = parseContactsFromFile(req.file.path, req.file.originalname);
    fs.unlink(req.file.path, () => {});

    if (!parsed.contacts.length) {
      return res.status(400).json({
        success: false,
        message: parsed.reason === 'invalid_phones'
          ? 'No valid phone numbers found in file'
          : 'File is empty or has no usable rows'
      });
    }

    const estimate = estimateSendCost(message.trim(), parsed.contacts.length, req.user.plan);

    const wallet = await WalletService.getBalance(req.user.id);
    if (wallet.balance < estimate.totalCost) {
      return res.status(400).json({
        success: false,
        message: `Insufficient wallet balance. Need UGX ${estimate.totalCost.toLocaleString()}, you have UGX ${wallet.balance.toLocaleString()}.`
      });
    }

    if (run_as_campaign === 'true' || scheduled_at || parsed.contacts.length > 50) {
      const result = await createSmsCampaign(req.user.id, {
        name: campaign_name || 'Custom SMS',
        message: message.trim(),
        contacts: parsed.contacts,
        scheduled_at: scheduled_at || null,
        campaign_url: campaign_url || null,
        plan: req.user.plan
      });

      return res.json({
        success: true,
        campaign_id: result.campaignId,
        recipients: parsed.contacts.length,
        parts: estimate.parts,
        estimated_cost: result.estimatedCost,
        scheduled: !!scheduled_at
      });
    }

    let totalCharged = 0;
    for (const contact of parsed.contacts) {
      const personalized = personalizeMessage(message.trim(), contact, { campaignLink: campaign_url || '' });
      const contactEstimate = estimateSendCost(personalized, 1, req.user.plan);
      const result = await SmsService.sendSingle(contact.phone, personalized, sender_id);

      if (!result.success) {
        return res.status(400).json({ success: false, message: result.message });
      }

      const charge = costFromApiResponse(result, contactEstimate.parts, req.user.plan);
      totalCharged += charge;

      await WalletService.debit(req.user.id, charge, {
        type: 'sms_send',
        reference: result.tracking_code || null,
        description: `Custom SMS to ${contact.phone}`,
        meta: { phone: contact.phone, parts: contactEstimate.parts }
      });

      await pool.query(
        `INSERT INTO message_logs (user_id, phone, name, channel, message, status, tracking_code, cost, currency, sent_at)
         VALUES (?, ?, ?, 'sms', ?, 'sent', ?, ?, ?, NOW())`,
        [req.user.id, contact.phone, contact.name, personalized, result.tracking_code, charge, result.currency || 'UGX']
      );
    }

    const newBalance = await WalletService.getBalance(req.user.id);
    res.json({
      success: true,
      recipients: parsed.contacts.length,
      parts: estimate.parts,
      amount_charged: totalCharged,
      wallet_balance: newBalance.balance
    });
  } catch (err) {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/bulk-send', [
  body('phones').isArray({ min: 1 }),
  body('message').notEmpty()
], async (req, res) => {
  const { phones, message, scheduled_at, campaign_name } = req.body;
  const normalized = parseRecipients(phones).map(phone => ({ phone, name: null }));

  try {
    const result = await createSmsCampaign(req.user.id, {
      name: campaign_name || 'Bulk SMS',
      message,
      contacts: normalized,
      scheduled_at: scheduled_at || null,
      plan: req.user.plan
    });

    res.json({
      success: true,
      campaign_id: result.campaignId,
      estimated_cost: result.estimatedCost,
      parts: result.parts,
      scheduled: !!scheduled_at
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/scheduled/:id/cancel', async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, status FROM campaigns WHERE id = ? AND user_id = ? AND channel = \'sms\'',
    [req.params.id, req.user.id]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Scheduled message not found' });
  }

  if (rows[0].status === 'completed') {
    return res.status(400).json({ success: false, message: 'Cannot cancel a completed schedule' });
  }

  CampaignRunner.stopCampaign(req.params.id);
  await pool.query("UPDATE campaigns SET status = 'cancelled' WHERE id = ?", [req.params.id]);
  res.json({ success: true, message: 'Scheduled SMS cancelled' });
});

module.exports = router;
