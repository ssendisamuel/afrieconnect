-- Message Center expansion (EgoSMS-style features)
-- Run once: mysql afrieconnect < db/migrate-sms-center.sql

ALTER TABLE campaigns
  MODIFY status ENUM('draft','queued','running','paused','completed','failed','cancelled') DEFAULT 'draft';

ALTER TABLE campaigns
  ADD COLUMN campaign_url VARCHAR(500) NULL AFTER message;

ALTER TABLE message_logs
  ADD COLUMN batch_id VARCHAR(36) NULL AFTER campaign_id,
  ADD COLUMN tracking_code VARCHAR(100) NULL AFTER error,
  ADD COLUMN cost DECIMAL(10,2) NULL AFTER tracking_code,
  ADD COLUMN currency VARCHAR(5) DEFAULT 'UGX' AFTER cost;

CREATE TABLE IF NOT EXISTS sms_inbox (
  id              BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  phone           VARCHAR(20) NOT NULL,
  message         TEXT NOT NULL,
  received_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_read         TINYINT(1) DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_user_received (user_id, received_at)
);
