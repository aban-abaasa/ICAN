import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SITE_ORIGIN, ROUTE_SITE_SLUGS, BRAND_SITE_SLUGS, isAppRouteSlug, isReservedSiteSlug, hasSiteSlugShape, siteSlugProblem,
  slugifyBusinessName, suggestSiteSlug, siteSlugFromPathname, businessSitePath, buildBusinessSiteUrl, displayBusinessSiteUrl,
} from '../src/utils/businessSiteUrl.js';
import { PRODUCT_OWNER, PRODUCT_OWNER_SLUG, PRODUCT_OWNER_URL } from '../src/constants/brand.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.join(root, '..');
const read = (...parts) => readFileSync(path.join(...parts), 'utf8');
const migration = read(repo, 'supabase', 'migrations', '20261105100000_business_site_slugs.sql');

// icanera.space/<business-name>: what an address looks like, and how a name becomes one.

test('a business name becomes a readable address', () => {
  assert.equal(slugifyBusinessName('Supermart Kera'), 'supermart-kera');
  assert.equal(slugifyBusinessName('GODMINDERA ORGANISATION (U) LTD'), 'godmindera-organisation-u-ltd');
  assert.equal(slugifyBusinessName('Café Déjà Vu & Sons'), 'cafe-deja-vu-and-sons');
  assert.equal(slugifyBusinessName('  B$A   --  Co.  '), 'b-a-co');
  assert.equal(slugifyBusinessName('Straße Æther Œuvre'), 'strasse-aether-oeuvre');
  assert.equal(slugifyBusinessName('!!! ???'), '');
  assert.equal(slugifyBusinessName(null), '');
});

test('the suggested address follows the database rules (3-60 characters, never reserved)', () => {
  assert.equal(suggestSiteSlug('Kampala Mart'), 'kampala-mart');
  assert.equal(suggestSiteSlug('!!!'), 'business');
  assert.equal(suggestSiteSlug('X'), 'x-business');
  assert.equal(suggestSiteSlug('Shop'), 'shop-business');
  assert.equal(suggestSiteSlug('IcanEra'), 'icanera-business');
  const long = suggestSiteSlug('Very Long Business Name '.repeat(6));
  assert.ok(long.length <= 60 && !long.endsWith('-'), long);
  assert.ok(hasSiteSlugShape(long));
});

test('what counts as a well-formed address', () => {
  for (const ok of ['abc', 'kampala-mart', 'a1-b2-c3', '123', 'x'.repeat(60)]) assert.ok(hasSiteSlugShape(ok), ok);
  for (const bad of ['', 'ab', 'x'.repeat(61), '-abc', 'abc-', 'a--b', 'a b', 'a_b', 'a.b', 'a/b', 'é']) assert.ok(!hasSiteSlugShape(bad), bad);
});

test('a refused address says why, in plain words', () => {
  assert.match(siteSlugProblem('ab'), /3 to 60/);
  assert.match(siteSlugProblem('my shop'), /letters, numbers/);
  assert.match(siteSlugProblem('pricing'), /reserved/);
  assert.match(siteSlugProblem('IcanEra'), /reserved/);
  assert.equal(siteSlugProblem('kampala-mart'), null);
  assert.equal(siteSlugProblem('  Kampala-Mart  '), null);
});

// Routing: which paths are business sites.

test('only a bare, well-formed, non-reserved path is a business site', () => {
  assert.equal(siteSlugFromPathname('/kampala-mart'), 'kampala-mart');
  assert.equal(siteSlugFromPathname('/Kampala-Mart/'), 'kampala-mart');
  assert.equal(siteSlugFromPathname('/godmindera-organisation-u-ltd'), PRODUCT_OWNER_SLUG);
  for (const other of ['/', '', '/pricing', '/shop', '/notices/abc', '/a/b', '/favicon.svg', '/sw.js', '/ab', '/-abc', '/a--b', '/icaneracoin/data', '/index.html']) {
    assert.equal(siteSlugFromPathname(other), null, other);
  }
});

