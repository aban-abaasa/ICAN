/**
 * Ratings and subscriptions on a business website (supabase/migrations/20261118100000_business_ratings_subscriptions_ranking.sql).
 * Pure helpers, so the numbers shown on the website can be tested without a database.
 */

export const EMPTY_STATS = Object.freeze({
  ratingAvg: null,
  ratingCount: 0,
  distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  subscriberCount: 0,
  myRating: null,
  myComment: '',
  subscribed: false,
  isOwner: false,
});

/** fn_business_site_stats' JSON, made safe to render: numbers are numbers, nothing is undefined. */
export const normalizeStats = (raw) => {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_STATS, distribution: { ...EMPTY_STATS.distribution } };
  const count = (v) => Math.max(0, Math.trunc(Number(v) || 0));
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  Object.entries(raw.distribution || {}).forEach(([stars, n]) => {
    if (distribution[stars] !== undefined) distribution[stars] = count(n);
  });
  const avg = Number(raw.rating_avg);
  const mine = Number(raw.my_rating);
  return {
    ratingAvg: Number.isFinite(avg) && raw.rating_avg !== null && avg > 0 ? avg : null,
    ratingCount: count(raw.rating_count),
    distribution,
    subscriberCount: count(raw.subscriber_count),
    myRating: mine >= 1 && mine <= 5 ? mine : null,
    myComment: typeof raw.my_comment === 'string' ? raw.my_comment : '',
    subscribed: raw.subscribed === true,
    isOwner: raw.is_owner === true,
  };
};

/** "4.8" for a rated business, '' for one nobody has rated yet. */
export const formatRating = (avg) => (Number.isFinite(avg) && avg > 0 ? avg.toFixed(1) : '');

/** "1 follower", "1.2K followers": short enough for a badge. */
export const formatFollowers = (n) => {
  const v = Math.max(0, Math.trunc(Number(n) || 0));
  const text = v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
    : v >= 1_000 ? `${(v / 1_000).toFixed(1).replace(/\.0$/, '')}K`
    : String(v);
  return `${text} ${v === 1 ? 'follower' : 'followers'}`;
};

/** How many of the five stars to fill for an average (rounded to the nearest whole star). */
export const filledStars = (avg) => (Number.isFinite(avg) ? Math.min(5, Math.max(0, Math.round(avg))) : 0);
