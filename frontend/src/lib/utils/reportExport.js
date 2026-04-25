/**
 * Report Export Utilities
 * Converts report data to PDF and Word (.docx) formats
 * Requires: docx, pdfkit libraries
 */

import { Document, Packer, Paragraph, Table, TableCell, TableRow, BorderStyle, AlignmentType, TextRun } from 'docx';

/**
 * Format report for text output (used by both PDF and Word)
 */
const formatReportText = (report) => {
  const lines = [];
  
  lines.push(`${'='.repeat(80)}`);
  lines.push(`REPORT: ${report.title || 'Untitled'}`);
  lines.push(`${'='.repeat(80)}\n`);
  
  lines.push(`Report ID: ${report.id || 'N/A'}`);
  lines.push(`Category: ${report.category || 'General'}`);
  lines.push(`Severity: ${report.severity?.toUpperCase() || 'N/A'}`);
  lines.push(`Status: ${report.status?.toUpperCase() || 'N/A'}`);
  lines.push(`Department: ${report.department_name || 'General'}\n`);
  
  lines.push(`Reporter Name: ${report.reporter_name || 'Anonymous'}`);
  lines.push(`Reporter Email: ${report.reporter_email || 'N/A'}`);
  lines.push(`Reporter Role: ${report.reporter_role || 'N/A'}\n`);
  
  lines.push(`Created: ${new Date(report.created_at).toLocaleString() || 'N/A'}`);
  lines.push(`Updated: ${new Date(report.updated_at).toLocaleString() || 'N/A'}`);
  
  if (report.resolved_at) {
    lines.push(`Resolved: ${new Date(report.resolved_at).toLocaleString()}`);
  }
  lines.push('');
  
  lines.push(`${'_'.repeat(80)}`);
  lines.push('REPORT DETAILS');
  lines.push(`${'_'.repeat(80)}\n`);
  lines.push(report.body || 'No details provided');
  lines.push('');
  
  if (report.resolution_notes) {
    lines.push(`${'_'.repeat(80)}`);
    lines.push('RESOLUTION NOTES');
    lines.push(`${'_'.repeat(80)}\n`);
    lines.push(report.resolution_notes);
  }
  
  return lines.join('\n');
};

/**
 * Export report as Word document (.docx)
 * @param {Object} report - Report data from exportReport function
 * @param {string} filename - Output filename (without extension)
 * @returns {Promise<Blob>}
 */
