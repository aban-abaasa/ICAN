import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

const safeFilename = (value) => (value || 'location')
  .trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'location';

const DEFAULT_TITLES = { staff: 'Staff Attendance Check-In', visitor: 'Visitor Check-In' };
const DEFAULT_NOTES = {
  staff: 'Staff must sign in with their own IcanEra account before checking in.',
  visitor: 'Visitors can use this code to register their arrival or departure.'
};

// `title`/`note`/`instructions`/`filename` are optional overrides so other
// CMMS QR flyers (e.g. a consultation form's public-link QR, see
// CMMSConsultationForms.jsx) can reuse this same layout without stretching
// the type === 'staff' | 'visitor' branching above — 'staff' and 'visitor'
// callers are unaffected since their text still comes from the defaults.
export const downloadCmmsQrPdf = async ({ type, url, location, companyName, title, note, instructions, filename }) => {
  const qrImage = await QRCode.toDataURL(url, { width: 900, margin: 2, errorCorrectionLevel: 'H' });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const resolvedTitle = title || DEFAULT_TITLES[type] || 'Scan to Continue';
  const qrSize = 130;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.text(companyName || 'IcanEra', pageWidth / 2, 28, { align: 'center' });
  pdf.setFontSize(18);
  pdf.text(resolvedTitle, pageWidth / 2, 42, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(13);
  pdf.text(location || 'Check-in location', pageWidth / 2, 54, { align: 'center' });
  pdf.addImage(qrImage, 'PNG', (pageWidth - qrSize) / 2, 65, qrSize, qrSize);
  pdf.setFontSize(12);
  pdf.text(instructions || 'Scan this code with your phone to continue.', pageWidth / 2, 210, { align: 'center' });
  pdf.setFontSize(9);
  pdf.setTextColor(90);
  pdf.text(note || DEFAULT_NOTES[type] || '', pageWidth / 2, 220, { align: 'center' });
  pdf.save(filename || `ican-cmms-${type}-qr-${safeFilename(location)}.pdf`);
};
