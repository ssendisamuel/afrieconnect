const express = require('express');
const { body, validationResult } = require('express-validator');
const { apiKeyMiddleware } = require('../middleware/auth');
const { otpSendLimiter } = require('../middleware/rateLimiter');
const OtpService = require('../services/OtpService');

const router = express.Router();

router.post('/send', apiKeyMiddleware, otpSendLimiter, [
  body('phone').notEmpty(),
  body('channel').optional().isIn(['whatsapp', 'sms'])
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const { phone, app_name, channel } = req.body;
    const result = await OtpService.sendOtp(req.user.id, phone, app_name || 'App', channel || 'whatsapp');
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/verify', apiKeyMiddleware, [
  body('phone').notEmpty(),
  body('otp_code').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { phone, otp_code } = req.body;
  const result = await OtpService.verifyOtp(req.user.id, phone, otp_code);
  res.status(result.success ? 200 : 400).json(result);
});

module.exports = router;
