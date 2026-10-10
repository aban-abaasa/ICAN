const SITE_URL = 'https://icanera.space';
const PAGE_SIZE = 50;
const MAX_POSTS = 5000;

const escapeXml = (value) => String(value).replace(/[<>&"']/g, (character) => ({
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&apos;',
}[character]));

// Two sources, same shape for the caller: the business directory (every
// business listed on the landing search, with or without posts --
// CMMS_PUBLIC_BUSINESS_DIRECTORY_SEARCH.sql) and, as a fallback if that SQL
// hasn't been run yet, the notices feed (only businesses with a public post).
const SOURCES = {
  directory: { fn: 'fn_search_public_cmms_businesses', body: (offset) => ({ p_query: null, p_limit: PAGE_SIZE, p_offset: offset }) },
  notices: { fn: 'fn_browse_public_cmms_notices', body: (offset) => ({ p_post_type: null, p_limit: PAGE_SIZE, p_offset: offset }) },
};

const rpcPage = async (supabaseUrl, anonKey, offset, source) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${source.fn}`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(source.body(offset)),
  });
  if (!response.ok) throw new Error(`Public CMMS sitemap query failed (${response.status}).`);
  return response.json();
};

const addPublicBusinesses = (posts, companies) => {
  for (const post of posts) {
    // directory rows carry `id` (the company); notice rows carry `cmms_company_id`
    const companyId = post.cmms_company_id || post.id;
    if (!companyId) continue;
    const previousDate = companies.get(companyId);
    if (!previousDate || (post.published_at && post.published_at > previousDate)) {
      companies.set(companyId, post.published_at || '');
    }
  }
};

// Reseller storefronts (/store/<id>) from the same anon-granted RPC the
// Resellers tab uses. Optional: if DROPSHIP_RESELLERS_DIRECTORY.sql hasn't been
// run yet this returns [] and the sitemap simply omits them.
const fetchResellerIds = async (supabaseUrl, anonKey) => {
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/get_dropship_resellers`, {
      method: 'POST',
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_query: '', p_limit: 500, p_offset: 0 }),
    });
    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? rows.map((row) => row.business_profile_id).filter(Boolean) : [];
  } catch {
    return [];
  }
};

// Every public notice and job as its own URL (/notices/<company>?post=<id>) -- the same address the page
// canonicalises to (api/share-preview.js), so each opening can show up in Google (and Google for Jobs) by name.
// Optional like the reseller list: any failure just leaves the post URLs out of the sitemap.
const MAX_POST_URLS = 2000;
const fetchPostEntries = async (supabaseUrl, anonKey) => {
  const entries = [];
  try {
    for (let offset = 0; offset < MAX_POST_URLS; offset += PAGE_SIZE * 5) {
      const offsets = Array.from({ length: 5 }, (_, index) => offset + index * PAGE_SIZE);
      const pages = await Promise.all(offsets.map((pageOffset) => rpcPage(supabaseUrl, anonKey, pageOffset, SOURCES.notices)));
      let reachedEnd = false;
      for (const page of pages) {
        if (!Array.isArray(page)) { reachedEnd = true; break; }
        for (const post of page) {
          if (post.id && post.cmms_company_id) entries.push({ companyId: post.cmms_company_id, postId: post.id, publishedAt: post.published_at });
        }
        if (page.length < PAGE_SIZE) { reachedEnd = true; break; }
      }
      if (reachedEnd) break;
    }
  } catch (error) {
    console.warn('[sitemap] could not list individual posts:', error.message);
  }
  return entries;
};

export default async function handler(_req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    res.status(503).send('Sitemap temporarily unavailable.');
    return;
  }

  try {
    const companies = new Map();
    let source = SOURCES.directory;
    let firstPage;
    try {
      firstPage = await rpcPage(supabaseUrl, anonKey, 0, source);
    } catch (directoryError) {
      console.warn('[sitemap] directory RPC unavailable, falling back to notices feed:', directoryError.message);
      source = SOURCES.notices;
      firstPage = await rpcPage(supabaseUrl, anonKey, 0, source);
    }
    addPublicBusinesses(firstPage, companies);

    let offset = PAGE_SIZE;
    let reachedEnd = firstPage.length < PAGE_SIZE;
    while (!reachedEnd && offset < MAX_POSTS) {
      const offsets = Array.from(
        { length: Math.min(5, (MAX_POSTS - offset) / PAGE_SIZE) },
        (_, index) => offset + index * PAGE_SIZE,
      );
      const pages = await Promise.all(offsets.map((pageOffset) => rpcPage(supabaseUrl, anonKey, pageOffset, source)));
      for (let index = 0; index < pages.length; index += 1) {
        addPublicBusinesses(pages[index], companies);
        if (pages[index].length < PAGE_SIZE) {
          reachedEnd = true;
          break;
        }
      }
      offset += offsets.length * PAGE_SIZE;
    }

    const companyUrls = Array.from(companies, ([companyId, lastModified]) => (
      `<url><loc>${SITE_URL}/notices/${escapeXml(companyId)}</loc>${lastModified ? `<lastmod>${escapeXml(new Date(lastModified).toISOString())}</lastmod>` : ''}</url>`
    )).join('');
    const resellerUrls = (await fetchResellerIds(supabaseUrl, anonKey))
      .map((resellerId) => `<url><loc>${SITE_URL}/store/${escapeXml(resellerId)}</loc></url>`).join('');
    const postUrls = (await fetchPostEntries(supabaseUrl, anonKey)).map((entry) => (
      `<url><loc>${SITE_URL}/notices/${escapeXml(entry.companyId)}?post=${escapeXml(entry.postId)}</loc>${entry.publishedAt ? `<lastmod>${escapeXml(new Date(entry.publishedAt).toISOString())}</lastmod>` : ''}</url>`
    )).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_URL}/</loc></url><url><loc>${SITE_URL}/icaneracoin</loc><changefreq>hourly</changefreq></url><url><loc>${SITE_URL}/shop</loc><changefreq>daily</changefreq></url>${resellerUrls}${companyUrls}${postUrls}</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    res.status(200).send(xml);
  } catch (error) {
    console.error('[sitemap] failed to load public CMMS businesses:', error);
    res.status(502).send('Sitemap temporarily unavailable.');
  }
}
