import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CACHE_MAX_ENTRIES, buildKnownTarget, buildPhraseTable, chunk, createCache, lookupPhrase,
  shouldTranslate, splitEdges, splitSymbols,
} from '../src/i18n/pageTranslatorCore.js';
import { DICTIONARIES } from '../src/i18n/translate.js';

test('shouldTranslate accepts interface wording and rejects data', () => {
  for (const ok of ['Send Money', 'Your wallet is empty', 'Balance: UGX 5,000', 'Tithe', 'Pay now!', 'Où êtes-vous ?']) {
    assert.equal(shouldTranslate(ok), true, ok);
  }
  for (const no of [
    '', ' ', 'A', '12345', 'UGX 5,000', 'KYC', 'USD', 'a@b.co', 'https://icanera.space/shop',
    'www.example.com', '0x71C7656EC7ab88b098defB751B7401B5f6d8976F', '3f2a9c1e-77b4-4d3a-9d1e-aa11bb22cc33',
    'مرحبا بكم في التطبيق', 'अपना देश चुनें', '你好，世界', 'x'.repeat(301),
  ]) {
    assert.equal(shouldTranslate(no), false, JSON.stringify(no).slice(0, 40));
  }
});

test('splitEdges keeps surrounding whitespace exactly', () => {
  assert.deepEqual(splitEdges('  Save \n'), { lead: '  ', core: 'Save', trail: ' \n' });
  assert.deepEqual(splitEdges('Save'), { lead: '', core: 'Save', trail: '' });
  assert.deepEqual(splitEdges('   '), { lead: '   ', core: '', trail: '' });
});

test('splitSymbols separates leading emoji', () => {
  assert.deepEqual(splitSymbols('🏦 SACCO'), { symbols: '🏦 ', rest: 'SACCO' });
  assert.deepEqual(splitSymbols('Wallet'), { symbols: '', rest: 'Wallet' });
});

test('phrase table: dictionary strings translate instantly, with emoji and whitespace tolerance', () => {
  const table = buildPhraseTable(DICTIONARIES.en, DICTIONARIES.fr);
  assert.equal(lookupPhrase(table, 'Settings'), 'Paramètres');
  assert.equal(lookupPhrase(table, 'Send   Money'), 'Envoyer de l’argent');
  assert.equal(lookupPhrase(table, '🔍 Explore'), '🔍 Explorer');
  assert.equal(lookupPhrase(table, 'Something unknown'), undefined);
  // entries with {placeholders} are not in the table (they are rendered through t())
  assert.equal(lookupPhrase(table, 'Suggested for {country}'), undefined);
});

test('known-target set recognises text that is already translated', () => {
  const known = buildKnownTarget(DICTIONARIES.sw);
  assert.ok(known.has('Mipangilio'));
  assert.ok(!known.has('Settings'));
});

test('cache persists per language, is bounded, and tolerates broken storage', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const a = createCache(storage, 'sw');
  a.set('Hello there', 'Habari yako');
  a.flush();
  assert.equal(createCache(storage, 'sw').get('Hello there'), 'Habari yako');
  assert.equal(createCache(storage, 'fr').get('Hello there'), undefined);

  const big = createCache(null, 'de');
  for (let i = 0; i < CACHE_MAX_ENTRIES + 50; i += 1) big.set(`text ${i}`, `t${i}`);
  assert.equal(big.size, CACHE_MAX_ENTRIES);
  assert.equal(big.has('text 0'), false); // oldest dropped
  assert.equal(big.has(`text ${CACHE_MAX_ENTRIES + 49}`), true);

  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } };
  const safe = createCache(broken, 'es');
  safe.set('x y', 'z');
  assert.doesNotThrow(() => safe.flush());
  assert.equal(safe.get('x y'), 'z');
});

test('chunk splits evenly with a remainder', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 3), []);
});

import { abstractNumbers, restoreNumbers, tokensMatch } from '../src/i18n/pageTranslatorCore.js';

test('numbers become {n} tokens and come back exactly', () => {
  assert.deepEqual(abstractNumbers('You have 3 new alerts'), { key: 'You have {0} new alerts', values: ['3'] });
  assert.equal(abstractNumbers('You have 4 new alerts').key, abstractNumbers('You have 3 new alerts').key);
  const { key, values } = abstractNumbers('Paid 5,000.50 on 12 March 2026');
  assert.equal(key, 'Paid {0} on {1} March {2}');
  assert.equal(restoreNumbers('Payé {0} le {1} mars {2}', values), 'Payé 5,000.50 le 12 mars 2026');
  assert.equal(restoreNumbers('no tokens', values), 'no tokens');
  assert.equal(restoreNumbers('unknown {9}', values), 'unknown {9}');
});

test('tokensMatch rejects a translation that lost or invented a number token', () => {
  assert.equal(tokensMatch('Paid {0} on {1}', 'Payé {1} le {0}'), true); // reordered is fine
  assert.equal(tokensMatch('Paid {0} on {1}', 'Payé {0}'), false);
  assert.equal(tokensMatch('Hello', 'Bonjour'), true);
  assert.equal(tokensMatch('Hello', 'Bonjour {0}'), false);
});
