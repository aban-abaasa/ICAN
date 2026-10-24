/**
 * The gentle "what is happening" hint on a person's own status cards (the feed's "My Updates"). Pure rules, so what is announced, in what order,
 * and never twice can be tested without a screen. The facts come from fn_my_status_updates (supabase/migrations/20261119100000_video_product_badges.sql).
 *
 * A hint is shown only for something NEW and related to that card, one at a time, and says in a few words what happened:
 *   1. new comments from other people
 *   2. a product badge that is hidden because its product sold out or was switched off
 *   3. a handful of new views
 *   4. the status ending soon while it still carries a live badge (the badge goes with it)
 * Each thing is announced once: announcing it (or opening the status) moves what has been "seen" forward, so the same news never repeats.
 * `seen` is kept per person on their own device: { [statusId]: { comments, views, problems: [badgeId:problem], endingAnnounced } }.
 */

export const HINT_VISIBLE_MS = 9000;     // how long a hint stays before it slides away by itself
export const HINT_FIRST_DELAY_MS = 1200; // after the cards appear, so it never competes with the page loading
export const HINT_GAP_MS = 2500;         // quiet time between two hints
export const MIN_NEW_VIEWS = 3;          // a single extra view is not news
export const ENDING_SOON_MS = 2 * 60 * 60 * 1000;

const count = (v) => Math.max(0, Math.trunc(Number(v) || 0));

/** "1h 20m", "45m", "1h". */
export const formatEndsIn = (ms) => {
  const minutes = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const problemKey = (badge) => `${badge.id}:${badge.problem}`;

const PROBLEM_TEXT = {
  sold_out: (name) => `${name} sold out · its badge is hidden`,
  product_unavailable: (name) => `${name} is no longer for sale · its badge is hidden`,
};

/**
 * The one hint worth showing for a status right now, or null. `update` is one entry of fn_my_status_updates.
 * Returns { statusId, kind: 'comments' | 'badge' | 'views' | 'ending', text, open: 'comments' | 'badges' | 'status' }.
 */
export const hintFor = (update, seen = {}, now = Date.now()) => {
  if (!update || !update.status_id) return null;
  const mine = seen[update.status_id] || {};
  const statusId = update.status_id;
  const badges = Array.isArray(update.badges) ? update.badges : [];

  const newComments = count(update.comment_count) - count(mine.comments);
  if (newComments > 0) {
    return { statusId, kind: 'comments', text: newComments === 1 ? '1 new comment' : `${newComments} new comments`, open: 'comments' };
  }

  const seenProblems = new Set(mine.problems || []);
  const hidden = badges.find((b) => b && b.problem && PROBLEM_TEXT[b.problem] && !seenProblems.has(problemKey(b)));
  if (hidden) {
    return { statusId, kind: 'badge', text: PROBLEM_TEXT[hidden.problem](hidden.name || 'A product'), open: 'badges' };
  }

  const newViews = count(update.view_count) - count(mine.views);
  if (newViews >= MIN_NEW_VIEWS) {
    return { statusId, kind: 'views', text: `${newViews} new views`, open: 'status' };
  }

  const left = new Date(update.expires_at).getTime() - now;
  const liveBadge = badges.some((b) => b && !b.problem);
  if (liveBadge && left > 0 && left <= ENDING_SOON_MS && !mine.endingAnnounced) {
    return { statusId, kind: 'ending', text: `Ends in ${formatEndsIn(left)} · your product badge goes with it`, open: 'status' };
  }
  return null;
};

/** What has been seen once this hint has been shown: only the thing announced moves forward. */
export const announce = (seen, update, hint) => {
  const mine = { ...(seen[update.status_id] || {}) };
  if (hint.kind === 'comments') mine.comments = count(update.comment_count);
  if (hint.kind === 'views') mine.views = count(update.view_count);
  if (hint.kind === 'ending') mine.endingAnnounced = true;
  if (hint.kind === 'badge') {
    const keys = (update.badges || []).filter((b) => b && b.problem && PROBLEM_TEXT[b.problem]).map(problemKey);
    mine.problems = [...new Set([...(mine.problems || []), ...keys])];
  }
  return { ...seen, [update.status_id]: mine };
};

/** The person opened the status: everything on it is now caught up. */
export const markOpened = (seen, update) => {
  const keys = (update.badges || []).filter((b) => b && b.problem && PROBLEM_TEXT[b.problem]).map(problemKey);
  return {
    ...seen,
    [update.status_id]: {
      ...(seen[update.status_id] || {}),
      comments: count(update.comment_count),
      views: count(update.view_count),
      problems: [...new Set([...((seen[update.status_id] || {}).problems || []), ...keys])],
    },
  };
};

/** The first status (in the order shown) that has something worth a hint. */
export const nextHint = (updatesById, statusIds, seen, now = Date.now()) => {
  for (const id of statusIds) {
    const hint = hintFor(updatesById.get(id), seen, now);
    if (hint) return hint;
  }
  return null;
};

/** Keep the remembered state small: only statuses that are still around. */
export const pruneSeen = (seen, activeIds) => {
  const keep = new Set(activeIds);
  return Object.fromEntries(Object.entries(seen).filter(([id]) => keep.has(id)));
};

const storageKey = (userId) => `ican_status_hints_v1:${userId}`;

export const loadSeen = (userId) => {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(userId)) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const saveSeen = (userId, seen) => {
  try { localStorage.setItem(storageKey(userId), JSON.stringify(seen)); } catch { /* storage blocked: hints may repeat after a reload, nothing breaks */ }
};
