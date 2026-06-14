(function () {
  if (!requireAuth()) return;
  renderAppShell('whatsapp');

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
      <div>
        <h4 class="mb-1 fw-bold">WhatsApp</h4>
        <p class="text-muted mb-0">Connect your number and send messages</p>
      </div>
    </div>

    <div class="row g-4">
      <div class="col-lg-8">
        <div class="content-card mb-4">
          <div class="d-flex flex-wrap justify-content-between align-items-center gap-3">
            <div>
              <h6 class="fw-semibold mb-2">Connection Status</h6>
              <div id="wa-status-badge">${statusBadge('disconnected')}</div>
              <div class="text-muted small mt-2" id="wa-status-detail">Not connected</div>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-whatsapp" id="btn-connect"><i class="bi bi-qr-code me-2"></i>Connect</button>
              <button class="btn btn-outline-danger d-none" id="btn-disconnect"><i class="bi bi-plug me-2"></i>Disconnect</button>
            </div>
          </div>
        </div>

        <div class="content-card mb-4">
          <h6 class="fw-semibold mb-3"><i class="bi bi-send me-2"></i>Quick Send</h6>
          <form id="quick-send-form">
            <div class="mb-3">
              <label class="form-label">Phone Number</label>
              <input type="tel" class="form-control" id="quick-phone" placeholder="2567XXXXXXXX" required>
            </div>
            <div class="mb-3">
              <label class="form-label">Message</label>
              <textarea class="form-control" id="quick-message" rows="4" placeholder="Type your message…" required></textarea>
            </div>
            <button type="submit" class="btn btn-whatsapp"><i class="bi bi-send me-2"></i>Send Message</button>
          </form>
        </div>

        <div class="content-card">
          <h6 class="fw-semibold mb-3"><i class="bi bi-people me-2"></i>Bulk Send</h6>
          <form id="bulk-send-form">
            <div class="mb-3">
              <label class="form-label">Contact List</label>
              <select class="form-select" id="bulk-list" required>
                <option value="">Select a list…</option>
              </select>
            </div>
            <div class="mb-3">
              <label class="form-label">Message</label>
              <textarea class="form-control" id="bulk-message" rows="4" placeholder="Type your bulk message…" required></textarea>
            </div>
            <div class="mb-3">
              <label class="form-label">Delay between messages: <strong id="delay-value">6</strong>s</label>
              <input type="range" class="form-range" id="bulk-delay" min="3" max="30" value="6">
            </div>
            <button type="submit" class="btn btn-primary"><i class="bi bi-megaphone me-2"></i>Start Bulk Send</button>
          </form>
        </div>
      </div>

      <div class="col-lg-4">
        <div class="content-card sticky-top" style="top:80px">
          <h6 class="fw-semibold mb-3 text-center">Preview</h6>
          <div class="phone-preview">
            <div class="chat-header d-flex align-items-center gap-2">
              <i class="bi bi-arrow-left"></i>
              <div class="rounded-circle bg-secondary" style="width:32px;height:32px"></div>
              <div><div class="small fw-semibold">Contact</div><div class="small opacity-75">online</div></div>
            </div>
            <div class="chat-body">
              <div class="msg-bubble" id="preview-bubble">Your message preview will appear here…</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="qr-modal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"><i class="bi bi-qr-code me-2"></i>Scan QR Code</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body text-center">
            <p class="text-muted">Open WhatsApp → Settings → Linked Devices → Link a Device</p>
            <div id="qr-container" class="d-flex justify-content-center my-3">
              <div class="spinner-border text-success" role="status"></div>
            </div>
            <p class="small text-muted mb-0" id="qr-status">Waiting for QR code…</p>
          </div>
        </div>
      </div>
    </div>
  `;

  const qrModal = new bootstrap.Modal(document.getElementById('qr-modal'));
  const socket = initSocket();

  function updateStatus(status, phone, name) {
    const badge = document.getElementById('wa-status-badge');
    const detail = document.getElementById('wa-status-detail');
    const btnConnect = document.getElementById('btn-connect');
    const btnDisconnect = document.getElementById('btn-disconnect');

    badge.innerHTML = statusBadge(status);
    if (status === 'connected') {
      detail.textContent = phone ? `${name || 'Connected'} · ${phone}` : 'Connected';
      btnConnect.classList.add('d-none');
      btnDisconnect.classList.remove('d-none');
    } else if (status === 'connecting') {
      detail.textContent = 'Waiting for QR scan…';
      btnConnect.classList.remove('d-none');
      btnDisconnect.classList.add('d-none');
    } else {
      detail.textContent = status === 'banned' ? 'Session banned — reconnect required' : 'Not connected';
      btnConnect.classList.remove('d-none');
      btnDisconnect.classList.add('d-none');
    }
  }

  function renderQR(qrData) {
    const container = document.getElementById('qr-container');
    container.innerHTML = '<canvas id="qr-canvas"></canvas>';
    QRCode.toCanvas(document.getElementById('qr-canvas'), qrData, { width: 260, margin: 2 });
    document.getElementById('qr-status').textContent = 'Scan the QR code with your phone';
  }

  async function loadStatus() {
    try {
      const data = await api('/api/wa/status');
      updateStatus(data.status, data.phone, data.name);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function loadLists() {
    try {
      const data = await api('/api/contacts/lists');
      const select = document.getElementById('bulk-list');
      select.innerHTML = '<option value="">Select a list…</option>' +
        data.lists.map(l => `<option value="${l.id}">${l.name} (${l.contact_count})</option>`).join('');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function fetchListPhones(listId) {
    const data = await api(`/api/contacts/lists/${listId}?limit=10000`);
    return data.contacts.map(c => c.phone);
  }

  function updatePreview() {
    const msg = document.getElementById('quick-message').value ||
                document.getElementById('bulk-message').value ||
                'Your message preview will appear here…';
    document.getElementById('preview-bubble').textContent = msg;
  }

  document.getElementById('quick-message').addEventListener('input', updatePreview);
  document.getElementById('bulk-message').addEventListener('input', updatePreview);

  document.getElementById('bulk-delay').addEventListener('input', e => {
    document.getElementById('delay-value').textContent = e.target.value;
  });

  document.getElementById('btn-connect').addEventListener('click', async () => {
    qrModal.show();
    document.getElementById('qr-container').innerHTML = '<div class="spinner-border text-success"></div>';
    document.getElementById('qr-status').textContent = 'Generating QR code…';
    try {
      await api('/api/wa/connect', { method: 'POST' });
      if (socket) socket.emit('wa:get-qr');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-disconnect').addEventListener('click', async () => {
    if (!await confirmDialog({
      title: 'Disconnect WhatsApp?',
      message: 'Your WhatsApp session will be disconnected from AfrieConnect.',
      confirmText: 'Disconnect',
      variant: 'danger'
    })) return;
    try {
      await api('/api/wa/disconnect', { method: 'POST' });
      if (socket) socket.emit('wa:disconnect');
      updateStatus('disconnected');
      showToast('WhatsApp disconnected');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('quick-send-form').addEventListener('submit', async e => {
    e.preventDefault();
    const phone = document.getElementById('quick-phone').value.trim();
    const message = document.getElementById('quick-message').value.trim();
    try {
      await api('/api/wa/send', { method: 'POST', body: JSON.stringify({ phone, message }) });
      showToast('Message sent');
      e.target.reset();
      updatePreview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('bulk-send-form').addEventListener('submit', async e => {
    e.preventDefault();
    const listId = document.getElementById('bulk-list').value;
    const message = document.getElementById('bulk-message').value.trim();
    const delay = parseInt(document.getElementById('bulk-delay').value, 10);

    try {
      const phones = await fetchListPhones(listId);
      if (!phones.length) {
        showToast('Selected list has no contacts', 'error');
        return;
      }
      if (!await confirmDialog({
        title: 'Send bulk WhatsApp?',
        message: `Send messages to ${phones.length} contacts?`,
        confirmText: 'Send now',
        variant: 'primary'
      })) return;

      await api('/api/wa/bulk-send', {
        method: 'POST',
        body: JSON.stringify({ phones, message, delay })
      });
      showToast(`Bulk send started for ${phones.length} contacts`);
      e.target.reset();
      document.getElementById('delay-value').textContent = '6';
      updatePreview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  if (socket) {
    socket.on('wa:qr', ({ qr }) => {
      if (qr) renderQR(qr);
    });

    socket.on('wa:connected', ({ phone, name }) => {
      updateStatus('connected', phone, name);
      qrModal.hide();
      showToast('WhatsApp connected!');
    });

    socket.on('wa:status', (data) => {
      updateStatus(data.status, data.phone, data.name);
    });

    socket.on('wa:disconnected', () => {
      updateStatus('disconnected');
    });
  }

  loadStatus();
  loadLists();
})();
