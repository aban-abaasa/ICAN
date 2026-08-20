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
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-slate-900 shadow-2xl">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl">✓</div>
          <h2 className="text-2xl font-bold">Payment completed</h2>
          <p className="text-sm text-slate-500">{receipt.paymentMethod === 'cash' ? 'Cash payment recorded successfully' : 'ICAN transaction recorded successfully'}</p>
        </div>
        <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between"><span>Receipt</span><strong>{receipt.receiptNumber}</strong></div>
          <div className="flex justify-between"><span>Amount</span><strong>{Number(receipt.amount).toLocaleString()} {receipt.currency}</strong></div>
          <div className="flex justify-between"><span>Payment code</span><strong className="max-w-[190px] truncate">{receipt.paymentCode}</strong></div>
          <div className="flex justify-between"><span>Transaction</span><strong className="max-w-[190px] truncate">{receipt.transactionId || 'Recorded on ICAN ledger'}</strong></div>
          <div className="flex justify-between"><span>Time</span><strong>{new Date(receipt.issuedAt).toLocaleString()}</strong></div>
        </div>
        <div className="mt-5 flex gap-3">
          <button onClick={downloadReceipt} className="flex-1 rounded-xl bg-slate-200 px-4 py-3 font-bold text-slate-800">Download</button>
          <button onClick={onClose} className="flex-1 rounded-xl bg-orange-500 px-4 py-3 font-bold text-white">Done</button>
        </div>
      </div>
    </div>
  );
}
