// Safe handling of Google Forms / Drive / Docs / Sheets links, and of public Google Sheets
// used as a data source. Pure functions: no network.
//
// The rules are deliberately strict because these links end up in an <iframe> and in
// a database: https only, Google's own hosts only (exact match, no userinfo, no port),
// recognised path shapes only, and the stored URL is rebuilt from the file id rather than
// copied from what was pasted. The database repeats the host check as a constraint.

const ID = /^[A-Za-z0-9_-]{6,200}$/;
const ALLOWED_HOSTS = new Set(['docs.google.com', 'drive.google.com', 'forms.gle']);

export const KIND_LABELS = {
  form: 'Google Form',
  drive_file: 'Drive file',
  drive_folder: 'Drive folder',
  doc: 'Google Doc',
  sheet: 'Google Sheet',
  slides: 'Google Slides',
};

const fail = (reason) => ({ ok: false, reason });

function parseAllowedUrl(input) {
  let text = String(input || '').trim();
  if (!text) return { error: 'Paste a Google link first.' };
  // Allow "docs.google.com/forms/..." pasted without the scheme, but never plain http.
  if (/^(docs|drive)\.google\.com\/|^forms\.gle\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    return { error: 'That does not look like a link.' };
  }
  if (url.protocol !== 'https:') return { error: 'Only secure (https) links are allowed.' };
  if (url.username || url.password || url.port) return { error: 'That link is not allowed.' };
  if (!ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return { error: 'Only Google Forms, Drive, Docs and Sheets links are supported.' };
  return { url };
}

/**
 * Classify a pasted link.
 * @returns {{ ok: true, kind, id, url, embedUrl: (string|null), label }
 *          | { ok: false, reason }}
 * `url` is rebuilt from the id (safe to store); `embedUrl` is what an iframe may load, or
 * null when the link can only be opened in a new tab (e.g. a forms.gle short link).
 */
export function classifyGoogleUrl(input) {
  const parsed = parseAllowedUrl(input);
  if (parsed.error) return fail(parsed.error);
  const { url } = parsed;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, '');
  const done = (kind, id, canonical, embedUrl) => ({ ok: true, kind, id, url: canonical, embedUrl, label: KIND_LABELS[kind] });

  if (host === 'forms.gle') {
    const code = path.slice(1);
    return ID.test(code) ? done('form', code, `https://forms.gle/${code}`, null) : fail('That form link is incomplete.');
  }

  if (host === 'docs.google.com') {
    let m = path.match(/^\/forms\/d\/e\/([^/]+)(\/.*)?$/);
    if (m && ID.test(m[1])) {
      const view = `https://docs.google.com/forms/d/e/${m[1]}/viewform`;
      return done('form', m[1], view, `${view}?embedded=true`);
    }
    m = path.match(/^\/forms\/d\/([^/]+)(\/.*)?$/);
    if (m && m[1] !== 'e' && ID.test(m[1])) {
      return done('form', m[1], `https://docs.google.com/forms/d/${m[1]}/viewform`, `https://docs.google.com/forms/d/${m[1]}/viewform?embedded=true`);
    }
    m = path.match(/^\/document\/d\/([^/]+)(\/.*)?$/);
    if (m && ID.test(m[1])) return done('doc', m[1], `https://docs.google.com/document/d/${m[1]}/view`, `https://docs.google.com/document/d/${m[1]}/preview`);
    m = path.match(/^\/spreadsheets\/d\/e\/([^/]+)(\/.*)?$/);
    if (m && ID.test(m[1])) {
      const pub = `https://docs.google.com/spreadsheets/d/e/${m[1]}/pubhtml`;
      return done('sheet', m[1], pub, `${pub}?widget=true&headers=false`);
    }
    m = path.match(/^\/spreadsheets\/d\/([^/]+)(\/.*)?$/);
    if (m && ID.test(m[1])) return done('sheet', m[1], `https://docs.google.com/spreadsheets/d/${m[1]}/view`, `https://docs.google.com/spreadsheets/d/${m[1]}/preview`);
    m = path.match(/^\/presentation\/d\/([^/]+)(\/.*)?$/);
    if (m && ID.test(m[1])) return done('slides', m[1], `https://docs.google.com/presentation/d/${m[1]}/view`, `https://docs.google.com/presentation/d/${m[1]}/embed`);
    return fail('That Google link type is not supported. Use a Form, Doc, Sheet, Slides, or a Drive file or folder.');
  }

  // drive.google.com
  let m = path.match(/^\/file\/d\/([^/]+)(\/.*)?$/);
  if (m && ID.test(m[1])) return done('drive_file', m[1], `https://drive.google.com/file/d/${m[1]}/view`, `https://drive.google.com/file/d/${m[1]}/preview`);
  m = path.match(/^\/drive(\/u\/\d+)?\/folders\/([^/]+)$/);
  if (m && ID.test(m[2])) return done('drive_folder', m[2], `https://drive.google.com/drive/folders/${m[2]}`, `https://drive.google.com/embeddedfolderview?id=${m[2]}#list`);
  if (path === '/open' || path === '/uc') {
    const id = url.searchParams.get('id') || '';
    if (ID.test(id)) return done('drive_file', id, `https://drive.google.com/file/d/${id}/view`, `https://drive.google.com/file/d/${id}/preview`);
  }
  return fail('That Drive link type is not supported. Use a file or folder link from Drive.');
}

