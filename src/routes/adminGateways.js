const express = require('express');
const { body, validationResult } = require('express-validator');
const GatewayConfigService = require('../services/GatewayConfigService');
const FlutterwaveService = require('../services/FlutterwaveService');
const SmsService = require('../services/SmsService');
const MailService = require('../services/MailService');
const { listTemplates, getTemplate } = require('../config/gatewayTemplates');
const { getAppUrl, getWebhookUrl } = require('../utils/appUrl');

const router = express.Router();

router.get('/templates', (req, res) => {
  const category = req.query.category || null;
  res.json({
    success: true,
    templates: listTemplates(category)
  });
});

router.get('/', async (req, res) => {
  try {
    const category = req.query.category || null;
    const gateways = await GatewayConfigService.list(category);
    const enriched = gateways.map(gateway => ({
      ...gateway,
      template: getTemplate(gateway.category, gateway.provider)
    }));
    res.json({
      success: true,
      gateways: enriched,
      templates: listTemplates(category),
      app_url: getAppUrl(req),
      webhook_url: getWebhookUrl(req)
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/', [
  body('category').isIn(['payment', 'sms', 'email']),
  body('provider').trim().notEmpty(),
  body('display_name').optional().trim().isLength({ max: 100 }),
  body('config').optional().isObject(),
  body('is_active').optional().isBoolean()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  try {
    const gateway = await GatewayConfigService.createGateway(req.body);
    res.status(201).json({ success: true, gateway, message: 'Gateway added' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const gateway = await GatewayConfigService.getById(req.params.id);
    if (!gateway) {
      return res.status(404).json({ success: false, message: 'Gateway not found' });
    }
    res.json({
      success: true,
      gateway: {
        ...gateway,
        template: getTemplate(gateway.category, gateway.provider)
      },
      webhook_url: gateway.category === 'payment' ? getWebhookUrl(req) : null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', [
  body('display_name').optional().trim().isLength({ min: 2, max: 100 }),
  body('is_active').optional().isBoolean(),
  body('is_default').optional().isBoolean(),
  body('config').optional().isObject()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: errors.array()[0].msg });
  }

  try {
    const gateway = await GatewayConfigService.updateGateway(req.params.id, {
      display_name: req.body.display_name,
      is_active: req.body.is_active,
      is_default: req.body.is_default,
      config: req.body.config
    });
    res.json({ success: true, gateway, message: 'Gateway settings saved' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await GatewayConfigService.deleteGateway(req.params.id);
    res.json({ success: true, message: 'Gateway removed' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

router.post('/:id/test', async (req, res) => {
  try {
    const gateway = await GatewayConfigService.getById(req.params.id, { includeSecrets: true });
    if (!gateway) {
      return res.status(404).json({ success: false, message: 'Gateway not found' });
    }

    const template = getTemplate(gateway.category, gateway.provider);

    if (gateway.category === 'payment') {
      if (gateway.provider === 'flutterwave') {
        if (!FlutterwaveService.isActive()) {
          return res.status(400).json({ success: false, message: 'Flutterwave is inactive or missing credentials' });
        }
        await FlutterwaveService.getAccessToken();
        return res.json({ success: true, message: 'Flutterwave connection successful' });
      }
      return res.json({
        success: true,
        message: `${template?.display_name || gateway.display_name} settings saved. Payment adapter coming soon — configure credentials now for future use.`
      });
    }

    if (gateway.category === 'sms') {
      if (gateway.provider === 'egosms') {
        if (!SmsService.isActive()) {
          return res.status(400).json({ success: false, message: 'SMS gateway is inactive or missing credentials' });
        }
        const balance = await SmsService.getBalance();
        if (!balance.success) {
          return res.status(400).json({ success: false, message: balance.message || 'Balance check failed' });
        }
        return res.json({
          success: true,
          message: 'SMS gateway connection successful',
          balance: balance.balance,
          currency: balance.currency
        });
      }
      return res.json({
        success: true,
        message: `${template?.display_name || gateway.display_name} settings saved. SMS adapter coming soon — configure credentials now for future use.`
      });
    }

    if (gateway.category === 'email') {
      if (gateway.provider === 'smtp') {
        await MailService.verifyEmailConnection();
        return res.json({ success: true, message: 'SMTP connection verified successfully' });
      }
      return res.json({
        success: true,
        message: `${template?.display_name || gateway.display_name} settings saved. Email adapter coming soon — configure credentials now for future use.`
      });
    }

    res.status(400).json({ success: false, message: 'Unsupported gateway category' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;
