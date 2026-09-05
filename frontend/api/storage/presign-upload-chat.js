/**
 * Vercel Serverless Function — presigned R2 upload URL for an anonymous
 * guest's chat attachment
 * Route: POST /api/storage/presign-upload-chat
 * Mirrors backend/routes/storageRoutes.js's /presign-upload-chat for local dev.
 *
 * Used by an anonymous visitor sending a file/image in the direct-message
 * chat on a public /portfolio/<handle> page (see
 * backend/db/CREATE_PORTFOLIO_DIRECT_MESSAGES.sql) — they have no ICAN
 * account, so no Bearer token. Same soft-target reasoning as
 * presign-upload-public.js's job-application resume upload: a separate
 * fixed folder (never in ALLOWED_FOLDERS, so it can't be touched by the
 * owner-only DELETE route), a narrow content-type allowlist, and the same
 * per-IP rate limit pattern (in-memory, best-effort per warm container).
 */
import { buildKey, getUploadUrl } from '../_lib/r2Client.js';
import { applyCors } from '../_lib/cors.js';
import crypto from 'crypto';

const PORTFOLIO_CHAT_GUEST_FOLDER = 'portfolio-chat-guest';
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 12;
const hits = new Map(); // ip -> [timestamps]

const isRateLimited = (ip) => {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, timestamps] of hits) {
      if (timestamps.every((t) => now - t >= WINDOW_MS)) hits.delete(key);
    }
  }
  return false;
};

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ success: false, error: 'Too many uploads from this device. Please try again later.' });
  }

  const { filename, contentType } = req.body || {};
  if (!filename) {
    return res.status(400).json({ success: false, error: 'filename is required' });
  }
  if (!ALLOWED_TYPES.includes(contentType)) {
    return res.status(400).json({ success: false, error: `contentType must be one of: ${ALLOWED_TYPES.join(', ')}` });
  }

  try {
    const anonymousId = crypto.randomUUID();
    const key = buildKey(PORTFOLIO_CHAT_GUEST_FOLDER, anonymousId, filename);
    const uploadUrl = await getUploadUrl({ key, contentType });
    return res.json({ success: true, key, uploadUrl });
  } catch (error) {
    console.error('Error creating chat presigned upload URL:', error);
    return res.status(500).json({ success: false, error: 'Failed to create upload URL' });
  }
}
