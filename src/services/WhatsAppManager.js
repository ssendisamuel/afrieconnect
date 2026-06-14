const path = require('path');
const fs = require('fs');
const pino = require('pino');
const {
  default: makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');
const pool = require('../config/db');
const { buildWhatsAppContent } = require('../utils/waMedia');
const { toWhatsAppJid } = require('../utils/phone');

const SESSIONS_PATH = process.env.SESSIONS_PATH || './wa_sessions';
const PLAN_LIMITS = { free: 50, starter: 200, business: 500, enterprise: 2000 };
const HOURLY_CAP = 30;
const MIN_DELAY_MS = 8000;

class WhatsAppManager {
  constructor() {
    this.sessions = new Map();
    this.qrCodes = new Map();
    this.roundRobin = new Map();
    this.io = null;
  }

  setIO(io) {
    this.io = io;
  }

  sessionKey(sessionId) {
    return String(sessionId);
  }

  emit(userId, event, data) {
    if (this.io) {
      this.io.to(String(userId)).emit(event, data);
    }
  }

  emitPendingQrs(userId) {
    for (const [sessionId, qr] of this.qrCodes.entries()) {
      if (String(qr.userId) === String(userId)) {
        this.emit(userId, 'wa:qr', { sessionId: Number(sessionId), qr: qr.data });
      }
    }
  }

  getSessionDir(userId, sessionId) {
    return path.join(SESSIONS_PATH, String(userId), String(sessionId));
  }

  async getDailyLimit(userId) {
    const [users] = await pool.query('SELECT plan FROM users WHERE id = ?', [userId]);
    return PLAN_LIMITS[users[0]?.plan || 'free'] || 200;
  }

  async listSenders(userId) {
    const [rows] = await pool.query(
      'SELECT * FROM wa_sessions WHERE user_id = ? ORDER BY created_at ASC',
      [userId]
    );

    return rows.map(row => {
      const live = this.sessions.get(this.sessionKey(row.id));
      return {
        id: row.id,
        sender_name: row.sender_name,
        phone_number: live?.phone || row.phone_number,
        display_name: live?.name || row.display_name,
        status: live?.status || row.status,
        messages_sent: row.messages_sent,
        daily_limit: row.daily_limit,
        connected_at: row.connected_at,
        last_active: row.last_active
      };
    });
  }

  async addSender(userId, senderName) {
    const dailyLimit = await this.getDailyLimit(userId);
    const [result] = await pool.query(
      `INSERT INTO wa_sessions (user_id, sender_name, status, daily_limit)
       VALUES (?, ?, 'pending_qr', ?)`,
      [userId, senderName, dailyLimit]
    );
    return { id: result.insertId, sender_name: senderName, status: 'pending_qr' };
  }

  async restoreSessions() {
    const [rows] = await pool.query(
      "SELECT id, user_id FROM wa_sessions WHERE status IN ('connected', 'connecting')"
    );

    for (const row of rows) {
      try {
        await this.createSession(row.user_id, row.id, false);
        console.log(`[WhatsAppManager] Restored sender ${row.id} for user ${row.user_id}`);
      } catch (err) {
        console.error(`[WhatsAppManager] Restore failed sender ${row.id}:`, err.message);
      }
    }
  }

  async createSession(userId, sessionId, emitQr = true) {
    userId = Number(userId);
    sessionId = Number(sessionId);
    const key = this.sessionKey(sessionId);

    const [rows] = await pool.query(
      'SELECT * FROM wa_sessions WHERE id = ? AND user_id = ?',
      [sessionId, userId]
    );
    if (!rows.length) throw new Error('Sender not found');

    if (this.sessions.has(key)) {
      const existing = this.sessions.get(key);
      if (existing.status === 'connected') {
        return { sessionId, status: 'connected', phone: existing.phone, name: existing.name };
      }
      if (existing.status === 'connecting' && this.qrCodes.has(key)) {
        const cached = this.qrCodes.get(key);
        if (emitQr && cached?.data) {
          this.emit(userId, 'wa:qr', { sessionId, qr: cached.data });
        }
        return { sessionId, status: 'connecting', qr: cached?.data || null };
      }
    }

    const sessionDir = this.getSessionDir(userId, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    await pool.query(
      "UPDATE wa_sessions SET status = 'connecting', last_active = NOW() WHERE id = ?",
      [sessionId]
    );

    this.emit(userId, 'wa:status', { sessionId, status: 'connecting' });

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false
    });

    const sessionData = {
      sock,
      status: 'connecting',
      phone: null,
      name: null,
      userId,
      sessionId
    };
    this.sessions.set(key, sessionData);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        this.qrCodes.set(key, { data: qr, userId, at: Date.now() });
        if (emitQr) {
          this.emit(userId, 'wa:qr', { sessionId, qr });
        }
      }

      if (connection === 'open') {
        const me = sock.user;
        const phone = me?.id?.split(':')[0]?.split('@')[0] || null;
        const name = me?.name || me?.verifiedName || rows[0].sender_name || 'WhatsApp User';

        sessionData.status = 'connected';
        sessionData.phone = phone;
        sessionData.name = name;
        this.qrCodes.delete(key);

        await pool.query(
          `UPDATE wa_sessions SET status = 'connected', phone_number = ?, display_name = ?,
           connected_at = NOW(), last_active = NOW() WHERE id = ?`,
          [phone, name, sessionId]
        );

        this.emit(userId, 'wa:connected', { sessionId, phone, name });
        this.emit(userId, 'wa:status', { sessionId, status: 'connected', phone, name });
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        const banned = loggedOut;

        sessionData.status = banned ? 'banned' : 'pending_qr';
        this.sessions.delete(key);
        this.qrCodes.delete(key);

        await pool.query(
          `UPDATE wa_sessions SET status = ?, last_active = NOW() WHERE id = ?`,
          [banned ? 'banned' : 'pending_qr', sessionId]
        );

        this.emit(userId, 'wa:disconnected', {
          sessionId,
          reason: banned ? 'logged_out' : 'connection_closed'
        });
        this.emit(userId, 'wa:status', { sessionId, status: banned ? 'banned' : 'pending_qr' });

        if (!loggedOut && statusCode !== DisconnectReason.loggedOut) {
          setTimeout(() => this.createSession(userId, sessionId, false), 8000);
        }
      }
    });

    return { sessionId, status: 'connecting' };
  }

  getQr(sessionId) {
    const cached = this.qrCodes.get(this.sessionKey(sessionId));
    return cached?.data || null;
  }

  async pairSender(userId, sessionId) {
    return this.createSession(userId, sessionId, true);
  }

  async deleteSender(userId, sessionId) {
    userId = Number(userId);
    sessionId = Number(sessionId);
    const key = this.sessionKey(sessionId);

    const session = this.sessions.get(key);
    if (session?.sock) {
      try {
        await session.sock.logout();
      } catch (_) {
        try { session.sock.end(undefined); } catch (__) { /* ignore */ }
      }
    }

    this.sessions.delete(key);
    this.qrCodes.delete(key);

    const sessionDir = this.getSessionDir(userId, sessionId);
    if (fs.existsSync(sessionDir)) {
      fs.rmSync(sessionDir, { recursive: true, force: true });
    }

    await pool.query('DELETE FROM wa_sessions WHERE id = ? AND user_id = ?', [sessionId, userId]);
    this.emit(userId, 'wa:status', { sessionId, status: 'deleted' });

    return { success: true };
  }

  async getConnectedSenders(userId, sessionIds = null) {
    const senders = await this.listSenders(userId);
    let connected = senders.filter(s => s.status === 'connected');

    if (sessionIds?.length) {
      const ids = sessionIds.map(Number);
      connected = connected.filter(s => ids.includes(s.id));
    }

    return connected;
  }

  pickSender(userId, sessionIds = null) {
    const key = `${userId}:${(sessionIds || []).join(',')}`;
    return async () => {
      const connected = await this.getConnectedSenders(userId, sessionIds);
      if (!connected.length) throw new Error('No connected WhatsApp senders');

      const idx = this.roundRobin.get(key) || 0;
      const sender = connected[idx % connected.length];
      this.roundRobin.set(key, idx + 1);
      return sender;
    };
  }

  async checkSenderLimits(sessionId) {
    const [rows] = await pool.query(
      'SELECT messages_sent, daily_limit, user_id FROM wa_sessions WHERE id = ?',
      [sessionId]
    );
    if (!rows.length) throw new Error('Sender not found');

    if (rows[0].messages_sent >= rows[0].daily_limit) {
      throw new Error(`Daily limit reached for this sender (${rows[0].daily_limit})`);
    }

    const [hourly] = await pool.query(
      `SELECT COUNT(*) as count FROM message_logs
       WHERE channel = 'whatsapp' AND status = 'sent'
       AND wa_session_id = ? AND sent_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
      [sessionId]
    );

    if (hourly[0].count >= HOURLY_CAP) {
      throw new Error('Hourly send cap reached for this sender — pausing to protect your number');
    }

    return rows[0];
  }

  async incrementMessageCount(sessionId) {
    await pool.query(
      'UPDATE wa_sessions SET messages_sent = messages_sent + 1, last_active = NOW() WHERE id = ?',
      [sessionId]
    );
  }

  async sendMessage(userId, phone, message, sessionId = null, media = null) {
    userId = Number(userId);

    let sender;
    if (sessionId) {
      sender = (await this.getConnectedSenders(userId, [sessionId]))[0];
    } else {
      sender = (await this.pickSender(userId)());
    }

    if (!sender) throw new Error('WhatsApp not connected');

    const key = this.sessionKey(sender.id);
    const session = this.sessions.get(key);

    if (!session || session.status !== 'connected') {
      throw new Error('Selected sender is not connected');
    }

    await this.checkSenderLimits(sender.id);

    const jitter = Math.floor(Math.random() * 3000);
    await new Promise(r => setTimeout(r, jitter));

    const jid = toWhatsAppJid(phone);
    const content = buildWhatsAppContent(message, media);
    await session.sock.sendMessage(jid, content);
    await this.incrementMessageCount(sender.id);

    return { success: true, jid, sender_id: sender.id, sender_phone: sender.phone_number };
  }

  async sendWithRotation(userId, phone, message, sessionIds = null, media = null) {
    const pick = this.pickSender(userId, sessionIds);
    let lastError;

    const connected = await this.getConnectedSenders(userId, sessionIds);
    for (let attempt = 0; attempt < connected.length; attempt++) {
      try {
        const sender = await pick();
        return await this.sendMessage(userId, phone, message, sender.id, media);
      } catch (err) {
        lastError = err;
        if (!err.message.includes('Daily limit')) throw err;
      }
    }

    throw lastError || new Error('All senders at daily limit');
  }

  getAntiBanDelay(baseSeconds) {
    const base = Math.max(baseSeconds || 8, 8);
    const jitter = Math.floor(Math.random() * 5);
    return (base + jitter) * 1000;
  }

  async resetDailyCounters() {
    await pool.query('UPDATE wa_sessions SET messages_sent = 0');
    console.log('[WhatsAppManager] Daily message counters reset');
  }

  async getStatus(userId) {
    const senders = await this.listSenders(userId);
    const connected = senders.filter(s => s.status === 'connected');
    return {
      senders,
      connected_count: connected.length,
      status: connected.length ? 'connected' : (senders.some(s => s.status === 'connecting') ? 'connecting' : 'disconnected')
    };
  }
}

module.exports = new WhatsAppManager();
