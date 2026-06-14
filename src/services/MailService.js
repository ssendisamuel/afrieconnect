const nodemailer = require('nodemailer');
const GatewayConfigService = require('./GatewayConfigService');
const { getAppUrl } = require('../utils/appUrl');

const APP_NAME = process.env.APP_NAME || 'AfrieConnect';

function baseTemplate(title, body) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:Arial,sans-serif;background:#f5f7fa;margin:0;padding:24px;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <h1 style="color:#1B6CA8;margin:0 0 8px;font-size:24px;">${APP_NAME}</h1>
    <p style="color:#666;margin:0 0 24px;">Connect. Send. Grow.</p>
    ${body}
    <hr style="border:none;border-top:1px solid #e0e6ed;margin:24px 0;">
    <p style="color:#999;font-size:12px;margin:0;">&copy; ${new Date().getFullYear()} ${APP_NAME}. All rights reserved.</p>
  </div>
</body>
</html>`;
}

function getActiveEmailGateway() {
  return GatewayConfigService.getActiveGatewaySync('email');
}

function getFromAddress(config, gateway) {
  if (config.smtp_from) return config.smtp_from;
  if (config.from_email && config.from_name) return `${config.from_name} <${config.from_email}>`;
  if (config.from_email) return config.from_email;
  return `${APP_NAME} <noreply@afriezon.com>`;
}

function buildTransporter(gateway) {
  if (!gateway) return null;
  const cfg = gateway.config || {};

  if (gateway.provider === 'smtp') {
    if (!cfg.smtp_host || !cfg.smtp_user || !cfg.smtp_pass) return null;
    return nodemailer.createTransport({
      host: cfg.smtp_host,
      port: parseInt(cfg.smtp_port || '587', 10),
      secure: String(cfg.smtp_secure).toLowerCase() === 'true',
      auth: { user: cfg.smtp_user, pass: cfg.smtp_pass }
    });
  }

  if (gateway.provider === 'sendgrid' && cfg.api_key) {
    return nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: { user: 'apikey', pass: cfg.api_key }
    });
  }

  return null;
}

function isEmailConfigured() {
  const gateway = getActiveEmailGateway();
  if (!gateway || !gateway.is_active) return false;
  return Boolean(buildTransporter(gateway));
}

async function verifyEmailConnection() {
  const gateway = getActiveEmailGateway();
  const transporter = buildTransporter(gateway);
  if (!transporter) {
    throw new Error('Email gateway is inactive or missing required credentials');
  }
  await transporter.verify();
  return { success: true, message: 'SMTP connection verified' };
}

async function sendMail({ to, subject, html }) {
  const gateway = getActiveEmailGateway();
  const transporter = buildTransporter(gateway);

  if (!transporter) {
    console.warn(`[MailService] Email not configured — message not sent to ${to}: ${subject}`);
    return { success: false, mock: true, error: 'Email gateway not configured' };
  }

  try {
    const from = getFromAddress(gateway.config, gateway);
    const info = await transporter.sendMail({ from, to, subject, html });
    console.log(`[MailService] Sent to ${to}: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error(`[MailService] Failed to send to ${to}:`, err.message);
    throw err;
  }
}

async function sendVerificationEmail(user, token, req) {
  const appUrl = getAppUrl(req);
  const link = `${appUrl}/verify-email.html?token=${token}`;
  const html = baseTemplate(
    'Verify your account',
    `<p>Hello ${user.name},</p>
     <p>Please verify your email address to activate your ${APP_NAME} account.</p>
     <p style="text-align:center;margin:32px 0;">
       <a href="${link}" style="background:#1B6CA8;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Verify Email</a>
     </p>
     <p style="color:#666;font-size:14px;">This link expires in 24 hours. If you did not create an account, ignore this email.</p>`
  );
  return sendMail({ to: user.email, subject: `Verify your ${APP_NAME} account`, html });
}

async function sendPasswordResetEmail(user, token, req) {
  const appUrl = getAppUrl(req);
  const link = `${appUrl}/reset-password.html?token=${token}`;
  const html = baseTemplate(
    'Reset your password',
    `<p>Hello ${user.name},</p>
     <p>We received a request to reset your password.</p>
     <p style="text-align:center;margin:32px 0;">
       <a href="${link}" style="background:#1B6CA8;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a>
     </p>
     <p style="color:#666;font-size:14px;">This link expires in 1 hour.</p>`
  );
  return sendMail({ to: user.email, subject: `Reset your ${APP_NAME} password`, html });
}

async function sendWelcomeEmail(user, req) {
  const appUrl = getAppUrl(req);
  const html = baseTemplate(
    'Welcome!',
    `<p>Hello ${user.name},</p>
     <p>Welcome to ${APP_NAME}! Your account is now active.</p>
     <h3 style="color:#1B6CA8;">Quick Start Guide</h3>
     <ol>
       <li>Connect your WhatsApp number via QR code</li>
       <li>Import your contacts from CSV</li>
       <li>Launch your first campaign</li>
     </ol>
     <p style="text-align:center;margin:32px 0;">
       <a href="${appUrl}/app/index.html" style="background:#25D366;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">Go to Dashboard</a>
     </p>`
  );
  return sendMail({ to: user.email, subject: `Welcome to ${APP_NAME}!`, html });
}

module.exports = {
  sendMail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendWelcomeEmail,
  isEmailConfigured,
  isSmtpConfigured: isEmailConfigured,
  verifyEmailConnection
};
