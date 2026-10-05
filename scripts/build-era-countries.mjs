#!/usr/bin/env node
/**
 * Builds frontend/public/developers/countries.json, the country list on the developer page.
 *
 * It is NOT a new list. It is the app's existing country lookup, flattened so a static page can read it:
 *   - frontend/src/constants/countries.js   the shared dropdown list (ISO code + name), "the single source of truth"
 *   - frontend/src/services/countryService.js   flag, currency and region for each country it knows
 *
 *   node scripts/build-era-countries.mjs           write the file
 *   node scripts/build-era-countries.mjs --check   exit 1 if the file is out of date (run in CI)
 *
 * The file is shared with the sibling apps by scripts/sync-era-api.mjs.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'frontend/public/developers/countries.json');

export async function buildCountries() {
  const { COUNTRIES } = await import(pathToFileURL(join(root, 'frontend/src/constants/countries.js')).href);
  const { CountryService } = await import(pathToFileURL(join(root, 'frontend/src/services/countryService.js')).href);
  const rich = CountryService.getCountries();
  const flagOf = (code) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  const rows = COUNTRIES.filter((c) => /^[A-Z]{2}$/.test(c.code)).map((c) => {
    const r = rich[c.code] || {};
    return { code: c.code, name: c.name, flag: r.flag || flagOf(c.code), currency: r.currency || null, region: r.region || null };
  });
  // countries only the richer service knows about are kept too, so nothing the apps can pick is missing here
  for (const [code, r] of Object.entries(rich)) {
    if (/^[A-Z]{2}$/.test(code) && !rows.some((x) => x.code === code)) rows.push({ code, name: r.name, flag: r.flag || flagOf(code), currency: r.currency || null, region: r.region || null });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return JSON.stringify({ source: 'frontend/src/constants/countries.js + frontend/src/services/countryService.js', countries: rows }, null, 1) + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const text = await buildCountries();
  if (process.argv.includes('--check')) {
    const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === text;
    console.log(same ? 'countries.json is up to date.' : 'countries.json is out of date. Run: node scripts/build-era-countries.mjs');
    process.exit(same ? 0 : 1);
  }
  writeFileSync(OUT, text);
  console.log(`wrote ${OUT} (${JSON.parse(text).countries.length} countries)`);
}
