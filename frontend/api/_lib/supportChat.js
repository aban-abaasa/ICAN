/**
 * The AI that answers first in the Support chat inside the IcanEra app (the "IcanEra Support" tab of the floating chat).
 *
 * That chat is a real thread between a customer and the team (tables chat_conversations / chat_messages; the team replies from the
 * Support Console). This adds an assistant to the same thread: after a customer sends a message the app asks this module to answer,
 * and the answer is written into the thread as a normal team-side message ("dev" role) from "IcanEra Assistant", so it reaches the
 * customer through the same realtime channel as any team reply and the team reads it in the same inbox. The customer's message has
 * already marked the thread unread for the team, and an AI reply leaves it that way: the AI answers first, a person still sees every
 * thread.
 *
 * It knows what the GODMINDERA website assistant knows (familyKnowledge.js: IcanEra, SupermartKera, BodaGoEra, AgriBone) and follows
 * the same safety rules (no PIN/password/code, no account access, no investment advice, account problems go to the team). It stays out
 * of the way of people: it never answers while a team member has written in the last 15 minutes, never answers its own message or a
 * thread that is already answered, ignores "thanks"/"ok", and is capped per thread per hour. Without an AI key it answers from the
 * knowledge alone.
 *
 * Everything runs with the public anon key, like the rest of the chat: the tables' policies let the app (and so this) read and write
 * messages, so this endpoint can do nothing a browser could not.
 */
import { callAI } from './aiProvider.js';
import { MAX_TURN_CHARS, MAX_TURNS, loadPlatformLive, parseModelJson, restSelect, sanitizeAiOutput } from './businessChat.js';
import { buildPlatformPrompt, platformFallback, sanitizePlatformOutput, selectTopics } from './familySupport.js';

/** The name on the assistant's messages. The app (src/constants/supportAssistant.js) labels messages with this name "AI"; keep them equal. */
export const SUPPORT_ASSISTANT_NAME = 'IcanEra Assistant';
/** Only the IcanEra app's own support threads. The other apps keep their own inboxes in the same tables. */
export const SUPPORT_ORIGIN_APP = 'ican';
const SUPPORT_KIND = 'support';
/** The app the chat is inside of: assumed unless the customer names another. */
const FOCUS_APP = 'icanera';

/** After a team member writes, the assistant keeps quiet this long (the person has the conversation). */
export const HUMAN_ACTIVE_MS = 15 * 60 * 1000;
/** Replies the assistant may send into one thread per hour. */
export const MAX_AI_REPLIES_PER_HOUR = 12;
const HISTORY_ROWS = 30;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VOICE_NOTE_PREFIX = 'voice-note::';
const clip = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export const parseSupportRequest = (body) => {
  const id = typeof body?.supportConversationId === 'string' ? body.supportConversationId.trim() : '';
  return UUID_RE.test(id) ? { conversationId: id.toLowerCase() } : { error: 'A valid supportConversationId is required' };
};

// ---------------------------------------------------------------------------------------------
// Should the assistant answer?
// ---------------------------------------------------------------------------------------------

const isVoiceNote = (text) => typeof text === 'string' && text.startsWith(VOICE_NOTE_PREFIX);
const isTeamSide = (row) => row.sender_role === 'dev'; // same rule as the app and the database trigger: "dev" is the team, anything else is the customer
const isAssistant = (row) => isTeamSide(row) && row.sender_name === SUPPORT_ASSISTANT_NAME;
const isHuman = (row) => isTeamSide(row) && row.sender_name !== SUPPORT_ASSISTANT_NAME;
const time = (row) => Date.parse(row.created_at) || 0;

const ACK_WORDS = new Set('ok okay k thanks thank thx ty you cool great nice alright noted got it much so a lot very good fine perfect'.split(' '));
/** "thanks", "ok", "thank you so much", a lone emoji: nothing to answer. */
export const isAcknowledgement = (text) => {
  const letters = String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (letters.length === 0) return true;
  return letters.length <= 5 && letters.every((word) => ACK_WORDS.has(word));
};

/**
 * What to do about a thread. `rows` are the thread's messages, oldest first.
 *   { reply: false, reason }          do nothing (and why: for tests and logs)
 *   { reply: true, kind: 'answer' }   answer the customer's last message
 *   { reply: true, kind: 'unreadable' }  the last message is a voice note or a photo with no words: say so and leave it to the team
 */
export const decideReply = ({ conversation, rows, now = Date.now() }) => {
  if (!conversation) return { reply: false, reason: 'not-found' };
  if (conversation.origin_app !== SUPPORT_ORIGIN_APP || conversation.kind !== SUPPORT_KIND) return { reply: false, reason: 'not-an-ican-support-thread' };
  const last = rows[rows.length - 1];
  if (!last) return { reply: false, reason: 'empty' };
  if (isTeamSide(last)) return { reply: false, reason: 'already-answered' };

  const lastHuman = [...rows].reverse().find(isHuman);
  if (lastHuman && now - time(lastHuman) < HUMAN_ACTIVE_MS) return { reply: false, reason: 'team-active' };
  const recentAi = rows.filter((r) => isAssistant(r) && now - time(r) < 60 * 60 * 1000).length;
  if (recentAi >= MAX_AI_REPLIES_PER_HOUR) return { reply: false, reason: 'hourly-limit' };

  const text = String(last.body ?? '').trim();
  if (isVoiceNote(text) || (!text && last.attachment_url)) return { reply: true, kind: 'unreadable' };
  if (!text) return { reply: false, reason: 'empty' };
  if (isAcknowledgement(text)) return { reply: false, reason: 'acknowledgement' };
  return { reply: true, kind: 'answer' };
};

// ---------------------------------------------------------------------------------------------
// The conversation, as the model sees it
// ---------------------------------------------------------------------------------------------

