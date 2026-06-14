const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const WalletService = require('./WalletService');
const GatewayConfigService = require('./GatewayConfigService');
const { getAppUrl } = require('../utils/appUrl');

const TOKEN_URL = 'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token';

let tokenCache = { accessToken: null, expiresAt: 0 };

function getConfig() {
  return GatewayConfigService.getPaymentConfigSync();
}

function isActive() {
  const active = GatewayConfigService.getActiveSync('payment');
  return Boolean(active && active.is_active && isConfigured());
}

function isConfigured() {
  const config = getConfig();
  return Boolean(
    config &&
    config.client_id &&
    config.client_secret &&
    config.client_id !== 'YOUR_FLW_CLIENT_ID' &&
    config.client_secret !== 'YOUR_FLW_CLIENT_SECRET'
  );
}

function isCardConfigured() {
  const config = getConfig();
  return isActive() && Boolean(
    config?.encryption_key &&
    config.encryption_key !== 'YOUR_FLW_ENCRYPTION_KEY'
  );
}

function getEncryptionKey() {
  const config = getConfig();
  return config?.encryption_key || null;
}

function getWebhookSecret() {
  const config = getConfig();
  return config?.webhook_secret || null;
}

function apiBase() {
  const config = getConfig() || {};
  return (config.api_base || 'https://f4bexperience.flutterwave.com').replace(/\/$/, '');
}

function parseUgPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (digits.startsWith('256')) digits = digits.slice(3);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length < 9) {
    throw new Error('Enter a valid Ugandan mobile number');
  }
  return { country_code: '256', number: digits };
}

function parseName(name) {
  const parts = String(name || 'AfrieConnect User').trim().split(/\s+/).filter(Boolean);
  return {
    first: parts[0] || 'User',
    last: parts.slice(1).join(' ') || 'AfrieConnect'
  };
}

function mapNetwork(network) {
  return String(network || 'MTN').toUpperCase() === 'AIRTEL' ? 'AIRTEL' : 'MTN';
}

function isSuccessStatus(status) {
  const value = String(status || '').toLowerCase();
  return value === 'succeeded' || value === 'successful';
}

async function getAccessToken() {
  if (!isActive()) {
    throw new Error('Flutterwave payment gateway is not active. Configure it under Admin → Payment Gateways.');
  }

  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 60000) {
    return tokenCache.accessToken;
  }

  const config = getConfig();
  const response = await axios.post(
    TOKEN_URL,
    new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret,
      grant_type: 'client_credentials'
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token: accessToken, expires_in: expiresIn } = response.data || {};
  if (!accessToken) {
    throw new Error('Failed to obtain Flutterwave access token');
  }

  tokenCache = {
    accessToken,
    expiresAt: Date.now() + (Number(expiresIn) || 300) * 1000
  };

  return accessToken;
}

async function apiRequest(method, path, data, idempotencyKey) {
  const token = await getAccessToken();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-Trace-Id': uuidv4()
  };

  if (idempotencyKey) {
    headers['X-Idempotency-Key'] = idempotencyKey;
  }

  try {
    const response = await axios({
      method,
      url: `${apiBase()}${path}`,
      headers,
      data
    });

    return response.data;
  } catch (err) {
    const provider = err.response?.data;
    const providerMessage = provider?.error?.message || provider?.message;
    if (providerMessage) {
      const wrapped = new Error(providerMessage);
      wrapped.response = err.response;
      throw wrapped;
    }
    if (err.response?.status === 404) {
      throw new Error(
        `Flutterwave API endpoint not found (${apiBase()}${path}). ` +
        'Live V4 uses https://f4bexperience.flutterwave.com — update the API base URL in Admin → Payment Gateways'
      );
    }
    throw err;
  }
}

function generateTxRef(userId) {
  return `afc-${userId}-${Date.now()}-${uuidv4().slice(0, 8)}`;
}

async function createPaymentRecord(userId, amount, network, phone) {
  const txRef = generateTxRef(userId);
  const [result] = await pool.query(
    `INSERT INTO payment_transactions
     (user_id, tx_ref, amount, currency, network, phone, status)
     VALUES (?, ?, ?, 'UGX', ?, ?, 'pending')`,
    [userId, txRef, amount, network, phone]
  );
  return { id: result.insertId, txRef };
}

