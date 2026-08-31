/**
 * Shared AI provider helper for Vercel serverless functions (api/ai-analysis.js,
 * api/tax-rules/[countryCode].js).
 *
 * Mirrors backend/services/aiProviderService.js (the Express-server copy of
 * this same logic) but as an ESM module living under api/ where Vercel's
 * Node runtime actually bundles/deploys it from — the two are NOT the same
 * running process. Keep them in sync if the provider logic changes; they
 * can't share a single file across the frontend/backend/api workspace
 * split without a monorepo-wide build step this project doesn't have.
 *
 * When both OPENAI_API_KEY and GEMINI_API_KEY are configured, callAI()
 * races both and returns whichever responds first. With only one key set,
 * that provider is used directly. Throws if neither is set.
 */

const OPENAI_MODEL = 'gpt-4o-mini';
// gemini-2.0-flash was shut down June 2026 — do not use. 2.5-flash is the
// current stable choice as of this writing; revisit as models evolve.
const GEMINI_MODEL = 'gemini-2.5-flash';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

async function callOpenAI({ messages, temperature = 0.5, maxTokens = 900, jsonMode = false }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not configured');

  const payload = {
    model: OPENAI_MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(jsonMode ? { response_format: { type: 'json_object' } } : {})
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI error: ${data?.error?.message || res.statusText}`);

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI returned an empty response');
  return { provider: 'openai', content };
}

function toGeminiRequest(messages = []) {
  const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
  if (turns.length === 0) turns.push({ role: 'user', parts: [{ text: '' }] });
  return { systemText, turns };
}

async function callGemini({ messages, temperature = 0.5, maxTokens = 900, jsonMode = false }) {
  const apiKey = GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const { systemText, turns } = toGeminiRequest(messages);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const payload = {
    contents: turns,
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(jsonMode ? { responseMimeType: 'application/json' } : {})
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini error: ${data?.error?.message || res.statusText}`);

  const content = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
  if (!content) throw new Error('Gemini returned an empty response');
  return { provider: 'gemini', content };
}

/**
 * @param {{role: string, content: string}[]} messages - OpenAI-shaped message turns
 * @returns {Promise<{provider: 'openai'|'gemini', content: string}>}
 */
export async function callAI({ messages, temperature, maxTokens, jsonMode }) {
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  const hasGemini = Boolean(GEMINI_API_KEY);

  const attempts = [];
  if (hasOpenAI) attempts.push(callOpenAI({ messages, temperature, maxTokens, jsonMode }));
  if (hasGemini) attempts.push(callGemini({ messages, temperature, maxTokens, jsonMode }));

  if (attempts.length === 0) {
    throw new Error('No AI provider configured — set OPENAI_API_KEY and/or GEMINI_API_KEY');
  }
  if (attempts.length === 1) return attempts[0];

  try {
    return await Promise.any(attempts);
  } catch (aggregateError) {
    throw (aggregateError?.errors && aggregateError.errors[0]) || aggregateError;
  }
}
