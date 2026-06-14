const pool = require('../config/db');
const WhatsAppManager = require('./WhatsAppManager');
const SmsService = require('./SmsService');
const { personalizeMessage } = require('../utils/csv');
const { mediaTypeLabel } = require('../utils/waMedia');
const { smsParts } = require('../utils/smsParts');
const { costFromApiResponse } = require('../utils/smsCost');
const WalletService = require('./WalletService');

class CampaignRunner {
  constructor() {
    this.active = new Map();
    this.io = null;
  }

  setIO(io) {
    this.io = io;
  }

  emitProgress(userId, campaign) {
    if (this.io) {
      this.io.to(String(userId)).emit('campaign:progress', {
        id: campaign.id,
        sent: campaign.sent_count,
        failed: campaign.failed_count,
        total: campaign.total_contacts,
        status: campaign.status
      });
    }
  }

  async getTodaySentCount(campaignId) {
    const [rows] = await pool.query(
      `SELECT COUNT(*) as count FROM message_logs
       WHERE campaign_id = ? AND status = 'sent' AND DATE(sent_at) = CURDATE()`,
      [campaignId]
    );
    return rows[0].count;
  }

  campaignMedia(campaign) {
    if (!campaign.media_path) return null;
    return {
      path: campaign.media_path,
      filename: campaign.media_filename,
      mimetype: campaign.media_mimetype
    };
  }

  logMessageText(campaign, personalizedMessage) {
    if (campaign.media_path) {
      const label = mediaTypeLabel(campaign.media_mimetype) || 'Attachment';
      const caption = personalizedMessage?.trim();
      return caption ? `[${label}] ${caption}` : `[${label}] ${campaign.media_filename || ''}`.trim();
    }
    return personalizedMessage;
  }

  async loadContacts(campaign) {
    let contacts = [];

    if (campaign.list_id) {
      const [rows] = await pool.query(
        'SELECT id, name, phone FROM contacts WHERE list_id = ? AND user_id = ?',
        [campaign.list_id, campaign.user_id]
      );
      contacts = rows.map(r => ({ logId: null, name: r.name, phone: r.phone }));
    } else {
      const [rows] = await pool.query(
        "SELECT id, name, phone FROM message_logs WHERE campaign_id = ? AND status = 'queued'",
        [campaign.id]
      );
      contacts = rows.map(r => ({ logId: r.id, name: r.name, phone: r.phone }));
    }

    const [sentRows] = await pool.query(
      "SELECT phone FROM message_logs WHERE campaign_id = ? AND status = 'sent'",
      [campaign.id]
    );
    const sentPhones = new Set(sentRows.map(r => r.phone));

    return contacts.filter(c => !sentPhones.has(c.phone));
  }

  async logResult(campaign, contact, message, result, error = null) {
    const channel = campaign.channel;

    if (contact.logId) {
      if (error) {
        await pool.query(
          `UPDATE message_logs SET status = 'failed', error = ?, message = ? WHERE id = ?`,
          [error, message, contact.logId]
        );
      } else if (channel === 'whatsapp') {
        await pool.query(
          `UPDATE message_logs SET status = 'sent', wa_session_id = ?, message = ?, sent_at = NOW(), error = NULL
           WHERE id = ?`,
          [result.sender_id, message, contact.logId]
        );
      } else {
        await pool.query(
          `UPDATE message_logs SET status = 'sent', message = ?, tracking_code = ?, cost = ?, currency = ?, sent_at = NOW(), error = NULL
           WHERE id = ?`,
          [
            message,
            result?.tracking_code || null,
            result?.cost ? parseFloat(result.cost) : null,
            result?.currency || 'UGX',
            contact.logId
          ]
        );
      }
      return;
    }

    if (error) {
      await pool.query(
        `INSERT INTO message_logs (campaign_id, user_id, phone, name, channel, message, status, error)
         VALUES (?, ?, ?, ?, ?, ?, 'failed', ?)`,
        [campaign.id, campaign.user_id, contact.phone, contact.name, channel, message, error]
      );
    } else if (channel === 'whatsapp') {
      await pool.query(
        `INSERT INTO message_logs (campaign_id, user_id, phone, name, channel, wa_session_id, message, status, sent_at)
         VALUES (?, ?, ?, ?, 'whatsapp', ?, ?, 'sent', NOW())`,
        [campaign.id, campaign.user_id, contact.phone, contact.name, result.sender_id, message]
      );
    } else {
      await pool.query(
        `INSERT INTO message_logs (campaign_id, user_id, phone, name, channel, message, status, tracking_code, cost, currency, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, NOW())`,
        [
          campaign.id, campaign.user_id, contact.phone, contact.name, channel, message,
          result?.tracking_code || null,
          result?.cost ? parseFloat(result.cost) : null,
          result?.currency || 'UGX'
        ]
      );
    }
  }

