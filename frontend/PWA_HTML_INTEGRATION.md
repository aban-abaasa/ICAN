/**
 * Updated index.html with PWA support
 * Add this to your existing index.html <head> section
 */

// PASTE THIS IN YOUR <head> SECTION:

/*
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  
  <!-- PWA Meta Tags -->
  <meta name="description" content="IcanEra - Transform Volatility to Global Capital. Complete Business & Financial Management Platform" />
  <meta name="theme-color" content="#667eea" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="IcanEra" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="format-detection" content="telephone=no" />
  <meta name="msapplication-TileColor" content="#667eea" />
  <meta name="msapplication-tap-highlight" content="no" />

  <!-- Apple iOS Icons -->
  <link rel="apple-touch-icon" href="/favicon.svg" />
  
  <!-- PWA Manifest -->
  <link rel="manifest" href="/manifest.json" />
  <link rel="icon" type="image/png" href="/favicon.svg" />

  <title>IcanEra</title>

  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
    }
    
    #root {
      width: 100%;
      min-height: 100vh;
    }
  </style>
  
  <!-- Flutterwave Payment Gateway SDK -->
  <script src="https://checkout.flutterwave.com/v3.js"></script>
</head>
<body>
  <div id="root"></div>
  
  <!-- Service Worker Registration Script -->
  <script>
    // Register Service Worker for offline support
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js', { scope: '/' })
          .then((registration) => {
            console.log('[PWA] Service Worker registered:', registration);
            
            // Check for updates periodically
            setInterval(() => {
              registration.update();
            }, 60000); // Check every 60 seconds
          })
          .catch((error) => {
            console.error('[PWA] Service Worker registration failed:', error);
          });
      });
    } else {
      console.warn('[PWA] Service Workers not supported in this browser');
    }

    // Handle offline/online events
    window.addEventListener('offline', () => {
      console.log('[PWA] Network offline');
      document.body.classList.add('offline-mode');
    });

    window.addEventListener('online', () => {
      console.log('[PWA] Network online');
      document.body.classList.remove('offline-mode');
    });

    // Detect when app is installed
    if ('onbeforeinstallprompt' in window) {
      let deferredPrompt;

      window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();
        deferredPrompt = e;
        // Show your custom install button
        const installButton = document.getElementById('pwa-install-button');
        if (installButton) {
          installButton.style.display = 'block';
          installButton.addEventListener('click', async () => {
            if (deferredPrompt) {
              deferredPrompt.prompt();
              const { outcome } = await deferredPrompt.userChoice;
              console.log('[PWA] Install result:', outcome);
              deferredPrompt = null;
            }
          });
        }
      });

      window.addEventListener('appinstalled', () => {
        console.log('[PWA] App installed');
        localStorage.setItem('pwa_installed', 'true');
      });
    }

    // Handle display mode changes
    if ('display' in window.navigator) {
      window.addEventListener('orientationchange', () => {
        console.log('[PWA] Orientation changed');
      });
    }

    // Periodic background sync for transactions (if available)
    if ('serviceWorker' in navigator && 'SyncManager' in window) {
      navigator.serviceWorker.ready.then((registration) => {
        // Register periodic sync (requires user permission)
        registration.periodicSync.register('sync-transactions', {
          minInterval: 24 * 60 * 60 * 1000 // 24 hours
        }).catch((error) => {
          console.warn('[PWA] Periodic sync not available:', error);
        });
      });
    }
  </script>

  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
*/

export default `Service Worker and PWA registration code is in the script tags above`;
