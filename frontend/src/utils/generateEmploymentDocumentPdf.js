import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

const safeFilename = (value) => (value || 'document')
  .trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'document';

/**
 * Renders an appointment letter / employment contract as a PDF with a
 * QR-code "seal" (company stamp) in the bottom corner. The QR encodes a URL
 * to the public /verify-document page (fn_verify_employment_document),
 * never the document content itself -- scanning it only ever confirms
 * authenticity, the same "opaque token, narrow verify endpoint" pattern as
 * the CMMS staff-attendance QR (see downloadCmmsQrPdf.js), not the
 * raw-JSON-in-QR pattern used elsewhere in the app.
 *
 * Returns the finished PDF as a Blob (for upload to R2) instead of saving
 * it directly, since the caller (CMMSEmploymentDocumentsPanel.jsx) needs to
 * upload it before the document can be marked "issued".
 */
export const generateEmploymentDocumentPdf = async ({
  companyName,
  documentType, // 'appointment_letter' | 'employment_contract'
  title,
  employeeName,
  content, // { position, department, employmentType, salary, startDate, terms }
  issuedAt,
  verifyUrl,
}) => {
  const qrImage = await QRCode.toDataURL(verifyUrl, { width: 300, margin: 1, errorCorrectionLevel: 'H' });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const marginX = 20;
  let y = 22;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text(companyName || 'Company', pageWidth / 2, y, { align: 'center' });
  y += 8;
  pdf.setFontSize(13);
  pdf.text(documentType === 'employment_contract' ? 'Employment Contract' : 'Letter of Appointment', pageWidth / 2, y, { align: 'center' });
  y += 6;
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  pdf.setTextColor(100);
  pdf.text(`Issued: ${issuedAt ? new Date(issuedAt).toLocaleDateString() : new Date().toLocaleDateString()}`, pageWidth / 2, y, { align: 'center' });
  pdf.setTextColor(0);
  y += 10;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(12);
  pdf.text(title || 'Employment Document', marginX, y);
  y += 8;

  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(11);
  const fields = [
    ['Employee', employeeName],
    ['Position', content?.position],
    ['Department', content?.department],
    ['Employment type', content?.employmentType],
    ['Salary', content?.salary],
    ['Start date', content?.startDate],
  ].filter(([, value]) => value);

  fields.forEach(([label, value]) => {
    pdf.setFont('helvetica', 'bold');
    pdf.text(`${label}:`, marginX, y);
    pdf.setFont('helvetica', 'normal');
    pdf.text(String(value), marginX + 38, y);
    y += 7;
  });

  if (content?.terms) {
    y += 3;
    pdf.setFont('helvetica', 'bold');
    pdf.text('Terms', marginX, y);
    y += 6;
    pdf.setFont('helvetica', 'normal');
    const lines = pdf.splitTextToSize(content.terms, pageWidth - marginX * 2);
    pdf.text(lines, marginX, y);
    y += lines.length * 5.5;
  }

  // The seal -- a bordered box holding the QR + a caption explaining what
  // scanning it proves, positioned like a stamp near the bottom of the page
  // regardless of how much of the page the body text above used.
  const sealSize = 32;
  const sealX = pageWidth - marginX - sealSize;
  const sealY = pageHeight - 55;
  pdf.setDrawColor(120);
  pdf.setLineWidth(0.4);
  pdf.rect(sealX - 4, sealY - 4, sealSize + 8, sealSize + 20);
  pdf.addImage(qrImage, 'PNG', sealX, sealY, sealSize, sealSize);
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(7);
  pdf.text('OFFICIAL SEAL', sealX + sealSize / 2, sealY + sealSize + 5, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(6.5);
  pdf.text('Scan to verify authenticity', sealX + sealSize / 2, sealY + sealSize + 9, { align: 'center' });

  pdf.setFontSize(9);
  pdf.setTextColor(90);
  pdf.text('Authorized signature: ____________________________', marginX, pageHeight - 40);

  return pdf.output('blob');
};

export const employmentDocumentFilename = (documentType, employeeName) =>
  `${documentType === 'employment_contract' ? 'contract' : 'appointment-letter'}-${safeFilename(employeeName)}.pdf`;