/** [{ role: 'user' | 'assistant', text }], the last turn the customer's. The team's own messages are marked so the model does not take them for its own. */
export const toModelTurns = (rows) => {
  const turns = rows.map((row) => {
    let text = String(row.body ?? '').trim();
    if (isVoiceNote(text)) text = '[voice note]';
    if (row.attachment_url) text = text ? `${text} [photo attached]` : '[photo attached]';
    if (isHuman(row)) text = `(team member) ${text}`;
    else if (!isTeamSide(row)) text = text.replace(/^\(team member\)\s*/i, ''); // a customer cannot pass as the team
    return { role: isTeamSide(row) ? 'assistant' : 'user', text: clip(text, MAX_TURN_CHARS) };
  }).filter((t) => t.text);
  const recent = turns.slice(-MAX_TURNS);
  while (recent.length && recent[0].role === 'assistant') recent.shift();
  return recent;
};

/** The chat message to write: the answer, then up to two vetted links as "Label: address" (the app turns addresses into links). */
export const composeMessage = ({ reply, links = [] }) => {
  const lines = [clip(reply, 900)];
  if (links.length) lines.push('', ...links.map((l) => `${l.label}: ${l.url}`));
  return lines.join('\n');
};

const PASSED_ON = /\b(team|person|someone|human)\b/i;
const UNREADABLE_REPLY = "I can't play voice notes or open photos, so I've passed this to the team. They'll reply to you here. If you type what you need, I can answer straight away.";

// ---------------------------------------------------------------------------------------------
// Answer
// ---------------------------------------------------------------------------------------------

const askModel = async (turns, live) => {
  const system = buildPlatformPrompt({
    businessFacts: '', topics: selectTopics({ messages: turns, focusApp: FOCUS_APP }), live, focusApp: FOCUS_APP, surface: 'app',
  });
  const { content } = await callAI({
    messages: [{ role: 'system', content: system }, ...turns.map((t) => ({ role: t.role, content: t.text }))],
    temperature: 0.3,
    maxTokens: 700,
    jsonMode: true,
  });
  return sanitizePlatformOutput(sanitizeAiOutput(content, []), parseModelJson(content));
};

/** { reply, needsHuman, links: [{ id, label, url }] (vetted), source: 'ai' | 'fallback' } -- the AI's answer, or the knowledge's when there is no AI. */
export const answerFromKnowledge = async (turns, live) => {
  try {
    const ai = await askModel(turns, live);
    if (ai) return { ...ai, source: 'ai' };
  } catch (err) {
    console.warn('support-chat: AI unavailable, answering from the knowledge:', err?.message);
  }
  const fallback = platformFallback({ messages: turns, focusApp: FOCUS_APP, live, businessFacts: '', tabs: [], whenUnsure: 'team' });
  const reply = fallback.needsHuman && !PASSED_ON.test(fallback.reply)
    ? `${fallback.reply} I've passed this to the team. They'll reply to you here.`
    : fallback.reply;
  return { ...fallback, reply, source: 'fallback' };
};

const authHeaders = ({ anonKey }) => ({ apikey: anonKey, Authorization: `Bearer ${anonKey}` });

const insertAssistantMessage = async (supabase, conversationId, body) => {
  try {
    const res = await fetch(`${supabase.url}/rest/v1/chat_messages`, {
      method: 'POST',
      headers: { ...authHeaders(supabase), 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ conversation_id: conversationId, sender_role: 'dev', sender_name: SUPPORT_ASSISTANT_NAME, body }),
    });
    const rows = res.ok ? await res.json() : null;
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch {
    return null;
  }
};

const none = (reason, status = 200) => ({ status, body: { replied: false, reason } });

/**
 * Answers the customer's latest message in an IcanEra support thread, if it needs answering. Safe to call more than once for the
 * same message: only an unanswered customer message gets a reply, so the app can call it after every send and after a queued
 * message syncs. Returns { status, body: { replied, reason? | message, source } }.
 */
export const answerSupportThread = async ({ supabase, conversationId, now = Date.now() }) => {
  const conversations = await restSelect(supabase, `chat_conversations?id=eq.${conversationId}&select=id,origin_app,kind&limit=1`);
  if (conversations === null) return none('unavailable', 503);
  const rowsDesc = await restSelect(supabase, `chat_messages?conversation_id=eq.${conversationId}&select=id,sender_role,sender_name,body,created_at,attachment_url&order=created_at.desc&limit=${HISTORY_ROWS}`);
  if (rowsDesc === null) return none('unavailable', 503);
  const rows = [...rowsDesc].reverse();

  const decision = decideReply({ conversation: conversations[0], rows, now });
  if (!decision.reply) return none(decision.reason, decision.reason === 'not-found' ? 404 : 200);

  let text;
  let source;
  if (decision.kind === 'unreadable') {
    text = UNREADABLE_REPLY;
    source = 'fixed';
  } else {
    const turns = toModelTurns(rows);
    const live = await loadPlatformLive(supabase);
    const answer = await answerFromKnowledge(turns, live);
    text = composeMessage({ reply: answer.reply, links: answer.links });
    source = answer.source;
  }

  // A person, or a parallel call, may have answered while the model was thinking: write only if the customer's message is still the last.
  const last = rows[rows.length - 1];
  const latest = await restSelect(supabase, `chat_messages?conversation_id=eq.${conversationId}&select=id&order=created_at.desc&limit=1`);
  if (!latest || latest[0]?.id !== last.id) return none('changed');

  const message = await insertAssistantMessage(supabase, conversationId, text);
  if (!message) return { status: 502, body: { replied: false, reason: 'could-not-write' } };
  return { status: 200, body: { replied: true, source, message } };
};
