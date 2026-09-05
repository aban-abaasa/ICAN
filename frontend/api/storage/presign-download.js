/**
 * Vercel Serverless Function — presigned R2 GET URL that forces a "Save As"
 * download rather than the browser rendering the file inline.
 * Route: POST /api/storage/presign-download
 * Body: { key, filename }
 * No auth required — same reasoning as presign-get-batch.js (keys are
 * unguessable, backend-generated paths; this app's media is already
 * effectively public by link). Kept separate from presign-get-batch.js
 * rather than adding a filename option there, since that endpoint is the
 * shared preview-resolution path used everywhere else in the app (images,
 * avatars, statuses, ...) and those must keep resolving to a plain
 * inline-viewable URL.
 */
import { getDownloadUrl } from '../_lib/r2Client.js';
import { applyCors } from '../_lib/cors.js';

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
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
