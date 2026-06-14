const SECRET_MASK = '********';

const GROUP_META = {
  credentials: { title: 'API Credentials', icon: 'bi-key-fill', hint: 'Keys and secrets from your provider dashboard' },
  connection: { title: 'Connection & Endpoints', icon: 'bi-hdd-network-fill', hint: 'Host URLs, ports, and environment settings' },
  identity: { title: 'Sender & Identity', icon: 'bi-person-badge-fill', hint: 'How messages appear to recipients' },
  webhooks: { title: 'Webhooks & Security', icon: 'bi-shield-lock-fill', hint: 'Webhook secrets and callback verification' },
  general: { title: 'Additional Settings', icon: 'bi-sliders', hint: 'Other provider-specific options' }
};

const GROUP_ORDER = ['credentials', 'connection', 'identity', 'webhooks', 'general'];

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function gatewayStatusBadge(active, supported) {
  const parts = [
    active ? '<span class="badge bg-success">Active</span>' : '<span class="badge bg-secondary">Inactive</span>'
  ];
  if (supported) {
    parts.push('<span class="badge bg-primary-subtle text-primary border border-primary-subtle">Live</span>');
  } else {
    parts.push('<span class="badge bg-light text-muted border">Configure only</span>');
  }
  return parts.join(' ');
}

function getFields(gateway) {
  return gateway.template?.fields || [];
}

function inferFieldGroup(field) {
  const key = field.group || field.key;
  if (field.group) return field.group;
  if (['webhook_secret'].includes(key)) return 'webhooks';
  if (['sender_id', 'originator', 'from_email', 'from_name', 'smtp_from'].includes(key)) return 'identity';
  if (['api_base', 'base_url', 'environment', 'region', 'domain', 'service_type', 'ipn_id', 'smtp_host', 'smtp_port', 'smtp_secure'].includes(key)) {
    return 'connection';
  }
  return 'credentials';
}

function groupFields(fields) {
  const groups = {};
  for (const field of fields) {
    const group = inferFieldGroup(field);
    if (!groups[group]) groups[group] = [];
    groups[group].push(field);
  }
  return GROUP_ORDER.filter(name => groups[name]?.length).map(name => ({
    name,
    ...GROUP_META[name],
    fields: groups[name]
  }));
}

function renderFieldInput(gateway, field) {
  const required = field.required ? ' <span class="text-danger">*</span>' : '';
  const hint = field.hint ? `<div class="form-text">${escapeHtml(field.hint)}</div>` : '';
  return `
    <div class="col-md-6">
      <label class="form-label fw-semibold small mb-1" for="cfg-${gateway.id}-${field.key}">
        ${escapeHtml(field.label)}${required}
      </label>
      <input
        type="${field.type || 'text'}"
        class="form-control"
        id="cfg-${gateway.id}-${field.key}"
        data-key="${field.key}"
        value="${field.type === 'password' ? '' : escapeHtml(gateway.config[field.key] || '')}"
        placeholder="${field.type === 'password' && gateway.config[field.key] ? SECRET_MASK : (field.placeholder || '')}"
        autocomplete="off"
      >
      ${hint}
    </div>
  `;
}

function renderFieldSections(gateway) {
  const sections = groupFields(getFields(gateway));
  if (!sections.length) {
    return '<p class="text-muted small mb-0">No configurable fields for this provider.</p>';
  }

  return sections.map(section => `
    <div class="gateway-section">
      <div class="gateway-section-head">
        <div class="gateway-section-icon"><i class="bi ${section.icon}"></i></div>
        <div>
          <h6 class="gateway-section-title mb-0">${escapeHtml(section.title)}</h6>
          <p class="gateway-section-hint mb-0">${escapeHtml(section.hint)}</p>
        </div>
      </div>
      <div class="row g-3">
        ${section.fields.map(field => renderFieldInput(gateway, field)).join('')}
      </div>
    </div>
  `).join('');
}

