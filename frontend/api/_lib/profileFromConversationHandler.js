/**
 * "Read my conversation" for the resume and the Pitchin business profile.
 *
 * Not its own Vercel function: the project is at its serverless function limit, so
 * api/ai-analysis.js hands requests with task "profile-from-conversation" to this handler.
 *
 * POST /api/ai-analysis
 *   Authorization: Bearer <Supabase access token>
 *   { task: "profile-from-conversation", target: "resume" | "business", text, subject? }
 * -> 200 { target, result }   (result is already sanitised, see profileExtraction.js)
 *
 * Signed-in people only (it spends AI credit and handles personal text). The conversation is
 * used for this one request and is neither stored nor logged.
 */

import { callAI } from './aiProvider.js';
import { verifySupabaseUser } from './verifyUser.js';
import {
  MAX_CONVERSATION_CHARS, SANITIZERS, buildMessages, isEmptyResult, parseModelJson,
} from './profileExtraction.js';

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 8;
const MIN_CHARS = 40;
const hits = new Map(); // user id -> [timestamps]; best effort per server instance

const isRateLimited = (userId) => {
  const now = Date.now();
  const recent = (hits.get(userId) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return true;
  recent.push(now);
  hits.set(userId, recent);
  if (hits.size > 5000) {
    for (const [key, stamps] of hits) {
      if (stamps.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
};

export default async function handleProfileFromConversation(req, res) {
  const authHeader = req.headers.authorization || '';
  const user = authHeader.startsWith('Bearer ') ? await verifySupabaseUser(authHeader.slice(7).trim()) : null;
  if (!user) return res.status(401).json({ error: 'Please sign in again.' });

  const { target, text, subject } = req.body || {};
  if (!SANITIZERS[target]) return res.status(400).json({ error: 'target must be "resume" or "business".' });
  const conversation = typeof text === 'string' ? text.trim() : '';
  if (conversation.length < MIN_CHARS) {
    return res.status(400).json({ error: 'There is not enough text to read yet. Add a few more sentences.' });
  }
  if (conversation.length > MAX_CONVERSATION_CHARS * 2) {
    return res.status(413).json({ error: 'That conversation is too long. Paste a shorter part of it.' });
  }
  if (isRateLimited(user.id)) {
    return res.status(429).json({ error: 'You have used this several times in a row. Please wait a few minutes and try again.' });
  }

  let reply;
  try {
    reply = await callAI({
      messages: buildMessages(target, conversation, typeof subject === 'string' ? subject : ''),
      temperature: 0.2,
      maxTokens: 1800,
      jsonMode: true,
    });
  } catch (error) {
    // Keep provider details out of the response; the log carries the reason, never the text.
    console.error('profile-from-conversation: AI call failed:', error?.message);
    return res.status(503).json({ error: 'The reading assistant is not available right now. Please try again later.' });
  }

  const parsed = parseModelJson(reply.content);
  if (!parsed) return res.status(502).json({ error: 'The assistant answered in a way we could not use. Please try again.' });

  const result = SANITIZERS[target](parsed);
  if (isEmptyResult(target, result)) {
    return res.status(422).json({ error: target === 'resume'
      ? 'Nothing about your career or background could be found in that text. Try telling it in your own words, with roles, places and years.'
      : 'Nothing about your business could be found in that text. Try describing what it sells, to whom, and how it makes money.' });
  }
  return res.status(200).json({ target, result });
}
