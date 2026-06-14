const express = require('express');
const QRCode = require('qrcode');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../middleware/auth');
const WhatsAppManager = require('../services/WhatsAppManager');
const pool = require('../config/db');
const { parsePhoneLines } = require('../utils/csv');
const { normalizePhone } = require('../utils/phone');
const mediaUpload = require('../middleware/mediaUpload');
const path = require('path');

const router = express.Router();

router.use(authMiddleware);

router.get('/senders', async (req, res) => {
  try {
    const senders = await WhatsAppManager.listSenders(req.user.id);
    const connected = senders.filter(s => s.status === 'connected').length;
    res.json({ success: true, senders, connected_count: connected });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/senders', [
  body('sender_name').trim().notEmpty().isLength({ max: 100 })
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const sender = await WhatsAppManager.addSender(req.user.id, req.body.sender_name);
    res.status(201).json({ success: true, sender });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/senders/:id/pair', async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    const fresh = req.body?.fresh !== false;
    const result = await WhatsAppManager.pairSender(req.user.id, sessionId, { fresh });

    let qrImage = null;
    let qr = WhatsAppManager.getQr(sessionId);
    if (!qr) {
      await new Promise(r => setTimeout(r, 2000));
      qr = WhatsAppManager.getQr(sessionId);
    }
    if (qr) {
      qrImage = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
    }

    res.json({ success: true, ...result, qr, qr_image: qrImage });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/senders/:id/repair', async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    const result = await WhatsAppManager.pairSender(req.user.id, sessionId, { fresh: true });

    let qrImage = null;
    let qr = WhatsAppManager.getQr(sessionId);
    if (!qr) {
      await new Promise(r => setTimeout(r, 2000));
      qr = WhatsAppManager.getQr(sessionId);
    }
    if (qr) {
      qrImage = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
    }

    res.json({ success: true, ...result, qr, qr_image: qrImage, repaired: true });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/senders/:id/qr', async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    let qr = WhatsAppManager.getQr(sessionId);

    if (!qr) {
      await WhatsAppManager.pairSender(req.user.id, sessionId, { fresh: false });
      await new Promise(r => setTimeout(r, 2000));
      qr = WhatsAppManager.getQr(sessionId);
    }

    if (!qr) {
      return res.json({ success: true, qr: null, message: 'QR not ready yet' });
    }

    const qr_image = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
    res.json({ success: true, qr, qr_image });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete('/senders/:id', async (req, res) => {
  try {
    await WhatsAppManager.deleteSender(req.user.id, Number(req.params.id));
    res.json({ success: true, message: 'Sender removed' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/media', mediaUpload.single('media'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const ext = path.extname(req.file.originalname).toLowerCase();
    const mimetype = mediaUpload.ALLOWED[ext] || req.file.mimetype;
    const relativePath = path.join('uploads', 'wa-media', req.file.filename);

    res.json({
      success: true,
      media: {
        path: relativePath,
        filename: req.file.originalname,
        mimetype,
        size: req.file.size
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/status', async (req, res) => {
  try {
    const status = await WhatsAppManager.getStatus(req.user.id);
    res.json({ success: true, ...status });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/send', [
  body('phone').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { phone, message, sender_id, sender_ids, sender_mode, media_path, media_filename, media_mimetype } = req.body;
    if (!message?.trim() && !media_path) {
      return res.status(400).json({ success: false, message: 'Message or media is required' });
    }

    const sessionIds = sender_mode === 'selected'
      ? (sender_ids || (sender_id ? [sender_id] : []))
      : null;

    const media = media_path
      ? { path: media_path, filename: media_filename, mimetype: media_mimetype }
      : null;

    const result = await WhatsAppManager.sendWithRotation(
      req.user.id, phone, message || '', sessionIds?.length ? sessionIds : null, media
    );

    const logText = media
      ? `[${media_filename || 'Attachment'}] ${message || ''}`.trim()
      : message;

    await pool.query(
      `INSERT INTO message_logs (user_id, phone, channel, wa_session_id, message, status, sent_at)
       VALUES (?, ?, 'whatsapp', ?, ?, 'sent', NOW())`,
      [req.user.id, phone, result.sender_id, logText]
    );

    res.json({ success: true, message: 'Message sent', ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/campaign', async (req, res) => {
  try {
    const {
      name, list_id, phones, message, delay_seconds, daily_cap,
      sender_mode, sender_ids, scheduled_at, recipient_mode,
      media_path, media_filename, media_mimetype
    } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: 'Campaign title is required' });
    }
    if (!message?.trim() && !media_path) {
      return res.status(400).json({ success: false, message: 'Message or media attachment is required' });
    }

    const connected = await WhatsAppManager.getConnectedSenders(
      req.user.id,
      sender_mode === 'selected' ? sender_ids : null
    );

    if (!connected.length) {
      return res.status(400).json({ success: false, message: 'No connected senders available' });
    }

    let totalContacts = 0;
    let useListId = null;
    let directPhones = [];

    if (recipient_mode === 'numbers' || (!list_id && phones)) {
      directPhones = Array.isArray(phones)
        ? phones.map(p => normalizePhone(p)).filter(p => p.length >= 10)
        : parsePhoneLines(String(phones || ''));

      if (!directPhones.length) {
        return res.status(400).json({ success: false, message: 'No valid phone numbers provided' });
      }
      totalContacts = directPhones.length;
    } else if (list_id) {
      const [list] = await pool.query(
        'SELECT contact_count FROM contact_lists WHERE id = ? AND user_id = ?',
        [list_id, req.user.id]
      );
      if (!list.length) {
        return res.status(404).json({ success: false, message: 'Contact list not found' });
      }
      totalContacts = list[0].contact_count;
      useListId = list_id;
      if (!totalContacts) {
        return res.status(400).json({ success: false, message: 'Contact list is empty' });
      }
    } else {
      return res.status(400).json({ success: false, message: 'Select a contact list or enter phone numbers' });
    }

    const delay = Math.max(parseInt(delay_seconds || 8, 10), 8);
    const perSenderDaily = connected.reduce((sum, s) => sum + (s.daily_limit || 200), 0);
    const hourlyCapacity = connected.length * 30;

    const [result] = await pool.query(
      `INSERT INTO campaigns (user_id, list_id, name, message, media_path, media_filename, media_mimetype,
       channel, sender_mode, sender_ids, delay_seconds, daily_cap, scheduled_at, total_contacts, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'whatsapp', ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        useListId,
        name.trim(),
        (message || '').trim(),
        media_path || null,
        media_filename || null,
        media_mimetype || null,
        sender_mode || 'all',
        sender_ids ? JSON.stringify(sender_ids) : null,
        delay,
        daily_cap || 200,
        scheduled_at || null,
        totalContacts,
        scheduled_at ? 'queued' : 'draft'
      ]
    );

    const campaignId = result.insertId;

    if (directPhones.length) {
      for (const phone of directPhones) {
        await pool.query(
          `INSERT INTO message_logs (campaign_id, user_id, phone, channel, message, status)
           VALUES (?, ?, ?, 'whatsapp', ?, 'queued')`,
          [campaignId, req.user.id, phone, message.trim()]
        );
      }
    }

    res.status(201).json({
      success: true,
      id: campaignId,
      total_contacts: totalContacts,
      estimate: {
        senders: connected.length,
        delay_seconds: delay,
        hourly_capacity: hourlyCapacity,
        daily_sender_capacity: perSenderDaily,
        min_hours: Math.ceil(totalContacts / hourlyCapacity),
        min_days: Math.ceil(totalContacts / (daily_cap || 200))
      }
    });
  } catch (err) {
    console.error('[WA Campaign] Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/outbox', async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = (page - 1) * limit;

  const [logs] = await pool.query(
    `SELECT ml.*, ws.sender_name, ws.phone_number as sender_phone
     FROM message_logs ml
     LEFT JOIN wa_sessions ws ON ml.wa_session_id = ws.id
     WHERE ml.user_id = ? AND ml.channel = 'whatsapp'
     AND NOT (
       ml.status = 'queued'
       AND ml.campaign_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM message_logs ml2
         WHERE ml2.campaign_id = ml.campaign_id
           AND ml2.phone = ml.phone
           AND ml2.status = 'sent'
       )
     )
     ORDER BY COALESCE(ml.sent_at, ml.created_at) DESC LIMIT ? OFFSET ?`,
    [req.user.id, limit, offset]
  );

  const [count] = await pool.query(
    `SELECT COUNT(*) as total FROM message_logs ml
     WHERE ml.user_id = ? AND ml.channel = 'whatsapp'
     AND NOT (
       ml.status = 'queued'
       AND ml.campaign_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM message_logs ml2
         WHERE ml2.campaign_id = ml.campaign_id
           AND ml2.phone = ml.phone
           AND ml2.status = 'sent'
       )
     )`,
    [req.user.id]
  );

  res.json({ success: true, logs, pagination: { page, limit, total: count[0].total } });
});

router.get('/reports', async (req, res) => {
  const [byDay] = await pool.query(
    `SELECT DATE(sent_at) as date, COUNT(*) as sent,
     SUM(status = 'failed') as failed
     FROM message_logs WHERE user_id = ? AND channel = 'whatsapp'
     AND sent_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
     GROUP BY DATE(sent_at) ORDER BY date DESC`,
    [req.user.id]
  );

  const [bySender] = await pool.query(
    `SELECT ws.sender_name, ws.phone_number, COUNT(*) as sent
     FROM message_logs ml
     JOIN wa_sessions ws ON ml.wa_session_id = ws.id
     WHERE ml.user_id = ? AND ml.channel = 'whatsapp' AND ml.status = 'sent'
     GROUP BY ws.id ORDER BY sent DESC`,
    [req.user.id]
  );

  const [campaigns] = await pool.query(
    `SELECT id, name, status, sent_count, failed_count, total_contacts, created_at
     FROM campaigns WHERE user_id = ? AND channel = 'whatsapp'
     ORDER BY created_at DESC LIMIT 20`,
    [req.user.id]
  );

  res.json({ success: true, by_day: byDay, by_sender: bySender, campaigns });
});

module.exports = router;
