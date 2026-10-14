/**
 * The IcanEra on-chain relayer: the one small program that sits between the database and the chain.
 * Used by api/chain-sync.js (a scheduled endpoint), api/chain-link.js (wallet linking) and api/fx-oracle.js.
 *
 * WHAT IT DOES, in the order of each run (runSync):
 *   1. takes a lease in the database, so two overlapping runs never sign with the same key at once;
 *   2. checks it is talking to the chain and the ICEC-C contract the database expects (anything else halts the bridge);
 *   3. reads every Minted and BurnedForCredit event that is at least `confirmations` blocks deep, in chain order, and
 *      reports each to the database exactly as it happened (the database decides what it believes: a mint it did not ask
 *      for, or one that differs, halts the bridge; a burn is credited only to the account that owns the burning address);
 *   4. retries parked burns;
 *   5. signs and sends the mints the database has queued: records the signed transaction's hash FIRST (so a user cancel
 *      and a broadcast can never both win), then broadcasts;
 *   6. compares the contract's total supply at the last block it read with what the database expects, and halts the
 *      bridge on any difference.
 *
 * WHAT IT DOES NOT HAVE: any way to move ledger money by itself (it can only call the service-role functions the
 * database exposes), any way to mint beyond the contract's own daily cap, or any private key other than the one hot
 * key in BRIDGE_OPERATOR_KEY (an environment variable, never stored in the database or in the repository).
 *
 * Everything here takes its collaborators as arguments (database, provider, signer, contract) so it is tested without a
 * network (frontend/tests/chainRelayer.test.js) and against a real local chain and database (scripts/chain-e2e.sh).
 */

import { timingSafeEqual } from 'node:crypto';
import { ethers } from 'ethers';

export const ICEC_C_ABI = [
  'event Minted(bytes32 indexed withdrawalId, address indexed to, uint256 amount)',
  'event BurnedForCredit(address indexed account, uint256 amount, bytes32 indexed creditId)',
  'function mint(address to, uint256 amount, bytes32 withdrawalId)',
  'function processed(bytes32) view returns (bool)',
  'function mintPaused() view returns (bool)',
  'function mintableToday() view returns (uint256)',
  'function operator() view returns (address)',
  'function totalSupply() view returns (uint256)',
];

// ---------------------------------------------------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------------------------------------------------

/** The endpoint's own lock. Fails closed: with no secret configured nothing is authorised. Never trusts a header that anyone
 *  could add to a request (such as x-vercel-cron); it needs the shared secret, sent as `Authorization: Bearer <secret>`
 *  (what Vercel Cron sends when CRON_SECRET is set) or `x-automation-secret: <secret>`. */
export const isAuthorized = (headers, secret) => {
  if (!secret || String(secret).length < 16) return false;
  const lower = {};
  for (const [k, v] of Object.entries(headers || {})) lower[k.toLowerCase()] = v;
  const get = (name) => (Array.isArray(lower[name]) ? undefined : lower[name]);   // a header sent twice is ambiguous: refuse it
  const bearer = /^Bearer\s+(.+)$/i.exec(String(get('authorization') || ''));
  const offered = bearer ? bearer[1].trim() : String(get('x-automation-secret') || '').trim();
  if (!offered) return false;
  const a = Buffer.from(offered);
  const b = Buffer.from(String(secret));
  return a.length === b.length && timingSafeEqual(a, b);
};

/** sha256 of the withdrawal id as text: the bytes32 the contract records (the same rule as icanera_chain.withdrawal_ref). */
export const withdrawalRef = (id) => ethers.sha256(ethers.toUtf8Bytes(String(id)));

/** Chain order: by block, then by position in the block. A burn is only ever credited against a mint that came before it. */
export const orderEvents = (events) =>
  [...events].sort((a, b) => (a.blockNumber - b.blockNumber) || ((a.index ?? a.logIndex ?? 0) - (b.index ?? b.logIndex ?? 0)));

/** Split [from, to] into ranges of at most `size` blocks (an RPC provider rejects very wide log queries). */
export const blockRanges = (from, to, size = 1000) => {
  const out = [];
  for (let a = from; a <= to; a += size) out.push([a, Math.min(to, a + size - 1)]);
  return out;
};

