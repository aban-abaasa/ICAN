/**
 * Vercel Serverless Function — emails a wallet-PIN reset link via Resend.
 *
 * Route: POST /api/email/request-pin-reset
 * Body: { accountType: 'personal'|'business', accountId?: uuid, redirectTo?: url }
 *
 * Verifies the caller's session, confirms they own the chosen account
 * (for business: directly, or through a business profile they own), then
 * generates a Supabase Auth recovery link and sends it through Resend. The
 * link opens ResetPinPage, which calls reset_wallet_pin_from_recovery(); that
 * RPC re-checks ownership, so the email step is only the proof-of-inbox.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
 * Optional: SENDER_EMAIL, APP_URL
 */

const ALLOWED_ORIGINS = new Set([
  'https://icanera.space',
  'http://localhost:3001',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173'
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const supabaseUrl = () => process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;

const supabaseRest = async (path, query) => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const endpoint = new URL(`${supabaseUrl()}/rest/v1/${path}`);
  Object.entries(query).forEach(([k, v]) => endpoint.searchParams.set(k, v));
  const response = await fetch(endpoint.toString(), {
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!response.ok) throw new Error(`Supabase request failed (${response.status})`);
  return response.json();
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl() || !serviceKey) {
      return res.status(500).json({ success: false, message: 'Server is missing Supabase configuration.' });
    }
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ success: false, message: 'Server is missing email configuration.' });
    }

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Sign in before requesting a PIN reset link.' });
    }
    const userResponse = await fetch(`${supabaseUrl()}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: authHeader }
    });
    const user = userResponse.ok ? await userResponse.json() : null;
    if (!user?.id || !user.email) {
      return res.status(401).json({ success: false, message: 'Your session expired. Sign in and try again.' });
    }

    const accountType = req.body?.accountType === 'business' ? 'business' : 'personal';
    const accountId = accountType === 'business' && UUID_RE.test(String(req.body?.accountId || ''))
      ? String(req.body.accountId)
      : null;

    const query = {
      select: 'id,account_holder_name',
      account_type: 'eq.' + accountType,
      limit: '1'
    };
    if (accountId) query.id = `eq.${accountId}`;
    if (accountType === 'business') {
      const profiles = await supabaseRest('business_profiles', { select: 'id', user_id: `eq.${user.id}` });
      const ownedIds = profiles.map((p) => p.id);
      query.or = ownedIds.length
        ? `(user_id.eq.${user.id},business_id.in.(${ownedIds.join(',')}))`
        : `(user_id.eq.${user.id})`;
    } else {
      query.user_id = `eq.${user.id}`;
    }
    const [account] = await supabaseRest('user_accounts', query);
    if (!account) {
      return res.status(404).json({ success: false, message: `No ${accountType} wallet account was found.` });
    }

    const siteUrl = process.env.APP_URL || 'https://icanera.space';
    let redirectTo = new URL('/reset-password', siteUrl);
    try {
      const requested = new URL(String(req.body?.redirectTo || ''));
      if (ALLOWED_ORIGINS.has(requested.origin) && requested.pathname === '/reset-password') {
        redirectTo = requested;
      }
    } catch {
      // fall back to the canonical app URL
    }
    redirectTo.searchParams.set('accountType', accountType);
    redirectTo.searchParams.set('flow', 'pin');
    if (accountId) redirectTo.searchParams.set('accountId', account.id);

    const linkResponse = await fetch(`${supabaseUrl()}/auth/v1/admin/generate_link`, {
      method: 'POST',
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'recovery', email: user.email, redirect_to: redirectTo.toString() })
    });
    const linkData = await linkResponse.json().catch(() => ({}));
    const actionLink = linkData?.action_link || linkData?.properties?.action_link;
    if (!linkResponse.ok || !actionLink) {
      console.error('PIN recovery link generation failed:', linkData);
      return res.status(500).json({ success: false, message: 'Could not create a PIN reset link.' });
    }

    const label = accountType === 'business' ? 'business' : 'personal';
    const name = escapeHtml(account.account_holder_name || user.email);
    const link = escapeHtml(actionLink);
    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.SENDER_EMAIL || 'noreply@icanera.space',
        to: user.email,
        subject: `🔐 Reset your ICAN ${label} wallet PIN`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937"><h1>Reset your wallet PIN</h1><p>Hello ${name},</p><p>We received a request to reset the PIN for your ICAN ${label} wallet${accountType === 'business' ? ` (<b>${name}</b>)` : ''}.</p><p><a href="${link}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none">Reset wallet PIN</a></p><p>This link expires shortly and works once. If you didn't request this, ignore this email; your PIN stays unchanged.</p><p style="font-size:12px;color:#6b7280">If the button doesn't work, copy this link:<br>${link}</p></div>`
      })
    });
    if (!emailResponse.ok) {
      console.error('PIN reset email failed:', await emailResponse.text());
      return res.status(502).json({ success: false, message: 'Could not send the PIN reset email.' });
    }

    return res.status(200).json({ success: true, message: 'PIN reset link sent. Check your email.' });
  } catch (error) {
    console.error('request-pin-reset error:', error);
    return res.status(500).json({ success: false, message: 'Failed to request a PIN reset link.' });
  }
}
