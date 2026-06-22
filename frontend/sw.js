// IcanEra Service Worker - Local-First Architecture
// Handles offline support, transaction queuing, and background sync

const CACHE_NAME = 'ican-era-v1';
const CACHE_URLS = [
  '/',
  '/index.html',
  '/favicon.svg',
  '/manifest.json'
];

const API_ROUTES = {
  transactions: '/api/transactions',
  wallets: '/api/wallets',
  reports: '/api/reports',
  investments: '/api/investments',
  users: '/api/auth/user'
};

const DB_NAME = 'IcanEraLocalDB';
const DB_VERSION = 1;

// ============================================
// SERVICE WORKER LIFECYCLE EVENTS
// ============================================

// Install Event - Cache essential assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching essential assets');
      return cache.addAll(CACHE_URLS).catch((err) => {
        console.warn('[SW] Cache addAll failed (some assets may be missing):', err);
      });
    }).then(() => {
      console.log('[SW] Installation complete');
      return self.skipWaiting();
    })
  );
});

// Activate Event - Clean old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      console.log('[SW] Claiming clients');
      return self.clients.claim();
    })
  );
});

// ============================================
// FETCH EVENT - INTELLIGENT OFFLINE ROUTING
// ============================================

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const pathname = url.pathname;

  // Skip non-GET requests and external URLs for now
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return;
  }

  // Strategy 1: API calls - Network first with fallback to cache
  if (pathname.startsWith('/api/')) {
    return event.respondWith(networkFirstStrategy(event.request));
  }

  // Strategy 2: Static assets - Cache first with network fallback
  if (isStaticAsset(pathname)) {
    return event.respondWith(cacheFirstStrategy(event.request));
  }

  // Strategy 3: HTML pages - Network first for app shell
  if (pathname.endsWith('.html') || pathname === '/') {
    return event.respondWith(networkFirstStrategy(event.request));
  }

  // Default: Network first
  event.respondWith(networkFirstStrategy(event.request));
});

// ============================================
// CACHE STRATEGIES
// ============================================

async function networkFirstStrategy(request) {
  try {
    const response = await fetch(request);
    
    // Cache successful responses
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    
    return response;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', error);
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    
    // Return offline page or error response
    return new Response(
      JSON.stringify({
        error: 'offline',
        message: 'You are offline. Please check your connection.'
      }),
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

async function cacheFirstStrategy(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[SW] Cache first strategy failed:', error);
    return new Response('Asset not available offline', {
      status: 404,
      statusText: 'Not Found'
    });
  }
}

// ============================================
// BACKGROUND SYNC
// ============================================

// Handle background sync for queued transactions
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync event:', event.tag);
  
  if (event.tag === 'sync-transactions') {
    event.waitUntil(syncQueuedTransactions());
  }
  
  if (event.tag === 'sync-all-data') {
    event.waitUntil(syncAllOfflineData());
  }
});

