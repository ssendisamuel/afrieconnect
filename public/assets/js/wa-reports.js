(function () {
  if (!requireAuth()) return;
  renderAppShell('wa-reports');

  document.getElementById('page-content').innerHTML = `
    <div class="mb-4">
      <h4 class="mb-1 fw-bold">WhatsApp Reports</h4>
      <p class="text-muted mb-0">Delivery stats by day and sender line. Paused campaigns auto-resume at midnight, or resume manually below.</p>
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

  window.resumeCampaign = async function (id) {
    try {
      await api(`/api/campaigns/${id}/resume`, { method: 'POST' });
      showToast('Campaign resumed');
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  api('/api/wa/reports').then(data => {
    const dayRows = document.getElementById('day-rows');
    dayRows.innerHTML = data.by_day.length
      ? data.by_day.map(r => `<tr><td>${r.date}</td><td>${r.sent}</td><td>${r.failed || 0}</td></tr>`).join('')
      : '<tr><td colspan="3" class="text-muted">No data yet</td></tr>';

    document.getElementById('sender-rows').innerHTML = data.by_sender.length
      ? data.by_sender.map(s => `<div class="d-flex justify-content-between border-bottom py-2"><span>${s.sender_name}</span><strong>${s.sent}</strong></div>`).join('')
      : '<span class="text-muted">No sender data yet</span>';

    document.getElementById('campaign-rows').innerHTML = data.campaigns.length
      ? data.campaigns.map(c => {
          const canResume = c.status === 'paused' && c.sent_count + c.failed_count < c.total_contacts;
          return `<div class="border-bottom py-2">
            <div class="fw-semibold">${c.name}</div>
            <div class="small text-muted d-flex align-items-center gap-2 flex-wrap">
              ${statusBadge(c.status)} ${c.sent_count}/${c.total_contacts} sent
              ${canResume ? `<button type="button" class="btn btn-sm btn-outline-success" onclick="resumeCampaign(${c.id})">Resume now</button>` : ''}
            </div>
          </div>`;
        }).join('')
      : '<span class="text-muted">No campaigns yet</span>';
  }).catch(err => showToast(err.message, 'error'));
})();
