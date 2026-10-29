/**
 * Answer memory for the "Ask us" assistant (see supabase/migrations/20261122100000_business_chat_memory.sql).
 *
 * The first visitor to ask a question gets an AI answer, which is stored. A later visitor who asks (nearly) the same
 * thing gets the stored answer straight away: instant, free, and the same every time. What keeps it safe:
 *   - Only standalone questions are remembered: nothing personal (phone, email, "my order ..."), nothing that leans on
 *     an earlier message ("how much is it?"), no prompt-injection phrasing (src/utils/chatQuestionKey.js).
 *   - Only real AI answers are remembered -- never a fallback, a "ask the team" answer, or a clarifying question.
 *   - A learned answer is bound to a hash of the business's public facts, so changing hours, prices, jobs or news
 *     retires the old answers; they also expire after MEMORY_TTL_DAYS.
 *   - Reuse needs a close match on the question's key AND on its words and numbers, so "price for 5" never gets the
 *     answer for "price for 50", and a poisoned answer only ever reaches questions as odd as the one that created it.
 *   - Visitors can mark an answer unhelpful (two votes mute it) and staff can edit, pin, mute or delete any answer.
 *   - Reads and writes use the service-role key and are granted to no one else, so the public anon key can't plant answers.
 * Without SUPABASE_SERVICE_ROLE_KEY (or if the memory tables aren't installed) every function here quietly does nothing and
 * the assistant simply answers with the AI as before.
 */
import { createHash } from 'node:crypto';
import { isMemorableQuestion, questionKey, sameQuestion } from '../../src/utils/chatQuestionKey.js';

export const MEMORY_TTL_DAYS = 14;
const MIN_TRIGRAM_SIMILARITY = 0.45;
const CALL_TIMEOUT_MS = 1500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** { url, serviceKey } from the environment, or null when memory can't be used. */
export const memoryConfig = (env = process.env) => {
  const url = env.SUPABASE_URL || env.VITE_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceKey ? { url, serviceKey } : null;
};

/** Stable fingerprint of the business's public facts, ignoring the "Today's date" line so answers don't expire at midnight. */
export const factsHash = (facts) => createHash('sha256')
  .update(String(facts || '').replace(/^Today's date:.*$/m, '').trim())
  .digest('hex')
  .slice(0, 16);

const call = async (memory, fn, args) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  try {
    const res = await fetch(`${memory.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: memory.serviceKey, Authorization: `Bearer ${memory.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    return res.ok ? { data: await res.json().catch(() => null) } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
};

/**
 * A stored answer for this question, or null. `allowedTabs` re-checks the page links the answer carries, since the
 * business may have switched a page off since it was learned.
 */
export const recallAnswer = async ({ memory, companyId, question, facts, allowedTabs = [] }) => {
  if (!memory || !isMemorableQuestion(question)) return null;
  const key = questionKey(question);
  const result = await call(memory, 'fn_chat_memory_lookup', {
    p_company_id: companyId, p_key: key, p_facts_hash: factsHash(facts), p_min_similarity: MIN_TRIGRAM_SIMILARITY, p_ttl_days: MEMORY_TTL_DAYS,
  });
  const candidates = Array.isArray(result?.data) ? result.data : [];
  // Staff-pinned answers come first from the database; the first candidate that is really the same question wins.
  const match = candidates.find((c) => sameQuestion(key, c.question_key));
  if (!match) return null;
  await call(memory, 'fn_chat_memory_hit', { p_id: match.id }); // counted for the staff view (a serverless function may freeze once it has replied)
  return {
    memoryId: match.id,
    pinned: match.status === 'pinned',
    reply: match.reply,
    suggestions: Array.isArray(match.suggestions) ? match.suggestions : [],
    actions: (Array.isArray(match.actions) ? match.actions : []).filter((a) => a && allowedTabs.includes(a.tab)),
  };
};

/** Is this exchange worth remembering? Real AI answer, no hand-off, no clarifying question, standalone question. */
export const worthRemembering = ({ question, answer }) => Boolean(
  answer && !answer.needsHuman && answer.reply && !/\?\s*$/.test(answer.reply) && isMemorableQuestion(question),
);

/** Store an AI answer; resolves its memory id (so the visitor can rate it) or null. */
export const rememberAnswer = async ({ memory, companyId, question, answer, facts }) => {
  if (!memory || !worthRemembering({ question, answer })) return null;
  const result = await call(memory, 'fn_chat_memory_store', {
    p_company_id: companyId, p_question: question, p_key: questionKey(question), p_reply: answer.reply,
    p_actions: answer.actions || [], p_suggestions: answer.suggestions || [], p_facts_hash: factsHash(facts),
  });
  return typeof result?.data === 'string' ? result.data : null;
};

/** A visitor's thumbs up / down on a remembered answer. Always resolves; bad input is ignored. */
export const rateAnswer = async ({ memory, companyId, memoryId, helpful }) => {
  if (!memory || !UUID_RE.test(String(companyId)) || !UUID_RE.test(String(memoryId)) || typeof helpful !== 'boolean') return false;
  return Boolean(await call(memory, 'fn_chat_memory_feedback', { p_company_id: companyId, p_id: memoryId, p_helpful: helpful }));
};
