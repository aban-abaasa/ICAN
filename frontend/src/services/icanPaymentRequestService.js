import { getSupabaseClient } from '../lib/supabase/client';
import { sendICAN } from './icanWalletService';

const supabase = getSupabaseClient();

export function parseIcanPayCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.toUpperCase().startsWith('ICANPAY:')) return raw.slice(raw.indexOf(':') + 1).trim();
  if (raw.toUpperCase().startsWith('ICANPAY_')) return raw;
  const linkMatch = raw.match(/\/pay\/(PAY_[A-Z0-9_]+)/i);
  if (linkMatch) return linkMatch[1];
  if (/^PAY_[A-Z0-9_]+$/i.test(raw)) return raw;
  return null;
}

export async function getIcanPaymentRequest(paymentCode) {
  const { data, error } = await supabase.from('payment_requests')
    .select('*').eq('payment_code', paymentCode).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Payment request not found or expired');
  if (data.status !== 'pending') throw new Error('Payment request is already ' + data.status);
  if (!data.user_id) throw new Error('Payment request has no recipient wallet');
  return data;
}

export async function payIcanRequest({
  paymentCode,
  payerUserId,
  expenseClassification = 'personal_expense',
  counterpartyType = 'business',
  businessProfileId = null,
}) {
  if (!payerUserId) throw new Error('You must be signed in to pay');
  const request = await getIcanPaymentRequest(paymentCode);
  if (request.user_id === payerUserId) throw new Error('You cannot pay your own request');
  const amount = Number(request.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid payment amount');

  if (request.payment_method === 'cash') {
    const { data, error } = await supabase.rpc('record_cash_payment_request', {
      p_payment_code: paymentCode,
      p_expense_classification: expenseClassification,
      p_business_profile_id: businessProfileId,
    });
    if (error) throw error;
    const receipt = Array.isArray(data) ? data[0] : data;
    if (!receipt?.success) throw new Error(receipt?.message || 'Unable to record this cash payment');
    const { data: authData } = await supabase.auth.getUser();
    const payerReceipt = {
      receiptNumber: receipt.receipt_number, paymentCode, transactionId: receipt.cash_transaction_id,
      amount, currency: request.currency, payerUserId, recipientUserId: request.user_id,
      issuedAt: receipt.recorded_at || new Date().toISOString(), description: request.description || 'Cash payment',
       recipientName: receipt.recipient_name || 'IcanEra recipient',
       payerName: receipt.payer_name || authData?.user?.user_metadata?.full_name || authData?.user?.email || 'You',
       recipientClassification: request.recipient_classification || 'personal',
       paymentMethod: 'cash',
    };
    try { const stored = JSON.parse(localStorage.getItem('ican_payment_receipts') || '[]'); localStorage.setItem('ican_payment_receipts', JSON.stringify([payerReceipt, ...stored].slice(0, 100))); } catch (_) {}
    return { request: { ...request, status: 'completed' }, transfer: null, payerReceipt };
  }

  const transfer = await sendICAN({
    fromUserId: payerUserId,
    toUserId: request.user_id,
    amount,
    note: request.description || ('Payment request ' + paymentCode),
    referenceId: request.id,
    localAmount: request.local_amount || request.amount_local || null,
    localCurrency: request.local_currency || 'UGX',
    merchantName: request.merchant_name || null,
    counterpartyType,
    expenseClassification,
    businessProfileId,
  });
  const payerReceipt = {
    receiptNumber: 'IcanEra-RCP-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
    paymentCode,
    transactionId: transfer.out_tx_id || transfer.transaction_id || null,
    amount,
    currency: request.currency || 'IcanEra',
    payerUserId,
    recipientUserId: request.user_id,
    issuedAt: new Date().toISOString(),
    description: request.description || 'IcanEra QR payment',
  };

  const completion = {
    status: 'completed',
    payer_user_id: payerUserId,
    ican_tx_id: transfer.out_tx_id || transfer.transaction_id || null,
    completed_at: new Date().toISOString(),
  };
  let { data: completed, error } = await supabase.from('payment_requests')
    .update(completion)
    .eq('id', request.id).eq('status', 'pending').select('*').maybeSingle();

  if (error?.message?.includes('ican_tx_id')) {
    ({ data: completed, error } = await supabase.from('payment_requests')
      .update({
        status: 'completed',
        payer_user_id: payerUserId,
        completed_at: completion.completed_at,
      })
      .eq('id', request.id).eq('status', 'pending').select('*').maybeSingle());
  }

  if (error) throw error;
  if (!completed) throw new Error('Transfer completed, but the payment request could not be marked completed');
  try {
    const stored = JSON.parse(localStorage.getItem('ican_payment_receipts') || '[]');
    localStorage.setItem('ican_payment_receipts', JSON.stringify([payerReceipt, ...stored].slice(0, 100)));
  } catch (_) {}

  return { request: completed, transfer, payerReceipt };
}

export default { parseIcanPayCode, getIcanPaymentRequest, payIcanRequest };
