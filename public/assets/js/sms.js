(function () {
  if (!requireAuth()) return;
  renderAppShell('sms-bulk');

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
      <div>
        <h4 class="mb-1 fw-bold">Message Center</h4>
        <p class="text-muted mb-0">Single / Bulk SMS</p>
      </div>
      <a href="/app/campaigns.html" class="btn btn-outline-primary btn-sm"><i class="bi bi-megaphone me-1"></i>Run as Campaign</a>
    </div>
    ${renderSmsSubnav('bulk')}
    ${renderSmsBalanceCards()}

    <div class="content-card">
      <form id="sms-form">
        <div class="mb-3">
          <label class="form-label fw-semibold">Phone numbers</label>
          <div class="d-flex flex-wrap gap-3 mb-2">
            <div class="form-check">
              <input class="form-check-input" type="radio" name="recipient-mode" id="mode-paste" value="paste" checked>
              <label class="form-check-label" for="mode-paste">Copy and Paste</label>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="radio" name="recipient-mode" id="mode-list" value="list">
              <label class="form-check-label" for="mode-list">Import from Group</label>
            </div>
          </div>
          <div id="paste-recipients-wrap">
            <textarea class="form-control" id="recipients" rows="6" placeholder="Enter or paste recipients here…"></textarea>
            <div class="form-text">Contacts: <strong id="contact-count">0</strong></div>
          </div>
          <div id="list-recipients-wrap" class="d-none">
            <select class="form-select" id="contact-list"><option value="">Select a contact list…</option></select>
            <div class="form-text">Contacts: <strong id="list-contact-count">0</strong></div>
          </div>
        </div>

        <div class="row g-3 mb-3">
          <div class="col-md-8">
            <label class="form-label fw-semibold">Message</label>
            <select class="form-select mb-2" id="template-select"><option value="">No Template Selected</option></select>
            <textarea class="form-control" id="sms-message" rows="6" placeholder="Type your message here…" required></textarea>
            <div class="form-text mt-2">
              <strong><span id="char-count">0</span> Characters / <span id="msg-count">0</span> Message</strong>
              <span class="text-muted ms-1">(${partsHint()})</span>
            </div>
          </div>
          <div class="col-md-4">
            <label class="form-label fw-semibold">Sender ID</label>
            <input type="text" class="form-control" id="sms-sender" placeholder="MUBS" maxlength="11">
            <div class="form-text">Approved sender ID (max 11 characters).</div>
            <div class="mt-3">
              <label class="form-label fw-semibold">Schedule</label>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="schedule" id="schedule-now" value="now" checked>
                <label class="form-check-label" for="schedule-now">Send Now</label>
              </div>
              <div class="form-check">
                <input class="form-check-input" type="radio" name="schedule" id="schedule-later" value="later">
                <label class="form-check-label" for="schedule-later">Send Later</label>
              </div>
              <input type="datetime-local" class="form-control mt-2 d-none" id="scheduled-at">
            </div>
            <div class="form-check mt-3">
              <input class="form-check-input" type="checkbox" id="run-as-campaign">
              <label class="form-check-label" for="run-as-campaign">Run as Campaign (pause/resume for large sends)</label>
            </div>
          </div>
        </div>

        <div class="alert alert-info small py-2 mb-3" id="cost-estimate">Add recipients and a message to see estimated credits.</div>
        <button type="submit" class="btn btn-primary btn-lg"><i class="bi bi-send me-2"></i>Send</button>
      </form>
    </div>
  `;

  let listPhones = [];
  let smsRate = 40;

  function recipientCount() {
    const mode = document.querySelector('input[name="recipient-mode"]:checked')?.value;
    return mode === 'list' ? listPhones.length : parseRecipientText(document.getElementById('recipients').value).length;
  }

  function updateCostEstimate() {
    const count = recipientCount();
    const { parts } = smsStats(document.getElementById('sms-message').value);
    const totalUgx = count * parts * smsRate;
    const el = document.getElementById('cost-estimate');
    if (!count) { el.textContent = 'Add recipients and a message to see estimated cost in UGX.'; return; }
    if (!parts) { el.textContent = `${count} contact${count !== 1 ? 's' : ''} ready — type your message.`; return; }
    el.textContent = `Estimated cost: UGX ${totalUgx.toLocaleString()} (${count} × ${parts} part${parts !== 1 ? 's' : ''} × UGX ${smsRate})`;
  }

  document.querySelectorAll('input[name="recipient-mode"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const isList = radio.value === 'list' && radio.checked;
      document.getElementById('paste-recipients-wrap').classList.toggle('d-none', isList);
      document.getElementById('list-recipients-wrap').classList.toggle('d-none', !isList);
      updateCostEstimate();
    });
  });

  document.querySelectorAll('input[name="schedule"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.getElementById('scheduled-at').classList.toggle('d-none', radio.value !== 'later' || !radio.checked);
    });
  });

  document.getElementById('recipients').addEventListener('input', e => {
    document.getElementById('contact-count').textContent = parseRecipientText(e.target.value).length;
    updateCostEstimate();
  });

  document.getElementById('contact-list').addEventListener('change', async e => {
    listPhones = [];
    if (!e.target.value) { updateCostEstimate(); return; }
    const data = await api(`/api/contacts/lists/${e.target.value}?limit=10000`);
    listPhones = data.contacts.map(c => c.phone);
    document.getElementById('list-contact-count').textContent = listPhones.length;
    updateCostEstimate();
  });

  bindMessageCounter('sms-message', 'char-count', 'msg-count', updateCostEstimate);
  bindTemplateSelect('template-select', 'sms-message', updateCostEstimate);

  document.getElementById('sms-form').addEventListener('submit', async e => {
    e.preventDefault();
    const mode = document.querySelector('input[name="recipient-mode"]:checked')?.value;
    const phones = mode === 'list' ? listPhones : parseRecipientText(document.getElementById('recipients').value);
    const message = document.getElementById('sms-message').value.trim();
    const sender_id = document.getElementById('sms-sender').value.trim() || undefined;
    const run_as_campaign = document.getElementById('run-as-campaign').checked;
    const scheduleLater = document.getElementById('schedule-later').checked;
    const scheduledAt = scheduleLater ? document.getElementById('scheduled-at').value : null;

    if (!phones.length) return showToast('Add at least one recipient', 'error');
    if (scheduleLater && !scheduledAt) return showToast('Pick a date and time for Send Later', 'error');

    const { parts } = smsStats(message);
    const costUgx = phones.length * parts * smsRate;

    if (!await confirmDialog({
      title: scheduleLater ? 'Schedule SMS?' : 'Send SMS?',
      message: `${scheduleLater ? 'Schedule' : 'Send'} to ${phones.length} contact(s)? Estimated cost UGX ${costUgx.toLocaleString()}.`,
      confirmText: scheduleLater ? 'Schedule' : 'Send now',
      variant: 'primary'
    })) return;

    try {
      const payload = {
        phones, message, sender_id,
        run_as_campaign: run_as_campaign || phones.length > 50,
        scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null
      };
      const result = await api('/api/sms/send', { method: 'POST', body: JSON.stringify(payload) });
      if (result.scheduled) {
        showToast('SMS scheduled successfully');
        window.location.href = '/app/sms/scheduled.html';
      } else if (result.campaign_id) {
        showToast('Campaign started — track progress on Campaigns page');
        window.location.href = '/app/campaigns.html';
      } else {
        showToast(`SMS sent to ${phones.length} contact(s)`);
        e.target.reset();
        loadSmsBalance();
        updateCostEstimate();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  api('/api/contacts/lists').then(data => {
    document.getElementById('contact-list').innerHTML = '<option value="">Select a contact list…</option>' +
      data.lists.map(l => `<option value="${l.id}">${l.name} (${l.contact_count})</option>`).join('');
  });

  loadSmsBalance().then(data => {
    if (data?.sms_rate) smsRate = data.sms_rate;
    updateCostEstimate();
  }).catch(err => showToast(err.message, 'error'));
})();
