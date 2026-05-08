/**
 * PWA Initialization Module
 * Handles service worker registration, manifest validation, and PWA setup
 */

export class PWAInitializer {
  constructor() {
    this.swRegistration = null;
    this.isInstallable = false;
  }

  /**
   * Initialize PWA functionality
   */
  async initialize() {
    try {
      console.log('[PWA] Initializing PWA features...');

      // Check browser support
      if (!this.checkBrowserSupport()) {
        console.warn('[PWA] Browser does not support PWA features');
        return false;
      }

      // Register service worker
      await this.registerServiceWorker();

      // Check installability
      this.setupInstallPrompt();

      // Check for updates periodically
      this.setupUpdateCheck();

      console.log('[PWA] PWA initialization complete');
      return true;
    } catch (error) {
      console.error('[PWA] Initialization error:', error);
      return false;
    }
  }

  /**
   * Check if browser supports required PWA features
   */
  checkBrowserSupport() {
    return (
      'serviceWorker' in navigator &&
      'IndexedDB' in window &&
      'caches' in window
    );
  }

  /**
   * Register service worker
   */
  async registerServiceWorker() {
    try {
      if (!('serviceWorker' in navigator)) {
        console.warn('[PWA] Service Worker not supported');
        return;
      }

      this.swRegistration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none' // Always check for updates
      });

      console.log('[PWA] Service Worker registered:', this.swRegistration);

      // Listen for updates
      this.swRegistration.addEventListener('updatefound', () => {
        this.handleServiceWorkerUpdate();
      });

      return this.swRegistration;
    } catch (error) {
      console.error('[PWA] Service Worker registration failed:', error);
      throw error;
    }
  }

  /**
   * Handle service worker updates
   */
  handleServiceWorkerUpdate() {
    const newWorker = this.swRegistration.installing;

    newWorker?.addEventListener('statechange', () => {
      if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
        // New service worker available
        console.log('[PWA] New service worker available');
        
        // Notify user to reload
        this.notifyUpdateAvailable();
      }
    });
  }

  /**
   * Notify user that an update is available
   */
  notifyUpdateAvailable() {
    // Dispatch custom event for UI to handle
    window.dispatchEvent(new CustomEvent('pwa-update-available', {
      detail: {
        message: 'A new version of IcanEra is available',
        reload: () => window.location.reload(true)
      }
    }));
  }

  /**
   * Setup install prompt handling
   */
  setupInstallPrompt() {
    let deferredPrompt;

    window.addEventListener('beforeinstallprompt', (event) => {
      // Prevent the mini-infobar from appearing on mobile
      event.preventDefault();
      // Stash the event for later use
      deferredPrompt = event;
      // Update UI to notify the user they can install the app
      this.isInstallable = true;
      
      // Dispatch event for UI to handle install button
      window.dispatchEvent(new CustomEvent('pwa-installable', {
        detail: { prompt: deferredPrompt }
      }));

      console.log('[PWA] App is installable');
    });

    window.addEventListener('appinstalled', () => {
      console.log('[PWA] App was installed');
      deferredPrompt = null;
      this.isInstallable = false;
      
      window.dispatchEvent(new CustomEvent('pwa-installed'));
    });
  }

  /**
   * Request install prompt
   */
  async requestInstall() {
    try {
      const event = new CustomEvent('show-install-prompt');
      window.dispatchEvent(event);
      return true;
    } catch (error) {
      console.error('[PWA] Install request failed:', error);
      return false;
    }
  }

  /**
   * Setup periodic update check
   */
  setupUpdateCheck() {
    // Check for updates every 24 hours
    setInterval(async () => {
      try {
        if (this.swRegistration) {
          await this.swRegistration.update();
          console.log('[PWA] Update check completed');
        }
      } catch (error) {
        console.error('[PWA] Update check failed:', error);
      }
    }, 24 * 60 * 60 * 1000);
  }

  /**
   * Request background sync
   */
  async requestBackgroundSync(tag = 'sync-transactions') {
    try {
      if (!this.swRegistration || !('sync' in this.swRegistration)) {
        console.warn('[PWA] Background Sync not supported');
        return false;
      }

      await this.swRegistration.sync.register(tag);
      console.log('[PWA] Background sync registered:', tag);
      return true;
    } catch (error) {
      console.error('[PWA] Background sync registration failed:', error);
      return false;
    }
  }

  /**
   * Get PWA status
   */
  getStatus() {
    return {
      supported: this.checkBrowserSupport(),
      swRegistered: this.swRegistration !== null,
      isInstallable: this.isInstallable,
      isInstalled: window.matchMedia('(display-mode: standalone)').matches
    };
  }
}

// Singleton instance
export const pwaInitializer = new PWAInitializer();

export default pwaInitializer;
