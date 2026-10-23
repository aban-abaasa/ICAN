/**
 * Delivery on a business website's own store products.
 * Thin wrapper around the RPCs in supabase/migrations/20261113100000_site_delivery.sql.
 *
 * The delivery itself is dropship's: the same rider matching, the real BodaGoEra fare, the delivery window, payment held until the
 * rider scans the order out of the store. These calls only let a STORE product ride that machinery - nothing is ever listed.
 * The delivery fee is never a number the browser sends.
 */

import { supabase } from '../lib/supabase/client';
import { hashPIN } from './walletAccountService';
import { normalizeStorefront } from '../utils/siteDelivery';

// ── Website (visitors) ───────────────────────────────────────────────────────

/** What the business offers for delivery: { enabled, guestOk, store, listings }. Never throws - on any trouble nothing is on offer. */
export async function getSiteDeliveryStorefront(businessProfileId) {
  if (!businessProfileId) return normalizeStorefront(null);
  try {
    const { data, error } = await supabase.rpc('get_site_delivery_storefront', { p_business_profile_id: businessProfileId });
    return error ? normalizeStorefront(null) : normalizeStorefront(data);
  } catch {
    return normalizeStorefront(null);
  }
}

/** Riders for a delivery from the store, its own nearby riders first, each with the real fare. Signed-in customers only. */
export async function findSiteDeliveryRiders(businessProfileId, deliveryLat, deliveryLng, { limit = 8, vehicleTypes } = {}) {
  if (!businessProfileId || deliveryLat == null || deliveryLng == null) return { data: [], error: null };
  const { data, error } = await supabase.rpc('site_find_delivery_riders', {
    p_business_profile_id: businessProfileId,
    p_dropoff_lat: deliveryLat,
    p_dropoff_lng: deliveryLng,
    p_vehicle_types: vehicleTypes && vehicleTypes.length ? vehicleTypes : null,
    p_limit: limit,
  });
  return { data: data || [], error };
}

/**
 * Pay for a delivery order from the IcanEra wallet. Same arguments and same answer as dropshipCheckout() - it IS dropship's
 * checkout underneath - for a cart of store products ([{ product_id, quantity }]).
 */
export async function siteCheckout(businessProfileId, cart, { pin, customerName, customerPhone, deliveryAddress, storeLocation, deliveryLat, deliveryLng, maxDeliveryHours, riderId, vehicleTypes } = {}) {
  if (!pin) return { data: null, error: { message: 'Enter your wallet PIN to pay' } };
  const { data, error } = await supabase.rpc('site_checkout_with_pin', {
    p_pin_hash: hashPIN(String(pin)),
    p_business_profile_id: businessProfileId,
    p_cart: cart,
    p_customer_name: customerName || null,
    p_customer_phone: customerPhone || null,
    p_delivery_address: deliveryAddress || null,
    p_store_location: storeLocation || null,
    p_delivery_lat: deliveryLat ?? null,
    p_delivery_lng: deliveryLng ?? null,
    p_max_delivery_hours: maxDeliveryHours ?? null,
    p_rider_id: riderId || null,
    p_vehicle_types: vehicleTypes && vehicleTypes.length ? vehicleTypes : null,
  });
  return { data, error };
}

// ── CMMS (the company's team) ────────────────────────────────────────────────

const unwrap = (data, error, fallback) => {
  if (error) return { success: false, error: error.message || fallback };
  if (!data?.success) return { success: false, error: data?.error || fallback };
  return { success: true, data };
};

/** The checklist: is the store ready, is delivery on, which products can go. */
export async function getMySiteDelivery(companyId) {
  if (!companyId) return { success: false, error: 'companyId is required' };
  const { data, error } = await supabase.rpc('get_cmms_site_delivery', { p_company_id: companyId });
  return unwrap(data, error, 'Could not load the delivery settings');
}

/** Turn delivery on or off. The server refuses to turn it on until the store can really deliver, and says why. */
export async function setMySiteDelivery(companyId, enabled) {
  if (!companyId) return { success: false, error: 'companyId is required' };
  const { data, error } = await supabase.rpc('fn_set_cmms_site_delivery', { p_company_id: companyId, p_enabled: Boolean(enabled) });
  return unwrap(data, error, 'Could not save the delivery setting');
}
