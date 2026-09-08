/**
 * Vercel Serverless Function — all R2 storage operations, dispatched by path.
 * Routes: POST /api/storage/presign-upload
 *         POST /api/storage/presign-upload-chat
 *         POST /api/storage/presign-upload-public
 *         POST /api/storage/presign-get-batch
 *         POST /api/storage/presign-download
 *         DELETE /api/storage/object
 * Consolidated from six separate files into one dynamic-segment function to
 * stay under the Hobby plan's 12-Serverless-Functions-per-deployment limit —
 * frontend/api had 13 function files, which made every production deploy
 * fail at the "Deploying outputs" step. Each case below is the original
 * file's handler body, unchanged, just no longer its own function.
 *
 * Named [action].js, not the Next.js-style catch-all [...action].js: Vercel
 * Functions (outside Next.js) treat "..." as a literal part of the query
 * key rather than stripping it, so req.query would come back keyed
 * "...action" instead of "action". Every route here is one path segment
 * anyway, so the plain dynamic segment (same convention as the sibling
 * tax-rules/[countryCode].js) is both correct and simpler.
 */
import { verifySupabaseUser } from '../_lib/verifyUser.js';
import { buildKey, getUploadUrl, getDownloadUrl, deleteObject } from '../_lib/r2Client.js';
import { applyCors } from '../_lib/cors.js';
import crypto from 'crypto';

const ALLOWED_FOLDERS = ['pitches', 'statuses', 'avatars', 'cmms-reports', 'cmms-announcements', 'voice-notes', 'portfolio-chat', 'cmms-employment-documents', 'cmms-opportunities'];

const PORTFOLIO_CHAT_GUEST_FOLDER = 'portfolio-chat-guest';
const CHAT_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const CHAT_WINDOW_MS = 10 * 60 * 1000;
const CHAT_MAX_PER_WINDOW = 12;
const chatHits = new Map(); // ip -> [timestamps]

const PUBLIC_UPLOAD_FOLDER = 'cmms-job-applications';
const PUBLIC_UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_UPLOAD_MAX_PER_WINDOW = 12;
const publicUploadHits = new Map(); // ip -> [timestamps]

const isRateLimited = (hits, ip, windowMs, maxPerWindow) => {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  if (recent.length >= maxPerWindow) return true;
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) {
    for (const [key, timestamps] of hits) {
      if (timestamps.every((t) => now - t >= windowMs)) hits.delete(key);
    }
  }
  return false;
};

const getIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';

// Route: POST /api/storage/presign-upload
// Mirrors backend/routes/storageRoutes.js for local dev.
async function presignUpload(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid authorization token.' });
  }

  const user = await verifySupabaseUser(authHeader.replace('Bearer ', '').trim());
  if (!user) {
    return res.status(401).json({ success: false, error: 'Missing or invalid authorization token.' });
  }

  const { folder, filename, contentType } = req.body || {};
  if (!ALLOWED_FOLDERS.includes(folder)) {
    return res.status(400).json({ success: false, error: `folder must be one of: ${ALLOWED_FOLDERS.join(', ')}` });
  }
  if (!filename) {
    return res.status(400).json({ success: false, error: 'filename is required' });
  }

  try {
    const key = buildKey(folder, user.id, filename);
    const uploadUrl = await getUploadUrl({ key, contentType });
    return res.json({ success: true, key, uploadUrl });
  } catch (error) {
    console.error('Error creating presigned upload URL:', error);
    return res.status(500).json({ success: false, error: 'Failed to create upload URL' });
  }
}

