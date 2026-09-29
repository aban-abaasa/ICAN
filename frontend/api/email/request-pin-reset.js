/**
 * Vercel Serverless Function — sends a one-time PIN reset link.
 *
 * The Express implementation lives in backend/routes/emailRoutes.js, but
 * production serves this app from Vercel and does not deploy that Express
 * server. This function provides the same endpoint at
 * POST /api/email/request-pin-reset and handles local-development preflight
 * requests through the shared bearer-authenticated CORS helper.
 *
 * Required Vercel environment variables: SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.
 */
import crypto from 'node:crypto';
import { applyCors } from '../_lib/cors.js';

const supabaseRest = async ({ path, method = 'GET', query, body, prefer }) => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const endpoint = new URL(`${supabaseUrl}/rest/v1/${path}`);
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
    const detail = await response.text();
    throw new Error(`Supabase request failed (${response.status}): ${detail}`);
  }
  return (response.headers.get('content-type') || '').includes('application/json')
    ? response.json()
    : null;
};

const getUserFromToken = async (accessToken) => {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${accessToken}` }
  });
  return response.ok ? response.json() : null;
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
    const result = await response.json().catch(() => ({}));
    throw new Error(result?.message || `Email request failed (${response.status})`);
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
    const currentUser = await getUserFromToken(authHeader.slice(7).trim());
    if (!currentUser?.id) {
      return res.status(401).json({ success: false, message: 'Invalid or expired session.' });
    }

    const accountType = req.body?.accountType === 'business' ? 'business' : 'personal';
    const accounts = await supabaseRest({
      path: 'user_accounts',
      query: {
        select: 'account_holder_name,email',
        user_id: `eq.${currentUser.id}`,
        account_type: `eq.${accountType}`,
        limit: '1'
      }
    });
    const account = Array.isArray(accounts) ? accounts[0] : null;
    if (!account) {
      return res.status(404).json({ success: false, message: `No ${accountType} account found for this user.` });
    }

    const recipientEmail = account.email || currentUser.email;
    if (!recipientEmail) {
      return res.status(400).json({ success: false, message: 'No email on file for this account.' });
    }

    const recentRows = await supabaseRest({
      path: 'pin_reset_tokens',
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
    const recent = Array.isArray(recentRows) ? recentRows[0] : null;
    if (recent && Date.now() - new Date(recent.created_at).getTime() < 2 * 60 * 1000) {
      return res.status(200).json({ success: true, message: 'A reset link was already sent — check your email.' });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    await supabaseRest({
      path: 'pin_reset_tokens',
      method: 'POST',
      prefer: 'return=minimal',
      body: [{ user_id: currentUser.id, token_hash: tokenHash, expires_at: expiresAt, account_type: accountType }]
    });

    const appUrl = process.env.APP_URL || 'https://icanera.space';
    const resetLink = `${appUrl}/reset-pin?token=${rawToken}`;
    const accountLabel = accountType === 'business' ? 'Business' : 'Personal';
    const supportEmail = process.env.SUPPORT_EMAIL || 'support@ican.ug';
    const safeName = String(account.account_holder_name || currentUser.email || 'there')
      .replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const safeLink = resetLink.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

    await sendEmail({
      to: recipientEmail,
      from: process.env.SENDER_EMAIL || 'noreply@icanera.space',
      subject: `🔐 Reset Your ICAN ${accountLabel} Wallet PIN`,
      html: `<html><body style="font-family:Arial,sans-serif;color:#333"><div style="max-width:600px;margin:0 auto;padding:20px"><h1>🔐 PIN Reset</h1><p>Hi ${safeName},</p><p>Click below to set a new PIN for your ICAN ${accountLabel} Wallet.</p><a href="${safeLink}" style="display:inline-block;background:#667eea;color:white;padding:12px 30px;text-decoration:none;border-radius:5px;margin:20px 0">Reset My PIN</a><p style="font-size:12px;word-break:break-all">${safeLink}</p><p>This link expires in 30 minutes and can only be used once. If you didn't request this, ignore this email — your PIN stays unchanged.</p><p style="font-size:12px;color:#666">Support: ${supportEmail}</p></div></body></html>`
    });

    return res.status(200).json({ success: true, message: 'Reset link sent — check your email.' });
  } catch (error) {
    console.error('Error requesting PIN reset:', error);
    return res.status(500).json({ success: false, message: error.message || 'Failed to send reset link.' });
  }
}
