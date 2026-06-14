require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const { Server } = require('socket.io');
const { verifyToken } = require('./src/utils/token');
const { getAppUrl, getWebhookUrl } = require('./src/utils/appUrl');
const { validateProductionConfig } = require('./src/utils/env');
const WhatsAppManager = require('./src/services/WhatsAppManager');
const CampaignRunner = require('./src/services/CampaignRunner');

const app = express();
const server = http.createServer(app);

if (process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

const allowedOrigins = [
  process.env.APP_URL,
  'http://localhost:3600',
  'https://afrieconnect.afriezon.com'
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST']
  }
});

WhatsAppManager.setIO(io);
CampaignRunner.setIO(io);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = allowedOrigins.some(o => origin.startsWith(o.replace(/\/$/, '')));
    if (allowed) return callback(null, true);
    if (process.env.NODE_ENV === 'production') {
      return callback(new Error('Not allowed by CORS'));
    }
    return callback(null, true);
  },
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

['wa_sessions', 'uploads', 'uploads/wa-media', 'logs'].forEach(dir => {
  const dirPath = path.join(__dirname, dir);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/sms/webhook', require('./src/routes/smsWebhooks'));
app.use('/api/v1/sms', require('./src/routes/smsApi'));
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/wa', require('./src/routes/whatsapp'));
app.use('/api/payments', require('./src/routes/payments'));
app.use('/api/wallet', require('./src/routes/wallet'));
app.use('/api/sms', require('./src/routes/sms'));
app.use('/api/contacts', require('./src/routes/contacts'));
app.use('/api/campaigns', require('./src/routes/campaigns'));
app.use('/api/templates', require('./src/routes/templates'));
app.use('/api/otp', require('./src/routes/otp'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/sender-ids', require('./src/routes/senderIds'));
app.use('/api/admin', require('./src/routes/admin'));

app.get('/api/health', (_req, res) => {
  res.json({ success: true, name: process.env.APP_NAME || 'AfrieConnect', status: 'ok' });
});

app.get('/api/dashboard/stats', require('./src/middleware/auth').authMiddleware, async (req, res) => {
  const pool = require('./src/config/db');
  const userId = req.user.id;

  try {
    const [[contacts]] = await pool.query(
      'SELECT COUNT(*) as total FROM contacts WHERE user_id = ?', [userId]
    );
    const [[messages]] = await pool.query(
      "SELECT COUNT(*) as total FROM message_logs WHERE user_id = ? AND sent_at > DATE_SUB(NOW(), INTERVAL 30 DAY) AND status = 'sent'",
      [userId]
    );
    const [[campaigns]] = await pool.query(
      'SELECT COUNT(*) as total FROM campaigns WHERE user_id = ?', [userId]
    );

    const waStatus = await WhatsAppManager.getStatus(userId);

    const [dailyStats] = await pool.query(
      `SELECT DATE(sent_at) as date, channel, COUNT(*) as count
       FROM message_logs WHERE user_id = ? AND sent_at > DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'sent'
       GROUP BY DATE(sent_at), channel ORDER BY date`,
      [userId]
    );

    const [recentCampaigns] = await pool.query(
      `SELECT id, name, channel, status, sent_count, total_contacts, created_at
       FROM campaigns WHERE user_id = ? ORDER BY created_at DESC LIMIT 5`,
      [userId]
    );

    const SmsService = require('./src/services/SmsService');
    const balance = await SmsService.getBalance();

    res.json({
      success: true,
      stats: {
        contacts: contacts.total,
        messages_30d: messages.total,
        campaigns: campaigns.total,
        sms_credits: req.user.wallet_balance ?? req.user.sms_credits,
        wallet_balance: parseFloat(req.user.wallet_balance) || 0,
        sms_balance: balance.balance,
        wa_status: waStatus.status,
        wa_connected: waStatus.connected_count,
        wa_senders: waStatus.senders?.length || 0
      },
      daily_stats: dailyStats,
      recent_campaigns: recentCampaigns
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.get('/app/*splat', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'));
});

io.on('connection', (socket) => {
  socket.on('authenticate', async ({ token }) => {
    try {
      const decoded = verifyToken(token);
      socket.userId = decoded.id;
      socket.join(String(decoded.id));

      const status = await WhatsAppManager.getStatus(decoded.id);
      socket.emit('wa:pool-status', status);
      WhatsAppManager.emitPendingQrs(decoded.id);
    } catch (err) {
      socket.emit('error', { message: 'Authentication failed' });
    }
  });

  socket.on('wa:pair', async ({ sessionId }) => {
    if (!socket.userId || !sessionId) return;
    await WhatsAppManager.pairSender(socket.userId, Number(sessionId));
  });
});

cron.schedule('0 0 * * *', async () => {
  try {
    await WhatsAppManager.resetDailyCounters();
    await CampaignRunner.resumePausedCampaigns();
    console.log('[Cron] Daily reset complete — paused campaigns resumed');
  } catch (err) {
    console.error('[Cron] Daily reset failed:', err.message);
  }
});

cron.schedule('* * * * *', async () => {
  try {
    await CampaignRunner.processScheduledCampaigns();
  } catch (err) {
    console.error('[Cron] Scheduled campaign check failed:', err.message);
  }
});

cron.schedule('*/2 * * * *', async () => {
  try {
    const FlutterwaveService = require('./src/services/FlutterwaveService');
    if (FlutterwaveService.isActive()) {
      await FlutterwaveService.reconcilePendingPayments();
    }
  } catch (err) {
    console.error('[Cron] Payment reconcile failed:', err.message);
  }
});

const PORT = process.env.PORT || 3600;

async function start() {
  try {
    validateProductionConfig();

    const pool = require('./src/config/db');
    const { runMigrations } = require('./src/utils/migrate');
    await pool.query('SELECT 1');
    console.log('[DB] Connected');

    await runMigrations(pool);

    const GatewayConfigService = require('./src/services/GatewayConfigService');
    await GatewayConfigService.seedFromEnv();
    await GatewayConfigService.init();

    await WhatsAppManager.restoreSessions();

    await pool.query(`
      DELETE q FROM message_logs q
      INNER JOIN message_logs s ON q.campaign_id = s.campaign_id AND q.phone = s.phone AND s.status = 'sent'
      WHERE q.status = 'queued' AND q.campaign_id IS NOT NULL
    `);

    setTimeout(() => CampaignRunner.resumeInterruptedCampaigns(), 5000);

    const FlutterwaveService = require('./src/services/FlutterwaveService');
    if (FlutterwaveService.isActive()) {
      FlutterwaveService.reconcilePendingPayments().catch(err => {
        console.warn('[Startup] Payment reconcile:', err.message);
      });
    }

    server.listen(PORT, () => {
      const appUrl = getAppUrl();
      console.log(`[AfrieConnect] Running on port ${PORT}`);
      console.log(`[AfrieConnect] App URL: ${appUrl}`);
      console.log(`[AfrieConnect] Webhook URL: ${getWebhookUrl()}`);
    });
  } catch (err) {
    console.error('[Startup] Failed:', err.message);
    process.exit(1);
  }
}

start();
