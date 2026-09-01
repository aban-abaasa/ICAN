/**
 * Dropship Reseller Service
 * Thin wrapper around the RPCs in backend/DROPSHIP_RESELLER_SYSTEM.sql.
 * A dropshipper picks products from any store, lists them at their own
 * price, and dropship_checkout() fulfills from the source store's real
 * inventory, pays the store its real wholesale amount, and pays the
 * reseller their markup — all via the ICANera wallet.
 */

import { supabase } from '../lib/supabase';

// Products a reseller can list, across every store, with their own listing status.
export async function getDropshippableProducts(resellerBusinessProfileId, { query = '', limit = 40, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc('get_dropshippable_products', {
    p_reseller_business_profile_id: resellerBusinessProfileId,
    p_query: query,
    p_limit: limit,
    p_offset: offset,
  });
  return { data: data || [], error };
}

// A reseller's public storefront — no auth required, safe to call for anonymous visitors.
export async function getDropshipStorefront(resellerBusinessProfileId) {
  const { data, error } = await supabase.rpc('get_dropship_storefront', {
    p_reseller_business_profile_id: resellerBusinessProfileId,
  });
  return { data: data || [], error };
}

// List, re-price, or unlist (is_active=false) a product on the reseller's storefront.
export async function setDropshipListing(resellerBusinessProfileId, productId, listedPrice, isActive = true) {
  const { data, error } = await supabase.rpc('dropship_set_listing', {
    p_reseller_business_profile_id: resellerBusinessProfileId,
    p_product_id: productId,
    p_listed_price: listedPrice,
    p_is_active: isActive,
  });
  return { data, error };
}

// Atomic checkout: decrements real store stock, pays the store + reseller via
// transfer_ican(), and returns both the customer and store receipt numbers.
export async function dropshipCheckout(resellerBusinessProfileId, cart, { customerName, customerPhone, deliveryAddress, storeLocation } = {}) {
  const { data, error } = await supabase.rpc('dropship_checkout', {
    p_reseller_business_profile_id: resellerBusinessProfileId,
    p_cart: cart,
    p_customer_name: customerName || null,
    p_customer_phone: customerPhone || null,
    p_delivery_address: deliveryAddress || null,
    p_store_location: storeLocation || null,
  });
  return { data, error };
}

// A reseller's own settlement history (their margin on every dropship sale).
export async function getResellerDropshipSales(resellerBusinessProfileId) {
  const { data, error } = await supabase.rpc('get_reseller_dropship_sales', {
    p_reseller_business_profile_id: resellerBusinessProfileId,
  });
  return { data: data || [], error };
}

// A store owner's settlement history (their real wholesale revenue from resellers).
export async function getStoreDropshipSales(supermarketId) {
  const { data, error } = await supabase.rpc('get_store_dropship_sales', {
    p_supermarket_id: supermarketId,
  });
  return { data: data || [], error };
}
