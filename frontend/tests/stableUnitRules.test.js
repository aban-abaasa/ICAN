import test from 'node:test';
import assert from 'node:assert/strict';
import {
  floor8, rateToUgx, previewBuy, previewSell, validateBuy, validateSell, friendlyStableError, mapSwapResult, historyToRows, rateAge, currencyDecimals, fmtMoney,
} from '../src/utils/stableUnitRules.js';

const quote = { unit_ugx: 4022.802, fee_bps: 50, max_trade_ugx: 5000000, currencies: { UGX: 4022.802, USD: 1, KES: 127.633 } };

test('rateToUgx: UGX per one unit of a currency, from the quote', () => {
  assert.equal(rateToUgx(quote, 'UGX'), 1);
  assert.ok(Math.abs(rateToUgx(quote, 'USD') - 4022.802) < 1e-9);
  assert.equal(rateToUgx(quote, 'XXX'), null);
  assert.equal(rateToUgx(null, 'UGX'), null);
});

test('previewBuy: fee off first, then units rounded down (the same numbers the database test checks)', () => {
  const p = previewBuy({ amount: 100000, currency: 'UGX', quote });
  assert.equal(p.gross, 100000);
  assert.equal(p.fee, 500);
  assert.equal(p.units, floor8(99500 / 4022.802));
  assert.equal(previewBuy({ amount: 0, currency: 'UGX', quote }), null);
  assert.equal(previewBuy({ amount: 5, currency: 'ZZZ', quote }), null);
});

test('previewSell: value less the fee, paid into the wallet rounded down to 2 places', () => {
  const p = previewSell({ units: 10, currency: 'UGX', quote });
  assert.equal(p.gross, 40228.02);
  assert.equal(p.fee, 201.1401);
  assert.equal(p.local, Math.floor((40228.02 - 201.1401) * 100) / 100);
});

test('validateBuy / validateSell: the sentences the screen shows', () => {
  assert.match(validateBuy({ amount: '', balance: 10, quote, currency: 'UGX' }), /how much/);
  assert.match(validateBuy({ amount: 500, balance: 100, quote, currency: 'UGX' }), /enough/);
  assert.match(validateBuy({ amount: 0.001, balance: 100, quote, currency: 'UGX' }), /too small/);
  assert.match(validateBuy({ amount: 6000000, balance: 9e9, quote, currency: 'UGX' }), /most you can swap/);
  assert.equal(validateBuy({ amount: 1000, balance: 5000, quote, currency: 'UGX' }), null);
  assert.match(validateSell({ units: 5, held: 2, quote, currency: 'UGX' }), /do not hold/);
  assert.equal(validateSell({ units: 1, held: 2, quote, currency: 'UGX' }), null);
});

test('friendlyStableError / mapSwapResult', () => {
  assert.match(friendlyStableError({ code: 'price_moved', unit_ugx: 4100 }), /4,100/);
  assert.match(friendlyStableError({ code: 'capacity_reached' }), /capacity/);
  assert.equal(friendlyStableError({ code: 'x', error: 'Server words' }), 'Server words');
  assert.equal(mapSwapResult({ success: true, units: '2', unit_ugx: '4000', pay_amount: '8000', pay_currency: 'UGX' }).units, 2);
  assert.equal(mapSwapResult(null).success, false);
});

test('historyToRows: oldest first, each hour opens where the last closed, bad points dropped', () => {
  const rows = historyToRows([
    { t: '2026-10-15T12:00:00Z', v: 4030 }, { t: '2026-10-15T11:00:00Z', v: 4020 }, { t: 'nope', v: 1 }, { t: '2026-10-15T10:00:00Z', v: 0 },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { open_time: '2026-10-15T11:00:00Z', open_price: 4020, high_price: 4020, low_price: 4020, close_price: 4020, trading_volume: 0 });
  assert.equal(rows[1].open_price, 4020);
  assert.equal(rows[1].close_price, 4030);
  assert.equal(rows[1].high_price, 4030);
  assert.deepEqual(historyToRows(null), []);
});

test('rateAge: how old the live rates are, in words', () => {
  const now = Date.parse('2026-10-15T12:00:00Z');
  assert.equal(rateAge('2026-10-15T11:59:30Z', now), 'just now');
  assert.equal(rateAge('2026-10-15T11:18:00Z', now), '42 min ago');
  assert.equal(rateAge('2026-10-15T09:00:00Z', now), '3 h ago');
});

test('currencyDecimals / fmtMoney: pounds, yen and dinars are shown the way their people read them', () => {
  assert.equal(currencyDecimals('JPY'), 0);
  assert.equal(currencyDecimals('gbp'), 2);
  assert.equal(currencyDecimals('KWD'), 3);
  assert.equal(currencyDecimals('UGX'), 2);
  assert.equal(fmtMoney(1234.5, 'GBP'), '£1,234.50');
  assert.equal(fmtMoney(158.31, 'JPY'), '¥158');
  assert.equal(fmtMoney(0.7562, 'GBP', { precise: true }), '£0.7562');
  assert.equal(fmtMoney(0.7562, 'GBP'), '£0.76');
  assert.equal(fmtMoney('x', 'GBP'), '—');
  assert.match(fmtMoney(5, 'ZZZZ'), /5 ZZZZ/);
});

test('previews cut to the currency\'s own decimals, like the database: 1,000.75 yen is 1,000 yen', () => {
  const q = { unit_ugx: 4022.802, fee_bps: 50, max_trade_ugx: 5e9, currencies: { UGX: 4022.802, JPY: 158.3, GBP: 0.7562 } };
  assert.equal(previewBuy({ amount: 1000.75, currency: 'JPY', quote: q }).local, 1000);
  assert.equal(previewBuy({ amount: 10.999, currency: 'GBP', quote: q }).local, 10.99);
  const sell = previewSell({ units: 2, currency: 'JPY', quote: q });
  assert.equal(Number.isInteger(sell.local), true);
});
