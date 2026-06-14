(function () {
  if (!requireAuth()) return;
  renderAppShell('sms-outbox');

  let currentTab = 'bulk';

  async function loadOutbox() {
    const search = document.getElementById('search-term')?.value || '';
    const from = document.getElementById('from-date')?.value || '';
    const to = document.getElementById('to-date')?.value || '';
    const qs = new URLSearchParams({ tab: currentTab, search, from, to });
    const data = await api(`/api/sms/outbox?${qs}`);
    const tbody = document.getElementById('outbox-body');

    if (!data.batches?.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No records found</td></tr>';
      document.getElementById('outbox-summary').textContent = `0 Outbox Message(s) — ${currentTab}`;
      return;
    }

    document.getElementById('outbox-summary').textContent = `${data.batches.length} Outbox Message(s) — ${currentTab}`;
    tbody.innerHTML = data.batches.map(b => `
      <tr>
        <td class="small text-truncate" style="max-width:280px">${b.message || '—'}</td>
        <td>${b.recipient_count}</td>
        <td>UGX ${Number(b.local_cost || 0).toLocaleString()}</td>
        <td class="small">${formatDate(b.sent_at)}</td>
        <td>${b.campaign_id ? `<a href="/app/campaigns.html" class="btn btn-sm btn-outline-primary">View</a>` : '—'}</td>
      </tr>
    `).join('');
  }

  document.getElementById('page-content').innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
      <div>
        <h4 class="mb-1 fw-bold">Message Center</h4>
        <p class="text-muted mb-0">Outbox — sent SMS history</p>
      </div>
      <a href="/api/sms/outbox/export" class="btn btn-sm btn-outline-primary" id="btn-export"><i class="bi bi-download me-1"></i>Export</a>
    </div>
    ${renderSmsSubnav('outbox')}

    <div class="content-card table-card">
      <ul class="nav nav-tabs mb-3" id="outbox-tabs">
        <li class="nav-item"><button class="nav-link active" data-tab="bulk">Single/Bulk</button></li>
        <li class="nav-item"><button class="nav-link" data-tab="scheduled">Scheduled</button></li>
        <li class="nav-item"><button class="nav-link" data-tab="campaign">Campaign</button></li>
      </ul>

      <div class="row g-2 mb-3">
        <div class="col-md-4"><input type="text" class="form-control form-control-sm" id="search-term" placeholder="Search term"></div>
        <div class="col-md-3"><input type="date" class="form-control form-control-sm" id="from-date"></div>
        <div class="col-md-3"><input type="date" class="form-control form-control-sm" id="to-date"></div>
        <div class="col-md-2"><button class="btn btn-primary btn-sm w-100" id="btn-search"><i class="bi bi-search"></i> Search</button></div>
      </div>

      <p class="small text-muted" id="outbox-summary">Loading…</p>
      <div class="table-responsive">
        <table class="table align-middle">
          <thead><tr><th>Message</th><th>Count</th><th>Local Cost</th><th>Date Created</th><th>Action</th></tr></thead>
          <tbody id="outbox-body"><tr><td colspan="5" class="text-center py-4">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('outbox-tabs').addEventListener('click', e => {
    const btn = e.target.closest('[data-tab]');
    if (!btn) return;
    document.querySelectorAll('#outbox-tabs .nav-link').forEach(l => l.classList.remove('active'));
    btn.classList.add('active');
    currentTab = btn.dataset.tab;
    loadOutbox().catch(err => showToast(err.message, 'error'));
  });

  document.getElementById('btn-search').addEventListener('click', () => loadOutbox().catch(err => showToast(err.message, 'error')));

  document.getElementById('btn-export').addEventListener('click', async e => {
    e.preventDefault();
    try {
      const res = await fetch('/api/sms/outbox/export', {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sms-outbox.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  loadOutbox().catch(err => showToast(err.message, 'error'));
})();
