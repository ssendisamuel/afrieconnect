const pool = require('../config/db');
const { generateOtp } = require('../utils/token');
const { normalizePhone } = require('../utils/phone');
const WhatsAppManager = require('./WhatsAppManager');
const SmsService = require('./SmsService');

async function sendOtp(userId, phone, appName = 'App', channel = 'whatsapp') {
  phone = normalizePhone(phone);

  const [recent] = await pool.query(
    `SELECT COUNT(*) as count FROM otp_codes
     WHERE phone = ? AND user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)`,
    [phone, userId]
  );

  if (recent[0].count >= 3) {
    throw new Error('OTP rate limit exceeded for this phone number');
  }

  const otp = generateOtp();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  const message = `${appName}: Your verification code is ${otp}. Valid for 10 minutes. Do not share this code.`;

  if (channel === 'whatsapp') {
    await WhatsAppManager.sendWithRotation(userId, phone, message);
  } else {
    await SmsService.sendSingle(phone, message);
  }

  await pool.query(
    `INSERT INTO otp_codes (user_id, phone, otp_code, app_name, channel, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, phone, otp, appName, channel, expiresAt]
  );

  return { success: true, message: 'OTP sent', expires_in: 600 };
}

async function verifyOtp(userId, phone, otpCode) {
  phone = normalizePhone(phone);

  const [rows] = await pool.query(
    `SELECT * FROM otp_codes
     WHERE phone = ? AND user_id = ? AND verified = 0 AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [phone, userId]
  );

  if (!rows.length) {
    return { success: false, message: 'OTP expired or not found' };
  }

  const record = rows[0];

  if (record.attempts >= 3) {
    return { success: false, message: 'Maximum verification attempts exceeded' };
  }

  await pool.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?', [record.id]);

  if (record.otp_code !== String(otpCode)) {
    return { success: false, message: 'Invalid OTP code' };
  }

  await pool.query('UPDATE otp_codes SET verified = 1 WHERE id = ?', [record.id]);
  return { success: true, message: 'OTP verified' };
}

module.exports = { sendOtp, verifyOtp };
