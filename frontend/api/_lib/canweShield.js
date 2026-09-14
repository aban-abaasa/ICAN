/**
 * ICAN Canwe Shield (Vercel serverless variant).
 *
 * Deception-based bot/attacker detection: hidden form fields and decoy
 * routes real users never touch, wired to flag and slow down whoever does.
 * Named deliberately generic rather than a recognizable security term, so
 * nothing in this file's name, its import paths, or its log tags gives the
 * mechanism away to anyone reading the shipped client bundle or the repo.
 *
 * This is the SAME logic as backend/middleware/canweShield.js, ported to
 * talk to Supabase over raw REST/RPC fetch calls instead of
 * @supabase/supabase-js -- matching the existing convention in this api/
 * workspace (see api/tax-rules/[countryCode].js, api/report-automation.js),
 * which doesn't carry that package as a dependency.
 *
 * Why this copy exists at all: ICAN/frontend/src/lib/backendUrl.js's own
 * comment is explicit that api/** here is "the only backend that's ever
 * actually running" for the deployed frontend -- i.e. this is the origin a
 * real scanner hits, and where robots.txt Disallow entries actually resolve.
 * The separate Express copy in ICAN/backend guards the standalone MOMO/
 * withdrawals dev server; both read/write the same Supabase tables
 * independently since neither can share in-memory state with the other.
 */

const ipCache = new Map(); // ip -> { flagged, hit_count, severity, expiresAt }
const CACHE_TTL_MS = 30_000;

export const HONEYTOKEN_FIELDS = ['admin_pass', 'root_token', 'backup_key', 'website', 'confirm_email_2'];
const SENSITIVE_LOG_KEYS = ['password', 'pin', 'pass', 'token', 'secret', 'card', 'cvv'];

function supabaseEnv() {
  return {
    url: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function callRpc(fn, args) {
  const { url, serviceKey } = supabaseEnv();
  if (!url || !serviceKey) return null;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify(args),
    });
    if (!res.ok) {
      console.error(`[canwe] rpc ${fn} failed: ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error(`[canwe] rpc ${fn} error:`, err.message);
    return null;
  }
}

export function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

function redactPayload(body) {
  if (!body || typeof body !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    out[key] = SENSITIVE_LOG_KEYS.some((k) => key.toLowerCase().includes(k)) ? '[redacted]' : value;
  }
  return out;
}

export function tarpitDelayMs(hitCount = 1) {
  return Math.min(10_000 + (Math.max(hitCount, 1) - 1) * 4_000, 30_000);
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fails open: {flagged:false} on any Supabase error, so infra hiccups never
// block real users -- this is a deception bonus layer, not primary authz.
export async function isIpFlagged(ip) {
  const cached = ipCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached;
  const data = await callRpc('check_ip_flagged', { p_ip: ip, p_app_name: 'ican' });
  const result = data || { flagged: false };
  ipCache.set(ip, { ...result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}

export async function logThreat({ ip, userAgent, triggerType, route, method, payload, severity = 'medium' }) {
  ipCache.delete(ip); // next isIpFlagged() call must see the fresh flag
  const data = await callRpc('log_security_threat', {
    p_ip: ip,
    p_user_agent: userAgent || null,
    p_trigger_type: triggerType,
    p_route: route || null,
    p_http_method: method || null,
    p_payload: redactPayload(payload),
    p_app_name: 'ican',
    p_severity: severity,
  });
  if (data) {
    console.warn(`[canwe] THREAT ${triggerType} ip=${ip} route=${route || '-'} severity=${data.severity} hits=${data.hit_count}`);
  }
  return data;
}

export function decoyBaitResponse() {
  return { success: true, data: [], meta: { generated_at: new Date().toISOString(), version: '1.0.0' } };
}

/** Drop-in default export for any api/** decoy route file. */
export async function decoyHandler(req, res) {
  const ip = getClientIp(req);
  await logThreat({
    ip,
    userAgent: req.headers['user-agent'],
    triggerType: 'decoy_route',
    route: req.url,
    method: req.method,
    payload: req.body,
    severity: 'high',
  });
  await delay(tarpitDelayMs(2));
  res.status(200).json(decoyBaitResponse());
}
