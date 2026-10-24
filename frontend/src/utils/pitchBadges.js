/**
 * Product badges (supabase/migrations/20261119100000_video_product_badges.sql): a product's name and price shown over a PitchIn video or a
 * status update at the seconds the business chose. Pure helpers, so the timing and wording can be tested without a database or a browser.
 */

export const BADGE_DAYS = 30;
export const BADGE_MAX_PER_VIDEO = 12;
export const BADGE_MAX_PER_STATUS = 3;
export const MIN_SHOW_SECONDS = 2;
export const MAX_SHOW_SECONDS = 60;
export const DEFAULT_SHOW_SECONDS = 6;

export const POSITIONS = [
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-right', label: 'Bottom right' },
  { id: 'top-left', label: 'Top left' },
  { id: 'top-right', label: 'Top right' },
];

/** Tailwind classes that pin a badge to its side and, for the top ones, its height. Bottom ones get their height from the player (see BOTTOM_OFFSET_PX). */
export const POSITION_CLASSES = {
  'bottom-left': 'left-3',
  'bottom-right': 'right-3',
  'top-left': 'left-3 top-16',
  'top-right': 'right-3 top-16',
};

/** How far above the bottom edge the bottom badges sit by default: clear of a player's own controls. A player with its own text there asks for more. */
export const BOTTOM_OFFSET_PX = 80;

/** The live badges that should be on screen at second `t` of the video. `alwaysOn` (a photo or text status has no timeline) shows them all. */
export const badgesAt = (badges, t, alwaysOn = false) => {
  if (!Array.isArray(badges)) return [];
  if (alwaysOn) return badges;
  const now = Number(t);
  if (!Number.isFinite(now) || now < 0) return [];
  return badges.filter((b) => now >= b.starts_at_sec && now < b.starts_at_sec + b.duration_sec);
};

/**
 * Spreads `count` badges evenly over a video so they never overlap and none is at the very start or end. Each shows for up to
 * DEFAULT_SHOW_SECONDS (less when the video is short or crowded). Without a known length it assumes 60 seconds.
 * Returns [{ starts_at_sec, duration_sec }] in order.
 */
export const autoPlaceBadges = (count, videoSeconds) => {
  const n = Math.max(0, Math.trunc(Number(count) || 0));
  if (n === 0) return [];
  const length = Number(videoSeconds) > 0 ? Math.floor(Number(videoSeconds)) : 60;
  const slot = length / (n + 1);
  const show = Math.max(MIN_SHOW_SECONDS, Math.min(DEFAULT_SHOW_SECONDS, Math.floor(slot) - 1));
  return Array.from({ length: n }, (_, i) => {
    const start = Math.max(0, Math.min(Math.round(slot * (i + 1) - show / 2), Math.max(0, length - MIN_SHOW_SECONDS)));
    return { starts_at_sec: start, duration_sec: show };
  });
};

