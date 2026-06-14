const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const WalletService = require('../services/WalletService');
const { planRate } = require('../utils/smsCost');

const router = express.Router();

router.use(authMiddleware);

router.get('/balance', async (req, res) => {
  try {
    const wallet = await WalletService.getBalance(req.user.id);
    const smsRate = planRate(req.user.plan);
    res.json({
      success: true,
      wallet_balance: wallet.balance,
      user_credits: wallet.balance,
      currency: 'UGX',
      sms_rate: smsRate,
      estimated_sms_parts: smsRate > 0 ? Math.floor(wallet.balance / smsRate) : 0
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/transactions', async (req, res) => {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '50', 10);
  const offset = (page - 1) * limit;
  const transactions = await WalletService.listTransactions(req.user.id, { limit, offset });
  res.json({ success: true, transactions, pagination: { page, limit } });
});

module.exports = router;
