import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { getSupabase } from './pitchingService';
import { getPublicAppUrl } from '../utils/publicAppUrl';

// Certificate-style Investment Agreement PDF, usable by both sides of the deal
// (investor and business owner). Works from plain data:
// { agreementId, businessName, pitchTitle, investorName, investmentType, shares,
//   sharePrice, totalInvestment, status, reference, createdAt, sealedAt,
//   signedCount, totalShareholders, mouContent }.
//
// When agreementId is given it also fetches the REAL signature record
// (fn_get_agreement_seal -- ADD_INVESTMENT_AGREEMENT_SEAL_VERIFY.sql) and prints
// every signer with the time they signed, a SEALED stamp once approved, and a QR
// code to the public /verify-agreement page. Scanning the QR shows the live
// record; the printed seal code must match it.
const GOLD = [160, 120, 40];
const GREEN = [20, 120, 60];
const INK = [30, 30, 40];

const fetchSeal = async (agreementId) => {
  if (!agreementId) return null;
  try {
    const { data, error } = await getSupabase().rpc('fn_get_agreement_seal', { p_agreement_id: agreementId });
    if (error) throw error;
    return data || null;
  } catch (err) {
    console.warn('Agreement seal unavailable, printing without it:', err?.message);
    return null;
  }
};

