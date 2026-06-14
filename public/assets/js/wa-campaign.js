(function () {
  if (!requireAuth()) return;
  renderAppShell('wa-campaign');

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="mb-4">
      <h4 class="mb-1 fw-bold">Create Campaign</h4>
      <p class="text-muted mb-0">Compose WhatsApp campaigns, review sender status, then queue them for delivery.</p>
    </div>

    <div class="row g-4">
      <div class="col-lg-8">
        <div class="alert alert-success rounded-3 py-2 mb-3" id="active-senders-bar">
          Active sender lines: <strong id="active-count">0</strong>
        </div>
        <div class="alert alert-sender-pool rounded-3 small mb-3">
          Messages are delivered as individual chats. Spread traffic across your sender pool. Minimum 8s delay + random jitter. Max 30 messages/sender/hour enforced.
        </div>
        <div class="alert alert-warning rounded-3 small mb-4 d-none" id="campaign-estimate"></div>

        <form id="campaign-form" class="content-card">
          <h6 class="fw-semibold mb-3">Sender Selection</h6>
          <div class="form-check mb-2">
            <input class="form-check-input" type="radio" name="sender_mode" id="mode-all" value="all" checked>
            <label class="form-check-label" for="mode-all">
              <strong>Use all connected numbers</strong><br>
              <span class="text-muted small">Round robin across your sender pool.</span>
            </label>
          </div>
          <div class="form-check mb-4">
            <input class="form-check-input" type="radio" name="sender_mode" id="mode-selected" value="selected">
            <label class="form-check-label" for="mode-selected">
              <strong>Choose connected numbers</strong><br>
              <span class="text-muted small">Rotate only among selected senders.</span>
            </label>
          </div>
          <div id="sender-checkboxes" class="mb-4 d-none"></div>

          <h6 class="fw-semibold mb-3">Recipients</h6>
          <div class="form-check mb-2">
            <input class="form-check-input" type="radio" name="recipient_mode" id="recipient-list" value="list" checked>
            <label class="form-check-label" for="recipient-list"><strong>Contact list</strong></label>
          </div>
          <div class="form-check mb-3">
            <input class="form-check-input" type="radio" name="recipient_mode" id="recipient-numbers" value="numbers">
            <label class="form-check-label" for="recipient-numbers"><strong>Paste phone numbers</strong> (not saved to contacts)</label>
          </div>

          <div class="mb-3" id="list-picker">
            <label class="form-label">Contact List</label>
            <select class="form-select" id="campaign-list"></select>
          </div>
          <div class="mb-3 d-none" id="numbers-picker">
            <label class="form-label">Phone Numbers</label>
            <textarea class="form-control font-monospace" id="campaign-phones" rows="8" placeholder="One number per line:&#10;256712345678&#10;0787654321&#10;+256779265701"></textarea>
            <div class="form-text">Accepted: 07xxxxxxxx, 2567xxxxxxxx, +2567xxxxxxxx</div>
          </div>

          <div class="mb-3">
            <label class="form-label">Campaign Title</label>
            <input type="text" class="form-control" id="campaign-name" required>
          </div>
          <div class="mb-3">
            <label class="form-label">Message Body <span class="text-muted fw-normal">(caption — optional if you attach media)</span></label>
            <textarea class="form-control" id="campaign-message" rows="6" placeholder="Hello {{name}}, …"></textarea>
            <div class="form-text">Use {{name}} to personalize (uses contact name or "there" for pasted numbers).</div>
          </div>
          <div class="mb-3">
            <label class="form-label">Media Attachment <span class="text-muted fw-normal">(optional)</span></label>
            <input type="file" class="form-control" id="campaign-media" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip">
            <div class="form-text">Images, videos, audio, PDF, Office docs, TXT, ZIP — max 16MB. Sent as WhatsApp media with your message as caption.</div>
            <div class="small text-success mt-1 d-none" id="media-selected"></div>
          </div>
          <div class="row g-3 mb-3">
            <div class="col-md-6">
              <label class="form-label">Delay: <strong id="delay-val">12</strong>s (min 8s + jitter)</label>
              <input type="range" class="form-range" id="campaign-delay" min="8" max="60" value="12">
              <div class="form-text">Recommended 12–15s+ for bulk to avoid WhatsApp unlinking.</div>
            </div>
            <div class="col-md-6">
              <label class="form-label">Daily cap (this campaign)</label>
              <input type="number" class="form-control" id="campaign-cap" value="200" min="1">
              <div class="form-text">Campaign pauses after this many sends per day.</div>
            </div>
          </div>
          <div class="mb-3">
            <label class="form-label">Schedule for later <span class="text-muted fw-normal">(optional)</span></label>
            <input type="datetime-local" class="form-control" id="campaign-schedule">
            <div class="form-text">Leave empty to queue immediately. Scheduled campaigns start automatically at the chosen time.</div>
          </div>
          <button type="submit" class="btn btn-whatsapp btn-lg"><i class="bi bi-send me-2"></i><span id="campaign-submit-label">Queue Campaign</span></button>
        </form>
      </div>

      <div class="col-lg-4">
        <div class="content-card sticky-top" style="top:80px">
          <h6 class="fw-semibold mb-1">Phone Preview</h6>
          <p class="text-muted small mb-3">WhatsApp-themed mockup with live preview.</p>
          <div class="phone-preview">
            <div class="chat-header d-flex align-items-center gap-2">
              <i class="bi bi-arrow-left"></i>
              <div class="rounded-circle bg-secondary" style="width:32px;height:32px"></div>
              <div>
                <div class="small fw-semibold" id="preview-sender">Sender</div>
                <div class="small opacity-75">business account</div>
              </div>
            </div>
            <div class="chat-body">
              <div class="msg-bubble" id="preview-msg">Start typing to preview your WhatsApp campaign.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  let senders = [];

  function countRecipients() {
    if (document.getElementById('recipient-numbers').checked) {
      const text = document.getElementById('campaign-phones').value;
      return text.split(/[\n,;]+/).filter(l => l.trim().length >= 9).length;
    }
    const sel = document.getElementById('campaign-list');
    const opt = sel.options[sel.selectedIndex];
    const m = opt?.textContent?.match(/\((\d+)\)/);
    return m ? Number(m[1]) : 0;
  }

  function updateEstimate() {
    const n = countRecipients();
    const box = document.getElementById('campaign-estimate');
    if (!n || !senders.length) {
      box.classList.add('d-none');
      return;
    }
    const hourly = senders.length * 30;
    const dailyCap = Number(document.getElementById('campaign-cap').value) || 200;
    const minHours = Math.ceil(n / hourly);
    const minDays = Math.ceil(n / dailyCap);

    box.classList.remove('d-none');
    box.innerHTML = `<strong>${n.toLocaleString()} recipients</strong> with ${senders.length} sender(s): 
      ~${minHours} hour(s) at 30 msg/sender/hour cap, 
      ~${minDays} day(s) at daily cap of ${dailyCap}. 
      For 800+ contacts, use 3–5 senders and spread over multiple days.`;
  }

  async function loadData() {
    const [lists, senderData] = await Promise.all([
      api('/api/contacts/lists'),
      api('/api/wa/senders')
    ]);

    senders = senderData.senders.filter(s => s.status === 'connected');
    document.getElementById('active-count').textContent = senders.length;

    const listSelect = document.getElementById('campaign-list');
    listSelect.innerHTML = '<option value="">Select list…</option>' +
      lists.lists.map(l => `<option value="${l.id}">${l.name} (${l.contact_count})</option>`).join('');

    const box = document.getElementById('sender-checkboxes');
    if (senders.length) {
      box.innerHTML = senders.map(s => `
        <div class="form-check">
          <input class="form-check-input sender-pick" type="checkbox" value="${s.id}" id="sender-${s.id}">
          <label class="form-check-label" for="sender-${s.id}">${s.sender_name} (${s.phone_number || 'linked'})</label>
        </div>
      `).join('');
      document.getElementById('preview-sender').textContent = senders[0].sender_name;
    } else {
      box.innerHTML = '<p class="text-muted small">No connected senders. <a href="/app/whatsapp/connect.html">Connect a number</a> first.</p>';
    }
    updateEstimate();
  }

  document.querySelectorAll('input[name="sender_mode"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('sender-checkboxes').classList.toggle('d-none', !document.getElementById('mode-selected').checked);
    });
  });

  document.getElementById('mode-selected').addEventListener('change', e => {
    if (e.target.checked) document.getElementById('sender-checkboxes').classList.remove('d-none');
  });

  document.querySelectorAll('input[name="recipient_mode"]').forEach(r => {
    r.addEventListener('change', () => {
      const useNumbers = document.getElementById('recipient-numbers').checked;
      document.getElementById('list-picker').classList.toggle('d-none', useNumbers);
      document.getElementById('numbers-picker').classList.toggle('d-none', !useNumbers);
      updateEstimate();
    });
  });

  ['campaign-list', 'campaign-phones', 'campaign-cap'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', updateEstimate);
    document.getElementById(id)?.addEventListener('change', updateEstimate);
  });

  document.getElementById('campaign-message').addEventListener('input', e => {
    updatePreview();
  });

  document.getElementById('campaign-media').addEventListener('change', e => {
    const file = e.target.files[0];
    const hint = document.getElementById('media-selected');
    if (file) {
      hint.textContent = `Selected: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)} MB)`;
      hint.classList.remove('d-none');
    } else {
      hint.classList.add('d-none');
    }
    updatePreview();
  });

  function updatePreview() {
    const msg = document.getElementById('campaign-message').value;
    const file = document.getElementById('campaign-media').files[0];
    let preview = msg || 'Start typing to preview your WhatsApp campaign.';
    if (file) {
      preview = `[${file.name}]${msg ? '\n' + msg : ''}`;
    }
    document.getElementById('preview-msg').textContent = preview;
  }

  document.getElementById('campaign-delay').addEventListener('input', e => {
    document.getElementById('delay-val').textContent = e.target.value;
  });

  document.getElementById('campaign-form').addEventListener('submit', async e => {
    e.preventDefault();

    if (!senders.length) {
      return showToast('Connect at least one WhatsApp number first', 'error');
    }

    const sender_mode = document.querySelector('input[name="sender_mode"]:checked').value;
    const recipient_mode = document.querySelector('input[name="recipient_mode"]:checked').value;
    const sender_ids = sender_mode === 'selected'
      ? [...document.querySelectorAll('.sender-pick:checked')].map(el => Number(el.value))
      : null;

    if (sender_mode === 'selected' && !sender_ids.length) {
      return showToast('Select at least one sender', 'error');
    }

    const message = document.getElementById('campaign-message').value.trim();
    const mediaFile = document.getElementById('campaign-media').files[0];

    if (!message && !mediaFile) {
      return showToast('Enter a message or attach media', 'error');
    }

    const payload = {
      name: document.getElementById('campaign-name').value.trim(),
      message,
      delay_seconds: Number(document.getElementById('campaign-delay').value),
      daily_cap: Number(document.getElementById('campaign-cap').value),
      sender_mode,
      sender_ids,
      recipient_mode
    };

    if (recipient_mode === 'numbers') {
      payload.phones = document.getElementById('campaign-phones').value;
    } else {
      const listId = document.getElementById('campaign-list').value;
      if (!listId) return showToast('Select a contact list', 'error');
      payload.list_id = Number(listId);
    }

    const scheduleValue = document.getElementById('campaign-schedule').value;
    if (scheduleValue) {
      const scheduled = new Date(scheduleValue);
      if (scheduled <= new Date()) {
        return showToast('Schedule time must be in the future', 'error');
      }
      payload.scheduled_at = scheduleValue.replace('T', ' ') + ':00';
    }

    const n = countRecipients();
    if (!n) return showToast('No recipients found', 'error');
    if (n > 50 && senders.length < 2) {
      if (!await confirmDialog({
        title: 'Single sender warning',
        message: `Sending to ${n} numbers with only 1 sender increases ban risk. Continue anyway?`,
        confirmText: 'Continue',
        variant: 'warning'
      })) return;
    }

    try {
      if (mediaFile) {
        const form = new FormData();
        form.append('media', mediaFile);
        const uploaded = await api('/api/wa/media', { method: 'POST', body: form });
        payload.media_path = uploaded.media.path;
        payload.media_filename = uploaded.media.filename;
        payload.media_mimetype = uploaded.media.mimetype;
      }

      const created = await api('/api/wa/campaign', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (payload.scheduled_at) {
        showToast(`Campaign scheduled for ${payload.scheduled_at.replace('T', ' ')}`);
        setTimeout(() => window.location.href = '/app/campaigns.html', 1200);
        return;
      }

      await api(`/api/campaigns/${created.id}/send`, { method: 'POST' });
      showToast(`Campaign started for ${created.total_contacts} recipients`);
      setTimeout(() => window.location.href = '/app/whatsapp/outbox.html', 1200);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  loadData().catch(err => showToast(err.message, 'error'));
})();
