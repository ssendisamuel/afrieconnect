(function () {
  if (!requireAuth()) return;
  renderAppShell('wa-outbox');

  document.getElementById('page-content').innerHTML = `
    <div class="mb-4">
      <h4 class="mb-1 fw-bold">WhatsApp Outbox</h4>
      <p class="text-muted mb-0">All WhatsApp messages sent from your account.</p>
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

  api('/api/wa/outbox').then(data => {
    const tbody = document.getElementById('outbox-body');
    if (!data.logs.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-muted text-center py-4">No messages yet</td></tr>';
      return;
    }
    tbody.innerHTML = data.logs.map(l => `
      <tr>
        <td class="small">${formatDate(l.sent_at || l.created_at)}</td>
        <td>${l.phone}</td>
        <td>${l.sender_name || '-'}</td>
        <td class="small text-truncate" style="max-width:240px">${l.message}</td>
        <td>${statusBadge(l.status)}</td>
      </tr>
    `).join('');
  }).catch(err => showToast(err.message, 'error'));
})();
