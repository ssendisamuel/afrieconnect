async function columnExists(pool, table, column) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) as n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  return rows[0].n > 0;
}

async function tableExists(pool, table) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) as n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows[0].n > 0;
}

async function runMigrations(pool) {
  try {
    await pool.query(`
      ALTER TABLE campaigns
      MODIFY status ENUM('draft','queued','running','paused','completed','failed','cancelled') DEFAULT 'draft'
    `);
  } catch (err) {
    if (!/Duplicate|already exists/i.test(err.message)) {
      console.warn('[Migrate] campaigns status:', err.message);
    }
  }

  if (!(await columnExists(pool, 'campaigns', 'campaign_url'))) {
    await pool.query('ALTER TABLE campaigns ADD COLUMN campaign_url VARCHAR(500) NULL AFTER message');
  }

  for (const col of ['batch_id', 'tracking_code', 'cost', 'currency']) {
    if (!(await columnExists(pool, 'message_logs', col))) {
      const defs = {
        batch_id: 'VARCHAR(36) NULL AFTER campaign_id',
        tracking_code: 'VARCHAR(100) NULL AFTER error',
        cost: 'DECIMAL(10,2) NULL AFTER tracking_code',
        currency: "VARCHAR(5) DEFAULT 'UGX' AFTER cost"
      };
      await pool.query(`ALTER TABLE message_logs ADD COLUMN ${col} ${defs[col]}`);
    }
  }

  if (!(await tableExists(pool, 'sms_inbox'))) {
    await pool.query(`
      CREATE TABLE sms_inbox (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        phone VARCHAR(20) NOT NULL,
        message TEXT NOT NULL,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        is_read TINYINT(1) DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_received (user_id, received_at)
      )
    `);
  }

  if (!(await columnExists(pool, 'users', 'wallet_balance'))) {
    await pool.query('ALTER TABLE users ADD COLUMN wallet_balance DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER sms_credits');
    const rate = parseFloat(process.env.SMS_RATE_UGX || '40');
    await pool.query('UPDATE users SET wallet_balance = sms_credits * ? WHERE sms_credits > 0', [rate]);
  }

  if (!(await tableExists(pool, 'wallet_transactions'))) {
    await pool.query(`
      CREATE TABLE wallet_transactions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type VARCHAR(40) NOT NULL,
        amount DECIMAL(12,2) NOT NULL,
        balance_after DECIMAL(12,2) NOT NULL,
        reference VARCHAR(100) NULL,
        description VARCHAR(255) NULL,
        meta JSON NULL,
        created_by INT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_created (user_id, created_at),
        INDEX idx_type (type)
      )
    `);
  }

  if (!(await tableExists(pool, 'payment_transactions'))) {
    await pool.query(`
      CREATE TABLE payment_transactions (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        tx_ref VARCHAR(100) NOT NULL UNIQUE,
        flw_ref VARCHAR(100) NULL,
        amount DECIMAL(12,2) NOT NULL,
        currency VARCHAR(5) DEFAULT 'UGX',
        network ENUM('MTN','AIRTEL') NULL,
        phone VARCHAR(20) NULL,
        status ENUM('pending','successful','failed','cancelled') DEFAULT 'pending',
        provider_response JSON NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_status (user_id, status)
      )
    `);
  }

  if (await tableExists(pool, 'payment_transactions')) {
    try {
      await pool.query(`
        ALTER TABLE payment_transactions
        MODIFY network VARCHAR(20) NULL
      `);
    } catch (_) {
      // Column may already be updated
    }
  }

  if (!(await tableExists(pool, 'integration_gateways'))) {
    await pool.query(`
      CREATE TABLE integration_gateways (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category ENUM('payment','sms','email') NOT NULL,
        provider VARCHAR(50) NOT NULL,
        display_name VARCHAR(100) NOT NULL,
        config JSON NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        is_default TINYINT(1) NOT NULL DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uq_category_provider (category, provider)
      )
    `);
  } else {
    try {
      await pool.query(`
        ALTER TABLE integration_gateways
        MODIFY category ENUM('payment','sms','email') NOT NULL
      `);
    } catch (_) {
      // Already updated
    }
  }

  if (!(await tableExists(pool, 'user_sender_ids'))) {
    await pool.query(`
      CREATE TABLE user_sender_ids (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        sender_id VARCHAR(11) NOT NULL,
        status ENUM('pending','approved','rejected') DEFAULT 'pending',
        notes VARCHAR(255) NULL,
        reviewed_by INT NULL,
        reviewed_at DATETIME NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY uq_user_sender (user_id, sender_id),
        INDEX idx_status (status)
      )
    `);
  }
}

module.exports = { runMigrations };
