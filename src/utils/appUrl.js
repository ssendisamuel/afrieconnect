function isLocalUrl(url) {
  return !url || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url);
}

function getAppUrl(req) {
  const envUrl = (process.env.APP_URL || '').replace(/\/$/, '');
  const preferRequest = process.env.APP_URL_DYNAMIC !== 'false';

  if (req && preferRequest) {
    const forwardedProto = req.get('x-forwarded-proto');
    const proto = forwardedProto
      ? forwardedProto.split(',')[0].trim()
      : (req.protocol || 'http');
    const host = (req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();

    if (host && (!envUrl || isLocalUrl(envUrl))) {
      return `${proto}://${host}`.replace(/\/$/, '');
    }
  }

  return envUrl || 'http://localhost:3600';
}

function getWebhookUrl(req) {
  return `${getAppUrl(req)}/api/payments/webhook`;
}

module.exports = { getAppUrl, getWebhookUrl, isLocalUrl };