async function syncQueuedTransactions() {
  try {
    const db = await openDB();
    const pendingTransactions = await getPendingTransactions(db);
    
    if (pendingTransactions.length === 0) {
      console.log('[SW] No pending transactions to sync');
      return;
    }

    console.log('[SW] Syncing', pendingTransactions.length, 'transactions');

    for (const transaction of pendingTransactions) {
      try {
        const response = await fetch(API_ROUTES.transactions, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${await getAuthToken()}`
          },
          body: JSON.stringify(transaction.data)
        });

        if (response.ok) {
          await markTransactionSynced(db, transaction.id);
          console.log('[SW] Transaction synced:', transaction.id);
        } else {
          console.warn('[SW] Failed to sync transaction:', transaction.id, response.status);
        }
      } catch (error) {
        console.error('[SW] Error syncing transaction:', transaction.id, error);
        // Retry on next sync
      }
    }

    // Notify clients of sync completion
    await notifyClients({
      type: 'sync-complete',
      message: `${pendingTransactions.length} transactions synced`
    });

  } catch (error) {
    console.error('[SW] Error in syncQueuedTransactions:', error);
    throw error;
  }
}

async function syncAllOfflineData() {
  try {
    console.log('[SW] Starting full data sync');
    
    // First sync transactions
    await syncQueuedTransactions();
    
    // Then sync other data
    await syncWalletData();
    await syncUserData();
    
    console.log('[SW] Full data sync complete');
    
    await notifyClients({
      type: 'full-sync-complete',
      message: 'All data synchronized'
    });
  } catch (error) {
    console.error('[SW] Error in syncAllOfflineData:', error);
    throw error;
  }
}

async function syncWalletData() {
  try {
    const response = await fetch(API_ROUTES.wallets, {
      headers: {
        'Authorization': `Bearer ${await getAuthToken()}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      const db = await openDB();
      await saveWalletData(db, data);
      console.log('[SW] Wallet data synced');
    }
  } catch (error) {
    console.error('[SW] Error syncing wallet data:', error);
  }
}

async function syncUserData() {
  try {
    const response = await fetch(API_ROUTES.users, {
      headers: {
        'Authorization': `Bearer ${await getAuthToken()}`
      }
    });

    if (response.ok) {
      const data = await response.json();
      const db = await openDB();
      await saveUserData(db, data);
      console.log('[SW] User data synced');
    }
  } catch (error) {
    console.error('[SW] Error syncing user data:', error);
  }
}

// ============================================
// MESSAGE HANDLING
// ============================================

self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);

  if (event.data.type === 'QUEUE_TRANSACTION') {
    event.waitUntil(queueTransactionOffline(event.data.transaction));
  }

  if (event.data.type === 'FORCE_SYNC') {
    event.waitUntil(
      syncQueuedTransactions().then(() => {
        event.ports[0].postMessage({ success: true });
      }).catch((error) => {
        event.ports[0].postMessage({ success: false, error: error.message });
      })
    );
  }

  if (event.data.type === 'GET_OFFLINE_STATUS') {
    event.waitUntil(
      (async () => {
        const db = await openDB();
        const pending = await getPendingTransactions(db);
        event.ports[0].postMessage({
          offline: !navigator.onLine,
          pendingCount: pending.length
        });
      })()
    );
  }
});

// ============================================
// INDEXEDDB OPERATIONS
// ============================================

async function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // Create stores if they don't exist
      if (!db.objectStoreNames.contains('transactions')) {
        const txStore = db.createObjectStore('transactions', { keyPath: 'id' });
        txStore.createIndex('status', 'status', { unique: false });
        txStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      if (!db.objectStoreNames.contains('pending')) {
        const pendingStore = db.createObjectStore('pending', { keyPath: 'id' });
        pendingStore.createIndex('synced', 'synced', { unique: false });
      }

      if (!db.objectStoreNames.contains('wallets')) {
        db.createObjectStore('wallets', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('users')) {
        db.createObjectStore('users', { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains('syncQueue')) {
        const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id' });
        syncStore.createIndex('type', 'type', { unique: false });
        syncStore.createIndex('synced', 'synced', { unique: false });
      }

      // Store for shared content from Web Share Target API
      if (!db.objectStoreNames.contains('sharedContent')) {
        const sharedStore = db.createObjectStore('sharedContent', { keyPath: 'id' });
        sharedStore.createIndex('consumed', 'consumed', { unique: false });
        sharedStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Store for shared files (images, PDFs, etc.)
      if (!db.objectStoreNames.contains('sharedFiles')) {
        const filesStore = db.createObjectStore('sharedFiles', { keyPath: 'id' });
        filesStore.createIndex('sharedId', 'sharedId', { unique: false });
      }
    };
  });
}

async function queueTransactionOffline(transaction) {
  try {
    const db = await openDB();
    const tx = db.transaction('pending', 'readwrite');
    const store = tx.objectStore('pending');
    
    const queuedTx = {
      id: transaction.id || generateId(),
      data: transaction,
      timestamp: Date.now(),
      synced: false,
      retryCount: 0
    };

    await new Promise((resolve, reject) => {
      const request = store.add(queuedTx);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    console.log('[SW] Transaction queued:', queuedTx.id);
    
    // Request background sync
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.sync.register('sync-transactions');
        console.log('[SW] Sync registered');
      } catch (error) {
        console.warn('[SW] Background sync not available:', error);
      }
    }
  } catch (error) {
    console.error('[SW] Error queuing transaction:', error);
    throw error;
  }
}

async function getPendingTransactions(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending', 'readonly');
    const store = tx.objectStore('pending');
    const index = store.index('synced');
    const range = IDBKeyRange.only(false);
    const request = index.getAll(range);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function markTransactionSynced(db, transactionId) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('pending', 'readwrite');
    const store = tx.objectStore('pending');
    const request = store.get(transactionId);

    request.onsuccess = () => {
      const data = request.result;
      data.synced = true;
      data.syncedAt = Date.now();
      
      const updateRequest = store.put(data);
      updateRequest.onsuccess = () => resolve();
      updateRequest.onerror = () => reject(updateRequest.error);
    };

    request.onerror = () => reject(request.error);
  });
}

