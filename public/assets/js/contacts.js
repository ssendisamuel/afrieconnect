(function () {
  if (!requireAuth()) return;
  renderAppShell('contacts');

  let activeListId = null;
  let currentPage = 1;
  let loadedContacts = [];
  const pageLimit = 50;

  const content = document.getElementById('page-content');
  content.innerHTML = `
    <div class="d-flex flex-wrap justify-content-between align-items-center mb-4 gap-2">
      <div>
        <h4 class="mb-1 fw-bold">Contacts</h4>
        <p class="text-muted mb-0">Manage your contact lists</p>
      </div>
      <div class="d-flex gap-2 flex-wrap">
        <button class="btn btn-outline-primary btn-sm" id="btn-download-template">
          <i class="bi bi-file-earmark-spreadsheet me-1"></i>Download Template (.xlsx)
        </button>
        <button class="btn btn-outline-primary btn-sm" data-bs-toggle="modal" data-bs-target="#create-list-modal">
          <i class="bi bi-folder-plus me-1"></i>New List
        </button>
        <button class="btn btn-primary btn-sm" id="btn-add-contact" disabled data-bs-toggle="modal" data-bs-target="#add-contact-modal">
          <i class="bi bi-person-plus me-1"></i>Add Contact
        </button>
      </div>
    </div>

    <div class="row g-4">
      <div class="col-lg-3">
        <div class="content-card p-0">
          <div class="p-3 border-bottom">
            <h6 class="fw-semibold mb-0">Lists</h6>
          </div>
          <div class="list-group list-group-flush" id="lists-sidebar">
            <div class="list-group-item text-muted text-center py-4">Loading…</div>
          </div>
        </div>
      </div>

      <div class="col-lg-9">
        <div class="content-card">
          <div class="d-flex flex-wrap justify-content-between align-items-center mb-3 gap-2">
            <div>
              <h6 class="fw-semibold mb-0" id="list-title">Select a list</h6>
              <small class="text-muted" id="list-meta"></small>
            </div>
            <div class="d-flex gap-2">
              <button class="btn btn-sm btn-outline-danger" id="btn-bulk-delete" disabled>
                <i class="bi bi-trash me-1"></i>Delete Selected
              </button>
              <button class="btn btn-sm btn-outline-secondary" id="btn-import" disabled data-bs-toggle="modal" data-bs-target="#import-modal">
                <i class="bi bi-upload me-1"></i>Import CSV/Excel
              </button>
              <button class="btn btn-sm btn-outline-danger" id="btn-delete-list" disabled>
                <i class="bi bi-trash me-1"></i>Delete List
              </button>
            </div>
          </div>
          <div class="table-responsive">
            <table class="table table-hover align-middle mb-0">
              <thead class="table-light">
                <tr>
                  <th style="width:36px"><input type="checkbox" class="form-check-input" id="select-all-contacts" title="Select all on this page"></th>
                  <th>Name</th><th>Phone</th><th>Email</th><th>Added</th><th></th>
                </tr>
              </thead>
              <tbody id="contacts-body">
                <tr><td colspan="6" class="text-center text-muted py-5">Select a contact list to view contacts</td></tr>
              </tbody>
            </table>
          </div>
          <div class="d-flex justify-content-between align-items-center mt-3" id="pagination-bar" style="display:none!important">
            <small class="text-muted" id="pagination-info"></small>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-secondary" id="btn-prev">Previous</button>
              <button class="btn btn-outline-secondary" id="btn-next">Next</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="modal fade" id="create-list-modal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title">Create Contact List</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <form id="create-list-form">
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label">List Name</label>
                <input type="text" class="form-control" id="list-name" required>
              </div>
              <div class="mb-3">
                <label class="form-label">Description <span class="text-muted">(optional)</span></label>
                <input type="text" class="form-control" id="list-description">
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-primary">Create List</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="modal fade" id="add-contact-modal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title">Add Contact</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <form id="add-contact-form">
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label">Name <span class="text-muted">(optional)</span></label>
                <input type="text" class="form-control" id="contact-name">
              </div>
              <div class="mb-3">
                <label class="form-label">Phone</label>
                <input type="tel" class="form-control" id="contact-phone" placeholder="2567XXXXXXXX" required>
              </div>
              <div class="mb-3">
                <label class="form-label">Email <span class="text-muted">(optional)</span></label>
                <input type="email" class="form-control" id="contact-email">
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-primary">Add Contact</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="modal fade" id="import-modal" tabindex="-1" aria-labelledby="import-modal-label">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title" id="import-modal-label">Import Contacts</h5><button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button></div>
          <form id="import-form">
            <div class="modal-body">
              <p class="text-muted small mb-2">Use the pre-formatted Excel template, or upload your own .xlsx / .csv file:</p>
              <ul class="small text-muted mb-3">
                <li><strong>Phone Number</strong> — required (07xx, 256xx, or +256xx)</li>
                <li><strong>Name</strong> — optional, for {{name}} in messages</li>
                <li><strong>Email</strong> — optional</li>
              </ul>
              <a href="#" class="btn btn-sm btn-success mb-3" id="import-template-link">
                <i class="bi bi-file-earmark-spreadsheet me-1"></i>Download Template (.xlsx)
              </a>
              <p class="small text-muted mb-2">The template has 1,000+ rows with the phone column pre-set to <strong>Text</strong> — no more 2.56E+11 issues.</p>
              <input type="file" class="form-control" id="import-file" accept=".xlsx,.xls,.csv,.txt">
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-primary">Import</button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <div class="modal fade" id="edit-contact-modal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header"><h5 class="modal-title">Edit Contact</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
          <form id="edit-contact-form">
            <div class="modal-body">
              <input type="hidden" id="edit-contact-id">
              <div class="mb-3">
                <label class="form-label">Name</label>
                <input type="text" class="form-control" id="edit-contact-name">
              </div>
              <div class="mb-3">
                <label class="form-label">Phone</label>
                <input type="tel" class="form-control" id="edit-contact-phone" required>
              </div>
              <div class="mb-3">
                <label class="form-label">Email</label>
                <input type="email" class="form-control" id="edit-contact-email">
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
              <button type="submit" class="btn btn-primary">Save Changes</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  const createListModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('create-list-modal'));
  const addContactModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('add-contact-modal'));
  const importModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('import-modal'));
  const editContactModal = bootstrap.Modal.getOrCreateInstance(document.getElementById('edit-contact-modal'));
  const selectedContactIds = new Set();

  function updateBulkDeleteButton() {
    document.getElementById('btn-bulk-delete').disabled = selectedContactIds.size === 0;
  }

  function clearContactSelection() {
    selectedContactIds.clear();
    document.getElementById('select-all-contacts').checked = false;
    updateBulkDeleteButton();
  }

  function setListActions(enabled) {
    document.getElementById('btn-add-contact').disabled = !enabled;
    document.getElementById('btn-import').disabled = !enabled;
    document.getElementById('btn-delete-list').disabled = !enabled;
  }

  async function loadLists() {
    try {
      const data = await api('/api/contacts/lists');
      const sidebar = document.getElementById('lists-sidebar');

      if (!data.lists.length) {
        sidebar.innerHTML = '<div class="list-group-item text-muted text-center py-4">No lists yet</div>';
        return;
      }

      sidebar.innerHTML = data.lists.map(l => `
        <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center ${activeListId === l.id ? 'active' : ''}"
                data-id="${l.id}" data-name="${l.name}" data-desc="${l.description || ''}" data-count="${l.contact_count}">
          <span><i class="bi bi-folder me-2"></i>${l.name}</span>
          <span class="badge bg-secondary rounded-pill">${l.contact_count}</span>
        </button>
      `).join('');

      sidebar.querySelectorAll('[data-id]').forEach(btn => {
        btn.addEventListener('click', () => {
          activeListId = Number(btn.dataset.id);
          currentPage = 1;
          document.getElementById('list-title').textContent = btn.dataset.name;
          document.getElementById('list-meta').textContent = btn.dataset.desc || `${btn.dataset.count} contacts`;
          setListActions(true);
          sidebar.querySelectorAll('[data-id]').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          loadContacts();
        });
      });

      if (!activeListId && data.lists.length) {
        sidebar.querySelector('[data-id]')?.click();
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function loadContacts() {
    if (!activeListId) return;

    clearContactSelection();
    const tbody = document.getElementById('contacts-body');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Loading…</td></tr>';

    try {
      const data = await api(`/api/contacts/lists/${activeListId}?page=${currentPage}&limit=${pageLimit}`);
      const { contacts, pagination, list } = data;
      loadedContacts = contacts;

      if (list?.contact_count != null) {
        document.getElementById('list-meta').textContent = `${pagination.total} contact${pagination.total === 1 ? '' : 's'}`;
        const activeBtn = document.querySelector(`#lists-sidebar [data-id="${activeListId}"]`);
        if (activeBtn) {
          activeBtn.dataset.count = pagination.total;
          const badge = activeBtn.querySelector('.badge');
          if (badge) badge.textContent = pagination.total;
        }
      }

      if (!contacts.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-5">No contacts in this list</td></tr>';
      } else {
        tbody.innerHTML = contacts.map(c => `
          <tr>
            <td><input type="checkbox" class="form-check-input contact-select" data-id="${c.id}"></td>
            <td>${c.name || '—'}</td>
            <td class="font-monospace">${c.phone}</td>
            <td>${c.email || '—'}</td>
            <td><small class="text-muted">${formatDate(c.created_at)}</small></td>
            <td class="text-nowrap">
              <button class="btn btn-sm btn-outline-secondary btn-edit me-1" data-id="${c.id}">
                <i class="bi bi-pencil"></i>
              </button>
              <button class="btn btn-sm btn-outline-danger btn-delete" data-id="${c.id}">
                <i class="bi bi-trash"></i>
              </button>
            </td>
          </tr>
        `).join('');

        tbody.querySelectorAll('.contact-select').forEach(box => {
          box.addEventListener('change', () => {
            const id = Number(box.dataset.id);
            if (box.checked) selectedContactIds.add(id);
            else selectedContactIds.delete(id);
            updateBulkDeleteButton();
            document.getElementById('select-all-contacts').checked =
              tbody.querySelectorAll('.contact-select').length === selectedContactIds.size;
          });
        });

        tbody.querySelectorAll('.btn-edit').forEach(btn => {
          btn.addEventListener('click', () => {
            const contact = loadedContacts.find(c => String(c.id) === btn.dataset.id);
            if (!contact) return;
            document.getElementById('edit-contact-id').value = contact.id;
            document.getElementById('edit-contact-name').value = contact.name || '';
            document.getElementById('edit-contact-phone').value = contact.phone || '';
            document.getElementById('edit-contact-email').value = contact.email || '';
            editContactModal.show();
          });
        });

        tbody.querySelectorAll('.btn-delete').forEach(btn => {
          btn.addEventListener('click', async () => {
            if (!await confirmDialog({
              title: 'Delete contact?',
              message: 'This contact will be removed from the list.',
              confirmText: 'Delete',
              variant: 'danger'
            })) return;
            try {
              await api(`/api/contacts/${btn.dataset.id}`, { method: 'DELETE' });
              showToast('Contact deleted');
              loadContacts();
              loadLists();
            } catch (err) {
              showToast(err.message, 'error');
            }
          });
        });
      }

      const bar = document.getElementById('pagination-bar');
      if (pagination.total > pageLimit) {
        bar.style.display = 'flex';
        const totalPages = Math.ceil(pagination.total / pageLimit);
        document.getElementById('pagination-info').textContent =
          `Page ${currentPage} of ${totalPages} (${pagination.total} contacts)`;
        document.getElementById('btn-prev').disabled = currentPage <= 1;
        document.getElementById('btn-next').disabled = currentPage >= totalPages;
      } else {
        bar.style.display = 'none';
      }
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">${err.message}</td></tr>`;
    }
  }

  document.getElementById('select-all-contacts').addEventListener('change', e => {
    const checked = e.target.checked;
    document.querySelectorAll('.contact-select').forEach(box => {
      box.checked = checked;
      const id = Number(box.dataset.id);
      if (checked) selectedContactIds.add(id);
      else selectedContactIds.delete(id);
    });
    updateBulkDeleteButton();
  });

  document.getElementById('btn-bulk-delete').addEventListener('click', async () => {
    const count = selectedContactIds.size;
    if (!count) return;

    if (!await confirmDialog({
      title: `Delete ${count} contact${count === 1 ? '' : 's'}?`,
      message: 'Selected contacts will be permanently removed from this list.',
      confirmText: 'Delete selected',
      variant: 'danger'
    })) return;

    try {
      const data = await api('/api/contacts/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: [...selectedContactIds] })
      });
      showToast(`Deleted ${data.deleted} contact${data.deleted === 1 ? '' : 's'}`);
      loadContacts();
      loadLists();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('edit-contact-form').addEventListener('submit', async e => {
    e.preventDefault();
    const id = document.getElementById('edit-contact-id').value;
    const name = document.getElementById('edit-contact-name').value.trim();
    const phone = document.getElementById('edit-contact-phone').value.trim();
    const email = document.getElementById('edit-contact-email').value.trim();

    try {
      await api(`/api/contacts/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ name, phone, email: email || null })
      });
      showToast('Contact updated');
      editContactModal.hide();
      loadContacts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-prev').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; loadContacts(); }
  });

  document.getElementById('btn-next').addEventListener('click', () => {
    currentPage++;
    loadContacts();
  });

  document.getElementById('create-list-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('list-name').value.trim();
    const description = document.getElementById('list-description').value.trim();

    try {
      const data = await api('/api/contacts/lists', {
        method: 'POST',
        body: JSON.stringify({ name, description: description || undefined })
      });
      showToast('List created');
      createListModal.hide();
      e.target.reset();
      activeListId = data.id;
      loadLists();
      loadContacts();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('add-contact-form').addEventListener('submit', async e => {
    e.preventDefault();
    const name = document.getElementById('contact-name').value.trim();
    const phone = document.getElementById('contact-phone').value.trim();
    const email = document.getElementById('contact-email').value.trim();

    try {
      await api(`/api/contacts/lists/${activeListId}/contacts`, {
        method: 'POST',
        body: JSON.stringify({ name: name || undefined, phone, email: email || undefined })
      });
      showToast('Contact added');
      addContactModal.hide();
      e.target.reset();
      loadContacts();
      loadLists();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('import-form').addEventListener('submit', async e => {
    e.preventDefault();

    if (!activeListId) {
      return showToast('Select a contact list first', 'error');
    }

    const fileInput = document.getElementById('import-file');
    if (!fileInput.files.length) {
      return showToast('Choose a CSV or Excel file', 'error');
    }

    const submitBtn = e.target.querySelector('button[type="submit"]');
    const originalLabel = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Importing…';

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
      const token = getToken();
      const res = await fetch(`/api/contacts/lists/${activeListId}/import`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      });

      let data = {};
      try {
        data = await res.json();
      } catch {
        throw new Error('Server returned an invalid response. Restart AfrieConnect (node server.js) and try again.');
      }

      if (!res.ok || data.success === false) {
        throw new Error(data.message || `Import failed (${res.status})`);
      }

      if (!data.imported && !data.skipped) {
        throw new Error('No contacts were imported. Add rows with phone numbers below the header, or save as .xlsx.');
      }

      document.activeElement?.blur();
      importModal.hide();

      showToast(`Imported ${data.imported} contacts (${data.skipped} skipped${data.invalid ? `, ${data.invalid} invalid` : ''})`);
      if (data.warning) showToast(data.warning, 'error');
      e.target.reset();
      loadContacts();
      loadLists();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });

  document.getElementById('btn-delete-list').addEventListener('click', async () => {
    if (!await confirmDialog({
      title: 'Delete contact list?',
      message: 'This list and all its contacts will be permanently removed.',
      confirmText: 'Delete list',
      variant: 'danger'
    })) return;
    try {
      await api(`/api/contacts/lists/${activeListId}`, { method: 'DELETE' });
      showToast('List deleted');
      activeListId = null;
      setListActions(false);
      document.getElementById('list-title').textContent = 'Select a list';
      document.getElementById('list-meta').textContent = '';
      document.getElementById('contacts-body').innerHTML =
        '<tr><td colspan="5" class="text-center text-muted py-5">Select a contact list to view contacts</td></tr>';
      loadLists();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  loadLists();

  function downloadTemplate(url, filename) {
    const token = getToken();
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
      })
      .catch(() => showToast('Download failed', 'error'));
  }

  document.getElementById('btn-download-template')?.addEventListener('click', e => {
    e.preventDefault();
    downloadTemplate('/api/contacts/template', 'afrieconnect-contacts-template.xlsx');
  });

  document.getElementById('import-template-link')?.addEventListener('click', e => {
    e.preventDefault();
    document.getElementById('btn-download-template')?.click();
  });
})();
