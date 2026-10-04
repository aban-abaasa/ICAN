/**
 * Vercel cron endpoint — deletes the vehicle photos of visits that are over, so
 * Supabase Storage never fills up even when no staff member has the Visitor
 * Management screen open (the screen runs the same clean-up itself).
 *
 * A photo is removed once its visit is checked out or its entry was declined, or
 * when it was uploaded but never attached to a visit and is a day old. The list
 * comes from get_visitor_photos_to_purge() (see
 * backend/CMMS_VISITOR_VEHICLE_APPROVAL.sql). Files are deleted through the
 * Storage API — a SQL DELETE would leave the file in S3 and still be billed —
 * and confirm_visitor_photos_purged() then clears the stored path once the file
 * is really gone, so a half-finished run is simply retried by the next one.
 *
 * Route: GET or POST /api/visitor-photo-sweep
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Auth: Vercel cron header, or ?secret=/x-automation-secret matching
 * REPORT_AUTOMATION_SECRET (same pattern as investment-expiry-sweep.js).
 * Schedule it with a Vercel cron, e.g. { "path": "/api/visitor-photo-sweep", "schedule": "30 2 * * *" }.
 */

const BUCKET = 'cmms-visitor-vehicle-photos';

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
  const providedSecret = req.query?.secret || req.headers['x-automation-secret'];
  const configuredSecret = process.env.REPORT_AUTOMATION_SECRET;

  if (!isVercelCron && configuredSecret && providedSecret !== configuredSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
  const rpc = (name, body) => fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });

  try {
    // No company: the service role sweeps every company, including uploads nobody can resolve.
    const listed = await rpc('get_visitor_photos_to_purge', { p_cmms_company_id: null });
    if (!listed.ok) throw new Error(`get_visitor_photos_to_purge failed (${listed.status}): ${await listed.text()}`);
    const paths = (await listed.json()).map((row) => row.storage_path);
    if (!paths.length) return res.status(200).json({ success: true, deleted: 0 });

    const removed = await fetch(`${url}/storage/v1/object/${BUCKET}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ prefixes: paths })
    });
    if (!removed.ok) throw new Error(`Storage delete failed (${removed.status}): ${await removed.text()}`);

    const confirmed = await rpc('confirm_visitor_photos_purged', { p_paths: paths });
    if (!confirmed.ok) throw new Error(`confirm_visitor_photos_purged failed (${confirmed.status}): ${await confirmed.text()}`);

    return res.status(200).json({ success: true, deleted: paths.length });
  } catch (err) {
    console.error('Visitor photo sweep error:', err);
    return res.status(502).json({ error: 'Visitor photo sweep failed', detail: err.message });
  }
}