  async runCampaign(campaignId) {
    campaignId = Number(campaignId);

    if (this.active.has(campaignId)) {
      return { success: false, message: 'Campaign already running' };
    }

    const [campaigns] = await pool.query('SELECT * FROM campaigns WHERE id = ?', [campaignId]);
    if (!campaigns.length) throw new Error('Campaign not found');

    const campaign = campaigns[0];
    const contacts = await this.loadContacts(campaign);

    if (!contacts.length) {
      const [counts] = await pool.query(
        'SELECT sent_count, failed_count, total_contacts FROM campaigns WHERE id = ?',
        [campaignId]
      );
      const done = counts[0].sent_count + counts[0].failed_count >= counts[0].total_contacts;
      if (done) {
        await pool.query("UPDATE campaigns SET status = 'completed', completed_at = NOW() WHERE id = ?", [campaignId]);
        return { success: true, status: 'completed', message: 'Campaign already completed' };
      }
      await pool.query("UPDATE campaigns SET status = 'failed' WHERE id = ?", [campaignId]);
      throw new Error('No contacts remaining in campaign');
    }

    if (campaign.status !== 'running') {
      await pool.query(
        `UPDATE campaigns SET status = 'running', started_at = COALESCE(started_at, NOW()), total_contacts = GREATEST(total_contacts, ?) WHERE id = ?`,
        [contacts.length + campaign.sent_count + campaign.failed_count, campaignId]
      );
      campaign.status = 'running';
    }

    const control = { paused: false, stopped: false };
    this.active.set(campaignId, control);

    this.emitProgress(campaign.user_id, campaign);

    const smsSenderId = process.env.EGOSMS_SENDER_ID || 'AfrieCon';
    const dailyCap = campaign.daily_cap || 200;
    const media = this.campaignMedia(campaign);

    let senderIds = null;
    if (campaign.sender_mode === 'selected' && campaign.sender_ids) {
      senderIds = typeof campaign.sender_ids === 'string'
        ? JSON.parse(campaign.sender_ids)
        : campaign.sender_ids;
    }

    for (let i = 0; i < contacts.length; i++) {
      const contact = contacts[i];

      if (control.stopped) break;

      while (control.paused) {
        await new Promise(r => setTimeout(r, 1000));
        if (control.stopped) break;
      }
      if (control.stopped) break;

      const [fresh] = await pool.query(
        'SELECT sent_count, status, delay_seconds, daily_cap FROM campaigns WHERE id = ?',
        [campaignId]
      );
      campaign.sent_count = fresh[0].sent_count;
      campaign.delay_seconds = fresh[0].delay_seconds ?? campaign.delay_seconds;
      campaign.daily_cap = fresh[0].daily_cap ?? campaign.daily_cap;

      if (fresh[0].status === 'paused') {
        control.paused = true;
        while (control.paused && !control.stopped) {
          await new Promise(r => setTimeout(r, 1000));
        }
        if (control.stopped) break;
      }

      const todaySent = await this.getTodaySentCount(campaignId);
      if (todaySent >= (campaign.daily_cap || 200)) {
        await pool.query("UPDATE campaigns SET status = 'paused' WHERE id = ?", [campaignId]);
        control.paused = true;
        break;
      }

      const personalized = personalizeMessage(campaign.message, contact, {
        campaignLink: campaign.campaign_url || ''
      });
      const message = this.logMessageText(campaign, personalized);

      try {
        let result = null;

        if (campaign.channel === 'whatsapp') {
          result = await WhatsAppManager.sendWithRotation(
            campaign.user_id, contact.phone, personalized, senderIds, media
          );
        } else {
          const parts = smsParts(message);
          const [user] = await pool.query('SELECT wallet_balance, plan FROM users WHERE id = ?', [campaign.user_id]);
          const charge = costFromApiResponse(null, parts, user[0].plan);
          if (parseFloat(user[0].wallet_balance) < charge) throw new Error('Insufficient wallet balance');
          result = await SmsService.sendSingle(contact.phone, message, smsSenderId);
          if (!result.success) throw new Error(result.message || 'SMS send failed');
          const actualCharge = costFromApiResponse(result, parts, user[0].plan);
          await WalletService.debit(campaign.user_id, actualCharge, {
            type: 'sms_campaign',
            reference: result.tracking_code || String(campaign.id),
            description: `Campaign SMS to ${contact.phone}`,
            meta: { campaign_id: campaign.id, parts }
          });
          result.cost = actualCharge;
        }

        await this.logResult(campaign, contact, message, result);

        campaign.sent_count++;
        await pool.query('UPDATE campaigns SET sent_count = sent_count + 1 WHERE id = ?', [campaignId]);
      } catch (err) {
        await this.logResult(campaign, contact, message, null, err.message);

        campaign.failed_count++;
        await pool.query('UPDATE campaigns SET failed_count = failed_count + 1 WHERE id = ?', [campaignId]);
      }

      this.emitProgress(campaign.user_id, campaign);

      if (i < contacts.length - 1 && campaign.delay_seconds > 0) {
        const wait = campaign.channel === 'whatsapp'
          ? WhatsAppManager.getAntiBanDelay(campaign.delay_seconds)
          : campaign.delay_seconds * 1000;
        await new Promise(r => setTimeout(r, wait));
      }
    }

    const [final] = await pool.query(
      'SELECT sent_count, failed_count, total_contacts FROM campaigns WHERE id = ?',
      [campaignId]
    );

    let finalStatus = 'paused';
    const todaySent = await this.getTodaySentCount(campaignId);
    const hitDailyCap = todaySent >= dailyCap;
    if (control.stopped || hitDailyCap) {
      finalStatus = 'paused';
    } else if (final[0].sent_count + final[0].failed_count >= final[0].total_contacts) {
      finalStatus = 'completed';
    } else {
      const remaining = await this.loadContacts(campaign);
      finalStatus = remaining.length ? 'paused' : 'completed';
    }

    await pool.query(
      `UPDATE campaigns SET status = ?, completed_at = IF(? = 'completed', NOW(), completed_at) WHERE id = ?`,
      [finalStatus, finalStatus, campaignId]
    );

    campaign.status = finalStatus;
    this.emitProgress(campaign.user_id, campaign);
    this.active.delete(campaignId);

    return {
      success: true,
      sent: final[0].sent_count,
      failed: final[0].failed_count,
      status: finalStatus
    };
  }

