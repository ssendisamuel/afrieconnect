require('dotenv').config();
const bcrypt = require('bcrypt');
const pool = require('./config/db');
const { generateApiKey } = require('./utils/token');

async function seed() {
  console.log('[Seed] Starting...');

  const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");

  if (!admins.length) {
    const email = process.env.ADMIN_EMAIL || 'admin@afrieconnect.com';
    const password = process.env.ADMIN_PASSWORD || 'Admin@AfrieConnect2026!';
    const name = process.env.ADMIN_NAME || 'Admin';
    const phone = process.env.ADMIN_PHONE || null;

    const passwordHash = await bcrypt.hash(password, 12);
    const apiKey = generateApiKey();

    await pool.query(
      `INSERT INTO users (name, email, password_hash, phone, role, status, email_verified, api_key, sms_credits, plan)
       VALUES (?, ?, ?, ?, 'admin', 'active', 1, ?, 1000, 'enterprise')`,
      [name, email, passwordHash, phone, apiKey]
    );

    console.log(`[Seed] Admin created: ${email}`);
  } else {
    console.log('[Seed] Admin already exists');
  }

  const [adminRow] = await pool.query("SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  const adminId = adminRow[0].id;

  const templates = [
    { name: 'AfrieCon SMS Welcome', message: 'Hello {{name}}, welcome to AfrieConnect! Your account is ready.', channel: 'sms' },
    { name: 'Hello World WA', message: 'Hello {{name}}! This is a test message from AfrieConnect.', channel: 'whatsapp' }
  ];

  for (const tpl of templates) {
    const [existing] = await pool.query(
      'SELECT id FROM templates WHERE user_id = ? AND name = ?',
      [adminId, tpl.name]
    );
    if (!existing.length) {
      await pool.query(
        'INSERT INTO templates (user_id, name, message, channel) VALUES (?, ?, ?, ?)',
        [adminId, tpl.name, tpl.message, tpl.channel]
      );
      console.log(`[Seed] Template created: ${tpl.name}`);
    }
  }

  console.log('[Seed] Complete!');
  process.exit(0);
}

seed().catch(err => {
  console.error('[Seed] Error:', err);
  process.exit(1);
});
