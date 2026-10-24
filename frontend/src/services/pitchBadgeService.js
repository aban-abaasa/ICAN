import { supabase } from '../lib/supabase/client';
import { isMissingFunction } from '../utils/feedPolling';

/**
 * Product badges: the product name and price that appear over a PitchIn video or a status update (supabase/migrations/20261119100000_video_product_badges.sql).
 *
 * Viewing never throws and never blocks a video: until the SQL is installed (or if a call fails) a pitch simply shows no badges.
 * Managing resolves { ok, data?, error?, missing? }; `error` is the database's own message, written for the person ("Only the business
 * owner can pay for a badge...").
 *
 * The developer panel's side is { devServicePrices } at the bottom: it needs the panel's dev token AND the signed-in operator account.
 */

const CACHE_MS = 60 * 1000;
const cache = new Map(); // pitchId -> { at, value }

/** { badges: [...], siteCompanyId } for a pitch's viewers. Cached for a minute so scrolling a feed does not refetch. */
export const getPitchBadges = async (pitchId) => {
  const empty = { badges: [], siteCompanyId: null };
  if (!pitchId) return empty;
  const hit = cache.get(pitchId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  try {
    const { data, error } = await supabase.rpc('fn_get_pitch_badges', { p_pitch_id: pitchId });
    if (error || !data) return empty;
    const value = {
      badges: (Array.isArray(data.badges) ? data.badges : []).filter((b) => b && b.id && Number.isFinite(Number(b.starts_at_sec))),
      siteCompanyId: data.site_company_id || null,
    };
    cache.set(pitchId, { at: Date.now(), value });
    return value;
  } catch {
    return empty;
  }
};

/**
 * { badges, siteCompanyId, alwaysOn } for a status update's viewers. alwaysOn is true for a photo or text status, which has no timeline:
 * its badges stay on screen the whole time. Cached like the pitch ones.
 */
export const getStatusBadges = async (statusId) => {
  const empty = { badges: [], siteCompanyId: null, alwaysOn: false };
  if (!statusId) return empty;
  const key = `status:${statusId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  try {
    const { data, error } = await supabase.rpc('fn_get_status_badges', { p_status_id: statusId });
    if (error || !data) return empty;
    const value = {
      badges: (Array.isArray(data.badges) ? data.badges : []).filter((b) => b && b.id && Number.isFinite(Number(b.starts_at_sec))),
      siteCompanyId: data.site_company_id || null,
      alwaysOn: data.always_on === true,
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  } catch {
    return empty;
  }
};

/** Forget what was cached for a pitch or a status (after the owner changes its badges). */
export const forgetPitchBadges = (pitchId) => { cache.delete(pitchId); cache.delete(`status:${pitchId}`); };

const call = async (fn, args) => {
  try {
    const { data, error } = await supabase.rpc(fn, args);
    if (error) return isMissingFunction(error) ? { ok: false, missing: true, error: 'Product badges are not switched on yet.' } : { ok: false, error: error.message || 'Something went wrong. Try again.' };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: e?.message || 'Something went wrong. Try again.' };
  }
};

/** { price_ic, charged, days }: what publishing costs right now (price_ic 0 = free). */
export const getBadgePrice = async () => {
  const res = await call('fn_pitch_badge_price', {});
  return res.ok && res.data ? { price_ic: Number(res.data.price_ic) || 0, charged: !!res.data.charged, days: Number(res.data.days) || 30 } : { price_ic: 0, charged: false, days: 30 };
};

/** { video_duration_seconds, can_pay, price, badges } for the people who manage a pitch. */
export const listBadgesToManage = (pitchId) => call('fn_list_pitch_badges_manage', { p_pitch_id: pitchId });

/** What publishing a status badge costs right now: { price_ic, charged, days: 1 }. */
export const getStatusBadgePrice = async () => {
  const res = await call('fn_status_badge_price', {});
  return res.ok && res.data ? { price_ic: Number(res.data.price_ic) || 0, charged: !!res.data.charged, days: 1 } : { price_ic: 0, charged: false, days: 1 };
};

/** For the owner of a status: { media_type, always_on, expires_at, ended, price, can_pay, businesses: [{ id, name }], business_profile_id, badges }. */
export const listStatusBadgesToManage = (statusId) => call('fn_list_status_badges_manage', { p_status_id: statusId });

/** The business's store products, to pick from: [{ product_id, name, price, currency, image_url }]. */
export const listBadgeProducts = (businessProfileId) => call('fn_pitch_badge_products', { p_business_profile_id: businessProfileId });

export const saveBadge = async (args) => {
  const res = await call('fn_save_pitch_badge', args);
  if (res.ok) forgetPitchBadges(args.p_pitch_id);
  return res;
};

/** Create or edit a badge on the signed-in user's own status. */
export const saveStatusBadge = async (args) => {
  const res = await call('fn_save_status_badge', args);
  if (res.ok) forgetPitchBadges(args.p_status_id);
  return res;
};

export const deleteBadge = async (badgeId, pitchId) => {
  const res = await call('fn_delete_video_badge', { p_badge_id: badgeId });
  if (res.ok) forgetPitchBadges(pitchId);
  return res;
};

/** Publish or renew. The data is { success, error?, paid_ic, live_until, badge } (a refusal for money reasons comes back as success: false). */
export const publishBadge = async (badgeId, pitchId) => {
  const res = await call('fn_publish_video_badge', { p_badge_id: badgeId });
  if (res.ok) forgetPitchBadges(pitchId);
  return res;
};

const devCall = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (isMissingFunction(error)) return { missing: true };
    throw error;
  }
  return { data };
};

export const devServicePrices = {
  get: (token) => devCall('ican_dev_get_service_prices', { dev_token: token }),
  set: (token, key, priceIc, charged) => devCall('ican_dev_set_service_price', { dev_token: token, p_key: key, p_price_ic: priceIc, p_charged: charged }),
};
