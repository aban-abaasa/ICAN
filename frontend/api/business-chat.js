/**
 * Vercel Serverless Function -- the AI assistant behind the "Ask us" chat bubble on a business's public
 * website (/notices/<companyId>). No login: visitors are anonymous, so everything it can say comes from the
 * business's PUBLIC facts (see api/_lib/businessChat.js) and the per-call token cap, request caps and rate
 * limits keep the AI bill bounded.
 *
 * Route: POST /api/business-chat
 * Body:  { companyId: uuid, messages: [{ role: 'user' | 'assistant', text }], app?: string }  (last message is the visitor's;
 *         `app` = the IcanEra app the chat was opened from, used only on the GODMINDERA site)
 * Reply: { reply, needsHuman, suggestions: string[], actions: [{ label, tab }], source: 'ai' | 'fallback' | 'memory',
 *          platform: boolean, app?: string|null, links?: [{ id, label, url }],     (app/links: GODMINDERA site only)
 *          memoryId?: uuid, pinned?: boolean }                                      (the answer is, or now is, remembered)
 *
 * Remembered answers (api/_lib/chatMemory.js): a question already answered gets its stored answer (source 'memory').
 * Body { memoryFeedback: { companyId, memoryId, helpful: boolean } } records a visitor's thumbs up/down on one; reply { ok: true }.
 *
 * The same endpoint also answers first in the Support chat inside the IcanEra app (see api/_lib/supportChat.js):
 * Body:  { supportConversationId: uuid }   (the customer's message is already in the thread)
 * Reply: { replied: boolean, reason?: string, source?: 'ai' | 'fallback' | 'fixed', message?: <the chat_messages row written> }
 *
 * Env: SUPABASE_URL + SUPABASE_ANON_KEY (same as share-preview), OPENAI_API_KEY and/or GEMINI_API_KEY
 * (optional -- without one the rule-based fallback answers), SUPABASE_SERVICE_ROLE_KEY (optional -- without it the
 * assistant has no answer memory and asks the AI every time).
 */
import { applyCors } from './_lib/cors.js';
import { answerVisitor, checkRate, parseRequest } from './_lib/businessChat.js';
import { answerSupportThread, parseSupportRequest } from './_lib/supportChat.js';
import { memoryConfig, rateAnswer } from './_lib/chatMemory.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return res.status(503).json({ error: 'Chat is temporarily unavailable' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();

  // The same AI also answers first in the Support chat inside the IcanEra app (api/_lib/supportChat.js). It lives here because
  // Vercel's Hobby plan allows 12 functions and api/ is at the limit (tests/apiFunctionCount.test.js).
  if (body && typeof body === 'object' && 'supportConversationId' in body) {
    const support = parseSupportRequest(body);
    if (support.error) return res.status(400).json({ error: support.error });
    if (checkRate({ ip, companyId: support.conversationId })) return res.status(429).json({ error: 'You are sending messages too quickly. Please wait a moment.' });
    try {
      const result = await answerSupportThread({ supabase: { url, anonKey }, conversationId: support.conversationId });
      return res.status(result.status).json(result.body);
    } catch (err) {
      console.error('support-chat failed:', err);
      return res.status(500).json({ replied: false, error: 'Something went wrong. Please try again.' });
    }
  }

  // A visitor's thumbs up/down on a remembered answer (api/_lib/chatMemory.js). Same endpoint for the same function-count reason.
  if (body && typeof body === 'object' && body.memoryFeedback && typeof body.memoryFeedback === 'object') {
    const { companyId, memoryId, helpful } = body.memoryFeedback;
    if (checkRate({ ip, companyId: String(companyId) })) return res.status(429).json({ error: 'Please wait a moment.' });
    await rateAnswer({ memory: memoryConfig(), companyId, memoryId, helpful });
    return res.status(200).json({ ok: true });
  }

  const parsed = parseRequest(body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  if (checkRate({ ip, companyId: parsed.companyId })) {
    return res.status(429).json({ error: 'You are sending messages too quickly. Please wait a moment.' });
  }

  try {
    const result = await answerVisitor({ supabase: { url, anonKey }, companyId: parsed.companyId, messages: parsed.messages, focusApp: parsed.focusApp, memory: memoryConfig() });
    return res.status(result.status).json(result.body);
  } catch (err) {
    console.error('business-chat failed:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}
