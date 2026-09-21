/**
 * ICANera Referrals — ported from Supermarkera's referralService.js.
 *
 * Same shape (a ?ref=CODE link is remembered, then redeemed once the visitor is
 * signed in) but the rules are enforced on the server, because the reward is
 * real ICAN: the referrer earns a % of their friend's FIRST DEPOSIT (default 5%,
 * developer-adjustable from the dev panel's Referrals tab). Backed by
 * backend/ADD_REFERRAL_SYSTEM.sql — the browser never writes to a referral
 * table, it only calls these RPCs. Shared with BodaGoEra (same DB), with a
 * separate code per app.
 */

import { supabase } from '../lib/supabase/client';
import {
  REFERRAL_SOURCE_APP, PENDING_TTL_MS,
  readPendingReferral, clearPendingReferral,
} from './referralCapture';

export { captureReferralFromUrl } from './referralCapture';

// Redeem reasons worth retrying later; every other reason is final, so the
// stored code is dropped instead of re-tried on every app load.
const KEEP_PENDING_REASONS = new Set(['not_signed_in', 'paused']);

const REASON_MESSAGE = {
  invalid_code: 'That referral code is not valid.',
  wrong_app: 'That referral code belongs to a different app.',
  own_code: "You can't use your own referral code.",
  already_referred: 'A referral code was already applied to your account.',
  already_deposited: 'Referral codes only apply before your first deposit.',
  circular: "That person joined through your code, so it can't be used the other way round.",
};

/**
 * Applies a stored code to the signed-in user. Safe on every app load: a no-op
 * when nothing is pending or the code has expired.
 * @returns {Promise<{applied: boolean, referrerName?: string, message?: string}>}
 */
export async function consumePendingReferralCode() {
  const pending = readPendingReferral();
  if (!pending) return { applied: false };

  if (Date.now() - (pending.savedAt || 0) > PENDING_TTL_MS) {
    clearPendingReferral();
    return { applied: false };
  }

  const { data, error } = await supabase.rpc('ican_referral_redeem_code', {
    p_code: pending.code,
    p_source_app: REFERRAL_SOURCE_APP,
  });
  if (error) throw error; // transient (network etc.) — keep the code pending

  if (data?.success) {
    clearPendingReferral();
    return { applied: true, referrerName: data.referrer_name || 'your friend' };
  }

  const reason = data?.reason ?? 'unknown';
  if (!KEEP_PENDING_REASONS.has(reason)) clearPendingReferral();
  // 'already_referred' after a reload race is not worth surfacing.
  const silent = KEEP_PENDING_REASONS.has(reason) || reason === 'already_referred';
  return { applied: false, message: silent ? undefined : REASON_MESSAGE[reason] };
}

/**
 * The caller's code (created on first use) plus everything the card shows.
 * @returns {Promise<{code: string|null, enabled: boolean, reward_percent: number,
 *   max_reward_ican: number|null, min_deposit_ican: number, live_price_ugx: number,
 *   friends_joined: number, friends_deposited: number, earned_ican: number,
 *   pending_ican: number, earned_ugx: number, pending_ugx: number,
 *   friends: Array<{first_name: string, state: 'joined'|'pending'|'paid'|'rejected',
 *   reward_ican: number|null, reward_ugx: number|null, created_at: string}>}>}
 */
export async function loadReferralStats() {
  const codeRes = await supabase.rpc('ican_referral_get_or_create_code', { p_source_app: REFERRAL_SOURCE_APP });
  if (codeRes.error) throw codeRes.error;
  if (!codeRes.data?.success) throw new Error(codeRes.data?.reason ?? 'Could not load your referral code');

  const { data, error } = await supabase.rpc('ican_referral_my_stats', { p_source_app: REFERRAL_SOURCE_APP });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.reason ?? 'Could not load referral stats');

  return {
    code: data.code ?? codeRes.data.code,
    enabled: !!data.enabled,
    reward_percent: Number(data.reward_percent ?? 0),
    max_reward_ican: data.max_reward_ican == null ? null : Number(data.max_reward_ican),
    min_deposit_ican: Number(data.min_deposit_ican ?? 0),
    live_price_ugx: Number(data.live_price_ugx ?? 0),
    friends_joined: Number(data.friends_joined ?? 0),
    friends_deposited: Number(data.friends_deposited ?? 0),
    earned_ican: Number(data.earned_ican ?? 0),
    pending_ican: Number(data.pending_ican ?? 0),
    earned_ugx: Number(data.earned_ugx ?? 0),
    pending_ugx: Number(data.pending_ugx ?? 0),
    friends: data.friends ?? [],
  };
}

/**
 * Signed-out typo check for the sign-in / sign-up "Have a referral code?" field.
 * Answers only valid / not valid (never who owns it); redemption itself still
 * happens after sign-in. Throws on a network error so the caller can keep the
 * code and let the server re-check it later.
 * @returns {Promise<{valid: boolean, paused?: boolean, reason?: string}>}
 */
export async function checkReferralCode(code) {
  const { data, error } = await supabase.rpc('ican_referral_check_code', {
    p_code: code,
    p_source_app: REFERRAL_SOURCE_APP,
  });
  if (error) throw error;
  return data || { valid: false, reason: 'invalid_code' };
}

export function buildReferralLink(code) {
  return `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
}

export default {
  consumePendingReferralCode,
  loadReferralStats,
  checkReferralCode,
  buildReferralLink,
};
