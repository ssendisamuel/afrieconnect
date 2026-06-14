USE afrieconnect;

ALTER TABLE campaigns
  ADD COLUMN media_path VARCHAR(255) NULL AFTER message,
  ADD COLUMN media_filename VARCHAR(255) NULL AFTER media_path,
  ADD COLUMN media_mimetype VARCHAR(100) NULL AFTER media_filename;
