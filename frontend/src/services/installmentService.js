/**
 * Installment plans — pay for a storefront / business-website order in
 * instalments, then collect it or have it delivered once it is paid in full.
 * Thin wrapper around the RPCs in supabase/migrations/20261011100000_installment_orders.sql
 * and the installment-pay Edge Function. Every amount, fee and date comes from
 * the server; the browser only ever sends the cart, the chosen terms and the
 * amount the customer wants to pay now.
 *
 * Money held by a plan is the customer's until the goods are handed over, so
 * nothing here moves it anywhere but into (installment_create / pay) or back
 * out to their own wallet (cancel).
 */

import { supabase } from '../lib/supabase/client';
import { payWithFlutterwave } from './flutterwaveClient';

const PENDING_KEY = 'icanera_installment_pending';

const readPending = () => {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
};
const writePending = (value) => {
  try {
    if (value) localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* private mode — resume just won't be available */ }
};

const unwrap = (res, fallback) => {
  if (res.error) throw new Error(res.error.message || fallback);
  if (res.data && res.data.success === false) throw new Error(res.data.error || fallback);
  return res.data;
};

export const formatUGX = (amount) => `UGX ${Number(amount || 0).toLocaleString('en-UG', { maximumFractionDigits: 0 })}`;

// ── Before signing in ───────────────────────────────────────────────────────

export async function getInstallmentTerms() {
  const { data } = await supabase.rpc('installment_terms');
  return data || null;
}

/** Prices a cart for instalments: { success, eligible, items_ugx, min_deposit_ugx, lines, terms } (never throws). */
export async function quoteInstallments(businessProfileId, cart) {
  const { data, error } = await supabase.rpc('installment_quote', { p_reseller_business_profile_id: businessProfileId, p_cart: cart });
  if (error) return { success: false, error: error.message };
  return data;
}

/** Does this business let people create accounts (and so pay in instalments) on its website? */
export async function getBusinessSiteInfo(businessProfileId) {
  const { data, error } = await supabase.rpc('business_site_info', { p_business_profile_id: businessProfileId });
  if (error) return { found: false, accounts_enabled: false };
  return data || { found: false, accounts_enabled: false };
}

// ── Starting and paying a plan (signed in) ──────────────────────────────────

/** Reserve the items and take the deposit from the IcanEra wallet, or (payWith 'flutterwave') leave it awaiting a Mobile Money deposit. */
export async function createInstallmentPlan({ businessProfileId, cart, installments, frequencyDays, depositUgx, payWith = 'wallet', customerName = null, customerPhone = null }) {
  const res = await supabase.rpc('installment_create', {
    p_reseller_business_profile_id: businessProfileId,
    p_cart: cart,
    p_installments: installments,
    p_frequency_days: frequencyDays,
    p_deposit_ugx: depositUgx,
    p_pay_with: payWith,
    p_customer_name: customerName || null,
    p_customer_phone: customerPhone || null,
  });
  return unwrap(res, 'Could not start this plan');
}

export async function payInstallmentFromWallet(code, amountUgx) {
  return unwrap(await supabase.rpc('installment_pay_wallet', { p_code: code, p_amount_ugx: amountUgx }), 'Could not complete this payment');
}

/** Price a Mobile Money / card / bank payment without starting it: { charge_ugx, processing_fee_ugx, ... }. */
export async function quoteInstallmentCharge(code, amountUgx) {
  return unwrap(await supabase.rpc('installment_pay_start', { p_code: code, p_amount_ugx: amountUgx, p_dry_run: true }), 'Could not price this payment');
}

async function confirmFlutterwavePayment(txRef, transactionId) {
  const { data, error } = await supabase.functions.invoke('installment-pay', {
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
 * Mobile Money / card / bank: record the pending payment, take it with
 * Flutterwave, confirm it on the server. Resolves the server result.
 */
export async function payInstallmentWithFlutterwave(code, amountUgx, { name, phone, title = 'IcanEra instalment' } = {}) {
  const start = unwrap(await supabase.rpc('installment_pay_start', { p_code: code, p_amount_ugx: amountUgx, p_dry_run: false }), 'Could not start this payment');
  writePending({ txRef: start.tx_ref, code });
  let payment;
  try {
    payment = await payWithFlutterwave({
      amount: Number(start.charge_ugx),
      txRef: start.tx_ref,
      customerName: name,
      customerPhone: phone,
      title,
      description: `Instalment on plan ${code}`,
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
    const result = await confirmFlutterwavePayment(start.tx_ref, payment.transaction_id);
    writePending(null);
    return result;
  } catch (err) {
    if (!err.retryable) writePending(null);
    throw err;
  }
}

/** Paid but closed the tab before it was confirmed? Finish it on the next visit to the same plan. */
export async function resumePendingInstallmentPayment(code) {
  const pending = readPending();
  if (!pending?.txRef || pending.code !== code) return null;
  try {
    const result = await confirmFlutterwavePayment(pending.txRef, null);
    writePending(null);
    return result;
  } catch (err) {
    if (!err.retryable) writePending(null);
    return null;
  }
}

// ── Reading plans ───────────────────────────────────────────────────────────

/** { success, plan, terms } — the plan with schedule, payments and events. Visible to its customer and to the seller. */
export async function getInstallmentPlan(code) {
  const { data, error } = await supabase.rpc('installment_get', { p_code: code });
  if (error) throw new Error(error.message || 'Could not load this plan');
  return data;
}

export async function getMyInstallmentPlans() {
  const { data, error } = await supabase.rpc('installment_my_plans');
  if (error) throw new Error(error.message || 'Could not load your plans');
  return data || [];
}

// ── Collect or deliver ──────────────────────────────────────────────────────

export async function chooseInstallmentPickup(code) {
  return unwrap(await supabase.rpc('installment_choose_pickup', { p_code: code }), 'Could not arrange collection');
}

export async function quoteInstallmentDelivery(code, lat, lng, vehicleTypes = null) {
  return unwrap(await supabase.rpc('installment_delivery_quote', {
    p_code: code, p_lat: lat, p_lng: lng, p_vehicle_types: vehicleTypes && vehicleTypes.length ? vehicleTypes : null,
  }), 'Could not price this delivery');
}

export async function chooseInstallmentDelivery(code, { address, lat, lng, maxHours, vehicleTypes = null }) {
  return unwrap(await supabase.rpc('installment_choose_delivery', {
    p_code: code, p_address: address || null, p_lat: lat, p_lng: lng, p_max_hours: maxHours,
    p_vehicle_types: vehicleTypes && vehicleTypes.length ? vehicleTypes : null,
  }), 'Could not arrange delivery');
}

export async function clearInstallmentDelivery(code) {
  return unwrap(await supabase.rpc('installment_clear_delivery', { p_code: code }), 'Could not change delivery');
}

export async function cancelInstallmentPlan(code) {
  return unwrap(await supabase.rpc('installment_cancel', { p_code: code }), 'Could not cancel this plan');
}

// ── Business side ───────────────────────────────────────────────────────────

export async function getSellerInstallmentPlans(businessProfileId) {
  const { data, error } = await supabase.rpc('installment_seller_plans', { p_business_profile_id: businessProfileId });
  if (error) throw new Error(error.message || 'Could not load plans');
  return data || [];
}

export async function sellerCancelInstallmentPlan(code, reason = null) {
  return unwrap(await supabase.rpc('installment_seller_cancel', { p_code: code, p_reason: reason }), 'Could not cancel this plan');
}

export async function getBusinessSiteCustomers(businessProfileId) {
  const { data, error } = await supabase.rpc('business_site_customers_list', { p_business_profile_id: businessProfileId });
  if (error) throw new Error(error.message || 'Could not load customers');
  return data || [];
}

export async function setBusinessSiteAccounts(businessProfileId, enabled) {
  return unwrap(await supabase.rpc('business_site_set_accounts', { p_business_profile_id: businessProfileId, p_enabled: enabled }), 'Could not update this setting');
}

// ── Customer accounts on a business website ────────────────────────────────

/** Register the signed-in visitor as a customer of this business (idempotent). Never throws. */
export async function joinBusinessSite(businessProfileId, source = 'website') {
  try {
    const { data } = await supabase.rpc('business_site_join', { p_business_profile_id: businessProfileId, p_source: source });
    return !!data?.success;
  } catch {
    return false;
  }
}

/** The businesses the signed-in customer has an account with, and what they owe / have paid each. */
export async function getMyBusinessAccounts() {
  const { data, error } = await supabase.rpc('business_site_my_accounts');
  if (error) return [];
  return data || [];
}

// ── Helpers shared by the screens ───────────────────────────────────────────

export const FREQUENCY_LABELS = { 7: 'every week', 14: 'every 2 weeks', 30: 'every month' };

/** Preview of the schedule the server will build (same maths as _inst_schedule). */
export function previewSchedule({ itemsUgx, depositUgx, installments, frequencyDays, start = new Date() }) {
  const rest = itemsUgx - depositUgx;
  const per = Math.ceil(rest / installments / 100) * 100;
  const rows = [{ n: 0, amount: depositUgx, due: start }];
  for (let k = 1; k <= installments; k += 1) {
    const amount = k === installments ? rest - per * (installments - 1) : per;
    rows.push({ n: k, amount, due: new Date(start.getTime() + k * frequencyDays * 86400000) });
  }
  return rows;
}

export const STATUS_LABELS = {
  awaiting_deposit: 'Waiting for deposit',
  active: 'Paying',
  ready: 'Paid in full',
  pickup_ready: 'Ready to collect',
  dispatched: 'On its way',
  completed: 'Completed',
  cancelled: 'Cancelled',
  lapsed: 'Lapsed',
};
