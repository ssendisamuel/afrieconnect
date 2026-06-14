CREATE DATABASE IF NOT EXISTS afrieconnect CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE afrieconnect;

CREATE TABLE users (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(100)  NOT NULL,
  email           VARCHAR(150)  NOT NULL UNIQUE,
  password_hash   VARCHAR(255)  NOT NULL,
  phone           VARCHAR(20)   NULL,
  role            ENUM('admin','user') DEFAULT 'user',
  status          ENUM('pending','active','suspended') DEFAULT 'pending',
  email_verified  TINYINT(1)    DEFAULT 0,
  verify_token    VARCHAR(100)  NULL,
  reset_token     VARCHAR(100)  NULL,
  reset_expires   DATETIME      NULL,
  api_key         VARCHAR(64)   NULL UNIQUE,
  sms_credits     INT           DEFAULT 0,
  plan            ENUM('free','starter','business','enterprise') DEFAULT 'free',
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE wa_sessions (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT           NOT NULL,
  sender_name     VARCHAR(100)  NULL,
  phone_number    VARCHAR(20)   NULL,
  display_name    VARCHAR(100)  NULL,
  status          ENUM('disconnected','connecting','connected','banned','pending_qr') DEFAULT 'pending_qr',
  connected_at    DATETIME      NULL,
  last_active     DATETIME      NULL,
  messages_sent   INT           DEFAULT 0,
  daily_limit     INT           DEFAULT 200,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE contact_lists (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT           NOT NULL,
  name            VARCHAR(100)  NOT NULL,
  description     VARCHAR(255)  NULL,
  contact_count   INT           DEFAULT 0,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE contacts (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  list_id         INT           NOT NULL,
  user_id         INT           NOT NULL,
  name            VARCHAR(100)  NULL,
  phone           VARCHAR(20)   NOT NULL,
  email           VARCHAR(150)  NULL,
  has_number      TINYINT(1)    DEFAULT 1,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (list_id)  REFERENCES contact_lists(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_list_phone (list_id, phone)
);

CREATE TABLE templates (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT           NOT NULL,
  name            VARCHAR(100)  NOT NULL,
  message         TEXT          NOT NULL,
  channel         ENUM('whatsapp','sms','both') DEFAULT 'both',
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE campaigns (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT           NOT NULL,
  list_id         INT           NULL,
  name            VARCHAR(150)  NOT NULL,
  message         TEXT          NOT NULL,
  media_path      VARCHAR(255)  NULL,
  media_filename  VARCHAR(255)  NULL,
  media_mimetype  VARCHAR(100)  NULL,
  channel         ENUM('whatsapp','sms') NOT NULL,
  sender_mode     ENUM('all','selected') DEFAULT 'all',
  sender_ids      JSON          NULL,
  status          ENUM('draft','queued','running','paused','completed','failed') DEFAULT 'draft',
  delay_seconds   INT           DEFAULT 6,
  daily_cap       INT           DEFAULT 200,
  total_contacts  INT           DEFAULT 0,
  sent_count      INT           DEFAULT 0,
  failed_count    INT           DEFAULT 0,
  scheduled_at    DATETIME      NULL,
  started_at      DATETIME      NULL,
  completed_at    DATETIME      NULL,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)  REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (list_id)  REFERENCES contact_lists(id) ON DELETE SET NULL
);

CREATE TABLE message_logs (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  campaign_id     INT           NULL,
  user_id         INT           NOT NULL,
  phone           VARCHAR(20)   NOT NULL,
  name            VARCHAR(100)  NULL,
  channel         ENUM('whatsapp','sms') NOT NULL,
  wa_session_id   INT           NULL,
  message         TEXT          NOT NULL,
  status          ENUM('queued','sent','failed','delivered') DEFAULT 'queued',
  error           VARCHAR(255)  NULL,
  sent_at         DATETIME      NULL,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE SET NULL,
  FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_status (user_id, status),
  INDEX idx_campaign (campaign_id)
);

CREATE TABLE otp_codes (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT           NOT NULL,
  phone           VARCHAR(20)   NOT NULL,
  otp_code        VARCHAR(8)    NOT NULL,
  app_name        VARCHAR(50)   NULL,
  channel         ENUM('whatsapp','sms') DEFAULT 'whatsapp',
  expires_at      DATETIME      NOT NULL,
  verified        TINYINT(1)    DEFAULT 0,
  attempts        INT           DEFAULT 0,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_phone_code (phone, otp_code)
);

CREATE TABLE platform_sms_log (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  admin_id        INT           NOT NULL,
  recipients      TEXT          NOT NULL,
  message         TEXT          NOT NULL,
  sender_id       VARCHAR(11)   DEFAULT 'AfrieCon',
  status          VARCHAR(20)   NULL,
  cost            DECIMAL(10,2) NULL,
  currency        VARCHAR(5)    NULL,
  tracking_code   VARCHAR(100)  NULL,
  sent_at         DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id)
);

CREATE TABLE notifications (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT           NOT NULL,
  title           VARCHAR(150)  NOT NULL,
  body            TEXT          NOT NULL,
  type            VARCHAR(30)   DEFAULT 'info',
  is_read         TINYINT(1)    DEFAULT 0,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Extended columns/tables applied by src/utils/migrate.js on startup:
-- users.wallet_balance, campaigns.campaign_url, campaigns.status (+cancelled),
-- message_logs.batch_id, tracking_code, cost, currency,
-- wallet_transactions, payment_transactions, integration_gateways,
-- sms_inbox, user_sender_ids
