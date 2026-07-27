import React from 'react';

export default function IcanPaymentReceiptModal({ receipt, onClose }) {
  if (!receipt) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-slate-900 shadow-2xl">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-3xl">✓</div>
          <h2 className="text-2xl font-bold">Payment completed</h2>
          <p className="text-sm text-slate-500">ICAN transaction recorded successfully</p>
        </div>
        <div className="space-y-3 rounded-xl bg-slate-50 p-4 text-sm">
          <div className="flex justify-between"><span>Receipt</span><strong>{receipt.receiptNumber}</strong></div>
          <div className="flex justify-between"><span>Amount</span><strong>{Number(receipt.amount).toLocaleString()} {receipt.currency}</strong></div>
          <div className="flex justify-between"><span>Payment code</span><strong className="max-w-[190px] truncate">{receipt.paymentCode}</strong></div>
          <div className="flex justify-between"><span>Transaction</span><strong className="max-w-[190px] truncate">{receipt.transactionId || 'Recorded on ICAN ledger'}</strong></div>
          <div className="flex justify-between"><span>Time</span><strong>{new Date(receipt.issuedAt).toLocaleString()}</strong></div>
        </div>
        <button onClick={onClose} className="mt-5 w-full rounded-xl bg-orange-500 px-4 py-3 font-bold text-white">
          Done
        </button>
      </div>
    </div>
  );
}
