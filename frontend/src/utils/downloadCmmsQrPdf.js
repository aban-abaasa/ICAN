import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { fitWithin, loadLogoAsset, makeQrDataUrl } from './consultationBranding';

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
//
// `logoRaw` (the business logo as the DB stores it) is optional: when given, the
// logo heads the flyer and is stamped in the centre of the QR. If the logo can't
// be loaded the flyer is produced exactly as before.
export const downloadCmmsQrPdf = async ({ type, url, location, companyName, title, note, instructions, filename, logoRaw }) => {
  const { image: logo } = logoRaw ? await loadLogoAsset(logoRaw) : { image: null };
  const qrImage = logo
    ? await makeQrDataUrl(url, { logo, size: 900 })
    : await QRCode.toDataURL(url, { width: 900, margin: 2, errorCorrectionLevel: 'H' });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const resolvedTitle = title || DEFAULT_TITLES[type] || 'Scan to Continue';
  const qrSize = 130;

  // A logo takes a band above the company name; everything else shifts down by it.
  let dy = 0;
  if (logo) {
    const { width, height } = fitWithin(logo.width, logo.height, 40, 24);
    pdf.addImage(logo.dataUrl, logo.format || 'PNG', (pageWidth - width) / 2, 14, width, height);
    dy = 24;
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.text(companyName || 'IcanEra', pageWidth / 2, 28 + dy, { align: 'center' });
  pdf.setFontSize(18);
  pdf.text(resolvedTitle, pageWidth / 2, 42 + dy, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(13);
  pdf.text(location || 'Check-in location', pageWidth / 2, 54 + dy, { align: 'center' });
  pdf.addImage(qrImage, 'PNG', (pageWidth - qrSize) / 2, 65 + dy, qrSize, qrSize);
  pdf.setFontSize(12);
  pdf.text(instructions || 'Scan this code with your phone to continue.', pageWidth / 2, 210 + dy, { align: 'center' });
  pdf.setFontSize(9);
  pdf.setTextColor(90);
  pdf.text(note || DEFAULT_NOTES[type] || '', pageWidth / 2, 220 + dy, { align: 'center' });
  pdf.setFontSize(8);
  pdf.setTextColor(140);
  pdf.text('Powered by IcanEra', pageWidth / 2, 230 + dy, { align: 'center' });
  pdf.text('A product of GODMINDERA ORGANISATION (U) LTD', pageWidth / 2, 235 + dy, { align: 'center' });
  pdf.save(filename || `ican-cmms-${type}-qr-${safeFilename(location)}.pdf`);
};
