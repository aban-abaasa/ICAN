/**
 * Serves the real app shell (frontend/dist/index.html + JS bundle, untouched)
 * for shared /status/:id, /pitchin/:id, /store/:id and /notices/:id links,
 * but with the <head> patched to carry that specific update/pitch/store/
 * business's real title, description and a resolved, directly-loadable
 * image as the Open Graph / Twitter Card preview -- so pasting a share link
 * into WhatsApp/Telegram/iMessage/X shows a real rich preview instead of the
 * generic "IcanEra" app card, and the preview image is already resolved (no
 * click needed to "load" it).
 *
 * The /notices/:id (CMMS business public page) branch additionally injects
 * a schema.org LocalBusiness JSON-LD block -- this is the piece that lets a
 * business actually be *found*, not just look good when shared: Google's
 * rich-result/Business indexing and most AI-answer-engine crawlers read the
 * initial HTML response directly and never execute this SPA's JS, so
 * whatever facts (name, phone, address, socials) aren't in *this* patched
 * HTML are invisible to them, no matter how good PublicCompanyNoticeBoard's
 * own client-side SEO effect (useBusinessSeo) is.
 *
 * Wired up via the rewrites in /vercel.json:
 *   /status/:id  -> /api/share-preview?type=status&id=:id
 *   /pitchin/:id -> /api/share-preview?type=pitch&id=:id
 *   /store/:id   -> /api/share-preview?type=store&id=:id
 *   /notices/:id -> /api/share-preview?type=notices&id=:id
 *
 * Every other route still falls through to the plain SPA rewrite ("/(.*)"
 * -> "/"), which restores the deep-link fallback that /status and /pitchin
 * (and any other client route) silently lost when vercel.json was simplified
 * (see git history on vercel.json) -- without it, opening either link fresh
 * (not already cached client-side) 404s instead of navigating anywhere.
 *
 * Same HTML is served to bots and real visitors: it's the identical index.html
 * plus a patched <head>, so main.jsx still boots the same PublicStatusViewer /
 * PublicPitchViewer / PublicDropshipStorefront / PublicCompanyNoticeBoard
 * (path-matched from window.location.pathname) for a human, while a crawler
 * that never runs the JS still gets the correct preview tags and facts.
 *
 * Route: GET /api/share-preview?type=status|pitch|store|notices&id=<uuid>
 * Env vars: SUPABASE_URL, SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) --
 * reads are anon-key only, relying on the same public RLS/RPC grants the app
 * itself depends on (ican_statuses: visibility public/followers; pitches:
 * USING (true) -- see statusService.getStatusById / pitchingService.
 * getPitchById). The store branch reads business_profiles + dropship_
 * listings/products via get_dropship_storefront, granted to anon the same
 * way PublicDropshipStorefront itself relies on it (see
 * DROPSHIP_BUSINESS_WALLET_AND_DELIVERY.sql). The notices branch reads
 * cmms_company_profiles via fn_get_public_cmms_company_header, granted to
 * anon the same way PublicCompanyNoticeBoard itself relies on it (see
 * CMMS_PUBLIC_BUSINESS_WEBSITE_PROFILE.sql).
 */
import { getDownloadUrl } from './_lib/r2Client.js';

const SITE_URL = 'https://icanera.space';
const DEFAULT_IMAGE = `${SITE_URL}/icons/icon-512x512.png`;
const DEFAULT_TITLE = 'IcanEra';
const DEFAULT_DESCRIPTION = 'Transform Volatility to Global Capital - Complete Business & Financial Management Platform';

const escapeHtml = (str) =>
  String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const escapeAttr = (str) => escapeHtml(str).replace(/\n/g, ' ').trim();

const supabaseSelectOne = async ({ url, anonKey, table, query }) => {
  const endpoint = new URL(`${url}/rest/v1/${table}`);
  Object.entries(query).forEach(([key, value]) => endpoint.searchParams.set(key, value));
  const res = await fetch(endpoint.toString(), {
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` }
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
};

const getPosterName = async ({ url, anonKey, userId }) => {
  if (!userId) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/fn_get_public_profile_info`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_ids: [userId] })
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0]?.full_name || null;
  } catch {
    return null;
  }
};

