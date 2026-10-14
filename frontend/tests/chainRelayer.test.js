import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ethers } from 'ethers';
import {
  isAuthorized, withdrawalRef, orderEvents, blockRanges, loadConfig, createSupabaseRpc, runSync, verifyAndLink, runFxOracle, userFromToken,
} from '../api/_lib/chainRelayer.js';

// The relayer's decisions, tested with a fake database, chain and contract: what it believes, what it refuses to send, in what
// order it does things, and that it never holds anything it should not. The same code is run against a real local chain and a
// real Postgres in scripts/chain-e2e.sh.

const SECRET = 'a-long-enough-shared-secret-123';

// ---------------------------------------------------------------------------------------------------------------- the lock
test('the endpoint refuses everything when no secret is configured, or when it is too short', () => {
  assert.equal(isAuthorized({ authorization: `Bearer ${SECRET}` }, ''), false);
  assert.equal(isAuthorized({ authorization: 'Bearer short' }, 'short'), false);
  assert.equal(isAuthorized({}, undefined), false);
});

test('a correct secret is accepted as a bearer token or as x-automation-secret, and nothing else is', () => {
  assert.equal(isAuthorized({ authorization: `Bearer ${SECRET}` }, SECRET), true);
  assert.equal(isAuthorized({ Authorization: `bearer ${SECRET}` }, SECRET), true);
  assert.equal(isAuthorized({ 'x-automation-secret': SECRET }, SECRET), true);
  assert.equal(isAuthorized({ authorization: `Bearer ${SECRET}x` }, SECRET), false);
  assert.equal(isAuthorized({ authorization: 'Bearer ' + 'y'.repeat(SECRET.length) }, SECRET), false);
  assert.equal(isAuthorized({ 'x-automation-secret': ['nope', SECRET] }, SECRET), false);
  assert.equal(isAuthorized({}, SECRET), false);
});

test('the x-vercel-cron header, which anyone can add to a request, is NOT a credential', () => {
  assert.equal(isAuthorized({ 'x-vercel-cron': '1' }, SECRET), false);
  assert.equal(isAuthorized({ 'x-vercel-cron': '1', authorization: 'Bearer wrong-wrong-wrong-wrong' }, SECRET), false);
});

// ---------------------------------------------------------------------------------------------------------------- pure helpers
test('the on-chain reference is sha256 of the withdrawal id as text (the database computes the same)', () => {
  const id = '3a1fc9a0-53ce-480d-b359-8fde9660f19c';
  assert.equal(withdrawalRef(id), '0x' + createHash('sha256').update(id, 'utf8').digest('hex'));
  assert.match(withdrawalRef(id), /^0x[0-9a-f]{64}$/);
});

test('events are put in chain order: block, then position in the block', () => {
  const ev = [
    { name: 'burn', blockNumber: 10, index: 2 }, { name: 'mintB', blockNumber: 10, index: 1 }, { name: 'mintA', blockNumber: 9, index: 7 },
    { name: 'late', blockNumber: 11, index: 0 },
  ];
  assert.deepEqual(orderEvents(ev).map((e) => e.name), ['mintA', 'mintB', 'burn', 'late']);
  assert.deepEqual(ev.map((e) => e.name), ['burn', 'mintB', 'mintA', 'late'], 'the input is not mutated');
});

test('block ranges cover [from, to] exactly, with no gap and no overlap', () => {
  assert.deepEqual(blockRanges(1, 5, 2), [[1, 2], [3, 4], [5, 5]]);
  assert.deepEqual(blockRanges(10, 10, 1000), [[10, 10]]);
  assert.deepEqual(blockRanges(11, 10, 1000), []);
  const r = blockRanges(1, 4321, 1000);
  assert.equal(r[0][0], 1); assert.equal(r.at(-1)[1], 4321);
  for (let i = 1; i < r.length; i += 1) assert.equal(r[i][0], r[i - 1][1] + 1);
});