function buildChargeResponse(payment, chargeRes) {
  const charge = chargeRes?.data;
  if (chargeRes?.status !== 'success' || !charge?.id) {
    throw new Error(chargeRes?.message || charge?.error?.message || 'Payment initiation failed');
  }

  const nextAction = charge.next_action || {};
  const redirectUrl = nextAction.redirect_url?.url || charge.redirect_url || null;
  const instruction = nextAction.payment_instruction?.note
    || nextAction.payment_instruction?.message
    || (redirectUrl ? 'Complete payment on the secure checkout page' : 'Authorize the payment on your phone');

  return {
    tx_ref: payment.txRef,
    flw_ref: charge.id,
    charge_id: charge.id,
    status: charge.status || 'pending',
    redirect_url: redirectUrl,
    message: instruction
  };
}

async function findOrCreateCustomer({ email, name, phone }, idempotencyKey) {
  const customerEmail = String(email || '').trim().toLowerCase();
  if (!customerEmail) {
    throw new Error('Customer email is required for payment');
  }

  const listRes = await apiRequest('GET', `/customers?email=${encodeURIComponent(customerEmail)}`);
  const existing = (listRes?.data || []).find(
    c => String(c.email || '').trim().toLowerCase() === customerEmail
  );
  if (existing?.id) return existing.id;

  try {
    const customerRes = await apiRequest('POST', '/customers', {
      email: customerEmail,
      name,
      ...(phone ? { phone } : {})
    }, `${idempotencyKey}-customer`);
    if (customerRes?.data?.id) return customerRes.data.id;
    throw new Error(customerRes?.message || 'Failed to create Flutterwave customer');
  } catch (err) {
    if (/already exists/i.test(err.message || '')) {
      const retry = await apiRequest('GET', `/customers?email=${encodeURIComponent(customerEmail)}`);
      const found = (retry?.data || []).find(
        c => String(c.email || '').trim().toLowerCase() === customerEmail
      );
      if (found?.id) return found.id;
    }
    throw err;
  }
}

async function initiateMobileMoney({ userId, amount, network, phone, email, name, baseUrl }) {
  const appUrl = baseUrl || getAppUrl();
  const payment = await createPaymentRecord(userId, amount, network, phone);
  const parsedPhone = parseUgPhone(phone);
  const parsedName = parseName(name);
  const customerEmail = email || `user${userId}@afrieconnect.local`;
  const idempotencyKey = uuidv4();

  try {
    const customerId = await findOrCreateCustomer(
      { email: customerEmail, name: parsedName, phone: parsedPhone },
      idempotencyKey
    );

    const paymentMethodRes = await apiRequest('POST', '/payment-methods', {
      type: 'mobile_money',
      mobile_money: {
        country_code: parsedPhone.country_code,
        network: mapNetwork(network),
        phone_number: parsedPhone.number
      }
    }, `${idempotencyKey}-payment-method`);

    const paymentMethodId = paymentMethodRes?.data?.id;
    if (!paymentMethodId) {
      throw new Error(paymentMethodRes?.message || 'Failed to create mobile money payment method');
    }

    const chargeRes = await apiRequest('POST', '/charges', {
      reference: payment.txRef,
      currency: 'UGX',
      customer_id: customerId,
      payment_method_id: paymentMethodId,
      amount,
      redirect_url: `${appUrl}/app/payments.html?tx_ref=${payment.txRef}`,
      meta: {
        user_id: String(userId),
        network: mapNetwork(network)
      }
    }, `${idempotencyKey}-charge`);

    await pool.query(
      'UPDATE payment_transactions SET flw_ref = ?, provider_response = ? WHERE id = ?',
      [chargeRes.data.id, JSON.stringify(chargeRes), payment.id]
    );

    return buildChargeResponse(payment, chargeRes);
  } catch (err) {
    const providerResponse = err.response?.data || { message: err.message };
    await pool.query(
      "UPDATE payment_transactions SET status = 'failed', provider_response = ? WHERE id = ?",
      [JSON.stringify(providerResponse), payment.id]
    );

    const message = providerResponse?.error?.message
      || providerResponse?.message
      || err.message
      || 'Payment initiation failed';
    throw new Error(message);
  }
}

