/**
 * AI Provider Service
 *
 * Thin abstraction over OpenAI and Gemini so callers (aiAnalysisRoutes.js,
 * taxRulesRoutes.js) don't hardcode a single provider. When both
 * OPENAI_API_KEY and GEMINI_API_KEY are configured, callAI() races both and
 * returns whichever responds first — "use both for faster" per product
 * decision, rather than picking one as primary/fallback. When only one key
 * is configured, that provider is used directly. Throws if neither is set.
 *
 * Callers always pass/receive OpenAI-shaped `messages` ({role, content}[])
 * and get back plain text content — Gemini's different request/response
 * shape (systemInstruction separate from turns, role "model" instead of
 * "assistant", candidates[0].content.parts[].text instead of
 * choices[0].message.content) is translated here so nothing upstream needs
 * to know which provider actually served a given call.
 */

const OPENAI_MODEL = 'gpt-4-turbo-preview';
// gemini-2.0-flash was shut down June 2026 — do not use. 2.5-flash is the
// current stable choice as of this writing; revisit as models evolve.
const GEMINI_MODEL = 'gemini-2.5-flash';

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

const callOpenAI = async ({ messages, temperature = 0.5, maxTokens = 900, jsonMode = false }) => {
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
};

const toGeminiRequest = (messages = []) => {
  const systemText = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
  // Gemini requires at least one content turn.
  if (turns.length === 0) turns.push({ role: 'user', parts: [{ text: '' }] });
  return { systemText, turns };
};

const callGemini = async ({ messages, temperature = 0.5, maxTokens = 900, jsonMode = false }) => {
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
};

/**
 * @param {{role: string, content: string}[]} messages - OpenAI-shaped message turns
 * @param {number} [temperature]
 * @param {number} [maxTokens]
 * @param {boolean} [jsonMode] - request a strict JSON response from the provider
 * @returns {Promise<{provider: 'openai'|'gemini', content: string}>}
 */
const callAI = async ({ messages, temperature, maxTokens, jsonMode }) => {
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
    // Both providers failed — surface the first underlying error rather than AggregateError.
    throw (aggregateError?.errors && aggregateError.errors[0]) || aggregateError;
  }
};

module.exports = { callAI };