/** True when the link may be shown in an in-app frame (the stored url is re-checked, never trusted). */
export const isEmbeddable = (storedUrl) => {
  const c = classifyGoogleUrl(storedUrl);
  return c.ok && Boolean(c.embedUrl);
};

// -------------------------------------------------------------- public Sheets

/**
 * A Google Sheet used as a public data source. Accepts a normal sheet link (shared as
 * "Anyone with the link") or a "Publish to web" CSV link. Returns { ok, storeUrl, csvUrl }.
 */
export function parseSheetSource(input) {
  const parsed = parseAllowedUrl(input);
  if (parsed.error) return fail(parsed.error);
  const { url } = parsed;
  if (url.hostname.toLowerCase() !== 'docs.google.com') return fail('Use a Google Sheets link.');
  const gid = (url.searchParams.get('gid') || url.hash.match(/gid=(\d+)/)?.[1] || '').replace(/\D/g, '');

  let m = url.pathname.match(/^\/spreadsheets\/d\/e\/([^/]+)\/pub/);
  if (m && ID.test(m[1])) {
    const base = `https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=csv${gid ? `&gid=${gid}` : ''}`;
    return { ok: true, storeUrl: base, csvUrl: base };
  }
  m = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)/);
  if (m && m[1] !== 'e' && ID.test(m[1])) {
    return {
      ok: true,
      storeUrl: `https://docs.google.com/spreadsheets/d/${m[1]}/edit${gid ? `#gid=${gid}` : ''}`,
      csvUrl: `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ''}`,
    };
  }
  return fail('That is not a Google Sheets link.');
}

/** RFC 4180-style CSV: quoted fields, "" escapes, commas and newlines inside quotes. */
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      if (row.some((cell) => cell !== '')) rows.push(row); // a row of only empty cells is a blank spreadsheet row
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((cell) => cell !== '')) rows.push(row); }
  return rows;
}

const clean = (value, max) => String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const slug = (value) => clean(value, 80).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const CATEGORIES = ['identity', 'tax', 'social', 'legal', 'health', 'finance', 'other'];

const HEADERS = {
  country: ['country', 'countries'],
  mode: ['mode', 'applies to', 'audience'],
  title: ['title', 'requirement', 'item', 'name'],
  authority: ['authority', 'agency', 'office', 'body'],
  link: ['link', 'url', 'website'],
  why: ['note', 'notes', 'description', 'why', 'details'],
  category: ['category', 'type', 'group'],
  key: ['key', 'id', 'code'],
  required: ['required', 'mandatory'],
};

const pickCol = (header, names) => header.findIndex((h) => names.includes(h));

const matchesList = (cell, wanted, aliases = {}) => {
  const raw = clean(cell, 200).toLowerCase();
  if (!raw || ['all', '*', 'any', 'both'].includes(raw)) return true;
  return raw.split(/[;,/|]+/).map((p) => p.trim()).some((p) => p === wanted.toLowerCase() || aliases[p] === wanted.toLowerCase());
};
const MODE_ALIASES = { salaried: 'se', employee: 'se', worker: 'se', business: 'bo', 'business owner': 'bo', owner: 'bo', employer: 'bo' };

const safeHttps = (value) => {
  try {
    const u = new URL(String(value || '').trim());
    return u.protocol === 'https:' && !u.username && !u.password ? u.href : '';
  } catch { return ''; }
}

/**
 * Turn CSV rows from a public Sheet into checklist items for one country and mode.
 * Columns (any order, case-insensitive): title (required), country, mode, authority, link,
 * note, category, key, required. Blank country/mode means "everyone".
 */
export function rowsToRequirements(rows, { country, mode }) {
  if (!rows.length) return { items: [], error: 'The sheet is empty.' };
  const header = rows[0].map((h) => clean(h, 40).toLowerCase());
  const col = Object.fromEntries(Object.entries(HEADERS).map(([k, names]) => [k, pickCol(header, names)]));
  if (col.title < 0) return { items: [], error: 'The sheet needs a "title" column in its first row.' };

  const seen = new Set();
  const items = [];
  for (const row of rows.slice(1, 301)) {
    const title = clean(row[col.title], 140);
    if (!title) continue;
    if (col.country >= 0 && !matchesList(row[col.country], country)) continue;
    if (col.mode >= 0 && !matchesList(row[col.mode], mode, MODE_ALIASES)) continue;

    let key = `sheet-${slug(col.key >= 0 && row[col.key] ? row[col.key] : title)}`.slice(0, 100);
    if (key === 'sheet-') continue;
    let n = 2;
    const base = key;
    while (seen.has(key)) { key = `${base}-${n}`; n += 1; }
    seen.add(key);

    const category = clean(row[col.category], 20).toLowerCase();
    const requiredCell = col.required >= 0 ? clean(row[col.required], 10).toLowerCase() : '';
    items.push({
      key,
      title,
      authority: clean(col.authority >= 0 ? row[col.authority] : '', 80),
      link: col.link >= 0 ? safeHttps(row[col.link]) : '',
      why: clean(col.why >= 0 ? row[col.why] : '', 300),
      category: CATEGORIES.includes(category) ? category : 'other',
      required: ['no', 'false', 'optional', '0', 'n'].includes(requiredCell) ? false : true,
      source: 'sheet',
    });
    if (items.length >= 100) break;
  }
  return { items, error: items.length ? null : `No rows in the sheet apply to ${country} (${mode === 'BO' ? 'business owner' : 'salaried'}).` };
}

/** Header row to paste into a new Sheet. */
export const SHEET_TEMPLATE_HEADER = 'country,mode,title,authority,link,note,category,required';
