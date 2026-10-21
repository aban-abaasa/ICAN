/**
 * A business's public website lives at   https://icanera.space/<business-name>
 * (for example https://icanera.space/godmindera-organisation-u-ltd). This file is the one place that knows what an address looks
 * like, which words can never be one, and how a link to a business site is written.
 *
 * The DATABASE decides who owns which address (public.cmms_company_profiles.site_slug, unique, see
 * supabase/migrations/20261105100000_business_site_slugs.sql); nothing here invents one for a business. The helpers that turn a
 * name into an address only PREVIEW what the database would give a name (they mirror fn_site_slugify / fn_site_slug_base).
 *
 * Pure and dependency-free so the server functions (api/share-preview.js, api/sitemap.js) and the tests can use it too.
 */

/** Always the real production domain, whichever build made the link: a link printed on a receipt must open for everyone. */
export const SITE_ORIGIN = 'https://icanera.space';

/**
 * Top-level paths the app or the host serves. No business can have one as its address. KEEP IN STEP with fn_site_slug_is_reserved in
 * supabase/migrations/20261105100000_business_site_slugs.sql (tests/businessSiteUrl.test.js compares the two). Paths shorter than 3
 * characters (/r, /p, /uc) can never clash: an address has at least 3.
 */
export const ROUTE_SITE_SLUGS = Object.freeze([
  'about', 'admin', 'api', 'app', 'assets', 'auth', 'billing', 'buy-ican', 'callback', 'candidate-document', 'candidate-interview',
  'candidate-test', 'card-pay', 'careers', 'checkout', 'confirm-delete-account', 'consultation-forms', 'contact', 'contract', 'dashboard', 'decoy-portal',
  'developers', 'dist', 'document', 'drive', 'edit', 'explore', 'favicon', 'file', 'forms', 'health', 'help', 'home', 'icaneracoin', 'icons',
  'images', 'index', 'invest', 'investments', 'invite', 'jobs', 'js', 'login', 'logout', 'manifest', 'new', 'notice', 'notices', 'notifications',
  'null', 'official', 'open', 'pay', 'pitch', 'pitchin', 'plan', 'plans', 'portfolio', 'presentation', 'pricing', 'privacy', 'public', 'register',
  'report-exports', 'reports', 'reset-password', 'reset-pin', 'robots', 'search', 'sell-ican', 'service-provider-contract', 'settings', 'share',
  'shop', 'sign-in', 'sign-up', 'signin', 'signup', 'sitemap', 'spreadsheets', 'staff', 'staff-attendance', 'stake-ican', 'static', 'status',
  'store', 'support', 'support-console', 'sw', 'team', 'terms', 'test-share', 'transfer-ican', 'undefined', 'verify-agreement', 'verify-document',
  'visitor-check-in', 'wallet', 'www',
]);

/**
 * Brand names. A customer can never take one (nobody poses as IcanEra, GODMINDERA or one of its apps); the platform operator can assign
 * one from the SQL editor. KEEP IN STEP with fn_site_slug_is_brand in the same migration.
 */
export const BRAND_SITE_SLUGS = Object.freeze([
  'bodago', 'bodagoera', 'godmindera', 'ican', 'icanera', 'icanera-official', 'iwos', 'supermartkera',
]);

const ROUTE_SET = new Set(ROUTE_SITE_SLUGS);
const BRAND_SET = new Set(BRAND_SITE_SLUGS);

export const SITE_SLUG_MIN = 3;
export const SITE_SLUG_MAX = 60;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const clean = (value) => String(value ?? '').trim().toLowerCase();

/** A page of the app (or of the host), so never a business site. Used by routing. */
export const isAppRouteSlug = (slug) => ROUTE_SET.has(clean(slug));

/** An app page or a brand name: not available to a customer. Used to explain a refusal before asking the database. */
export const isReservedSiteSlug = (slug) => ROUTE_SET.has(clean(slug)) || BRAND_SET.has(clean(slug));

/** Right shape (3-60 characters; a-z, 0-9, single hyphens inside), whatever it is called. */
export const hasSiteSlugShape = (slug) => {
  const value = clean(slug);
  return value.length >= SITE_SLUG_MIN && value.length <= SITE_SLUG_MAX && SLUG_PATTERN.test(value);
};