/** "UGX 4,500" / "KES 900.50": whole units for the currencies shops price in whole shillings, two decimals otherwise. */
export const formatBadgePrice = (price, currency = 'UGX') => {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return '';
  const code = String(currency || 'UGX').toUpperCase();
  const whole = ['UGX', 'RWF', 'TZS', 'KES', 'BIF', 'XOF', 'XAF', 'JPY'].includes(code) && Number.isInteger(amount);
  const text = amount.toLocaleString('en-US', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  return `${code} ${text}`;
};

/** "12:05" style time, for the manager's "starts at". */
export const formatClock = (seconds) => {
  const s = Math.max(0, Math.trunc(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Whole days left until `liveUntil` (0 when it ends today or already ended). */
export const daysLeft = (liveUntil, now = Date.now()) => {
  const end = new Date(liveUntil).getTime();
  if (!Number.isFinite(end) || end <= now) return 0;
  return Math.ceil((end - now) / 86400000);
};

/** The last 7 days of a paid period: the database lets the owner renew from here. */
export const canRenew = (badge, now = Date.now()) => {
  if (!badge || badge.status !== 'live') return false;
  const end = new Date(badge.live_until).getTime();
  return !Number.isFinite(end) || end <= now + 7 * 86400000;
};

/** What the manager shows for a badge: { tone: 'draft' | 'live' | 'warn' | 'ended', text }. */
export const badgeStatus = (badge, now = Date.now()) => {
  if (!badge || badge.status !== 'live') return { tone: 'draft', text: 'Draft: not showing yet' };
  const left = daysLeft(badge.live_until, now);
  if (left === 0) return { tone: 'ended', text: badge.status_id ? 'Ended with the status' : 'Ended: renew to show it again' };
  // a status badge lasts a day at most: say hours, not "1 day"
  const hours = Math.max(1, Math.ceil((new Date(badge.live_until).getTime() - now) / 3600000));
  const running = badge.status_id ? `Live · ${hours}h left` : `Live · ${left} day${left === 1 ? '' : 's'} left`;
  if (badge.problem === 'sold_out') return { tone: 'warn', text: `${running} · hidden, the product is sold out` };
  if (badge.problem === 'product_unavailable') return { tone: 'warn', text: `${running} · hidden, the product is no longer for sale` };
  return { tone: 'live', text: running };
};

/**
 * What the Publish / Renew button says, from the current price ({ price_ic, charged } from fn_pitch_badge_price / fn_status_badge_price).
 * A status badge lasts as long as the status does, so its button says that instead of a number of days.
 */
export const publishLabel = (badge, price, isStatus = false) => {
  const cost = Number(price?.price_ic) > 0 ? ` · ${Number(price.price_ic)} IC` : ' · Free';
  if (isStatus) return `Publish on this status${cost}`;
  const verb = badge?.status === 'live' ? 'Renew' : 'Publish';
  return `${verb} for ${BADGE_DAYS} days${cost}`;
};

/** Where tapping a badge goes: the business's Market, or null when it has no website. */
export const badgeShopHref = (siteCompanyId) => (siteCompanyId ? `/notices/${siteCompanyId}?tab=market` : null);

/** The badge fields the database function takes, from the manager's form. */
export const badgeFormToArgs = (pitchId, form, badgeId = null) => ({
  p_pitch_id: pitchId,
  p_badge_id: badgeId,
  p_product_id: form.productId || null,
  // a store product keeps its own name (read live); only a typed badge has a name of its own
  p_label: form.productId ? null : (form.label?.trim() || null),
  p_price: form.productId ? null : Number(form.price),
  p_currency: form.productId ? null : (form.currency || 'UGX').toUpperCase(),
  p_image_url: form.imageUrl?.trim() || null,
  p_starts_at_sec: Math.max(0, Math.trunc(Number(form.startsAt) || 0)),
  p_duration_sec: Math.trunc(Number(form.duration) || DEFAULT_SHOW_SECONDS),
  p_position: form.position || 'bottom-left',
});

/** The same, for a badge on a status (fn_save_status_badge): the business it advertises comes first. */
export const statusBadgeFormToArgs = (statusId, businessProfileId, form, badgeId = null) => {
  const { p_pitch_id, ...rest } = badgeFormToArgs(null, form, badgeId);
  return { p_status_id: statusId, p_business_profile_id: businessProfileId, ...rest };
};

/** Why a badge form cannot be saved yet, or '' when it can. Mirrors the database rules so the person is told before the round trip. */
export const badgeFormProblem = (form, videoSeconds, { timed = true } = {}) => {
  if (!form.productId) {
    if (!form.label?.trim()) return 'Pick a product, or type a name.';
    const price = Number(form.price);
    if (form.price === '' || form.price === null || form.price === undefined || !Number.isFinite(price) || price < 0) return 'Type the price.';
  }
  if (!timed) return '';
  const start = Number(form.startsAt);
  const duration = Number(form.duration);
  if (!Number.isFinite(start) || start < 0) return 'Start time cannot be negative.';
  if (!Number.isFinite(duration) || duration < MIN_SHOW_SECONDS || duration > MAX_SHOW_SECONDS) return `Show it for ${MIN_SHOW_SECONDS} to ${MAX_SHOW_SECONDS} seconds.`;
  if (Number(videoSeconds) > 0 && start >= Number(videoSeconds)) return `The video is only ${formatClock(videoSeconds)} long.`;
  return '';
};
