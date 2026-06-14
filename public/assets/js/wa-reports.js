(function () {
  if (!requireAuth()) return;
  renderAppShell('wa-reports');

  let pollTimer = null;
  let statsReloadTimer = null;

  document.getElementById('page-content').innerHTML = `
    <div class="mb-4">
      <h4 class="mb-1 fw-bold">WhatsApp Reports</h4>
      <p class="text-muted mb-0">Delivery stats by day and sender line. Updates automatically while campaigns run.</p>
    </div>
    <div class="row g-4">
      <div class="col-lg-7">
        <div class="content-card">
          <h6 class="fw-semibold mb-3">Messages by Day (30 days)</h6>
          <div class="table-responsive">
            <table class="table table-sm">
              <thead><tr><th>Date</th><th>Sent</th><th>Failed</th></tr></thead>
              <tbody id="day-rows"><tr><td colspan="3" class="text-muted">Loading…</td></tr></tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="col-lg-5">
        <div class="content-card mb-4">
          <h6 class="fw-semibold mb-3">By Sender Line</h6>
          <div id="sender-rows" class="text-muted">Loading…</div>
        </div>
        <div class="content-card">
          <h6 class="fw-semibold mb-3">Recent Campaigns</h6>
          <div id="campaign-rows" class="text-muted">Loading…</div>
        </div>
      </div>
    </div>
  `;

  function campaignProgress(c) {
    const done = (c.sent_count || 0) + (c.failed_count || 0);
    const total = c.total_contacts || 0;
    if (!total) return 0;
    return Math.min(100, Math.round((done / total) * 100));
  }

  function renderCampaignRow(c) {
    const pct = campaignProgress(c);
    const isActive = ['running', 'paused', 'queued'].includes(c.status);
    const canResume = c.status === 'paused' && c.sent_count + c.failed_count < c.total_contacts;
    const barClass = c.status === 'failed'
      ? 'bg-danger'
      : (c.status === 'running' ? 'progress-bar-striped progress-bar-animated' : '');

    return `<div class="border-bottom py-2" data-campaign-id="${c.id}">
      <div class="fw-semibold">${c.name}</div>
      <div class="small text-muted d-flex align-items-center gap-2 flex-wrap mb-1">
        <span class="campaign-status">${statusBadge(c.status)}</span>
        <span class="campaign-count">${c.sent_count}/${c.total_contacts} sent</span>
        ${isActive ? `<span class="campaign-delay-label">${c.delay_seconds || 8}s delay</span>` : ''}
        ${canResume ? `<button type="button" class="btn btn-sm btn-outline-success btn-resume-campaign" data-id="${c.id}">Resume now</button>` : ''}
      </div>
      ${isActive ? `
        <div class="d-flex align-items-center gap-2 mt-2 flex-wrap">
          <input type="range" class="form-range flex-grow-1 campaign-delay-range" data-id="${c.id}" min="8" max="60" value="${c.delay_seconds || 8}" style="max-width:180px">
          <button type="button" class="btn btn-sm btn-outline-secondary btn-save-delay" data-id="${c.id}">Update speed</button>
        </div>
      ` : ''}
      ${isActive || pct > 0 ? `
        <div class="progress mt-1" style="height:8px">
          <div class="progress-bar ${barClass}" style="width:${pct}%"></div>
        </div>
        <div class="small text-muted mt-1 campaign-pct">${pct}% complete${c.failed_count ? ` · ${c.failed_count} failed` : ''}</div>
      ` : ''}
    </div>`;
  }

  function updateCampaignProgress(p) {
    const row = document.querySelector(`[data-campaign-id="${p.id}"]`);
    if (!row) return;

    const sent = p.sent ?? 0;
    const failed = p.failed ?? 0;
    const total = p.total || 0;
    const done = sent + failed;
    const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;

    const countEl = row.querySelector('.campaign-count');
    if (countEl) countEl.textContent = `${sent}/${total} sent`;

    const statusEl = row.querySelector('.campaign-status');
    if (statusEl && p.status) statusEl.innerHTML = statusBadge(p.status);

    const bar = row.querySelector('.progress-bar');
    if (bar) {
      bar.style.width = `${pct}%`;
      bar.classList.toggle('progress-bar-striped', p.status === 'running');
      bar.classList.toggle('progress-bar-animated', p.status === 'running');
    }

    const pctEl = row.querySelector('.campaign-pct');
    if (pctEl) {
      pctEl.textContent = `${pct}% complete${failed ? ` · ${failed} failed` : ''}`;
    }
  }

  function wireResumeButtons() {
    document.querySelectorAll('.btn-resume-campaign').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/campaigns/${btn.dataset.id}/resume`, { method: 'POST' });
          showToast('Campaign resumed');
          loadReports();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    document.querySelectorAll('.btn-save-delay').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.id;
        const range = document.querySelector(`.campaign-delay-range[data-id="${id}"]`);
        const delay = Number(range?.value || 12);
        try {
          await api(`/api/campaigns/${id}/settings`, {
            method: 'PATCH',
            body: JSON.stringify({ delay_seconds: delay })
          });
          showToast(`Delay set to ${delay}s — applies before next message`);
          const label = document.querySelector(`[data-campaign-id="${id}"] .campaign-delay-label`);
          if (label) label.textContent = `${delay}s delay`;
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  async function loadReports() {
    const data = await api('/api/wa/reports');

    const dayRows = document.getElementById('day-rows');
    dayRows.innerHTML = data.by_day.length
      ? data.by_day.map(r => `<tr><td>${formatDate(r.date)}</td><td>${r.sent}</td><td>${r.failed || 0}</td></tr>`).join('')
      : '<tr><td colspan="3" class="text-muted">No data yet</td></tr>';

    document.getElementById('sender-rows').innerHTML = data.by_sender.length
      ? data.by_sender.map(s => `<div class="d-flex justify-content-between border-bottom py-2"><span>${s.sender_name}</span><strong>${s.sent}</strong></div>`).join('')
      : '<span class="text-muted">No sender data yet</span>';

    document.getElementById('campaign-rows').innerHTML = data.campaigns.length
      ? data.campaigns.map(renderCampaignRow).join('')
      : '<span class="text-muted">No campaigns yet</span>';

    wireResumeButtons();
  }

  function scheduleStatsReload() {
    clearTimeout(statsReloadTimer);
    statsReloadTimer = setTimeout(() => {
      loadReports().catch(err => showToast(err.message, 'error'));
    }, 4000);
  }

  loadReports().catch(err => showToast(err.message, 'error'));

  pollTimer = setInterval(() => {
    loadReports().catch(() => {});
  }, 15000);

  const socket = typeof initSocket === 'function' ? initSocket() : null;
  if (socket) {
    socket.on('campaign:progress', payload => {
      updateCampaignProgress(payload);
      scheduleStatsReload();
    });
  }

  window.addEventListener('beforeunload', () => {
    clearInterval(pollTimer);
    clearTimeout(statsReloadTimer);
  });
})();
