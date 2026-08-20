const safeCell = (value) => (value === null || value === undefined ? '' : String(value));

export const downloadCmmsRecordsExcel = async ({ filename, sheetName, columns, rows }) => {
  const XLSX = await import('xlsx');
  const worksheet = XLSX.utils.aoa_to_sheet([
    columns.map((column) => column.label),
    ...rows.map((row) => columns.map((column) => safeCell(column.value(row))))
  ]);
  worksheet['!cols'] = columns.map((column) => ({ wch: Math.max(column.label.length + 2, 18) }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, `${filename}.xlsx`);
};

export const downloadCmmsRecordsPdf = async ({ filename, title, subtitle, columns, rows }) => {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 10;
  const rowHeight = 7;
  const columnWidth = (pageWidth - margin * 2) / columns.length;
  let y = 14;

  const drawHeader = () => {
    pdf.setFontSize(16);
    pdf.text(title, margin, y);
    y += 7;
    pdf.setFontSize(9);
    pdf.setTextColor(90);
    pdf.text(subtitle, margin, y);
    y += 8;
    pdf.setTextColor(0);
    pdf.setFillColor(30, 64, 175);
    pdf.rect(margin, y, pageWidth - margin * 2, rowHeight, 'F');
    pdf.setTextColor(255);
    pdf.setFontSize(8);
    columns.forEach((column, index) => pdf.text(column.label, margin + index * columnWidth + 1, y + 4.7, { maxWidth: columnWidth - 2 }));
    pdf.setTextColor(0);
    y += rowHeight;
  };

  drawHeader();
  rows.forEach((row, rowIndex) => {
    if (y + rowHeight > pdf.internal.pageSize.getHeight() - margin) {
      pdf.addPage();
      y = 14;
      drawHeader();
    }
    if (rowIndex % 2 === 0) {
      pdf.setFillColor(245, 247, 250);
      pdf.rect(margin, y, pageWidth - margin * 2, rowHeight, 'F');
    }
    columns.forEach((column, index) => pdf.text(safeCell(column.value(row)), margin + index * columnWidth + 1, y + 4.7, { maxWidth: columnWidth - 2 }));
    y += rowHeight;
  });
  pdf.save(`${filename}.pdf`);
};
