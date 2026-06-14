(function () {
  if (!requireAuth()) return;
  renderAppShell('sms-custom');

  document.getElementById('page-content').innerHTML = `
    <div class="mb-3">
      <h4 class="mb-1 fw-bold">Message Center</h4>
      <p class="text-muted mb-0">Custom SMS — personalized messages from file</p>
    </div>
    ${renderSmsSubnav('custom')}
    ${renderSmsBalanceCards()}

    <div class="content-card">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h6 class="fw-semibold mb-0"><i class="bi bi-person-lines-fill me-2"></i>Custom SMS</h6>
        <a href="/api/contacts/template" class="btn btn-sm btn-outline-primary" download="afrieconnect-contacts-template.xlsx">
          <i class="bi bi-download me-1"></i>Download Template
        </a>
      </div>

      <form id="custom-form">
        <div class="mb-3">
          <label class="form-label fw-semibold">Import from File</label>
          <input type="file" class="form-control" id="contact-file" accept=".xlsx,.xls,.csv,.txt" required>
          <div class="form-text">Excel/CSV with <strong>Name</strong> and <strong>Phone Number</strong> columns.</div>
        </div>

        <div class="mb-3">
          <label class="form-label fw-semibold">Message</label>
          <select class="form-select mb-2" id="template-select"><option value="">No Template Selected</option></select>
          <textarea class="form-control" id="sms-message" rows="6" required placeholder="Dear {{name}}, your message here…&#10;Use {{name}}, #Value1, or #campaignLink"></textarea>
          <div class="form-text mt-2">
            <strong><span id="char-count">0</span> Characters / <span id="msg-count">0</span> Message</strong>
            <span class="text-muted ms-1">(${partsHint()})</span>
          </div>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-md-4">
            <label class="form-label">Sender ID</label>
            <input type="text" class="form-control" id="sms-sender" maxlength="11" placeholder="MUBS">
          </div>
          <div class="col-md-4">
            <label class="form-label">Campaign link <span class="text-muted">(optional)</span></label>
            <input type="url" class="form-control" id="campaign-url" placeholder="https://yoursite.com/vote">
            <div class="form-text">Replaces <code>#campaignLink</code> in message.</div>
          </div>
          <div class="col-md-4">
            <label class="form-label">Send Later</label>
            <input type="datetime-local" class="form-control" id="scheduled-at">
          </div>
        </div>

        <div class="form-check mb-3">
          <input class="form-check-input" type="checkbox" id="run-as-campaign" checked>
          <label class="form-check-label" for="run-as-campaign">Run as Campaign (recommended for 50+ contacts)</label>
        </div>

        <button type="submit" class="btn btn-primary btn-lg"><i class="bi bi-send me-2"></i>Send Custom SMS</button>
      </form>
    </div>
  `;

  bindMessageCounter('sms-message', 'char-count', 'msg-count');
  bindTemplateSelect('template-select', 'sms-message', () => {
    const { chars, parts } = smsStats(document.getElementById('sms-message').value);
    document.getElementById('char-count').textContent = chars;
    document.getElementById('msg-count').textContent = parts;
  });

  document.getElementById('custom-form').addEventListener('submit', async e => {
    e.preventDefault();
    const file = document.getElementById('contact-file').files[0];
    if (!file) return showToast('Select a contact file', 'error');

    const form = new FormData();
    form.append('file', file);
    form.append('message', document.getElementById('sms-message').value.trim());
    form.append('sender_id', document.getElementById('sms-sender').value.trim());
    form.append('campaign_url', document.getElementById('campaign-url').value.trim());
    form.append('run_as_campaign', document.getElementById('run-as-campaign').checked ? 'true' : 'false');
    const scheduled = document.getElementById('scheduled-at').value;
    if (scheduled) form.append('scheduled_at', new Date(scheduled).toISOString());

    if (!await confirmDialog({ title: 'Send custom SMS?', message: 'Personalized messages will be sent to all contacts in the file.', confirmText: 'Send', variant: 'primary' })) return;

    try {
      const token = getToken();
      const res = await fetch('/api/sms/custom-send', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Send failed');

      if (data.scheduled) {
        showToast('Custom SMS scheduled');
        window.location.href = '/app/sms/scheduled.html';
      } else if (data.campaign_id) {
        showToast(`Campaign started for ${data.recipients} contacts`);
        window.location.href = '/app/campaigns.html';
      } else {
        showToast(`Sent to ${data.recipients} contacts`);
        e.target.reset();
        loadSmsBalance();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  loadSmsBalance().catch(err => showToast(err.message, 'error'));
})();
