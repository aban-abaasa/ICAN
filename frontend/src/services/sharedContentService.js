// Shared Content Service - Handles content shared from external apps via Web Share Target API

const DB_NAME = 'IcanEraLocalDB';
const DB_VERSION = 1;

/**
 * Open IndexedDB connection
 */
async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/**
 * Get all unconsumed shared content
 */
export async function getPendingSharedContent() {
  try {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sharedContent', 'readonly');
      const store = tx.objectStore('sharedContent');
      const index = store.index('consumed');
      const request = index.getAll(false); // Get all unconsumed items
      
      request.onsuccess = () => {
        const items = request.result || [];
        // Sort by timestamp, newest first
        items.sort((a, b) => b.timestamp - a.timestamp);
        resolve(items);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[SharedContent] Error getting pending content:', error);
    return [];
  }
}

/**
 * Get files associated with shared content
 */
export async function getSharedFiles(sharedId) {
  try {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sharedFiles', 'readonly');
      const store = tx.objectStore('sharedFiles');
      const index = store.index('sharedId');
      const request = index.getAll(sharedId);
      
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('[SharedContent] Error getting shared files:', error);
    return [];
  }
}

/**
 * Mark shared content as consumed (so it doesn't show up again)
 */
export async function markSharedContentAsConsumed(sharedId) {
  try {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sharedContent', 'readwrite');
      const store = tx.objectStore('sharedContent');
      const getRequest = store.get(sharedId);
      
      getRequest.onsuccess = () => {
        const data = getRequest.result;
        if (data) {
          data.consumed = true;
          data.consumedAt = Date.now();
          
          const putRequest = store.put(data);
          putRequest.onsuccess = () => resolve(true);
          putRequest.onerror = () => reject(putRequest.error);
        } else {
          resolve(false);
        }
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  } catch (error) {
    console.error('[SharedContent] Error marking content as consumed:', error);
    return false;
  }
}

/**
 * Delete shared content and associated files
 */
export async function deleteSharedContent(sharedId) {
  try {
    const db = await openDB();
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['sharedContent', 'sharedFiles'], 'readwrite');
      
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      
      // Delete the content metadata
      const contentStore = tx.objectStore('sharedContent');
      contentStore.delete(sharedId);
      
      // Delete associated files
      const filesStore = tx.objectStore('sharedFiles');
      const index = filesStore.index('sharedId');
      const filesRequest = index.openCursor(IDBKeyRange.only(sharedId));
      
      filesRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    });
  } catch (error) {
    console.error('[SharedContent] Error deleting shared content:', error);
    return false;
  }
}

/**
 * Convert shared files to File objects for upload
 */
export async function convertSharedFilesToFiles(sharedFiles) {
  return sharedFiles.map(fileData => {
    // The blob is already stored, just wrap it in a File object
    return new File([fileData.blob], fileData.name, { type: fileData.type });
  });
}

/**
 * Check if there's pending shared content (used to show notifications)
 */
export async function hasPendingSharedContent() {
  const pending = await getPendingSharedContent();
  return pending.length > 0;
}

/**
 * Get the latest shared content item
 */
export async function getLatestSharedContent() {
  const pending = await getPendingSharedContent();
  return pending.length > 0 ? pending[0] : null;
}

/**
 * Clean up old consumed shared content (older than 7 days)
 */
export async function cleanupOldSharedContent() {
  try {
    const db = await openDB();
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['sharedContent', 'sharedFiles'], 'readwrite');
      
      tx.oncomplete = () => {
        console.log('[SharedContent] Cleanup complete');
        resolve(true);
      };
      tx.onerror = () => reject(tx.error);
      
      const contentStore = tx.objectStore('sharedContent');
      const timeIndex = contentStore.index('timestamp');
      const range = IDBKeyRange.upperBound(sevenDaysAgo);
      const request = timeIndex.openCursor(range);
      
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          const content = cursor.value;
          if (content.consumed) {
            // Delete old consumed content
            cursor.delete();
            
            // Delete associated files
            const filesStore = tx.objectStore('sharedFiles');
            const filesIndex = filesStore.index('sharedId');
            const filesRequest = filesIndex.openCursor(IDBKeyRange.only(content.id));
            
            filesRequest.onsuccess = (e) => {
              const fileCursor = e.target.result;
              if (fileCursor) {
                fileCursor.delete();
                fileCursor.continue();
              }
            };
          }
          cursor.continue();
        }
      };
    });
  } catch (error) {
    console.error('[SharedContent] Error cleaning up old content:', error);
    return false;
  }
}
