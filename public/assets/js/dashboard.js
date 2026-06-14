(function () {
  if (!requireAuth()) return;
  renderAppShell('dashboard');

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
      <div>
        <h4 class="mb-1 fw-bold">Dashboard</h4>
        <p class="text-muted mb-0">Overview of your messaging activity</p>
      </div>
      <button class="btn btn-outline-primary btn-sm" id="btn-refresh">
        <i class="bi bi-arrow-clockwise me-1"></i>Refresh
      </button>
    </div>

    <div class="row g-3 mb-4" id="stat-cards">
      <div class="col-sm-6 col-xl-3">
        <div class="stat-card">
          <div class="stat-icon bg-success bg-opacity-10 text-success"><i class="bi bi-whatsapp"></i></div>
          <div><div class="stat-value" id="stat-wa">—</div><div class="stat-label">WhatsApp Status</div></div>
        </div>
      </div>
      <div class="col-sm-6 col-xl-3">
        <div class="stat-card">
          <div class="stat-icon bg-primary bg-opacity-10 text-primary"><i class="bi bi-people"></i></div>
          <div><div class="stat-value" id="stat-contacts">—</div><div class="stat-label">Total Contacts</div></div>
        </div>
      </div>
      <div class="col-sm-6 col-xl-3">
        <div class="stat-card">
          <div class="stat-icon bg-info bg-opacity-10 text-info"><i class="bi bi-chat-dots"></i></div>
          <div><div class="stat-value" id="stat-messages">—</div><div class="stat-label">Messages (30 days)</div></div>
        </div>
      </div>
      <div class="col-sm-6 col-xl-3">
        <div class="stat-card">
          <div class="stat-icon bg-warning bg-opacity-10 text-warning"><i class="bi bi-wallet2"></i></div>
          <div><div class="stat-value" id="stat-sms">—</div><div class="stat-label">Wallet (UGX)</div></div>
        </div>
      </div>
    </div>

    <div class="row g-3 mb-4">
      <div class="col-lg-8">
        <div class="content-card h-100">
          <h6 class="fw-semibold mb-3">Messages — Last 7 Days</h6>
          <canvas id="line-chart" height="120"></canvas>
        </div>
      </div>
      <div class="col-lg-4">
        <div class="content-card h-100">
          <h6 class="fw-semibold mb-3">Channel Breakdown</h6>
          <canvas id="doughnut-chart" height="200"></canvas>
        </div>
      </div>
    </div>

    <div class="row g-3">
      <div class="col-lg-8">
        <div class="content-card">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <h6 class="fw-semibold mb-0">Recent Campaigns</h6>
            <a href="/app/campaigns.html" class="btn btn-sm btn-link">View all</a>
          </div>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="table-light">
                <tr><th>Name</th><th>Channel</th><th>Progress</th><th>Status</th><th>Date</th></tr>
              </thead>
              <tbody id="campaigns-body">
                <tr><td colspan="5" class="text-center text-muted py-4">Loading…</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="col-lg-4">
        <div class="content-card">
          <h6 class="fw-semibold mb-3">Quick Actions</h6>
          <div class="d-grid gap-2">
            <a href="/app/whatsapp/connect.html" class="btn btn-whatsapp"><i class="bi bi-whatsapp me-2"></i>Connect WhatsApp</a>
            <a href="/app/sms.html" class="btn btn-primary"><i class="bi bi-chat-text me-2"></i>Send SMS</a>
            <a href="/app/contacts.html" class="btn btn-outline-primary"><i class="bi bi-person-plus me-2"></i>Add Contacts</a>
            <a href="/app/campaigns.html" class="btn btn-outline-secondary"><i class="bi bi-megaphone me-2"></i>View Campaigns</a>
          </div>
        </div>
      </div>
    </div>
  `;

  let lineChart = null;
  let doughnutChart = null;

  function last7Days() {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(d.toISOString().slice(0, 10));
    }
    return days;
  }

  function renderCharts(dailyStats) {
    const days = last7Days();
    const waData = days.map(day => {
      const row = dailyStats.find(s => String(s.date).slice(0, 10) === day && s.channel === 'whatsapp');
      return row ? Number(row.count) : 0;
    });
    const smsData = days.map(day => {
      const row = dailyStats.find(s => String(s.date).slice(0, 10) === day && s.channel === 'sms');
      return row ? Number(row.count) : 0;
    });

    const labels = days.map(d => new Date(d).toLocaleDateString('en-UG', { weekday: 'short', month: 'short', day: 'numeric' }));

    if (lineChart) lineChart.destroy();
    lineChart = new Chart(document.getElementById('line-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          { label: 'WhatsApp', data: waData, borderColor: '#25D366', backgroundColor: 'rgba(37,211,102,0.1)', tension: 0.4, fill: true },
          { label: 'SMS', data: smsData, borderColor: '#1B6CA8', backgroundColor: 'rgba(27,108,168,0.1)', tension: 0.4, fill: true }
        ]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
      }
    });

    const waTotal = dailyStats.filter(s => s.channel === 'whatsapp').reduce((a, s) => a + Number(s.count), 0);
    const smsTotal = dailyStats.filter(s => s.channel === 'sms').reduce((a, s) => a + Number(s.count), 0);

    if (doughnutChart) doughnutChart.destroy();
    doughnutChart = new Chart(document.getElementById('doughnut-chart'), {
      type: 'doughnut',
      data: {
        labels: ['WhatsApp', 'SMS'],
        datasets: [{ data: [waTotal, smsTotal], backgroundColor: ['#25D366', '#1B6CA8'], borderWidth: 0 }]
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        cutout: '65%'
      }
    });
  }

  function renderCampaigns(campaigns) {
    const tbody = document.getElementById('campaigns-body');
    if (!campaigns.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No campaigns yet</td></tr>';
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
          <td>
            <div class="d-flex align-items-center gap-2">
              <div class="progress flex-grow-1" style="height:6px">
                <div class="progress-bar" style="width:${progress}%"></div>
              </div>
              <small class="text-muted">${c.sent_count}/${c.total_contacts || 0}</small>
            </div>
          </td>
          <td>${statusBadge(c.status)}</td>
          <td><small class="text-muted">${formatDate(c.created_at)}</small></td>
        </tr>
      `;
    }).join('');
  }

  async function loadStats() {
    try {
      const data = await api('/api/dashboard/stats');
      const s = data.stats;

      document.getElementById('stat-wa').innerHTML = statusBadge(s.wa_status);
      if (s.wa_connected) {
        document.getElementById('stat-wa').innerHTML += `<div class="small text-muted mt-1">${s.wa_connected} sender${s.wa_connected > 1 ? 's' : ''} connected</div>`;
      }
      document.getElementById('stat-contacts').textContent = Number(s.contacts).toLocaleString();
      document.getElementById('stat-messages').textContent = Number(s.messages_30d).toLocaleString();
      document.getElementById('stat-sms').textContent = Number(s.wallet_balance ?? s.sms_credits).toLocaleString();

      renderCharts(data.daily_stats || []);
      renderCampaigns(data.recent_campaigns || []);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  document.getElementById('btn-refresh').addEventListener('click', loadStats);
  loadStats();
})();