  async processScheduledCampaigns() {
    const [rows] = await pool.query(
      `SELECT id, channel FROM campaigns
       WHERE status = 'queued' AND scheduled_at IS NOT NULL
       AND scheduled_at <= NOW()`
    );

    for (const row of rows) {
      if (this.active.has(row.id)) continue;
      console.log(`[CampaignRunner] Starting scheduled ${row.channel} campaign ${row.id}`);
      this.runCampaign(row.id).catch(err => {
        console.error(`[CampaignRunner] Scheduled run failed for ${row.id}:`, err.message);
      });
    }
  }

  async resumePausedCampaigns() {
    const [rows] = await pool.query(
      `SELECT id FROM campaigns
       WHERE status = 'paused'
       AND sent_count + failed_count < total_contacts`
    );

    for (const row of rows) {
      if (this.active.has(row.id)) continue;
      console.log(`[CampaignRunner] Auto-resuming paused campaign ${row.id}`);
      this.runCampaign(row.id).catch(err => {
        console.error(`[CampaignRunner] Auto-resume failed for ${row.id}:`, err.message);
      });
    }
  }

  async resumeInterruptedCampaigns() {
    const [rows] = await pool.query(
      `SELECT id FROM campaigns WHERE status IN ('running', 'queued') AND (scheduled_at IS NULL OR scheduled_at <= NOW())`
    );

    for (const row of rows) {
      try {
        console.log(`[CampaignRunner] Resuming campaign ${row.id}`);
        await pool.query("UPDATE campaigns SET status = 'paused' WHERE id = ?", [row.id]);
        setTimeout(() => {
          this.runCampaign(row.id).catch(err => {
            console.error(`[CampaignRunner] Resume failed for ${row.id}:`, err.message);
          });
        }, 3000);
      } catch (err) {
        console.error(`[CampaignRunner] Resume error ${row.id}:`, err.message);
      }
    }
  }

  pauseCampaign(campaignId) {
    campaignId = Number(campaignId);
    const control = this.active.get(campaignId);
    if (control) control.paused = true;
    return pool.query("UPDATE campaigns SET status = 'paused' WHERE id = ?", [campaignId]);
  }

  resumeCampaign(campaignId) {
    campaignId = Number(campaignId);
    const control = this.active.get(campaignId);
    if (control) {
      control.paused = false;
      return { success: true, message: 'Campaign resumed' };
    }
    return this.runCampaign(campaignId);
  }

  stopCampaign(campaignId) {
    const control = this.active.get(Number(campaignId));
    if (control) control.stopped = true;
  }
}

module.exports = new CampaignRunner();
