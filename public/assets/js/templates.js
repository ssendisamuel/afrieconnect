(function () {
  if (!requireAuth()) return;
  renderAppShell('templates');

  let editingId = null;
  let templateModal = null;
  let templatesCache = [];

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
      <div>
        <h4 class="mb-1 fw-bold">Templates</h4>
        <p class="text-muted mb-0">Reusable message templates for campaigns</p>
      </div>
      <button class="btn btn-primary btn-sm" id="btn-new-template">
        <i class="bi bi-plus-lg me-1"></i>New Template
      </button>
    </div>

    <div class="row g-3" id="templates-grid">
      <div class="col-12 text-center text-muted py-5">Loading…</div>
    </div>

    <div class="modal fade" id="template-modal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title" id="template-modal-title">Create Template</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <form id="template-form">
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label">Template Name</label>
                <input type="text" class="form-control" id="tpl-name" required>
              </div>
              <div class="mb-3">
                <label class="form-label">Channel</label>
                <select class="form-select" id="tpl-channel">
                  <option value="both">WhatsApp & SMS</option>
                  <option value="whatsapp">WhatsApp only</option>
                  <option value="sms">SMS only</option>
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label">Message</label>
                <textarea class="form-control" id="tpl-message" rows="5" required></textarea>
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Template</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  templateModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('template-modal'));

  function channelLabel(ch) {
    const map = { whatsapp: 'WhatsApp', sms: 'SMS', both: 'WhatsApp & SMS' };
    return map[ch] || ch;
  }

  function channelIcon(ch) {
    if (ch === 'whatsapp') return 'bi-whatsapp text-success';
    if (ch === 'sms') return 'bi-chat-text text-primary';
    return 'bi-layers text-info';
  }

  async function loadTemplates() {
    const grid = document.getElementById('templates-grid');
    try {
      const data = await api('/api/templates');
      templatesCache = data.templates || [];
      const templates = templatesCache;

      if (!templates.length) {
        grid.innerHTML = `
          <div class="col-12">
            <div class="content-card text-center py-5">
              <i class="bi bi-file-text fs-1 text-muted mb-3 d-block"></i>
              <p class="text-muted mb-3">No templates yet. Create your first message template.</p>
              <button class="btn btn-primary btn-sm" onclick="document.getElementById('btn-new-template').click()">
                <i class="bi bi-plus-lg me-1"></i>Create Template
              </button>
            </div>
          </div>
        `;
        return;
      }

      grid.innerHTML = templates.map(t => `
        <div class="col-md-6 col-lg-4">
          <div class="content-card h-100 d-flex flex-column">
            <div class="d-flex justify-content-between align-items-start mb-2">
              <h6 class="fw-semibold mb-0">${t.name}</h6>
              <span class="badge bg-light text-dark"><i class="bi ${channelIcon(t.channel)} me-1"></i>${channelLabel(t.channel)}</span>
            </div>
            <p class="text-muted small flex-grow-1">${t.message.length > 120 ? t.message.slice(0, 120) + '…' : t.message}</p>
            <div class="d-flex justify-content-between align-items-center mt-2 pt-2 border-top">
              <small class="text-muted">${formatDate(t.created_at)}</small>
              <div class="btn-group btn-group-sm">
                <button class="btn btn-outline-primary btn-edit" data-id="${t.id}">
                  <i class="bi bi-pencil"></i>
                </button>
                <button class="btn btn-outline-danger btn-delete" data-id="${t.id}">
                  <i class="bi bi-trash"></i>
                </button>
              </div>
            </div>
          </div>
        </div>
      `).join('');

      grid.querySelectorAll('.btn-edit').forEach(btn => {
        btn.addEventListener('click', () => {
          const tpl = templatesCache.find(t => String(t.id) === btn.dataset.id);
          if (tpl) openModal(tpl);
        });
      });

      grid.querySelectorAll('.btn-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!await confirmDialog({
            title: 'Delete template?',
            message: 'This message template will be permanently removed.',
            confirmText: 'Delete',
            variant: 'danger'
          })) return;
          try {
            await api(`/api/templates/${btn.dataset.id}`, { method: 'DELETE' });
            showToast('Template deleted');
            loadTemplates();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      grid.innerHTML = `<div class="col-12"><div class="alert alert-danger">${err.message}</div></div>`;
    }
  }

  function openModal(tpl) {
    editingId = tpl?.id || null;
    document.getElementById('template-modal-title').textContent = editingId ? 'Edit Template' : 'Create Template';
    document.getElementById('tpl-name').value = tpl?.name || '';
    document.getElementById('tpl-message').value = tpl?.message || '';
    document.getElementById('tpl-channel').value = tpl?.channel || 'both';
    templateModal.show();
  }

  document.getElementById('btn-new-template').addEventListener('click', () => openModal());

  document.getElementById('template-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('tpl-name').value.trim();
    const message = document.getElementById('tpl-message').value.trim();
    const channel = document.getElementById('tpl-channel').value;

    try {
      if (editingId) {
        await api(`/api/templates/${editingId}`, {
          method: 'PUT',
          body: JSON.stringify({ name, message, channel })
        });
        showToast('Template updated');
      } else {
        await api('/api/templates', {
          method: 'POST',
          body: JSON.stringify({ name, message, channel })
        });
        showToast('Template created');
      }
      templateModal.hide();
      e.target.reset();
      editingId = null;
      loadTemplates();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  loadTemplates();
})();
