import test from 'node:test';
import assert from 'node:assert/strict';
import {
  floor8, quoteBuy, quoteSell, validateBuy, validateSell, sectorState, friendlySectorError, mapSectorTradeResult, sectorChartRows,
  toSectorCandles, holdingResult, formatLevel, formatPct, formatPrice, changeTone, trim,
} from '../src/utils/sectorTradeRules.js';
import { mergeCandles } from '../src/utils/feedPolling.js';

// The expected numbers below are the ones the database tests (supabase/tests/sector_trading/03_trade.sql) assert for
// the real ican_sector_trade, so the preview and the trade are held to the same arithmetic.

test('floor8 rounds down to 8 decimals without float noise', () => {
  assert.equal(floor8(9.9), 9.9);                 // 9.9 * 1e8 is 989999999.9999999 in binary floating point
  assert.equal(floor8(0.1 + 0.2), 0.3);
  assert.equal(floor8(1.000000019), 1.00000001);  // never rounds a real digit up
  assert.equal(floor8(0.000000009), 0);
});

test('a buy: the fee comes off first, the rest becomes units', () => {
  assert.deepEqual(quoteBuy({ amount: 10, price: 1, feeBps: 100 }), { pay: 10, fee: 0.1, net: 9.9, units: 9.9 });
  assert.deepEqual(quoteBuy({ amount: 20, price: 1.2, feeBps: 100 }), { pay: 20, fee: 0.2, net: 19.8, units: 16.5 });
  assert.deepEqual(quoteBuy({ amount: 6, price: 1, feeBps: 100 }), { pay: 6, fee: 0.06, net: 5.94, units: 5.94 });
  assert.deepEqual(quoteBuy({ amount: 5.05, price: 1, feeBps: 100 }), { pay: 5.05, fee: 0.0505, net: 4.9995, units: 4.9995 });
  assert.deepEqual(quoteBuy({ amount: 1.2, price: 1.2, feeBps: 0 }), { pay: 1.2, fee: 0, net: 1.2, units: 1 });
});

test('a sell: units x price, less the fee', () => {
  assert.deepEqual(quoteSell({ units: 9.9, price: 1.2, feeBps: 100 }), { units: 9.9, gross: 11.88, fee: 0.1188, net: 11.7612 });
  assert.deepEqual(quoteSell({ units: 5, price: 1.2, feeBps: 100 }), { units: 5, gross: 6, fee: 0.06, net: 5.94 });
});

test('quotes are null for unusable inputs rather than NaN', () => {
  for (const bad of [0, -1, NaN, undefined, null, 'abc']) {
    assert.equal(quoteBuy({ amount: bad, price: 1, feeBps: 100 }), null);
    assert.equal(quoteBuy({ amount: 10, price: bad, feeBps: 100 }), null);
    assert.equal(quoteSell({ units: bad, price: 1, feeBps: 100 }), null);
  }
});

test('an amount that buys less than the smallest unit is refused up front', () => {
  assert.equal(quoteBuy({ amount: 0.00000001, price: 1.2, feeBps: 100 }).units, 0);
  assert.match(validateBuy({ amount: 0.00000001, balance: 10, price: 1.2, feeBps: 100 }), /too small/);
});

test('validateBuy checks the amount, the wallet and the per-trade ceiling', () => {
  const ok = { amount: 10, balance: 50, price: 1, feeBps: 100, maxTrade: 100 };
  assert.equal(validateBuy(ok), null);
  assert.match(validateBuy({ ...ok, amount: '' }), /how much/);
  assert.match(validateBuy({ ...ok, amount: 51 }), /enough/);
  assert.match(validateBuy({ ...ok, amount: 120, balance: 500 }), /most you can buy/);
  assert.equal(validateBuy({ ...ok, amount: 100, balance: 100 }), null);       // exactly at the ceiling is fine
  // paying in a money wallet: the ceiling applies to the ICEC value, the balance to the money
  assert.equal(validateBuy({ amount: 20000, balance: 80000, payIcec: 4, price: 1, feeBps: 100, maxTrade: 100 }), null);
  assert.match(validateBuy({ amount: 20000, balance: 80000, payIcec: 400, price: 1, feeBps: 100, maxTrade: 100 }), /most you can buy/);
  assert.match(validateBuy({ amount: 90000, balance: 80000, payIcec: 4, price: 1, feeBps: 100, maxTrade: 100 }), /enough/);
});