test('every page the app serves is reserved, so a business can never shadow one', () => {
  const sources = [read(root, 'src', 'main.jsx'), read(root, 'src', 'App.jsx'), read(root, 'vercel.json')].join('\n');
  const found = new Set();
  for (const m of sources.matchAll(/\^\\\/([a-z][a-z0-9-]*)/g)) found.add(m[1]);               // /^\/name... regular expressions
  for (const m of sources.matchAll(/pathname\s*===?\s*'\/([a-z][a-z0-9-]*)'/g)) found.add(m[1]); // pathname === '/name'
  for (const m of sources.matchAll(/"source":\s*"\/([a-z][a-z0-9-]*)(?:\/|")/g)) found.add(m[1]); // vercel.json rewrites
  assert.ok(found.size > 15, `expected to find the app's routes, found ${[...found].join(', ')}`);
  for (const slug of found) {
    if (slug.length < 3) continue; // an address has at least 3 characters, so /r and /p can never clash
    assert.ok(isReservedSiteSlug(slug), `/${slug} is a page of the app but a business could take it as an address: add it to ROUTE_SITE_SLUGS and fn_site_slug_is_reserved`);
  }
});

test('the platform pages and brands are reserved', () => {
  for (const slug of ['pricing', 'shop', 'notices', 'icaneracoin', 'developers', 'api', 'staff-attendance']) assert.ok(isAppRouteSlug(slug), slug);
  for (const slug of ['icanera', 'godmindera', 'supermartkera', 'bodagoera']) { assert.ok(isReservedSiteSlug(slug), slug); assert.ok(!isAppRouteSlug(slug), slug); }
  assert.ok(!isReservedSiteSlug('godmindera-organisation-u-ltd'), "the owner's own business is not reserved");
});

test('the reserved words are the same in the database and in the app', () => {
  const arrayIn = (functionName) => {
    const body = migration.slice(migration.indexOf(`FUNCTION public.${functionName}`));
    const list = /ARRAY\[([\s\S]*?)\]/.exec(body)[1];
    return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  };
  assert.deepEqual(arrayIn('fn_site_slug_is_brand'), [...BRAND_SITE_SLUGS].sort(), 'brand names differ between fn_site_slug_is_brand and BRAND_SITE_SLUGS');
  assert.deepEqual(arrayIn('fn_site_slug_is_reserved'), [...ROUTE_SITE_SLUGS].sort(), 'routes differ between fn_site_slug_is_reserved and ROUTE_SITE_SLUGS');
  assert.equal(new Set(ROUTE_SITE_SLUGS).size, ROUTE_SITE_SLUGS.length, 'duplicate route');
  for (const brand of BRAND_SITE_SLUGS) assert.ok(!ROUTE_SITE_SLUGS.includes(brand), `${brand} is listed twice`);
});

test('the name -> address table is the same in the database and in the app', () => {
  const sqlFrom = /translate\([\s\S]*?\n\s*'([^']+)',\n\s*'([^']*(?:' \|\| '[^']*)*)'/.exec(migration);
  assert.ok(sqlFrom, 'could not find the accent table in the migration');
  const sqlTo = sqlFrom[2].split("' || '").join('');
  assert.equal(sqlFrom[1].length, sqlTo.length, 'the SQL accent table is unbalanced');
  // the JS table is applied through slugifyBusinessName: every accented letter must fold the way SQL says
  Array.from(sqlFrom[1]).forEach((character, index) => assert.equal(slugifyBusinessName(`a${character}a`), `a${sqlTo[index]}a`, character));
});

// Links.

