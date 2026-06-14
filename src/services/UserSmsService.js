const { v4: uuidv4 } = require('uuid');
const pool = require('../config/db');
const SmsService = require('./SmsService');
const WalletService = require('./WalletService');
const { estimateSendCost } = require('../utils/smsCost');
const { normalizePhone } = require('../utils/phone');

function parseRecipients(input) {
  if (!input) return [];
  const values = Array.isArray(input) ? input : String(input).split(/[\n,;\t]+/);
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

async function sendImmediate(user, { phone, phones, recipients, to, message, sender_id }) {
  const recipientList = phones?.length
    ? parseRecipients(phones)
    : recipients
      ? parseRecipients(recipients)
      : to
        ? parseRecipients([to])
        : phone
          ? parseRecipients([phone])
          : [];

  if (!recipientList.length) {
    throw new Error('Enter at least one valid phone number');
  }

  if (!message?.trim()) {
    throw new Error('Message is required');
  }

  const estimate = estimateSendCost(message, recipientList.length, user.plan);
  const wallet = await WalletService.getBalance(user.id);
  if (wallet.balance < estimate.totalCost) {
    throw new Error(
      `Insufficient wallet balance. Need UGX ${estimate.totalCost.toLocaleString()}, you have UGX ${wallet.balance.toLocaleString()}.`
    );
  }

  const apiResult = recipientList.length === 1
    ? await SmsService.sendSingle(recipientList[0], message, sender_id)
    : await SmsService.sendBulk(recipientList, message, sender_id);

  if (!apiResult.success) {
    throw new Error(apiResult.message || 'SMS send failed');
  }

  if (apiResult.mock) {
    throw new Error('SMS provider is not configured. Contact support.');
  }

  const totalCharged = apiResult.cost ? parseFloat(apiResult.cost) : estimate.totalCost;
  const unitCost = totalCharged / recipientList.length;

  await WalletService.debit(user.id, totalCharged, {
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
      [batchId, user.id, recipient, message, apiResult.tracking_code || null, unitCost, apiResult.currency || 'UGX']
    );
  }

  const newBalance = await WalletService.getBalance(user.id);
  return {
    success: true,
    recipients: recipientList.length,
    parts: estimate.parts,
    amount_charged: totalCharged,
    wallet_balance: newBalance.balance,
    batch_id: batchId,
    tracking_code: apiResult.tracking_code || null,
    currency: apiResult.currency || 'UGX'
  };
}

module.exports = { parseRecipients, sendImmediate };
