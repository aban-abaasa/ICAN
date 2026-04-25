/**
 * CMMS Reports Export Service
 * Handles exporting reports to PDF and DOCX formats
 */

import { jsPDF } from 'jspdf';
import { Packer, Document, Paragraph, TextRun, Table, TableRow, TableCell, BorderStyle, WidthType, AlignmentType } from 'docx';
import { saveAs } from 'file-saver';

/**
 * Format date for display
 */
const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

/**
 * Export single report to PDF
 * @param {Object} report - Report data
 * @returns {Promise<void>}
 */
export const exportReportToPDF = async (report) => {
  try {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - 2 * margin;
    let yPosition = margin;

    // Set font
    doc.setFont('Arial', 'normal');

    // Header
    doc.setFontSize(18);
    doc.setTextColor(31, 78, 121); // Dark blue
    doc.text('MAINTENANCE REPORT', margin, yPosition);
    yPosition += 10;

    // Report metadata table
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);

    const metadataRows = [
      [`Report ID:`, report.id || 'N/A'],
      [`Title:`, report.title || 'N/A'],
      [`Category:`, report.category || 'N/A'],
      [`Severity:`, report.severity || 'N/A'],
      [`Department:`, report.department_name || 'General'],
      [`Reporter:`, `${report.reporter_name || 'Unknown'} (${report.reporter_email || 'N/A'})`],
      [`Status:`, report.status || 'Open'],
      [`Created:`, formatDate(report.created_at)],
      [`Updated:`, formatDate(report.updated_at)],
      ...(report.resolved_at ? [[`Resolved:`, formatDate(report.resolved_at)]] : [])
    ];

    metadataRows.forEach(([label, value]) => {
      doc.setFont('Arial', 'bold');
      doc.text(label, margin, yPosition);
      doc.setFont('Arial', 'normal');
      doc.text(String(value), margin + 40, yPosition);
      yPosition += 6;
    });

    yPosition += 5;

    // Report Body
    doc.setFont('Arial', 'bold');
    doc.setFontSize(12);
    doc.text('Report Details', margin, yPosition);
    yPosition += 8;

    doc.setFont('Arial', 'normal');
    doc.setFontSize(10);
    const bodyLines = doc.splitTextToSize(report.body || 'No description provided', contentWidth);
    bodyLines.forEach((line) => {
      if (yPosition > pageHeight - margin - 10) {
        doc.addPage();
        yPosition = margin;
      }
      doc.text(line, margin, yPosition);
      yPosition += 5;
    });

    // Resolution Notes (if resolved)
    if (report.resolution_notes) {
      yPosition += 5;
      if (yPosition > pageHeight - margin - 20) {
        doc.addPage();
        yPosition = margin;
      }

      doc.setFont('Arial', 'bold');
      doc.text('Resolution Notes', margin, yPosition);
      yPosition += 6;

      doc.setFont('Arial', 'normal');
      const resolutionLines = doc.splitTextToSize(report.resolution_notes, contentWidth);
      resolutionLines.forEach((line) => {
        if (yPosition > pageHeight - margin - 10) {
          doc.addPage();
          yPosition = margin;
        }
        doc.text(line, margin, yPosition);
        yPosition += 5;
      });
    }

    // Footer
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(9);
      doc.setTextColor(150, 150, 150);
      doc.text(
        `Page ${i} of ${pageCount}`,
        pageWidth / 2,
        pageHeight - 10,
        { align: 'center' }
      );
    }

    // Save PDF
    const filename = `Report_${report.id?.slice(0, 8) || 'export'}_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);

    return { success: true, filename };
  } catch (error) {
    console.error('Error exporting report to PDF:', error);
    throw error;
  }
};

/**
 * Export single report to DOCX
 * @param {Object} report - Report data
 * @returns {Promise<void>}
 */
export const exportReportToDOCX = async (report) => {
  try {
    const sections = [
      new Paragraph({
        text: 'MAINTENANCE REPORT',
        style: 'Heading1',
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 }
      }),

      // Metadata table
      new Table({
        rows: [
          new TableRow({
            cells: [
              new TableCell({
                children: [new Paragraph({ text: 'Report ID', bold: true })],
                shading: { fill: 'E0E0E0' }
              }),
              new TableCell({
                children: [new Paragraph({ text: report.id || 'N/A' })],
              })
            ]
          }),
          new TableRow({
            cells: [
              new TableCell({
                children: [new Paragraph({ text: 'Title', bold: true })],
                shading: { fill: 'E0E0E0' }
              }),
              new TableCell({
                children: [new Paragraph({ text: report.title || 'N/A' })]
              })
            ]
          }),
          new TableRow({
            cells: [
              new TableCell({
                children: [new Paragraph({ text: 'Category', bold: true })],
                shading: { fill: 'E0E0E0' }
              }),
              new TableCell({
                children: [new Paragraph({ text: report.category || 'N/A' })]
              })
            ]
          }),
          new TableRow({
            cells: [
              new TableCell({
                children: [new Paragraph({ text: 'Severity', bold: true })],
                shading: { fill: 'E0E0E0' }
              }),
              new TableCell({
                children: [new Paragraph({ text: report.severity || 'N/A' })]
              })
            ]
          }),
          new TableRow({
            cells: [
              new TableCell({
                children: [new Paragraph({ text: 'Department', bold: true })],
                shading: { fill: 'E0E0E0' }
              }),
              new TableCell({
                children: [new Paragraph({ text: report.department_name || 'General' })]
              })
            ]
          }),
          new TableRow({
            cells: [
              new TableCell({
                children: [new Paragraph({ text: 'Reporter', bold: true })],
                shading: { fill: 'E0E0E0' }
              }),
              new TableCell({
                children: [new Paragraph({ text: `${report.reporter_name || 'Unknown'} (${report.reporter_email || 'N/A'})` })]
              })
            ]
          }),
          new TableRow({
            cells: [
              new TableCell({
                children: [new Paragraph({ text: 'Status', bold: true })],
                shading: { fill: 'E0E0E0' }
              }),
              new TableCell({
                children: [new Paragraph({ text: report.status || 'Open' })]
              })
            ]
          }),
          new TableRow({
            cells: [
              new TableCell({
                children: [new Paragraph({ text: 'Created', bold: true })],
                shading: { fill: 'E0E0E0' }
              }),
              new TableCell({
                children: [new Paragraph({ text: formatDate(report.created_at) })]
              })
            ]
          }),
          new TableRow({
            cells: [
              new TableCell({
                children: [new Paragraph({ text: 'Updated', bold: true })],
                shading: { fill: 'E0E0E0' }
              }),
              new TableCell({
                children: [new Paragraph({ text: formatDate(report.updated_at) })]
              })
            ]
          }),
          ...(report.resolved_at ? [
            new TableRow({
              cells: [
                new TableCell({
                  children: [new Paragraph({ text: 'Resolved', bold: true })],
                  shading: { fill: 'E0E0E0' }
                }),
                new TableCell({
                  children: [new Paragraph({ text: formatDate(report.resolved_at) })]
                })
              ]
            })
          ] : [])
        ],
        width: { size: 100, type: WidthType.PERCENTAGE }
      }),

      new Paragraph({ text: '', spacing: { before: 200, after: 200 } }),

      // Report details
      new Paragraph({
        text: 'Report Details',
        style: 'Heading2',
        spacing: { before: 200, after: 100 }
      }),

      new Paragraph({
        text: report.body || 'No description provided',
        spacing: { after: 200 }
      }),

      ...(report.resolution_notes ? [
        new Paragraph({
          text: 'Resolution Notes',
          style: 'Heading2',
          spacing: { before: 200, after: 100 }
        }),
        new Paragraph({
          text: report.resolution_notes,
          spacing: { after: 200 }
        })
      ] : []),

      // Footer
      new Paragraph({
        text: `Generated on ${new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric', 
          hour: '2-digit', 
          minute: '2-digit' 
        })}`,
        style: 'Normal',
        spacing: { before: 400 },
        alignment: AlignmentType.RIGHT,
        border: {
          top: {
            color: '000000',
            space: 1,
            style: BorderStyle.SINGLE,
            size: 6
          }
        }
      })
    ];

    const doc = new Document({ sections: [{ children: sections }] });
    const blob = await Packer.toBlob(doc);
    const filename = `Report_${report.id?.slice(0, 8) || 'export'}_${new Date().toISOString().split('T')[0]}.docx`;
    saveAs(blob, filename);

    return { success: true, filename };
  } catch (error) {
    console.error('Error exporting report to DOCX:', error);
    throw error;
  }
};

/**
 * Export multiple reports to PDF (combined)
 * @param {Array} reports - Array of report data
 * @param {string} title - Document title
 * @returns {Promise<void>}
 */
export const exportReportsToPDF = async (reports, title = 'Maintenance Reports') => {
  try {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    const contentWidth = pageWidth - 2 * margin;
    let yPosition = margin;

    // Title page
    doc.setFontSize(24);
    doc.setTextColor(31, 78, 121);
    doc.text(title, pageWidth / 2, 50, { align: 'center' });

    doc.setFontSize(12);
    doc.setTextColor(100, 100, 100);
    doc.text(`Total Reports: ${reports.length}`, pageWidth / 2, 70, { align: 'center' });
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, pageWidth / 2, 80, { align: 'center' });

    // Add reports
    reports.forEach((report, index) => {
      if (index > 0 || yPosition > 100) {
        doc.addPage();
        yPosition = margin;
      }

      // Report number
      doc.setFontSize(14);
      doc.setTextColor(31, 78, 121);
      doc.text(`Report ${index + 1}`, margin, yPosition);
      yPosition += 10;

      // Report content
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);

      const metadataRows = [
        [`Title:`, report.title || 'N/A'],
        [`Category:`, report.category || 'N/A'],
        [`Severity:`, report.severity || 'N/A'],
        [`Department:`, report.department_name || 'General'],
        [`Reporter:`, report.reporter_name || 'Unknown'],
        [`Status:`, report.status || 'Open'],
        [`Created:`, formatDate(report.created_at)]
      ];

      metadataRows.forEach(([label, value]) => {
        if (yPosition > pageHeight - margin - 30) {
          doc.addPage();
          yPosition = margin;
        }
        doc.setFont('Arial', 'bold');
        doc.text(label, margin, yPosition);
        doc.setFont('Arial', 'normal');
        doc.text(String(value), margin + 35, yPosition);
        yPosition += 5;
      });

      yPosition += 5;

      // Body
      const bodyLines = doc.splitTextToSize(report.body || 'No description', contentWidth - 10);
      bodyLines.slice(0, 3).forEach((line) => {
        if (yPosition > pageHeight - margin - 20) {
          doc.addPage();
          yPosition = margin;
        }
        doc.text(line, margin + 5, yPosition);
        yPosition += 4;
      });

      if (bodyLines.length > 3) {
        doc.text('[... truncated ...]', margin + 5, yPosition);
        yPosition += 5;
      }

      yPosition += 8;
    });

    const filename = `Reports_${new Date().toISOString().split('T')[0]}.pdf`;
    doc.save(filename);

    return { success: true, filename };
  } catch (error) {
    console.error('Error exporting reports to PDF:', error);
    throw error;
  }
};

/**
 * Export multiple reports to DOCX (combined)
 * @param {Array} reports - Array of report data
 * @param {string} title - Document title
 * @returns {Promise<void>}
 */
export const exportReportsToDOCX = async (reports, title = 'Maintenance Reports') => {
  try {
    const sections = [
      new Paragraph({
        text: title,
        style: 'Heading1',
        alignment: AlignmentType.CENTER,
        spacing: { after: 100 }
      }),

      new Paragraph({
        text: `Total Reports: ${reports.length} | Generated: ${new Date().toLocaleDateString()}`,
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      }),

      ...reports.flatMap((report, index) => [
        new Paragraph({
          text: `Report ${index + 1}: ${report.title || 'Untitled'}`,
          style: 'Heading2',
          spacing: { before: 200, after: 100 }
        }),

        new Table({
          rows: [
            new TableRow({
              cells: [
                new TableCell({
                  children: [new Paragraph({ text: 'Category', bold: true })],
                  shading: { fill: 'E0E0E0' }
                }),
                new TableCell({
                  children: [new Paragraph({ text: report.category || 'N/A' })]
                })
              ]
            }),
            new TableRow({
              cells: [
                new TableCell({
                  children: [new Paragraph({ text: 'Severity', bold: true })],
                  shading: { fill: 'E0E0E0' }
                }),
                new TableCell({
                  children: [new Paragraph({ text: report.severity || 'N/A' })]
                })
              ]
            }),
            new TableRow({
              cells: [
                new TableCell({
                  children: [new Paragraph({ text: 'Status', bold: true })],
                  shading: { fill: 'E0E0E0' }
                }),
                new TableCell({
                  children: [new Paragraph({ text: report.status || 'Open' })]
                })
              ]
            })
          ],
          width: { size: 100, type: WidthType.PERCENTAGE }
        }),

        new Paragraph({
          text: report.body || 'No description provided',
          spacing: { before: 100, after: 200 }
        })
      ])
    ];

    const doc = new Document({ sections: [{ children: sections }] });
    const blob = await Packer.toBlob(doc);
    const filename = `Reports_${new Date().toISOString().split('T')[0]}.docx`;
    saveAs(blob, filename);

    return { success: true, filename };
  } catch (error) {
    console.error('Error exporting reports to DOCX:', error);
    throw error;
  }
};

export default {
  exportReportToPDF,
  exportReportToDOCX,
  exportReportsToPDF,
  exportReportsToDOCX
};