// ---------------------------------------------------------------------------------------------------------------- configuration
test('configuration names what is missing without echoing any value', () => {
  const r = loadConfig({ SUPABASE_URL: 'https://x.supabase.co', CHAIN_RPC_URL: 'https://rpc.example' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.sort(), ['BRIDGE_OPERATOR_KEY', 'CHAIN_CRON_SECRET', 'CHAIN_ID', 'SUPABASE_SERVICE_ROLE_KEY']);
  assert.ok(!JSON.stringify(r).includes('rpc.example'));
});

test('configuration rejects a short secret and a non-numeric chain id, and accepts a complete environment', () => {
  const base = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'svc', CHAIN_RPC_URL: 'https://rpc', CHAIN_ID: '11155111', BRIDGE_OPERATOR_KEY: '0x' + '11'.repeat(32), CRON_SECRET: SECRET };
  assert.equal(loadConfig({ ...base, CRON_SECRET: 'tiny' }).ok, false);
  assert.equal(loadConfig({ ...base, CHAIN_ID: 'sepolia' }).ok, false);
  const ok = loadConfig(base);
  assert.equal(ok.ok, true);
  assert.equal(ok.cfg.secret, SECRET);
  assert.equal(ok.cfg.maxMintsPerRun, 10);
  assert.equal(loadConfig({ ...base, CHAIN_CRON_SECRET: 'a-different-long-secret-456' }).cfg.secret, 'a-different-long-secret-456');
});

// ---------------------------------------------------------------------------------------------------------------- the database door
test('a database call goes to the right function with the service key, and a failure carries the database\'s message', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/boom')) return { ok: false, status: 400, text: async () => JSON.stringify({ message: 'unauthorized' }) };
    return { ok: true, status: 200, text: async () => 'true' };
  };
  const { rpc } = createSupabaseRpc({ url: 'https://x.supabase.co/', serviceKey: 'SERVICE', fetchImpl });
  assert.equal(await rpc('ican_chain_operator_lease', { p_name: 'a' }), true);
  assert.equal(calls[0].url, 'https://x.supabase.co/rest/v1/rpc/ican_chain_operator_lease');
  assert.equal(calls[0].init.headers.apikey, 'SERVICE');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer SERVICE');
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_name: 'a' });
  await assert.rejects(() => rpc('boom'), (e) => /boom failed \(400\): unauthorized/.test(e.message) && !e.message.includes('SERVICE'));
});

// ---------------------------------------------------------------------------------------------------------------- runSync
const KEY = new ethers.Wallet('0x' + '22'.repeat(32));
// A wallet that signs for real but asks no chain for a nonce or gas: the fake contract supplies every field of the transaction.
const OPERATOR = { address: KEY.address, populateTransaction: async (tx) => tx, signTransaction: (tx) => KEY.signTransaction(tx) };
const CONTRACT = '0x' + 'c0'.repeat(20);
const sha = (id) => withdrawalRef(id);
const UNITS = (icec) => BigInt(Math.round(icec * 1e8));

