/**
 * Client for the backend's Cloudflare R2 storage endpoints
 * (ICAN/backend/routes/storageRoutes.js). The R2 bucket is private —
 * uploads go through a presigned PUT URL, and reads through a presigned
 * GET URL, both minted server-side. Values stored in the DB use the
 * `r2://<key>` marker so read paths know to resolve a fresh URL instead
 * of using the value directly (unlike legacy Supabase URLs, which start
 * with `https://` and are used as-is).
 */

import { getBackendUrl } from '../lib/backendUrl';

const R2_PREFIX = 'r2://';

export const isR2Key = (value) => typeof value === 'string' && value.startsWith(R2_PREFIX);
export const toR2Value = (key) => `${R2_PREFIX}${key}`;
export const fromR2Value = (value) => value.slice(R2_PREFIX.length);

/**
 * Upload a file to R2 via a presigned URL.
 * @param {Object} params
 * @param {File|Blob} params.file
 * @param {'pitches'|'statuses'|'avatars'|'cmms-reports'} params.folder
 * @param {string} params.accessToken - current Supabase session access token
 * @returns {Promise<{success: boolean, url?: string, key?: string, error?: string}>}
 */
export const uploadToR2 = async ({ file, folder, accessToken }) => {
  try {
    if (!accessToken) {
      return { success: false, error: 'Not authenticated — cannot upload' };
    }

    const filename = file.name || `${folder}-${Date.now()}`;
    const contentType = file.type || 'application/octet-stream';
    const backendUrl = getBackendUrl();

    const presignRes = await fetch(`${backendUrl}/api/storage/presign-upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ folder, filename, contentType }),
    });

    const presignData = await presignRes.json();
    if (!presignRes.ok || !presignData?.success) {
      return { success: false, error: presignData?.error || 'Failed to get upload URL' };
    }

    const { key, uploadUrl } = presignData;

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: file,
    });

    if (!putRes.ok) {
      return { success: false, error: `Upload failed (${putRes.status})` };
    }

    return { success: true, key, url: toR2Value(key) };
  } catch (error) {
    console.error('R2 upload error:', error);
    return { success: false, error: error.message || 'Unexpected upload error' };
  }
};

/**
 * Resolve r2:// values across a batch of rows to live presigned URLs.
 * Values that aren't r2:// (legacy Supabase URLs, null, etc.) pass through unchanged.
 * @param {Array<Object>} rows
 * @param {string[]} fields - field names on each row to resolve, e.g. ['video_url', 'thumbnail_url']
 * @returns {Promise<Array<Object>>} new array of rows with resolved fields
 */
export const resolveMediaValues = async (rows, fields) => {
  if (!Array.isArray(rows) || rows.length === 0) return rows || [];

  const keys = new Set();
  for (const row of rows) {
    for (const field of fields) {
      if (isR2Key(row?.[field])) keys.add(fromR2Value(row[field]));
    }
  }

  if (keys.size === 0) return rows;

  // This batch call runs on first paint alongside a burst of other
  // startup requests (auth, dashboard, wallet, feed), so a single
  // transient failure/timeout here is common -- without a retry, an
  // r2:// key that loses that race is stuck unresolved (raw "r2://..."
  // as an <img>/<video> src, which can't load) until something later
  // re-fetches the same rows, e.g. opening the full Updates page.
  let urls = {};
  const backendUrl = getBackendUrl();
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(`${backendUrl}/api/storage/presign-get-batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: [...keys] }),
      });
      const data = await res.json();
      if (res.ok && data?.success) {
        urls = data.urls || {};
        break;
      }
      console.warn(`Could not resolve R2 media URLs (attempt ${attempt}/${attempts}):`, data?.error);
    } catch (error) {
      console.warn(`Could not resolve R2 media URLs (attempt ${attempt}/${attempts}):`, error.message);
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 500));
  }

  return rows.map((row) => {
    const updated = { ...row };
    for (const field of fields) {
      if (isR2Key(row?.[field])) {
        const key = fromR2Value(row[field]);
        if (urls[key]) updated[field] = urls[key];
      }
    }
    return updated;
  });
};

/** Convenience wrapper for a single value instead of a batch of rows. */
export const resolveMediaValue = async (value) => {
  if (!isR2Key(value)) return value;
  const [resolved] = await resolveMediaValues([{ _v: value }], ['_v']);
  return resolved._v;
};

/**
 * Delete an object from R2. Only the owning user (embedded in the key as
 * folder/{userId}/...) can delete it — enforced server-side.
 * @param {Object} params
 * @param {string} params.key
 * @param {string} params.accessToken
 */
export const deleteFromR2 = async ({ key, accessToken }) => {
  try {
    if (!accessToken) {
      return { success: false, error: 'Not authenticated — cannot delete' };
    }
    const backendUrl = getBackendUrl();
    const res = await fetch(`${backendUrl}/api/storage/object`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ key }),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
      return { success: false, error: data?.error || 'Failed to delete object' };
    }
    return { success: true };
  } catch (error) {
    console.error('R2 delete error:', error);
    return { success: false, error: error.message || 'Unexpected delete error' };
  }
};

export default {
  isR2Key,
  toR2Value,
  fromR2Value,
  uploadToR2,
  resolveMediaValues,
  resolveMediaValue,
  deleteFromR2,
};
