(function () {
  if (!requireAuth()) return;
  renderAppShell('wa-outbox');

  let pollTimer = null;
  let reloadTimer = null;
  let lastCount = 0;

  document.getElementById('page-content').innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
      <div>
        <h4 class="mb-1 fw-bold">WhatsApp Outbox</h4>
        <p class="text-muted mb-0">All WhatsApp messages sent from your account. Refreshes automatically during campaigns.</p>
      </div>
      <small class="text-muted" id="outbox-updated">Loading…</small>
    </div>
    <div class="content-card table-card">
      <div class="table-responsive">
        <table class="table align-middle">
          <thead>
            <tr><th>Date</th><th>Phone</th><th>Sender</th><th>Message</th><th>Status</th></tr>
          </thead>
          <tbody id="outbox-body"><tr><td colspan="5" class="text-muted text-center py-4">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  async function loadOutbox() {
    const data = await api('/api/wa/outbox');
    const tbody = document.getElementById('outbox-body');
    const updatedEl = document.getElementById('outbox-updated');

    if (!data.logs.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted text-center py-4">No messages yet</td></tr>';
      lastCount = 0;
    } else {
      tbody.innerHTML = data.logs.map(l => `
        <tr>
          <td class="small">${formatDate(l.sent_at || l.created_at)}</td>
          <td>${l.phone}</td>
          <td>${l.sender_name || '-'}</td>
          <td class="small text-truncate" style="max-width:240px">${l.message}</td>
          <td>${statusBadge(l.status)}</td>
        </tr>
      `).join('');
      lastCount = data.logs.length;
    }

    if (updatedEl) {
      updatedEl.textContent = `Updated ${new Date().toLocaleTimeString()} · ${lastCount} message${lastCount === 1 ? '' : 's'}`;
    }
  }

  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      loadOutbox().catch(() => {});
    }, 3000);
  }

  loadOutbox().catch(err => showToast(err.message, 'error'));

  pollTimer = setInterval(() => {
    loadOutbox().catch(() => {});
  }, 12000);

  const socket = typeof initSocket === 'function' ? initSocket() : null;
  if (socket) {
    socket.on('campaign:progress', () => scheduleReload());
  }

  window.addEventListener('beforeunload', () => {
    clearInterval(pollTimer);
    clearTimeout(reloadTimer);
  });
})();
