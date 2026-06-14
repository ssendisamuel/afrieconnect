const express = require('express');
const { body, validationResult } = require('express-validator');
const { apiKeyMiddleware } = require('../middleware/auth');
const UserSmsService = require('../services/UserSmsService');
const WalletService = require('../services/WalletService');
const { planRate } = require('../utils/smsCost');

const router = express.Router();

router.use(apiKeyMiddleware);

router.get('/balance', async (req, res) => {
  try {
    const wallet = await WalletService.getBalance(req.user.id);
    const smsRate = planRate(req.user.plan);
    res.json({
      success: true,
      wallet_balance: wallet.balance,
      currency: 'UGX',
      sms_rate: smsRate,
      estimated_sms_parts: smsRate > 0 ? Math.floor(wallet.balance / smsRate) : 0
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/send', [
  body('message').notEmpty(),
  body('to').optional(),
  body('phone').optional()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const result = await UserSmsService.sendImmediate(req.user, req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/bulk', [
  body('message').notEmpty(),
  body('phones').optional().isArray(),
  body('recipients').optional()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  try {
    const result = await UserSmsService.sendImmediate(req.user, req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
