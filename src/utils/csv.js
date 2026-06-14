const Papa = require('papaparse');
const XLSX = require('xlsx');
const fs = require('fs');
const { normalizePhone } = require('./phone');

function findColumn(headers, candidates) {
  const pairs = headers.map(h => ({
    original: h,
    lower: String(h || '').replace(/^\ufeff/, '').toLowerCase().trim()
  }));

  for (const candidate of candidates) {
    const exact = pairs.find(p => p.lower === candidate);
    if (exact) return exact.original;

    const word = pairs.find(p => new RegExp(`\\b${candidate}\\b`).test(p.lower));
    if (word) return word.original;
  }

  for (const candidate of candidates) {
    const partial = pairs.find(p => p.lower.includes(candidate) && candidate.length >= 4);
    if (partial) return partial.original;
  }

  return null;
}

function isPhoneHeader(header) {
  const h = String(header || '').toLowerCase();
  return /\b(phone|mobile|whatsapp|tel)\b/.test(h) || h.includes('phone number') || h === 'number';
}

function readDelimitedText(filePath) {
  const buffer = fs.readFileSync(filePath);
  let content;

  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    content = buffer.slice(2).toString('utf16le');
  } else if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    const swapped = Buffer.from(buffer.slice(2));
    swapped.swap16();
    content = swapped.toString('utf16le');
  } else {
    content = buffer.toString('utf8');
  }

  return content.replace(/^\ufeff/, '');
}

function parseDelimitedRows(content) {
  const attempts = [
    { header: true, skipEmptyLines: 'greedy', transformHeader: h => String(h || '').replace(/^\ufeff/, '').trim() },
    { header: true, skipEmptyLines: 'greedy', delimiter: ';', transformHeader: h => String(h || '').replace(/^\ufeff/, '').trim() },
    { header: true, skipEmptyLines: 'greedy', delimiter: '\t', transformHeader: h => String(h || '').replace(/^\ufeff/, '').trim() }
  ];

  for (const options of attempts) {
    const parsed = Papa.parse(content, options);
    if (parsed.data?.length && Object.keys(parsed.data[0] || {}).length > 1) {
      return parsed.data;
    }
  }

  const fallback = Papa.parse(content, { header: true, skipEmptyLines: 'greedy' });
  return fallback.data || [];
}

/** Expand Excel-style scientific notation strings into digit strings where possible. */
function expandScientificNotation(raw) {
  const text = String(raw).trim().replace(/\s/g, '');
  const match = text.match(/^([+-]?\d[\d.]*)[eE]([+-]?\d+)$/);
  if (!match) return null;

  const negative = match[1].startsWith('-');
  const mantissa = match[1].replace(/^[-+]/, '');
  const exponent = parseInt(match[2], 10);
  const [intPart, decPart = ''] = mantissa.split('.');
  const digits = intPart + decPart;
  const decimalPlaces = decPart.length;
  const shift = exponent - decimalPlaces;

  if (shift >= 0) {
    const expanded = digits + '0'.repeat(shift);
    return negative ? `-${expanded}` : expanded;
  }

  if (shift >= -decimalPlaces) {
    const splitAt = intPart.length + shift;
    if (splitAt <= 0) return null;
    const expanded = (intPart + decPart).slice(0, splitAt);
    return negative ? `-${expanded}` : expanded;
  }

  return null;
}

function looksLikeScientific(value) {
  return typeof value === 'number'
    ? Math.abs(value) >= 1e9
    : /^\s*[+-]?\d*\.?\d+[eE][+-]?\d+\s*$/.test(String(value));
}

function phoneMayBeTruncated(phone, originalValue) {
  if (!phone || phone.length < 10) return false;
  if (!looksLikeScientific(originalValue)) return false;
  return /0{4,}$/.test(phone) || String(originalValue).replace(/\D/g, '').length < 10;
}

