/**
 * Vercel Serverless Function -- the AI assistant behind the "Ask us" chat bubble on a business's public
 * website (/notices/<companyId>). No login: visitors are anonymous, so everything it can say comes from the
 * business's PUBLIC facts (see api/_lib/businessChat.js) and the per-call token cap, request caps and rate
 * limits keep the AI bill bounded.
 *
 * Route: POST /api/business-chat
 * Body:  { companyId: uuid, messages: [{ role: 'user' | 'assistant', text }] }  (last one is the visitor's)
 * Reply: { reply, needsHuman, suggestions: string[], actions: [{ label, tab }], source: 'ai' | 'fallback' }
 *
 * Env: SUPABASE_URL + SUPABASE_ANON_KEY (same as share-preview), OPENAI_API_KEY and/or GEMINI_API_KEY
 * (optional -- without one the rule-based fallback answers).
 */
import { applyCors } from './_lib/cors.js';
import { answerVisitor, checkRate, parseRequest } from './_lib/businessChat.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return res.status(503).json({ error: 'Chat is temporarily unavailable' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const parsed = parseRequest(body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (checkRate({ ip, companyId: parsed.companyId })) {
    return res.status(429).json({ error: 'You are sending messages too quickly. Please wait a moment.' });
  }

  try {
    const result = await answerVisitor({ supabase: { url, anonKey }, companyId: parsed.companyId, messages: parsed.messages });
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('business-chat failed:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
