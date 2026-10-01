// RFC 4180 CSV. Cells that a spreadsheet would treat as a formula are prefixed with an apostrophe.
const cell = value => {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
};
export const csv = (header, rows) => '\uFEFF' + [header, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