// A scripted world. `state` is what the chain says; `dbState` is what the database says; `calls` records the order of everything.
const world = (over = {}) => {
  const calls = [];
  const st = {
    head: 1000, chainId: 31337, code: '0x6080', confirmations: 12, cursor: 0, bridgeConfigured: true, leaseOk: true,
    events: [], items: [], processed: {}, paused: false, mintable: UNITS(1000), balance: ethers.parseEther('1'), operator: OPERATOR.address,
    supply: 0n, receipts: {}, markResult: () => ({ success: true }), recordMint: () => ({ success: true, duplicate: false }),
    recordBurn: () => ({ success: true, duplicate: false, credited: true }), supplyOk: true, broadcastError: null, queryTo: [],
    ...over,
  };
  const db = {
    async rpc(name, args) {
      calls.push([name, args]);
      switch (name) {
        case 'ican_chain_operator_lease': return st.leaseOk;
        case 'ican_chain_operator_release': return null;
        case 'ican_chain_public_config': return st.bridgeConfigured ? { chain_id: st.chainId, icec_community_address: CONTRACT, confirmations: st.confirmations } : { chain_id: null };
        case 'ican_chain_operator_cursor': if (args.p_set_block != null) st.cursor = Math.max(st.cursor, args.p_set_block); return st.cursor;
        case 'ican_chain_operator_record_mint': return st.recordMint(args);
        case 'ican_chain_operator_record_burn': return st.recordBurn(args);
        case 'ican_chain_operator_retry_unclaimed': return { tried: 0, credited: 0 };
        case 'ican_chain_operator_next_mints': return st.items;
        case 'ican_chain_operator_mark_submitted': return st.markResult(args);
        case 'ican_chain_operator_requeue': return { success: true };
        case 'ican_chain_operator_check_supply': return { success: true, ok: st.supplyOk };
        case 'ican_chain_operator_halt': return null;
        default: throw new Error(`unexpected database call ${name}`);
      }
    },
  };
  const provider = {
    async getNetwork() { return { chainId: BigInt(st.chainId) }; },
    async getCode() { return st.code; },
    async getBlockNumber() { return st.head; },
    async getBalance() { return st.balance; },
    async getTransactionReceipt(h) { return st.receipts[h] ?? null; },
    async broadcastTransaction(raw) { calls.push(['BROADCAST', raw]); if (st.broadcastError) throw new Error(st.broadcastError); return {}; },
  };
  const makeContract = () => ({
    filters: { Minted: () => 'Minted', BurnedForCredit: () => 'Burned' },
    async operator() { return st.operator; },
    async queryFilter(kind, a, b) { st.queryTo.push([kind, a, b]); return st.events.filter((e) => e.fragment.name === (kind === 'Minted' ? 'Minted' : 'BurnedForCredit') && e.blockNumber >= a && e.blockNumber <= b); },
    async mintPaused() { return st.paused; },
    async mintableToday() { return st.mintable; },
    async processed(ref) { return !!st.processed[ref]; },
    async totalSupply(o) { calls.push(['TOTAL_SUPPLY', o]); return st.supply; },
    mint: { async populateTransaction(to, amount, ref) {
      const iface = new ethers.Interface(['function mint(address to, uint256 amount, bytes32 withdrawalId)']);
      return { to: CONTRACT, data: iface.encodeFunctionData('mint', [to, amount, ref]), nonce: calls.length, gasLimit: 100000n, maxFeePerGas: 10n ** 9n, maxPriorityFeePerGas: 10n ** 8n, chainId: BigInt(st.chainId), type: 2, value: 0n };
    } },
  });
  const cfg = { chainId: 31337, startBlock: 0, maxMintsPerRun: 10, maxBlocksPerRun: 5000, minGasWei: 10n ** 15n, leaseSeconds: 240 };
  const run = () => runSync({ db, provider, signer: OPERATOR, cfg, holder: 'test', makeContract });
  const names = () => calls.map((c) => c[0]);
  return { st, calls, run, names };
};

const mintEv = (block, index, ref, to, units, tx = '0x' + 'aa'.repeat(32)) => ({ fragment: { name: 'Minted' }, blockNumber: block, index, transactionHash: tx, args: { withdrawalId: ref, to, amount: units } });
const burnEv = (block, index, from, units, tx = '0x' + 'bb'.repeat(32)) => ({ fragment: { name: 'BurnedForCredit' }, blockNumber: block, index, transactionHash: tx, args: { account: from, amount: units, creditId: '0x' + '00'.repeat(32) } });
const item = (id, over = {}) => ({ id, ref: sha(id), to: '0x' + '11'.repeat(20), amount_units: String(UNITS(10)), status: 'pending', tx_hash: null, attempts: 0, ...over });
const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

test('a run that cannot get the lease does nothing else', async () => {
  const w = world({ leaseOk: false });
  const s = await w.run();
  assert.equal(s.leased, false);
  assert.deepEqual(w.names(), ['ican_chain_operator_lease']);
});

test('the lease is always given back, even when the run fails half way', async () => {
  const w = world();
  const okRun = await w.run();
  assert.equal(w.names().at(-1), 'ican_chain_operator_release');
  const w2 = world();
  w2.st.recordBurn = () => { throw new Error('database down'); };
  w2.st.events = [burnEv(100, 0, '0x' + '11'.repeat(20), 1n)];
  const failed = await w2.run();
  assert.ok(failed.errors.some((e) => /database down/.test(e)));
  assert.equal(w2.names().at(-1), 'ican_chain_operator_release');
  assert.ok(okRun.leased);
});

test('with no chain configured in the database, it reads nothing and signs nothing', async () => {
  const w = world({ bridgeConfigured: false });
  const s = await w.run();
  assert.ok(s.skipped.some((x) => /no chain configured/.test(x)));
  assert.ok(!w.names().includes('ican_chain_operator_cursor'));
});

