/**
 * Era API gateway entry: GET /api/v1/<anything>.
 * All behaviour lives in ../_lib/eraApi.js (unit tested); see that file's header for the routes.
 *
 * It also serves the /api/v1/debug/keys decoy (see decoyHandler in ../_lib/canweShield.js). That route
 * used to be its own file, api/v1/debug/keys.js, but every file under api/ is a separate serverless
 * function and Vercel's Hobby plan allows 12 per deployment -- one more and the whole deploy fails.
 * Sharing this function keeps the decoy at the same URL without spending one.
 */
import { createEraHandler } from '../_lib/eraApi.js';
import { decoyHandler } from '../_lib/canweShield.js';

const era = createEraHandler();

const isDecoyRoute = (req) => /^\/api\/v1\/debug\/keys\/?(\?|$)/.test(req.url || '');

export default function handler(req, res) {
  return isDecoyRoute(req) ? decoyHandler(req, res) : era(req, res);
}