function renderProviderPreview(template, configured = false) {
  if (!template) return '';
  if (configured) {
    return `
      <div class="gateway-preview-box gateway-preview-box-configured">
        <div class="gateway-preview-label">Selected provider</div>
        <div class="gateway-preview-name">${escapeHtml(template.display_name)}</div>
        <p class="gateway-preview-desc">${escapeHtml(template.description || '')}</p>
        <div class="alert alert-success py-2 px-3 mb-0 small">
          <i class="bi bi-check-circle me-1"></i>Already configured — scroll down to edit SMTP host, Gmail app password, and from address.
        </div>
      </div>
    `;
  }
  const sections = groupFields(template.fields || []);
  const fieldList = (template.fields || []).map(f => f.label).join(' · ');
  return `
    <div class="gateway-preview-box">
      <div class="gateway-preview-label">Selected provider</div>
      <div class="gateway-preview-name">${escapeHtml(template.display_name)}</div>
      <p class="gateway-preview-desc">${escapeHtml(template.description || '')}</p>
      <div class="gateway-preview-label mt-3">Configuration sections</div>
      <ul class="gateway-preview-list mb-0">
        ${sections.map(s => `<li><i class="bi ${s.icon} me-1"></i>${escapeHtml(s.title)}</li>`).join('')}
      </ul>
      <div class="gateway-preview-fields">${escapeHtml(fieldList)}</div>
    </div>
  `;
}

function renderAddGatewaySection(category, templates, gateways) {
  const configured = new Set((gateways || []).map(g => g.provider));
  const allTemplates = templates || [];
  if (!allTemplates.length) {
    return `<div class="alert alert-warning mb-4 mb-0">No provider templates available.</div>`;
  }

  const available = allTemplates.filter(t => !configured.has(t.provider));
  const defaultTemplate = available[0] || allTemplates[0];

  const options = allTemplates.map(t => {
    const isConfigured = configured.has(t.provider);
    const label = `${t.display_name}${t.supported ? ' ✓' : ''}${isConfigured ? ' — already configured' : ''}`;
    return `<option value="${t.provider}" data-configured="${isConfigured ? '1' : '0'}">${escapeHtml(label)}</option>`;
  }).join('');

  const allConfigured = !available.length;

  return `
    <div class="content-card gateway-add-panel mb-4">
      <div class="row g-4 align-items-stretch">
        <div class="col-lg-7">
          <div class="gateway-add-head mb-3">
            <div class="gateway-add-icon"><i class="bi bi-plus-circle"></i></div>
            <div>
              <h6 class="fw-semibold mb-1">Add provider</h6>
              <p class="small text-muted mb-0">All supported providers are listed below. Already configured ones are marked — edit them in the cards further down.</p>
            </div>
          </div>

          <div class="row g-3">
            <div class="col-12">
              <label class="form-label small fw-semibold text-muted mb-1">Provider</label>
              <select class="form-select form-select-lg" id="add-provider-select">${options}</select>
              <div class="form-text" id="add-provider-note"></div>
            </div>
            <div class="col-md-8">
              <label class="form-label small fw-semibold text-muted mb-1">Display name <span class="fw-normal">(optional)</span></label>
              <input type="text" class="form-control" id="add-display-name" placeholder="${escapeHtml(defaultTemplate?.display_name || 'Provider name')}" ${allConfigured ? 'disabled' : ''}>
            </div>
            <div class="col-md-4 d-grid align-items-end">
              <button type="button" class="btn btn-primary" id="btn-add-gateway" ${allConfigured ? 'disabled' : ''}>
                <i class="bi bi-plus-lg me-1"></i>Add provider
              </button>
            </div>
          </div>
        </div>
        <div class="col-lg-5">
          <div id="add-provider-preview">${renderProviderPreview(defaultTemplate, false)}</div>
        </div>
      </div>
    </div>
  `;
}

function renderWebhookSection(gateway, meta) {
  if (gateway.category !== 'payment' || gateway.provider !== 'flutterwave') return '';

  return `
    <div class="gateway-section gateway-section-accent">
      <div class="gateway-section-head">
        <div class="gateway-section-icon"><i class="bi bi-link-45deg"></i></div>
        <div>
          <h6 class="gateway-section-title mb-0">Webhooks & Callbacks</h6>
          <p class="gateway-section-hint mb-0">Register this URL in Flutterwave so wallet top-ups complete automatically</p>
        </div>
      </div>
      <label class="form-label fw-semibold small mb-1">Webhook URL</label>
      <div class="input-group mb-2">
        <input type="text" class="form-control font-monospace small" id="webhook-url-${gateway.id}" value="${escapeHtml(meta.webhook_url || '')}" readonly>
        <button class="btn btn-outline-secondary btn-copy-webhook" type="button" data-target="webhook-url-${gateway.id}">
          <i class="bi bi-clipboard me-1"></i>Copy
        </button>
      </div>
      <button type="button" class="btn btn-outline-success btn-sm btn-reconcile">
        <i class="bi bi-arrow-repeat me-1"></i>Sync pending payments
      </button>
    </div>
  `;
}

