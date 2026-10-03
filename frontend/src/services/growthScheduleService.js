// Growth / Prosperity Architect: Supabase persistence, reminders and alerts.
//
// Tables (see supabase/migrations/20261003090000_growth_scheduler.sql):
//   ican_growth_profiles         saved preferences + the last optimisation
//   ican_growth_schedule_items   the user's recurring / one-off time blocks
//   ican_growth_notifications    in-app reminder inbox, filled by a per-minute cron
//
// Phone (push) alerts reuse the app-wide device registration in walletPushService;
// the cron pushes through the same relay as wallet and CMMS alerts.

import { getSupabaseClient } from '../lib/supabase/client';

const TABLES = {
  profile: 'ican_growth_profiles',
  items: 'ican_growth_schedule_items',
  notifications: 'ican_growth_notifications',
};
export const GROWTH_NOTIFICATION_SOURCE = TABLES.notifications;

const ITEM_COLUMNS = 'id, user_id, title, category, notes, start_time, duration_minutes, recurrence, on_date, '
  + 'days_of_week, tz, remind_before_minutes, reminders_enabled, is_active, source, next_start_at, '
  + 'last_notified_at, created_at';

// Fields a client may write. Anything else (next_start_at, ...) belongs to the scheduler.
const WRITABLE = ['title', 'category', 'notes', 'start_time', 'duration_minutes', 'recurrence', 'on_date',
  'days_of_week', 'remind_before_minutes', 'reminders_enabled', 'is_active'];
const WHEN_FIELDS = ['start_time', 'days_of_week', 'on_date', 'recurrence'];

export class GrowthBackendMissingError extends Error {
  constructor() {
    super('Scheduling is not switched on for this server yet. An administrator needs to run the growth scheduler migration.');
    this.name = 'GrowthBackendMissingError';
  }
}

const client = () => {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('The app is not connected to its database. Check your connection and try again.');
  return sb;
};

// 42P01: undefined_table. PGRST205: table not in PostgREST's schema cache.
const isMissingTable = (error) =>
  error && (error.code === '42P01' || error.code === 'PGRST205' || /schema cache|does not exist/i.test(error.message || ''));

const unwrap = ({ data, error }) => {
  if (error) {
    if (isMissingTable(error)) throw new GrowthBackendMissingError();
    throw new Error(error.message || 'Something went wrong. Please try again.');
  }
  return data;
};

export const isBackendMissing = (error) => error instanceof GrowthBackendMissingError;

export const getUserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

export const getCurrentUserId = async () => {
  const { data, error } = await client().auth.getUser();
  if (error || !data?.user?.id) throw new Error('Please sign in again to manage your schedule.');
  return data.user.id;
};

const pickWritable = (input) => {
  const out = {};
  for (const key of WRITABLE) if (input[key] !== undefined) out[key] = input[key];
  if (typeof out.title === 'string') out.title = out.title.trim();
  if (out.notes !== undefined) out.notes = out.notes ? String(out.notes).trim() || null : null;
  // 'HH:MM:SS' from the database round-trips; the form sends 'HH:MM'. Both are valid TIME input.
  if (out.recurrence === 'once') out.days_of_week = [];
  if (out.recurrence === 'weekly') out.on_date = null;
  return out;
};

// ------------------------------------------------------------------- profile

export async function loadGrowthProfile() {
  const userId = await getCurrentUserId();
  const row = unwrap(await client().from(TABLES.profile).select('*').eq('user_id', userId).maybeSingle());
  if (!row) return null;
  return {
    preferences: row.preferences || {},
    lastOptimization: row.last_optimization || null,
    score: row.optimization_score === null ? null : Number(row.optimization_score),
    optimizedAt: row.optimized_at,
  };
}

export async function saveGrowthProfile({ preferences, optimization = null, score = null }) {
  const userId = await getCurrentUserId();
  unwrap(await client().from(TABLES.profile).upsert({
    user_id: userId,
    preferences,
    last_optimization: optimization,
    optimization_score: score,
    optimized_at: optimization ? new Date().toISOString() : null,
  }, { onConflict: 'user_id' }));
}

// ------------------------------------------------------------- schedule items

export async function listScheduleItems() {
  const rows = unwrap(await client().from(TABLES.items).select(ITEM_COLUMNS)
    .order('start_time', { ascending: true }).order('created_at', { ascending: true }));
  return rows || [];
}

