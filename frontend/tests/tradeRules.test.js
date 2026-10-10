import test from 'node:test';
import assert from 'node:assert/strict';
import { orderCrossed, distanceFromMarketPct, validateBooking, validateSell, coinsForMoney, quickTopUpAmounts, friendlyTradeError } from '../src/utils/tradeRules.js';
import { sanitizeLineStyles, DEFAULT_LINE_STYLES } from '../src/utils/lineStyles.js';

test('a buy order is due at or below its target, a sell at or above', () => {
  const buy = { order_type: 'buy', target_price_ugx: '5000' };
  const sell = { order_type: 'sell', target_price_ugx: 5100 };
  assert.equal(orderCrossed(buy, 5000), true);
  assert.equal(orderCrossed(buy, 4990), true);
  assert.equal(orderCrossed(buy, 5001), false);
  assert.equal(orderCrossed(sell, 5100), true);
  assert.equal(orderCrossed(sell, 5200), true);
  assert.equal(orderCrossed(sell, 5099), false);
});

test('orderCrossed is false for unusable prices instead of filling by accident', () => {
  assert.equal(orderCrossed({ order_type: 'buy', target_price_ugx: 5000 }, 0), false);
  assert.equal(orderCrossed({ order_type: 'buy', target_price_ugx: 5000 }, undefined), false);
  assert.equal(orderCrossed({ order_type: 'sell', target_price_ugx: 'x' }, 5000), false);
  assert.equal(orderCrossed(null, 5000), false);
});

test('distanceFromMarketPct is signed and null without prices', () => {
  assert.equal(distanceFromMarketPct(5500, 5000), 10);
  assert.equal(distanceFromMarketPct(4500, 5000), -10);
  assert.equal(distanceFromMarketPct(0, 5000), null);
});

test('validateBooking checks side, amount, price and balance', () => {
  assert.match(validateBooking({ side: 'x', amount: 1, price: 1 }), /buy or sell/);
  assert.match(validateBooking({ side: 'buy', amount: 0, price: 5000 }), /how many/);
  assert.match(validateBooking({ side: 'buy', amount: 1, price: '' }), /price/);
  assert.match(validateBooking({ side: 'sell', amount: 5, price: 5000, balance: 2 }), /do not have/);
  assert.equal(validateBooking({ side: 'sell', amount: 2, price: 5000, balance: 2 }), null);
  assert.equal(validateBooking({ side: 'buy', amount: 50, price: 5000, balance: 0 }), null); // buying needs no coins
});

test('validateSell caps at the balance and rounds down to 8 decimals', () => {
  assert.equal(validateSell('3', 2).ok, false);
  assert.equal(validateSell('0', 2).ok, false);
  assert.deepEqual(validateSell('1.123456789', 5), { ok: true, amount: 1.12345678 });
});

test('coinsForMoney never promises more than the money buys', () => {
  assert.equal(coinsForMoney(5000, 5000), 1);
  assert.equal(coinsForMoney(1, 3), 0.33333333);
  assert.equal(coinsForMoney(0, 5000), 0);
  assert.equal(coinsForMoney(100, 0), 0);
});

test('quickTopUpAmounts scale from the minimum', () => {
  assert.deepEqual(quickTopUpAmounts(1000), [1000, 2000, 5000, 10000]);
  assert.deepEqual(quickTopUpAmounts(0), []);
});

test('sanitizeLineStyles falls back to defaults and rejects bad values', () => {
  assert.deepEqual(sanitizeLineStyles(null), DEFAULT_LINE_STYLES);
  const out = sanitizeLineStyles({ buy: { color: 'red', style: 'wavy', width: 9 }, sell: { color: '#ABCDEF', style: 'solid', width: 3 } });
  assert.deepEqual(out.buy, DEFAULT_LINE_STYLES.buy);
  assert.deepEqual(out.sell, { color: '#abcdef', style: 'solid', width: 3 });
  assert.deepEqual(out.booking, DEFAULT_LINE_STYLES.booking);
});

test('friendlyTradeError explains a missing cash wallet in plain words', () => {
  assert.match(friendlyTradeError('No wallet found for currency: USD'), /cash wallet is not set up/);
  assert.match(friendlyTradeError('Insufficient balance. You have 0 UGX, need 5'), /too low/);
  assert.match(friendlyTradeError('Insufficient IcanEra balance. You have 1, need 2'), /enough coins/);
  assert.equal(friendlyTradeError('Some other thing'), 'Some other thing');
  assert.match(friendlyTradeError(''), /try again/);
});