test('validateSell checks what is held and the per-trade ceiling', () => {
  const ok = { units: 5, held: 16.5, price: 1.2, feeBps: 100, maxTrade: 100 };
  assert.equal(validateSell(ok), null);
  assert.match(validateSell({ ...ok, units: 0 }), /how many/);
  assert.match(validateSell({ ...ok, units: 16.50000001 }), /do not hold/);
  assert.equal(validateSell({ ...ok, units: 16.5 }), null);                     // selling everything is fine
  assert.match(validateSell({ ...ok, units: 200, held: 500 }), /smaller parts/);
});

test('sectorState: live, warming up with progress, paused', () => {
  const live = { status: 'live', tradable: true };
  assert.deepEqual(sectorState(live, true), { kind: 'live', label: 'Live', canTrade: true });
  assert.equal(sectorState(live, false).canTrade, false);                       // the global switch is off
  assert.equal(sectorState(live, false).label, 'Trading paused');
  assert.equal(sectorState({ status: 'live', tradable: false }, true).canTrade, false);   // index is updating
  const warming = sectorState({ status: 'warming_up', contributors: 4, contributors_needed: 10 }, true);
  assert.equal(warming.kind, 'warming');
  assert.equal(warming.canTrade, false);
  assert.match(warming.label, /4 of 10 businesses/);
  assert.equal(warming.progress, 0.4);
  assert.equal(warming.detail, null);                                           // no profile count in the feed: nothing invented
  const joined = sectorState({ status: 'warming_up', contributors: 0, contributors_needed: 10, registered: 3, sharing: 1 }, true);
  assert.equal(joined.detail, '3 businesses on IcanEra · 1 sharing sales');
  assert.equal(joined.progress, 0);                                             // registering a profile never moves the progress bar
  assert.equal(sectorState({ status: 'warming_up', contributors: 0, contributors_needed: 10, registered: 1 }, true).detail, '1 business on IcanEra');
  assert.equal(sectorState({ status: 'halted' }, true).label, 'Paused');
  assert.equal(sectorState(null).canTrade, false);
});

test('friendlySectorError prefers the server sentence and shows the new price when the price moved', () => {
  assert.equal(friendlySectorError({ code: 'insufficient_funds', error: 'Insufficient IcanEra balance. You have 1, need 2' }), 'Insufficient IcanEra balance. You have 1, need 2');
  assert.match(friendlySectorError({ code: 'price_moved', priceIcec: 1.234 }), /moved to 1.234 ICEC/);
  assert.match(friendlySectorError({ code: 'price_moved' }), /price moved/);
  assert.match(friendlySectorError({ code: 'vault_insufficient' }), /cannot pay this out/);
  assert.match(friendlySectorError({ code: 'something_new' }), /Trade failed/);
  assert.match(friendlySectorError(null), /Trade failed/);
});

test('mapSectorTradeResult turns the server answer into numbers, and keeps the failure code', () => {
  const ok = mapSectorTradeResult({
    success: true, side: 'buy', sector: 'iRETL', units: '9.90000000', price_icec: '1.000000', gross_icec: '10.00000000',
    fee_icec: '0.10000000', net_icec: '9.90000000', pay_currency: 'ICEC', pay_amount: null, new_units: '9.90000000',
    new_ican_balance: '40.00000000', new_local_balance: null, fill_id: 'f1', request_id: 'r1', duplicate: false,
  });
  assert.equal(ok.success, true);
  assert.equal(ok.units, 9.9);
  assert.equal(ok.newIcecBalance, 40);
  assert.equal(ok.payAmount, null);
  assert.equal(ok.duplicate, false);
  const dup = mapSectorTradeResult({ success: true, duplicate: true, units: 1 });
  assert.equal(dup.duplicate, true);
  const moved = mapSectorTradeResult({ success: false, code: 'price_moved', price_icec: '1.5', error: 'moved' });
  assert.deepEqual(moved, { success: false, code: 'price_moved', error: 'moved', priceIcec: 1.5 });
  assert.equal(mapSectorTradeResult(null).success, false);
  assert.equal(mapSectorTradeResult({ success: 'yes' }).success, false);        // only a literal true counts
});

