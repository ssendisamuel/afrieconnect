const express = require('express');
const fs = require('fs');
const { body, validationResult } = require('express-validator');
const { authMiddleware } = require('../middleware/auth');
const upload = require('../middleware/upload');
const pool = require('../config/db');
const { parseContactsFromFile } = require('../utils/csv');
const { normalizePhone } = require('../utils/phone');
const { buildContactTemplateBuffer } = require('../utils/contactTemplate');

const router = express.Router();

router.use(authMiddleware);

const TEMPLATE_CSV = `Name,Phone Number,Email
,"256712345678",
Jane Smith,0701453639,jane@example.com
Samuel Ssendi,+256779265701,samuel@example.com
`;

router.get('/template', (_req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="afrieconnect-contacts-template.xlsx"');
  res.send(buildContactTemplateBuffer());
});

router.get('/template.csv', (_req, res) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="afrieconnect-contacts-template.csv"');
  res.send(TEMPLATE_CSV);
});

router.get('/template.xlsx', (_req, res) => {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="afrieconnect-contacts-template.xlsx"');
  res.send(buildContactTemplateBuffer());
});

router.get('/lists', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT cl.*,
        (SELECT COUNT(*) FROM contacts c WHERE c.list_id = cl.id) AS contact_count
       FROM contact_lists cl
       WHERE cl.user_id = ?
       ORDER BY cl.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, lists: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/lists', async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    if (!name) {
      return res.status(400).json({ success: false, message: 'List name is required' });
    }

    const description = req.body.description ? String(req.body.description).trim() : null;

    const [result] = await pool.query(
      'INSERT INTO contact_lists (user_id, name, description) VALUES (?, ?, ?)',
      [req.user.id, name, description]
    );

    res.status(201).json({ success: true, id: result.insertId, name });
  } catch (err) {
    console.error('[Contacts] Create list error:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to create list' });
  }
});

async function verifyListOwner(listId, userId) {
  const [rows] = await pool.query(
    'SELECT id FROM contact_lists WHERE id = ? AND user_id = ?',
    [listId, userId]
  );
  return rows.length > 0;
}

router.delete('/lists/:id', async (req, res) => {
  try {
    if (!(await verifyListOwner(req.params.id, req.user.id))) {
      return res.status(404).json({ success: false, message: 'List not found' });
    }
    await pool.query('DELETE FROM contact_lists WHERE id = ? AND user_id = ?', [
      req.params.id, req.user.id
    ]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/lists/:id', async (req, res) => {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = (page - 1) * limit;

    const [list] = await pool.query(
      'SELECT * FROM contact_lists WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!list.length) {
      return res.status(404).json({ success: false, message: 'List not found' });
    }

    const [contacts] = await pool.query(
      'SELECT * FROM contacts WHERE list_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [req.params.id, limit, offset]
    );

    const [count] = await pool.query('SELECT COUNT(*) as total FROM contacts WHERE list_id = ?', [req.params.id]);

    res.json({
      success: true,
      list: list[0],
      contacts,
      pagination: { page, limit, total: count[0].total }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/lists/:id/contacts', async (req, res) => {
  try {
    if (!(await verifyListOwner(req.params.id, req.user.id))) {
      return res.status(404).json({ success: false, message: 'List not found' });
    }

    const { name, phone, email } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    const normalized = normalizePhone(phone);
    if (normalized.length < 10) {
      return res.status(400).json({ success: false, message: 'Invalid phone number' });
    }

    const [existing] = await pool.query(
      'SELECT id FROM contacts WHERE list_id = ? AND phone = ?',
      [req.params.id, normalized]
    );

    if (existing.length) {
      return res.status(400).json({ success: false, message: 'Contact already exists in this list' });
    }

    await pool.query(
      'INSERT INTO contacts (list_id, user_id, name, phone, email) VALUES (?, ?, ?, ?, ?)',
      [req.params.id, req.user.id, name || null, normalized, email || null]
    );

    await pool.query(
      'UPDATE contact_lists SET contact_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ?) WHERE id = ?',
      [req.params.id, req.params.id]
    );

    res.status(201).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/lists/:id/import', (req, res) => {
  upload.single('file')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ success: false, message: uploadErr.message || 'File upload failed' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    try {
      if (!(await verifyListOwner(req.params.id, req.user.id))) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ success: false, message: 'List not found' });
      }

      const parsed = parseContactsFromFile(req.file.path, req.file.originalname);
      const { contacts, invalid, truncated, reason } = parsed;

      console.log(`[Contacts] Import list ${req.params.id}: file=${req.file.originalname}, parsed=${contacts.length}, invalid=${invalid}, truncated=${truncated}, reason=${reason || 'ok'}`);

      if (!contacts.length) {
        fs.unlinkSync(req.file.path);
        const messages = {
          empty: 'The file has headers but no contact rows. Add phone numbers below the header row, then import again.',
          no_rows: 'No contact rows found. Make sure your file has a header row plus at least one row with a phone number.',
          invalid_phones: `Found ${invalid} row(s) with invalid phone numbers. Use formats like 256712345678, 0787654321, or +256779265701. In Excel, format the phone column as Text before saving, or save as .xlsx instead of CSV.`
        };
        return res.status(400).json({
          success: false,
          message: messages[reason] || 'No valid contacts found in file'
        });
      }

      let imported = 0;
      let skipped = 0;

      for (const contact of contacts) {
        const [existing] = await pool.query(
          'SELECT id FROM contacts WHERE list_id = ? AND phone = ?',
          [req.params.id, contact.phone]
        );

        if (existing.length) {
          skipped++;
          continue;
        }

        await pool.query(
          'INSERT INTO contacts (list_id, user_id, name, phone, email) VALUES (?, ?, ?, ?, ?)',
          [req.params.id, req.user.id, contact.name || null, contact.phone, contact.email || null]
        );
        imported++;
      }

      await pool.query(
        'UPDATE contact_lists SET contact_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ?) WHERE id = ?',
        [req.params.id, req.params.id]
      );

      fs.unlinkSync(req.file.path);

      res.json({
        success: true,
        imported,
        skipped,
        invalid,
        truncated,
        total: contacts.length,
        warning: truncated
          ? `${truncated} phone number(s) may have been shortened by Excel scientific notation (e.g. 2.56E+11). Save as .xlsx or format the phone column as Text before exporting CSV.`
          : null
      });
    } catch (err) {
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      console.error('[Contacts] Import error:', err.message);
      res.status(400).json({ success: false, message: err.message });
    }
  });
});

