/**
 * Vercel Serverless Function — presigned R2 upload URL, no auth required
 * Route: POST /api/storage/presign-upload-public
 * Mirrors backend/routes/storageRoutes.js's /presign-upload-public for
 * local dev.
 *
 * A job applicant never has an ICAN account, so their resume upload can't
 * carry a Bearer token like every other upload in api/storage/*. That makes
 * this the one presign route that's fully anonymous, so it's locked down
 * harder than presign-upload.js: one fixed folder, PDF only, and a small
 * per-IP rate limit. The rate limit is in-memory and only best-effort in a
 * serverless environment (each cold container starts empty) -- it still
 * catches bursts within a warm container, which is the realistic abuse
 * pattern here (a script hammering this endpoint), not a perfect global cap.
 */
import { buildKey, getUploadUrl } from '../_lib/r2Client.js';
import { applyCors } from '../_lib/cors.js';
import crypto from 'crypto';

const PUBLIC_UPLOAD_FOLDER = 'cmms-job-applications';
const PUBLIC_UPLOAD_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_UPLOAD_MAX_PER_WINDOW = 12;
const publicUploadHits = new Map(); // ip -> [timestamps]

const isRateLimited = (ip) => {
  const now = Date.now();
  const hits = (publicUploadHits.get(ip) || []).filter((t) => now - t < PUBLIC_UPLOAD_WINDOW_MS);
  if (hits.length >= PUBLIC_UPLOAD_MAX_PER_WINDOW) return true;
  hits.push(now);
  publicUploadHits.set(ip, hits);
  if (publicUploadHits.size > 5000) {
    for (const [key, timestamps] of publicUploadHits) {
      if (timestamps.every((t) => now - t >= PUBLIC_UPLOAD_WINDOW_MS)) publicUploadHits.delete(key);
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
