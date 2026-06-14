const SMS_PART_SIZE = 160;

function smsStats(text) {
  const chars = text ? text.length : 0;
  const parts = chars === 0 ? 0 : Math.ceil(chars / SMS_PART_SIZE);
  return { chars, parts };
}

function partsHint(maxParts = 4) {
  const items = [];
  for (let i = 1; i <= maxParts; i++) {
    items.push(`${i} Message${i > 1 ? 's' : ''} ${i * SMS_PART_SIZE} Characters`);
  }
  return items.join(', ') + ' ...';
}

function parseRecipientText(text) {
  return [...new Set(
    String(text || '')
      .split(/[\n,;\t]+/)
      .map(v => v.trim())
      .filter(Boolean)
  )];
}

function renderSmsSubnav(active) {
  const items = [
    { href: '/app/sms.html', label: 'Single / Bulk', id: 'bulk' },
    { href: '/app/sms/custom.html', label: 'Custom', id: 'custom' },
    { href: '/app/sms/scheduled.html', label: 'Scheduled', id: 'scheduled' },
    { href: '/app/sms/inbox.html', label: 'Inbox', id: 'inbox' },
    { href: '/app/sms/outbox.html', label: 'Outbox', id: 'outbox' },
    { href: '/app/templates.html', label: 'Templates', id: 'templates' }
  ];

  return `
    <ul class="nav nav-pills sms-subnav mb-4 flex-wrap gap-1">
      ${items.map(item => `
        <li class="nav-item">
          <a class="nav-link ${active === item.id ? 'active' : ''}" href="${item.href}">${item.label}</a>
        </li>
      `).join('')}
    </ul>
  `;
}

function renderSmsBalanceCards() {
  return `
    <div class="row g-4 mb-4">
      <div class="col-md-4">
        <div class="stat-card">
          <div class="stat-icon bg-primary bg-opacity-10 text-primary"><i class="bi bi-wallet2"></i></div>
          <div>
            <div class="stat-value" id="user-credits">—</div>
            <div class="stat-label">Your Wallet (UGX)</div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card">
          <div class="stat-icon bg-success bg-opacity-10 text-success"><i class="bi bi-chat-dots"></i></div>
          <div>
            <div class="stat-value" id="sms-rate">—</div>
            <div class="stat-label">SMS Rate (UGX / part)</div>
          </div>
        </div>
      </div>
      <div class="col-md-4">
        <div class="stat-card">
          <div class="stat-icon bg-info bg-opacity-10 text-info"><i class="bi bi-calculator"></i></div>
          <div>
            <div class="stat-value" id="estimated-parts">—</div>
            <div class="stat-label">Est. single-part SMS</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function loadSmsBalance() {
  const data = await api('/api/wallet/balance');
  document.getElementById('user-credits').textContent = Number(data.wallet_balance).toLocaleString();
  document.getElementById('sms-rate').textContent = Number(data.sms_rate || 0).toLocaleString();
  document.getElementById('estimated-parts').textContent = Number(data.estimated_sms_parts || 0).toLocaleString();
  return data;
}

function bindMessageCounter(textareaId, charId, msgId, onUpdate) {
  const textarea = document.getElementById(textareaId);
  const update = () => {
    const { chars, parts } = smsStats(textarea.value);
    document.getElementById(charId).textContent = chars;
    document.getElementById(msgId).textContent = parts;
    if (onUpdate) onUpdate();
  };
  textarea.addEventListener('input', update);
  update();
}

function bindTemplateSelect(selectId, messageId, onSelect) {
  return api('/api/templates').then(data => {
    const select = document.getElementById(selectId);
    const templates = (data.templates || []).filter(t => !t.channel || t.channel === 'sms' || t.channel === 'both');
    select.innerHTML = '<option value="">No Template Selected</option>' +
      templates.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    select.templatesCache = templates;
    select.addEventListener('change', () => {
      const tpl = templates.find(t => String(t.id) === select.value);
      if (tpl) {
        document.getElementById(messageId).value = tpl.message;
        if (onSelect) onSelect();
      }
    });
  }).catch(() => {});
}
