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
 *   /shop        -> /api/share-preview?type=shop   (no id: the public product grid)
 *   /icaneracoin -> /api/share-preview?type=coin   (no id: the public icaneracoin price chart)
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
 * Route: GET /api/share-preview?type=status|pitch|store|notices&id=<uuid> (or type=shop|coin, no id)
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


// The public shop (/shop): the same anon-granted RPC the page itself calls
// (get_dropship_browsable_products). Builds an ItemList of Products as
// JSON-LD plus a <noscript> product list, so crawlers that never run this
// SPA's JS still see real product names, images and prices.
const SHOP_ITEMS = 40;
const buildShopMeta = async ({ url, anonKey }) => {
  let products;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/get_dropship_browsable_products`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_query: '', p_limit: SHOP_ITEMS, p_offset: 0 })
    });
    products = res.ok ? await res.json() : null;
  } catch {
    products = null;
  }
  const list = Array.isArray(products) ? products : [];
  const withImage = list.find((p) => p.images?.[0]);
  const names = list.slice(0, 4).map((p) => p.name).filter(Boolean);

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Shop — Products from IcanEra Resellers',
    url: `${SITE_URL}/shop`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: list.length,
      itemListElement: list.map((p, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'Product',
          name: p.name,
          ...(p.images?.[0] && { image: p.images[0] }),
          ...(p.brand && { brand: { '@type': 'Brand', name: p.brand } }),
          ...(p.sku && { sku: p.sku }),
          offers: {
            '@type': 'AggregateOffer',
            priceCurrency: 'UGX',
            lowPrice: Number(p.min_price) || 0,
            offerCount: Number(p.reseller_count) || 1,
            availability: p.any_in_stock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            url: `${SITE_URL}/shop`
          }
        }
      }))
    }
  };

  const bodyHtml = list.length === 0 ? '' : `<noscript><main><h1>Shop — Products from IcanEra Resellers</h1><ul>${list.map((p) => `<li>${p.images?.[0] ? `<img src="${escapeAttr(p.images[0])}" alt="${escapeAttr(p.name)}" width="120" height="120"> ` : ''}${escapeHtml(p.name)} — from UGX ${Number(p.min_price || 0).toLocaleString('en-US')}</li>`).join('')}</ul><p><a href="/">IcanEra</a></p></main></noscript>`;

  return {
    title: 'Shop — Products from Resellers Worldwide | IcanEra',
    description: names.length > 0
      ? `Browse and buy ${names.join(', ')} and more from IcanEra resellers. Compare prices, free delivery, pay securely.`
      : 'Browse products from IcanEra resellers. Compare prices, free delivery, pay securely.',
    image: withImage?.images?.[0] || DEFAULT_IMAGE,
    path: '/shop',
    video: null,
    structuredData,
    bodyHtml
  };
};

// The public icaneracoin price chart (/icaneracoin). The page itself is client-rendered, so this is what makes
// it findable: a crawler that never runs JS still gets the title, the live price and a readable summary.
// Reads only the anon-granted functions the page calls (ican_get_market_snapshot, ican_get_public_candles) and
// never writes anything -- a crawler visit cannot move or paint the chart.
const COIN_TITLE = 'icaneracoin (ICAN) Price Chart — Live Candlestick Chart & Analysis | IcanEra';
const COIN_BLURB = 'Live icaneracoin (ICAN) price chart: real-time candlesticks, trend, RSI, moving averages, support and resistance, built from real IcanEra transactions.';
const buildCoinMeta = async ({ url, anonKey }) => {
  const rpc = async (fn, body) => {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const rows = res.ok ? await res.json() : null;
      return Array.isArray(rows) ? rows : null;
    } catch {
      return null;
    }
  };
  const [snapshotRows, candleRows] = await Promise.all([
    rpc('ican_get_market_snapshot', {}),
    rpc('ican_get_public_candles', { p_limit: 120 }),
  ]);
  const snapshot = snapshotRows?.[0];
  const candles = candleRows || [];

  const priceUgx = Number(snapshot?.price_ugx ?? candles[0]?.close_price);
  const priceUsd = Number(snapshot?.price_usd);
  const hasPrice = Number.isFinite(priceUgx) && priceUgx > 0;
  const fmt = (n, max = 2) => Number(n).toLocaleString('en-US', { maximumFractionDigits: max });

  // candles come newest first
  let rangeText = '';
  if (candles.length > 1) {
    const high = Math.max(...candles.map((c) => Number(c.high_price)));
    const low = Math.min(...candles.map((c) => Number(c.low_price)));
    const oldestOpen = Number(candles[candles.length - 1].open_price);
    const newestClose = Number(candles[0].close_price);
    if ([high, low, oldestOpen, newestClose].every(Number.isFinite) && oldestOpen > 0) {
      const change = ((newestClose - oldestOpen) / oldestOpen) * 100;
      rangeText = `Across the last ${candles.length} five-minute candles it has ${change > 0 ? 'risen' : change < 0 ? 'fallen' : 'held steady'}${change === 0 ? '' : ` ${Math.abs(change).toFixed(2)}%`}, trading between UGX ${fmt(low)} and UGX ${fmt(high)}.`;
    }
  }

  const priceText = hasPrice
    ? `icaneracoin is currently UGX ${fmt(priceUgx)}${Number.isFinite(priceUsd) && priceUsd > 0 ? ` (about USD ${fmt(priceUsd, 6)})` : ''}.`
    : '';
  const description = [priceText, COIN_BLURB].filter(Boolean).join(' ').slice(0, 300);
  const pageUrl = `${SITE_URL}/icaneracoin`;

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: COIN_TITLE,
      url: pageUrl,
      description: COIN_BLURB,
      ...(candles[0]?.close_time && { dateModified: new Date(candles[0].close_time).toISOString() }),
      isPartOf: { '@type': 'WebSite', name: 'IcanEra', url: SITE_URL },
      about: {
        '@type': 'Thing',
        name: 'icaneracoin',
        alternateName: ['ICAN', 'IcanEra coin'],
        description: 'icaneracoin (ICAN) is the coin behind IcanEra, a blockchain application for sending money across the globe and managing business and personal finances.'
      }
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'IcanEra', item: SITE_URL },
        { '@type': 'ListItem', position: 2, name: 'icaneracoin price chart', item: pageUrl }
      ]
    }
  ];

  const bodyHtml = `<noscript><main><h1>icaneracoin (ICAN) price chart</h1>${priceText ? `<p>${escapeHtml(priceText)}</p>` : ''}${rangeText ? `<p>${escapeHtml(rangeText)}</p>` : ''}<p>${escapeHtml(COIN_BLURB)}</p><p>icaneracoin is the coin behind IcanEra, a blockchain application for sending money across the globe. Every candle on the chart is built from real transactions on the platform.</p><p><a href="/?auth=signup">Create a free IcanEra account</a> to buy, sell and send icaneracoin. <a href="/">IcanEra home</a></p></main></noscript>`;

  return {
    title: COIN_TITLE,
    description,
    image: DEFAULT_IMAGE,
    path: '/icaneracoin',
    video: null,
    structuredData,
    bodyHtml
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
// schema.org JobPosting employmentType values for this app's employment_type column.
const JOB_EMPLOYMENT_TYPES = {
  full_time: 'FULL_TIME',
  part_time: 'PART_TIME',
  contract: 'CONTRACTOR',
  internship: 'INTERN',
  temporary: 'TEMPORARY',
  volunteer: 'VOLUNTEER',
};
const MAX_JOB_POSTINGS_IN_LD = 20;
const MAX_LINKED_POSTS_IN_BODY = 15;

const plainText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const toIsoDate = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
};
const isJobOpen = (post) => {
  if (post.post_type !== 'job') return false;
  if (!post.application_deadline) return true;
  // application_deadline is a plain DATE: open through the end of that day.
  return new Date(`${post.application_deadline}T23:59:59Z`).getTime() >= Date.now();
};

// Google for Jobs reads JobPosting structured data from the page itself, so every open job on a business's
// board gets one -- this is what makes "<role> at <business>" searchable on Google, not just the business name.
const buildJobPostingLd = ({ post, company, companyId, logo, sameAs }) => {
  const posted = toIsoDate(post.published_at);
  const validThrough = post.application_deadline ? toIsoDate(`${post.application_deadline}T23:59:59Z`) : null;
  const employmentType = JOB_EMPLOYMENT_TYPES[post.employment_type];
  const locality = post.location || company.location;
  return {
    '@context': 'https://schema.org',
    '@type': 'JobPosting',
    title: post.title,
    description: plainText(post.body || post.summary || post.title, 5000),
    url: `${SITE_URL}/notices/${companyId}?post=${post.id}`,
    directApply: true,
    ...(posted && { datePosted: posted }),
    ...(validThrough && { validThrough }),
    ...(employmentType && { employmentType }),
    hiringOrganization: {
      '@type': 'Organization',
      name: company.company_name,
      ...(sameAs[0] && { sameAs: sameAs[0] }),
      ...(logo && { logo }),
    },
    ...(locality && { jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: locality } } }),
  };
};

// What a crawler that never runs this app's JS (and any visitor with scripts off) sees inside #root: the
// business's facts and real links to each public post, which is also how crawlers discover the post pages.
const buildNoticeBodyHtml = ({ company, companyId, posts, activePost }) => {
  const contact = [
    company.location && `<li>Location: ${escapeHtml(company.location)}</li>`,
    company.hours_text && `<li>Hours: ${escapeHtml(company.hours_text)}</li>`,
    company.phone && `<li>Phone: <a href="tel:${escapeAttr(company.phone.replace(/[^\d+]/g, ''))}">${escapeHtml(company.phone)}</a></li>`,
    company.email && `<li>Email: <a href="mailto:${escapeAttr(company.email)}">${escapeHtml(company.email)}</a></li>`,
  ].filter(Boolean).join('');
  const postLink = (post) => `<li><a href="/notices/${escapeAttr(companyId)}?post=${escapeAttr(post.id)}">${escapeHtml(post.title)}</a>${post.summary ? ` — ${escapeHtml(plainText(post.summary, 160))}` : ''}</li>`;
  const jobs = posts.filter((post) => post.post_type === 'job').slice(0, MAX_LINKED_POSTS_IN_BODY);
  const news = posts.filter((post) => post.post_type !== 'job').slice(0, MAX_LINKED_POSTS_IN_BODY);
  const activeBlock = activePost
    ? `<article><h1>${escapeHtml(activePost.title)}</h1><p>${escapeHtml(company.company_name)}</p>${activePost.summary ? `<p>${escapeHtml(activePost.summary)}</p>` : ''}<p>${escapeHtml(plainText(activePost.body, 3000))}</p><p><a href="/notices/${escapeAttr(companyId)}">More from ${escapeHtml(company.company_name)}</a></p></article>`
    : `<h1>${escapeHtml(company.company_name)}</h1>${company.tagline ? `<p>${escapeHtml(company.tagline)}</p>` : ''}${company.about ? `<p>${escapeHtml(plainText(company.about, 1500))}</p>` : ''}`;
  return `<noscript><main>${activeBlock}${contact ? `<ul>${contact}</ul>` : ''}${news.length ? `<h2>News</h2><ul>${news.map(postLink).join('')}</ul>` : ''}${jobs.length ? `<h2>Careers</h2><ul>${jobs.map(postLink).join('')}</ul>` : ''}<p><a href="/">IcanEra</a></p></main></noscript>`;
};

// The one branch that builds real structured data, not just an OG preview --
// see the module doc comment for why. Reads the exact same anon-granted RPCs
// (fn_get_public_cmms_company_header / fn_get_public_cmms_notices)
// PublicCompanyNoticeBoard.jsx itself calls, so this can never show a
// business fact the live page wouldn't. fn_get_public_cmms_notices (unlike the
// single-post RPC) does not count a view, so a crawler visit can't inflate a
// post's view count. postId (?post=) turns the page into that one post's own
// indexable page: its own title, description, canonical URL and JobPosting.
const buildNoticeMeta = async ({ url, anonKey, id, postId }) => {
  const rpc = async (fn, body) => {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const rows = res.ok ? await res.json() : null;
      return Array.isArray(rows) ? rows : null;
    } catch {
      return null;
    }
  };
  const [headerRows, postRows] = await Promise.all([
    rpc('fn_get_public_cmms_company_header', { p_company_id: id }),
    rpc('fn_get_public_cmms_notices', { p_company_id: id, p_post_type: null }),
  ]);
  const company = headerRows?.[0];
  if (!company) return null;
  const posts = postRows || [];
  const activePost = postId ? posts.find((post) => post.id === postId) || null : null;

  const canonicalPath = activePost ? `/notices/${id}?post=${activePost.id}` : `/notices/${id}`;
  const businessTitle = company.tagline
    ? `${company.company_name} — ${company.tagline} | IcanEra`
    : `${company.company_name}${company.industry ? ` — ${company.industry}` : ''} | IcanEra`;
  const title = activePost ? `${activePost.title} — ${company.company_name} | IcanEra` : businessTitle;
  const description = activePost
    ? (plainText(activePost.summary, 300) || plainText(activePost.body, 300) || `${activePost.title} from ${company.company_name}.`)
    : (
      company.about?.trim()
      || company.tagline?.trim()
      || `${company.company_name} on IcanEra — announcements, careers, products and contact details.`
    ).slice(0, 300);

  const [resolvedCover, resolvedLogo, resolvedPoster] = await Promise.all([
    resolveMediaUrl(company.cover_image_url, { url, anonKey, defaultBucket: 'cmms-company-profile' }),
    resolveMediaUrl(company.logo_url, { url, anonKey, defaultBucket: 'cmms-company-profile' }),
    activePost ? resolveMediaUrl(activePost.poster_url, { url, anonKey, defaultBucket: 'cmms-company-profile' }) : null,
  ]);
  const image = resolvedPoster || resolvedCover || resolvedLogo || DEFAULT_IMAGE;

  const sameAs = [company.website, ...SOCIAL_URL_FIELDS.map((field) => company[field])]
    .map(normalizeExternalUrl)
    .filter(Boolean);
  const businessLd = {
    '@context': 'https://schema.org',
    '@type': 'LocalBusiness',
    name: company.company_name,
    description: plainText(company.about || company.tagline, 300) || description,
    image: resolvedCover || resolvedLogo || DEFAULT_IMAGE,
    url: `${SITE_URL}/notices/${id}`,
    ...(resolvedLogo && { logo: resolvedLogo }),
    ...(company.phone && { telephone: company.phone }),
    ...(company.email && { email: company.email }),
    ...(company.location && { address: { '@type': 'PostalAddress', addressLocality: company.location } }),
    ...(company.hours_text && { openingHours: company.hours_text }),
    ...(company.industry && { knowsAbout: company.industry }),
    ...(sameAs.length > 0 && { sameAs }),
  };

  const jobLd = (post) => buildJobPostingLd({ post, company, companyId: id, logo: resolvedLogo, sameAs });
  let structuredData;
  if (activePost) {
    const postLd = activePost.post_type === 'job'
      ? (isJobOpen(activePost) ? jobLd(activePost) : null)
      : {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        headline: plainText(activePost.title, 110),
        description,
        image: [image],
        ...(toIsoDate(activePost.published_at) && { datePublished: toIsoDate(activePost.published_at) }),
        author: { '@type': 'Organization', name: company.company_name },
        publisher: { '@type': 'Organization', name: company.company_name, ...(resolvedLogo && { logo: { '@type': 'ImageObject', url: resolvedLogo } }) },
        mainEntityOfPage: `${SITE_URL}${canonicalPath}`,
      };
    structuredData = postLd ? [businessLd, postLd] : businessLd;
  } else {
    const openJobs = posts.filter(isJobOpen).slice(0, MAX_JOB_POSTINGS_IN_LD).map(jobLd);
    structuredData = openJobs.length ? [businessLd, ...openJobs] : businessLd;
  }

  return {
    title,
    description,
    image,
    path: canonicalPath,
    video: null,
    ogType: activePost && activePost.post_type !== 'job' ? 'article' : 'business.business',
    structuredData,
    bodyHtml: buildNoticeBodyHtml({ company, companyId: id, posts, activePost }),
  };
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

  patched = patched.replace('</head>', () => `  ${tags}\n</head>`);
  // Crawlable fallback content for visitors that never run the SPA's JS
  // (<noscript>, so it is invisible to everyone else).
  return meta.bodyHtml ? patched.replace('<div id="root"></div>', () => `<div id="root">${meta.bodyHtml}</div>`) : patched;
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
    : type === 'shop' ? '/shop'
    : type === 'coin' ? '/icaneracoin'
    : '/';
  let meta = { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION, image: DEFAULT_IMAGE, path: fallbackPath, video: null };
  // If the live price can't be fetched, /icaneracoin must still be titled and described as the coin chart.
  if (type === 'coin') meta = { ...meta, title: COIN_TITLE, description: COIN_BLURB };

  const VALID_TYPES = ['status', 'pitch', 'store', 'notices'];
  if (url && anonKey && (id || type === 'shop' || type === 'coin') && (VALID_TYPES.includes(type) || type === 'shop' || type === 'coin')) {
    try {
      const resolved = type === 'status' ? await buildStatusMeta({ url, anonKey, id })
        : type === 'pitch' ? await buildPitchMeta({ url, anonKey, id })
        : type === 'store' ? await buildStoreMeta({ url, anonKey, id })
        : type === 'shop' ? await buildShopMeta({ url, anonKey })
        : type === 'coin' ? await buildCoinMeta({ url, anonKey })
        : await buildNoticeMeta({ url, anonKey, id, postId: typeof req.query.post === 'string' && /^[0-9a-f-]{36}$/i.test(req.query.post) ? req.query.post.toLowerCase() : null });
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
