import { supabase } from '../lib/supabase/client';
import { normalizeStats } from '../utils/businessEngagement';

/**
 * Rate and subscribe to a business from its public website. Customers' ratings and subscriptions decide which
 * store's products every IcanEra app shows first (see fn_ranked_products_page in
 * 20261118100000_business_ratings_subscriptions_ranking.sql).
 *
 * Reading never throws: until that SQL is installed the website simply shows no ratings and hides the card.
 * Writing resolves { ok, stats?, error? } with a message safe to show to the customer.
 */

/** { available, stats }: available is false when the database functions are not installed (or the call failed). */
export const getBusinessSiteStats = async (businessProfileId) => {
  if (!businessProfileId) return { available: false, stats: normalizeStats(null) };
  try {
    const { data, error } = await supabase.rpc('fn_business_site_stats', { p_business_profile_id: businessProfileId });
    if (error || !data) return { available: false, stats: normalizeStats(null) };
    return { available: true, stats: normalizeStats(data) };
  } catch {
    return { available: false, stats: normalizeStats(null) };
  }
};

/** Recent written reviews, newest first: [{ rating, comment, createdAt }]. [] when none or not installed. */
export const getBusinessSiteReviews = async (businessProfileId, limit = 10) => {
  if (!businessProfileId) return [];
  try {
    const { data, error } = await supabase.rpc('fn_business_site_reviews', { p_business_profile_id: businessProfileId, p_limit: limit });
    if (error || !Array.isArray(data)) return [];
    return data.map((r) => ({ rating: Number(r.rating), comment: r.comment || '', createdAt: r.created_at }));
  } catch {
    return [];
  }
};

// PostgREST puts the database's RAISE EXCEPTION text in error.message ("You cannot rate your own business").
const run = async (fn, args) => {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return { ok: false, error: error.message || 'Something went wrong. Try again.' };
    return { ok: true, stats: normalizeStats(data) };
  } catch (e) {
    return { ok: false, error: e?.message || 'Something went wrong. Try again.' };
  }
};

export const rateBusiness = (businessProfileId, rating, comment = '') =>
  run('fn_rate_business', { p_business_profile_id: businessProfileId, p_rating: rating, p_comment: comment || null });

export const clearBusinessRating = (businessProfileId) =>
  run('fn_clear_business_rating', { p_business_profile_id: businessProfileId });

export const subscribeToBusiness = (businessProfileId) =>
  run('fn_subscribe_business', { p_business_profile_id: businessProfileId });

export const unsubscribeFromBusiness = (businessProfileId) =>
  run('fn_unsubscribe_business', { p_business_profile_id: businessProfileId });
