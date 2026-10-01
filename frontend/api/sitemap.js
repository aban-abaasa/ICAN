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

const rpcPage = async (supabaseUrl, anonKey, offset) => {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/fn_browse_public_cmms_notices`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_post_type: null, p_limit: PAGE_SIZE, p_offset: offset }),
  });
  if (!response.ok) throw new Error(`Public CMMS sitemap query failed (${response.status}).`);
  return response.json();
};

const addPublicBusinesses = (posts, companies) => {
  for (const post of posts) {
    if (!post.cmms_company_id) continue;
    const previousDate = companies.get(post.cmms_company_id);
    if (!previousDate || (post.published_at && post.published_at > previousDate)) {
      companies.set(post.cmms_company_id, post.published_at || '');
    }
  }
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
    const firstPage = await rpcPage(supabaseUrl, anonKey, 0);
    addPublicBusinesses(firstPage, companies);

    let offset = PAGE_SIZE;
    let reachedEnd = firstPage.length < PAGE_SIZE;
    while (!reachedEnd && offset < MAX_POSTS) {
      const offsets = Array.from(
        { length: Math.min(5, (MAX_POSTS - offset) / PAGE_SIZE) },
        (_, index) => offset + index * PAGE_SIZE,
      );
      const pages = await Promise.all(offsets.map((pageOffset) => rpcPage(supabaseUrl, anonKey, pageOffset)));
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
    const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${SITE_URL}/</loc></url>${companyUrls}</urlset>`;

    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, s-maxage=21600, stale-while-revalidate=86400');
    res.status(200).send(xml);
  } catch (error) {
    console.error('[sitemap] failed to load public CMMS businesses:', error);
    res.status(502).send('Sitemap temporarily unavailable.');
  }
}
