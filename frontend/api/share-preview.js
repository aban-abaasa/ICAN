/**
 * Serves the real app shell (frontend/dist/index.html + JS bundle, untouched)
 * for shared /status/:id and /pitchin/:id links, but with the <head> patched
 * to carry the actual update/pitch's title, caption/description and a
 * resolved, directly-loadable media URL as the Open Graph / Twitter Card
 * preview -- so pasting a share link into WhatsApp/Telegram/iMessage/X shows
 * a real rich preview instead of the generic "IcanEra" app card, and the
 * preview image is already resolved (no click needed to "load" it).
 *
 * Wired up via the rewrites in /vercel.json:
 *   /status/:id  -> /api/share-preview?type=status&id=:id
 *   /pitchin/:id -> /api/share-preview?type=pitch&id=:id
 *
 * Every other route still falls through to the plain SPA rewrite ("/(.*)"
 * -> "/"), which restores the deep-link fallback that /status and /pitchin
 * (and any other client route) silently lost when vercel.json was simplified
 * (see git history on vercel.json) -- without it, opening either link fresh
 * (not already cached client-side) 404s instead of navigating anywhere.
 *
 * Same HTML is served to bots and real visitors: it's the identical index.html
 * plus a patched <head>, so main.jsx still boots the same PublicStatusViewer /
 * PublicPitchViewer (path-matched from window.location.pathname) for a human,
 * while a crawler that never runs the JS still gets the correct preview tags.
 *
 * Route: GET /api/share-preview?type=status|pitch|store&id=<uuid>
 * Env vars: SUPABASE_URL, SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY) --
 * reads are anon-key only, relying on the same public RLS the app itself
 * depends on (ican_statuses: visibility public/followers; pitches: USING (true)
 * -- see statusService.getStatusById / pitchingService.getPitchById). The
 * store branch reads business_profiles + dropship_listings/products, which
 * are readable by anon the same way get_dropship_storefront is (that RPC is
 * itself granted to anon for the storefront page -- see
 * DROPSHIP_BUSINESS_WALLET_AND_DELIVERY.sql).
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

const patchHead = (html, meta, canonicalUrl) => {
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeAttr(meta.description)}">`,
    `<link rel="canonical" href="${escapeAttr(canonicalUrl)}">`,
    `<meta property="og:type" content="website">`,
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
    `<meta name="twitter:image" content="${escapeAttr(meta.image)}">`
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

  // Falls back to the real /status/:id, /pitchin/:id or /store/:id route
  // (never the rewritten /api/share-preview?... URL) so a resolution failure
  // below still redirects/canonicalizes somewhere a visitor can actually
  // land on.
  const fallbackPath = type === 'status' ? `/status/${id || ''}`
    : type === 'pitch' ? `/pitchin/${id || ''}`
    : type === 'store' ? `/store/${id || ''}`
    : '/';
  let meta = { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, image: DEFAULT_IMAGE, path: fallbackPath, video: null };

  if (url && anonKey && id && (type === 'status' || type === 'pitch' || type === 'store')) {
    try {
      const resolved = type === 'status' ? await buildStatusMeta({ url, anonKey, id })
        : type === 'pitch' ? await buildPitchMeta({ url, anonKey, id })
        : await buildStoreMeta({ url, anonKey, id });
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