async function initiateCardPayment({ userId, amount, email, name, phone, card, baseUrl }) {
  if (!isCardConfigured()) {
    throw new Error('Card payments are not configured. Add an encryption key under Admin → Payment Gateways.');
  }

  const appUrl = baseUrl || getAppUrl();
  const payment = await createPaymentRecord(userId, amount, 'CARD', phone || null);
  const parsedName = parseName(name);
  const parsedPhone = phone ? parseUgPhone(phone) : null;
  const customerEmail = email || `user${userId}@afrieconnect.local`;
  const idempotencyKey = uuidv4();

  try {
    const customerId = await findOrCreateCustomer(
      { email: customerEmail, name: parsedName, phone: parsedPhone },
      idempotencyKey
    );

    const chargeRes = await apiRequest('POST', '/orchestration/direct-charges', {
      amount,
      currency: 'UGX',
      reference: payment.txRef,
      redirect_url: `${appUrl}/app/payments.html?tx_ref=${payment.txRef}`,
      customer_id: customerId,
      payment_method: {
        type: 'card',
        card: {
          nonce: card.nonce,
          encrypted_card_number: card.encrypted_card_number,
          encrypted_expiry_month: card.encrypted_expiry_month,
          encrypted_expiry_year: card.encrypted_expiry_year,
          encrypted_cvv: card.encrypted_cvv
        }
      },
      meta: {
        user_id: String(userId),
        method: 'card'
      }
    }, idempotencyKey);

    await pool.query(
      'UPDATE payment_transactions SET flw_ref = ?, provider_response = ? WHERE id = ?',
      [chargeRes.data.id, JSON.stringify(chargeRes), payment.id]
    );

    return buildChargeResponse(payment, chargeRes);
  } catch (err) {
    const providerResponse = err.response?.data || { message: err.message };
    await pool.query(
      "UPDATE payment_transactions SET status = 'failed', provider_response = ? WHERE id = ?",
      [JSON.stringify(providerResponse), payment.id]
    );

    const message = providerResponse?.error?.message
      || providerResponse?.message
      || err.message
      || 'Card payment initiation failed';
    throw new Error(message);
  }
}

async function verifyTransaction(chargeId) {
  if (!isActive()) {
    return { success: false, message: 'Payment gateway is inactive or not configured' };
  }

  return apiRequest('GET', `/charges/${chargeId}`);
}

async function markPaymentFailed(txRef, providerData = {}) {
  await pool.query(
    "UPDATE payment_transactions SET status = 'failed', provider_response = ?, completed_at = NOW() WHERE tx_ref = ? AND status = 'pending'",
    [JSON.stringify(providerData), txRef]
  );
}

async function syncPaymentStatus(txRef, userId) {
  const [rows] = await pool.query(
    'SELECT * FROM payment_transactions WHERE tx_ref = ? AND user_id = ? LIMIT 1',
    [txRef, userId]
  );
  if (!rows.length) {
    return { success: false, status: 'not_found', message: 'Payment not found' };
  }

  const payment = rows[0];
  if (payment.status === 'successful') {
    const wallet = await WalletService.getBalance(userId);
    return {
      success: true,
      status: 'successful',
      wallet_balance: wallet.balance,
      amount: parseFloat(payment.amount)
    };
  }

  if (payment.status === 'failed' || payment.status === 'cancelled') {
    return { success: true, status: payment.status, message: 'Payment failed or was cancelled' };
  }

  if (!payment.flw_ref) {
    return { success: true, status: 'pending', message: 'Waiting for payment provider…' };
  }

  const verified = await verifyTransaction(payment.flw_ref);
  const data = verified?.data;
  if (!data) {
    return { success: true, status: 'pending', message: 'Could not reach payment provider. Retrying…' };
  }

  const providerStatus = String(data.status || '').toLowerCase();

  if (isSuccessStatus(providerStatus)) {
    const completed = await completePayment(txRef, data);
    return {
      success: true,
      status: 'successful',
      wallet_balance: completed.balance,
      amount: completed.amount ?? parseFloat(payment.amount)
    };
  }

  if (providerStatus === 'failed' || providerStatus === 'cancelled' || providerStatus === 'canceled') {
    await markPaymentFailed(txRef, data);
    return {
      success: true,
      status: 'failed',
      message: data.processor_response?.type
        ? `Payment failed: ${String(data.processor_response.type).replace(/_/g, ' ')}`
        : 'Payment failed on mobile money'
    };
  }

  return {
    success: true,
    status: 'pending',
    flw_status: providerStatus,
    message: 'Waiting for you to approve on your phone…'
  };
}