/** Why a typed address cannot be used, in words for the person typing; null when it can (the database still has the last word). */
export const siteSlugProblem = (slug) => {
  const value = clean(slug);
  if (value.length < SITE_SLUG_MIN || value.length > SITE_SLUG_MAX) return `Use ${SITE_SLUG_MIN} to ${SITE_SLUG_MAX} characters.`;
  if (!SLUG_PATTERN.test(value)) return 'Use only letters, numbers and single hyphens (no spaces or symbols).';
  if (isReservedSiteSlug(value)) return 'That address is reserved. Please choose another.';
  return null;
};

// Same table as fn_site_slugify: letters with accents become plain letters (ß -> ss, æ -> ae, œ -> oe, & -> and).
const ACCENTED = 'àáâãäåāăąçćčďđèéêëēėęěğìíîïīįıłńňñòóôõöøōőŕřśšşșťţțùúûüūůűųýÿźżž';
const PLAIN = 'aaaaaaaaaccc' + 'dd' + 'eeeeeeee' + 'g' + 'iiiiiii' + 'l' + 'nnn' + 'oooooooo' + 'rr' + 'ssss' + 'ttt' + 'uuuuuuuu' + 'yy' + 'zzz';
const FOLD = new Map(Array.from(ACCENTED).map((character, index) => [character, PLAIN[index]]));

/** "Café & Bar (U) Ltd" -> "cafe-and-bar-u-ltd". Mirrors public.fn_site_slugify. */
export const slugifyBusinessName = (name) => {
  const folded = Array.from(String(name ?? '').toLowerCase().replace(/ß/g, 'ss').replace(/æ/g, 'ae').replace(/œ/g, 'oe'))
    .map((character) => FOLD.get(character) ?? character)
    .join('');
  return folded.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
};

/** What the database would first try for this name (before adding -2, -3 ... if it is taken). Mirrors public.fn_site_slug_base. */
export const suggestSiteSlug = (name) => {
  let value = slugifyBusinessName(name).slice(0, SITE_SLUG_MAX).replace(/^-+|-+$/g, '');
  if (!value) value = 'business';
  if (value.length < SITE_SLUG_MIN) value += '-business';
  if (isReservedSiteSlug(value)) value = `${value.slice(0, 50)}-business`;
  return value;
};

/**
 * The business address in a browser location, or null when the path is not one. Only a single lower-case-able segment of the right
 * shape that is not a page of the app counts; everything else (/, /pricing, /notices/<id>, /a/b, /file.js) is left to the app.
 */
export const siteSlugFromPathname = (pathname) => {
  const match = /^\/([A-Za-z0-9][A-Za-z0-9-]*)\/?$/.exec(String(pathname ?? ''));
  if (!match) return null;
  const slug = match[1].toLowerCase();
  return hasSiteSlugShape(slug) && !isAppRouteSlug(slug) ? slug : null;
};

/** The path of a business site: /<address> when the address is known, otherwise the always-valid /notices/<company-id>. */
export const businessSitePath = ({ slug, companyId } = {}) => {
  const value = clean(slug);
  if (value && hasSiteSlugShape(value)) return `/${value}`;
  return companyId ? `/notices/${companyId}` : '/';
};

const withQuery = (query) => {
  if (!query) return '';
  const text = typeof query === 'string' ? query : new URLSearchParams(query).toString();
  const trimmed = text.replace(/^\?/, '');
  return trimmed ? `?${trimmed}` : '';
};

/**
 * The full shareable link to a business site, e.g. buildBusinessSiteUrl({ slug: 'kampala-mart', query: { pay: 1 } })
 * -> https://icanera.space/kampala-mart?pay=1. Without an address it is the old, still valid https://icanera.space/notices/<id>.
 */
export const buildBusinessSiteUrl = ({ slug, companyId, query } = {}) => `${SITE_ORIGIN}${businessSitePath({ slug, companyId })}${withQuery(query)}`;

/** icanera.space/<address> without the protocol, for showing to people. */
export const displayBusinessSiteUrl = (slug) => `${SITE_ORIGIN.replace(/^https?:\/\//, '')}/${clean(slug)}`;
