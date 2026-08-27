/**
 * Vercel Serverless Function — batch-resolve R2 keys to presigned GET URLs
 * Route: POST /api/storage/presign-get-batch
 * No auth required — mirrors the app's existing effectively-public
 * pitch/status visibility. Keys are unguessable, backend-generated paths.
 */
import { getDownloadUrl } from '../_lib/r2Client.js';

export default async function handler(req, res) {
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
    await Promise.all(
      uniqueKeys.map(async (key) => {
        urls[key] = await getDownloadUrl({ key });
      })
    );

    return res.json({ success: true, urls });
  } catch (error) {
    console.error('Error creating presigned download URLs:', error);
    return res.status(500).json({ success: false, error: 'Failed to resolve media URLs' });
  }
}
