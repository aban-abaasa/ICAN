import React from 'react';

export default function IcanPaymentReceiptModal({ receipt, onClose }) {
  if (!receipt) return null;
  const downloadReceipt = () => {
    const text = [
      'ICANERA DIGITAL RECEIPT',
      '-----------------------',
      `Receipt: ${receipt.receiptNumber}`,
      `Amount: ${Number(receipt.amount).toLocaleString()} ${receipt.currency}`,
      `Method: ${receipt.paymentMethod === 'cash' ? 'Cash' : 'ICAN Wallet'}`,
      `Received by: ${receipt.recipientName || 'ICANera recipient'}`,
      `Payment code: ${receipt.paymentCode}`,
      `Transaction: ${receipt.transactionId || 'Recorded on ICAN ledger'}`,
      `Description: ${receipt.description || 'Payment'}`,
      `Date: ${new Date(receipt.issuedAt).toLocaleString()}`,
      receipt.paymentMethod === 'cash' ? 'Cash payment recorded. No ICAN wallet balance was changed.' : '',
    ].filter(Boolean).join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = `${receipt.receiptNumber}.txt`; link.click();
    URL.revokeObjectURL(url);
  };
  const receiptText = [
    'ICANERA DIGITAL RECEIPT',
    `Receipt: ${receipt.receiptNumber}`,
    `Amount: ${Number(receipt.amount).toLocaleString()} ${receipt.currency}`,
    `Method: ${receipt.paymentMethod === 'cash' ? 'Cash' : 'ICAN Wallet'}`,
    `Received by: ${receipt.recipientName || 'ICANera recipient'}`,
    `Payment code: ${receipt.paymentCode}`,
    `Transaction: ${receipt.transactionId || 'Recorded on ICAN ledger'}`,
    `Description: ${receipt.description || 'Payment'}`,
    `Date: ${new Date(receipt.issuedAt).toLocaleString()}`,
  ].join('\n');
  const saveAsPdf = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    printWindow.document.write(`<html><head><title>${escapeHtml(receipt.receiptNumber)}</title><style>body{font-family:Arial;padding:32px;white-space:pre-wrap;line-height:1.7}h1{font-size:22px}</style></head><body><h1>ICANERA DIGITAL RECEIPT</h1>${escapeHtml(receiptText.replace('ICANERA DIGITAL RECEIPT\n', '')).replace(/\n/g, '<br>')}</body></html>`);
    printWindow.document.close();
    printWindow.opener = null;
    printWindow.focus();
    printWindow.print();
  };
  const shareReceipt = async () => {
    if (navigator.share) {
      await navigator.share({ title: 'ICANera receipt', text: receiptText });
      return;
    }
    await navigator.clipboard?.writeText(receiptText);
  };
  return (
    <div className="fixed inset-0 z-[210] flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-slate-900 shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl">✓</div>
          <h2 className="text-2xl font-bold">Payment completed</h2>
          <p className="text-sm text-slate-500">{receipt.paymentMethod === 'cash' ? 'Cash payment recorded successfully' : 'ICAN transaction recorded successfully'}</p>
        </div>
        <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between"><span>Receipt</span><strong>{receipt.receiptNumber}</strong></div>
          <div className="flex justify-between"><span>Amount</span><strong>{Number(receipt.amount).toLocaleString()} {receipt.currency}</strong></div>
          <div className="flex justify-between gap-4"><span>Received by</span><strong className="text-right">{receipt.recipientName || 'ICANera recipient'}</strong></div>
          <div className="flex justify-between"><span>Payment code</span><strong className="max-w-[190px] truncate">{receipt.paymentCode}</strong></div>
          <div className="flex justify-between"><span>Transaction</span><strong className="max-w-[190px] truncate">{receipt.transactionId || 'Recorded on ICAN ledger'}</strong></div>
          <div className="flex justify-between"><span>Time</span><strong>{new Date(receipt.issuedAt).toLocaleString()}</strong></div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={saveAsPdf} className="rounded-xl bg-slate-200 px-4 py-3 font-bold text-slate-800">Save as PDF</button>
          <button onClick={shareReceipt} className="rounded-xl bg-sky-600 px-4 py-3 font-bold text-white">Share</button>
          <button onClick={downloadReceipt} className="rounded-xl bg-slate-100 px-4 py-3 font-bold text-slate-800">Download text</button>
          <button onClick={onClose} className="rounded-xl bg-orange-500 px-4 py-3 font-bold text-white">Done</button>
        </div>
      </div>
    </div>
  );
}
