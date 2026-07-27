import { getSupabaseClient } from '../lib/supabase/client';
import { sendICAN } from './icanWalletService';

const supabase = getSupabaseClient();

export function parseIcanPayCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.toUpperCase().startsWith('ICANPAY:')) return raw.slice(raw.indexOf(':') + 1).trim();
  if (raw.toUpperCase().startsWith('ICANPAY_')) return raw;
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

export async function payIcanRequest({ paymentCode, payerUserId }) {
  if (!payerUserId) throw new Error('You must be signed in to pay');
  const request = await getIcanPaymentRequest(paymentCode);
  if (request.user_id === payerUserId) throw new Error('You cannot pay your own request');
  const amount = Number(request.amount);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid payment amount');

  const transfer = await sendICAN({
    fromUserId: payerUserId,
    toUserId: request.user_id,
    amount,
    note: request.description || ('Payment request ' + paymentCode),
    referenceId: request.id,
  });

  const { data: completed, error } = await supabase.from('payment_requests')
    .update({
      status: 'completed',
      payer_user_id: payerUserId,
      ican_tx_id: transfer.out_tx_id || transfer.transaction_id || null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', request.id).eq('status', 'pending').select('*').maybeSingle();

  if (error) throw error;
  if (!completed) throw new Error('Transfer completed, but the payment request could not be marked completed');
  return { request: completed, transfer };
}

export default { parseIcanPayCode, getIcanPaymentRequest, payIcanRequest };