function renderGatewayForm(gateway, meta, category) {
  return `
    <div class="content-card mb-4 gateway-card" data-gateway-id="${gateway.id}">
      <div class="gateway-card-head">
        <div class="gateway-card-brand">
          <div class="gateway-card-icon"><i class="bi bi-plug-fill"></i></div>
          <div>
            <h6 class="fw-semibold mb-1">${escapeHtml(gateway.display_name)}</h6>
            <div class="small text-muted mb-1">${escapeHtml(gateway.provider)} · ${gatewayStatusBadge(gateway.is_active, gateway.template?.supported)}</div>
            <div class="small text-muted">${escapeHtml(gateway.template?.description || '')}</div>
          </div>
        </div>
        <div class="gateway-card-controls">
          <div class="gateway-control-item">
            <label class="form-check form-switch mb-0">
              <input class="form-check-input gateway-active" type="checkbox" id="active-${gateway.id}" ${gateway.is_active ? 'checked' : ''}>
              <span class="form-check-label">Enabled</span>
            </label>
          </div>
          <div class="gateway-control-item">
            <label class="form-check mb-0">
              <input class="form-check-input gateway-default" type="radio" name="default-${category}" id="default-${gateway.id}" ${gateway.is_default ? 'checked' : ''}>
              <span class="form-check-label">Default provider</span>
            </label>
          </div>
        </div>
      </div>

      <div class="gateway-sections">
        ${renderFieldSections(gateway)}
        ${renderWebhookSection(gateway, meta)}
      </div>

      <div class="gateway-card-footer">
        <div class="d-flex flex-wrap gap-2">
          <button type="button" class="btn btn-primary btn-sm btn-save-gateway" data-id="${gateway.id}">
            <i class="bi bi-save me-1"></i>Save settings
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm btn-test-gateway" data-id="${gateway.id}">
            <i class="bi bi-plug me-1"></i>Test connection
          </button>
          <button type="button" class="btn btn-outline-danger btn-sm btn-delete-gateway" data-id="${gateway.id}">
            <i class="bi bi-trash me-1"></i>Remove
          </button>
        </div>
        <div class="small text-muted mt-3" id="result-${gateway.id}"></div>
      </div>
    </div>
  `;
}

function collectGatewayConfig(card, fields) {
  const config = {};
  for (const field of fields) {
    const input = card.querySelector(`[data-key="${field.key}"]`);
    if (!input) continue;
    const value = input.value.trim();
    if (field.type === 'password' && (!value || value === SECRET_MASK)) continue;
    config[field.key] = value;
  }
  return config;
}

function bindAddGateway(category, templates, reload) {
  const select = document.getElementById('add-provider-select');
  const preview = document.getElementById('add-provider-preview');
  const note = document.getElementById('add-provider-note');
  const btn = document.getElementById('btn-add-gateway');
  const nameInput = document.getElementById('add-display-name');
  if (!select || !btn) return;

  const configuredSet = new Set(
    [...select.options].filter(o => o.dataset.configured === '1').map(o => o.value)
  );

  const updatePreview = () => {
    const tpl = templates.find(t => t.provider === select.value);
    const isConfigured = configuredSet.has(select.value);
    if (preview && tpl) preview.innerHTML = renderProviderPreview(tpl, isConfigured);
    if (note) {
      note.textContent = isConfigured
        ? 'This provider is already set up. Use the configuration card below to update Gmail/SMTP settings.'
        : (tpl?.description || '');
    }
    if (nameInput && tpl) nameInput.placeholder = tpl.display_name;
    btn.disabled = isConfigured;
    if (nameInput) nameInput.disabled = isConfigured;
  };

  select.addEventListener('change', updatePreview);
  updatePreview();

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      await api('/api/admin/gateways', {
        method: 'POST',
        body: JSON.stringify({
          category,
          provider: select.value,
          display_name: document.getElementById('add-display-name')?.value.trim() || undefined,
          is_active: false
        })
      });
      showToast('Provider added — configure credentials below');
      await reload();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
    }
  });
}

