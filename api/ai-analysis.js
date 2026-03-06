/**
 * Vercel Serverless Function — OpenAI proxy for accounting AI analysis
 *
 * Keeps the OpenAI API key server-side (OPENAI_API_KEY env var in Vercel dashboard).
 * The browser never sees the key and CORS is never an issue.
 *
 * Route: POST /api/ai-analysis
 */

export default async function handler(req, res) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // No key configured → tell client to use fallback
    return res.status(503).json({ error: 'AI service not configured' });
  }

  try {
    const upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(req.body)
    });

    const data = await upstream.json();
    return res.status(upstream.status).json(data);
  } catch (err) {
    console.error('AI proxy error:', err);
    return res.status(502).json({ error: 'AI proxy failed', detail: err.message });
  }
}
