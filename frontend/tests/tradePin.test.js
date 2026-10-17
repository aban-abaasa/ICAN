import test from 'node:test';
import assert from 'node:assert/strict';
import { runPinCheck, TRADE_PIN_TITLE } from '../src/utils/tradePin.js';

test('runPinCheck: asks with the trade title and the sentence saying what is being approved', async () => {
  let seen;
  await runPinCheck(async (opts) => { seen = opts; return { ok: true }; }, 'Buy about 29.0103 ICEC-S for UGX 120,000.');
  assert.deepEqual(seen, { title: TRADE_PIN_TITLE, message: 'Buy about 29.0103 ICEC-S for UGX 120,000.' });
});

test('runPinCheck: only a clear ok lets the trade go ahead', async () => {
  assert.deepEqual(await runPinCheck(async () => ({ ok: true }), 'x'), { ok: true });
});

test('runPinCheck: a cancel stops the trade and says so', async () => {
  const res = await runPinCheck(async () => ({ ok: false, cancelled: true, error: 'Cancelled — nothing was charged.' }), 'x');
  assert.equal(res.ok, false);
  assert.equal(res.cancelled, true);
  assert.equal(res.error, 'Cancelled — nothing was charged.');
});

test('runPinCheck: a wrong PIN, a locked wallet or no PIN set keep their own message and stop the trade', async () => {
  for (const error of ['Incorrect PIN', 'Account locked due to too many failed PIN attempts. Try again later.', 'PIN not set up yet. Finish creating your wallet account first.']) {
    const res = await runPinCheck(async () => ({ ok: false, error }), 'x');
    assert.equal(res.ok, false);
    assert.equal(res.cancelled, false);
    assert.equal(res.error, error);
  }
});

test('runPinCheck: fails closed on anything that is not a clear ok', async () => {
  for (const answer of [undefined, null, {}, { ok: 'yes' }, { ok: 1 }, { success: true }, 'ok', true]) {
    const res = await runPinCheck(async () => answer, 'x');
    assert.equal(res.ok, false, `answer ${JSON.stringify(answer)} must not approve a trade`);
    assert.ok(res.error, 'a stopped trade always carries a sentence to show');
  }
});

test('runPinCheck: a crash while checking stops the trade instead of throwing into the screen', async () => {
  const res = await runPinCheck(async () => { throw new Error('network down'); }, 'x');
  assert.equal(res.ok, false);
  assert.equal(res.cancelled, false);
  assert.match(res.error, /Nothing was traded/);
  const sync = await runPinCheck(() => { throw new Error('boom'); }, 'x');
  assert.equal(sync.ok, false);
});
