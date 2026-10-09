import { supabase } from '../lib/supabase/client';

/**
 * The "Library" tab on a business's public website (/notices/<company>?tab=library): the public links the
 * business has created elsewhere in CMMS -- shared reports, report exports, consultation forms,
 * service-provider contracts -- plus links the team adds by hand.
 * Backed by 20261016100000_business_site_library.sql.
 *
 * Nothing is listed automatically. Staff pick what to list; a locked link stays locked (the destination page
 * still asks for its password / PIN / allowed email, and a PIN-protected manual link's address is only released
 * by unlockLink after the right PIN).
 */

export const LINK_KINDS = {
  report: { label: 'Report', plural: 'Reports' },
  report_export: { label: 'Report bundle', plural: 'Reports' },
  consultation_form: { label: 'Form', plural: 'Forms' },
  service_contract: { label: 'Contract', plural: 'Contracts' },
  custom: { label: 'Link', plural: 'Links' },
};

export const LOCK_LABELS = {
  password: 'Password needed',
  pin: 'PIN needed',
  email: 'Invited emails only',
};

/** The listed, live links for the public site. Resolves [] when the feature's SQL is not installed. */
export const getPublicLinks = async (companyId) => {
  const { data, error } = await supabase.rpc('fn_public_site_links', { p_company_id: companyId });
  if (error || !Array.isArray(data)) return { success: !error, data: [] };
  return { success: true, data };
};

/** { success, url } or { success: false, error, locked } */
export const unlockLink = async (companyId, linkId, pin) => {
  const { data, error } = await supabase.rpc('fn_public_site_link_unlock', {
    p_company_id: companyId, p_link_id: linkId, p_pin: pin,
  });
  if (error) return { success: false, error: 'Could not check the PIN. Try again.' };
  return data;
};

/** Where a listed link opens (internal links are paths on this site). */
export const resolveLinkHref = (link) => {
  if (link.url) return link.url;
  if (link.path) return `${window.location.origin}${link.path}`;
  return null;
};

// ---- staff side (CMMS > Posts & Jobs > Library) ---------------------------------------------

const rpc = async (name, params) => {
  const { data, error } = await supabase.rpc(name, params);
  if (error) return { success: false, error: error.message, data: null };
  return { success: true, data };
};

/** { listed: [...], available: [...] } */
export const getOverview = (companyId) => rpc('fn_cmms_site_links_overview', { p_company_id: companyId });

export const listLink = (companyId, { kind, sourceId, title = '', description = '', featured = false }) =>
  rpc('fn_cmms_site_link_list', {
    p_company_id: companyId, p_kind: kind, p_source_id: sourceId,
    p_title: title, p_description: description, p_featured: featured,
  });

/** pin: undefined keeps the current PIN, '' removes it, anything else sets it. */
export const saveCustomLink = (companyId, { id = null, title, description = '', url, pin, featured = false }) =>
  rpc('fn_cmms_site_link_save_custom', {
    p_company_id: companyId, p_link_id: id, p_title: title, p_description: description, p_url: url,
    p_pin: pin === undefined ? null : pin, p_featured: featured,
  });

export const removeLink = (linkId) => rpc('fn_cmms_site_link_remove', { p_link_id: linkId });

export const setFeatured = (linkId, featured) =>
  rpc('fn_cmms_site_link_set_featured', { p_link_id: linkId, p_featured: featured });

export default {
  LINK_KINDS, LOCK_LABELS, getPublicLinks, unlockLink, resolveLinkHref,
  getOverview, listLink, saveCustomLink, removeLink, setFeatured,
};
