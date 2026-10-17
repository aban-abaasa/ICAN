import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSendQuote } from '../src/utils/sendQuote.js';

const base = { price: 5000, currency: 'UGX', coinBalance: 3.5, walletBalance: 100000 };
const texts = (q) => q.lines.map((l) => l.text);

test('nothing is quoted for an empty amount; a missing price pauses conversions instead of guessing', () => {
  assert.deepEqual(describeSendQuote({ ...base, tile: 'coin', amount: '' }), { lines: [], ok: true });
  const q = describeSendQuote({ ...base, price: 0, tile: 'coin', unit: 'currency', amount: '20000' });
  assert.match(q.lines[0].text, /live coin price is not available/);
  assert.equal(q.ok, true);
});

test('money typed for a coin recipient: shows the coins and that it is paid from the wallet', () => {
  const q = describeSendQuote({ ...base, tile: 'coin', unit: 'currency', amount: '20000' });
  assert.equal(q.ok, true);
  assert.match(texts(q)[0], /≈ 4\.0000 IcanEra at UGX 5,000 per coin — the recipient receives IcanEra/);
  assert.match(texts(q)[1], /Paid from your wallet \(UGX 100,000 available\) — no fee/);
});

test('money typed that the wallet cannot cover is an error', () => {
  const q = describeSendQuote({ ...base, walletBalance: 5000, tile: 'coin', unit: 'currency', amount: '20000' });
  assert.equal(q.ok, false);
  assert.equal(q.lines.at(-1).tone, 'error');
});

test('coins typed: shows the money value, and the conversion only when coins on hand fall short', () => {
  const enough = describeSendQuote({ ...base, tile: 'coin', unit: 'coin', amount: '1' });
  assert.deepEqual(texts(enough), ['≈ UGX 5,000 at UGX 5,000 per coin.']);

  const short = describeSendQuote({ ...base, coinBalance: 1.5, tile: 'coin', unit: 'coin', amount: '4' });
  assert.equal(short.ok, true);
  assert.match(texts(short)[1], /You have 1\.5000 IcanEra — the other 2\.5000 is converted from your wallet \(UGX 12,500, no fee\)/);
  assert.equal(short.lines[1].tone, 'warn');

  const cannot = describeSendQuote({ ...base, coinBalance: 0, walletBalance: 1000, tile: 'coin', unit: 'coin', amount: '4' });
  assert.equal(cannot.ok, false);
});

test('a business paying coin: checked against the business balance in either unit', () => {
  const business = { name: 'My Co', coins: 50 };
  assert.equal(describeSendQuote({ ...base, tile: 'coin', unit: 'coin', amount: '5', business }).ok, true);
  const over = describeSendQuote({ ...base, tile: 'coin', unit: 'currency', amount: '1000000', business });
  assert.equal(over.ok, false);
  assert.match(texts(over).at(-1), /My Co has only 50\.0000 IcanEra/);
});

test('money recipient, wallet covers it: no conversion is mentioned', () => {
  assert.deepEqual(describeSendQuote({ ...base, tile: 'money', amount: '50000' }), { lines: [], ok: true });
});

test('money recipient, wallet short: coin is converted for the difference, fee shown', () => {
  const q = describeSendQuote({ ...base, coinBalance: 12, walletBalance: 1500, tile: 'money', amount: '50000' });
  assert.equal(q.ok, true);
  assert.match(texts(q)[0], /Your wallet has UGX 1,500 — 10\.0000 IcanEra is converted for the rest \(3% fee: UGX 1,500\)/);
});

test('money recipient, wallet plus coin still short: an error, not a silent partial', () => {
  const q = describeSendQuote({ ...base, coinBalance: 1, walletBalance: 1500, tile: 'money', amount: '50000' });
  assert.equal(q.ok, false);
  assert.match(texts(q)[0], /Not enough/);
});

test('a business paying a person in money: shows the coin it takes, including the 3% fee', () => {
  const business = { name: 'My Co', coins: 50 };
  const q = describeSendQuote({ ...base, tile: 'money', amount: '50000', business });
  assert.equal(q.ok, true);
  assert.match(texts(q)[0], /My Co pays in IcanEra: 10\.3093 IcanEra, converted to UGX 50,000 \(3% fee: UGX 1,546\)/);
  const over = describeSendQuote({ ...base, tile: 'money', amount: '300000', business });
  assert.equal(over.ok, false);
  assert.match(texts(over)[0], /needs 61\.8557/);
});

test('quotes are in the person\'s own currency (USD with cents, KES whole)', () => {
  const usd = describeSendQuote({ tile: 'coin', unit: 'currency', amount: '20', price: 1.3, currency: 'USD', coinBalance: 0, walletBalance: 100 });
  assert.match(usd.lines[0].text, /≈ 15\.3846 IcanEra at USD 1\.30 per coin/);
  assert.match(usd.lines[1].text, /Paid from your wallet \(USD 100\.00 available\)/);

  const kes = describeSendQuote({ tile: 'money', amount: '5000', price: 160, currency: 'KES', coinBalance: 100, walletBalance: 1000 });
  assert.equal(kes.ok, true);
  assert.match(kes.lines[0].text, /Your wallet has KES 1,000 — .* IcanEra is converted for the rest \(3% fee: KES /);
});