// Same resolution the client does (statusService/pitchingService +
// r2StorageService), so the preview image is a URL that actually loads
// rather than a private/expired one: r2:// keys get a fresh presigned GET,
// legacy Supabase Storage URLs get re-signed, anything else passes through.
const resolveMediaUrl = async (mediaUrl, { url, anonKey, defaultBucket }) => {
  if (!mediaUrl || typeof mediaUrl !== 'string') return null;
  if (mediaUrl.startsWith('r2://')) {
    try {
      return await getDownloadUrl({ key: mediaUrl.slice('r2://'.length) });
    } catch (err) {
      console.error('share-preview: R2 download URL sign failed:', err);
      return null;
    }
  }
  if (mediaUrl.includes('/storage/v1/object/')) {
    try {
      const match = mediaUrl.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?]+)/);
      const bucket = match ? match[1] : defaultBucket;
      const rawPath = match ? decodeURIComponent(match[2]) : mediaUrl;
      const path = rawPath.split('/').map(encodeURIComponent).join('/');
      const res = await fetch(`${url}/storage/v1/object/sign/${bucket}/${path}`, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 3600 })
      });
      if (!res.ok) return mediaUrl;
      const data = await res.json();
      return data?.signedURL ? `${url}/storage/v1${data.signedURL}` : mediaUrl;
    } catch (err) {
      console.error('share-preview: Supabase Storage sign failed:', err);
      return mediaUrl;
    }
  }
  return mediaUrl;
};

const buildStatusMeta = async ({ url, anonKey, id }) => {
  const status = await supabaseSelectOne({
    url,
    anonKey,
    table: 'ican_statuses',
    query: { id: `eq.${id}`, select: '*', limit: '1' }
  });
  if (!status) return null;

  const isExpired = new Date(status.expires_at).getTime() <= Date.now();
  const isVisible = status.visibility === 'public' || status.visibility === 'followers';
  if (!isVisible || isExpired) return null;

  const posterName = await getPosterName({ url, anonKey, userId: status.user_id });
  const meta = {
    title: posterName ? `${posterName}'s update on IcanEra` : 'An update on IcanEra',
    description: status.caption?.trim() || 'Tap to view this update on IcanEra.',
    image: DEFAULT_IMAGE,
    path: `/status/${status.id}`,
    video: null
  };

  if (status.media_type === 'image') {
    const resolved = await resolveMediaUrl(status.media_url, { url, anonKey, defaultBucket: 'user-content' });
    if (resolved) meta.image = resolved;
  } else if (status.media_type === 'video') {
    const resolved = await resolveMediaUrl(status.media_url, { url, anonKey, defaultBucket: 'user-content' });
    if (resolved) meta.video = resolved;
  }

  return meta;
};

const buildPitchMeta = async ({ url, anonKey, id }) => {
  const pitch = await supabaseSelectOne({
    url,
    anonKey,
    table: 'pitches',
    query: { id: `eq.${id}`, select: '*', limit: '1' }
  });
  if (!pitch) return null;

  const meta = {
    title: pitch.title ? `${pitch.title} — Pitchin on IcanEra` : 'Check out this pitch on IcanEra',
    description: pitch.description?.trim() || 'Watch this pitch and invest on IcanEra.',
    image: DEFAULT_IMAGE,
    path: `/pitchin/${pitch.id}`,
    video: null
  };

  const resolvedThumb = await resolveMediaUrl(pitch.thumbnail_url, { url, anonKey, defaultBucket: 'pitches' });
  if (resolvedThumb) {
    meta.image = resolvedThumb;
  } else {
    // No dedicated thumbnail on this pitch -- video posters still make a
    // usable preview image for platforms that snapshot the og:video.
    const resolvedVideo = await resolveMediaUrl(pitch.video_url, { url, anonKey, defaultBucket: 'pitches' });
    if (resolvedVideo) meta.video = resolvedVideo;
  }

  return meta;
};

