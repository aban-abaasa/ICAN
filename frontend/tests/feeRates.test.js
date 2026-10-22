import test from 'node:test';
import assert from 'node:assert/strict';
import * as client from '../src/utils/feeRates.js';
import * as server from '../../backend/components/supabase/functions/_shared/fees.js';
import * as routing from '../src/utils/walletRouting.js';

const { feeFor, feeRateKey, rateFor, normalizeFeeRates, quoteTransfer, describeRate, FEE_KEYS, DEFAULT_FEE_RATE, UNLOADED_FEE_RATES } = client;

test('3% of a send is taken out of the amount: UGX 10,000 costs 300 and delivers 9,700', () => {
  assert.equal(feeFor(10000, 0.03), 300);
  assert.deepEqual(quoteTransfer({ amount: 10000, rate: 0.03 }), { rate: 0.03, gross: 10000, fee: 300, net: 9700 });
});

test('the fee is rounded UP to a whole shilling, never under-collected, and float noise adds nothing', () => {
  assert.equal(feeFor(9999, 0.03), 300); // 299.97
  assert.equal(feeFor(1001, 0.03), 31); // 30.03
  assert.equal(feeFor(10000, 0.03), 300); // 10000 * 0.03 is 300.00000000000006 in floating point
  assert.equal(feeFor(100, 0.03), 3);
  assert.equal(feeFor(20000, 0.0125), 250);
});

test('no rate, no amount, a negative or non-numeric input: no fee', () => {
  assert.equal(feeFor(10000, 0), 0);
  assert.equal(feeFor(0, 0.03), 0);
  assert.equal(feeFor(-5000, 0.03), 0);
  assert.equal(feeFor('abc', 0.03), 0);
  assert.equal(feeFor(10000, undefined), 0);
  assert.deepEqual(quoteTransfer({ amount: '', rate: 0.03 }), { rate: 0.03, gross: 0, fee: 0, net: 0 });
});

test('which rate applies is decided from what can be verified: bank, your own number, someone else\'s number', () => {
  assert.equal(feeRateKey({ isBank: true, toOwnNumber: false }), 'send_bank');
  assert.equal(feeRateKey({ isBank: true, toOwnNumber: true }), 'send_bank'); // a bank account cannot be proven to be yours
  assert.equal(feeRateKey({ isBank: false, toOwnNumber: true }), 'withdraw_wallet');
  assert.equal(feeRateKey({ isBank: false, toOwnNumber: false }), 'send_mobile_money');
});

test('rows from the table become a rate map; invalid rows are dropped', () => {
  assert.deepEqual(
    normalizeFeeRates([{ key: 'send_bank', rate: '0.02' }, { key: 'send_mobile_money', rate: 0.03 }, { key: 'withdraw_wallet', rate: 1 }, { key: 'coin_cash_out', rate: -1 }, { key: 7, rate: 0.1 }, null]),
    { send_bank: 0.02, send_mobile_money: 0.03 },
  );
  assert.deepEqual(normalizeFeeRates(null), {});
});

test('the rate shown: the table\'s value; a missing row or a failed read shows the default 3%, never "free"', () => {
  const loaded = { rates: { send_bank: 0.02 }, deployed: true, loaded: true };
  assert.equal(rateFor(loaded, 'send_bank'), 0.02);
  assert.equal(rateFor(loaded, 'send_mobile_money'), DEFAULT_FEE_RATE); // row missing -> what the server falls back to
  assert.equal(rateFor(UNLOADED_FEE_RATES, 'send_bank'), DEFAULT_FEE_RATE); // read failed
  assert.equal(rateFor(undefined, 'send_bank'), DEFAULT_FEE_RATE);
  assert.equal(rateFor({ rates: { send_bank: 0 }, deployed: true, loaded: true }, 'send_bank'), 0); // an explicit 0 is honoured
});

test('before the SQL has run nothing is charged on wallet-money sends - but coin cash-outs still pay their old 3%', () => {
  const notThere = { rates: {}, deployed: false, loaded: true };
  assert.equal(rateFor(notThere, 'send_bank'), 0);
  assert.equal(rateFor(notThere, 'send_mobile_money'), 0);
  assert.equal(rateFor(notThere, 'withdraw_wallet'), 0);
  assert.equal(rateFor(notThere, FEE_KEYS.COIN_CASH_OUT), 0.03);
});

test('rates read as words', () => {
  assert.equal(describeRate(0.03), '3%');
  assert.equal(describeRate(0.0125), '1.25%');
  assert.equal(describeRate(0.005), '0.5%');
  assert.equal(describeRate(0), 'no fee');
  assert.equal(describeRate(undefined), 'no fee');
});

test('the website and the server compute exactly the same fee and pick exactly the same rate', () => {
  const amounts = [1, 2, 3, 99, 100, 999, 1000, 1001, 5000, 9999, 10000, 12345, 20000, 50000, 99999, 100000, 250000, 1000000, 7777777];
  const rates = [0, 0.001, 0.005, 0.01, 0.0125, 0.015, 0.02, 0.025, 0.03, 0.035, 0.05, 0.1, 0.25];
  for (const a of amounts) for (const r of rates) {
    assert.equal(client.feeFor(a, r), server.feeFor(a, r), `amount ${a} at ${r}`);
  }
  for (const isBank of [true, false]) for (const toOwnNumber of [true, false]) {
    assert.equal(client.feeRateKey({ isBank, toOwnNumber }), server.feeRateKey({ isBank, toOwnNumber }));
  }
  assert.equal(client.DEFAULT_FEE_RATE, server.DEFAULT_FEE_RATE);
  for (const v of [0, 0.03, 0.999999, 1, -0.1, NaN, null, undefined, '', 'abc', '0.02']) {
    assert.equal(client.isValidFeeRate(v), server.isValidFeeRate(v), `isValidFeeRate(${String(v)})`);
  }
});