const num = (v) => (typeof v === 'bigint' ? Number(v) : Number(v));

// ---------------------------------------------------------------------------------------------------------------------
// The database, over PostgREST. The service-role key never leaves the server.
// ---------------------------------------------------------------------------------------------------------------------

export const createSupabaseRpc = ({ url, serviceKey, fetchImpl = fetch }) => ({
  async rpc(name, args = {}) {
    const res = await fetchImpl(`${String(url).replace(/\/$/, '')}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const text = await res.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) throw new Error(`${name} failed (${res.status}): ${typeof body === 'object' && body ? (body.message || JSON.stringify(body)) : text}`);
    return body;
  },
});

// ---------------------------------------------------------------------------------------------------------------------
// Configuration, from the environment only
// ---------------------------------------------------------------------------------------------------------------------

/** Reads and checks the environment. Returns { ok, cfg } or { ok:false, missing:[...] }; never includes a secret in an error. */
export const loadConfig = (env = process.env) => {
  const pick = (...names) => { for (const n of names) { const v = String(env[n] || '').trim().replace(/^["']|["']$/g, ''); if (v) return v; } return ''; };
  const cfg = {
    supabaseUrl: pick('SUPABASE_URL', 'VITE_SUPABASE_URL'),
    serviceKey: pick('SUPABASE_SERVICE_ROLE_KEY'),
    rpcUrl: pick('CHAIN_RPC_URL'),
    chainId: pick('CHAIN_ID'),
    operatorKey: pick('BRIDGE_OPERATOR_KEY'),
    secret: pick('CHAIN_CRON_SECRET', 'CRON_SECRET'),
    startBlock: Number(pick('CHAIN_START_BLOCK') || 0),
    maxMintsPerRun: Number(pick('CHAIN_MAX_MINTS_PER_RUN') || 10),
    maxBlocksPerRun: Number(pick('CHAIN_MAX_BLOCKS_PER_RUN') || 5000),
    minGasWei: BigInt(pick('CHAIN_MIN_OPERATOR_BALANCE_WEI') || '1000000000000000'), // 0.001 of the native coin
    leaseSeconds: 240,
  };
  const required = { SUPABASE_URL: cfg.supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: cfg.serviceKey, CHAIN_RPC_URL: cfg.rpcUrl, CHAIN_ID: cfg.chainId, BRIDGE_OPERATOR_KEY: cfg.operatorKey, CHAIN_CRON_SECRET: cfg.secret };
  const missing = Object.keys(required).filter((k) => !required[k]);
  if (missing.length) return { ok: false, missing };
  if (!/^\d+$/.test(cfg.chainId)) return { ok: false, missing: [], error: 'CHAIN_ID must be a number' };
  if (cfg.secret.length < 16) return { ok: false, missing: [], error: 'CHAIN_CRON_SECRET must be at least 16 characters' };
  return { ok: true, cfg };
};

// ---------------------------------------------------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------------------------------------------------

// What the database says when it has halted the bridge in answer to an event: stop reading and stop sending.
const HALTING_CODES = new Set(['unknown_ref', 'mismatch', 'second_mint', 'mint_after_cancel', 'wrong_chain']);

/**
 * deps: {
 *   db        { rpc(name, args) }                      the database (service role)
 *   provider  ethers Provider                           the chain
 *   signer    ethers Wallet (connected to provider)    the single hot key
 *   cfg       { chainId, startBlock, maxMintsPerRun, maxBlocksPerRun, minGasWei, leaseSeconds }
 *   holder    string                                    a name for this run, for the lease
 *   log       (event, details) => void
 *   makeContract  optional (address, signer) => contract, for tests; by default an ethers Contract for the ICEC-C ABI
 * }
 */
export async function runSync({ db, provider, signer, cfg, holder, log = () => {}, makeContract = null }) {
  const summary = {
    leased: false, halted: false, scanned: null, mintsRecorded: 0, burnsRecorded: 0, burnsCredited: 0, burnsParked: 0,
    sent: [], requeued: 0, skipped: [], supply: null, errors: [],
  };
  const chainId = Number(cfg.chainId);
  const leaseName = `chain-sync:${chainId}`;
  const cursorName = `chain-events:${chainId}`;

  const leased = await db.rpc('ican_chain_operator_lease', { p_name: leaseName, p_holder: holder, p_ttl_s: cfg.leaseSeconds });
  if (leased !== true) { summary.skipped.push('another run holds the lease'); return summary; }
  summary.leased = true;

  const halt = async (reason) => {
    summary.halted = true;
    summary.errors.push(reason);
    log('halt', { reason });
    try { await db.rpc('ican_chain_operator_halt', { p_reason: reason }); } catch (e) { summary.errors.push(`could not record the halt: ${e.message}`); }
  };

  try {
    // ---- 0. am I where the database thinks I am?
    const pub = await db.rpc('ican_chain_public_config', {});
    if (!pub || !pub.chain_id || !pub.icec_community_address) { summary.skipped.push('the database has no chain configured'); return summary; }
    if (Number(pub.chain_id) !== chainId) { await halt(`environment CHAIN_ID ${chainId} differs from the database's chain ${pub.chain_id}`); return summary; }
    const net = await provider.getNetwork();
    if (Number(net.chainId) !== chainId) { await halt(`the RPC endpoint is on chain ${net.chainId}, expected ${chainId}`); return summary; }
    const address = pub.icec_community_address;
    const code = await provider.getCode(address);
    if (!code || code === '0x') { await halt(`no contract at ${address} on chain ${chainId}`); return summary; }
    const contract = makeContract ? makeContract(address, signer) : new ethers.Contract(address, ICEC_C_ABI, signer);
    const confirmations = Math.max(1, Number(pub.confirmations) || 12);
    const canMint = (await contract.operator()).toLowerCase() === signer.address.toLowerCase();
    if (!canMint) summary.errors.push('the signing key is not the contract\'s operator: reading the chain, but not minting');

    // ---- 1. events, at confirmation depth, in chain order
    const head = await provider.getBlockNumber();
    const safe = head - confirmations;
    let cursor = Number(await db.rpc('ican_chain_operator_cursor', { p_name: cursorName, p_set_block: null }));
    let from = Math.max(cursor + 1, Number(cfg.startBlock) || 0);
    const to = Math.min(safe, from + Math.max(1, Number(cfg.maxBlocksPerRun) || 5000) - 1);
    let reachedSafe = cursor >= safe;
    if (to >= from) {
      outer:
      for (const [a, b] of blockRanges(from, to, 1000)) {
        const minted = await contract.queryFilter(contract.filters.Minted(), a, b);
        const burned = await contract.queryFilter(contract.filters.BurnedForCredit(), a, b);
        for (const ev of orderEvents([...minted, ...burned])) {
          if (ev.fragment?.name === 'Minted') {
            const r = await db.rpc('ican_chain_operator_record_mint', {
              p_chain_id: chainId, p_ref: ev.args.withdrawalId, p_tx_hash: ev.transactionHash, p_log_index: ev.index,
              p_block: ev.blockNumber, p_to: ev.args.to, p_amount_units: ev.args.amount.toString(),
            });
            if (r?.success) summary.mintsRecorded += r.duplicate ? 0 : 1;
            else if (r?.code === 'wrong_chain') { summary.halted = true; summary.errors.push('the database says this event is from another chain'); break outer; }
            else if (HALTING_CODES.has(r?.code)) {
              // The database has recorded the anomaly and halted the bridge. Keep reading: the anomaly is on record, and
              // burn-backs after it must still reach their owners (a burn can only ever return value to where it came from).
              summary.halted = true;
              summary.errors.push(`the database refused a mint event: ${r.code}`);
              log('refused', { event: 'Minted', code: r.code, tx: ev.transactionHash });
            }
          } else {
            const r = await db.rpc('ican_chain_operator_record_burn', {
              p_chain_id: chainId, p_tx_hash: ev.transactionHash, p_log_index: ev.index, p_block: ev.blockNumber,
              p_from: ev.args.account, p_amount_units: ev.args.amount.toString(), p_credit_id: ev.args.creditId,
            });
            if (r?.success && !r.duplicate) { summary.burnsRecorded += 1; if (r.credited) summary.burnsCredited += 1; else summary.burnsParked += 1; }
            else if (r?.code === 'wrong_chain') { summary.halted = true; break outer; }
          }
        }
        cursor = await db.rpc('ican_chain_operator_cursor', { p_name: cursorName, p_set_block: b });
        summary.scanned = [from, b];
      }
      reachedSafe = cursor >= safe;
    }

    // ---- 2. burns parked earlier (their address may be linked, or their mint recorded, by now). Also while halted.
    const retry = await db.rpc('ican_chain_operator_retry_unclaimed', { p_limit: 50 });
    if (retry?.credited) summary.burnsCredited += Number(retry.credited);
    if (summary.halted) return summary;

    // ---- 3. send the mints the database has queued
    if (canMint) {
      const items = await db.rpc('ican_chain_operator_next_mints', { p_limit: Number(cfg.maxMintsPerRun) || 10, p_stale_s: 180 });
      if (Array.isArray(items) && items.length) {
        let balance = await provider.getBalance(signer.address);
        const paused = await contract.mintPaused();
        let mintable = await contract.mintableToday();
        if (paused) summary.skipped.push('minting is paused on the contract');
        else if (balance < cfg.minGasWei) summary.errors.push('the operator wallet is nearly out of gas money');
        else {
          for (const item of items) {
            if (withdrawalRef(item.id) !== String(item.ref).toLowerCase()) { await halt(`withdrawal ${item.id} has a reference that is not sha256 of its id`); break; }
            const units = BigInt(item.amount_units);
            if (await contract.processed(item.ref)) { summary.skipped.push(`${item.id}: already minted on-chain, waiting for the event`); continue; }
            if (item.status === 'submitted' && item.tx_hash) {
              const receipt = await provider.getTransactionReceipt(item.tx_hash);
              if (receipt && receipt.status === 0) {
                const rq = await db.rpc('ican_chain_operator_requeue', { p_id: item.id, p_reason: `reverted in ${item.tx_hash}` });
                if (rq?.success) summary.requeued += 1;
                continue;
              }
              if (receipt) { summary.skipped.push(`${item.id}: a transaction was mined but the contract shows no mint: look at it by hand`); continue; }
            }
            if (units > mintable) { summary.skipped.push(`${item.id}: over the contract's remaining daily mint cap`); continue; }
            try {
              const unsigned = await contract.mint.populateTransaction(item.to, units, item.ref);
              const request = await signer.populateTransaction(unsigned);
              const signed = await signer.signTransaction(request);
              const hash = ethers.Transaction.from(signed).hash;
              // the signed transaction's hash goes in the database BEFORE it is broadcast; a refusal means do not send
              const mark = await db.rpc('ican_chain_operator_mark_submitted', { p_id: item.id, p_tx_hash: hash });
              if (!mark?.success) { summary.skipped.push(`${item.id}: not sent (${mark?.code || 'refused'})`); continue; }
              try {
                await provider.broadcastTransaction(signed);
              } catch (e) {
                if (!/already known|nonce too low|known transaction/i.test(String(e?.message))) { summary.errors.push(`${item.id}: broadcast failed: ${e.message}`); continue; }
              }
              mintable -= units;
              summary.sent.push({ id: item.id, tx: hash });
              log('sent', { id: item.id, tx: hash });
            } catch (e) {
              summary.errors.push(`${item.id}: could not sign or send: ${e.shortMessage || e.message}`);
            }
          }
        }
      }
    }

    // ---- 4. does the chain hold what the database expects?
    if (reachedSafe && !summary.halted && safe >= 0) {
      const supply = await contract.totalSupply({ blockTag: safe });
      const check = await db.rpc('ican_chain_operator_check_supply', { p_chain_id: chainId, p_block: safe, p_supply_units: supply.toString() });
      summary.supply = { block: safe, onchain: supply.toString(), ok: !!check?.ok };
      if (check && check.ok === false) { summary.halted = true; summary.errors.push('on-chain supply differs from the ledger: the bridge is halted'); }
    }
    return summary;
  } catch (e) {
    summary.errors.push(e?.shortMessage || e?.message || String(e));
    return summary;
  } finally {
    try { await db.rpc('ican_chain_operator_release', { p_name: leaseName, p_holder: holder }); } catch { /* the lease expires on its own */ }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Wallet linking: the user proves they hold the address's key
// ---------------------------------------------------------------------------------------------------------------------

/**
 * `userId` is who the caller's own session says they are (checked by the endpoint against Supabase, never taken from the
 * request body). The database's challenge must be theirs, unused and unexpired, and the signature over its exact text must
 * recover to its address. Only then is the link recorded.
 */
export async function verifyAndLink({ db, userId, challengeId, signature }) {
  if (!userId) return { success: false, code: 'not_signed_in' };
  if (!/^[0-9a-f-]{36}$/i.test(String(challengeId || ''))) return { success: false, code: 'unknown_challenge' };
  if (!/^0x[0-9a-fA-F]{130}$/.test(String(signature || ''))) return { success: false, code: 'invalid_signature' };
  const ch = await db.rpc('ican_chain_operator_get_challenge', { p_challenge_id: challengeId });
  if (!ch?.found) return { success: false, code: 'unknown_challenge' };
  if (ch.user_id !== userId) return { success: false, code: 'unknown_challenge' }; // not theirs: no hint that it exists
  if (ch.used) return { success: false, code: 'challenge_used' };
  if (ch.expired) return { success: false, code: 'challenge_expired' };
  let recovered;
  try { recovered = ethers.verifyMessage(ch.message, signature); } catch { return { success: false, code: 'invalid_signature' }; }
  if (recovered.toLowerCase() !== String(ch.address).toLowerCase()) return { success: false, code: 'signature_mismatch' };
  return db.rpc('ican_chain_operator_link', { p_challenge_id: challengeId, p_signature: signature });
}

/** Who a Supabase access token belongs to, asked of Supabase itself (the token is never trusted by its own claims). */
export const userFromToken = async ({ url, anonKey, token, fetchImpl = fetch }) => {
  if (!token) return null;
  const res = await fetchImpl(`${String(url).replace(/\/$/, '')}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const u = await res.json().catch(() => null);
  return u?.id || null;
};

// ---------------------------------------------------------------------------------------------------------------------
// Informational FX
// ---------------------------------------------------------------------------------------------------------------------

/** Pulls USD -> X rates from a public provider (default: open.er-api.com, no key) and offers each to the database,
 *  which accepts, rejects or parks it by its own rules. Display only: nothing on the money path reads these. */
export async function runFxOracle({ db, fetchImpl = fetch, pairs, providerUrl, source, now = () => new Date() }) {
  const out = { observed: [], rejected: [], errors: [] };
  let body;
  try {
    const res = await fetchImpl(providerUrl);
    if (!res.ok) throw new Error(`provider answered ${res.status}`);
    body = await res.json();
  } catch (e) { out.errors.push(`could not read the rate provider: ${e.message}`); return out; }
  const rates = body?.rates || body?.conversion_rates || body?.data || null;
  if (!rates || typeof rates !== 'object') { out.errors.push('the rate provider sent no rates'); return out; }
  for (const pair of pairs) {
    const [base, quote] = pair.split('/');
    const baseRate = base === 'USD' ? 1 : Number(rates[base]);
    const quoteRate = Number(rates[quote]);
    if (!(baseRate > 0) || !(quoteRate > 0)) { out.errors.push(`${pair}: not in the provider's answer`); continue; }
    const rate = quoteRate / baseRate;
    try {
      const r = await db.rpc('ican_chain_operator_fx_observe', { p_pair: pair, p_rate: rate, p_source: source, p_observed_at: now().toISOString() });
      (r?.accepted ? out.observed : out.rejected).push({ pair, rate, reason: r?.reason || null });
    } catch (e) { out.errors.push(`${pair}: ${e.message}`); }
  }
  return out;
}
