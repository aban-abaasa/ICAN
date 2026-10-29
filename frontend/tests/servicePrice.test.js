import test from 'node:test';
import assert from 'node:assert/strict';
import { servicePriceKind, isFixedPrice, servicePriceText } from '../src/utils/servicePrice.js';

const fmt = (n, cur = 'UGX') => `${String(cur || 'UGX').toUpperCase()} ${Number(n).toLocaleString('en-US')}`;

test('a service is a fixed price, a range or on request', () => {
  assert.equal(servicePriceKind({ price: 300000, price_max: null }), 'fixed');
  assert.equal(servicePriceKind({ price: 20000, price_max: 50000 }), 'range');
  assert.equal(servicePriceKind({ price: null }), 'quote');
  assert.equal(servicePriceKind({ price: 0 }), 'quote');
  assert.equal(servicePriceKind({}), 'quote');
  // a top that is not above the bottom is not a range
  assert.equal(servicePriceKind({ price: 20000, price_max: 20000 }), 'fixed');
  assert.equal(servicePriceKind({ price: 20000, price_max: 10 }), 'fixed');
});

test('only one fixed price can be paid for on the site', () => {
  assert.equal(isFixedPrice({ price: 300000 }), true);
  assert.equal(isFixedPrice({ price: 20000, price_max: 50000 }), false);
  assert.equal(isFixedPrice({ price: null }), false);
});

test('price text shows one price, a range or a quote request', () => {
  assert.equal(servicePriceText({ price: 300000, currency: 'UGX' }, fmt), 'UGX 300,000');
  assert.equal(servicePriceText({ price: 20000, price_max: 50000, currency: 'UGX' }, fmt), 'UGX 20,000 - 50,000');
  assert.equal(servicePriceText({ price: 20, price_max: 50, currency: 'usd' }, fmt), 'USD 20 - 50');
  assert.equal(servicePriceText({ price: null }, fmt), 'Ask for a quote');
});