// ── the server's way of reading a rate, with a stand-in database client
const fakeClient = (result) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => result }) }) }),
});

test('server: a rate is read from the table', async () => {
  assert.deepEqual(await server.loadFeeRate(fakeClient({ data: { rate: '0.02' }, error: null }), 'send_bank'), { ok: true, rate: 0.02 });
  assert.deepEqual(await server.loadFeeRate(fakeClient({ data: { rate: 0 }, error: null }), 'send_bank'), { ok: true, rate: 0 });
});

test('server: a missing row falls back to 3%, never to free', async () => {
  assert.deepEqual(await server.loadFeeRate(fakeClient({ data: null, error: null }), 'send_bank'), { ok: true, rate: 0.03 });
});

test('server: if the rates table has not been created yet there is simply no fee (the old behaviour)', async () => {
  assert.deepEqual(await server.loadFeeRate(fakeClient({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }), 'send_bank'), { ok: true, rate: 0 });
  assert.deepEqual(await server.loadFeeRate(fakeClient({ data: null, error: { code: '42P01', message: 'relation does not exist' } }), 'send_bank'), { ok: true, rate: 0 });
});

test('server: any other failure to read, or a nonsense rate, refuses instead of guessing a price', async () => {
  const down = await server.loadFeeRate(fakeClient({ data: null, error: { code: '08006', message: 'connection failure' } }), 'send_bank');
  assert.equal(down.ok, false);
  assert.match(down.error, /connection failure/);
  for (const rate of [1, 5, -0.1, 'abc', null]) {
    const bad = await server.loadFeeRate(fakeClient({ data: { rate }, error: null }), 'send_bank');
    assert.equal(bad.ok, false, `rate ${String(rate)}`);
  }
});

// ── the coin cash-out rate and the withdraw maths in walletRouting
test('the coin cash-out rate is 3% until the table says otherwise, then every importer follows it', () => {
  try {
    assert.equal(routing.COIN_PAYOUT_FEE_RATE, 0.03);
    routing.setCoinPayoutFeeRate(0.02);
    assert.equal(routing.COIN_PAYOUT_FEE_RATE, 0.02);
    // defaults are read at call time, so the conversion maths picks the new rate up without being told
    assert.equal(routing.simulateSell(10, 5000).fee, 1000);
    assert.equal(routing.quoteWithdrawal({ amountUgx: 50000, source: 'coin', rate: 5000 }).fee, 1000);
    routing.setCoinPayoutFeeRate(0);
    assert.equal(routing.COIN_PAYOUT_FEE_RATE, 0);
    assert.equal(routing.simulateSell(10, 5000).fee, 0);
  } finally {
    routing.setCoinPayoutFeeRate(0.03);
  }
  assert.equal(routing.COIN_PAYOUT_FEE_RATE, 0.03);
});

test('a nonsense coin cash-out rate is ignored', () => {
  for (const bad of [1, 2, -0.5, NaN, 'abc', null, undefined, '']) routing.setCoinPayoutFeeRate(bad);
  assert.equal(routing.COIN_PAYOUT_FEE_RATE, 0.03);
});

test('withdrawing wallet money now carries the fee, taken out of the amount', () => {
  const q = routing.quoteWithdrawal({ amountUgx: 100000, source: 'fiat', rate: 5000, fiatFeeRate: 0.03 });
  assert.deepEqual(q, { icanDebit: 0, gross: 100000, fee: 3000, net: 97000 });
  const free = routing.quoteWithdrawal({ amountUgx: 100000, source: 'fiat', rate: 5000 });
  assert.deepEqual(free, { icanDebit: 0, gross: 100000, fee: 0, net: 100000 }); // unchanged when no rate is given
});

test('a coin withdrawal still pays the cash-out fee', () => {
  const q = routing.quoteWithdrawal({ amountUgx: 100000, source: 'coin', rate: 5000 });
  assert.equal(q.fee, 3000);
  assert.equal(q.net, 97000);
});

test('a cash-out comes from the balance with the lower fee; on a tie, the wallet', () => {
  const both = { amountUgx: 50000, fiatUgx: 100000, coinIcan: 20, rate: 5000 };
  assert.equal(routing.planWithdrawalSource({ ...both, feeRate: 0.03, fiatFeeRate: 0.03 }).source, 'fiat'); // tie
  assert.equal(routing.planWithdrawalSource({ ...both, feeRate: 0.02, fiatFeeRate: 0.03 }).source, 'coin'); // coin is cheaper
  assert.equal(routing.planWithdrawalSource({ ...both, feeRate: 0.03, fiatFeeRate: 0.01 }).source, 'fiat'); // wallet is cheaper
  assert.equal(routing.planWithdrawalSource(both).source, 'fiat'); // no rates given: the old behaviour (wallet first)
});

test('the cheaper balance is only chosen if it can actually cover the amount', () => {
  assert.equal(routing.planWithdrawalSource({ amountUgx: 50000, fiatUgx: 100000, coinIcan: 1, rate: 5000, feeRate: 0, fiatFeeRate: 0.03 }).source, 'fiat'); // coin too small
  assert.equal(routing.planWithdrawalSource({ amountUgx: 50000, fiatUgx: 10000, coinIcan: 20, rate: 5000, feeRate: 0.03, fiatFeeRate: 0 }).source, 'coin'); // wallet too small
});
