(function () {
  if (!requireAuth()) return;
  renderAppShell('settings');

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="mb-4">
      <h4 class="mb-1 fw-bold">Settings</h4>
      <p class="text-muted mb-0">Manage your account and API access</p>
    </div>

    <div class="row g-4">
      <div class="col-lg-6">
        <div class="content-card mb-4">
          <h6 class="fw-semibold mb-3"><i class="bi bi-person me-2"></i>Profile</h6>
          <form id="profile-form">
            <div class="mb-3">
              <label class="form-label">Full Name</label>
              <input type="text" class="form-control" id="profile-name" required>
            </div>
            <div class="mb-3">
              <label class="form-label">Email</label>
              <input type="email" class="form-control" id="profile-email" disabled>
            </div>
            <div class="mb-3">
              <label class="form-label">Phone</label>
              <input type="tel" class="form-control" id="profile-phone" placeholder="2567XXXXXXXX">
            </div>
            <div class="mb-3">
              <label class="form-label">Plan</label>
              <input type="text" class="form-control" id="profile-plan" disabled>
            </div>
            <button type="submit" class="btn btn-primary"><i class="bi bi-check-lg me-2"></i>Save Profile</button>
          </form>
        </div>
      </div>

      <div class="col-lg-6">
        <div class="content-card mb-4">
          <h6 class="fw-semibold mb-3"><i class="bi bi-shield-lock me-2"></i>Security</h6>
          <form id="password-form">
            <div class="mb-3">
              <label class="form-label">Current Password</label>
              <input type="password" class="form-control" id="pwd-current" required>
            </div>
            <div class="mb-3">
              <label class="form-label">New Password</label>
              <input type="password" class="form-control" id="pwd-new" minlength="8" required>
            </div>
            <div class="mb-3">
              <label class="form-label">Confirm New Password</label>
              <input type="password" class="form-control" id="pwd-confirm" minlength="8" required>
            </div>
            <button type="submit" class="btn btn-outline-primary"><i class="bi bi-key me-2"></i>Change Password</button>
          </form>
        </div>
      </div>

      <div class="col-lg-6">
        <div class="content-card mb-4">
          <h6 class="fw-semibold mb-3"><i class="bi bi-tag me-2"></i>SMS Sender ID</h6>
          <p class="text-muted small">Request an approved sender name for outbound SMS (max 11 characters).</p>
          <div id="sender-list" class="mb-3"></div>
          <form id="sender-form" class="row g-2 align-items-end">
            <div class="col-8">
              <input type="text" class="form-control text-uppercase" id="sender-id-input" maxlength="11" placeholder="e.g. AFRIECON" required>
            </div>
            <div class="col-4">
              <button type="submit" class="btn btn-outline-primary w-100">Request</button>
            </div>
          </form>
        </div>
      </div>

      <div class="col-12">
        <div class="content-card">
          <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
            <h6 class="fw-semibold mb-0"><i class="bi bi-code-slash me-2"></i>API Key</h6>
            <button class="btn btn-sm btn-outline-danger" id="btn-regenerate-key">
              <i class="bi bi-arrow-repeat me-1"></i>Regenerate Key
            </button>
          </div>
          <p class="text-muted small">Use this key in the <code>X-API-Key</code> header for programmatic access (OTP, SMS API).</p>
          <div class="input-group">
            <input type="password" class="form-control font-monospace" id="api-key" readonly>
            <button class="btn btn-outline-secondary" type="button" id="btn-toggle-key"><i class="bi bi-eye"></i></button>
            <button class="btn btn-outline-primary" type="button" id="btn-copy-key"><i class="bi bi-clipboard"></i> Copy</button>
          </div>
        </div>
      </div>
    </div>
  `;

  async function loadProfile() {
    try {
      const data = await api('/api/auth/me');
      const user = data.user;

      document.getElementById('profile-name').value = user.name || '';
      document.getElementById('profile-email').value = user.email || '';
      document.getElementById('profile-phone').value = user.phone || '';
      document.getElementById('profile-plan').value = (user.plan || 'free').charAt(0).toUpperCase() + (user.plan || 'free').slice(1);
      document.getElementById('api-key').value = user.api_key || '';

      const stored = getUser();
      if (stored) {
        stored.name = user.name;
        stored.phone = user.phone;
        stored.sms_credits = user.sms_credits;
        localStorage.setItem('afrieconnect_user', JSON.stringify(stored));
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  document.getElementById('profile-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('profile-name').value.trim();
    const phone = document.getElementById('profile-phone').value.trim();

    try {
      const data = await api('/api/auth/me', {
        method: 'PUT',
        body: JSON.stringify({ name, phone: phone || undefined })
      });
      const stored = getUser();
      if (stored && data.user) {
        stored.name = data.user.name;
        stored.phone = data.user.phone;
        localStorage.setItem('afrieconnect_user', JSON.stringify(stored));
      }
      showToast('Profile updated');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('password-form').addEventListener('submit', async e => {
    e.preventDefault();
    const current = document.getElementById('pwd-current').value;
    const newPwd = document.getElementById('pwd-new').value;
    const confirm = document.getElementById('pwd-confirm').value;

    if (newPwd !== confirm) {
      showToast('Passwords do not match', 'error');
      return;
    }

    try {
      await api('/api/auth/change-password', {
        method: 'PUT',
        body: JSON.stringify({ current, new: newPwd })
      });
      showToast('Password changed successfully');
      e.target.reset();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-toggle-key').addEventListener('click', () => {
    const input = document.getElementById('api-key');
    const icon = document.querySelector('#btn-toggle-key i');
    if (input.type === 'password') {
      input.type = 'text';
      icon.className = 'bi bi-eye-slash';
    } else {
      input.type = 'password';
      icon.className = 'bi bi-eye';
    }
  });

  document.getElementById('btn-copy-key').addEventListener('click', async () => {
    const key = document.getElementById('api-key').value;
    try {
      await navigator.clipboard.writeText(key);
      showToast('API key copied');
    } catch {
      showToast('Failed to copy', 'error');
    }
  });

  document.getElementById('btn-regenerate-key').addEventListener('click', async () => {
    if (!await confirmDialog({
      title: 'Regenerate API key?',
      message: 'Your current key will stop working immediately. Any integrations using it will break.',
      confirmText: 'Regenerate',
      variant: 'warning'
    })) return;
    try {
      const data = await api('/api/auth/regenerate-api-key', { method: 'POST' });
      document.getElementById('api-key').value = data.api_key;
      showToast('API key regenerated');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  async function loadSenderIds() {
    try {
      const data = await api('/api/sender-ids');
      const list = document.getElementById('sender-list');
      if (!list) return;
      list.innerHTML = (data.sender_ids || []).map(s => `
        <div class="d-flex justify-content-between align-items-center border rounded px-3 py-2 mb-2">
          <code>${s.sender_id}</code>
          ${statusBadge(s.status)}
        </div>
      `).join('') || '<p class="text-muted small mb-0">No sender IDs yet.</p>';
    } catch (_) {}
  }

  document.getElementById('sender-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const sender_id = document.getElementById('sender-id-input').value.trim();
    try {
      await api('/api/sender-ids', { method: 'POST', body: JSON.stringify({ sender_id }) });
      showToast('Sender ID submitted for approval');
      e.target.reset();
      loadSenderIds();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  loadProfile();
  loadSenderIds();
})();