test('a mismatch between the environment, the endpoint and the database halts the bridge instead of guessing', async () => {
  let w = world({ chainId: 31337 });
  w.st.chainId = 31337;
  const wrongEnv = world();
  wrongEnv.st.chainId = 1;                       // the database says chain 1, the environment says 31337
  let s = await wrongEnv.run();
  assert.equal(s.halted, true);
  assert.ok(wrongEnv.names().includes('ican_chain_operator_halt'));

  w = world();
  const provider = { async getNetwork() { return { chainId: 5n }; } };
  const db = { async rpc(name) { return name === 'ican_chain_public_config' ? { chain_id: 31337, icec_community_address: CONTRACT, confirmations: 12 } : name === 'ican_chain_operator_lease' ? true : null; } };
  s = await runSync({ db, provider, signer: OPERATOR, cfg: { chainId: 31337 }, holder: 't', makeContract: () => ({}) });
  assert.equal(s.halted, true);
  assert.ok(s.errors.some((e) => /expected 31337/.test(e)));

  const noCode = world({ code: '0x' });
  s = await noCode.run();
  assert.equal(s.halted, true);
  assert.ok(s.errors.some((e) => /no contract at/.test(e)));
});

test('events are only believed at confirmation depth, and are reported in chain order', async () => {
  const to = '0x' + '11'.repeat(20);
  const w = world({ head: 100, confirmations: 12 });
  w.st.events = [
    burnEv(50, 3, to, UNITS(4)), mintEv(50, 1, sha(ID1), to, UNITS(10)), mintEv(49, 9, sha(ID2), to, UNITS(1)),
    mintEv(95, 0, sha('33333333-3333-4333-8333-333333333333'), to, UNITS(1)),     // 5 blocks deep: not yet
  ];
  const s = await w.run();
  const order = w.calls.filter((c) => /record_(mint|burn)/.test(c[0])).map((c) => `${c[0].replace('ican_chain_operator_record_', '')}@${c[1].p_block}`);
  assert.deepEqual(order, ['mint@49', 'mint@50', 'burn@50']);
  assert.ok(w.st.queryTo.every(([, , b]) => b <= 88), 'nothing past head - confirmations was even asked for');
  assert.equal(w.st.cursor, 88);
  assert.deepEqual([s.mintsRecorded, s.burnsRecorded, s.burnsCredited], [2, 1, 1]);
});

test('a second run starts after where the first stopped, and never re-reads the same blocks', async () => {
  const w = world({ head: 100, confirmations: 12 });
  await w.run();
  w.st.queryTo.length = 0;
  await w.run();
  assert.equal(w.st.queryTo.length, 0, 'nothing new is at depth, so nothing was queried');
  w.st.head = 130;
  await w.run();
  assert.ok(w.st.queryTo.length > 0 && w.st.queryTo.every(([, a]) => a === 89));
});

test('when the database refuses a mint (it halted the bridge), the relayer keeps reading so burn-backs still credit, and sends nothing', async () => {
  const to = '0x' + '11'.repeat(20);
  const w = world({ head: 100 });
  w.st.events = [mintEv(10, 0, '0x' + 'ab'.repeat(32), to, UNITS(99)), burnEv(11, 0, to, UNITS(1))];
  w.st.recordMint = () => ({ success: false, code: 'unknown_ref' });
  w.st.items = [item(ID1)];
  const s = await w.run();
  assert.equal(s.halted, true);
  assert.equal(s.burnsRecorded, 1, 'the burn after the refused mint was still reported');
  assert.ok(!w.names().includes('BROADCAST') && !w.names().includes('ican_chain_operator_mark_submitted'));
  assert.ok(!w.names().includes('ican_chain_operator_next_mints'), 'a halted run asks for no mints at all');
  assert.equal(w.st.cursor, 88, 'the anomaly is on record, so the cursor moves past it');
});

