const XLSX = require('xlsx');

const HEADERS = ['Name', 'Phone Number', 'Email'];
const EXAMPLES = [
  ['', '256712345678', ''],
  ['Jane Smith', '0701453639', 'jane@example.com'],
  ['Samuel Ssendi', '256779265701', 'samuel@example.com']
];
const EMPTY_ROWS = 1000;

function setTextCell(ws, ref, value = '') {
  ws[ref] = { t: 's', v: String(value ?? ''), z: '@' };
}

function buildContactTemplateWorkbook() {
  const rows = [HEADERS, ...EXAMPLES];
  for (let i = 0; i < EMPTY_ROWS; i++) rows.push(['', '', '']);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  for (let r = 1; r < rows.length; r++) {
    setTextCell(ws, XLSX.utils.encode_cell({ r, c: 1 }), rows[r][1] || '');
    if (rows[r][0]) setTextCell(ws, XLSX.utils.encode_cell({ r, c: 0 }), rows[r][0]);
    if (rows[r][2]) setTextCell(ws, XLSX.utils.encode_cell({ r, c: 2 }), rows[r][2]);
  }

  ws['!cols'] = [{ wch: 26 }, { wch: 20 }, { wch: 30 }];

  const instructions = XLSX.utils.aoa_to_sheet([
    ['AfrieConnect — Contact Import Template'],
    [''],
    ['• Phone Number column (sheet "Contacts") is pre-formatted as TEXT for all rows.'],
    ['• Name and Email are optional — leave them blank if you only have numbers.'],
    ['• Accepted phone formats: 256712345678, 0701453639, +256779265701'],
    ['• Delete the 3 example rows, paste your numbers in column B, save, then import.'],
    ['• Do not re-save as CSV from Excel — upload this .xlsx file directly.']
  ]);
  instructions['!cols'] = [{ wch: 72 }];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contacts');
  XLSX.utils.book_append_sheet(wb, instructions, 'Instructions');

  return wb;
}

function buildContactTemplateBuffer() {
  return XLSX.write(buildContactTemplateWorkbook(), { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { buildContactTemplateBuffer, buildContactTemplateWorkbook };
