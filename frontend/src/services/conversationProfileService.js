// "Read my conversation": sends text the person chose to share to the AI reader (through
// POST /api/ai-analysis, task "profile-from-conversation"). The result is turned into
// reviewable changes by utils/conversationReview.js; nothing here writes to the database.

import { supabase } from '../lib/supabase/client';
import { getBackendUrl } from '../lib/backendUrl';

// ------------------------------------------------------------------ the call

export async function readConversation({ target, text, subject = '' }) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Please sign in again.');

  let response;
  try {
    response = await fetch(`${getBackendUrl()}/api/ai-analysis`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ task: 'profile-from-conversation', target, text, subject }),
    });
  } catch {
    throw new Error('Could not reach the server. Check your connection and try again.');
  }
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.result) {
    throw new Error(body?.error || 'Something went wrong while reading your text. Please try again.');
  }
  return body.result;
}
