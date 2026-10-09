/**
 * Vercel Serverless Function -- translates interface text into the user's language so every screen
 * of the app follows the language chosen at sign-up / in Settings (client: src/i18n/pageTranslator.js).
 *
 * No login required: sign-in and sign-up must be translatable too. Cost is bounded by the per-request
 * caps and per-IP rate limit in api/_lib/translateUi.js, and results are cached.
 *
 * Route: POST /api/translate
 * Body:  { language: 'sw' | 'lg' | 'rw' | 'fr' | 'es' | 'pt' | 'de' | 'ar' | 'hi' | 'zh', texts: string[] }
 * Reply: { translations: string[] }   (same order and length as texts)
 *
 * Env: OPENAI_API_KEY and/or GEMINI_API_KEY (see api/_lib/aiProvider.js). Without one this answers 503
 * and the app simply stays in English for the strings that have no dictionary entry.
 */
import { applyCors } from './_lib/cors.js';
import { parseTranslateRequest, rateLimited, translateTexts } from './_lib/translateUi.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = null; } }
  const parsed = parseTranslateRequest(body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many translation requests. Please wait a moment.' });

  try {
    const translations = await translateTexts(parsed);
    return res.status(200).json({ translations });
  } catch (err) {
    console.error('translate failed:', err);
    const notConfigured = /No AI provider configured|API_KEY not configured/i.test(String(err?.message));
    return res.status(notConfigured ? 503 : 502).json({ error: 'Translation is temporarily unavailable' });
  }
}