router.delete('/:id', async (req, res) => {
  try {
    const [contact] = await pool.query('SELECT list_id FROM contacts WHERE id = ? AND user_id = ?', [
      req.params.id, req.user.id
    ]);

    if (!contact.length) {
      return res.status(404).json({ success: false, message: 'Contact not found' });
    }

    await pool.query('DELETE FROM contacts WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);

    await pool.query(
      'UPDATE contact_lists SET contact_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ?) WHERE id = ?',
      [contact[0].list_id, contact[0].list_id]
    );

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const [contact] = await pool.query(
      'SELECT id, list_id FROM contacts WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (!contact.length) {
      return res.status(404).json({ success: false, message: 'Contact not found' });
    }

    const name = req.body.name != null ? String(req.body.name).trim() || null : undefined;
    const email = req.body.email != null ? String(req.body.email).trim() || null : undefined;
    let phone;

    if (req.body.phone != null) {
      phone = normalizePhone(String(req.body.phone).trim());
      if (phone.length < 10) {
        return res.status(400).json({ success: false, message: 'Invalid phone number' });
      }

      const [duplicate] = await pool.query(
        'SELECT id FROM contacts WHERE list_id = ? AND phone = ? AND id != ?',
        [contact[0].list_id, phone, req.params.id]
      );
      if (duplicate.length) {
        return res.status(400).json({ success: false, message: 'Another contact in this list already uses that phone number' });
      }
    }

    const fields = [];
    const values = [];
    if (name !== undefined) { fields.push('name = ?'); values.push(name); }
    if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
    if (email !== undefined) { fields.push('email = ?'); values.push(email); }

    if (!fields.length) {
      return res.status(400).json({ success: false, message: 'Nothing to update' });
    }

    values.push(req.params.id, req.user.id);
    await pool.query(`UPDATE contacts SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/bulk-delete', async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids)
      ? req.body.ids.map(id => parseInt(id, 10)).filter(id => id > 0)
      : [];

    if (!ids.length) {
      return res.status(400).json({ success: false, message: 'Select at least one contact' });
    }

    const [rows] = await pool.query(
      'SELECT id, list_id FROM contacts WHERE id IN (?) AND user_id = ?',
      [ids, req.user.id]
    );

    if (!rows.length) {
      return res.status(404).json({ success: false, message: 'No matching contacts found' });
    }

    await pool.query('DELETE FROM contacts WHERE id IN (?) AND user_id = ?', [ids, req.user.id]);

    const listIds = [...new Set(rows.map(r => r.list_id))];
    for (const listId of listIds) {
      await pool.query(
        'UPDATE contact_lists SET contact_count = (SELECT COUNT(*) FROM contacts WHERE list_id = ?) WHERE id = ?',
        [listId, listId]
      );
    }

    res.json({ success: true, deleted: rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
