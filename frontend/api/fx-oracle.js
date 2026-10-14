/**
 * Scheduled endpoint: refresh the informational USD -> local-currency rates the app uses to show ICEC-S (a US-dollar
 * token) in a local currency. DISPLAY ONLY: no mint, redeem, withdrawal or trade reads these numbers, and they do not
 * touch ican_currency_rates. The database applies its own guards (jump limit, staleness, time-weighted average).
 *
 * Route: GET or POST /api/fx-oracle      Schedule: every minute is the most a database like this needs
 * Auth:  same as /api/chain-sync (Authorization: Bearer <secret>)
 * Env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CHAIN_CRON_SECRET (or CRON_SECRET)
 *        optional: FX_PROVIDER_URL (default https://open.er-api.com/v6/latest/USD, which needs no key but refreshes only
 *        about once a day: use a provider with intraday rates if the screen should follow the market within minutes; put
 *        any key in this URL's environment variable, never in the code), FX_PAIRS (default USD/UGX,USD/KES,USD/TZS,USD/RWF)
 */

import { createSupabaseRpc, isAuthorized, runFxOracle } from './_lib/chainRelayer.js';

const pick = (...names) => { for (const n of names) { const v = String(process.env[n] || '').trim().replace(/^["']|["']$/g, ''); if (v) return v; } return ''; };

export default async function handler(req, res) {
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
