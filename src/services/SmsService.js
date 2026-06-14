const axios = require('axios');
const { normalizePhone } = require('../utils/phone');
const GatewayConfigService = require('./GatewayConfigService');
const { allowMockIntegrations } = require('../utils/env');

function getConfig() {
  return GatewayConfigService.getSmsConfigSync();
}

function isConfigured() {
  const config = getConfig();
  return Boolean(
    config &&
    config.username &&
    config.password &&
    config.password !== 'YOUR_EGOSMS_API_KEY'
  );
}

function isActive() {
  const active = GatewayConfigService.getActiveSync('sms');
  return Boolean(active && active.is_active && isConfigured());
}

function userData() {
  const config = getConfig() || {};
  return { username: config.username, password: config.password };
}

function defaultSender() {
  const config = getConfig() || {};
  return config.sender_id || 'AfrieCon';
}

function baseUrl() {
  const config = getConfig() || {};
  return (config.base_url || 'https://comms.egosms.co/api/v1/json').replace(/\/$/, '');
}

function parseApiResponse(data) {
  if (!data || typeof data !== 'object') {
    return { success: false, message: 'Invalid response from SMS provider' };
  }

  const status = data.Status || data.status;
  const ok = status === 'OK' || status === 'ok';

  return {
    success: ok,
    message: data.Message || data.message || status || 'Unknown response',
    cost: data.Cost ?? data.cost,
    currency: data.Currency || data.currency || 'UGX',
    tracking_code: data.MsgFollowUpUniqueCode || data.msgFollowUpUniqueCode || data.tracking_code,
    balance: data.Balance ?? data.balance
  };
}

async function postJson(body) {
  try {
    const response = await axios.post(baseUrl(), body, {
      timeout: 30000,
      headers: { 'Content-Type': 'application/json' }
    });
    return parseApiResponse(response.data);
  } catch (err) {
    const providerMessage = err.response?.data?.Message || err.response?.data?.message;
    const status = err.response?.status;
    console.error('[SmsService] API error:', err.response?.data || err.message);

    let message = providerMessage || err.message;
    if (status === 404) {
      message = 'SMS provider endpoint not found. Check the gateway base URL in admin settings.';
    } else if (status) {
      message = providerMessage || `SMS provider returned HTTP ${status}`;
    }

    return { success: false, message };
  }
}

async function getBalance() {
  if (!isActive()) {
    if (!isConfigured()) {
      console.warn('[SmsService] SMS gateway not configured');
      return { success: true, balance: 0, currency: 'UGX', mock: true, disabled: true };
    }
    return { success: false, balance: 0, currency: 'UGX', message: 'SMS gateway is disabled by admin' };
  }

  const result = await postJson({
    method: 'Balance',
    userdata: userData()
  });

  return {
    success: result.success,
    balance: parseFloat(result.balance) || 0,
    currency: result.currency || 'UGX',
    message: result.message
  };
}

async function sendBulk(phones, message, senderId = defaultSender(), priority = '0') {
  const normalized = phones.map(normalizePhone).filter(Boolean);

  if (!normalized.length) {
    return { success: false, message: 'No valid phone numbers' };
  }

  if (!message || message.trim().length < 2) {
    return { success: false, message: 'Message must be at least 2 characters' };
  }

  if (!isActive()) {
    if (!isConfigured()) {
      if (allowMockIntegrations()) {
        console.warn(`[SmsService] Mock bulk send to ${normalized.length} numbers`);
        return {
          success: true,
          message: `Mock SMS sent to ${normalized.length} recipients`,
          cost: normalized.length * 35,
          currency: 'UGX',
          mock: true
        };
      }
      return { success: false, message: 'SMS provider is not configured' };
    }
    return { success: false, message: 'SMS gateway is disabled. Enable it under Admin → SMS Gateways.' };
  }

  const msgdata = normalized.map(number => ({
    number,
    message,
    senderid: senderId,
    priority
  }));

  const result = await postJson({
    method: 'SendSms',
    userdata: userData(),
    msgdata
  });

  return result;
}

async function sendSingle(phone, message, senderId = defaultSender()) {
  const normalized = normalizePhone(phone);
  const result = await sendBulk([normalized], message, senderId);
  return { ...result, phone: normalized };
}

module.exports = { getBalance, sendSingle, sendBulk, isConfigured, isActive };
