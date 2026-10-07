/**
 * Public QR on every recorded transaction (see backend/ADD_PUBLIC_TRANSACTION_QR.sql).
 *
 * The QR printed on a receipt opens https://icanera.space/r/<code>. Anyone can read the receipt
 * there; if the owner switched payment on, the same page takes payment — Mobile Money / card /
 * bank with no account (Flutterwave + the public-tx-pay Edge Function), or the IcanEra wallet.
 * The amount, the recipient and the fee always come from the server; the browser only ever sends
 * the code and the payer's own name and phone.
 *
 * The same QR works the other way for a money-out entry: the client can scan it to RECEIVE the money
 * from the business wallet (see the receive functions below).
 */

import { supabase } from '../lib/supabase/client';
import { payWithFlutterwave } from './flutterwaveClient';

// A printed QR must open the real site, whatever build the owner printed it from.
const PUBLIC_SITE_ORIGIN = 'https://icanera.space';
const PENDING_KEY = 'icanera_public_tx_pending';

export const buildPublicReceiptLink = (code) => `${PUBLIC_SITE_ORIGIN}/r/${code}`;

const readPending = () => {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
};
const writePending = (value) => {
  try {
    if (value) localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* private mode — resume just won't be available */ }
};

// ── Visitor side (no account) ───────────────────────────────────────────────

/** The public receipt for a code: { found, receipt_number, amount, issuer_name, payable, ... }. */
export async function getPublicReceipt(code) {
  const { data, error } = await supabase.rpc('public_tx_receipt', { p_code: code });
  if (error) throw new Error(error.message || 'Could not load this receipt');
  return data;
}

/** Ask the server to verify the Flutterwave payment and close the entry. */
export async function completePublicPayment(txRef, transactionId) {
  const { data, error } = await supabase.functions.invoke('public-tx-pay', {
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
 * Mobile Money / card / bank, no account: create the pending payment, take it, confirm it.
 * Resolves the server's receipt data.
 */
export async function payPublicReceipt({ code, name, phone, issuerName = 'IcanEra receipt', expectedCharge = null }) {
  const { data: start, error } = await supabase.rpc('public_tx_pay_start', {
    p_code: code, p_payer_name: name, p_payer_phone: phone, p_dry_run: false,
  });
  if (error) throw new Error(error.message || 'Could not start this payment');
  if (!start?.success) throw new Error(start?.error || 'Could not start this payment');
  if (expectedCharge != null && Number(start.charge_ugx) !== Number(expectedCharge)) {
    const err = new Error('The amount just changed — please check the new total and tap Pay again. You have not been charged.');
    err.priceChanged = true;
    throw err;
  }

  writePending({ txRef: start.tx_ref, code });
  let payment;
  try {
    payment = await payWithFlutterwave({
      amount: Number(start.charge_ugx),
      txRef: start.tx_ref,
      customerName: name,
      customerPhone: phone,
      title: issuerName,
      description: `Payment to ${issuerName}`,
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
    const result = await completePublicPayment(start.tx_ref, payment.transaction_id);
    writePending(null);
    return result;
  } catch (err) {
    if (!err.retryable) writePending(null);
    throw err;
  }
}

/** Paid but closed the tab before it was confirmed? Finish it on the next visit to the same receipt. */
export async function resumePendingPublicPayment(code) {
  const pending = readPending();
  if (!pending?.txRef || pending.code !== code) return null;
  try {
    const result = await completePublicPayment(pending.txRef, null);
    writePending(null);
    return result;
  } catch (err) {
    if (!err.retryable) writePending(null);
    return null;
  }
}

/** Signed-in visitor: pay from the IcanEra wallet (no processing fee). */
export async function payPublicReceiptWithWallet(code) {
  const { data, error } = await supabase.rpc('public_tx_pay_wallet', { p_code: code });
  if (error) throw new Error(error.message || 'Could not complete this payment');
  if (!data?.success) throw new Error(data?.error || 'Could not complete this payment');
  return data;
}

// ── Receive money from the business (backend/ADD_PUBLIC_TRANSACTION_QR_RECEIVE.sql) ──
// A money-out entry's QR can also PAY the client: the owner (or finance) switches it on, the client
// signs in and the amount moves from the business wallet to their IcanEra wallet, once.

/** What a scan says about receiving: { found, receivable, received, amount_ugx, expires_at }. */
export async function getPublicReceiveInfo(code) {
  const { data, error } = await supabase.rpc('public_tx_receive_info', { p_code: code });
  if (error) return { found: false };
  return data || { found: false };
}

/** Signed-in client: take the money from the business wallet into their IcanEra wallet. */
export async function receivePublicReceiptWithWallet(code) {
  const { data, error } = await supabase.rpc('public_tx_receive_wallet', { p_code: code });
  if (error) throw new Error(error.message || 'Could not complete this payout');
  if (!data?.success) throw new Error(data?.error || 'Could not complete this payout');
  return data;
}

/** Owner side: whether this entry's QR can pay the client, and what has happened. */
export async function getTransactionReceiveState(transactionId) {
  const { data, error } = await supabase.rpc('public_tx_receive_state', { p_tx_id: transactionId });
  if (error) throw new Error(error.message || 'Could not load the payout setting');
  if (!data?.success) throw new Error(data?.error || 'Could not load the payout setting');
  return data;
}

/** Owner side: switch "let the client receive this by scanning" on (valid 7 days) or off. */
export async function setTransactionPublicReceive(transactionId, enable) {
  const { data, error } = await supabase.rpc('public_tx_set_receive', { p_tx_id: transactionId, p_enable: !!enable });
  if (error) throw new Error(error.message || 'Could not update the payout setting');
  if (!data?.success) throw new Error(data?.error || 'Could not update the payout setting');
  return data;
}

// ── Receive from a business: a client asks on the business website, an owner approves ──
// (backend/ADD_BUSINESS_RECEIVE_REQUESTS.sql). Nothing is paid until an owner / co-owner approves with the
// business-wallet PIN; then the amount goes from the business wallet to the client's IcanEra wallet.

/** Website side: does this business take requests? { found, max_ugx, min_ugx, issuer_name } */
export async function getReceiveInfoForBusiness(businessProfileId) {
  if (!businessProfileId) return { found: false };
  const { data, error } = await supabase.rpc('public_receive_info_by_business', { p_business: businessProfileId });
  if (error) return { found: false }; // SQL not installed yet -> no Receive side
  return data || { found: false };
}

/** Client (signed in): ask the business for money. Resolves the new request. */
export async function submitReceiveRequest({ businessProfileId, amount, note, name = null, phone = null }) {
  const { data, error } = await supabase.rpc('public_receive_submit', {
    p_business: businessProfileId, p_amount: amount, p_note: note, p_name: name, p_phone: phone,
  });
  if (error) throw new Error(error.message || 'Could not send your request');
  if (!data?.success) throw new Error(data?.error || 'Could not send your request');
  return data.request;
}

/** The requester (or an owner / co-owner) reads one request: status pending | paid | declined | expired. */
export async function getReceiveRequest(id) {
  const { data, error } = await supabase.rpc('public_receive_get', { p_id: id });
  if (error) throw new Error(error.message || 'Could not load this request');
  if (!data?.success) throw new Error(data?.error || 'Could not load this request');
  return data.request;
}

/** Owner / co-owner: approve (with the business-wallet PIN) or reject. Resolves the updated request. */
export async function decideReceiveRequest(id, approve, { pin = null, note = null } = {}) {
  const { data, error } = await supabase.rpc('public_receive_decide', { p_id: id, p_approve: !!approve, p_pin: pin, p_note: note });
  if (error) throw new Error(error.message || 'Could not record your decision');
  if (!data?.success) throw new Error(data?.message || 'Could not record your decision');
  return data.request;
}

/** Business team: current setting; an owner / co-owner can change it (enabled, biggest request in UGX). */
export async function getReceiveSettings(businessProfileId) {
  const { data, error } = await supabase.rpc('public_receive_settings', { p_business: businessProfileId });
  if (error) throw new Error(error.message || 'Could not load the setting');
  if (!data?.success) throw new Error(data?.error || 'Could not load the setting');
  return data;
}

export async function updateReceiveSettings(businessProfileId, { enabled = null, maxUgx = null } = {}) {
  const { data, error } = await supabase.rpc('public_receive_settings', { p_business: businessProfileId, p_enabled: enabled, p_max: maxUgx });
  if (error) throw new Error(error.message || 'Could not save');
  if (!data?.success) throw new Error(data?.error || 'Could not save');
  return data;
}

// ── Owner side (signed in) ──────────────────────────────────────────────────

/** The public code + payment state of one of the owner's ledger entries. */
export async function getTransactionPublicLink(transactionId) {
  const { data, error } = await supabase.rpc('public_tx_get_link', { p_tx_id: transactionId });
  if (error) throw new Error(error.message || 'Could not load the public link');
  if (!data?.success) throw new Error(data?.error || 'Could not load the public link');
  return data;
}

// ── QR Pay tab: bill by QR before the money arrives ─────────────────────────
// A QR bill is not a ledger row. It becomes the real income entry the moment it is paid (cash
// confirmed here, IcanEra wallet, or Mobile Money / card / bank), so reports never count unpaid money.

const unwrapRequest = (data, fallback) => {
  if (!data?.success) throw new Error(data?.error || fallback);
  return data.request;
};

/** Make a QR bill. `meta` is the entry form's bookkeeping (category, accounting type, item...). */
export async function createPaymentRequest({ amount, description, businessProfileId = null, meta = {}, requireApproval = true }) {
  const { data, error } = await supabase.rpc('public_tx_request_create', {
    p_amount: amount, p_description: description, p_business_profile_id: businessProfileId, p_meta: meta,
    p_require_approval: requireApproval,
  });
  if (error) throw new Error(error.message || 'Could not create the QR');
  return unwrapRequest(data, 'Could not create the QR');
}

/** Current state of one QR bill (poll this to notice a payment). */
export async function getPaymentRequest(id) {
  const { data, error } = await supabase.rpc('public_tx_request_get', { p_id: id });
  if (error) throw new Error(error.message || 'Could not load the QR bill');
  return unwrapRequest(data, 'Could not load the QR bill');
}

/** Recent QR bills (own and the businesses the user owns or co-owns). */
export async function listPaymentRequests(limit = 20) {
  const { data, error } = await supabase.rpc('public_tx_request_list', { p_limit: limit });
  if (error) throw new Error(error.message || 'Could not load the QR bills');
  return Array.isArray(data) ? data : [];
}

/** The customer handed over cash: record the sale now. */
export async function markPaymentRequestCash(id, payerName = null) {
  const { data, error } = await supabase.rpc('public_tx_request_mark_cash', { p_id: id, p_payer_name: payerName });
  if (error) throw new Error(error.message || 'Could not record the cash payment');
  return unwrapRequest(data, 'Could not record the cash payment');
}

/**
 * An authorised person approves or rejects the payment waiting on a QR bill (from the notification).
 * Approve records the sale. Reject returns the money: wallet coins straight away; for a Mobile Money /
 * card / bank payment the Flutterwave refund is sent right after. Resolves { request, refund }.
 */
export async function decidePaymentRequest(id, approve, note = null) {
  const { data, error } = await supabase.rpc('public_tx_request_decide', { p_id: id, p_approve: !!approve, p_note: note });
  if (error) throw new Error(error.message || 'Could not record your decision');
  if (!data?.success) throw new Error(data?.error || 'Could not record your decision');
  let refund = null;
  if (data.refund_required) {
    try {
      const out = await supabase.functions.invoke('public-tx-pay', { body: { action: 'refund', request_id: id } });
      refund = out.data || { success: false, error: out.error?.message };
    } catch (err) {
      refund = { success: false, error: err.message };
    }
  }
  return { request: data.request, refund };
}

/** Customer (no account): "I paid cash" — an authorised person is notified to confirm it. */
export async function claimCashPayment(code, name, phone = null) {
  const { data, error } = await supabase.rpc('public_tx_request_claim_cash', { p_code: code, p_payer_name: name, p_payer_phone: phone });
  if (error) throw new Error(error.message || 'Could not send your payment');
  if (!data?.success) throw new Error(data?.error || 'Could not send your payment');
  return data;
}

export async function cancelPaymentRequest(id) {
  const { data, error } = await supabase.rpc('public_tx_request_cancel', { p_id: id });
  if (error) throw new Error(error.message || 'Could not cancel the QR bill');
  return unwrapRequest(data, 'Could not cancel the QR bill');
}

/** Switch "let the customer pay by scanning" on or off. */
export async function setTransactionPublicPay(transactionId, enable) {
  const { data, error } = await supabase.rpc('public_tx_set_pay', { p_tx_id: transactionId, p_enable: !!enable });
  if (error) throw new Error(error.message || 'Could not update the payment setting');
  if (!data?.success) throw new Error(data?.error || 'Could not update the payment setting');
  return data;
}

// ── Standing pay QR: printed once, the customer enters any amount ────────────

/**
 * The link a standing pay QR points at: the business's OWN public website (Pay tab) when it has one,
 * otherwise the small standalone /p/<code> page. Pass the paycode object the owner API returns.
 */
export const buildPayCodeLink = (paycode) => (paycode?.company_id
  ? `${PUBLIC_SITE_ORIGIN}/notices/${paycode.company_id}?pay=1`
  : `${PUBLIC_SITE_ORIGIN}/p/${paycode?.code}`);

/** Website side: does this business take pay-any-amount payments? (decides whether the Pay tab shows) */
export async function getPayCodeInfoForBusiness(businessProfileId) {
  if (!businessProfileId) return { found: false };
  const { data, error } = await supabase.rpc('public_tx_paycode_info_by_business', { p_business: businessProfileId });
  if (error) return { found: false };
  return data || { found: false };
}

/** Customer side: what the standing QR says (business name, switched on?, biggest amount). */
export async function getPayCodeInfo(code) {
  const { data, error } = await supabase.rpc('public_tx_paycode_info', { p_code: code });
  if (error) throw new Error(error.message || 'Could not load this pay link');
  return data;
}

/**
 * Customer side: turn "what I am paying for" into a QR bill. items = [{ name, price, qty }].
 * Resolves the new bill's code — the customer then pays it on /r/<code>.
 */
export async function createBillFromPayCode({ code, items, name }) {
  const { data, error } = await supabase.rpc('public_tx_paycode_bill', { p_code: code, p_items: items, p_name: name });
  if (error) throw new Error(error.message || 'Could not start this payment');
  if (!data?.success) throw new Error(data?.error || 'Could not start this payment');
  return data;
}

/** Owner side: the standing QR of a business (or the personal one when businessId is null). */
export async function getMyPayCode(businessId = null) {
  const { data, error } = await supabase.rpc('public_tx_paycode_get_or_create', { p_business: businessId });
  if (error) throw new Error(error.message || 'Could not load your pay QR');
  if (!data?.success) throw new Error(data?.error || 'Could not load your pay QR');
  return data.paycode;
}

/** Owner side: switch it off/on, approval on/off, rename, cap the amount. */
export async function updateMyPayCode(id, { active = null, approvalRequired = null, title = null, maxAmount = null } = {}) {
  const { data, error } = await supabase.rpc('public_tx_paycode_update', {
    p_id: id, p_active: active, p_approval: approvalRequired, p_title: title, p_max: maxAmount,
  });
  if (error) throw new Error(error.message || 'Could not update your pay QR');
  if (!data?.success) throw new Error(data?.error || 'Could not update your pay QR');
  return data.paycode;
}
