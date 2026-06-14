const API_BASE = '';
const TOKEN_KEY = 'afrieconnect_token';
const USER_KEY = 'afrieconnect_user';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
}

function setAuth(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function requireAuth() {
  if (!getToken()) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}

function requireAdmin() {
  const user = getUser();
  if (!user || user.role !== 'admin') {
    window.location.href = '/app/index.html';
    return false;
  }
  return true;
}

async function api(url, options = {}) {
  const headers = { ...options.headers };
  const isForm = options.body instanceof FormData;
  if (!isForm) {
    headers['Content-Type'] = 'application/json';
  }
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${API_BASE}${url}`, {
      ...options,
      headers,
      body: isForm ? options.body : (options.body ? options.body : undefined)
    });
  } catch (err) {
    throw new Error('Cannot reach server. Ensure AfrieConnect is running (npm start).');
  }

  const data = await res.json().catch(() => ({}));

  if (res.status === 401) {
    clearAuth();
    window.location.href = '/login.html';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const msg = data.message || data.errors?.[0]?.msg || `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `alert alert-${type === 'success' ? 'success' : type === 'warning' ? 'warning' : 'danger'} position-fixed top-0 end-0 m-3 shadow-sm ac-toast`;
  toast.style.zIndex = '9999';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function ensureConfirmModal() {
  if (document.getElementById('ac-confirm-modal')) return;

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal fade ac-confirm-modal" id="ac-confirm-modal" tabindex="-1" aria-hidden="true">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content border-0 shadow">
          <div class="modal-body p-4 text-center">
            <div class="ac-confirm-icon mb-3" id="ac-confirm-icon"></div>
            <h5 class="fw-semibold mb-2" id="ac-confirm-title">Confirm</h5>
            <p class="text-muted mb-0" id="ac-confirm-message"></p>
          </div>
          <div class="modal-footer border-0 pt-0 px-4 pb-4 justify-content-center gap-2">
            <button type="button" class="btn btn-light px-4" id="ac-confirm-cancel">Cancel</button>
            <button type="button" class="btn px-4" id="ac-confirm-ok">Confirm</button>
          </div>
        </div>
      </div>
    </div>
  `);
}

function confirmDialog(options) {
  if (typeof options === 'string') options = { message: options };

  const {
    title = 'Are you sure?',
    message = '',
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    variant = 'primary'
  } = options;

  ensureConfirmModal();

  const modalEl = document.getElementById('ac-confirm-modal');
  const iconEl = document.getElementById('ac-confirm-icon');
  const titleEl = document.getElementById('ac-confirm-title');
  const messageEl = document.getElementById('ac-confirm-message');
  const okBtn = document.getElementById('ac-confirm-ok');
  const cancelBtn = document.getElementById('ac-confirm-cancel');

  const icons = {
    danger: '<i class="bi bi-trash3"></i>',
    warning: '<i class="bi bi-exclamation-triangle"></i>',
    primary: '<i class="bi bi-question-circle"></i>'
  };

  iconEl.className = `ac-confirm-icon mb-3 ac-confirm-${variant}`;
  iconEl.innerHTML = icons[variant] || icons.primary;
  titleEl.textContent = title;
  messageEl.textContent = message;
  okBtn.textContent = confirmText;
  cancelBtn.textContent = cancelText;
  okBtn.className = `btn px-4 btn-${variant === 'danger' ? 'danger' : variant === 'warning' ? 'warning' : 'primary'}`;

  const modal = bootstrap.Modal.getOrCreateInstance(modalEl, { backdrop: 'static' });

  return new Promise(resolve => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(result);
    };

    const onOk = () => {
      modal.hide();
      finish(true);
    };

    const onCancel = () => {
      modal.hide();
      finish(false);
    };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.show();
  });
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-UG', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function statusBadge(status) {
  const normalized = String(status || '').toLowerCase();
  const map = {
    draft: 'secondary', queued: 'warning', running: 'primary status-pulse',
    paused: 'warning', completed: 'success', successful: 'success', succeeded: 'success',
    sent: 'success', active: 'success', connected: 'success',
    failed: 'danger', cancelled: 'danger', canceled: 'danger', suspended: 'danger',
    disconnected: 'danger', connecting: 'info', pending: 'warning'
  };
  const label = normalized === 'successful' || normalized === 'succeeded' ? 'Successful' : status;
  return `<span class="badge bg-${map[normalized] || 'secondary'}">${label}</span>`;
}

function channelBadge(channel) {
  const cls = channel === 'whatsapp' ? 'success' : 'primary';
  const icon = channel === 'whatsapp' ? 'bi-whatsapp' : 'bi-chat-text';
  return `<span class="badge bg-${cls}"><i class="bi ${icon} me-1"></i>${channel.toUpperCase()}</span>`;
}

let socket = null;

function initSocket() {
  const token = getToken();
  if (!token || typeof io === 'undefined') return null;

  if (socket?.connected) return socket;

  socket = io({ transports: ['websocket', 'polling'] });
  socket.on('connect', () => socket.emit('authenticate', { token }));

  return socket;
}

function renderAppShell(activePage) {
  const user = getUser();
  if (!user) return;

  const isAdmin = user.role === 'admin';
  const initials = user.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const smsItems = [
    { href: '/app/sms.html', label: 'Single / Bulk SMS', id: 'sms-bulk' },
    { href: '/app/sms/custom.html', label: 'Custom SMS', id: 'sms-custom' },
    { href: '/app/sms/scheduled.html', label: 'Scheduled SMS', id: 'sms-scheduled' },
    { href: '/app/sms/inbox.html', label: 'Inbox', id: 'sms-inbox' },
    { href: '/app/sms/outbox.html', label: 'Outbox', id: 'sms-outbox' },
    { href: '/app/templates.html', label: 'Message Templates', id: 'templates' }
  ];

  const navItems = [
    { href: '/app/index.html', icon: 'bi-speedometer2', label: 'Dashboard', id: 'dashboard' },
    { href: '/app/payments.html', icon: 'bi-credit-card', label: 'Payments', id: 'payments' },
    { href: '/app/contacts.html', icon: 'bi-people', label: 'Contacts', id: 'contacts' },
    { href: '/app/campaigns.html', icon: 'bi-megaphone', label: 'Campaigns', id: 'campaigns' },
    { href: '/app/settings.html', icon: 'bi-gear', label: 'Settings', id: 'settings' }
  ];

  const whatsappItems = [
    { href: '/app/whatsapp/connect.html', icon: 'bi-phone', label: 'Connect Account', id: 'wa-connect' },
    { href: '/app/whatsapp/campaign.html', icon: 'bi-megaphone', label: 'Create Campaign', id: 'wa-campaign' },
    { href: '/app/whatsapp/reports.html', icon: 'bi-bar-chart', label: 'Reports', id: 'wa-reports' },
    { href: '/app/whatsapp/outbox.html', icon: 'bi-inbox', label: 'Outbox', id: 'wa-outbox' }
  ];

  const waOpen = whatsappItems.some(i => i.id === activePage);
  const smsOpen = smsItems.some(i => i.id === activePage) || activePage === 'sms';

  const adminItems = [
    { href: '/app/admin/dashboard.html', icon: 'bi-speedometer2', label: 'Dashboard', id: 'admin-dashboard' },
    { href: '/app/admin/users.html', icon: 'bi-shield-person', label: 'Users', id: 'admin-users' },
    { href: '/app/admin/payment-gateways.html', icon: 'bi-credit-card-2-front', label: 'Payment Gateways', id: 'admin-payment-gateways' },
    { href: '/app/admin/sms-gateways.html', icon: 'bi-broadcast-pin', label: 'SMS Gateways', id: 'admin-sms-gateways' },
    { href: '/app/admin/email-settings.html', icon: 'bi-envelope-gear', label: 'Email Settings', id: 'admin-email-settings' },
    { href: '/app/admin/sender-ids.html', icon: 'bi-tag', label: 'Sender IDs', id: 'admin-sender-ids' },
    { href: '/app/admin/platform-sms.html', icon: 'bi-broadcast', label: 'Platform SMS', id: 'admin-sms' },
    { href: '/app/admin/logs.html', icon: 'bi-journal-text', label: 'Logs', id: 'admin-logs' }
  ];

  const shell = document.getElementById('app-shell');
  if (!shell) return;

  shell.innerHTML = `
    <div class="app-wrapper">
      <aside class="app-sidebar" id="sidebar">
        <div class="sidebar-brand">
          <span class="brand-wiza" style="color:#ff6b35">Afrie</span><span style="color:#60a5fa">Connect</span>
        </div>
        <nav class="nav flex-column flex-grow-1 py-2">
          <div class="nav-item">
            <a class="nav-link ${activePage === 'dashboard' ? 'active' : ''}" href="/app/index.html">
              <i class="bi bi-speedometer2"></i> Dashboard
            </a>
          </div>
          <div class="nav-item wa-nav-group ${smsOpen ? 'open' : ''}">
            <button class="nav-link wa-nav-toggle ${smsOpen ? 'active' : ''}" type="button" onclick="this.closest('.wa-nav-group').classList.toggle('open')">
              <span><i class="bi bi-chat-text"></i> Message Center</span>
              <i class="bi bi-chevron-down wa-chevron"></i>
            </button>
            <div class="wa-submenu">
              ${smsItems.map(item => `
                <a class="nav-link wa-sub-link ${activePage === item.id || (activePage === 'sms' && item.id === 'sms-bulk') ? 'active' : ''}" href="${item.href}">
                  ${item.label}
                </a>
              `).join('')}
            </div>
          </div>
          <div class="nav-item wa-nav-group ${waOpen ? 'open' : ''}">
            <button class="nav-link wa-nav-toggle ${waOpen ? 'active' : ''}" type="button" onclick="this.closest('.wa-nav-group').classList.toggle('open')">
              <span><i class="bi bi-whatsapp"></i> WhatsApp</span>
              <i class="bi bi-chevron-down wa-chevron"></i>
            </button>
            <div class="wa-submenu">
              ${whatsappItems.map(item => `
                <a class="nav-link wa-sub-link ${activePage === item.id ? 'active' : ''}" href="${item.href}">
                  ${item.label}
                </a>
              `).join('')}
            </div>
          </div>
          ${navItems.filter(i => i.id !== 'dashboard').map(item => `
            <div class="nav-item">
              <a class="nav-link ${activePage === item.id ? 'active' : ''}" href="${item.href}">
                <i class="bi ${item.icon}"></i> ${item.label}
              </a>
            </div>
          `).join('')}
          ${isAdmin ? `
            <div class="sidebar-section-label">Admin</div>
            ${adminItems.map(item => `
              <div class="nav-item">
                <a class="nav-link ${activePage === item.id ? 'active' : ''}" href="${item.href}">
                  <i class="bi ${item.icon}"></i> ${item.label}
                </a>
              </div>
            `).join('')}
          ` : ''}
        </nav>
        <div class="p-3 border-top border-secondary">
          <button class="btn btn-primary w-100" onclick="logout()">
            <i class="bi bi-box-arrow-left me-2"></i>Logout
          </button>
        </div>
      </aside>
      <div class="app-main">
        <div class="ticker-bar d-none d-md-block">
          <strong>NEW:</strong> Connect WhatsApp → Settings → Linked Devices → Scan QR code to start sending campaigns.
        </div>
        <header class="app-topbar">
          <div class="d-flex align-items-center gap-3">
            <button class="btn btn-link d-lg-none p-0" onclick="document.getElementById('sidebar').classList.toggle('show')">
              <i class="bi bi-list fs-4"></i>
            </button>
            <span class="balance-pill d-none d-sm-inline">WALLET UGX ${Number(user.wallet_balance ?? user.sms_credits ?? 0).toLocaleString()}</span>
            <a href="/app/payments.html" class="btn btn-sm btn-outline-primary d-none d-sm-inline">Top Up</a>
          </div>
          <div class="d-flex align-items-center gap-3">
            <div class="dropdown">
              <button class="btn btn-link text-dark text-decoration-none dropdown-toggle d-flex align-items-center gap-2" data-bs-toggle="dropdown">
                <span class="rounded-circle bg-primary text-white d-inline-flex align-items-center justify-content-center" style="width:36px;height:36px;font-size:0.8rem;">${initials}</span>
                <span class="d-none d-md-inline">${user.name}</span>
              </button>
              <ul class="dropdown-menu dropdown-menu-end">
                <li><a class="dropdown-item" href="/app/settings.html"><i class="bi bi-gear me-2"></i>Settings</a></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item text-danger" href="#" onclick="logout()"><i class="bi bi-box-arrow-left me-2"></i>Logout</a></li>
              </ul>
            </div>
          </div>
        </header>
        <main class="app-content" id="page-content"></main>
      </div>
    </div>
    <a href="https://wa.me/256779265701" class="chat-fab" target="_blank">
      <i class="bi bi-whatsapp"></i> Chat with us
    </a>
  `;
}

function logout() {
  clearAuth();
  if (socket) socket.disconnect();
  window.location.href = '/login.html';
}

window.getToken = getToken;
window.getUser = getUser;
window.setAuth = setAuth;
window.clearAuth = clearAuth;
window.requireAuth = requireAuth;
window.requireAdmin = requireAdmin;
window.api = api;
window.showToast = showToast;
window.confirmDialog = confirmDialog;
window.formatDate = formatDate;
window.statusBadge = statusBadge;
window.channelBadge = channelBadge;
window.initSocket = initSocket;
window.renderAppShell = renderAppShell;
window.logout = logout;
