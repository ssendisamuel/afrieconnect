const express = require('express');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../middleware/auth');
const FlutterwaveService = require('../services/FlutterwaveService');
const WalletService = require('../services/WalletService');
const pool = require('../config/db');
const { getAppUrl, getWebhookUrl } = require('../utils/appUrl');

const router = express.Router();

const TOPUP_PACKAGES = [
  { amount: 5000, label: 'UGX 5,000' },
  { amount: 10000, label: 'UGX 10,000' },
  { amount: 25000, label: 'UGX 25,000' },
  { amount: 50000, label: 'UGX 50,000' },
  { amount: 100000, label: 'UGX 100,000' }
];

router.post('/webhook', async (req, res) => {
  try {
    const result = await FlutterwaveService.handleWebhook(req);
    res.json(result);
  } catch (err) {
    console.error('[Payments] Webhook error:', err.message);
    res.status(401).json({ success: false, message: err.message });
  }
});

router.use(authMiddleware);

router.get('/packages', (req, res) => {
  const isAdmin = req.user.role === 'admin';
  const payload = {
    success: true,
    packages: TOPUP_PACKAGES,
    flutterwave_configured: FlutterwaveService.isActive(),
    card_payments_enabled: FlutterwaveService.isCardConfigured(),
    currency: 'UGX',
    payment_methods: [
      { id: 'mobile_money', label: 'Mobile Money', networks: ['MTN', 'AIRTEL'] },
      { id: 'card', label: 'Card (Visa / Mastercard)', networks: [] }
    ],
    encryption_key: FlutterwaveService.isCardConfigured()
      ? FlutterwaveService.getEncryptionKey()
      : null
  };

  if (isAdmin) {
    payload.app_url = getAppUrl(req);
    payload.webhook_url = getWebhookUrl(req);
  }

  res.json(payload);
});

router.get('/history', async (req, res) => {
  const [payments] = await pool.query(
    `SELECT id, tx_ref, amount, currency, network, status, created_at, completed_at
     FROM payment_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [req.user.id]
  );
  res.json({ success: true, payments });
});

router.post('/initiate', [
  body('amount').isFloat({ min: 1000 }),
  body('method').optional().isIn(['mobile_money', 'card']),
  body('network').optional().isIn(['MTN', 'AIRTEL']),
  body('phone').optional().trim(),
  body('card').optional().isObject()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { amount, network, phone, card } = req.body;
  const method = req.body.method || 'mobile_money';
  const baseUrl = getAppUrl(req);

  try {
    if (method === 'card') {
      if (!card?.nonce || !card?.encrypted_card_number || !card?.encrypted_expiry_month
        || !card?.encrypted_expiry_year || !card?.encrypted_cvv) {
        return res.status(400).json({ success: false, message: 'Encrypted card details are required' });
      }

      const result = await FlutterwaveService.initiateCardPayment({
        userId: req.user.id,
        amount: parseFloat(amount),
        email: req.user.email,
        name: req.user.name,
        phone: phone || req.user.phone,
        card,
        baseUrl
      });

      return res.json({ success: true, ...result });
    }

    if (!network || !phone) {
      return res.status(400).json({ success: false, message: 'Network and phone are required for mobile money' });
    }

    const result = await FlutterwaveService.initiateMobileMoney({
      userId: req.user.id,
      amount: parseFloat(amount),
      network,
      phone,
      email: req.user.email,
      name: req.user.name,
      baseUrl
    });

    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/verify/:txRef', async (req, res) => {
  try {
    const result = await FlutterwaveService.syncPaymentStatus(req.params.txRef, req.user.id);
    if (result.status === 'not_found') {
      return res.status(404).json({ success: false, message: result.message });
    }
    res.json(result);
  } catch (err) {
    console.error('[Payments] Verify error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