async function completePayment(txRef, providerData = {}) {
  const [rows] = await pool.query(
    'SELECT * FROM payment_transactions WHERE tx_ref = ? LIMIT 1',
    [txRef]
  );
  if (!rows.length) return { success: false, message: 'Payment not found' };
  const payment = rows[0];
  if (payment.status === 'successful') {
    return {
      success: true,
      alreadyProcessed: true,
      balance: (await WalletService.getBalance(payment.user_id)).balance
    };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [fresh] = await conn.query(
      'SELECT * FROM payment_transactions WHERE tx_ref = ? FOR UPDATE',
      [txRef]
    );
    if (!fresh.length || fresh[0].status === 'successful') {
      await conn.commit();
      const wallet = await WalletService.getBalance(payment.user_id);
      return {
        success: true,
        alreadyProcessed: true,
        balance: wallet.balance,
        amount: parseFloat(fresh[0]?.amount || payment.amount)
      };
    }

    await conn.query(
      `UPDATE payment_transactions SET status = 'successful', flw_ref = COALESCE(?, flw_ref),
       provider_response = ?, completed_at = NOW() WHERE id = ?`,
      [providerData.id || providerData.flw_ref || null, JSON.stringify(providerData), fresh[0].id]
    );
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }

  const balance = await WalletService.credit(payment.user_id, payment.amount, {
    type: 'topup_flutterwave',
    reference: txRef,
    description: payment.network === 'CARD'
      ? 'Wallet top-up via card'
      : `MoMo top-up via ${payment.network}`,
    meta: { flw_ref: providerData.id || providerData.flw_ref, network: payment.network }
  });

  return { success: true, balance, amount: parseFloat(payment.amount) };
}

async function handleWebhook(req) {
  const webhookSecret = getWebhookSecret();
  if (webhookSecret) {
    const headerHash = req.headers['verif-hash'];
    if (!headerHash || headerHash !== webhookSecret) {
      throw new Error('Invalid webhook signature');
    }
  }

  const eventType = req.body?.type || req.body?.event;
  const data = req.body?.data;
  const reference = data?.reference || data?.tx_ref;
  if (!reference) return { success: false, message: 'No payment reference in webhook' };

  const status = String(data?.status || '').toLowerCase();
  if (eventType === 'charge.completed' && isSuccessStatus(status)) {
    return completePayment(reference, data);
  }

  if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
    await pool.query(
      "UPDATE payment_transactions SET status = 'failed', provider_response = ? WHERE tx_ref = ?",
      [JSON.stringify(req.body), reference]
    );
  }

  return { success: true, processed: false, status };
}

async function reconcilePendingPayments() {
  const [rows] = await pool.query(
    `SELECT tx_ref, user_id FROM payment_transactions
     WHERE status = 'pending' AND flw_ref IS NOT NULL
     AND created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
     ORDER BY id ASC`
  );

  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const result = await syncPaymentStatus(row.tx_ref, row.user_id);
      if (result.status === 'successful') synced += 1;
      else if (result.status === 'failed') failed += 1;
    } catch (err) {
      console.warn('[Payments] Reconcile error:', row.tx_ref, err.message);
    }
  }

  if (synced || failed) {
    console.log(`[Payments] Reconciled pending: ${synced} credited, ${failed} marked failed`);
  }

  return { checked: rows.length, synced, failed };
}

module.exports = {
  isConfigured,
  isActive,
  isCardConfigured,
  getEncryptionKey,
  initiateMobileMoney,
  initiateCardPayment,
  verifyTransaction,
  syncPaymentStatus,
  reconcilePendingPayments,
  completePayment,
  handleWebhook,
  generateTxRef
};
