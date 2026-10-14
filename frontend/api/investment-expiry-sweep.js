/**
 * Vercel cron endpoint — refunds investment_agreements whose 3-day
 * shareholder-approval window has passed without reaching 60%.
 *
 * Calls the refund_expired_investment_agreements() Postgres function
 * (see backend/INVESTMENT_ESCROW_PAYMENT_SOURCE_AND_EXPIRY.sql), which
 * credits back whichever wallet (personal or business) the investor
 * originally paid from and marks the agreement 'expired'.
 *
 * Route: GET or POST /api/investment-expiry-sweep
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Auth: Vercel cron header, or ?secret=/x-automation-secret matching
 * REPORT_AUTOMATION_SECRET (same secret/pattern as report-automation.js).
 *
 * It ALSO serves the on-chain relayer's three endpoints (/api/chain-sync, /api/chain-link, /api/fx-oracle): vercel.json
 * rewrites those paths here with ?job=..., and they are handled by api/_lib/chainRoutes.js with their own, stricter locks.
 * They are not separate files because every file under api/ is a serverless function, Vercel's Hobby plan allows 12 per
 * deployment, and the project is at 12 (tests/apiFunctionCount.test.js guards it).
 */

import { chainRouteFor } from './_lib/chainRoutes.js';

export default async function handler(req, res) {
  // The hand-off comes first, so none of the checks below (the older, header-trusting sweep rules) ever apply to the relayer.
  const chain = chainRouteFor(req);
  if (chain) return chain(req, res);

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    return res.status(500).json({ error: 'Missing Supabase automation environment variables' });
  }

  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  const providedSecret = req.query.secret || req.headers['x-automation-secret'];
  const configuredSecret = process.env.REPORT_AUTOMATION_SECRET;

  if (!isVercelCron && configuredSecret && providedSecret !== configuredSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const response = await fetch(`${url}/rest/v1/rpc/refund_expired_investment_agreements`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`refund_expired_investment_agreements failed (${response.status}): ${text}`);
    }

    const refundedCount = await response.json();
    return res.status(200).json({ success: true, refundedCount });
  } catch (err) {
    console.error('Investment expiry sweep error:', err);
    return res.status(502).json({ error: 'Investment expiry sweep failed', detail: err.message });
  }
}
