/**
 * Business website addresses (icanera.space/<business-name>) for the app.
 *
 * The address of a business lives in the database (public.cmms_company_profiles.site_slug); this service looks addresses up through
 * the anon-callable RPCs from supabase/migrations/20261105100000_business_site_slugs.sql and remembers them, so every place that
 * writes a link to a business site can do it synchronously:
 *
 *   buildBusinessSiteLink(companyId, { query })     -> https://icanera.space/<address>  (or the old /notices/<id> link until known)
 *
 * Feed the cache with the address the page already has (rememberSiteSlug), a batch (prefetchSiteSlugs, used by the services that
 * list businesses) or the useBusinessSiteSlug hook. If the migration has not been applied yet every lookup quietly answers "no
 * address", so links keep using /notices/<id>, which always works.
 */

import { supabase } from '../lib/supabase/client';
import { buildBusinessSiteUrl, hasSiteSlugShape } from '../utils/businessSiteUrl';

const MISS_TTL_MS = 60 * 1000; // an id with no address (or a failed lookup) is not asked again for a minute
const BATCH_SIZE = 200;        // fn_get_public_site_slugs answers up to 200 ids per call

const slugs = new Map();       // companyId -> address
const misses = new Map();      // companyId -> time of the miss
const inFlight = new Map();    // companyId -> Promise (one lookup per id at a time)
const listeners = new Set();

const notify = () => listeners.forEach((listener) => { try { listener(); } catch { /* a listener must never break a lookup */ } });

/** Re-render hook: called whenever an address is learned or changes. Returns the unsubscribe function. */
export const subscribeToSiteSlugs = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getCachedSiteSlug = (companyId) => (companyId ? slugs.get(companyId) || null : null);

/** Use an address the page already has (a profile row's site_slug, a resolved lookup, a just-saved change). */
export const rememberSiteSlug = (companyId, slug) => {
  if (!companyId) return;
  const value = String(slug ?? '').trim().toLowerCase();
  if (!hasSiteSlugShape(value)) return;
  misses.delete(companyId);
  if (slugs.get(companyId) !== value) {
    slugs.set(companyId, value);
    notify();
  }
};

/** Remember the addresses carried by rows that came with their company id (and optionally an address) under any of these keys. */
export const rememberSiteSlugsFrom = (rows, { idKeys = ['cmms_company_id', 'company_id', 'id'], slugKey = 'site_slug' } = {}) => {
  (rows || []).forEach((row) => {
    const id = idKeys.map((key) => row?.[key]).find(Boolean);
    if (id && row?.[slugKey]) rememberSiteSlug(id, row[slugKey]);
  });
};

const isUuid = (value) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value ?? ''));

// One call for a batch of ids. Never rejects: on any problem these businesses simply have no address yet.
const lookupBatch = async (batch) => {
  try {
    const { data, error } = await supabase.rpc('fn_get_public_site_slugs', { p_company_ids: batch });
    if (error) throw error;
    const found = new Set();
    (data || []).forEach((row) => {
      if (row?.company_id && row?.site_slug) { found.add(row.company_id); rememberSiteSlug(row.company_id, row.site_slug); }
    });
    batch.forEach((id) => { if (!found.has(id)) misses.set(id, Date.now()); });
  } catch {
    batch.forEach((id) => misses.set(id, Date.now()));
  }
};

/**
 * Look up the addresses of these businesses (one call per 200) and remember them. Never throws and never rejects: on any problem the
 * businesses simply have no address yet and their links stay /notices/<id>. An id already being looked up is waited for, not asked twice.
 */
export const prefetchSiteSlugs = async (companyIds) => {
  const now = Date.now();
  const toFetch = [];
  const waiting = [];
  new Set((companyIds || []).filter(isUuid)).forEach((id) => {
    if (slugs.has(id)) return;
    if (inFlight.has(id)) { waiting.push(inFlight.get(id)); return; }
    if (misses.has(id) && now - misses.get(id) < MISS_TTL_MS) return;
    toFetch.push(id);
  });
  for (let index = 0; index < toFetch.length; index += BATCH_SIZE) {
    const batch = toFetch.slice(index, index + BATCH_SIZE);
    const run = lookupBatch(batch).finally(() => batch.forEach((id) => inFlight.delete(id)));
    batch.forEach((id) => inFlight.set(id, run));
    waiting.push(run);
  }
  await Promise.all(waiting);
};

/** The address of one business, or null. */
export const fetchSiteSlug = async (companyId) => {
  if (!companyId) return null;
  await prefetchSiteSlugs([companyId]);
  return getCachedSiteSlug(companyId);
};

/**
 * Link to a business's public website (optionally a tab / post: query). Synchronous: uses the address if it is known, otherwise
 * the old /notices/<id> link, which always opens the same site.
 */
export const buildBusinessSiteLink = (companyId, { slug, query } = {}) =>
  buildBusinessSiteUrl({ slug: slug || getCachedSiteSlug(companyId), companyId, query });

/** Same link, looking the address up first. */
export const resolveBusinessSiteLink = async (companyId, { slug, query } = {}) => {
  const known = slug || await fetchSiteSlug(companyId);
  return buildBusinessSiteUrl({ slug: known, companyId, query });
};

/**
 * Address -> business, for the page that opens icanera.space/<address>.
 *   { companyId, slug, isCurrent }  the business (slug is its CURRENT address; isCurrent is false when the visitor used a retired one)
 *   null                            nothing has that address (or the lookup is unavailable)
 */
export const resolveSiteSlug = async (slug) => {
  const { data, error } = await supabase.rpc('fn_resolve_public_site_slug', { p_slug: slug });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.company_id) return null;
  rememberSiteSlug(row.company_id, row.site_slug);
  return { companyId: row.company_id, slug: row.site_slug, isCurrent: row.is_current !== false };
};

/** "Choose your address": { available, slug, reason }. */
export const checkSiteSlug = async (slug, companyId = null) => {
  const { data, error } = await supabase.rpc('fn_check_site_slug', { p_slug: slug, p_company_id: companyId });
  if (error) return { available: false, slug, reason: 'Could not check this address right now. Try again.' };
  return data || { available: false, slug, reason: 'Could not check this address right now. Try again.' };
};

/**
 * Save the address a company admin chose. The database repeats every check (shape, reserved words, uniqueness), keeps the old
 * address working, and RLS decides who may edit the company.
 */
export const saveSiteSlug = async (companyId, slug) => {
  const wanted = String(slug ?? '').trim().toLowerCase();
  const { data, error } = await supabase.from('cmms_company_profiles')
    .update({ site_slug: wanted }).eq('id', companyId).select('id, site_slug');
  if (error) return { success: false, error: error.code === '23505' ? error.message : (error.message || 'Could not save the address.') };
  if (!data?.length) return { success: false, error: 'Only a company admin can change the website address.' };
  rememberSiteSlug(companyId, data[0].site_slug);
  return { success: true, slug: data[0].site_slug };
};
