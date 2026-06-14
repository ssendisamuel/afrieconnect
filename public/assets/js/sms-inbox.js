(function () {
  if (!requireAuth()) return;
  renderAppShell('sms-inbox');

  async function loadInbox() {
    const search = document.getElementById('search-term')?.value || '';
    const from = document.getElementById('from-date')?.value || '';
    const to = document.getElementById('to-date')?.value || '';
    const qs = new URLSearchParams({ search, from, to });
    const data = await api(`/api/sms/inbox?${qs}`);
    const tbody = document.getElementById('inbox-body');

    if (!data.messages?.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted py-4">
        No incoming messages yet.<br>
        <span class="small">Two-way SMS inbox requires inbound routing to be enabled on your account.</span>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = data.messages.map((m, i) => `
      <tr>
        <td>${i + 1}</td>
        <td class="small">${m.message}</td>
        <td>${m.phone}</td>
        <td class="small">${formatDate(m.received_at)}</td>
      </tr>
    `).join('');
  }

  document.getElementById('page-content').innerHTML = `
    <div class="mb-3">
      <h4 class="mb-1 fw-bold">Message Center</h4>
      <p class="text-muted mb-0">Inbox — replies and incoming SMS</p>
    </div>
    ${renderSmsSubnav('inbox')}

    <div class="content-card table-card">
      <div class="row g-2 mb-3">
        <div class="col-md-4"><input type="text" class="form-control form-control-sm" id="search-term" placeholder="Search term"></div>
        <div class="col-md-3"><input type="date" class="form-control form-control-sm" id="from-date"></div>
        <div class="col-md-3"><input type="date" class="form-control form-control-sm" id="to-date"></div>
        <div class="col-md-2"><button class="btn btn-primary btn-sm w-100" id="btn-search"><i class="bi bi-search"></i> Search</button></div>
      </div>
      <div class="table-responsive">
        <table class="table align-middle">
          <thead><tr><th>No.</th><th>Message</th><th>From</th><th>Received</th></tr></thead>
          <tbody id="inbox-body"><tr><td colspan="4" class="text-center py-4">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>
  `;

  document.getElementById('btn-search').addEventListener('click', () => loadInbox().catch(err => showToast(err.message, 'error')));
  loadInbox().catch(err => showToast(err.message, 'error'));
})();