const buildStoreMeta = async ({ url, anonKey, id }) => {
  // Goes through the get_dropship_storefront RPC rather than selecting
  // business_profiles/dropship_listings directly -- business_profiles' RLS
  // only lets anon read verified businesses, but this RPC (SECURITY DEFINER,
  // granted to anon) is exactly what PublicDropshipStorefront itself already
  // relies on to be browsable by anyone, verified or not.
  let listings;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_dropship_storefront`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_reseller_business_profile_id: id })
    });
    listings = res.ok ? await res.json() : null;
  } catch {
    listings = null;
  }
  if (!Array.isArray(listings) || listings.length === 0) return null;

  const resellerName = listings[0]?.reseller_name || 'this store';
  const withImage = listings.find((l) => l.images?.[0]);

  return {
    title: `${resellerName} — Shop on IcanEra`,
    description: withImage
      ? `Buy ${withImage.name} and more from ${resellerName} on IcanEra.`
      : `Shop ${resellerName} on IcanEra.`,
    // products.images are already plain public URLs (no signing needed --
    // see PublicDropshipStorefront.jsx rendering them directly).
    image: withImage?.images?.[0] || DEFAULT_IMAGE,
    path: `/store/${id}`,
    video: null
  };
};

const SOCIAL_URL_FIELDS = ['website', 'facebook_url', 'instagram_url', 'twitter_url', 'linkedin_url', 'tiktok_url'];
const normalizeExternalUrl = (url) => {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

// The one branch that builds real structured data, not just an OG preview --
// see the module doc comment for why. Reads the exact same anon-granted RPC
// (fn_get_public_cmms_company_header) PublicCompanyNoticeBoard.jsx itself
// calls, so this can never show a business fact the live page wouldn't.
const buildNoticeMeta = async ({ url, anonKey, id }) => {
  let company;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/fn_get_public_cmms_company_header`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_company_id: id })
    });
    const rows = res.ok ? await res.json() : null;
    company = Array.isArray(rows) ? rows[0] : null;
  } catch {
    company = null;
  }
  if (!company) return null;

  const canonicalPath = `/notices/${id}`;
  const title = company.tagline
    ? `${company.company_name} — ${company.tagline} | IcanEra`
    : `${company.company_name}${company.industry ? ` — ${company.industry}` : ''} | IcanEra`;
  const description = (
    company.about?.trim()
    || company.tagline?.trim()
    || `${company.company_name} on IcanEra — announcements, careers, products and contact details.`
  ).slice(0, 300);

  const [resolvedCover, resolvedLogo] = await Promise.all([
    resolveMediaUrl(company.cover_image_url, { url, anonKey, defaultBucket: 'cmms-company-profile' }),
    resolveMediaUrl(company.logo_url, { url, anonKey, defaultBucket: 'cmms-company-profile' }),
  ]);
  const image = resolvedCover || resolvedLogo || DEFAULT_IMAGE;

  const sameAs = SOCIAL_URL_FIELDS.map((field) => normalizeExternalUrl(company[field])).filter(Boolean);
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: company.company_name,
    description,
    image,
    url: `${SITE_URL}${canonicalPath}`,
    ...(resolvedLogo && { logo: resolvedLogo }),
    ...(company.phone && { telephone: company.phone }),
    ...(company.email && { email: company.email }),
    ...(company.location && { address: { '@type': 'PostalAddress', addressLocality: company.location } }),
    ...(company.hours_text && { openingHours: company.hours_text }),
    ...(company.industry && { knowsAbout: company.industry }),
    ...(sameAs.length > 0 && { sameAs }),
  };

  return { title, description, image, path: canonicalPath, video: null, ogType: 'business.business', structuredData };
};

// JSON-LD's only unsafe character inside a <script> body is a literal
// "</" (which could early-close the script tag) -- escaping just the slash
// keeps the JSON itself valid while making that sequence inert.
const escapeJsonLd = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

