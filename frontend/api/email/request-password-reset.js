/**
 * Vercel Serverless Function — requests Supabase's password recovery email.
 * Keeps local development browser requests on the same CORS-enabled API
 * surface as other email actions, while Supabase still owns recovery links
 * and password updates.
 *
 * Required environment variables: SUPABASE_URL and VITE_SUPABASE_ANON_KEY
 * (SUPABASE_ANON_KEY is also accepted). APP_URL is optional.
 */
import { applyCors } from '../_lib/cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return res.status(500).json({ success: false, message: 'Server is missing Supabase configuration.' });
  }

  const email = String(req.body?.email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Enter a valid email address.' });
  }

  try {
    const appUrl = process.env.APP_URL || 'https://icanera.space';
    const allowedOrigins = new Set([
      'https://icanera.space',
      'http://localhost:3001',
      'http://localhost:3000',
      'http://localhost:5173',
      'http://127.0.0.1:3001',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:5173'
    ]);
    let redirectOrigin = appUrl;
    try {
      const requestedOrigin = new URL(req.body?.redirectTo).origin;
      if (allowedOrigins.has(requestedOrigin)) redirectOrigin = requestedOrigin;
    } catch {
      // Use the configured app URL when no valid local/app origin is supplied.
    }
    const redirectTo = new URL('/reset-password', redirectOrigin).toString();
    const recoveryUrl = new URL('/auth/v1/recover', supabaseUrl);
    recoveryUrl.searchParams.set('redirect_to', redirectTo);

    const response = await fetch(recoveryUrl.toString(), {
      method: 'POST',
      headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      return res.status(response.status).json({
        success: false,
        message: result.msg || result.message || result.error_description || 'Failed to send password reset email.'
      });
    }

    return res.status(200).json({ success: true, message: 'Password reset instructions sent.' });
  } catch (error) {
    console.error('Error requesting password reset:', error);
    return res.status(500).json({ success: false, message: 'Failed to send password reset email.' });
  }
}
