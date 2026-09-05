/**
 * Vercel cron endpoint — deletes portfolio direct-chat messages that have
 * passed their 24h expiry and were never marked "kept" by the resume owner.
 *
 * This is just a backstop: public.get_portfolio_conversation_messages()
 * (see backend/db/ADD_PORTFOLIO_MESSAGE_EXPIRY.sql) already sweeps a
 * conversation's own expired messages every time either side opens/polls
 * it, so most disappear right on schedule without waiting for this cron —
 * this only catches messages in a thread nobody reopened.
 *
 * Route: GET or POST /api/cron/cleanup-portfolio-messages
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Auth: Vercel cron header, or ?secret=/x-automation-secret matching
 * REPORT_AUTOMATION_SECRET (same secret/pattern as report-automation.js).
 */

export default async function handler(req, res) {
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
    const response = await fetch(`${url}/rest/v1/rpc/cleanup_expired_portfolio_messages`, {
      method: 'POST',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`cleanup_expired_portfolio_messages failed (${response.status}): ${text}`);
    }

    const result = await response.json();
    const deletedCount = result?.[0]?.deleted_count ?? 0;
    return res.status(200).json({ success: true, deletedCount });
  } catch (err) {
    console.error('Portfolio message cleanup sweep error:', err);
    return res.status(502).json({ error: 'Portfolio message cleanup sweep failed', detail: err.message });
  }
}
