/**
 * App-wide language. The language is derived, in this order, from:
 *   1. the user's explicit choice in Settings (a language code), saved on this device and on their
 *      account so it follows them to another phone;
 *   2. otherwise their country (user_accounts.country_code, picked at sign-up) -> that country's
 *      first translated language;
 *   3. otherwise the browser's language, then English.
 * Number, date and money formatting follow language + country (fr-CA, sw-KE, ...), and <html>
 * gets lang/dir so Arabic flips the page right-to-left.
 *
 * Mount inside <AuthProvider> (it reads the signed-in user). Outside a provider, useI18n() still
 * works and returns English, so shared components never crash on a standalone public page.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase/client';
import {
  DEFAULT_LANGUAGE, LANGUAGES, detectBrowserLanguage, getDirection, getLanguage,
  getDefaultLanguageForCountry, getLanguagesForCountry, getUntranslatedNationalLanguage,
  normalizeLanguage,
} from './languages';
import { makeFormatters, translate } from './translate';

const PREF_KEY = 'ican.language';
const COUNTRY_KEY = 'ican.country';
export const COUNTRY_CHANGED_EVENT = 'ican:country-changed';

const readStore = (key) => {
  try { return localStorage.getItem(key); } catch (_) { return null; }
};
const writeStore = (key, value) => {
  try {
    if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value);
  } catch (_) { /* private mode / storage blocked: the choice just won't survive a reload */ }
};

const makeValue = (language, extra = {}) => ({
  language,
  dir: getDirection(language),
  preference: 'auto',
  country: null,
  countryLanguages: [DEFAULT_LANGUAGE],
  untranslatedNationalLanguage: null,
  languages: LANGUAGES,
  setLanguage: () => {},
  previewCountry: () => {},
  t: (key, fallback, params) => translate(language, key, fallback, params),
  ...makeFormatters(language, null),
  ...extra,
});

const I18nContext = createContext(makeValue(DEFAULT_LANGUAGE));

export const useI18n = () => useContext(I18nContext);

/** Shorthand when a component only needs the translator. */
export const useT = () => useContext(I18nContext).t;

/** Tell the i18n layer the user's country just changed (CountrySetup / profile edits call this). */
export const announceCountryChange = (countryCode) => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(COUNTRY_CHANGED_EVENT, { detail: { country: countryCode } }));
};

export function I18nProvider({ children }) {
  const { user } = useAuth();
  const userId = user?.id || null;
  const savedOnAccount = user?.user_metadata?.language || null;

  const [preference, setPreference] = useState(() => {
    const stored = readStore(PREF_KEY);
    return stored && normalizeLanguage(stored) ? normalizeLanguage(stored) : 'auto';
  });
  const [accountCountry, setAccountCountry] = useState(() => readStore(COUNTRY_KEY));
  // The country picked on the sign-up form, before any account exists.
  const [draftCountry, setDraftCountry] = useState(null);

  // The account's country: it decides the automatic language.
  useEffect(() => {
    if (!userId) return undefined;
    let off = false;
    supabase.from('user_accounts').select('country_code').eq('user_id', userId).limit(1).maybeSingle()
      .then(({ data }) => {
        if (off || !data?.country_code) return;
        setAccountCountry(data.country_code);
        writeStore(COUNTRY_KEY, data.country_code);
      })
      .catch(() => { /* offline: keep the cached country */ });
    return () => { off = true; };
  }, [userId]);

  // A choice made on another device: adopt it if this device has not chosen anything yet.
  useEffect(() => {
    if (!userId || readStore(PREF_KEY)) return;
    const remote = savedOnAccount === 'auto' ? 'auto' : normalizeLanguage(savedOnAccount);
    if (remote) setPreference(remote);
  }, [userId, savedOnAccount]);

  // CountrySetup (or a profile edit) changed the country: follow it straight away.
  useEffect(() => {
    const onChange = (event) => {
      const next = event?.detail?.country;
      if (!next) return;
      setAccountCountry(next);
      writeStore(COUNTRY_KEY, next);
      setDraftCountry(null);
    };
    window.addEventListener(COUNTRY_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(COUNTRY_CHANGED_EVENT, onChange);
  }, []);

  const country = userId ? accountCountry : (draftCountry || accountCountry);

  const language = useMemo(() => {
    if (preference !== 'auto') return preference;
    if (country) return getDefaultLanguageForCountry(country);
    return detectBrowserLanguage() || DEFAULT_LANGUAGE;
  }, [preference, country]);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
    root.dir = getDirection(language);
  }, [language]);

  const setLanguage = useCallback((next) => {
    const value = next === 'auto' ? 'auto' : normalizeLanguage(next);
    if (!value) return;
    setPreference(value);
    writeStore(PREF_KEY, value);
    // Best effort: remember it on the account so it follows the user to other devices.
    if (userId) supabase.auth.updateUser({ data: { language: value } }).catch(() => {});
  }, [userId]);

  const previewCountry = useCallback((code) => setDraftCountry(code || null), []);

  const value = useMemo(() => makeValue(language, {
    preference,
    country,
    countryLanguages: getLanguagesForCountry(country),
    untranslatedNationalLanguage: getUntranslatedNationalLanguage(country),
    setLanguage,
    previewCountry,
    ...makeFormatters(language, country),
  }), [language, preference, country, setLanguage, previewCountry]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export { getLanguage };
export default I18nProvider;
