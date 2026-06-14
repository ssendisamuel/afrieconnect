-- Multi-sender WhatsApp migration
USE afrieconnect;

ALTER TABLE wa_sessions
  ADD COLUMN sender_name VARCHAR(100) NULL AFTER user_id,
  MODIFY COLUMN status ENUM('disconnected','connecting','connected','banned','pending_qr') DEFAULT 'pending_qr';

UPDATE wa_sessions SET sender_name = COALESCE(display_name, CONCAT('Sender ', id)) WHERE sender_name IS NULL;

ALTER TABLE campaigns
  ADD COLUMN sender_mode ENUM('all','selected') DEFAULT 'all' AFTER channel,
  ADD COLUMN sender_ids JSON NULL AFTER sender_mode;

ALTER TABLE message_logs
  ADD COLUMN wa_session_id INT NULL AFTER channel;
