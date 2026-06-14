const pool = require('../config/db');
const { getTemplate, defaultConfig } = require('../config/gatewayTemplates');

const SECRET_KEYS = new Set([
  'client_secret',
  'encryption_key',
  'webhook_secret',
  'password',
  'api_key',
  'secret_key',
  'auth_token',
  'api_secret',
  'consumer_secret',
  'passkey',
  'company_token',
  'access_key',
  'server_token',
  'smtp_pass',
  'private_key'
]);

const MASK = '********';

let cache = { rows: [], loadedAt: 0 };
const CACHE_MS = 15000;

function envPaymentConfig() {
  return {
    client_id: process.env.FLUTTERWAVE_CLIENT_ID || '',
    client_secret: process.env.FLUTTERWAVE_CLIENT_SECRET || '',
    encryption_key: process.env.FLUTTERWAVE_ENCRYPTION_KEY || '',
    api_base: (process.env.FLUTTERWAVE_API_BASE || 'https://f4bexperience.flutterwave.com').replace(/\/$/, ''),
    webhook_secret: process.env.FLUTTERWAVE_WEBHOOK_SECRET || ''
  };
}

function envSmsConfig() {
  return {
    username: process.env.EGOSMS_USERNAME || '',
    password: process.env.EGOSMS_PASSWORD || '',
    sender_id: process.env.EGOSMS_SENDER_ID || 'AfrieCon',
    base_url: (process.env.EGOSMS_BASE_URL || 'https://comms.egosms.co/api/v1/json').replace(/\/$/, '')
  };
}

function envEmailConfig() {
  return {
    smtp_host: process.env.SMTP_HOST || '',
    smtp_port: process.env.SMTP_PORT || '587',
    smtp_user: process.env.SMTP_USER || '',
    smtp_pass: process.env.SMTP_PASS || '',
    smtp_from: process.env.SMTP_FROM || '',
    smtp_secure: 'false'
  };
}

function parseRow(row) {
  const config = typeof row.config === 'string' ? JSON.parse(row.config) : (row.config || {});
  return {
    id: row.id,
    category: row.category,
    provider: row.provider,
    display_name: row.display_name,
    config,
    is_active: Boolean(row.is_active),
    is_default: Boolean(row.is_default),
    updated_at: row.updated_at
  };
}

function maskConfig(config = {}) {
  const masked = { ...config };
  for (const key of Object.keys(masked)) {
    if (SECRET_KEYS.has(key) && masked[key]) {
      masked[key] = MASK;
    }
  }
  return masked;
}

function mergeConfig(existing = {}, incoming = {}) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    if (SECRET_KEYS.has(key) && (!value || value === MASK)) continue;
    merged[key] = value;
  }
  return merged;
}

async function loadCache() {
  const [rows] = await pool.query('SELECT * FROM integration_gateways ORDER BY category, provider');
  cache = { rows: rows.map(parseRow), loadedAt: Date.now() };
}

async function ensureCache() {
  if (!cache.rows.length || Date.now() - cache.loadedAt > CACHE_MS) {
    await loadCache();
  }
}

async function init() {
  await loadCache();
}

async function invalidateCache() {
  cache.loadedAt = 0;
  await loadCache();
}

