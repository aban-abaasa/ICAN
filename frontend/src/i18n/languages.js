/**
 * Languages ICAN can speak, and which languages belong to which country.
 *
 * COUNTRY_LANGUAGES lists, for every country in CountryService, its languages in order of
 * preference (national / most widely spoken first). The app picks the FIRST one that has a
 * dictionary (SUPPORTED_LANGUAGES); a country whose own language is not translated yet falls
 * back to English rather than showing half-translated screens. Adding a dictionary in
 * ./translations and a row in LANGUAGES is all it takes for those countries to switch over.
 *
 * Pure data + functions (no React, no DOM) so it can run under `npm test`.
 */

// Languages that have a dictionary. `dir` drives the page direction (Arabic is right-to-left).
export const LANGUAGES = [
  { code: 'en', name: 'English', native: 'English', dir: 'ltr' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili', dir: 'ltr' },
  { code: 'lg', name: 'Luganda', native: 'Luganda', dir: 'ltr' },
  { code: 'rw', name: 'Kinyarwanda', native: 'Ikinyarwanda', dir: 'ltr' },
  { code: 'fr', name: 'French', native: 'Français', dir: 'ltr' },
  { code: 'es', name: 'Spanish', native: 'Español', dir: 'ltr' },
  { code: 'pt', name: 'Portuguese', native: 'Português', dir: 'ltr' },
  { code: 'de', name: 'German', native: 'Deutsch', dir: 'ltr' },
  { code: 'ar', name: 'Arabic', native: 'العربية', dir: 'rtl' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी', dir: 'ltr' },
  { code: 'zh', name: 'Chinese', native: '中文', dir: 'ltr' },
];

export const DEFAULT_LANGUAGE = 'en';
export const SUPPORTED_LANGUAGES = LANGUAGES.map((l) => l.code);
const LANGUAGE_BY_CODE = Object.fromEntries(LANGUAGES.map((l) => [l.code, l]));

// Languages are listed with ISO 639-1 codes (639-2 where there is no 2-letter code). Codes with no
// dictionary yet (am, so, nl, ...) are kept on purpose: they take effect the day one is added.
export const COUNTRY_LANGUAGES = {
  // East Africa
  UG: ['en', 'sw', 'lg'], KE: ['en', 'sw'], TZ: ['sw', 'en'], RW: ['rw', 'fr', 'en', 'sw'],
  DJ: ['fr', 'ar'], ER: ['ti', 'ar', 'en'], ET: ['am', 'en'], SO: ['so', 'ar', 'en'],
  KM: ['fr', 'ar'], SC: ['en', 'fr'], BW: ['en'], ZA: ['en'], NA: ['en'], LS: ['en'], SZ: ['en'],
  MZ: ['pt', 'en'], ZM: ['en'], ZW: ['en'], MG: ['mg', 'fr', 'en'], MU: ['en', 'fr'],
  // West & Central Africa
  NG: ['en'], GH: ['en'], CI: ['fr'], SN: ['fr'], ML: ['fr'], BF: ['fr'], NE: ['fr'], TG: ['fr'],
  BJ: ['fr'], LR: ['en'], SL: ['en'], GM: ['en'], GW: ['pt'], GN: ['fr'], CV: ['pt'],
  CM: ['fr', 'en'], CG: ['fr'], CD: ['fr', 'sw'], GA: ['fr'], GQ: ['es', 'fr', 'pt'], ST: ['pt'],
  CF: ['fr'], TD: ['fr', 'ar'], AO: ['pt'],
  // North Africa
  EG: ['ar'], DZ: ['ar', 'fr'], MA: ['ar', 'fr'], TN: ['ar', 'fr'], LY: ['ar'], SD: ['ar', 'en'],
  // The Americas
  US: ['en', 'es'], CA: ['en', 'fr'], MX: ['es'], GT: ['es'], SV: ['es'], HN: ['es'], NI: ['es'],
  CR: ['es'], PA: ['es'], BZ: ['en', 'es'], BS: ['en'], CU: ['es'], DO: ['es'], HT: ['ht', 'fr'],
  JM: ['en'], TT: ['en'], BB: ['en'], BR: ['pt'], AR: ['es'], CL: ['es'], CO: ['es'], PE: ['es'],
  VE: ['es'], EC: ['es'], BO: ['es'], PY: ['es'], UY: ['es'], SR: ['nl', 'en'], GY: ['en'],
  // Europe
  GB: ['en'], IE: ['en'], FR: ['fr'], DE: ['de'], NL: ['nl', 'en'], BE: ['nl', 'fr', 'de', 'en'],
  LU: ['fr', 'de', 'en'], AT: ['de'], CH: ['de', 'fr', 'it'], ES: ['es'], PT: ['pt'], IT: ['it'],
  GR: ['el'], HR: ['hr'], RS: ['sr'], BA: ['bs', 'hr', 'sr'], ME: ['sr'], AL: ['sq'], MK: ['mk'],
  BG: ['bg'], RO: ['ro'], SE: ['sv'], NO: ['no'], DK: ['da'], FI: ['fi'], IS: ['is'], LT: ['lt'],
  LV: ['lv'], EE: ['et'], PL: ['pl'], CZ: ['cs'], SK: ['sk'], HU: ['hu'], UA: ['uk', 'ru'],
  BY: ['be', 'ru'], RU: ['ru'], MD: ['ro', 'ru'],
  // Middle East
  SA: ['ar'], AE: ['ar', 'en'], QA: ['ar', 'en'], KW: ['ar'], OM: ['ar'], BH: ['ar'],
  IL: ['he', 'ar', 'en'], PS: ['ar'], JO: ['ar'], LB: ['ar', 'fr'], SY: ['ar'], TR: ['tr'],
  IQ: ['ar'], IR: ['fa'], AF: ['fa', 'ps'],
  // Asia
  IN: ['hi', 'en'], PK: ['ur', 'en'], BD: ['bn', 'en'], LK: ['si', 'ta', 'en'], NP: ['ne'],
  BT: ['dz', 'en'], MV: ['dv', 'en'], CN: ['zh'], JP: ['ja'], KR: ['ko'], MN: ['mn'], TW: ['zh'],
  HK: ['zh', 'en'], MO: ['zh', 'pt'], TH: ['th'], MY: ['ms', 'en', 'zh'], SG: ['en', 'zh', 'ms'],
  ID: ['id'], PH: ['fil', 'en'], VN: ['vi'], KH: ['km'], LA: ['lo'], MM: ['my'], BN: ['ms', 'en'],
  TL: ['pt', 'en'],
  // Oceania
  AU: ['en'], NZ: ['en'], FJ: ['en'], PG: ['en'], VU: ['en', 'fr'], WS: ['en'], KI: ['en'],
  TO: ['en'], MH: ['en'], FM: ['en'], PW: ['en'], NR: ['en'], SB: ['en'], NC: ['fr'],
};

export const isSupportedLanguage = (code) => Boolean(code) && code in LANGUAGE_BY_CODE;

export const getLanguage = (code) => LANGUAGE_BY_CODE[code] || LANGUAGE_BY_CODE[DEFAULT_LANGUAGE];

export const getDirection = (code) => getLanguage(code).dir;

/** Normalise 'FR-ca', 'fr_CA', 'fr' -> 'fr' (and reject anything we cannot translate). */
export const normalizeLanguage = (value) => {
  const base = String(value || '').trim().toLowerCase().split(/[-_]/)[0];
  return isSupportedLanguage(base) ? base : null;
};

/** The supported languages that suit a country, best first. English is always last so the
 *  picker can offer it. Unknown or missing country -> just English. */
export const getLanguagesForCountry = (countryCode) => {
  const wanted = COUNTRY_LANGUAGES[String(countryCode || '').toUpperCase()] || [];
  const out = [];
  for (const code of [...wanted, DEFAULT_LANGUAGE]) {
    if (isSupportedLanguage(code) && !out.includes(code)) out.push(code);
  }
  return out;
};

/** The language a country should open in: its first translated language, else English. */
export const getDefaultLanguageForCountry = (countryCode) => getLanguagesForCountry(countryCode)[0];

/** The language a country *speaks* even if we cannot translate it yet (for the Settings note
 *  "Kinyarwanda is coming soon"); null when we already cover its first language. */
export const getUntranslatedNationalLanguage = (countryCode) => {
  const first = (COUNTRY_LANGUAGES[String(countryCode || '').toUpperCase()] || [])[0];
  return first && !isSupportedLanguage(first) ? first : null;
};

/** Best match from the browser's own preference list (used before we know the user's country). */
export const detectBrowserLanguage = (navigatorLike) => {
  const nav = navigatorLike || (typeof navigator !== 'undefined' ? navigator : null);
  const list = nav ? [...(nav.languages || []), nav.language] : [];
  for (const entry of list) {
    const code = normalizeLanguage(entry);
    if (code) return code;
  }
  return null;
};

/**
 * The BCP-47 tag used for numbers, dates and currency: language + country, so a French speaker in
 * Canada gets "fr-CA" formatting, a Swahili speaker in Kenya "sw-KE". Falls back to the bare
 * language, then English, when the browser has no data for the combination.
 */
export const getIntlLocale = (language, countryCode) => {
  const lang = normalizeLanguage(language) || DEFAULT_LANGUAGE;
  const country = String(countryCode || '').toUpperCase();
  const candidates = [country ? `${lang}-${country}` : null, lang, DEFAULT_LANGUAGE].filter(Boolean);
  for (const tag of candidates) {
    try {
      if (Intl.NumberFormat.supportedLocalesOf([tag]).length) return tag;
    } catch (_) { /* malformed tag: try the next one */ }
  }
  return DEFAULT_LANGUAGE;
};
