import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

const safeFilename = (value) => (value || 'location')
  .trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'location';

export const downloadCmmsQrPdf = async ({ type, url, location, companyName }) => {
  const qrImage = await QRCode.toDataURL(url, { width: 900, margin: 2, errorCorrectionLevel: 'H' });
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const title = type === 'staff' ? 'Staff Attendance Check-In' : 'Visitor Check-In';
  const qrSize = 130;

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(22);
  pdf.text(companyName || 'IcanEra', pageWidth / 2, 28, { align: 'center' });
  pdf.setFontSize(18);
  pdf.text(title, pageWidth / 2, 42, { align: 'center' });
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(13);
  pdf.text(location || 'Check-in location', pageWidth / 2, 54, { align: 'center' });
  pdf.addImage(qrImage, 'PNG', (pageWidth - qrSize) / 2, 65, qrSize, qrSize);
  pdf.setFontSize(12);
  pdf.text('Scan this code with your phone to continue.', pageWidth / 2, 210, { align: 'center' });
  pdf.setFontSize(9);
  pdf.setTextColor(90);
  pdf.text(type === 'staff' ? 'Staff must sign in with their own IcanEra account before checking in.' : 'Visitors can use this code to register their arrival or departure.', pageWidth / 2, 220, { align: 'center' });
  pdf.save(`ican-cmms-${type}-qr-${safeFilename(location)}.pdf`);
};
