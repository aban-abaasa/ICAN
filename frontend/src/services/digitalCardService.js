import { getSupabaseClient } from '../lib/supabase/client';
import { payWithFlutterwave } from './flutterwaveClient';

const supabase = getSupabaseClient();

export const cardQrUrl = (token) => `${window.location.origin}/card-pay/${token}`;

export async function getMyDigitalCard() {
  const { data, error } = await supabase.rpc('get_or_create_my_digital_card');
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function rotateMyCardQr() {
  const { data, error } = await supabase.rpc('rotate_my_card_qr');
  if (error) throw error;
  return data;
}

export async function setMyCardQrEnabled(enabled) {
  const { error } = await supabase.rpc('set_my_card_qr_enabled', { p_enabled: enabled });
  if (error) throw error;
}

export async function setMyCardPinPayEnabled(enabled) {
  const { error } = await supabase.rpc('set_my_card_pin_pay_enabled', { p_enabled: enabled });
  if (error) throw error;
}

// Public (no sign-in): the card owner types their PIN on the scanning device.
// The Edge Function verifies the PIN server-side before any money moves.
// destType: 'momo' (phone + network) | 'icanera' (phone = 16-digit account) | 'bank' (phone = account no.)
export async function payWithCardPin({ token, pin, phone, network, amount, note, destType = 'momo', bankCode, beneficiaryName }) {
  const { data, error } = await supabase.functions.invoke('card-pay-with-pin', {
    body: {
      token, pin, phone, network, amount, note: note || null,
      dest_type: destType, bank_code: bankCode || null, beneficiary_name: beneficiaryName || null,
    },
  });
  // Non-2xx responses carry the server's message in the response body.
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json())?.error || msg; } catch { /* keep default */ }
    throw new Error(msg);
  }
  if (!data?.success) throw new Error(data?.error || 'Payment failed');
  return data;
}

// Public: masked holder name ("Mary K.") for an IcanEra account number.
export async function getCardQrAccountName(token, accountNumber) {
  const { data, error } = await supabase.rpc('get_card_qr_account_name', { p_token: token, p_account_number: accountNumber });
  if (error) throw error;
  return data || null;
}

// Public: Uganda banks for the bank picker.
export async function listUgandaBanks() {
  const { data, error } = await supabase.functions.invoke('flutterwave-banks', { method: 'GET' });
  if (error || !data?.success) throw new Error('Could not load banks');
  // Flutterwave tags the mobile money networks as "bank" too; they have their own tab.
  return (data.banks || []).filter((b) => !/^(MTN|AIRTEL)\b/i.test(b.name || ''));
}

