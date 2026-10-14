/**
 * Wallet linking, step 2: the browser sends the wallet's signature over the challenge the database issued
 * (ican_chain_link_challenge); this endpoint checks the signature really comes from that address, and asks the database
 * to record the link. Only the account that asked for the challenge can complete it.
 *
 * Route: POST /api/chain-link   Body: { challengeId, signature }   Header: Authorization: Bearer <the user's Supabase token>
 * Env:   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and the public anon key (SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY)
 */

import { createSupabaseRpc, userFromToken, verifyAndLink } from './_lib/chainRelayer.js';

const pick = (...names) => { for (const n of names) { const v = String(process.env[n] || '').trim().replace(/^["']|["']$/g, ''); if (v) return v; } return ''; };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const url = pick('SUPABASE_URL', 'VITE_SUPABASE_URL');
  const serviceKey = pick('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = pick('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY');
  if (!url || !serviceKey || !anonKey) return res.status(500).json({ success: false, error: 'Linking is not configured' });

  const token = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''))?.[1]?.trim();
  try {
    // Who is asking comes from Supabase itself, never from the request body.
    const userId = await userFromToken({ url, anonKey, token });
    if (!userId) return res.status(401).json({ success: false, code: 'not_signed_in', error: 'Please sign in.' });
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const result = await verifyAndLink({ db: createSupabaseRpc({ url, serviceKey }), userId, challengeId: body.challengeId, signature: body.signature });
    return res.status(result?.success ? 200 : 400).json(result);
  } catch (err) {
    console.error('chain-link error:', err?.message);
    return res.status(502).json({ success: false, error: 'Could not complete linking. Please try again.' });
  }
}
