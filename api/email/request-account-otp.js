/**
 * Vercel Serverless Function — sends a 6-digit email verification code
 * before a user can set their wallet PIN for the first time.
 *
 * Ports ICAN/backend/routes/emailRoutes.js's POST /api/email/request-account-otp
 * (the Express dev server) to this project's actual production home. That
 * Express server is dev-only — it's never deployed — so ICANWallet.jsx's
 * "verify your email" step 404'd/failed to fetch for every real visitor.
 * See SIGNUP_EMAIL_OTP_VERIFICATION.sql for the account_creation_otps table
 * and verify_account_creation_otp() RPC this code hash feeds into.
 *
 * This file (and the sibling api/*.js functions already in this project)
 * uses only Node built-ins (fetch, crypto) instead of @supabase/supabase-js
 * or axios — vercel.json's installCommand only installs frontend/'s
 * node_modules, so a package that isn't a Node built-in won't be present
 * for a function running from ICAN/api/**.
 *
 * Route: POST /api/email/request-account-otp
 * Required env vars (Vercel dashboard, Production + Preview):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
 * Optional: SENDER_EMAIL (default noreply@icanera.space), SUPPORT_EMAIL
 */

import crypto from 'node:crypto';

const supabaseRest = async ({ path, method = 'GET', query, body, prefer }) => {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const endpoint = new URL(`${url}/rest/v1/${path}`);
  if (query) Object.entries(query).forEach(([key, value]) => endpoint.searchParams.set(key, value));

  const response = await fetch(endpoint.toString(), {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${text}`);
  }

  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : null;
};

// Mirrors what @supabase/supabase-js's auth.getUser(accessToken) does under
// the hood — a GET to GoTrue with the caller's own token, validated against
// the project (apikey doesn't need to be the caller's key here).
const getUserFromToken = async (accessToken) => {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  return response.json();
};

const sendEmail = async ({ to, from, subject, html }) => {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to, subject, html })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.message || `Resend request failed (${response.status})`);
  }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ success: false, message: 'Server is missing Supabase configuration.' });
    }
    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ success: false, message: 'Server is missing email configuration.' });
    }

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Missing authorization token.' });
    }
    const accessToken = authHeader.replace('Bearer ', '').trim();

    const currentUser = await getUserFromToken(accessToken);
    if (!currentUser?.id) {
      return res.status(401).json({ success: false, message: 'Invalid or expired session.' });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    const accountType = req.body?.accountType === 'business' ? 'business' : 'personal';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
    }

    // Cooldown: don't spam a fresh code if one is still live for this user +
    // account type.
    const recent = await supabaseRest({
      path: 'account_creation_otps',
      query: {
        select: 'id,created_at',
        user_id: `eq.${currentUser.id}`,
        account_type: `eq.${accountType}`,
        used_at: 'is.null',
        expires_at: `gt.${new Date().toISOString()}`,
        order: 'created_at.desc',
        limit: '1'
      }
    });
    const recentRow = Array.isArray(recent) ? recent[0] : null;
    if (recentRow && Date.now() - new Date(recentRow.created_at).getTime() < 60 * 1000) {
      return res.status(200).json({ success: true, message: 'A code was already sent — check your email.' });
    }

    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    await supabaseRest({
      path: 'account_creation_otps',
      method: 'POST',
      prefer: 'return=minimal',
      body: [{ user_id: currentUser.id, email, account_type: accountType, code_hash: codeHash, expires_at: expiresAt }]
    });

    const fromEmail = process.env.SENDER_EMAIL || 'noreply@icanera.space';
    const supportEmail = process.env.SUPPORT_EMAIL || 'support@ican.ug';
    const accountLabel = accountType === 'business' ? 'Business' : 'Personal';

    await sendEmail({
      to: email,
      from: fromEmail,
      subject: `🔐 Your ICAN ${accountLabel} Account Verification Code`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                <h1>🔐 Verify Your Email</h1>
              </div>
              <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px;">
                <p>Enter this code to continue setting up your ICAN ${accountLabel} Wallet:</p>
                <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; color: #667eea; margin: 20px 0;">${code}</p>
                <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px 15px; margin: 15px 0; border-radius: 4px;">
                  ⚠️ This code expires in 10 minutes. If you didn't request this, ignore this email.
                </div>
                <p style="font-size: 12px; color: #666;">Support: ${supportEmail}</p>
              </div>
            </div>
          </body>
        </html>
      `
    });

    return res.status(200).json({ success: true, message: 'Verification code sent — check your email.' });
  } catch (error) {
    console.error('❌ Error requesting account OTP:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to send verification code.' });
  }
}
