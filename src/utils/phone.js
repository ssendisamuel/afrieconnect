function normalizePhone(phone) {
  if (!phone) return '';
  let number = String(phone).replace(/\D/g, '');

  if (number.length === 10 && number.startsWith('0')) {
    number = '256' + number.slice(1);
  }

  if (number.length === 9 && number.startsWith('7')) {
    number = '256' + number;
  }

  if (number.startsWith('00')) {
    number = number.slice(2);
  }

  return number;
}

function toWhatsAppJid(phone) {
  const normalized = normalizePhone(phone);
  return `${normalized}@s.whatsapp.net`;
}

module.exports = { normalizePhone, toWhatsAppJid };
