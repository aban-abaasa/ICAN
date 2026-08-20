import React from 'react';
import { createPortal } from 'react-dom';
import { jsPDF } from 'jspdf';

export default function IcanPaymentReceiptModal({ receipt, onClose }) {
  if (!receipt) return null;
  const recipient = receipt.recipientName || 'ICANera recipient';
  const payer = receipt.payerName || 'You';
  const receiptText = [
    'ICANERA DIGITAL RECEIPT', `Receipt: ${receipt.receiptNumber}`,
    `Amount: ${Number(receipt.amount).toLocaleString()} ${receipt.currency}`,
    `Method: ${receipt.paymentMethod === 'cash' ? 'Cash' : 'ICAN Wallet'}`,
    `Received by: ${recipient}`, `Paid by: ${payer}`,
    `Payment code: ${receipt.paymentCode}`,
    `Transaction: ${receipt.transactionId || 'Recorded on ICAN ledger'}`,
    `Description: ${receipt.description || 'Payment'}`,
    `Date: ${new Date(receipt.issuedAt).toLocaleString()}`,
  ].join('\n');
  const downloadReceipt = () => {
    const url = URL.createObjectURL(new Blob([receiptText], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `${receipt.receiptNumber}.txt`; link.click(); URL.revokeObjectURL(url);
  };
  const saveAsPdf = () => {
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    pdf.setFillColor(15, 23, 42); pdf.rect(0, 0, 210, 32, 'F');
    pdf.setTextColor(255, 255, 255); pdf.setFontSize(20); pdf.text('ICANERA RECEIPT', 15, 20);
    pdf.setTextColor(15, 23, 42); pdf.setFontSize(12);
    pdf.text(pdf.splitTextToSize(receiptText.replace('ICANERA DIGITAL RECEIPT\n', ''), 175), 18, 48);
    pdf.setFontSize(9); pdf.setTextColor(71, 85, 105);
    pdf.text('This is a digitally recorded ICANera payment receipt.', 18, 280);
    pdf.save(`${receipt.receiptNumber}.pdf`);
  };
  const shareReceipt = async () => {
    if (navigator.share) return navigator.share({ title: 'ICANera receipt', text: receiptText });
    await navigator.clipboard?.writeText(receiptText);
  };
  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end justify-center bg-black/75 p-0 sm:items-center sm:p-4">
      <div className="max-h-[calc(100dvh-0.75rem)] w-full max-w-md overflow-y-auto rounded-t-3xl bg-white p-5 pb-[max(6rem,env(safe-area-inset-bottom))] shadow-2xl sm:max-h-[90vh] sm:rounded-2xl sm:p-6" style={{ backgroundColor: '#ffffff', color: '#0f172a' }}>
        <div className="mb-5 text-center"><div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl">✓</div><h2 className="text-2xl font-bold text-slate-950">Payment completed</h2><p className="text-sm text-slate-600">{receipt.paymentMethod === 'cash' ? 'Cash payment recorded successfully' : 'ICAN transaction recorded successfully'}</p></div>
        <div className="space-y-3 rounded-xl bg-slate-100 p-4 text-sm text-slate-900">
          <div className="flex justify-between gap-4"><span>Receipt</span><strong className="text-right break-all">{receipt.receiptNumber}</strong></div><div className="flex justify-between gap-4"><span>Amount</span><strong>{Number(receipt.amount).toLocaleString()} {receipt.currency}</strong></div><div className="flex justify-between gap-4"><span>Received by</span><strong className="text-right">{recipient}</strong></div><div className="flex justify-between gap-4"><span>Paid by</span><strong className="text-right">{payer}</strong></div><div className="flex justify-between gap-4"><span>Payment code</span><strong className="max-w-[190px] truncate">{receipt.paymentCode}</strong></div><div className="flex justify-between gap-4"><span>Transaction</span><strong className="max-w-[190px] truncate">{receipt.transactionId || 'Recorded on ICAN ledger'}</strong></div><div className="flex justify-between gap-4"><span>Time</span><strong className="text-right">{new Date(receipt.issuedAt).toLocaleString()}</strong></div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3"><button onClick={saveAsPdf} className="rounded-xl bg-slate-900 px-4 py-3 font-bold text-white">Download PDF</button><button onClick={shareReceipt} className="rounded-xl bg-sky-600 px-4 py-3 font-bold text-white">Share</button><button onClick={downloadReceipt} className="rounded-xl bg-slate-200 px-4 py-3 font-bold text-slate-900">Download text</button><button onClick={onClose} className="rounded-xl bg-orange-500 px-4 py-3 font-bold text-white">Done</button></div>
      </div>
    </div>, document.body);
}
