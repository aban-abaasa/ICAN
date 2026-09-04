const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const r2 = require('../services/r2StorageService');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const adminSupabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

const ALLOWED_FOLDERS = ['pitches', 'statuses', 'avatars', 'cmms-reports', 'cmms-announcements', 'voice-notes'];

// Job applicants never have an ICAN account, so their resume upload can't
// carry a Bearer token like every other upload here -- this is the one
// presign route that is fully anonymous. That makes it a soft target for
// storage abuse, so it's locked down harder than the authenticated route:
// one fixed folder, PDF only, and a small in-memory per-IP rate limit
// (no extra dependency -- express-rate-limit isn't installed in this
// backend) instead of relying on a caller-scoped token.
const PUBLIC_UPLOAD_FOLDER = 'cmms-job-applications';
const PUBLIC_UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_UPLOAD_MAX_PER_WINDOW = 12;
const publicUploadHits = new Map(); // ip -> [timestamps]

const publicUploadRateLimit = (req, res, next) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const now = Date.now();
  const hits = (publicUploadHits.get(ip) || []).filter((t) => now - t < PUBLIC_UPLOAD_WINDOW_MS);
  if (hits.length >= PUBLIC_UPLOAD_MAX_PER_WINDOW) {
    return res.status(429).json({ success: false, error: 'Too many uploads from this device. Please try again later.' });
  }
  hits.push(now);
  publicUploadHits.set(ip, hits);
  if (publicUploadHits.size > 5000) {
    // Cheap unbounded-growth guard for a long-running process -- drop
    // entries with no hits in the current window.
    for (const [key, timestamps] of publicUploadHits) {
      if (timestamps.every((t) => now - t >= PUBLIC_UPLOAD_WINDOW_MS)) publicUploadHits.delete(key);
    }
  }
  next();
};

const getAuthenticatedUser = async (req) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ') || !adminSupabase) return null;
  const accessToken = authHeader.replace('Bearer ', '').trim();
  const { data, error } = await adminSupabase.auth.getUser(accessToken);
  if (error || !data?.user) return null;
  return data.user;
};

/**
 * POST /api/storage/presign-upload
 * Body: { folder: 'pitches'|'statuses'|'avatars'|'cmms-reports'|'cmms-announcements'|'voice-notes', filename, contentType }
 */
router.post('/presign-upload', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
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

    const key = r2.buildKey(folder, user.id, filename);
    const uploadUrl = await r2.getUploadUrl({ key, contentType });

    return res.json({ success: true, key, uploadUrl });
  } catch (error) {
    console.error('Error creating presigned upload URL:', error);
    return res.status(500).json({ success: false, error: 'Failed to create upload URL' });
  }
});

/**
 * POST /api/storage/presign-upload-public
 * Body: { filename, contentType }
 * No auth -- used only for a job applicant's resume upload. Folder is
 * fixed (cmms-job-applications), contentType must be application/pdf, and
 * the key uses a random id in place of a user id since there is no
 * authenticated caller to namespace by.
 */
router.post('/presign-upload-public', publicUploadRateLimit, async (req, res) => {
  try {
    const { filename, contentType } = req.body || {};
    if (!filename) {
      return res.status(400).json({ success: false, error: 'filename is required' });
    }
    if (contentType !== 'application/pdf') {
      return res.status(400).json({ success: false, error: 'Only PDF files are accepted for this upload.' });
    }

    const anonymousId = crypto.randomUUID();
    const key = r2.buildKey(PUBLIC_UPLOAD_FOLDER, anonymousId, filename);
    const uploadUrl = await r2.getUploadUrl({ key, contentType });

    return res.json({ success: true, key, uploadUrl });
  } catch (error) {
    console.error('Error creating public presigned upload URL:', error);
    return res.status(500).json({ success: false, error: 'Failed to create upload URL' });
  }
});

/**
 * POST /api/storage/presign-get-batch
 * Body: { keys: string[] }
 * No auth required — mirrors the app's existing effectively-public
 * pitch/status visibility. Keys are unguessable, backend-generated paths.
 */
router.post('/presign-get-batch', async (req, res) => {
  try {
    const { keys } = req.body || {};
    if (!Array.isArray(keys) || keys.length === 0) {
      return res.status(400).json({ success: false, error: 'keys must be a non-empty array' });
    }
    if (keys.length > 100) {
      return res.status(400).json({ success: false, error: 'Too many keys (max 100 per request)' });
    }

    const uniqueKeys = [...new Set(keys.filter(Boolean))];
    const urls = {};
    // Promise.all would let one key's signing error reject the whole
    // batch, leaving every other (otherwise fine) key unresolved too --
    // allSettled keeps one bad/slow key from blanking the rest.
    const results = await Promise.allSettled(
      uniqueKeys.map((key) => r2.getDownloadUrl({ key }))
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
});

/**
 * DELETE /api/storage/object
 * Body: { key }
 * Keys are namespaced folder/{userId}/... — only the owning user may delete.
 */
router.delete('/object', async (req, res) => {
  try {
    const user = await getAuthenticatedUser(req);
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

    await r2.deleteObject({ key });
    return res.json({ success: true });
  } catch (error) {
    console.error('Error deleting object:', error);
    return res.status(500).json({ success: false, error: 'Failed to delete object' });
  }
});

module.exports = router;