const patchHead = (html, meta, canonicalUrl) => {
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeAttr(meta.description)}">`,
    `<link rel="canonical" href="${escapeAttr(canonicalUrl)}">`,
    `<meta property="og:type" content="${meta.ogType || 'website'}">`,
    `<meta property="og:site_name" content="IcanEra">`,
    `<meta property="og:url" content="${escapeAttr(canonicalUrl)}">`,
    `<meta property="og:title" content="${escapeAttr(meta.title)}">`,
    `<meta property="og:description" content="${escapeAttr(meta.description)}">`,
    `<meta property="og:image" content="${escapeAttr(meta.image)}">`,
    meta.video ? `<meta property="og:video" content="${escapeAttr(meta.video)}">` : '',
    meta.video ? `<meta property="og:video:type" content="video/mp4">` : '',
    `<meta name="twitter:card" content="${meta.video ? 'player' : 'summary_large_image'}">`,
    `<meta name="twitter:title" content="${escapeAttr(meta.title)}">`,
    `<meta name="twitter:description" content="${escapeAttr(meta.description)}">`,
    `<meta name="twitter:image" content="${escapeAttr(meta.image)}">`,
    // Read by search/AI crawlers that never execute this SPA's JS -- see
    // the module doc comment above for why this can't just live in
    // PublicCompanyNoticeBoard's client-side useBusinessSeo effect alone.
    meta.structuredData ? `<script type="application/ld+json">${escapeJsonLd(meta.structuredData)}</script>` : ''
  ].filter(Boolean).join('\n  ');

  let patched = html
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[^>]*>/i, '');

  return patched.replace('</head>', `  ${tags}\n</head>`);
};

export default async function handler(req, res) {
  const { type, id } = req.query;
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  // Falls back to the real /status/:id, /pitchin/:id, /store/:id or
  // /notices/:id route (never the rewritten /api/share-preview?... URL) so a
  // resolution failure below still redirects/canonicalizes somewhere a
  // visitor can actually land on.
  const fallbackPath = type === 'status' ? `/status/${id || ''}`
    : type === 'pitch' ? `/pitchin/${id || ''}`
    : type === 'store' ? `/store/${id || ''}`
    : type === 'notices' ? `/notices/${id || ''}`
    : '/';
  let meta = { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, image: DEFAULT_IMAGE, path: fallbackPath, video: null };

  const VALID_TYPES = ['status', 'pitch', 'store', 'notices'];
  if (url && anonKey && id && VALID_TYPES.includes(type)) {
    try {
      const resolved = type === 'status' ? await buildStatusMeta({ url, anonKey, id })
        : type === 'pitch' ? await buildPitchMeta({ url, anonKey, id })
        : type === 'store' ? await buildStoreMeta({ url, anonKey, id })
        : await buildNoticeMeta({ url, anonKey, id });
      if (resolved) meta = resolved;
    } catch (err) {
      console.error(`share-preview: failed to resolve ${type} ${id}:`, err);
    }
  }

  try {
    // Self-fetch off the incoming request's own host (not the hardcoded
    // SITE_URL) so this also works on Vercel preview deployments and local
    // `vercel dev` -- only the canonical/og:url below should stay pinned to
    // the production domain.
    const proto = req.headers['x-forwarded-proto'] || 'https';
    const shellRes = await fetch(`${proto}://${req.headers.host}/index.html`);
    const shell = await shellRes.text();
    const canonicalUrl = `${SITE_URL}${meta.path}`;
    const html = patchHead(shell, meta, canonicalUrl);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400');
    return res.status(200).send(html);
  } catch (err) {
    console.error('share-preview: failed to load app shell:', err);
    // Fall back to a redirect straight to the SPA route rather than a bare
    // 500 -- the visitor still lands on their update/pitch, just without a
    // patched preview.
    res.setHeader('Location', meta.path);
    return res.status(302).end();
  }
}
