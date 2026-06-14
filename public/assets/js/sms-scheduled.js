(function () {
  if (!requireAuth()) return;
  renderAppShell('sms-scheduled');

  let currentStatus = 'all';

  function renderTable(rows) {
    const tbody = document.getElementById('scheduled-body');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">No scheduled messages found</td></tr>`;
      document.getElementById('scheduled-summary').textContent = `0 Scheduled Message(s) — ${currentStatus === 'all' ? 'All' : currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1)}`;
      return;
    }

    document.getElementById('scheduled-summary').textContent =
      `${rows.length} Scheduled Message(s) — ${currentStatus === 'all' ? 'All' : currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1)}`;

    tbody.innerHTML = rows.map(r => `
      <tr>
        <td class="small text-truncate" style="max-width:220px">${r.message?.slice(0, 80) || '—'}…</td>
        <td>${formatDate(r.scheduled_at)}</td>
        <td>${r.recipient_count || r.total_contacts || 0}</td>
        <td>${statusBadge(r.status)}</td>
        <td>${r.sent_count || 0} / ${r.total_contacts || 0}</td>
        <td>
          ${['queued', 'running', 'paused'].includes(r.status)
            ? `<button class="btn btn-sm btn-outline-danger btn-cancel" data-id="${r.id}">Cancel</button>`
            : '—'}
        </td>
      </tr>
    `).join('');

    tbody.querySelectorAll('.btn-cancel').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await confirmDialog({ title: 'Cancel scheduled SMS?', message: 'This cannot be undone.', confirmText: 'Cancel schedule', variant: 'danger' })) return;
        await api(`/api/sms/scheduled/${btn.dataset.id}/cancel`, { method: 'POST' });
        showToast('Scheduled SMS cancelled');
        loadScheduled();
      });
    });
  }

  async function loadScheduled() {
    const data = await api(`/api/sms/scheduled?status=${currentStatus}`);
    renderTable(data.scheduled || []);
  }

  document.getElementById('page-content').innerHTML = `
    <div class="mb-3">
      <h4 class="mb-1 fw-bold">Message Center</h4>
      <p class="text-muted mb-0">Scheduled SMS</p>
    </div>
    ${renderSmsSubnav('scheduled')}

    <div class="content-card table-card">
      <ul class="nav nav-tabs mb-3" id="status-tabs">
        <li class="nav-item"><button class="nav-link active" data-status="all">All</button></li>
        <li class="nav-item"><button class="nav-link" data-status="running">Running</button></li>
        <li class="nav-item"><button class="nav-link" data-status="completed">Completed</button></li>
        <li class="nav-item"><button class="nav-link" data-status="cancelled">Cancelled</button></li>
      </ul>
      <p class="small text-muted" id="scheduled-summary">Loading…</p>
      <div class="table-responsive">
        <table class="table align-middle">
          <thead><tr><th>Message</th><th>Scheduled Time</th><th>Count</th><th>Status</th><th>Progress</th><th>Action</th></tr></thead>
          <tbody id="scheduled-body"><tr><td colspan="6" class="text-center py-4">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('status-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-status]');
    if (!btn) return;
    document.querySelectorAll('#status-tabs .nav-link').forEach(l => l.classList.remove('active'));
    btn.classList.add('active');
    currentStatus = btn.dataset.status;
    loadScheduled().catch(err => showToast(err.message, 'error'));
  });

  loadScheduled().catch(err => showToast(err.message, 'error'));
})();
