import jsPDF from 'jspdf';

// Certificate-style Investment Agreement PDF, usable by both sides of the deal
// (investor and business owner). Works from plain data so it needs no extra
// queries: { businessName, pitchTitle, investorName, investmentType, shares,
// sharePrice, totalInvestment, status, reference, createdAt, sealedAt,
// signedCount, totalShareholders, mouContent }.
const GOLD = [160, 120, 40];
const INK = [30, 30, 40];

export const downloadInvestmentAgreementPdf = (d) => {
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

  const sealed = d.status === 'sealed';
  const statusText = sealed ? 'SEALED' : d.status === 'expired' ? 'REFUNDED' : 'AWAITING SHAREHOLDER APPROVAL';
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(10);
  pdf.setTextColor(...(sealed ? [20, 120, 60] : d.status === 'expired' ? [170, 40, 40] : [170, 120, 20]));
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
    ['Shareholder approval', `${d.signedCount ?? 0} of ${d.totalShareholders ?? 0} (60% required)`],
    ['Signed on', d.createdAt ? new Date(d.createdAt).toLocaleString() : 'N/A'],
    ...(d.sealedAt ? [['Sealed on', new Date(d.sealedAt).toLocaleString()]] : []),
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

  need(30);
  y += 8;
  pdf.setFont('times', 'italic');
  pdf.setFontSize(9);
  pdf.setTextColor(120);
  pdf.splitTextToSize(
    'Electronically signed and sealed on the ICANera platform. Funds are held in escrow until 60% of shareholders approve, and refunded automatically if approval is not reached within 3 days.',
    cw
  ).forEach((line) => { pdf.text(line, m, y); y += 4.5; });

  const safe = String(d.businessName || 'agreement').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  pdf.save(`ican-agreement-${safe || 'agreement'}.pdf`);
};
