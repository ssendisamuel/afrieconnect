const { smsParts } = require('./smsParts');

const DEFAULT_RATE = parseFloat(process.env.SMS_RATE_UGX || '40');

function planRate(plan) {
  const rates = {
    free: parseFloat(process.env.SMS_RATE_FREE || '30'),
    starter: parseFloat(process.env.SMS_RATE_STARTER || '30'),
    business: parseFloat(process.env.SMS_RATE_BUSINESS || '25'),
    enterprise: parseFloat(process.env.SMS_RATE_ENTERPRISE || '25')
  };
  return rates[plan] || DEFAULT_RATE;
}

function estimateSendCost(message, recipientCount, plan = 'starter') {
  const parts = smsParts(message);
  const rate = planRate(plan);
  const unitCost = parts * rate;
  return {
    parts,
    rate,
    unitCost,
    totalCost: unitCost * recipientCount,
    recipientCount
  };
}

function costFromApiResponse(result, parts, plan = 'starter') {
  const parsed = parseFloat(result?.cost);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return parts * planRate(plan);
}

module.exports = {
  DEFAULT_RATE,
  planRate,
  estimateSendCost,
  costFromApiResponse,
  smsParts
};
