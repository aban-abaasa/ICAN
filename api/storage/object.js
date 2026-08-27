/**
 * Vercel Serverless Function — delete an R2 object
 * Route: DELETE /api/storage/object
 * Keys are namespaced folder/{userId}/... — only the owning user may delete.
 */
import { verifySupabaseUser } from '../_lib/verifyUser.js';
import { deleteObject } from '../_lib/r2Client.js';

const ALLOWED_FOLDERS = ['pitches', 'statuses', 'avatars'];

export default async function handler(req, res) {
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
