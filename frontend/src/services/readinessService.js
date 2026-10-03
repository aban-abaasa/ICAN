// Readiness (Global Navigator): Supabase persistence + the public Google Sheet reader.
//
// Tables (supabase/migrations/20261003092000_readiness_tracker.sql):
//   ican_readiness_settings   country / mode / connected Sheet / last compliance %
//   ican_readiness_progress   per-item status and notes
//   ican_readiness_links      connected Google Forms and Drive files (Google hosts only)

import { getSupabaseClient } from '../lib/supabase/client';
import { classifyGoogleUrl, parseCsv, parseSheetSource, rowsToRequirements } from '../utils/googleLinks';

const T = { settings: 'ican_readiness_settings', progress: 'ican_readiness_progress', links: 'ican_readiness_links' };

export class ReadinessBackendMissingError extends Error {
  constructor() {
    super('Saving your checklist is not switched on for this server yet. An administrator needs to apply the readiness migration.');
    this.name = 'ReadinessBackendMissingError';
  }
}
export const isReadinessBackendMissing = (e) => e instanceof ReadinessBackendMissingError;

const client = () => {
  const sb = getSupabaseClient();
  if (!sb) throw new Error('The app is not connected to its database. Check your connection and try again.');
  return sb;
};
const isMissingTable = (error) =>
  error && (error.code === '42P01' || error.code === 'PGRST205' || /schema cache|does not exist/i.test(error.message || ''));
const unwrap = ({ data, error }) => {
  if (error) {
    if (isMissingTable(error)) throw new ReadinessBackendMissingError();
    throw new Error(error.message || 'Something went wrong. Please try again.');
  }
  return data;
};
const userId = async () => {
  const { data, error } = await client().auth.getUser();
  if (error || !data?.user?.id) throw new Error('Please sign in again.');
  return data.user.id;
};

// -------------------------------------------------------------------- settings

export async function loadSettings() {
  const row = unwrap(await client().from(T.settings).select('*').maybeSingle());
  return row || null;
}

export async function saveSettings(patch) {
  const uid = await userId();
  unwrap(await client().from(T.settings).upsert({ user_id: uid, ...patch }, { onConflict: 'user_id' }));
}

// -------------------------------------------------------------------- progress

/** { [item_key]: { status, note } } for one country + mode. */
export async function loadProgress(country, mode) {
  const rows = unwrap(await client().from(T.progress).select('item_key, status, note').eq('country', country).eq('mode', mode)) || [];
  return Object.fromEntries(rows.map((r) => [r.item_key, { status: r.status, note: r.note || '' }]));
}

export async function saveItem({ country, mode, key, status, note }) {
  const uid = await userId();
  const row = { user_id: uid, country, mode, item_key: key };
  if (status !== undefined) row.status = status;
  if (note !== undefined) row.note = note ? String(note).slice(0, 500) : null;
  unwrap(await client().from(T.progress).upsert(row, { onConflict: 'user_id,country,mode,item_key' }));
}

// ----------------------------------------------------------------------- links

export async function listLinks() {
  return unwrap(await client().from(T.links).select('*').order('created_at', { ascending: false })) || [];
}

/** Validate, canonicalise and save a Google link. Throws a plain-English error for anything else. */
export async function addLink({ url, title, country, mode, itemKey }) {
  const c = classifyGoogleUrl(url);
  if (!c.ok) throw new Error(c.reason);
  const uid = await userId();
  const [row] = unwrap(await client().from(T.links).insert({
    user_id: uid,
    kind: c.kind,
    title: (String(title || '').trim() || c.label).slice(0, 120),
    url: c.url,
    country: country || null,
    mode: mode || null,
    item_key: itemKey || null,
  }).select('*')) || [];
  return row;
}

export async function removeLink(id) {
  unwrap(await client().from(T.links).delete().eq('id', id));
}

// ----------------------------------------------------------- public Google Sheet

const MAX_CSV_BYTES = 1_000_000;

/**
 * Read a public Google Sheet as CSV. Resolves { rows } or throws a friendly error.
 * Works for sheets shared as "Anyone with the link" and for "Publish to web" CSV links.
 */
export async function fetchSheetRows(csvUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(csvUrl, { credentials: 'omit', referrerPolicy: 'no-referrer', signal: controller.signal });
  } catch (err) {
    throw new Error(err?.name === 'AbortError'
      ? 'Google took too long to answer. Try again in a moment.'
      : 'Could not read that sheet. Make sure it is shared as "Anyone with the link can view", or use File, Share, Publish to web, and choose CSV.');
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new Error(response.status === 404
      ? 'Google could not find that sheet. Check the link.'
      : 'Google would not share that sheet. Set sharing to "Anyone with the link can view", or publish it to the web as CSV.');
  }
  const text = await response.text();
  if (text.length > MAX_CSV_BYTES) throw new Error('That sheet is too large to load. Keep it under about 1 MB.');
  // A private sheet answers with Google's sign-in page, not CSV.
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error('That sheet is private. Set sharing to "Anyone with the link can view", or publish it to the web as CSV.');
  }
  return { rows: parseCsv(text) };
}

/** Connect a sheet: validates the link, reads it, and returns everything the UI needs. */
export async function connectSheet(input, { country, mode }) {
  const source = parseSheetSource(input);
  if (!source.ok) throw new Error(source.reason);
  const { rows } = await fetchSheetRows(source.csvUrl);
  const result = rowsToRequirements(rows, { country, mode });
  // A sheet that loads but has no usable header is a setup mistake worth surfacing now.
  if (result.error && /title/.test(result.error)) throw new Error(result.error);
  return { storeUrl: source.storeUrl, csvUrl: source.csvUrl, rows, count: result.items.length, note: result.error };
}
