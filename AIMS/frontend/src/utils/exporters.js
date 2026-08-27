// Export helpers: CSV (native), Excel (.xlsx via SheetJS), PDF (via jsPDF + autoTable).
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

/**
 * The three export buttons every staff screen shows. The visible label and the
 * format key differ for Excel ("Excel" / "xlsx"), so they are paired here
 * rather than derived from one another — deriving them is what left the Excel
 * button's "Exporting…" state never firing.
 */
export const EXPORT_FORMATS = [
  { label: 'Excel', format: 'xlsx' },
  { label: 'PDF', format: 'pdf' },
  { label: 'CSV', format: 'csv' },
];

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function exportCSV(filename, headers, rows) {
  const lines = [headers, ...rows].map((r) => r.map(csvEscape).join(','));
  const csv = '\uFEFF' + lines.join('\n');
  downloadBlob(filename, new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
}

export function exportExcel(filename, sheetName, headers, rows) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Report');
  XLSX.writeFile(wb, filename);
}

export function exportPDF(filename, { title, subtitle, headers, rows, orientation = 'landscape' }) {
  const doc = new jsPDF({ orientation });
  doc.setFontSize(15);
  doc.setTextColor(23, 24, 26);
  doc.text(title, 14, 16);
  if (subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(120, 122, 130);
    doc.text(subtitle, 14, 23);
  }
  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: 30,
    styles: { fontSize: 7.5, cellPadding: 2.2, textColor: [40, 42, 48] },
    headStyles: { fillColor: [178, 23, 32], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [246, 246, 248] },
    margin: { top: 30, left: 14, right: 14, bottom: 14 },
  });
  doc.save(filename);
}
