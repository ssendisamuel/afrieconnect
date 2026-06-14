function smsParts(text) {
  if (!text || !text.length) return 0;
  return Math.ceil(text.length / 160);
}

function smsStats(text) {
  const chars = text ? text.length : 0;
  const parts = smsParts(text);
  return { chars, parts };
}

module.exports = { smsParts, smsStats };
