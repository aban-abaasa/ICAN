import test from 'node:test';
import assert from 'node:assert/strict';
import { ratesFromRows } from '../src/utils/fxRates.js';

test('ratesFromRows inverts UGX-per-unit into units-per-UGX', () => {
  const r = ratesFromRows([{ currency_code: 'USD', rate_to_ugx: '4088.733' }, { currency_code: 'kes', rate_to_ugx: 31.52 }]);
  assert.ok(Math.abs(r.USD - 1 / 4088.733) < 1e-12);
  assert.ok(Math.abs(r.KES - 1 / 31.52) < 1e-12);
});

test('a USD round trip through the server rate returns the same money', () => {
  const { USD } = ratesFromRows([{ currency_code: 'USD', rate_to_ugx: 4088.733 }]);
  const price = 6000; // UGX per coin
  const coins = 10 / USD / price; // CountryService.localToIcan
  const back = coins * price * USD; // CountryService.icanToLocal
  assert.ok(Math.abs(back - 10) < 1e-9);
});

test('junk rows are skipped and never become NaN or Infinity rates', () => {
  const r = ratesFromRows([
    { currency_code: 'EUR', rate_to_ugx: 0 },
    { currency_code: 'GBP', rate_to_ugx: -5 },
    { currency_code: 'JPY', rate_to_ugx: 'abc' },
    { currency_code: 'CHF', rate_to_ugx: null },
    { currency_code: 'TOOLONG', rate_to_ugx: 10 },
    { currency_code: '', rate_to_ugx: 10 },
    null,
    undefined,
    { currency_code: 'NGN', rate_to_ugx: 3.07 },
  ]);
  assert.deepEqual(Object.keys(r), ['NGN']);
});

test('UGX is never overridden, and empty input is harmless', () => {
  assert.deepEqual(ratesFromRows([{ currency_code: 'UGX', rate_to_ugx: 2 }]), {});
  assert.deepEqual(ratesFromRows(undefined), {});
  assert.deepEqual(ratesFromRows([]), {});
});
