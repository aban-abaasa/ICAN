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
// freeDelivery: when true, the customer never owes a delivery fee for this item.
export async function setDropshipListing(resellerBusinessProfileId, productId, listedPrice, isActive = true, freeDelivery = false) {
  const { data, error } = await supabase.rpc('dropship_set_listing', {
    p_reseller_business_profile_id: resellerBusinessProfileId,
    p_product_id: productId,
    p_listed_price: listedPrice,
    p_is_active: isActive,
    p_free_delivery: freeDelivery,
  });
  return { data, error };
}

// Atomic checkout: decrements real store stock, pays the store + reseller via
// transfer_ican(), and returns both the customer and store receipt numbers.
// deliveryFee is ignored (forced to 0) if every item in the cart is free_delivery.
export async function dropshipCheckout(resellerBusinessProfileId, cart, { customerName, customerPhone, deliveryAddress, storeLocation, deliveryFee } = {}) {
  const { data, error } = await supabase.rpc('dropship_checkout', {
    p_reseller_business_profile_id: resellerBusinessProfileId,
    p_cart: cart,
    p_customer_name: customerName || null,
    p_customer_phone: customerPhone || null,
    p_delivery_address: deliveryAddress || null,
    p_store_location: storeLocation || null,
    p_delivery_fee: deliveryFee || 0,
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

// Global cross-reseller product browse for ordinary users who don't run a
// storefront of their own -- one row per distinct product, grouped across
// every reseller currently listing it.
export async function getDropshipBrowseProducts({ query = '', limit = 40, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc('get_dropship_browsable_products', {
    p_query: query,
    p_limit: limit,
    p_offset: offset,
  });
  return { data: data || [], error };
}

// A single product's individual reseller offers (price, free delivery, stock),
// for the expanded row on the browse page.
export async function getDropshipProductOffers(productId) {
  const { data, error } = await supabase.rpc('get_dropship_product_offers', {
    p_product_id: productId,
  });
  return { data: data || [], error };
}

// Batched: which of these business_profile_ids currently have a live dropship
// storefront -- used to gate a "Buy Now" tag on Pitchin pitches.
export async function getBusinessStorefronts(businessProfileIds) {
  if (!businessProfileIds || businessProfileIds.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.rpc('get_business_storefronts', {
    p_business_profile_ids: businessProfileIds,
  });
  return { data: data || [], error };
}

// Batched: which of these users own a business with a live dropship storefront
// -- used to gate an "Order Now" tag on Status updates, which only carry user_id.
export async function getUserStorefronts(userIds) {
  if (!userIds || userIds.length === 0) return { data: [], error: null };
  const { data, error } = await supabase.rpc('get_user_storefronts', {
    p_user_ids: userIds,
  });
  return { data: data || [], error };
}