export async function listCardQrRequests(limit = 20) {
  const { data, error } = await supabase.from('ican_card_qr_requests')
    .select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function declineCardQrRequest(id) {
  const { error } = await supabase.rpc('decline_card_qr_request', { p_request_id: id });
  if (error) throw error;
}

export const claimCardQrRequest = async (id) => {
  const { data, error } = await supabase.rpc('claim_card_qr_request', { p_request_id: id });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
};

export async function finishCardQrRequest(id, ok, reference, reason) {
  const { error } = await supabase.rpc('finish_card_qr_request', {
    p_request_id: id, p_ok: ok, p_reference: reference || null, p_reason: reason || null,
  });
  if (error) throw error;
}

// Public (no sign-in) — used by the scan page.
export async function getCardQrInfo(token) {
  const { data, error } = await supabase.rpc('get_card_qr_info', { p_token: token });
  if (error) throw error;
  return (Array.isArray(data) ? data[0] : data) || null;
}

export async function submitCardQrRequest({ token, name, phone, network, amount, note }) {
  const { data, error } = await supabase.rpc('submit_card_qr_request', {
    p_token: token, p_name: name, p_phone: phone, p_network: network, p_amount: amount, p_note: note || null,
  });
  if (error) throw error;
  return data;
}

// ─── Pay the card holder with Flutterwave (backend/ADD_CARD_QR_FLUTTERWAVE_PAY.sql) ───────────────
// Personal and business cards alike: the scanner pays by Mobile Money / card / bank with no account. The
// amount, the holder and the fee are fixed by the server; the browser only sends the token, what the
// payer wants to pay and their own name and phone. The card-qr-pay Edge Function verifies the payment with
// Flutterwave before the holder is credited (and refunds it if it cannot be applied).

const CARD_PENDING_KEY = 'icanera_card_qr_pending';
const readPending = () => { try { return JSON.parse(localStorage.getItem(CARD_PENDING_KEY) || 'null'); } catch { return null; } };
const writePending = (v) => {
  try { if (v) localStorage.setItem(CARD_PENDING_KEY, JSON.stringify(v)); else localStorage.removeItem(CARD_PENDING_KEY); } catch { /* private mode */ }
};

/** What the scan page may offer: { found, kind: 'personal'|'business', holder_name, fee_pct, min_ugx, max_ugx }. */
export async function getCardPayInfo(token) {
  const { data, error } = await supabase.rpc('card_qr_pay_info', { p_token: token });
  if (error) return { found: false }; // SQL not installed yet -> the page just hides this option
  return data || { found: false };
}

/** Price an amount (nothing is stored): { amount_ugx, processing_fee_ugx, charge_ugx }. */
export async function quoteCardPayment(token, amount) {
  const { data, error } = await supabase.rpc('card_qr_pay_start', {
    p_token: token, p_amount: amount, p_payer_name: null, p_payer_phone: null, p_note: null, p_dry_run: true,
  });
  if (error) throw new Error(error.message || 'Could not price this payment');
  if (!data?.success) throw new Error(data?.error || 'Could not price this payment');
  return data;
}

async function completeCardPayment(txRef, transactionId) {
  const { data, error } = await supabase.functions.invoke('card-qr-pay', {
    body: { tx_ref: txRef, transaction_id: transactionId || null },
  });
  if (error) {
    let body = null;
    try { body = await error.context.json(); } catch { /* no body — network failure */ }
    const err = new Error(body?.error || 'We could not reach the server to confirm your payment. Check your connection and reopen this page — your payment is saved.');
    err.retryable = !body;
    throw err;
  }
  if (!data?.success) {
    const err = new Error(data?.error || 'Payment could not be confirmed');
    err.retryable = false;
    throw err;
  }
  return data;
}

/**
 * Pay the holder: store the pending payment, take it with Flutterwave, have the server confirm it.
 * Resolves { code (public receipt), amount_ugx, processing_fee_ugx, charged_ugx }.
 */
export async function payCardWithFlutterwave({ token, amount, name, phone, note, holderName = 'IcanEra card', expectedCharge = null, paymentOptions = null }) {
  const { data: start, error } = await supabase.rpc('card_qr_pay_start', {
    p_token: token, p_amount: amount, p_payer_name: name, p_payer_phone: phone, p_note: note || null, p_dry_run: false,
  });
  if (error) throw new Error(error.message || 'Could not start this payment');
  if (!start?.success) throw new Error(start?.error || 'Could not start this payment');
  if (expectedCharge != null && Number(start.charge_ugx) !== Number(expectedCharge)) {
    const err = new Error('The total just changed — please check it and tap Pay again. You have not been charged.');
    err.priceChanged = true;
    throw err;
  }

  writePending({ txRef: start.tx_ref, token });
  let payment;
  try {
    payment = await payWithFlutterwave({
      amount: Number(start.charge_ugx), txRef: start.tx_ref, customerName: name, customerPhone: phone,
      title: holderName, description: `Payment to ${holderName}`,
      ...(paymentOptions ? { paymentOptions } : {}),
    });
  } catch (err) {
    writePending(null);
    throw err;
  }
  if (payment.status !== 'successful') {
    writePending(null);
    throw new Error(payment.status === 'cancelled' ? 'Payment cancelled — you have not been charged.' : 'The payment did not go through. You have not been charged.');
  }
  try {
    const result = await completeCardPayment(start.tx_ref, payment.transaction_id);
    writePending(null);
    return result;
  } catch (err) {
    if (!err.retryable) writePending(null);
    throw err;
  }
}

// ─── Pay the card holder from an IcanEra wallet (backend/ADD_CARD_QR_WALLET_PAY.sql) ──────────────
// Signed-in payer, no processing fee, any country. The amount is in the PAYER'S OWN currency (the one their
// wallet shows); source 'local' = their wallet in that currency, 'ican' = ICAN coins. Both are priced at the live
// coin value on the server. The browser never sends a recipient or a price.

/**
 * The payer's currency, live coin price in it and balances: { currency, price_local, local_balance, ican_balance }.
 * With an amount (in their currency) it also prices it: { amount_local, ican_amount, amount_ugx } and refuses
 * amounts outside the allowed size. Pass amount = null for just the currency and balances.
 */
export async function quoteCardWalletPayment(token, amount = null) {
  const { data, error } = await supabase.rpc('card_qr_wallet_quote', { p_token: token, p_amount: amount });
  if (error) throw new Error(error.message || 'Could not price this payment');
  if (!data?.success) throw new Error(data?.error || 'Could not price this payment');
  return data;
}

/** Resolves { code (public receipt), currency, amount_local, amount_ugx, ican_amount, source }. */
export async function payCardWithWallet({ token, amount, source, note }) {
  const { data, error } = await supabase.rpc('card_qr_pay_wallet', {
    p_token: token, p_amount: amount, p_source: source, p_note: note || null,
  });
  if (error) throw new Error(error.message || 'Could not complete this payment');
  if (!data?.success) throw new Error(data?.error || 'Could not complete this payment');
  return data;
}

/** Paid but closed the tab before it was confirmed? Finish it on the next scan of the same card. */
export async function resumePendingCardPayment(token) {
  const pending = readPending();
  if (!pending?.txRef || pending.token !== token) return null;
  try {
    const result = await completeCardPayment(pending.txRef, null);
    writePending(null);
    return result;
  } catch (err) {
    if (!err.retryable) writePending(null);
    return null;
  }
}

// ─── Business cards ─────────────────────────────────────────────────────────
// Same card as a personal wallet's, one per business profile. Scans only ever
// leave a request; nothing is paid out. Approving needs the business-wallet PIN,
// which the database checks (5 wrong tries lock it for 15 minutes).

export async function getBusinessDigitalCard(businessProfileId) {
  const { data, error } = await supabase.rpc('get_or_create_business_digital_card', { p_business_profile_id: businessProfileId });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function rotateBusinessCardQr(businessProfileId) {
  const { data, error } = await supabase.rpc('rotate_business_card_qr', { p_business_profile_id: businessProfileId });
  if (error) throw error;
  return data;
}

export async function setBusinessCardQrEnabled(businessProfileId, enabled) {
  const { error } = await supabase.rpc('set_business_card_qr_enabled', { p_business_profile_id: businessProfileId, p_enabled: enabled });
  if (error) throw error;
}

export async function listBusinessCardQrRequests(businessProfileId, limit = 20) {
  const { data, error } = await supabase.from('ican_business_card_qr_requests')
    .select('*').eq('business_profile_id', businessProfileId).order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data || [];
}

export async function approveBusinessCardQrRequest(id, pin) {
  const { data, error } = await supabase.rpc('approve_business_card_qr_request', { p_request_id: id, p_pin: pin });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.message || 'Could not approve this request');
  return data;
}

export async function declineBusinessCardQrRequest(id) {
  const { error } = await supabase.rpc('decline_business_card_qr_request', { p_request_id: id });
  if (error) throw error;
}