test('a mint is recorded in the database BEFORE it is broadcast, and never broadcast if the database refuses', async () => {
  const w = world();
  w.st.items = [item(ID1)];
  const s = await w.run();
  const n = w.names();
  assert.ok(n.indexOf('ican_chain_operator_mark_submitted') > -1 && n.indexOf('BROADCAST') > n.indexOf('ican_chain_operator_mark_submitted'));
  const mark = w.calls.find((c) => c[0] === 'ican_chain_operator_mark_submitted')[1];
  const raw = w.calls.find((c) => c[0] === 'BROADCAST')[1];
  assert.equal(mark.p_tx_hash, ethers.Transaction.from(raw).hash, 'the hash the database holds is the hash that was sent');
  assert.equal(ethers.Transaction.from(raw).from.toLowerCase(), OPERATOR.address.toLowerCase());
  assert.equal(s.sent.length, 1);

  const refused = world();
  refused.st.items = [item(ID1)];
  refused.st.markResult = () => ({ success: false, code: 'cancelled' });
  const s2 = await refused.run();
  assert.ok(!refused.names().includes('BROADCAST'), 'a cancelled withdrawal is never sent');
  assert.ok(s2.skipped.some((x) => /cancelled/.test(x)));
});

test('the transaction it signs is a mint of exactly the amount, to exactly the address, for exactly the reference', async () => {
  const w = world();
  w.st.items = [item(ID1, { to: '0x' + '5a'.repeat(20), amount_units: '123456789' })];
  await w.run();
  const tx = ethers.Transaction.from(w.calls.find((c) => c[0] === 'BROADCAST')[1]);
  const [to, amount, ref] = new ethers.Interface(['function mint(address to, uint256 amount, bytes32 withdrawalId)']).decodeFunctionData('mint', tx.data);
  assert.equal(to.toLowerCase(), '0x' + '5a'.repeat(20));
  assert.equal(amount, 123456789n);
  assert.equal(ref, sha(ID1));
  assert.equal(tx.to.toLowerCase(), CONTRACT);
});

test('it refuses to send for a withdrawal whose reference is not sha256 of its id (and halts the bridge)', async () => {
  const w = world();
  w.st.items = [item(ID1, { ref: '0x' + 'de'.repeat(32) })];
  const s = await w.run();
  assert.equal(s.halted, true);
  assert.ok(!w.names().includes('BROADCAST') && w.names().includes('ican_chain_operator_halt'));
});

test('it does not send a mint the contract already holds, or while minting is paused, or beyond the remaining daily cap', async () => {
  let w = world();
  w.st.items = [item(ID1)];
  w.st.processed[sha(ID1)] = true;
  await w.run();
  assert.ok(!w.names().includes('BROADCAST'), 'already minted: it waits for the event instead');

  w = world({ paused: true });
  w.st.items = [item(ID1)];
  const s = await w.run();
  assert.ok(!w.names().includes('BROADCAST') && s.skipped.some((x) => /paused/.test(x)));

  w = world({ mintable: UNITS(15) });
  w.st.items = [item(ID1), item(ID2, { amount_units: String(UNITS(10)) }), item('44444444-4444-4444-8444-444444444444', { amount_units: String(UNITS(4)) })];
  const s3 = await w.run();
  assert.equal(s3.sent.length, 2, '10 fits (15 left), the next 10 does not (5 left), the 4 does');
  assert.ok(s3.skipped.some((x) => /daily mint cap/.test(x)));
});

test('a submitted withdrawal whose transaction was mined and REVERTED goes back in the queue; it is not resent in the same breath', async () => {
  const w = world();
  const h = '0x' + 'cd'.repeat(32);
  w.st.items = [item(ID1, { status: 'submitted', tx_hash: h, attempts: 1 })];
  w.st.receipts[h] = { status: 0 };
  const s = await w.run();
  assert.equal(s.requeued, 1);
  assert.ok(w.names().includes('ican_chain_operator_requeue') && !w.names().includes('BROADCAST'));
});

test('a stale submitted withdrawal with no receipt is signed again (the contract mints each reference once, so a double send cannot double mint)', async () => {
  const w = world();
  w.st.items = [item(ID1, { status: 'submitted', tx_hash: '0x' + 'ee'.repeat(32), attempts: 1 })];
  const s = await w.run();
  assert.equal(s.sent.length, 1);
});

