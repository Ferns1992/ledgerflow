import { format } from 'date-fns';

export async function exportToExcel(rows: Record<string, unknown>[], fileName: string): Promise<void> {
  // These are the two heaviest dependencies in the app (~700 kB together). Most
  // sessions never export anything, so they are pulled in on first use instead
  // of sitting in the main bundle every user downloads.
  const xlsx = await import('xlsx');
  const sheet = xlsx.utils.json_to_sheet(rows);
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, 'Sheet1');
  xlsx.writeFile(book, `${fileName}.xlsx`);
}

export async function exportToPDF(
  title: string,
  columns: string[],
  rows: (string | number)[][],
  context?: { company?: string; subtitle?: string },
): Promise<void> {
  const [{ jsPDF: JsPDF }, { default: attachTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new JsPDF();
  doc.setFontSize(18);
  doc.text(title, 14, 20);
  doc.setFontSize(10);
  doc.setTextColor(100);
  if (context?.company) doc.text(`Company: ${context.company}`, 14, 27);
  if (context?.subtitle) doc.text(context.subtitle, 14, 32);
  doc.text(`Generated: ${format(new Date(), 'dd MMM yyyy HH:mm')}`, 14, context?.subtitle ? 37 : 32);

  attachTable(doc, {
    head: [columns],
    body: rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))),
    startY: 44,
    theme: 'grid',
    styles: { fontSize: 8 },
    headStyles: { fillColor: [24, 24, 27], textColor: [255, 255, 255] },
    alternateRowStyles: { fillColor: [250, 250, 250] },
  });

  doc.save(`${title.toLowerCase().replace(/[^a-z0-9]+/g, '_')}.pdf`);
}
