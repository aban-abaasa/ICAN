/**
 * Guest checkout — pay a dropship / business-website order with Mobile Money,
 * card or bank (Flutterwave) without an IcanEra wallet.
 * Thin wrapper around guest_checkout_start() and the guest-checkout-pay Edge
 * Function (see backend/ADD_GUEST_CHECKOUT_MOBILE_MONEY.sql). The price always
 * comes from the server; the browser only ever sends the cart and delivery
 * details.
 */

import { supabase } from '../lib/supabase/client';
import { payWithFlutterwave } from './flutterwaveClient';

const PENDING_KEY = 'icanera_guest_checkout_pending';

const readPending = () => {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; }
};
const writePending = (value) => {
  try {
    if (value) localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* private mode — resume just won't be available */ }
};

const toPayload = (p) => ({
  p_reseller_business_profile_id: p.businessProfileId,
  p_cart: p.cart,
  p_customer_name: p.customerName || null,
  p_customer_phone: p.customerPhone || null,
  p_delivery_address: p.deliveryAddress || null,
  p_delivery_lat: p.deliveryLat ?? null,
  p_delivery_lng: p.deliveryLng ?? null,
  p_max_delivery_hours: p.maxDeliveryHours ?? null,
  p_vehicle_types: p.vehicleTypes && p.vehicleTypes.length ? p.vehicleTypes : null,
});

// Price an order for a guest without creating anything. Returns the same
// breakdown the real payment will use: items, delivery, processing fee, charge.
export async function quoteGuestCheckout(params) {
  const { data, error } = await supabase.rpc('guest_checkout_start', { ...toPayload(params), p_dry_run: true });
  if (error) throw new Error(error.message || 'Could not price this order');
  if (!data?.success) throw new Error(data?.error || 'Could not price this order');
  return data;
}

// Ask the server to verify the Flutterwave payment and place the order.
// Throws an Error with .retryable = true when the server could not be reached
// at all (the payment may well have gone through — the caller keeps the order
// reference so it can be retried).
export async function completeGuestCheckout(txRef, transactionId) {
  const { data, error } = await supabase.functions.invoke('guest-checkout-pay', {
    body: { tx_ref: txRef, transaction_id: transactionId || null },
  });
  if (error) {
    let body = null;
    try { body = await error.context.json(); } catch { /* no body — network failure */ }
    const err = new Error(body?.error || 'We could not reach the server to confirm your payment. Check your connection and reopen this page — your order is saved.');
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

// Full guest flow: create the pending order, take payment, confirm it.
// If the quote has moved since the customer last saw it (a different rider
// became the nearest), nothing is charged — resolves { priceChanged: true, quote }.
export async function payAsGuest(params, { expectedCharge = null, storeName = 'IcanEra order' } = {}) {
  const { data: start, error } = await supabase.rpc('guest_checkout_start', { ...toPayload(params), p_dry_run: false });
  if (error) throw new Error(error.message || 'Could not start this order');
  if (!start?.success) throw new Error(start?.error || 'Could not start this order');

  if (expectedCharge != null && Number(start.charge_ugx) !== Number(expectedCharge)) {
    return { priceChanged: true, quote: start };
  }

  writePending({ txRef: start.tx_ref, businessProfileId: params.businessProfileId });
  let payment;
  try {
    payment = await payWithFlutterwave({
      amount: Number(start.charge_ugx),
      txRef: start.tx_ref,
      customerName: params.customerName,
      customerPhone: params.customerPhone,
      title: storeName,
      description: `Order from ${storeName}`,
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
    const result = await completeGuestCheckout(start.tx_ref, payment.transaction_id);
    writePending(null);
    return { result };
  } catch (err) {
    if (!err.retryable) writePending(null);
    throw err;
  }
}

// If the guest paid but closed the tab before the order was confirmed, finish
// it on their next visit. Resolves the receipt, or null when there is nothing
// to resume (or it can't be resumed).
export async function resumePendingGuestCheckout(businessProfileId) {
  const pending = readPending();
  if (!pending?.txRef || pending.businessProfileId !== businessProfileId) return null;
  try {
    const result = await completeGuestCheckout(pending.txRef, null);
    writePending(null);
    return result;
  } catch (err) {
    if (!err.retryable) writePending(null);
    return null;
  }
}