async function seedFromEnv() {
  const seeds = [
    {
      category: 'payment',
      provider: 'flutterwave',
      display_name: 'Flutterwave',
      config: envPaymentConfig(),
      is_active: 1,
      is_default: 1
    },
    {
      category: 'sms',
      provider: 'egosms',
      display_name: 'Pahappa / EgoSMS',
      config: envSmsConfig(),
      is_active: 1,
      is_default: 1
    },
    {
      category: 'email',
      provider: 'smtp',
      display_name: 'Gmail / Custom SMTP',
      config: envEmailConfig(),
      is_active: 1,
      is_default: 1
    }
  ];

  for (const seed of seeds) {
    const [existing] = await pool.query(
      'SELECT id FROM integration_gateways WHERE category = ? AND provider = ?',
      [seed.category, seed.provider]
    );
    if (!existing.length) {
      await pool.query(
        `INSERT INTO integration_gateways (category, provider, display_name, config, is_active, is_default)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [seed.category, seed.provider, seed.display_name, JSON.stringify(seed.config), seed.is_active, seed.is_default]
      );
    }
  }

  await invalidateCache();
}

async function list(category = null) {
  await ensureCache();
  if (!category) return cache.rows.map(row => ({ ...row, config: maskConfig(row.config) }));
  return cache.rows
    .filter(row => row.category === category)
    .map(row => ({ ...row, config: maskConfig(row.config) }));
}

async function getById(id, { includeSecrets = false } = {}) {
  await ensureCache();
  const row = cache.rows.find(item => item.id === Number(id));
  if (!row) return null;
  return includeSecrets ? row : { ...row, config: maskConfig(row.config) };
}

function getActiveSync(category) {
  const rows = cache.rows.filter(row => row.category === category && row.is_active);
  return rows.find(row => row.is_default) || rows[0] || null;
}

function getPaymentConfigSync() {
  const active = getActiveSync('payment');
  return active?.provider === 'flutterwave' ? (active?.config || null) : null;
}

function getSmsConfigSync() {
  const active = getActiveSync('sms');
  return active?.provider === 'egosms' ? (active?.config || null) : null;
}

function getEmailConfigSync() {
  const active = getActiveSync('email');
  return active?.config || null;
}

function getActiveGatewaySync(category) {
  return getActiveSync(category);
}

async function createGateway({ category, provider, display_name, config = {}, is_active = true, is_default = false }) {
  const template = getTemplate(category, provider);
  if (!template) {
    throw new Error('Unknown provider. Choose from the available templates.');
  }

  const [existing] = await pool.query(
    'SELECT id FROM integration_gateways WHERE category = ? AND provider = ?',
    [category, provider]
  );
  if (existing.length) {
    throw new Error(`${template.display_name} is already configured. Edit the existing entry instead.`);
  }

  const mergedConfig = { ...defaultConfig(category, provider), ...config };
  const name = display_name || template.display_name;

  const [countRows] = await pool.query(
    'SELECT COUNT(*) as total FROM integration_gateways WHERE category = ?',
    [category]
  );
  const makeDefault = is_default || countRows[0].total === 0;

  const [result] = await pool.query(
    `INSERT INTO integration_gateways (category, provider, display_name, config, is_active, is_default)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [category, provider, name, JSON.stringify(mergedConfig), is_active ? 1 : 0, makeDefault ? 1 : 0]
  );

  if (makeDefault) {
    await pool.query(
      'UPDATE integration_gateways SET is_default = 0 WHERE category = ? AND id <> ?',
      [category, result.insertId]
    );
  }

  await invalidateCache();
  return getById(result.insertId);
}

async function deleteGateway(id) {
  const current = await getById(id, { includeSecrets: true });
  if (!current) throw new Error('Gateway not found');

  await pool.query('DELETE FROM integration_gateways WHERE id = ?', [id]);

  if (current.is_default) {
    const [remaining] = await pool.query(
      'SELECT id FROM integration_gateways WHERE category = ? ORDER BY id ASC LIMIT 1',
      [current.category]
    );
    if (remaining.length) {
      await pool.query('UPDATE integration_gateways SET is_default = 1 WHERE id = ?', [remaining[0].id]);
    }
  }

  await invalidateCache();
  return { success: true };
}

async function updateGateway(id, { display_name, config, is_active, is_default }) {
  const current = await getById(id, { includeSecrets: true });
  if (!current) {
    throw new Error('Gateway not found');
  }

  const nextConfig = config ? mergeConfig(current.config, config) : current.config;
  const fields = [];
  const params = [];

  if (display_name !== undefined) {
    fields.push('display_name = ?');
    params.push(display_name);
  }
  if (config) {
    fields.push('config = ?');
    params.push(JSON.stringify(nextConfig));
  }
  if (is_active !== undefined) {
    fields.push('is_active = ?');
    params.push(is_active ? 1 : 0);
  }
  if (is_default !== undefined) {
    fields.push('is_default = ?');
    params.push(is_default ? 1 : 0);
  }

  if (!fields.length) {
    return getById(id);
  }

  params.push(id);
  await pool.query(`UPDATE integration_gateways SET ${fields.join(', ')} WHERE id = ?`, params);

  if (is_default) {
    await pool.query(
      'UPDATE integration_gateways SET is_default = 0 WHERE category = ? AND id <> ?',
      [current.category, id]
    );
  }

  await invalidateCache();
  return getById(id);
}

module.exports = {
  MASK,
  init,
  seedFromEnv,
  invalidateCache,
  list,
  getById,
  getActiveSync,
  getActiveGatewaySync,
  getPaymentConfigSync,
  getSmsConfigSync,
  getEmailConfigSync,
  createGateway,
  deleteGateway,
  updateGateway,
  maskConfig,
  mergeConfig
};