function bindGatewayCards(category, gateways, meta) {
  const root = document.getElementById('gateways-root');

  root.querySelectorAll('.btn-copy-webhook').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      navigator.clipboard.writeText(input.value).then(() => showToast('Webhook URL copied'));
    });
  });

  root.querySelectorAll('.btn-reconcile').forEach(btn => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const result = await api('/api/admin/reconcile-payments', { method: 'POST' });
        showToast(`Synced ${result.synced} payment(s), ${result.failed} failed, ${result.checked} checked`);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll('.btn-save-gateway').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const card = root.querySelector(`[data-gateway-id="${id}"]`);
      const gateway = gateways.find(g => String(g.id) === String(id));
      const fields = getFields(gateway);
      btn.disabled = true;
      try {
        await api(`/api/admin/gateways/${id}`, {
          method: 'PUT',
          body: JSON.stringify({
            is_active: card.querySelector('.gateway-active').checked,
            is_default: card.querySelector('.gateway-default').checked,
            config: collectGatewayConfig(card, fields)
          })
        });
        showToast('Gateway settings saved');
        await loadAdminGateways(category);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll('.btn-test-gateway').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const resultEl = document.getElementById(`result-${id}`);
      btn.disabled = true;
      resultEl.textContent = 'Testing connection…';
      try {
        const result = await api(`/api/admin/gateways/${id}/test`, { method: 'POST' });
        if (result.balance !== undefined) {
          resultEl.textContent = `${result.message}. Balance: ${Number(result.balance).toLocaleString()} ${result.currency || 'UGX'}`;
        } else {
          resultEl.textContent = result.message || 'Connection successful';
        }
        showToast(result.message || 'Connection successful');
      } catch (err) {
        resultEl.textContent = err.message;
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });

  root.querySelectorAll('.btn-delete-gateway').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Remove this provider configuration?')) return;
      btn.disabled = true;
      try {
        await api(`/api/admin/gateways/${btn.dataset.id}`, { method: 'DELETE' });
        showToast('Provider removed');
        await loadAdminGateways(category);
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function loadAdminGateways(category) {
  const root = document.getElementById('gateways-root');
  const data = await api(`/api/admin/gateways?category=${category}`);
  const gateways = data.gateways || [];
  const templates = data.templates || [];

  const addSection = renderAddGatewaySection(category, templates, gateways);
  const webhookInfo = category === 'sms' ? `
    <div class="content-card mb-4">
      <h6 class="fw-semibold mb-2"><i class="bi bi-link-45deg me-1"></i>SMS webhook URLs</h6>
      <p class="small text-muted">Register these in your EgoSMS / provider dashboard for delivery reports and inbound SMS.</p>
      <div class="mb-2">
        <label class="form-label small fw-semibold">Delivery reports (DLR)</label>
        <div class="input-group input-group-sm">
          <input type="text" class="form-control font-monospace" readonly value="${escapeHtml(data.app_url)}/api/sms/webhook/dlr">
        </div>
      </div>
      <div>
        <label class="form-label small fw-semibold">Inbound messages</label>
        <div class="input-group input-group-sm">
          <input type="text" class="form-control font-monospace" readonly value="${escapeHtml(data.app_url)}/api/sms/webhook/inbound">
        </div>
      </div>
      <div class="form-text mt-2">Optional: set <code>SMS_WEBHOOK_SECRET</code> in .env and append <code>?secret=YOUR_SECRET</code> to URLs.</div>
    </div>
  ` : '';
  const cards = gateways.length
    ? gateways.map(gateway => renderGatewayForm(gateway, data, category)).join('')
    : `<div class="alert alert-warning">No providers configured yet. Add one above.</div>`;

  root.innerHTML = addSection + webhookInfo + cards;
  bindAddGateway(category, templates, () => loadAdminGateways(category));
  bindGatewayCards(category, gateways, data);
}
