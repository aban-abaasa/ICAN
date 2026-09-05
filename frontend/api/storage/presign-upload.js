/**
 * Vercel Serverless Function — presigned R2 upload URL
 * Route: POST /api/storage/presign-upload
 * Mirrors backend/routes/storageRoutes.js for local dev.
 */
import { verifySupabaseUser } from '../_lib/verifyUser.js';
import { buildKey, getUploadUrl } from '../_lib/r2Client.js';
import { applyCors } from '../_lib/cors.js';

const ALLOWED_FOLDERS = ['pitches', 'statuses', 'avatars', 'cmms-reports', 'cmms-announcements', 'voice-notes', 'portfolio-chat'];

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
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