test('a link uses the address when it is known, and the old always-valid link when it is not', () => {
  assert.equal(SITE_ORIGIN, 'https://icanera.space');
  assert.equal(businessSitePath({ slug: 'kampala-mart', companyId: 'c1' }), '/kampala-mart');
  assert.equal(businessSitePath({ companyId: 'c1' }), '/notices/c1');
  assert.equal(businessSitePath({ slug: 'not valid!', companyId: 'c1' }), '/notices/c1');
  assert.equal(buildBusinessSiteUrl({ slug: 'kampala-mart' }), 'https://icanera.space/kampala-mart');
  assert.equal(buildBusinessSiteUrl({ slug: 'Kampala-Mart', query: { post: 'p1' } }), 'https://icanera.space/kampala-mart?post=p1');
  assert.equal(buildBusinessSiteUrl({ slug: 'kampala-mart', query: '?pay=1' }), 'https://icanera.space/kampala-mart?pay=1');
  assert.equal(buildBusinessSiteUrl({ companyId: 'c1', query: { tab: 'library' } }), 'https://icanera.space/notices/c1?tab=library');
  assert.equal(buildBusinessSiteUrl({ slug: 'kampala-mart', query: {} }), 'https://icanera.space/kampala-mart');
  assert.equal(displayBusinessSiteUrl('Kampala-Mart'), 'icanera.space/kampala-mart');
});

test('the GODMINDERA credit points at its own business site in the same format', () => {
  assert.equal(PRODUCT_OWNER, 'GODMINDERA ORGANISATION (U) LTD');
  assert.equal(PRODUCT_OWNER_SLUG, slugifyBusinessName(PRODUCT_OWNER));
  assert.equal(PRODUCT_OWNER_URL, `https://icanera.space/${PRODUCT_OWNER_SLUG}`);
  assert.equal(PRODUCT_OWNER_URL, buildBusinessSiteUrl({ slug: PRODUCT_OWNER_SLUG }));
  assert.ok(hasSiteSlugShape(PRODUCT_OWNER_SLUG) && !isReservedSiteSlug(PRODUCT_OWNER_SLUG));
});

// The host: /<address> reaches the page that gives a business its link preview and SEO; every app page keeps going where it went.

test('vercel.json sends a business address to share-preview, and only an address', () => {
  const rewrites = JSON.parse(read(root, 'vercel.json')).rewrites;
  const index = rewrites.findIndex((rule) => rule.source.startsWith('/:slug('));
  assert.ok(index > -1, 'no /:slug rewrite in vercel.json');
  const rule = rewrites[index];
  assert.equal(rule.destination, '/api/share-preview?type=site&slug=:slug');

  // after every specific rule, before the catch-all that hands everything else to the app
  assert.ok(index > rewrites.findIndex((r) => r.source === '/developers/'), 'the /developers rewrites must come first');
  assert.ok(index < rewrites.findIndex((r) => r.source.startsWith('/((?!api/')), 'the catch-all must come last');

  // it must exclude exactly the pages of the app...
  const group = rule.source.slice('/:slug('.length, -1);
  const excluded = /^\(\?!([^)]*)\)/.exec(group)[1].split('|').map((word) => word.replace(/\$$/, '')).sort();
  assert.deepEqual(excluded, [...ROUTE_SITE_SLUGS].sort(), 'the rewrite must skip every reserved page and nothing else');

  // ...and behave like the real thing on real paths
  const matches = (pathname) => new RegExp(`^/(${group})/?$`, 'i').test(pathname);
  for (const yes of ['/kampala-mart', '/godmindera-organisation-u-ltd', '/abc', '/Kampala-Mart/', '/icanera']) assert.ok(matches(yes), yes);
  for (const no of ['/', '/pricing', '/shop', '/notices', '/notices/abc', '/staff-attendance', '/api', '/ab', '/sw.js', '/favicon.svg', '/manifest.json', '/a/b']) assert.ok(!matches(no), no);
});

test('the server functions share the address rules instead of copying them', () => {
  const util = read(root, 'src', 'utils', 'businessSiteUrl.js');
  assert.ok(!/^\s*import\s/m.test(util), 'businessSiteUrl.js must stay dependency-free: the server functions import it');
  assert.match(read(root, 'api', 'share-preview.js'), /from '\.\.\/src\/utils\/businessSiteUrl\.js'/);
  assert.match(read(root, 'api', 'sitemap.js'), /from '\.\.\/src\/utils\/businessSiteUrl\.js'/);
});