async function saveWalletData(db, wallets) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('wallets', 'readwrite');
    const store = tx.objectStore('wallets');
    
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);

    wallets.forEach((wallet) => {
      store.put(wallet);
    });
  });
}

async function saveUserData(db, userData) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction('users', 'readwrite');
    const store = tx.objectStore('users');
    
    const request = store.put(userData);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

function isStaticAsset(pathname) {
  return /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot)$/.test(pathname);
}

function generateId() {
  return 'tx_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function getAuthToken() {
  // Retrieve token from localStorage (set by main app)
  return new Promise((resolve) => {
    const clients = self.clients.matchAll({}).then((clients) => {
      if (clients.length > 0) {
        const channel = new MessageChannel();
        clients[0].postMessage({ type: 'GET_AUTH_TOKEN' }, [channel.port2]);
        
        channel.port1.onmessage = (event) => {
          resolve(event.data.token || '');
        };

        setTimeout(() => resolve(''), 5000);
      } else {
        resolve('');
      }
    });
  });
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll();
  clients.forEach((client) => {
    client.postMessage(message);
  });
}

// ============================================
// WEB SHARE TARGET API HANDLER
// ============================================

async function handleShareTarget(request) {
  try {
    console.log('[SW] Handling share target request');
    
    // Parse the form data from the share
    const formData = await request.formData();
    
    const title = formData.get('title') || '';
    const text = formData.get('text') || '';
    const url = formData.get('url') || '';
    const files = formData.getAll('media') || [];
    
    console.log('[SW] Shared content:', { title, text, url, filesCount: files.length });
    
    // Store the shared data in IndexedDB for the app to retrieve
    const sharedData = {
      id: 'shared_' + Date.now(),
      title,
      text,
      url,
      files: files.map(file => ({
        name: file.name,
        type: file.type,
        size: file.size
      })),
      timestamp: Date.now(),
      consumed: false
    };
    
    // Store files as blobs
    const db = await openDB();
    await storeSharedContent(db, sharedData, files);
    
    // Redirect to the app with a share indicator
    // The app will detect this and show the status/updates composer with pre-filled content
    return Response.redirect('/?share=true', 303);
    
  } catch (error) {
    console.error('[SW] Error handling share target:', error);
    // Redirect to app anyway so user can see the app
    return Response.redirect('/', 303);
  }
}

async function storeSharedContent(db, sharedData, files) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['sharedContent', 'sharedFiles'], 'readwrite');
    const contentStore = tx.objectStore('sharedContent');
    const filesStore = tx.objectStore('sharedFiles');
    
    tx.oncomplete = () => {
      console.log('[SW] Shared content stored');
      resolve();
    };
    tx.onerror = () => reject(tx.error);
    
    // Store the metadata
    contentStore.put(sharedData);
    
    // Store each file blob
    files.forEach((file, index) => {
      filesStore.put({
        id: sharedData.id + '_file_' + index,
        sharedId: sharedData.id,
        name: file.name,
        type: file.type,
        size: file.size,
        blob: file
      });
    });
  });
}

console.log('[SW] Service worker script loaded');
