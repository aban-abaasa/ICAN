/**
 * Vercel Serverless Function — emails a one-time "delete my account" link.
 *
 * Ports ICAN/backend/routes/emailRoutes.js's POST /api/email/
 * request-account-deletion (the Express dev server) to this project's
 * actual production home, same reasoning as request-account-otp.js in this
 * same folder: that Express server is dev-only and never deployed, so
 * MobileView.jsx's Danger Zone "Send Deletion Link" failed to fetch (CORS
 * error, since the request fell through to frontend/vercel.json's catch-all
 * SPA rewrite instead of reaching any real handler) for every real visitor.
 *
 * See ICAN/backend/DELETE_ACCOUNT_EMAIL_SELFSERVICE.sql for the
 * account_deletion_tokens table this writes to, and the delete-account
 * Supabase Edge Function (deployed separately, not through Vercel) for
 * where the raw token from the emailed link is actually redeemed.
 *
 * MUST live under ICAN/frontend/api/ — see request-account-otp.js's header
 * comment for why a copy anywhere else silently never gets reached.
 *
 * Route: POST /api/email/request-account-deletion
 * Body: { confirmEmail, confirmPhrase }
 * Required env vars (Vercel dashboard, Production + Preview):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY
 * Optional: SENDER_EMAIL (default noreply@icanera.space), SUPPORT_EMAIL, APP_URL
 */

import crypto from 'node:crypto';
import { applyCors } from '../_lib/cors.js';

const supabaseRest = async ({ path, method = 'GET', query, body, prefer }) => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
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
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
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
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    if ((!process.env.SUPABASE_URL && !process.env.VITE_SUPABASE_URL) || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
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
    if (!currentUser.email) {
      return res.status(400).json({ success: false, message: 'No email on file for this account.' });
    }

    const confirmEmail = String(req.body?.confirmEmail || '').trim().toLowerCase();
    const confirmPhrase = String(req.body?.confirmPhrase || '').trim().toLowerCase();

    if (confirmEmail !== currentUser.email.trim().toLowerCase()) {
      return res.status(400).json({ success: false, message: "That email does not match your account email." });
    }
    if (confirmPhrase !== 'delete my account') {
      return res.status(400).json({ success: false, message: 'Please type "delete my account" exactly to confirm.' });
    }

    // Cooldown: don't send another email if a live token was already issued
    // for this user in the last couple of minutes.
    const recent = await supabaseRest({
      path: 'account_deletion_tokens',
      query: {
        select: 'id,created_at',
        user_id: `eq.${currentUser.id}`,
        used_at: 'is.null',
        expires_at: `gt.${new Date().toISOString()}`,
        order: 'created_at.desc',
        limit: '1'
      }
    });
    const recentRow = Array.isArray(recent) ? recent[0] : null;
    if (recentRow && Date.now() - new Date(recentRow.created_at).getTime() < 2 * 60 * 1000) {
      return res.status(200).json({ success: true, message: 'A deletion link was already sent — check your email.' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    await supabaseRest({
      path: 'account_deletion_tokens',
      method: 'POST',
      prefer: 'return=minimal',
      body: [{ user_id: currentUser.id, token_hash: tokenHash, expires_at: expiresAt }]
    });

    const appUrl = process.env.APP_URL || 'https://icanera.space';
    const deletionLink = `${appUrl}/confirm-delete-account?token=${rawToken}`;
    const fromEmail = process.env.SENDER_EMAIL || 'noreply@icanera.space';
    const supportEmail = process.env.SUPPORT_EMAIL || 'support@ican.ug';

    await sendEmail({
      to: currentUser.email,
      from: fromEmail,
      subject: '⚠️ Confirm Deletion of Your ICAN Account',
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: #dc2626; color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                <h1>⚠️ Delete Your Account</h1>
              </div>
              <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px;">
                <p>Hi ${currentUser.email},</p>
                <p>We received a request to permanently delete your ICAN account. This action cannot be undone.</p>
                <a href="${deletionLink}" style="display: inline-block; background: #dc2626; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Permanently Delete My Account</a>
                <p style="font-size: 12px; word-break: break-all;">${deletionLink}</p>
                <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px 15px; margin: 15px 0; border-radius: 4px;">
                  ⚠️ This link expires in 30 minutes and can only be used once. If you didn't request this, ignore this email — your account stays exactly as it is.
                </div>
                <p style="font-size: 12px; color: #666;">Support: ${supportEmail}</p>
              </div>
            </div>
          </body>
        </html>
      `
    });

    return res.status(200).json({ success: true, message: 'Deletion link sent — check your email.' });
  } catch (error) {
    console.error('❌ Error requesting account deletion:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to send deletion link.' });
  }
}