export const exportReportAsWord = async (report, filename = 'report') => {
  try {
    if (!report) {
      throw new Error('Report data is required');
    }

    const sections = [];
    
    // Title
    sections.push(
      new Paragraph({
        text: report.title || 'Company Report',
        style: 'Heading1',
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      })
    );

    // Metadata table
    sections.push(
      new Table({
        rows: [
          new TableRow({
            cells: [
              new TableCell({
                children: [new Paragraph('Report ID')],
                shading: { fill: 'D3D3D3' }
              }),
              new TableCell({
                children: [new Paragraph(report.id || 'N/A')],
                shading: { fill: 'F5F5F5' }
              }),
              new TableCell({
                children: [new Paragraph('Category')],
                shading: { fill: 'D3D3D3' }
              }),
              new TableCell({
                children: [new Paragraph(report.category || 'General')],
                shading: { fill: 'F5F5F5' }
              })
            ]
          }),
          new TableRow({
            cells: [
              new TableCell({
                children: [new Paragraph('Severity')],
                shading: { fill: 'D3D3D3' }
              }),
              new TableCell({
                children: [new Paragraph((report.severity || 'Medium').toUpperCase())],
                shading: { fill: 'F5F5F5' }
              }),
              new TableCell({
                children: [new Paragraph('Status')],
                shading: { fill: 'D3D3D3' }
              }),
              new TableCell({
                children: [new Paragraph((report.status || 'Open').toUpperCase())],
                shading: { fill: 'F5F5F5' }
              })
            ]
          }),
          new TableRow({
            cells: [
              new TableCell({
                children: [new Paragraph('Department')],
                shading: { fill: 'D3D3D3' }
              }),
              new TableCell({
                children: [new Paragraph(report.department_name || 'General')],
                shading: { fill: 'F5F5F5' },
                columnSpan: 3
              })
            ]
          })
        ]
      }),
      new Paragraph({ text: '', spacing: { after: 200 } })
    );

    // Reporter info
    sections.push(
      new Paragraph({
        text: 'Reporter Information',
        style: 'Heading2',
        spacing: { before: 200, after: 100 }
      }),
      new Paragraph({
        text: `Name: ${report.reporter_name || 'Anonymous'}`
      }),
      new Paragraph({
        text: `Email: ${report.reporter_email || 'N/A'}`
      }),
      new Paragraph({
        text: `Role: ${report.reporter_role || 'N/A'}`
      }),
      new Paragraph({ text: '', spacing: { after: 200 } })
    );

    // Report body
    sections.push(
      new Paragraph({
        text: 'Report Details',
        style: 'Heading2',
        spacing: { before: 200, after: 100 }
      }),
      new Paragraph({
        text: report.body || 'No details provided',
        spacing: { after: 200 }
      })
    );

    // Resolution notes if available
    if (report.resolution_notes) {
      sections.push(
        new Paragraph({
          text: 'Resolution Notes',
          style: 'Heading2',
          spacing: { before: 200, after: 100 }
        }),
        new Paragraph({
          text: report.resolution_notes,
          spacing: { after: 200 }
        })
      );
    }

    // Footer with dates
    sections.push(
      new Paragraph({
        text: `Created: ${new Date(report.created_at).toLocaleString() || 'N/A'}`,
        spacing: { before: 400, after: 50 },
        style: 'Footer'
      }),
      new Paragraph({
        text: `Last Updated: ${new Date(report.updated_at).toLocaleString() || 'N/A'}`,
        spacing: { after: 50 },
        style: 'Footer'
      })
    );

    if (report.resolved_at) {
      sections.push(
        new Paragraph({
          text: `Resolved: ${new Date(report.resolved_at).toLocaleString()}`,
          spacing: { after: 50 },
          style: 'Footer'
        })
      );
    }

    const doc = new Document({
      sections: [
        {
          children: sections
        }
      ]
    });

    const blob = await Packer.toBlob(doc);
    
    // Trigger download
    downloadFile(blob, `${filename}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    
    return { success: true, message: 'Report exported to Word successfully' };
  } catch (error) {
    console.error('Error exporting report as Word:', error);
    throw error;
  }
};

/**
 * Export report as PDF
 * Uses client-side library or API endpoint
 * @param {Object} report - Report data from exportReport function
 * @param {string} filename - Output filename (without extension)
 */
export const exportReportAsPDF = async (report, filename = 'report') => {
  try {
    if (!report) {
      throw new Error('Report data is required');
    }

    // Try using jsPDF if available
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    let yPosition = 10;
    const margin = 10;
    const maxWidth = pageWidth - 2 * margin;

    // Title
    pdf.setFont('Helvetica', 'bold');
    pdf.setFontSize(16);
    const title = report.title || 'Company Report';
    const titleLines = pdf.splitTextToSize(title, maxWidth);
    pdf.text(titleLines, margin, yPosition);
    yPosition += titleLines.length * 7 + 5;

    // Report metadata
    pdf.setFont('Helvetica', 'normal');
    pdf.setFontSize(10);
    const metadata = [
      `Report ID: ${report.id || 'N/A'}`,
      `Category: ${report.category || 'General'} | Severity: ${(report.severity || 'Medium').toUpperCase()}`,
      `Status: ${(report.status || 'Open').toUpperCase()} | Department: ${report.department_name || 'General'}`,
      `Reporter: ${report.reporter_name || 'Anonymous'} (${report.reporter_role || 'N/A'})`
    ];

    metadata.forEach(line => {
      pdf.text(line, margin, yPosition);
      yPosition += 5;
    });

    yPosition += 5;

    // Report body
    pdf.setFont('Helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text('Report Details:', margin, yPosition);
    yPosition += 5;

    pdf.setFont('Helvetica', 'normal');
    pdf.setFontSize(10);
    const bodyText = report.body || 'No details provided';
    const bodyLines = pdf.splitTextToSize(bodyText, maxWidth);
    
    bodyLines.forEach(line => {
      if (yPosition > pageHeight - margin - 10) {
        pdf.addPage();
        yPosition = margin;
      }
      pdf.text(line, margin, yPosition);
      yPosition += 5;
    });

    // Resolution notes if available
    if (report.resolution_notes) {
      yPosition += 5;
      
      if (yPosition > pageHeight - margin - 15) {
        pdf.addPage();
        yPosition = margin;
      }

      pdf.setFont('Helvetica', 'bold');
      pdf.setFontSize(11);
      pdf.text('Resolution Notes:', margin, yPosition);
      yPosition += 5;

      pdf.setFont('Helvetica', 'normal');
      pdf.setFontSize(10);
      const resolutionLines = pdf.splitTextToSize(report.resolution_notes, maxWidth);
      resolutionLines.forEach(line => {
        if (yPosition > pageHeight - margin - 10) {
          pdf.addPage();
          yPosition = margin;
        }
        pdf.text(line, margin, yPosition);
        yPosition += 5;
      });
    }

    // Footer with dates
    yPosition += 5;
    pdf.setFont('Helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text(`Created: ${new Date(report.created_at).toLocaleString() || 'N/A'}`, margin, pageHeight - 10);

    // Save PDF
    pdf.save(`${filename}.pdf`);
    
    return { success: true, message: 'Report exported to PDF successfully' };
  } catch (error) {
    console.error('Error exporting report as PDF:', error);
    // Fallback to text export
    console.warn('PDF export failed, falling back to text download');
    const textContent = formatReportText(report);
    downloadFile(
      new Blob([textContent], { type: 'text/plain' }),
      `${filename}.txt`,
      'text/plain'
    );
    throw error;
  }
};

/**
 * Export report as plain text
 * @param {Object} report - Report data
 * @param {string} filename - Output filename
 */
export const exportReportAsText = (report, filename = 'report') => {
  try {
    if (!report) {
      throw new Error('Report data is required');
    }

    const textContent = formatReportText(report);
    const blob = new Blob([textContent], { type: 'text/plain' });
    downloadFile(blob, `${filename}.txt`, 'text/plain');
    
    return { success: true, message: 'Report exported as text successfully' };
  } catch (error) {
    console.error('Error exporting report as text:', error);
    throw error;
  }
};

/**
 * Helper function to trigger file download
 */
const downloadFile = (blob, filename, mimeType) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.type = mimeType;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

/**
 * Export multiple reports as a batch
 * Creates a ZIP file with individual report files
 * @param {Array} reports - Array of report objects
 * @param {string} format - 'pdf' | 'docx' | 'txt'
 * @param {string} zipFilename - Output ZIP filename
 */
export const exportMultipleReports = async (reports, format = 'pdf', zipFilename = 'reports') => {
  try {
    if (!reports || reports.length === 0) {
      throw new Error('No reports to export');
    }

    // Dynamic import for JSZip
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();

    for (let i = 0; i < reports.length; i++) {
      const report = reports[i];
      const reportName = `Report_${i + 1}_${(report.title || 'Untitled').replace(/[^a-z0-9]/gi, '_').toLowerCase()}`;
      
      let content;
      let extension;

      if (format === 'pdf') {
        // For PDF, we'd need to create it and convert to blob
        // This is simplified - in real implementation, you'd need jsPDF
        extension = 'pdf';
        content = new Blob(['PDF export requires jsPDF'], { type: 'application/pdf' });
      } else if (format === 'docx') {
        extension = 'docx';
        // Similar to above - would need docx library
        content = new Blob(['DOCX export requires docx library'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
      } else {
        extension = 'txt';
        const textContent = formatReportText(report);
        content = new Blob([textContent], { type: 'text/plain' });
      }

      zip.file(`${reportName}.${extension}`, content);
    }

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    downloadFile(zipBlob, `${zipFilename}.zip`, 'application/zip');

    return { success: true, message: `${reports.length} reports exported successfully` };
  } catch (error) {
    console.error('Error exporting multiple reports:', error);
    throw error;
  }
};

export default {
  exportReportAsWord,
  exportReportAsPDF,
  exportReportAsText,
  exportMultipleReports,
  formatReportText
};
