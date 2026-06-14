function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function validateProductionConfig() {
  if (!isProduction()) return;

  const secret = process.env.JWT_SECRET || '';
  if (!secret || secret.length < 32 || secret.includes('CHANGE_THIS')) {
    throw new Error('Production requires JWT_SECRET (min 32 chars) in .env');
  }

  const webhookSecret = process.env.FLUTTERWAVE_WEBHOOK_SECRET || '';
  if (!webhookSecret || webhookSecret.includes('YOUR_')) {
    throw new Error('Production requires FLUTTERWAVE_WEBHOOK_SECRET in .env');
  }
}

function allowMockIntegrations() {
  return !isProduction() && process.env.ALLOW_MOCK_INTEGRATIONS !== 'false';
}

module.exports = { isProduction, validateProductionConfig, allowMockIntegrations };
