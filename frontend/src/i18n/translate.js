/**
 * The translator: dictionary lookup with a safe fallback chain, and locale-aware formatting.
 * Pure (no React/DOM) so it can run under `npm test`.
 *
 * Lookup order for t(key): current language -> English -> the `fallback` text the caller passed
 * -> the key itself. So a screen that is only partly translated shows English for the gaps, and
 * code can adopt t() one string at a time with t('settings.title', 'Settings').
 */
import { DEFAULT_LANGUAGE, getIntlLocale, normalizeLanguage } from './languages.js';
import en from './translations/en.js';
import sw from './translations/sw.js';
import lg from './translations/lg.js';
import rw from './translations/rw.js';
import fr from './translations/fr.js';
import es from './translations/es.js';
import pt from './translations/pt.js';
import de from './translations/de.js';
import ar from './translations/ar.js';
import hi from './translations/hi.js';
import zh from './translations/zh.js';

export const DICTIONARIES = { en, sw, lg, rw, fr, es, pt, de, ar, hi, zh };

const interpolate = (text, params) => {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) => (params[name] != null ? String(params[name]) : match));
};

/** Translate `key` into `language`. `params` fills {placeholders}. */
export const translate = (language, key, fallback, params) => {
  // Allow t(key, params) as well as t(key, fallback, params).
  if (fallback && typeof fallback === 'object') { params = fallback; fallback = undefined; }
  const lang = normalizeLanguage(language) || DEFAULT_LANGUAGE;
  const text = DICTIONARIES[lang]?.[key] ?? DICTIONARIES[DEFAULT_LANGUAGE][key] ?? fallback ?? key;
  return interpolate(text, params);
};

/** Locale-aware number / money / date formatters for a language + country. Each falls back to a
 *  plain string if the browser has no data, so a formatting problem never breaks a screen. */
export const makeFormatters = (language, countryCode) => {
  const locale = getIntlLocale(language, countryCode);
  const safe = (fn, fallbackFn) => (...args) => {
    try { return fn(...args); } catch (_) { return fallbackFn(...args); }
  };
  return {
    locale,
    formatNumber: safe(
      (value, options) => new Intl.NumberFormat(locale, options).format(Number(value) || 0),
      (value) => String(Number(value) || 0),
    ),
    /** Money in the user's locale: formatMoney(15000, 'UGX') -> "UGX 15,000" / "15 000 UGX" ... */
    formatMoney: safe(
      (value, currency, options) => new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency || 'USD',
        maximumFractionDigits: 2,
        ...options,
      }).format(Number(value) || 0),
      (value, currency) => `${currency || ''} ${Number(value) || 0}`.trim(),
    ),
    formatDate: safe(
      (value, options) => new Intl.DateTimeFormat(locale, options || { dateStyle: 'medium' }).format(new Date(value)),
      (value) => String(value),
    ),
    formatDateTime: safe(
      (value, options) => new Intl.DateTimeFormat(locale, options || { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)),
      (value) => String(value),
    ),
    /** A country's name in the user's language ("Ouganda", "Uganda", "أوغندا"); falls back to the
     *  English name we already have when the browser has no region names for this language. */
    countryName: (code, fallbackName) => {
      try {
        const name = new Intl.DisplayNames([locale], { type: 'region' }).of(String(code || '').toUpperCase());
        if (name && name !== String(code).toUpperCase()) return name;
      } catch (_) { /* unsupported locale or code */ }
      return fallbackName || code || '';
    },
    formatRelativeTime: safe(
      (value, unit) => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit),
      (value, unit) => `${value} ${unit}`,
    ),
  };
};
