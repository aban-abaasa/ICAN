import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTRY_LANGUAGES, LANGUAGES, SUPPORTED_LANGUAGES, detectBrowserLanguage, getDefaultLanguageForCountry,
  getDirection, getIntlLocale, getLanguagesForCountry, getUntranslatedNationalLanguage, normalizeLanguage,
} from '../src/i18n/languages.js';
import { DICTIONARIES, makeFormatters, translate } from '../src/i18n/translate.js';
import { CountryService } from '../src/services/countryService.js';

const placeholders = (text) => (String(text).match(/\{\w+\}/g) || []).sort().join(',');

test('every language in the registry has a dictionary and vice versa', () => {
  assert.deepEqual([...Object.keys(DICTIONARIES)].sort(), [...SUPPORTED_LANGUAGES].sort());
});

test('every dictionary is complete and keeps the same {placeholders} as English', () => {
  const en = DICTIONARIES.en;
  for (const [lang, dict] of Object.entries(DICTIONARIES)) {
    for (const key of Object.keys(en)) {
      assert.ok(dict[key], `${lang} is missing "${key}"`);
      assert.equal(placeholders(dict[key]), placeholders(en[key]), `${lang} "${key}" changes the {placeholders}`);
    }
    for (const key of Object.keys(dict)) assert.ok(key in en, `${lang} has unknown key "${key}"`);
  }
});

test('every country the app offers at sign-up has a language entry', () => {
  for (const code of Object.keys(CountryService.getCountries())) {
    assert.ok(COUNTRY_LANGUAGES[code], `no language mapping for ${code}`);
  }
  for (const code of Object.keys(COUNTRY_LANGUAGES)) {
    assert.ok(CountryService.getCountry(code), `language mapping for unknown country ${code}`);
  }
});

test('countries open in their own language, or English when it is not translated yet', () => {
  assert.equal(getDefaultLanguageForCountry('FR'), 'fr');
  assert.equal(getDefaultLanguageForCountry('MX'), 'es');
  assert.equal(getDefaultLanguageForCountry('BR'), 'pt');
  assert.equal(getDefaultLanguageForCountry('EG'), 'ar');
  assert.equal(getDefaultLanguageForCountry('TZ'), 'sw');
  assert.equal(getDefaultLanguageForCountry('RW'), 'rw');
  assert.equal(getDefaultLanguageForCountry('UG'), 'en');
  assert.equal(getDefaultLanguageForCountry('JP'), 'en'); // Japanese not translated yet
  assert.equal(getDefaultLanguageForCountry('ZZ'), 'en');
  assert.equal(getDefaultLanguageForCountry(undefined), 'en');
  assert.equal(getUntranslatedNationalLanguage('JP'), 'ja');
  assert.equal(getUntranslatedNationalLanguage('FR'), null);
});

test('a country offers its own languages first, English always available, no duplicates', () => {
  assert.deepEqual(getLanguagesForCountry('UG'), ['en', 'sw', 'lg']);
  assert.deepEqual(getLanguagesForCountry('RW'), ['rw', 'fr', 'en', 'sw']);
  assert.deepEqual(getLanguagesForCountry('CA'), ['en', 'fr']);
  assert.deepEqual(getLanguagesForCountry(null), ['en']);
  for (const code of Object.keys(COUNTRY_LANGUAGES)) {
    const list = getLanguagesForCountry(code);
    assert.equal(new Set(list).size, list.length);
    assert.ok(list.includes('en'));
  }
});

test('normalizeLanguage and browser detection accept regional tags and reject the unknown', () => {
  assert.equal(normalizeLanguage('FR-ca'), 'fr');
  assert.equal(normalizeLanguage('pt_BR'), 'pt');
  assert.equal(normalizeLanguage('xx'), null);
  assert.equal(normalizeLanguage(''), null);
  assert.equal(detectBrowserLanguage({ languages: ['ja-JP', 'es-MX', 'en'], language: 'ja-JP' }), 'es');
  assert.equal(detectBrowserLanguage({ languages: ['ja-JP'], language: 'ja-JP' }), null);
});

test('Arabic is right-to-left, everything else left-to-right', () => {
  assert.equal(getDirection('ar'), 'rtl');
  for (const l of LANGUAGES.filter((x) => x.code !== 'ar')) assert.equal(l.dir, 'ltr');
});

test('translate: language, English fallback, supplied fallback, then the key; placeholders fill', () => {
  assert.equal(translate('fr', 'nav.settings'), 'Paramètres');
  assert.equal(translate('xx', 'nav.settings'), 'Settings');
  assert.equal(translate('fr', 'no.such.key', 'Plain English'), 'Plain English');
  assert.equal(translate('fr', 'no.such.key'), 'no.such.key');
  assert.equal(translate('fr', 'country.detected', { name: 'Kenya' }), 'Nous avons détecté votre position : Kenya');
  assert.equal(translate('en', 'settings.suggested', { country: 'Uganda' }), 'Suggested for Uganda');
  // a missing placeholder value is left visible rather than printing "undefined"
  assert.equal(translate('en', 'settings.suggested', {}), 'Suggested for {country}');
});

test('formatters follow the language and country and never throw', () => {
  const ugEn = makeFormatters('en', 'UG');
  assert.match(ugEn.formatMoney(1500000, 'UGX', { maximumFractionDigits: 0 }), /1,500,000/);
  const fr = makeFormatters('fr', 'FR');
  assert.match(fr.formatNumber(1234567.5), /1\s234\s567,5/);
  assert.equal(typeof fr.countryName('UG', 'Uganda'), 'string');
  assert.equal(fr.countryName('ZZZZ', 'Nowhere'), 'Nowhere');
  assert.ok(makeFormatters('lg', 'UG').formatDate('2026-10-09').length > 0);
  assert.equal(typeof getIntlLocale('rw', 'RW'), 'string');
  assert.equal(typeof makeFormatters('en', 'UG').formatDate('not a date'), 'string'); // bad input never throws
});