export const downloadInvestmentAgreementPdf = async (d) => {
  const seal = await fetchSeal(d.agreementId);
  const status = seal?.status || d.status;
  const sealed = status === 'sealed';
  const signedCount = seal?.signed_count ?? d.signedCount ?? 0;
  const totalMembers = seal?.total_members ?? d.totalShareholders ?? 0;

  let qrImage = null;
  if (seal?.lookup_key) {
    const url = getPublicAppUrl(
      `/verify-agreement?id=${seal.agreement_id}&k=${seal.lookup_key}&s=${encodeURIComponent(seal.seal_code || '')}`
    );
    qrImage = await QRCode.toDataURL(url, { width: 360, margin: 1, errorCorrectionLevel: 'H' });
  }

  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const m = 18;
  const cw = W - m * 2;
  let y = 0;

  const frame = () => {
    pdf.setDrawColor(...GOLD);
    pdf.setLineWidth(0.9);
    pdf.rect(8, 8, W - 16, H - 16);
    pdf.setLineWidth(0.25);
    pdf.rect(10.5, 10.5, W - 21, H - 21);
  };
  const newPage = () => { pdf.addPage(); frame(); y = 24; };
  const need = (h) => { if (y + h > H - 22) newPage(); };

  frame();
  y = 28;
  pdf.setTextColor(...GOLD);
  pdf.setFont('times', 'bold');
  pdf.setFontSize(11);
  pdf.text('ICANERA  ·  PITCHIN', W / 2, y, { align: 'center' });
  y += 11;
  pdf.setTextColor(...INK);
  pdf.setFontSize(24);
  pdf.text('Investment Agreement', W / 2, y, { align: 'center' });
  y += 8;
  pdf.setFont('times', 'italic');
  pdf.setFontSize(11);
  pdf.setTextColor(110);
  pdf.text('Certificate of investment in ' + (d.businessName || 'the business'), W / 2, y, { align: 'center' });
  y += 7;
  pdf.setDrawColor(...GOLD);
  pdf.line(W / 2 - 25, y, W / 2 + 25, y);
  y += 10;

  const statusText = sealed ? 'SEALED' : status === 'expired' ? 'REFUNDED' : 'AWAITING SHAREHOLDER APPROVAL';
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(...(sealed ? GREEN : status === 'expired' ? [170, 40, 40] : [170, 120, 20]));
  pdf.text(statusText, W / 2, y, { align: 'center' });
  y += 10;

  const typeLabel = d.shares > 0
    ? `${d.shares} shares`
    : d.investmentType === 'guarantor' ? 'Guarantee (no equity)' : 'Partnership / support (no equity)';

  const rows = [
    ['Business', d.businessName],
    ['Pitch', d.pitchTitle],
    ['Investor', d.investorName],
    ['Investment', typeLabel],
    ...(d.shares > 0 && d.sharePrice ? [['Price per share', `${Number(d.sharePrice).toFixed(2)}`]] : []),
    ['Amount (IcanEra)', `${(Number(d.totalInvestment) || 0).toFixed(2)}`],
    ['Shareholder approval', `${signedCount} of ${totalMembers} registered members (60% required)`],
    ['Signed on', d.createdAt ? new Date(d.createdAt).toLocaleString() : 'N/A'],
    ...((seal?.sealed_at || d.sealedAt) ? [['Sealed on', new Date(seal?.sealed_at || d.sealedAt).toLocaleString()]] : []),
    ['Reference', d.reference || 'N/A'],
  ];
  rows.forEach(([label, value]) => {
    const lines = pdf.splitTextToSize(String(value ?? 'N/A'), cw - 52);
    need(7 * lines.length);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9.5);
    pdf.setTextColor(120);
    pdf.text(label.toUpperCase(), m, y);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(11);
    pdf.setTextColor(...INK);
    pdf.text(lines, m + 52, y);
    y += 7 * lines.length + 1;
  });

  y += 4;
  need(20);
  pdf.setDrawColor(210);
  pdf.line(m, y, W - m, y);
  y += 9;
  pdf.setFont('times', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(...INK);
  pdf.text('Memorandum of Understanding', m, y);
  y += 8;
  pdf.setFont('times', 'normal');
  pdf.setFontSize(10.5);
  pdf.splitTextToSize(String(d.mouContent || 'The business has not published MOU text.'), cw).forEach((line) => {
    need(5.5);
    pdf.text(line, m, y);
    y += 5.5;
  });

  // ---- Signatures: the real record, one line per signer ----
  const signers = seal?.signers || [];
  y += 8;
  need(24 + Math.min(signers.length, 3) * 9);
  pdf.setDrawColor(210);
  pdf.line(m, y, W - m, y);
  y += 9;
  pdf.setFont('times', 'bold');
  pdf.setFontSize(14);
  pdf.setTextColor(...INK);
  pdf.text('Signatures', m, y);
  y += 7;

  if (signers.length === 0) {
    pdf.setFont('times', 'italic');
    pdf.setFontSize(10.5);
    pdf.setTextColor(120);
    pdf.text(seal ? 'No signatures recorded yet.' : 'Signature record unavailable for this copy.', m, y);
    y += 8;
  }
  signers.forEach((s) => {
    const bioLines = s.bio ? pdf.splitTextToSize(String(s.bio), cw - 4).slice(0, 3) : [];
    need(20 + bioLines.length * 4);
    pdf.setFont('times', 'italic');
    pdf.setFontSize(14);
    pdf.setTextColor(...INK);
    pdf.text(String(s.name || 'Signatory'), m, y);
    pdf.setDrawColor(190);
    pdf.line(m, y + 1.6, m + 70, y + 1.6);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8.5);
    pdf.setTextColor(...GREEN);
    pdf.text('SIGNED', W - m, y, { align: 'right' });
    y += 5.5;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(110);
    const when = s.signed_at ? new Date(s.signed_at).toLocaleString() : 'N/A';
    pdf.text(`${s.role}   |   Time: ${when}   |   Location: ${s.location || 'not recorded'}`, m, y);
    y += 4.5;
    if (bioLines.length) {
      pdf.setFont('times', 'italic');
      pdf.setFontSize(9);
      pdf.setTextColor(90);
      bioLines.forEach((line) => { pdf.text(line, m, y); y += 4; });
    }
    y += 5;
  });

  // ---- Seal block: stamp + QR + seal code ----
  need(52);
  y += 6;
  const blockTop = y;

  if (sealed) {
    const cx = m + 24;
    const cy = blockTop + 21;
    pdf.setDrawColor(...GREEN);
    pdf.setTextColor(...GREEN);
    pdf.setLineWidth(1.1);
    pdf.circle(cx, cy, 20);
    pdf.setLineWidth(0.4);
    pdf.circle(cx, cy, 17.2);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7);
    pdf.text('ICANERA · PITCHIN', cx, cy - 8, { align: 'center' });
    pdf.setFontSize(15);
    pdf.text('SEALED', cx, cy + 1.5, { align: 'center' });
    pdf.setFontSize(6.5);
    const sealedDate = (seal?.sealed_at || d.sealedAt) ? new Date(seal?.sealed_at || d.sealedAt).toLocaleDateString() : '';
    pdf.text(sealedDate, cx, cy + 7, { align: 'center' });
    pdf.setFontSize(6);
    pdf.text(`${signedCount}/${totalMembers} APPROVED`, cx, cy + 11, { align: 'center' });
    pdf.setLineWidth(0.25);
  }

  const textX = m + 50;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(9);
  pdf.setTextColor(...INK);
  pdf.text('SEAL CODE', textX, blockTop + 6);
  pdf.setFont('courier', 'bold');
  pdf.setFontSize(12);
  pdf.text(seal?.seal_code || 'N/A', textX, blockTop + 12);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(8);
  pdf.setTextColor(110);
  pdf.splitTextToSize(
    qrImage
      ? 'Scan the QR code to confirm this agreement and its signatures on the IcanEra platform. The seal code on the page must match this one.'
      : 'Signature record unavailable for this copy.',
    cw - 50 - 38
  ).forEach((line, i) => pdf.text(line, textX, blockTop + 19 + i * 4));

  if (qrImage) {
    pdf.addImage(qrImage, 'PNG', W - m - 34, blockTop, 34, 34);
    pdf.setFontSize(7);
    pdf.text('Scan to verify', W - m - 17, blockTop + 38, { align: 'center' });
  }
  y = blockTop + 44;

  need(16);
  pdf.setFont('times', 'italic');
  pdf.setFontSize(9);
  pdf.setTextColor(120);
  pdf.splitTextToSize(
    'Electronically signed and sealed on the IcanEra platform. Funds are held in escrow until 60% of registered members approve, and refunded automatically if approval is not reached within 3 days.',
    cw
  ).forEach((line) => { pdf.text(line, m, y); y += 4.5; });

  const safe = String(d.businessName || 'agreement').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  pdf.save(`ican-agreement-${safe || 'agreement'}.pdf`);
};
