/**
 * Scheduled endpoint: one run of the on-chain relayer (api/_lib/chainRelayer.js).
 *
 * Route: GET or POST /api/chain-sync        Schedule: every minute (see CHAIN_TOKENS_DEPLOY.md)
 * Auth:  `Authorization: Bearer <CHAIN_CRON_SECRET or CRON_SECRET>` (what Vercel Cron sends when CRON_SECRET is set)
 *        or `x-automation-secret: <same secret>`. With no secret configured the endpoint refuses everything.
 *        It deliberately does NOT trust the x-vercel-cron header: anyone can add a header to a request.
 * Env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CHAIN_RPC_URL, CHAIN_ID, BRIDGE_OPERATOR_KEY, CHAIN_CRON_SECRET
 *        optional: CHAIN_START_BLOCK (the ICEC-C deployment block), CHAIN_MAX_MINTS_PER_RUN, CHAIN_MAX_BLOCKS_PER_RUN,
 *                  CHAIN_MIN_OPERATOR_BALANCE_WEI
 *
 * BRIDGE_OPERATOR_KEY is the one hot key allowed to mint ICEC-C, and the contract caps what it can mint per day. Keep it
 * in the host's secret store, fund it with only enough gas money for a few days, and rotate it with setOperator on the
 * contract if it is ever exposed. A KMS-backed signer is the recommended upgrade.
 */

import { ethers } from 'ethers';
import { createSupabaseRpc, isAuthorized, loadConfig, runSync } from './_lib/chainRelayer.js';

export default async function handler(req, res) {
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
