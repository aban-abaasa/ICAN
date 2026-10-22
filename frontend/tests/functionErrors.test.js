import test from 'node:test';
import assert from 'node:assert/strict';
import { describeFunctionFailure } from '../src/utils/functionErrors.js';

// supabase.functions.invoke puts the HTTP response in error.context when the function answered with a non-2xx status
const answered = (body, status = 400) => ({ message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) });

test('the function answered with its own error: that is a final refusal, and its words are used', async () => {
  const r = await describeFunctionFailure(answered({ success: false, error: 'Insufficient balance or wallet not found' }), 'Transfer failed');
  assert.deepEqual(r, { message: 'Insufficient balance or wallet not found', answered: true });
});

test('a server error that still carries the function\'s message is an answer too (it refunds before it answers)', async () => {
  const r = await describeFunctionFailure(answered({ success: false, error: 'Flutterwave rejected the transfer request.' }, 502), 'Transfer failed');
  assert.deepEqual(r, { message: 'Flutterwave rejected the transfer request.', answered: true });
});

test('the reply can be read more than once (it is cloned, not consumed)', async () => {
  const error = answered({ error: 'No' });
  await describeFunctionFailure(error, 'x');
  assert.equal((await describeFunctionFailure(error, 'x')).answered, true);
});

test('no connection: nothing answered, so the transfer may still have gone through', async () => {
  const r = await describeFunctionFailure({ message: 'Failed to send a request to the Edge Function' }, 'Transfer failed');
  assert.deepEqual(r, { message: 'Failed to send a request to the Edge Function', answered: false });
});

test('a gateway error page (not JSON) is not an answer from the function', async () => {
  const error = { message: 'Edge Function returned a non-2xx status code', context: new Response('<html>504 Gateway Time-out</html>', { status: 504 }) };
  const r = await describeFunctionFailure(error, 'Transfer failed');
  assert.deepEqual(r, { message: 'Edge Function returned a non-2xx status code', answered: false });
});

test('a JSON reply with no error message is not an answer either', async () => {
  const r = await describeFunctionFailure(answered({ ok: false }, 500), 'Transfer failed');
  assert.equal(r.answered, false);
});

test('no message at all falls back to the given words', async () => {
  assert.deepEqual(await describeFunctionFailure({}, 'Transfer failed'), { message: 'Transfer failed', answered: false });
  assert.deepEqual(await describeFunctionFailure(null, 'Transfer failed'), { message: 'Transfer failed', answered: false });
});