function parsePhoneValue(value) {
  if (value == null || value === '') return '';

  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(Math.abs(value));
    return normalizePhone(String(rounded));
  }

  let raw = String(value).trim().replace(/^['"]+|['"]+$/g, '');

  if (/[eE]/.test(raw)) {
    const expanded = expandScientificNotation(raw);
    if (expanded) {
      return normalizePhone(expanded);
    }
    const asNum = Number(raw);
    if (Number.isFinite(asNum)) {
      return normalizePhone(String(Math.round(Math.abs(asNum))));
    }
  }

  return normalizePhone(raw);
}

function parseXlsxRows(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false, cellNF: true, cellText: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet?.['!ref']) return [];

  const range = XLSX.utils.decode_range(sheet['!ref']);
  const headerRow = range.s.r;
  const headers = [];

  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: headerRow, c })];
    headers.push(cell ? String(cell.w ?? cell.v ?? '').trim() : '');
  }

  const rows = [];

  for (let r = headerRow + 1; r <= range.e.r; r++) {
    const row = {};
    let hasData = false;

    for (let c = range.s.c; c <= range.e.c; c++) {
      const header = headers[c - range.s.c];
      if (!header) continue;

      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell) {
        row[header] = '';
        continue;
      }

      if (isPhoneHeader(header)) {
        if (cell.t === 'n' && typeof cell.v === 'number') {
          row[header] = cell.v;
          hasData = true;
        } else if (cell.t === 's') {
          row[header] = String(cell.v ?? '').trim();
          if (row[header]) hasData = true;
        } else {
          row[header] = String(cell.w ?? cell.v ?? '').trim();
          if (row[header]) hasData = true;
        }
      } else if (cell.t === 'n') {
        row[header] = cell.v;
        hasData = true;
      } else {
        row[header] = String(cell.w ?? cell.v ?? '').trim();
        if (row[header]) hasData = true;
      }
    }

    if (hasData) rows.push(row);
  }

  return rows;
}

function parseContactsFromFile(filePath, originalName) {
  const ext = (originalName || filePath).split('.').pop().toLowerCase();
  let rows = [];

  if (ext === 'csv' || ext === 'txt') {
    const content = readDelimitedText(filePath);
    rows = parseDelimitedRows(content);
  } else if (ext === 'xlsx' || ext === 'xls') {
    rows = parseXlsxRows(filePath);
  } else {
    throw new Error('Unsupported file type. Use CSV, TXT, or XLSX.');
  }

  if (!rows.length) {
    return { contacts: [], invalid: 0, truncated: 0, reason: 'empty' };
  }

  const headers = Object.keys(rows[0]);
  const nameCol = findColumn(headers, ['name', 'full name', 'contact name']);
  const phoneCol = findColumn(headers, ['phone number', 'phone', 'mobile', 'whatsapp', 'tel', 'number']);
  const emailCol = findColumn(headers, ['email', 'e-mail']);

  if (!phoneCol) {
    throw new Error('Could not detect a phone column. Use headers like "Phone Number", "Phone", or "Mobile".');
  }

  const seen = new Set();
  const contacts = [];
  let invalid = 0;
  let truncated = 0;

  for (const row of rows) {
    const rawPhone = row[phoneCol];
    const phone = parsePhoneValue(rawPhone);

    if (!phone || phone.length < 10 || seen.has(phone)) {
      if (rawPhone !== '' && rawPhone != null) invalid++;
      continue;
    }

    if (phoneMayBeTruncated(phone, rawPhone)) truncated++;

    seen.add(phone);
    contacts.push({
      name: nameCol ? String(row[nameCol] || '').trim() : '',
      phone,
      email: emailCol ? String(row[emailCol] || '').trim() : ''
    });
  }

  return {
    contacts,
    invalid,
    truncated,
    reason: contacts.length ? null : (invalid ? 'invalid_phones' : 'no_rows')
  };
}

function personalizeMessage(template, contact, extras = {}) {
  const name = contact.name || contact.Name || 'Customer';
  let message = String(template || '');

  message = message.replace(/\{\{name\}\}/gi, name);
  message = message.replace(/#Value1/gi, name);
  message = message.replace(/x{5,}/gi, name);

  if (extras.campaignLink) {
    message = message.replace(/#campaignLink/gi, extras.campaignLink);
  }

  return message;
}

function parsePhoneLines(text) {
  return text
    .split(/[\n,;]+/)
    .map(p => parsePhoneValue(p.trim()))
    .filter(p => p.length >= 10);
}

module.exports = { parseContactsFromFile, personalizeMessage, findColumn, parsePhoneLines, parsePhoneValue };
