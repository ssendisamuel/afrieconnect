(function () {
  if (!requireAuth()) return;
  renderAppShell('campaigns');

  let activeCampaignId = null;

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
      <div>
        <h4 class="mb-1 fw-bold">Campaigns</h4>
        <p class="text-muted mb-0">Track and manage your messaging campaigns</p>
      </div>
      <button class="btn btn-outline-primary btn-sm" id="btn-refresh">
        <i class="bi bi-arrow-clockwise me-1"></i>Refresh
      </button>
    </div>

    <div class="content-card">
      <div class="table-responsive">
        <table class="table table-hover align-middle mb-0">
          <thead class="table-light">
            <tr>
              <th>Name</th>
              <th>Channel</th>
              <th>List</th>
              <th>Progress</th>
              <th>Status</th>
              <th>Created</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="campaigns-body">
            <tr><td colspan="7" class="text-center text-muted py-4">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="modal fade" id="logs-modal" tabindex="-1">
      <div class="modal-dialog modal-lg modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title"><i class="bi bi-journal-text me-2"></i>Campaign Logs</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body p-0">
            <div class="table-responsive">
              <table class="table table-sm mb-0">
                <thead class="table-light sticky-top">
                  <tr><th>Phone</th><th>Status</th><th>Message</th><th>Time</th></tr>
                </thead>
                <tbody id="logs-body">
                  <tr><td colspan="4" class="text-center text-muted py-4">Loading…</td></tr>
                </tbody>
              </table>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="settings-modal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">Campaign speed</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <p class="small text-muted">Changes apply before the <strong>next</strong> message — safe while running or paused.</p>
            <input type="hidden" id="settings-campaign-id">
            <div class="mb-3">
              <label class="form-label">Delay between messages: <strong id="settings-delay-val">12</strong>s</label>
              <input type="range" class="form-range" id="settings-delay" min="8" max="60" value="12">
              <div class="form-text">WhatsApp adds 0–5s random jitter on top. Use 12–15s+ to reduce unlinking.</div>
            </div>
            <div class="mb-0">
              <label class="form-label">Daily cap (this campaign)</label>
              <input type="number" class="form-control" id="settings-cap" min="1" max="5000" value="200">
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="button" class="btn btn-primary" id="btn-save-settings">Save</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const logsModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('logs-modal'));
  const settingsModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('settings-modal'));

  function actionButtons(c) {
    const btns = [];
    if (c.status === 'running') {
      btns.push(`<button class="btn btn-sm btn-outline-warning btn-pause" data-id="${c.id}"><i class="bi bi-pause-fill"></i></button>`);
    }
    if (c.status === 'paused') {
      btns.push(`<button class="btn btn-sm btn-outline-success btn-resume" data-id="${c.id}"><i class="bi bi-play-fill"></i></button>`);
    }
    if (['running', 'paused', 'queued'].includes(c.status)) {
      btns.push(`<button class="btn btn-sm btn-outline-secondary btn-settings" data-id="${c.id}" data-delay="${c.delay_seconds || 8}" data-cap="${c.daily_cap || 200}" title="Change delay"><i class="bi bi-speedometer2"></i></button>`);
    }
    btns.push(`<button class="btn btn-sm btn-outline-primary btn-logs" data-id="${c.id}"><i class="bi bi-journal-text"></i></button>`);
    if (c.status !== 'running') {
      btns.push(`<button class="btn btn-sm btn-outline-danger btn-delete" data-id="${c.id}"><i class="bi bi-trash"></i></button>`);
    }
    return `<div class="btn-group btn-group-sm">${btns.join('')}</div>`;
  }

  async function loadCampaigns() {
    const tbody = document.getElementById('campaigns-body');
    try {
      const data = await api('/api/campaigns');
      const campaigns = data.campaigns || [];

      if (!campaigns.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-5">No campaigns yet</td></tr>';
        return;
      }

      tbody.innerHTML = campaigns.map(c => {
        const progress = c.total_contacts
          ? Math.round((c.sent_count / c.total_contacts) * 100)
          : 0;
        return `
          <tr>
            <td class="fw-medium">${c.name}</td>
            <td>${channelBadge(c.channel)}</td>
            <td>${c.list_name || '—'}</td>
            <td>
              <div class="d-flex align-items-center gap-2" style="min-width:120px">
                <div class="progress flex-grow-1" style="height:6px">
                  <div class="progress-bar ${c.status === 'failed' ? 'bg-danger' : ''}" style="width:${progress}%"></div>
                </div>
                <small class="text-muted">${c.sent_count}/${c.total_contacts || 0}</small>
              </div>
            </td>
            <td>${statusBadge(c.status)}</td>
            <td><small class="text-muted">${formatDate(c.created_at)}</small></td>
            <td><small class="text-muted d-block">${c.delay_seconds || 8}s delay</small>${actionButtons(c)}</td>
          </tr>
        `;
      }).join('');

      wireActions();
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">${err.message}</td></tr>`;
    }
  }

  function wireActions() {
    document.querySelectorAll('.btn-pause').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/campaigns/${btn.dataset.id}/pause`, { method: 'POST' });
          showToast('Campaign paused');
          loadCampaigns();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('.btn-resume').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/campaigns/${btn.dataset.id}/resume`, { method: 'POST' });
          showToast('Campaign resumed');
          loadCampaigns();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('.btn-logs').forEach(btn => {
      btn.addEventListener('click', () => {
        activeCampaignId = btn.dataset.id;
        loadLogs();
        logsModal.show();
      });
    });

    document.querySelectorAll('.btn-delete').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await confirmDialog({
          title: 'Delete campaign?',
          message: 'This campaign and its logs will be permanently removed.',
          confirmText: 'Delete',
          variant: 'danger'
        })) return;
        try {
          await api(`/api/campaigns/${btn.dataset.id}`, { method: 'DELETE' });
          showToast('Campaign deleted');
          loadCampaigns();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('.btn-settings').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('settings-campaign-id').value = btn.dataset.id;
        const delay = parseInt(btn.dataset.delay || '12', 10);
        document.getElementById('settings-delay').value = delay;
        document.getElementById('settings-delay-val').textContent = delay;
        document.getElementById('settings-cap').value = btn.dataset.cap || 200;
        settingsModal.show();
      });
    });
  }

  async function loadLogs() {
    const tbody = document.getElementById('logs-body');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Loading…</td></tr>';

    try {
      const data = await api(`/api/campaigns/${activeCampaignId}/logs?limit=100`);
      const logs = data.logs || [];

      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">No logs yet</td></tr>';
        return;
      }

      tbody.innerHTML = logs.map(l => `
        <tr>
          <td class="font-monospace">${l.phone}</td>
          <td>${statusBadge(l.status)}</td>
          <td><small>${(l.message || '').slice(0, 60)}${(l.message || '').length > 60 ? '…' : ''}</small></td>
          <td><small class="text-muted">${formatDate(l.sent_at || l.created_at)}</small></td>
        </tr>
      `).join('');
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger py-4">${err.message}</td></tr>`;
    }
  }

  document.getElementById('btn-refresh').addEventListener('click', loadCampaigns);

  document.getElementById('settings-delay').addEventListener('input', e => {
    document.getElementById('settings-delay-val').textContent = e.target.value;
  });

  document.getElementById('btn-save-settings').addEventListener('click', async () => {
    const id = document.getElementById('settings-campaign-id').value;
    try {
      await api(`/api/campaigns/${id}/settings`, {
        method: 'PATCH',
        body: JSON.stringify({
          delay_seconds: Number(document.getElementById('settings-delay').value),
          daily_cap: Number(document.getElementById('settings-cap').value)
        })
      });
      showToast('Speed updated — applies before next message');
      settingsModal.hide();
      loadCampaigns();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  const socket = initSocket();
  if (socket) {
    socket.on('campaign:progress', () => loadCampaigns());
  }

  loadCampaigns();
})();
