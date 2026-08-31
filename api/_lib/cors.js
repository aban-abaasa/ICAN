/**
 * Shared CORS handling for api/storage/** functions.
 * In production the frontend and these functions share an origin, so no
 * preflight is ever triggered there. Local dev runs the Vite frontend on a
 * different origin (localhost:300x) against this same deployed backend
 * (see frontend/src/lib/backendUrl.js), which does trigger a CORS
 * preflight -- without these headers the browser blocks the request
 * before it ever reaches the handler below.
 *
 * Wildcard is safe here: every route already authenticates via an
 * explicit Bearer token in the request body/headers, never via cookies,
 * so there's nothing credentialed for a third-party origin to ride on.
 */
export function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
