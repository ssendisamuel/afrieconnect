const pool = require('../config/db');

async function getBalance(userId) {
  const [rows] = await pool.query(
    'SELECT wallet_balance, plan FROM users WHERE id = ?',
    [userId]
  );
  if (!rows.length) throw new Error('User not found');
  return {
    balance: parseFloat(rows[0].wallet_balance) || 0,
    plan: rows[0].plan
  };
}

async function credit(userId, amount, meta = {}) {
  const value = parseFloat(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Invalid credit amount');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
      [value, userId]
    );
    const [rows] = await conn.query('SELECT wallet_balance FROM users WHERE id = ?', [userId]);
    await conn.query(
      `INSERT INTO wallet_transactions
       (user_id, type, amount, balance_after, reference, description, meta, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        meta.type || 'credit',
        value,
        rows[0].wallet_balance,
        meta.reference || null,
        meta.description || null,
        meta.meta ? JSON.stringify(meta.meta) : null,
        meta.createdBy || null
      ]
    );
    await conn.commit();
    return parseFloat(rows[0].wallet_balance);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function debit(userId, amount, meta = {}) {
  const value = parseFloat(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error('Invalid debit amount');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [users] = await conn.query(
      'SELECT wallet_balance FROM users WHERE id = ? FOR UPDATE',
      [userId]
    );
    if (!users.length) throw new Error('User not found');

    const current = parseFloat(users[0].wallet_balance) || 0;
    if (current < value) {
      throw new Error(`Insufficient wallet balance. Need UGX ${value.toLocaleString()}, you have UGX ${current.toLocaleString()}.`);
    }

    await conn.query(
      'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
      [value, userId]
    );
    const balanceAfter = current - value;
    await conn.query(
      `INSERT INTO wallet_transactions
       (user_id, type, amount, balance_after, reference, description, meta, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        meta.type || 'debit',
        -value,
        balanceAfter,
        meta.reference || null,
        meta.description || null,
        meta.meta ? JSON.stringify(meta.meta) : null,
        meta.createdBy || null
      ]
    );
    await conn.commit();
    return balanceAfter;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listTransactions(userId, { limit = 50, offset = 0 } = {}) {
  const [rows] = await pool.query(
    `SELECT * FROM wallet_transactions WHERE user_id = ?
     ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [userId, limit, offset]
  );
  return rows;
}

async function platformStats() {
  const [[users]] = await pool.query("SELECT COUNT(*) as total FROM users WHERE role = 'user'");
  const [[active]] = await pool.query("SELECT COUNT(*) as total FROM users WHERE role = 'user' AND status = 'active'");
  const [[liability]] = await pool.query("SELECT COALESCE(SUM(wallet_balance), 0) as total FROM users WHERE role = 'user'");
  const [[topupsToday]] = await pool.query(
    `SELECT COALESCE(SUM(amount), 0) as total FROM wallet_transactions
     WHERE amount > 0 AND DATE(created_at) = CURDATE()`
  );
  const [[spentToday]] = await pool.query(
    `SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM wallet_transactions
     WHERE amount < 0 AND type LIKE 'sms%' AND DATE(created_at) = CURDATE()`
  );
  const [[pendingPayments]] = await pool.query(
    "SELECT COUNT(*) as total FROM payment_transactions WHERE status = 'pending'"
  );

  return {
    total_users: users.total,
    active_users: active.total,
    wallet_liability: parseFloat(liability.total) || 0,
    topups_today: parseFloat(topupsToday.total) || 0,
    sms_spend_today: parseFloat(spentToday.total) || 0,
    pending_payments: pendingPayments.total
  };
}

module.exports = {
  getBalance,
  credit,
  debit,
  listTransactions,
  platformStats
};
