const crypto = require('crypto');

function generateNonce(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let nonce = '';
  for (let i = 0; i < length; i++) {
    nonce += chars[bytes[i] % chars.length];
  }
  return nonce;
}

function encryptField(value, encryptionKey, nonce) {
  if (nonce.length !== 12) {
    throw new Error('Nonce must be exactly 12 characters long');
  }

  const key = Buffer.from(encryptionKey, 'base64');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, Buffer.from(nonce, 'utf8'));
  const encrypted = Buffer.concat([
    cipher.update(String(value), 'utf8'),
    cipher.final(),
    cipher.getAuthTag()
  ]);

  return encrypted.toString('base64');
}

module.exports = { generateNonce, encryptField };
