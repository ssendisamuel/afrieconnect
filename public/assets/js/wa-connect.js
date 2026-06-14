(function () {
  if (!requireAuth()) return;
  renderAppShell('wa-connect');

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-start mb-4 gap-3">
      <div>
        <h4 class="mb-1 fw-bold">Connect WhatsApp</h4>
        <p class="text-muted mb-0">Build a sender pool with multiple WhatsApp numbers. Spread traffic across clean sender lines for safer delivery.</p>
      </div>
      <button class="btn btn-whatsapp" id="btn-add-sender"><i class="bi bi-plus-lg me-2"></i>Add Number</button>
    </div>

    <div class="alert alert-sender-pool rounded-3 mb-4">
      <strong>Workspace Sender Pool</strong><br>
      <span id="pool-summary">Connected senders: 0</span>. Add more WhatsApp numbers so bulk campaigns can spread delivery across your sender pool.
    </div>

    <div class="content-card table-card">
      <div class="table-responsive">
        <table class="table align-middle mb-0 sender-table">
          <thead>
            <tr>
              <th># Sender ID</th>
              <th>Sender Name</th>
              <th>Phone Number</th>
              <th>Status</th>
              <th>Last Connected</th>
              <th>Today</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="senders-body">
            <tr><td colspan="7" class="text-center text-muted py-4">Loading senders…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="modal fade" id="add-modal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Add WhatsApp Number</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <label class="form-label">Sender Name</label>
            <input type="text" class="form-control" id="sender-name" placeholder="e.g. Samuel Sender 1">
            <div class="form-text">Give this line a name so you can identify it in campaigns.</div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-whatsapp" id="btn-save-sender">Add Number</button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="qr-modal" tabindex="-1" data-bs-backdrop="static">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"><i class="bi bi-qr-code me-2"></i>Pair WhatsApp</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body text-center">
            <p class="text-muted mb-1">Open WhatsApp → Settings → Linked Devices → Link a Device</p>
            <p class="small text-muted" id="qr-sender-label"></p>
            <div id="qr-container" class="d-flex justify-content-center my-3 min-vh-25 align-items-center">
              <div class="spinner-border text-success"></div>
            </div>
            <p class="small text-muted mb-0" id="qr-status">Generating QR code…</p>
          </div>
        </div>
      </div>
    </div>
  `;

  const addModal = new bootstrap.Modal(document.getElementById('add-modal'));
  const qrModal = new bootstrap.Modal(document.getElementById('qr-modal'));
  const socket = initSocket();
  let pollTimer = null;
  let activeSessionId = null;

  function senderStatusBadge(status) {
    const map = {
      connected: 'success',
      connecting: 'info',
      pending_qr: 'warning badge-pending-qr',
      disconnected: 'secondary',
      banned: 'danger'
    };
    const label = status === 'pending_qr' ? 'pending qr' : status;
    const cls = map[status] || 'secondary';
    if (status === 'pending_qr') {
      return `<span class="badge badge-pending-qr">${label}</span>`;
    }
    return `<span class="badge bg-${cls}">${label}</span>`;
  }

  function renderSenders(senders, connectedCount) {
    document.getElementById('pool-summary').textContent = `Connected senders: ${connectedCount}`;

    const tbody = document.getElementById('senders-body');
    if (!senders.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">No senders yet. Click <strong>Add Number</strong> to start.</td></tr>';
      return;
    }

    tbody.innerHTML = senders.map(s => `
      <tr>
        <td class="fw-semibold">#${s.id}</td>
        <td>${s.sender_name || '-'}</td>
        <td>${s.phone_number || '<span class="text-muted">Not linked yet</span>'}</td>
        <td>${senderStatusBadge(s.status)}</td>
        <td>${s.connected_at ? formatDate(s.connected_at) : '<span class="text-muted">Not connected yet</span>'}</td>
        <td>${s.messages_sent || 0} / ${s.daily_limit || 200}</td>
        <td>
          <div class="d-flex gap-2">
            ${s.status !== 'connected' ? `<button class="btn btn-sm btn-outline-primary pair-btn" data-id="${s.id}" data-name="${s.sender_name}"><i class="bi bi-phone me-1"></i>Pair</button>` : ''}
            <button class="btn btn-sm btn-outline-danger delete-btn" data-id="${s.id}"><i class="bi bi-trash me-1"></i>Delete</button>
          </div>
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.pair-btn').forEach(btn => {
      btn.addEventListener('click', () => startPairing(btn.dataset.id, btn.dataset.name));
    });

    tbody.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => deleteSender(btn.dataset.id));
    });
  }

  function showQrImage(qrImage, qrText) {
    const container = document.getElementById('qr-container');
    if (qrImage) {
      container.innerHTML = `<img src="${qrImage}" alt="WhatsApp QR Code" class="img-fluid rounded" style="max-width:280px">`;
      document.getElementById('qr-status').textContent = 'Scan the QR code with your phone';
      return;
    }
    if (qrText && window.QRCode) {
      container.innerHTML = '<canvas id="qr-canvas"></canvas>';
      QRCode.toCanvas(document.getElementById('qr-canvas'), qrText, { width: 260, margin: 2 }, err => {
        if (err) container.innerHTML = '<p class="text-danger small">Could not render QR</p>';
      });
      document.getElementById('qr-status').textContent = 'Scan the QR code with your phone';
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  async function pollQr(sessionId) {
    try {
      const data = await api(`/api/wa/senders/${sessionId}/qr`);
      if (data.qr_image || data.qr) {
        showQrImage(data.qr_image, data.qr);
        stopPolling();
      }
    } catch (_) { /* keep polling */ }
  }

  async function startPairing(sessionId, senderName) {
    activeSessionId = Number(sessionId);
    document.getElementById('qr-sender-label').textContent = senderName ? `Pairing: ${senderName}` : '';
    document.getElementById('qr-container').innerHTML = '<div class="spinner-border text-success"></div>';
    document.getElementById('qr-status').textContent = 'Generating QR code…';
    qrModal.show();
    stopPolling();

    try {
      const data = await api(`/api/wa/senders/${sessionId}/pair`, { method: 'POST' });
      if (data.qr_image || data.qr) {
        showQrImage(data.qr_image, data.qr);
      } else {
        pollTimer = setInterval(() => pollQr(sessionId), 2000);
        pollQr(sessionId);
      }
      if (socket) socket.emit('wa:pair', { sessionId: Number(sessionId) });
    } catch (err) {
      document.getElementById('qr-status').textContent = err.message;
      showToast(err.message, 'error');
    }
  }

  async function loadSenders() {
    const data = await api('/api/wa/senders');
    renderSenders(data.senders, data.connected_count);
  }

  async function deleteSender(id) {
    if (!await confirmDialog({
      title: 'Remove sender?',
      message: 'This WhatsApp number will be removed from your sender pool.',
      confirmText: 'Remove',
      variant: 'danger'
    })) return;
    try {
      await api(`/api/wa/senders/${id}`, { method: 'DELETE' });
      showToast('Sender removed');
      loadSenders();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  document.getElementById('btn-add-sender').addEventListener('click', () => {
    document.getElementById('sender-name').value = '';
    addModal.show();
  });

  document.getElementById('btn-save-sender').addEventListener('click', async () => {
    const sender_name = document.getElementById('sender-name').value.trim();
    if (!sender_name) return showToast('Enter a sender name', 'error');

    try {
      const data = await api('/api/wa/senders', {
        method: 'POST',
        body: JSON.stringify({ sender_name })
      });
      addModal.hide();
      showToast('Sender added — click Pair to connect');
      await loadSenders();
      startPairing(data.sender.id, sender_name);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('qr-modal').addEventListener('hidden.bs.modal', stopPolling);

  if (socket) {
    socket.on('wa:qr', ({ sessionId, qr }) => {
      if (Number(sessionId) === activeSessionId && qr) {
        showQrImage(null, qr);
        stopPolling();
      }
    });

    socket.on('wa:connected', ({ sessionId }) => {
      if (Number(sessionId) === activeSessionId) {
        qrModal.hide();
        stopPolling();
        showToast('WhatsApp connected!');
        loadSenders();
      }
    });

    socket.on('wa:status', () => loadSenders());
    socket.on('wa:pool-status', () => loadSenders());
  }

  loadSenders().catch(err => showToast(err.message, 'error'));
})();