test('toSectorCandles: oldest first, malformed rows dropped, one point per time', () => {
  const rows = [
    { t: '2026-10-14T10:10:00Z', o: 101, h: 103, l: 100, c: 102 },
    { t: '2026-10-14T10:05:00Z', o: 100, h: 102, l: 99, c: 101 },
    { t: '2026-10-14T10:05:00Z', o: 100, h: 102, l: 99, c: 101 },               // same time twice
    { t: '2026-10-14T10:00:00Z', o: 99, h: 98, l: 100, c: 99 },                 // wick does not cover the body
    { t: 'not a time', o: 1, h: 1, l: 1, c: 1 },
    { t: '2026-10-14T09:55:00Z', o: 0, h: 1, l: 0, c: 1 },                      // zero price
    null,
  ];
  const out = toSectorCandles(rows);
  assert.deepEqual(out.map((c) => c.timestamp), ['2026-10-14T10:05:00Z', '2026-10-14T10:10:00Z']);
  assert.equal(out[0].time, Math.floor(Date.parse('2026-10-14T10:05:00Z') / 1000));
  assert.equal(out[1].close, 102);
  assert.deepEqual(toSectorCandles(undefined), []);
});

test('sector candles merge with the shared helper: a repeated time replaces the held candle', () => {
  const held = toSectorCandles([{ t: '2026-10-14T10:05:00Z', o: 100, h: 102, l: 99, c: 101 }]);
  const incoming = toSectorCandles([{ t: '2026-10-14T10:10:00Z', o: 101, h: 103, l: 100, c: 102 }, { t: '2026-10-14T10:05:00Z', o: 100, h: 104, l: 99, c: 103 }]);
  const merged = mergeCandles(held, incoming);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].close, 103);
});

test('holdingResult carries the server figures and a tone', () => {
  assert.deepEqual(holdingResult({ pnl_icec: '1.5', pnl_pct: '10.00' }), { pnl: 1.5, pct: 10, tone: 'up' });
  assert.equal(holdingResult({ pnl_icec: '-0.1', pnl_pct: '-1' }).tone, 'down');
  assert.equal(holdingResult({ pnl_icec: '0', pnl_pct: '0' }).tone, 'flat');
  assert.deepEqual(holdingResult(null), { pnl: null, pct: null, tone: 'flat' });
});

test('display formats', () => {
  assert.equal(formatLevel(100), '100.00');
  assert.equal(formatLevel(null), '—');
  assert.equal(formatPct(1.234), '+1.23%');
  assert.equal(formatPct(-0.5), '-0.50%');
  assert.equal(formatPct(0), '0.00%');
  assert.equal(formatPct(undefined), '—');
  assert.equal(formatPrice(1.2), '1.2');
  assert.equal(formatPrice('x'), '—');
  assert.equal(trim(11.7612), '11.7612');
  assert.equal(changeTone(2), 'up');
  assert.equal(changeTone(-2), 'down');
  assert.equal(changeTone(null), 'flat');
});

test('sectorChartRows: index candles become rows the analysis chart can read', () => {
  const rows = sectorChartRows([{ timestamp: '2026-10-15T10:00:00Z', time: 1, open: 100, high: 102, low: 99, close: 101 }]);
  assert.deepEqual(rows, [{ open_time: '2026-10-15T10:00:00Z', open_price: 100, high_price: 102, low_price: 99, close_price: 101, trading_volume: 0 }]);
  assert.deepEqual(sectorChartRows(null), []);
});