// Route: POST /api/storage/presign-upload-chat
// Used by an anonymous visitor sending a file/image in the direct-message
// chat on a public /portfolio/<handle> page (see
// backend/db/CREATE_PORTFOLIO_DIRECT_MESSAGES.sql) — they have no ICAN
// account, so no Bearer token. Same soft-target reasoning as
// presign-upload-public's job-application resume upload: a separate fixed
// folder (never in ALLOWED_FOLDERS, so it can't be touched by the
// owner-only DELETE route), a narrow content-type allowlist, and a per-IP
// rate limit.
async function presignUploadChat(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const ip = getIp(req);
  if (isRateLimited(chatHits, ip, CHAT_WINDOW_MS, CHAT_MAX_PER_WINDOW)) {
    return res.status(429).json({ success: false, error: 'Too many uploads from this device. Please try again later.' });
  }

  const { filename, contentType } = req.body || {};
  if (!filename) {
    return res.status(400).json({ success: false, error: 'filename is required' });
  }
  if (!CHAT_ALLOWED_TYPES.includes(contentType)) {
    return res.status(400).json({ success: false, error: `contentType must be one of: ${CHAT_ALLOWED_TYPES.join(', ')}` });
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

// Route: POST /api/storage/presign-upload-public
// A job applicant never has an ICAN account, so their resume upload can't
// carry a Bearer token like every other upload here. That makes this the
// one presign route that's fully anonymous, so it's locked down harder
// than presignUpload: one fixed folder, PDF only, and a per-IP rate limit.
async function presignUploadPublic(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const ip = getIp(req);
  if (isRateLimited(publicUploadHits, ip, PUBLIC_UPLOAD_WINDOW_MS, PUBLIC_UPLOAD_MAX_PER_WINDOW)) {
    return res.status(429).json({ success: false, error: 'Too many uploads from this device. Please try again later.' });
  }

  const { filename, contentType } = req.body || {};
  if (!filename) {
    return res.status(400).json({ success: false, error: 'filename is required' });
  }
  if (contentType !== 'application/pdf') {
    return res.status(400).json({ success: false, error: 'Only PDF files are accepted for this upload.' });
  }

  try {
    const anonymousId = crypto.randomUUID();
    const key = buildKey(PUBLIC_UPLOAD_FOLDER, anonymousId, filename);
    const uploadUrl = await getUploadUrl({ key, contentType });
    return res.json({ success: true, key, uploadUrl });
  } catch (error) {
    console.error('Error creating public presigned upload URL:', error);
    return res.status(500).json({ success: false, error: 'Failed to create upload URL' });
  }
}

// Route: POST /api/storage/presign-get-batch
// No auth required — mirrors the app's existing effectively-public
// pitch/status visibility. Keys are unguessable, backend-generated paths.
async function presignGetBatch(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { keys } = req.body || {};
  if (!Array.isArray(keys) || keys.length === 0) {
    return res.status(400).json({ success: false, error: 'keys must be a non-empty array' });
  }
  if (keys.length > 100) {
    return res.status(400).json({ success: false, error: 'Too many keys (max 100 per request)' });
  }

  try {
    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    const urls = {};
    // Promise.all would let one key's signing error reject the whole
    // batch, leaving every other (otherwise fine) key unresolved too --
    // allSettled keeps one bad/slow key from blanking the rest.
    const results = await Promise.allSettled(
      uniqueKeys.map((key) => getDownloadUrl({ key }))
    );
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') {
        urls[uniqueKeys[i]] = result.value;
      } else {
        console.error(`Error signing download URL for key ${uniqueKeys[i]}:`, result.reason);
      }
    });

    return res.json({ success: true, urls });
  } catch (error) {
    console.error('Error creating presigned download URLs:', error);
    return res.status(500).json({ success: false, error: 'Failed to resolve media URLs' });
  }
}

// Route: POST /api/storage/presign-download
// Presigned R2 GET URL that forces a "Save As" download rather than the
// browser rendering the file inline. No auth required — same reasoning as
// presignGetBatch (keys are unguessable, backend-generated paths; this
// app's media is already effectively public by link). Kept as its own
// action rather than adding a filename option to presign-get-batch, since
// that one is the shared preview-resolution path used everywhere else in
// the app (images, avatars, statuses, ...) and those must keep resolving
// to a plain inline-viewable URL.
async function presignDownload(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { key, filename } = req.body || {};
  if (!key) {
    return res.status(400).json({ success: false, error: 'key is required' });
  }

  try {
    const url = await getDownloadUrl({ key, filename: filename || 'download' });
    return res.json({ success: true, url });
  } catch (error) {
    console.error('Error creating presigned download URL:', error);
    return res.status(500).json({ success: false, error: 'Failed to create download URL' });
  }
}

// Route: DELETE /api/storage/object
// Keys are namespaced folder/{userId}/... — only the owning user may delete.
async function objectHandler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Missing or invalid authorization token.' });
  }

  const user = await verifySupabaseUser(authHeader.replace('Bearer ', '').trim());
  if (!user) {
    return res.status(401).json({ success: false, error: 'Missing or invalid authorization token.' });
  }

  const { key } = req.body || {};
  if (!key) {
    return res.status(400).json({ success: false, error: 'key is required' });
  }

  const [folder, ownerId] = key.split('/');
  if (!ALLOWED_FOLDERS.includes(folder) || ownerId !== user.id) {
    return res.status(403).json({ success: false, error: 'You do not own this object' });
  }

  try {
    await deleteObject({ key });
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting object:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete object' });
  }
}

const ACTIONS = {
  'presign-upload': presignUpload,
  'presign-upload-chat': presignUploadChat,
  'presign-upload-public': presignUploadPublic,
  'presign-get-batch': presignGetBatch,
  'presign-download': presignDownload,
  'object': objectHandler,
};

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const fn = ACTIONS[req.query.action];
  if (!fn) {
    return res.status(404).json({ success: false, error: 'Not found' });
  }
  return fn(req, res);
}
