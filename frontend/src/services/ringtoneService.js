/**
 * Custom call ringtone storage — lets a user pick any audio file from their
 * own device (input type="file") as their incoming/outgoing call ringtone
 * instead of the built-in synthesized tone. Persisted as a Blob in
 * IndexedDB (not localStorage — audio files are too big for that) so it
 * survives reloads; scoped to this browser only, same as guest identity.
 */
const DB_NAME = 'ican_ringtone_store';
const STORE_NAME = 'ringtones';
const RECORD_KEY = 'custom_ringtone';

let cachedObjectUrl = null;

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE_NAME);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const runTransaction = async (mode, fn) => {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const result = fn(store);
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
};

// Picking a new file (or clearing one) invalidates whatever blob: URL was
// handed out before — revoke it so the old audio data isn't pinned in memory.
const releaseCachedUrl = () => {
  if (cachedObjectUrl) {
    URL.revokeObjectURL(cachedObjectUrl);
    cachedObjectUrl = null;
  }
};

/** Store `file` as the user's custom ringtone. Returns { name, url }. */
export const setCustomRingtone = async (file) => {
  if (!file) return null;
  await runTransaction('readwrite', (store) => store.put({ blob: file, name: file.name }, RECORD_KEY));
  releaseCachedUrl();
  cachedObjectUrl = URL.createObjectURL(file);
  return { name: file.name, url: cachedObjectUrl };
};

/** Read back the stored custom ringtone, if any. Returns { name, url } | null. */
export const getCustomRingtone = async () => {
  try {
    const record = await runTransaction('readonly', (store) => {
      const req = store.get(RECORD_KEY);
      return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    });
    if (!record?.blob) return null;
    if (!cachedObjectUrl) cachedObjectUrl = URL.createObjectURL(record.blob);
    return { name: record.name || 'Custom ringtone', url: cachedObjectUrl };
  } catch (err) {
    console.warn('[ringtoneService] failed to read custom ringtone:', err);
    return null;
  }
};

export const clearCustomRingtone = async () => {
  await runTransaction('readwrite', (store) => store.delete(RECORD_KEY));
  releaseCachedUrl();
};
