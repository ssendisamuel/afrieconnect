const express = require('express');
const bcrypt = require('bcrypt');
const { body, validationResult } = require('express-validator');
const pool = require('../config/db');
const { authMiddleware } = require('../middleware/auth');
const { loginLimiter, registerLimiter, resendVerificationLimiter } = require('../middleware/rateLimiter');
const { signToken, generateToken, generateApiKey } = require('../utils/token');
const MailService = require('../services/MailService');

const router = express.Router();
const SALT_ROUNDS = 12;

const emailValidator = body('email').isEmail().trim().normalizeEmail({ gmail_remove_dots: false });

router.post('/register', registerLimiter, [
  body('name').trim().isLength({ min: 2, max: 100 }),
  emailValidator,
  body('password').isLength({ min: 8 }),
  body('phone').optional().trim()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { name, email, password, phone } = req.body;

  try {
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.length) {
      return res.status(400).json({ success: false, message: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const verifyToken = generateToken(24);
    const apiKey = generateApiKey();

    await pool.query(
      `INSERT INTO users (name, email, password_hash, phone, verify_token, api_key, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [name, email, passwordHash, phone || null, verifyToken, apiKey]
    );

    const [user] = await pool.query('SELECT id, name, email FROM users WHERE email = ?', [email]);
    const mailResult = await MailService.sendVerificationEmail(user[0], verifyToken, req);
    if (!mailResult.success) {
      console.error('[Auth] Verification email was not sent:', mailResult.error || 'unknown error');
    }

    res.status(201).json({
      success: true,
      message: mailResult.success
        ? 'Registration successful. Please check your email to verify your account.'
        : 'Registration successful, but we could not send the verification email. Contact support or try again later.'
    });
  } catch (err) {
    console.error('[Auth] Register error:', err);
    res.status(500).json({ success: false, message: 'Registration failed' });
  }
});

router.post('/resend-verification', resendVerificationLimiter, [
  emailValidator,
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    if (user.email_verified && user.status === 'active') {
      return res.json({ success: true, message: 'Your account is already verified. You can log in now.' });
    }

    let verifyToken = user.verify_token;
    if (!verifyToken) {
      verifyToken = generateToken(24);
      await pool.query('UPDATE users SET verify_token = ?, status = ? WHERE id = ?', [
        verifyToken, 'pending', user.id
      ]);
    }

    const mailResult = await MailService.sendVerificationEmail(
      { id: user.id, name: user.name, email: user.email },
      verifyToken,
      req
    );

    if (!mailResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Could not send verification email. Try again later or contact support.'
      });
    }

    res.json({ success: true, message: 'Verification email sent. Please check your inbox and spam folder.' });
  } catch (err) {
    console.error('[Auth] Resend verification error:', err.message);
    res.status(500).json({ success: false, message: 'Could not resend verification email' });
  }
});

router.get('/verify-email/:token', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, name, email FROM users WHERE verify_token = ?',
      [req.params.token]
    );

    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'Invalid or expired verification link' });
    }

    await pool.query(
      `UPDATE users SET email_verified = 1, status = 'active', verify_token = NULL WHERE id = ?`,
      [rows[0].id]
    );

    await MailService.sendWelcomeEmail(rows[0], req);
    res.json({ success: true, message: 'Email verified successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Verification failed' });
  }
});

router.post('/login', loginLimiter, [
  emailValidator,
  body('password').notEmpty()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, errors: errors.array() });
  }

  const { email, password } = req.body;

  try {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (!rows.length) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const user = rows[0];

    if (user.status === 'pending' || !user.email_verified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in',
        code: 'EMAIL_NOT_VERIFIED'
      });
    }

    if (user.status === 'suspended') {
      return res.status(403).json({ success: false, message: 'Account suspended' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = signToken({ id: user.id, email: user.email, role: user.role });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        plan: user.plan,
        sms_credits: user.wallet_balance ?? user.sms_credits,
        wallet_balance: parseFloat(user.wallet_balance) || 0,
        api_key: user.api_key
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

router.post('/forgot-password', [emailValidator], async (req, res) => {
  const { email } = req.body;

  try {
    const [rows] = await pool.query('SELECT id, name, email FROM users WHERE email = ?', [email]);

    if (rows.length) {
      const resetToken = generateToken(24);
      const resetExpires = new Date(Date.now() + 60 * 60 * 1000);
      await pool.query(
        'UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?',
        [resetToken, resetExpires, rows[0].id]
      );
      await MailService.sendPasswordResetEmail(rows[0], resetToken, req);
    }

    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Request failed' });
  }
});

router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 8 })
], async (req, res) => {
  const { token, password } = req.body;

  try {
    const [rows] = await pool.query(
      'SELECT id FROM users WHERE reset_token = ? AND reset_expires > NOW()',
      [token]
    );

    if (!rows.length) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query(
      'UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
      [passwordHash, rows[0].id]
    );

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Reset failed' });
  }
});

router.get('/me', authMiddleware, (req, res) => {
  res.json({ success: true, user: req.user });
});

router.put('/me', authMiddleware, [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('phone').optional().trim()
], async (req, res) => {
  const { name, phone } = req.body;

  try {
    await pool.query('UPDATE users SET name = COALESCE(?, name), phone = COALESCE(?, phone) WHERE id = ?', [
      name || null, phone || null, req.user.id
    ]);

    const [rows] = await pool.query(
      'SELECT id, name, email, phone, role, plan, sms_credits, wallet_balance, api_key FROM users WHERE id = ?',
      [req.user.id]
    );

    res.json({ success: true, user: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Update failed' });
  }
});

router.put('/change-password', authMiddleware, [
  body('current').notEmpty(),
  body('new').isLength({ min: 8 })
], async (req, res) => {
  const { current, new: newPassword } = req.body;

  try {
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    const valid = await bcrypt.compare(current, rows[0].password_hash);

    if (!valid) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.user.id]);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Password change failed' });
  }
});

router.post('/regenerate-api-key', authMiddleware, async (req, res) => {
  const apiKey = generateApiKey();
  await pool.query('UPDATE users SET api_key = ? WHERE id = ?', [apiKey, req.user.id]);
  res.json({ success: true, api_key: apiKey });
});

module.exports = router;