export async function createScheduleItem(input) {
  const [created] = await createScheduleItems([input]);
  return created;
}

export async function createScheduleItems(inputs) {
  if (!inputs.length) return [];
  const userId = await getCurrentUserId();
  const tz = getUserTimezone();
  const rows = inputs.map((input) => ({
    ...pickWritable(input),
    user_id: userId,
    tz,
    source: input.source === 'optimizer' ? 'optimizer' : 'manual',
  }));
  return unwrap(await client().from(TABLES.items).insert(rows).select(ITEM_COLUMNS)) || [];
}

export async function updateScheduleItem(id, patch) {
  const changes = pickWritable(patch);
  // Clock times are read in the zone the user is in when they change them.
  if (WHEN_FIELDS.some((key) => key in changes)) changes.tz = getUserTimezone();
  const [row] = unwrap(await client().from(TABLES.items).update(changes).eq('id', id).select(ITEM_COLUMNS)) || [];
  if (!row) throw new Error('That block could not be found. It may have been deleted.');
  return row;
}

export async function deleteScheduleItem(id) {
  unwrap(await client().from(TABLES.items).delete().eq('id', id));
}

// ------------------------------------------------------------- reminder inbox

export async function listGrowthNotifications({ limit = 30 } = {}) {
  return unwrap(await client().from(TABLES.notifications).select('*')
    .order('created_at', { ascending: false }).limit(limit)) || [];
}

export async function markGrowthNotificationRead(id) {
  unwrap(await client().from(TABLES.notifications)
    .update({ is_read: true, read_at: new Date().toISOString() }).eq('id', id));
}

export async function markAllGrowthNotificationsRead() {
  unwrap(await client().from(TABLES.notifications)
    .update({ is_read: true, read_at: new Date().toISOString() }).eq('is_read', false));
}

export async function deleteGrowthNotification(id) {
  unwrap(await client().from(TABLES.notifications).delete().eq('id', id));
}

export async function clearGrowthNotifications() {
  const userId = await getCurrentUserId();
  unwrap(await client().from(TABLES.notifications).delete().eq('user_id', userId));
}

/** Realtime: call back with each new reminder row. Returns an unsubscribe function. */
export function subscribeToGrowthNotifications(userId, onInsert) {
  const sb = getSupabaseClient();
  if (!sb || !userId) return () => {};
  const channel = sb
    .channel(`growth-notifications:${userId}`)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: TABLES.notifications, filter: `user_id=eq.${userId}`,
    }, (payload) => onInsert(payload.new))
    .subscribe();
  return () => sb.removeChannel(channel);
}

/** Ask the server to send this user a test reminder (in-app now, push if enabled). */
export async function sendTestReminder() {
  const { error } = await client().rpc('ican_growth_send_test_reminder');
  if (error) {
    if (isMissingTable(error) || error.code === 'PGRST202') throw new GrowthBackendMissingError();
    throw new Error(error.message || 'The test alert could not be sent.');
  }
}

// ------------------------------------------------------------- device alerts

export const browserAlertsSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const browserPermission = () => (browserAlertsSupported() ? Notification.permission : 'unsupported');

/**
 * Show a reminder on this device. Prefers the service worker (the only way
 * Android and installed PWAs display notifications) and falls back to the
 * Notification constructor on desktop. Silent if permission was not granted.
 */
export async function showLocalReminder({ title, body, tag }) {
  if (browserPermission() !== 'granted') return false;
  const options = { body, tag, icon: '/icons/icon-192x192.png', badge: '/icons/icon-192x192.png', data: { url: '/', source: 'growth', actionTab: 'growth' } };
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (registration) {
      await registration.showNotification(title, options);
    } else {
      new Notification(title, options);
    }
    return true;
  } catch {
    return false;
  }
}

/** Map a UI form value to the database item shape. */
export const blockToItemInput = (block, { remindBefore = 10, remindersEnabled = true } = {}) => ({
  title: block.title,
  category: block.category,
  notes: block.rationale || null,
  start_time: block.startTime,
  duration_minutes: block.durationMinutes,
  recurrence: 'weekly',
  days_of_week: block.daysOfWeek,
  remind_before_minutes: remindBefore,
  reminders_enabled: remindersEnabled,
  source: 'optimizer',
});
