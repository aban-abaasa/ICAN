/**
 * The decisions behind whole-app translation, kept free of the DOM so they run under `npm test`:
 * which strings are worth translating, how whitespace is preserved, the instant dictionary-backed
 * phrase table, and the per-language cache of AI translations.
 */

const LETTER = /\p{L}/gu;
const LATIN_LETTER = /[A-Za-zÀ-ɏ]/g;

// Strings that are data or identifiers, not interface wording.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URLISH = /^(https?:\/\/|www\.)\S+$/i;
const IDENTIFIER = /^[A-Za-z0-9_\-:.#/]{16,}$/; // uuids, hashes, wallet addresses, tokens, file names

export const MAX_TEXT_CHARS = 300;

/** Leading/trailing whitespace is kept exactly; only the middle is translated. */
export const splitEdges = (text) => {
  const m = String(text).match(/^(\s*)([\s\S]*?)(\s*)$/);
  return { lead: m[1], core: m[2], trail: m[3] };
};

/**
 * Is this English interface wording? False for numbers, amounts, ids, emails, links, acronyms and
 * text that is already in another script - sending those would cost money and could only damage them.
 */
export const shouldTranslate = (core) => {
  if (typeof core !== 'string') return false;
  const text = core.trim();
  if (text.length < 2 || text.length > MAX_TEXT_CHARS) return false;
  const letters = text.match(LETTER) || [];
  if (letters.length < 2) return false;
  if (EMAIL.test(text) || URLISH.test(text) || IDENTIFIER.test(text)) return false;
  // Mostly Latin script = English source. Text already in Arabic / Hindi / Chinese etc. is left alone.
  const latin = text.match(LATIN_LETTER) || [];
  if (latin.length / letters.length < 0.7) return false;
  // Short all-caps tokens are codes or acronyms (UGX, KYC, USD 5,000), not sentences.
  const words = text.replace(/[^A-Za-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  if (words.length > 0 && words.length <= 2 && words.every((w) => w === w.toUpperCase() && w.length <= 5)) return false;
  return true;
};

/**
 * Numbers are swapped for {0}, {1}, ... before a string is looked up or sent, so "You have 3 new
 * alerts" and "You have 4 new alerts" are ONE translation ("You have {0} new alerts"), translated once
 * and cached, and the real numbers are put back afterwards. This is also why a changing counter does
 * not cost a request per value.
 */
const NUMBER = /\d+(?:[.,]\d+)*/g;

export const abstractNumbers = (core) => {
  const values = [];
  const key = String(core).replace(NUMBER, (match) => { values.push(match); return `{${values.length - 1}}`; });
  return { key, values };
};

export const restoreNumbers = (text, values) => String(text).replace(/\{(\d+)\}/g, (m, i) => (values[Number(i)] !== undefined ? values[Number(i)] : m));

const tokensOf = (text) => (String(text).match(/\{\d+\}/g) || []).sort().join(',');

/** A translation is only usable if it kept exactly the same {n} number tokens as its source. */
export const tokensMatch = (source, translation) => tokensOf(source) === tokensOf(translation);

/** Leading emoji / symbols ("🏦 SACCO", "✨ Create") are kept verbatim around the phrase. */
export const splitSymbols = (core) => {
  const m = String(core).match(/^([^\p{L}\p{N}]*)([\s\S]*)$/u);
  return { symbols: m[1], rest: m[2] };
};

const normalize = (text) => String(text).replace(/\s+/g, ' ').trim();

/**
 * English text -> translation for every string the dictionaries already cover. Instant, free and
 * hand-checked, so it is consulted before the AI. Built from the same dictionaries the t() calls use.
 */
export const buildPhraseTable = (english, target) => {
  const table = new Map();
  for (const key of Object.keys(english)) {
    if (target[key] && !/\{\w+\}/.test(english[key])) table.set(normalize(english[key]), target[key]);
  }
  return table;
};

/** The set of strings that are already in the target language (output of t()), to skip re-translating. */
export const buildKnownTarget = (target) => new Set(Object.values(target).map(normalize));

export const lookupPhrase = (table, core) => {
  const direct = table.get(normalize(core));
  if (direct !== undefined) return direct;
  const { symbols, rest } = splitSymbols(core);
  if (symbols) {
    const hit = table.get(normalize(rest));
    if (hit !== undefined) return symbols + hit;
  }
  return undefined;
};

// ---------------------------------------------------------------------------------------------
// Cache of AI translations: one entry per English string per language, kept on the device so a
// screen is translated once and then appears instantly (and offline) on every later visit.
// ---------------------------------------------------------------------------------------------
const CACHE_VERSION = 'v1';
export const CACHE_MAX_ENTRIES = 4000;

export const createCache = (storage, language) => {
  const key = `ican.tr.${CACHE_VERSION}.${language}`;
  let map = new Map();
  try {
    const raw = storage && storage.getItem(key);
    if (raw) map = new Map(Object.entries(JSON.parse(raw)));
  } catch (_) { map = new Map(); }

  let timer = null;
  const flush = () => {
    timer = null;
    try {
      if (storage) storage.setItem(key, JSON.stringify(Object.fromEntries(map)));
    } catch (_) { /* storage full or blocked: the memory cache still works for this session */ }
  };

  return {
    get: (text) => map.get(text),
    has: (text) => map.has(text),
    set: (text, value) => {
      map.delete(text);
      map.set(text, value);
      while (map.size > CACHE_MAX_ENTRIES) map.delete(map.keys().next().value); // oldest first
      if (!timer) timer = setTimeout(flush, 800);
    },
    flush,
    get size() { return map.size; },
  };
};

export const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};
