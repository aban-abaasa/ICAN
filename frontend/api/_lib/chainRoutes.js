/**
 * The on-chain relayer's three endpoints, in one module that is NOT a serverless function.
 *
 *   /api/chain-sync   scheduled: one run of the relayer (mint queued withdrawals, record mints and burns, check supply)
 *   /api/chain-link   a signed-in user's wallet-link proof (step 2 of linking a wallet)
 *   /api/fx-oracle    scheduled: refresh the informational USD -> local exchange rates
 *
 * Why not three files in api/: every file under api/ is a separate serverless function, and Vercel's Hobby plan allows 12
 * per deployment; the project was already at 12, so three more made the whole deploy fail. api/investment-expiry-sweep.js
 * hands requests carrying ?job=chain-sync | chain-link | fx-oracle to chainRouteFor() below, and vercel.json rewrites the
 * three public paths onto it, so the URLs are the same as if they were separate functions and cost no function slot.
 * tests/apiFunctionCount.test.js fails the build if the count ever goes over 12 again.
 *
 * Each handler keeps its own fail-closed lock (the shared secret, or the caller's own Supabase session for linking): the host
 * function's older auth rules never apply to them, because the hand-off happens before they run.
 */

import { ethers } from 'ethers';
import {
  createSupabaseRpc, isAuthorized, loadConfig, runFxOracle, runSync, userFromToken, verifyAndLink,
} from './chainRelayer.js';

const pick = (...names) => { for (const n of names) { const v = String(process.env[n] || '').trim().replace(/^["']|["']$/g, ''); if (v) return v; } return ''; };

// ---------------------------------------------------------------------------------------------------------------------
// /api/chain-sync
// ---------------------------------------------------------------------------------------------------------------------
export async function chainSyncHandler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const loaded = loadConfig();
  if (!loaded.ok) return res.status(500).json({ error: loaded.error || 'The relayer is not configured', missing: loaded.missing });
  const { cfg } = loaded;
  if (!isAuthorized(req.headers, cfg.secret)) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    const signer = new ethers.Wallet(cfg.operatorKey, provider);
    const db = createSupabaseRpc({ url: cfg.supabaseUrl, serviceKey: cfg.serviceKey });
    const holder = `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const summary = await runSync({ db, provider, signer, cfg, holder, log: (event, details) => console.log('chain-sync', event, JSON.stringify(details)) });
    provider.destroy();
    // 200 even when a run found problems: the body says what happened, and an error status would only trigger retries
    return res.status(200).json({ success: summary.errors.length === 0 && !summary.halted, ...summary });
  } catch (err) {
    console.error('chain-sync error:', err?.message);
    return res.status(502).json({ error: 'The relayer run failed', detail: String(err?.message || err).slice(0, 300) });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// /api/chain-link
// ---------------------------------------------------------------------------------------------------------------------
export async function chainLinkHandler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const url = pick('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const serviceKey = pick('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = pick('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return res.status(500).json({ success: false, error: 'Linking is not configured' });

  const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1]?.trim();
  try {
    // Who is asking comes from Supabase itself, never from the request body.
    const userId = await userFromToken({ url, anonKey, token });
    if (!userId) return res.status(401).json({ success: false, code: 'not_signed_in', error: 'Please sign in.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const result = await verifyAndLink({ db: createSupabaseRpc({ url, serviceKey }), userId, challengeId: body.challengeId, signature: body.signature });
    return res.status(result?.success ? 200 : 400).json(result);
  } catch (err) {
    console.error('chain-link error:', err?.message);
    return res.status(502).json({ success: false, error: 'Could not complete linking. Please try again.' });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// /api/fx-oracle
// ---------------------------------------------------------------------------------------------------------------------
export async function fxOracleHandler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const url = pick('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const serviceKey = pick('SUPABASE_SERVICE_ROLE_KEY');
  const secret = pick('CHAIN_CRON_SECRET', 'CRON_SECRET');
  if (!url || !serviceKey || !secret) return res.status(500).json({ error: 'The oracle is not configured' });
  if (!isAuthorized(req.headers, secret)) return res.status(401).json({ error: 'Unauthorized' });

  const providerUrl = pick('FX_PROVIDER_URL') || 'https://open.er-api.com/v6/latest/USD';
  const pairs = (pick('FX_PAIRS') || 'USD/UGX,USD/KES,USD/TZS,USD/RWF').split(',').map((p) => p.trim().toUpperCase()).filter((p) => /^[A-Z]{3}\/[A-Z]{3}$/.test(p));
  let source;
  try { source = new URL(providerUrl).hostname; } catch { return res.status(500).json({ error: 'FX_PROVIDER_URL is not a valid URL' }); }

  try {
    const out = await runFxOracle({ db: createSupabaseRpc({ url, serviceKey }), pairs, providerUrl, source });
    return res.status(200).json({ success: out.errors.length === 0, ...out });
  } catch (err) {
    console.error('fx-oracle error:', err?.message);
    return res.status(502).json({ error: 'The oracle run failed', detail: String(err?.message || err).slice(0, 300) });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The hand-off from the host function
// ---------------------------------------------------------------------------------------------------------------------

export const CHAIN_JOBS = Object.freeze({ 'chain-sync': chainSyncHandler, 'chain-link': chainLinkHandler, 'fx-oracle': fxOracleHandler });

/** The handler for a request that carries ?job=<one of the three>, or null for every other request. */
export const chainRouteFor = (req) => {
  const job = req?.query?.job;
  return typeof job === 'string' && Object.prototype.hasOwnProperty.call(CHAIN_JOBS, job) ? CHAIN_JOBS[job] : null;
};