test('"already known" on broadcast is fine; any other broadcast failure is reported and never thrown, and the run carries on', async () => {
  let w = world({ broadcastError: 'transaction already known' });
  w.st.items = [item(ID1)];
  let s = await w.run();
  assert.equal(s.sent.length, 1);
  assert.equal(s.errors.length, 0);

  w = world({ broadcastError: 'insufficient funds for gas' });
  w.st.items = [item(ID1), item(ID2)];
  s = await w.run();
  assert.equal(s.sent.length, 0);
  assert.equal(s.errors.length, 2);
  assert.ok(w.names().includes('ican_chain_operator_release'));
});

test('a signing key that is not the contract\'s operator reads the chain but never mints', async () => {
  const w = world({ operator: '0x' + '99'.repeat(20) });
  w.st.items = [item(ID1)];
  const s = await w.run();
  assert.ok(!w.names().includes('BROADCAST') && !w.names().includes('ican_chain_operator_next_mints'));
  assert.ok(s.errors.some((e) => /not the contract's operator/.test(e)));
  assert.ok(w.names().includes('ican_chain_operator_cursor'));
});

test('with almost no gas money it sends nothing and says so', async () => {
  const w = world({ balance: 5n });
  w.st.items = [item(ID1)];
  const s = await w.run();
  assert.ok(!w.names().includes('BROADCAST'));
  assert.ok(s.errors.some((e) => /out of gas/.test(e)));
});

test('the supply check compares the contract at the block it just finished reading; a difference halts the bridge', async () => {
  const w = world({ head: 100, supply: UNITS(7) });
  const s = await w.run();
  const supplyCall = w.calls.find((c) => c[0] === 'ican_chain_operator_check_supply')[1];
  assert.deepEqual(w.calls.find((c) => c[0] === 'TOTAL_SUPPLY')[1], { blockTag: 88 });
  assert.equal(supplyCall.p_block, 88);
  assert.equal(supplyCall.p_supply_units, String(UNITS(7)));
  assert.equal(s.supply.ok, true);

  const bad = world({ head: 100, supplyOk: false });
  const sb = await bad.run();
  assert.equal(sb.halted, true);
  assert.ok(sb.errors.some((e) => /differs from the ledger/.test(e)));
});

test('it does not check supply at a block it has not finished reading', async () => {
  const w = world({ head: 100000, cursor: 0 });
  w.st.events = [];
  const s = await w.run();
  assert.equal(s.supply, null, 'the scan was capped per run, so the check waits for a run that has caught up');
  assert.ok(!w.names().includes('ican_chain_operator_check_supply'));
});

// ---------------------------------------------------------------------------------------------------------------- wallet linking
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const linkWorld = async (over = {}) => {
  const wallet = ethers.Wallet.createRandom();
  const message = `IcanEra wants you to link this wallet.\n\nAddress: ${wallet.address.toLowerCase()}\nAccount: ${USER}`;
  const calls = [];
  const challenge = { found: true, user_id: USER, address: wallet.address.toLowerCase(), message, used: false, expired: false, ...over };
  const db = { async rpc(name, args) { calls.push([name, args]); return name === 'ican_chain_operator_get_challenge' ? challenge : { success: true, linked: true }; } };
  return { wallet, message, db, calls, sign: (m = message, w = wallet) => w.signMessage(m) };
};

test('linking: the right account, the exact text and the address\'s own signature record the link', async () => {
  const L = await linkWorld();
  const signature = await L.sign();
  const r = await verifyAndLink({ db: L.db, userId: USER, challengeId: CH, signature });
  assert.equal(r.success, true);
  assert.deepEqual(L.calls.at(-1), ['ican_chain_operator_link', { p_challenge_id: CH, p_signature: signature }]);
});

test('linking: someone else\'s challenge, a signature by a different key, a changed text, a used or expired challenge: all refused, nothing recorded', async () => {
  const L = await linkWorld();
  const good = await L.sign();
  const other = ethers.Wallet.createRandom();
  const refusals = [
    [await verifyAndLink({ db: L.db, userId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', challengeId: CH, signature: good }), 'unknown_challenge'],
    [await verifyAndLink({ db: L.db, userId: USER, challengeId: CH, signature: await L.sign(L.message, other) }), 'signature_mismatch'],
    [await verifyAndLink({ db: L.db, userId: USER, challengeId: CH, signature: await L.sign(L.message + ' (edited)') }), 'signature_mismatch'],
    [await verifyAndLink({ db: L.db, userId: USER, challengeId: CH, signature: 'nonsense' }), 'invalid_signature'],
    [await verifyAndLink({ db: L.db, userId: null, challengeId: CH, signature: good }), 'not_signed_in'],
    [await verifyAndLink({ db: L.db, userId: USER, challengeId: 'not-a-uuid', signature: good }), 'unknown_challenge'],
  ];
  for (const [r, code] of refusals) assert.equal(r.code, code);
  const used = await linkWorld({ used: true });
  assert.equal((await verifyAndLink({ db: used.db, userId: USER, challengeId: CH, signature: await used.sign() })).code, 'challenge_used');
  const expired = await linkWorld({ expired: true });
  assert.equal((await verifyAndLink({ db: expired.db, userId: USER, challengeId: CH, signature: await expired.sign() })).code, 'challenge_expired');
  const missing = await linkWorld({ found: false });
  assert.equal((await verifyAndLink({ db: missing.db, userId: USER, challengeId: CH, signature: good })).code, 'unknown_challenge');
  assert.ok(![L, used, expired, missing].some((x) => x.calls.some((c) => c[0] === 'ican_chain_operator_link')), 'the link was never recorded');
});

test('a user is identified by asking Supabase about their token, not by reading the token', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => { seen.push([url, init.headers]); return { ok: true, json: async () => ({ id: USER }) }; };
  assert.equal(await userFromToken({ url: 'https://x.supabase.co/', anonKey: 'ANON', token: 'tok', fetchImpl }), USER);
  assert.equal(seen[0][0], 'https://x.supabase.co/auth/v1/user');
  assert.equal(seen[0][1].Authorization, 'Bearer tok');
  assert.equal(await userFromToken({ url: 'u', anonKey: 'a', token: '', fetchImpl }), null);
  assert.equal(await userFromToken({ url: 'u', anonKey: 'a', token: 'bad', fetchImpl: async () => ({ ok: false }) }), null);
});

// ---------------------------------------------------------------------------------------------------------------- FX
test('the oracle turns a provider\'s USD table into pairs and offers each to the database, which decides', async () => {
  const offered = [];
  const db = { async rpc(name, args) { offered.push(args); return { accepted: args.p_pair !== 'USD/KES', reason: args.p_pair === 'USD/KES' ? 'jump' : null }; } };
  const fetchImpl = async () => ({ ok: true, json: async () => ({ rates: { USD: 1, UGX: 3700.5, KES: 129, EUR: 0.9 } }) });
  const out = await runFxOracle({ db, fetchImpl, pairs: ['USD/UGX', 'USD/KES', 'USD/XXX', 'EUR/UGX'], providerUrl: 'https://p', source: 'p', now: () => new Date('2026-10-14T10:00:00Z') });
  assert.deepEqual(out.observed.map((o) => o.pair), ['USD/UGX', 'EUR/UGX']);
  assert.deepEqual(out.rejected.map((o) => [o.pair, o.reason]), [['USD/KES', 'jump']]);
  assert.ok(out.errors.some((e) => /USD\/XXX/.test(e)));
  assert.equal(offered[0].p_rate, 3700.5);
  assert.ok(Math.abs(offered.find((o) => o.p_pair === 'EUR/UGX').p_rate - 3700.5 / 0.9) < 1e-9, 'a cross rate is the quote over the base');
  assert.equal(offered[0].p_observed_at, '2026-10-14T10:00:00.000Z');
});

test('an unreachable or empty provider is reported, never thrown, and offers the database nothing', async () => {
  const db = { async rpc() { throw new Error('should not be called'); } };
  let out = await runFxOracle({ db, fetchImpl: async () => { throw new Error('offline'); }, pairs: ['USD/UGX'], providerUrl: 'https://p', source: 'p' });
  assert.ok(out.errors[0].includes('offline') && out.observed.length === 0);
  out = await runFxOracle({ db, fetchImpl: async () => ({ ok: true, json: async () => ({}) }), pairs: ['USD/UGX'], providerUrl: 'https://p', source: 'p' });
  assert.ok(/no rates/.test(out.errors[0]));
  out = await runFxOracle({ db, fetchImpl: async () => ({ ok: false, status: 503 }), pairs: ['USD/UGX'], providerUrl: 'https://p', source: 'p' });
  assert.ok(/503/.test(out.errors[0]));
});
