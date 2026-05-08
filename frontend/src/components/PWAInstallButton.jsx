import React, { useEffect, useState } from 'react';
import { Download, Check } from 'lucide-react';

/**
 * PWA Install Button - Direct Install Only
 * Only shows when browser can install directly
 * No fallback instructions - just install
 */

export function PWAInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setIsInstalled(true);
      return;
    }

    // Listen for beforeinstallprompt event
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      console.log('[PWA] Install prompt available');
      setDeferredPrompt(e);
    };

    // Listen for app installed event
    const handleAppInstalled = () => {
      console.log('[PWA] App installed successfully');
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    // Listen for standalone mode changes
    const mediaQuery = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = () => {
      if (mediaQuery.matches) {
        setIsInstalled(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    mediaQuery.addEventListener('change', handleDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      mediaQuery.removeEventListener('change', handleDisplayModeChange);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;

    setInstalling(true);
    try {
      // Show the browser's native install prompt
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('[PWA] Installation accepted');
        setIsInstalled(true);
      } else {
        console.log('[PWA] Installation dismissed');
      }
      setDeferredPrompt(null);
    } catch (error) {
      console.error('[PWA] Install error:', error);
    } finally {
      setInstalling(false);
    }
  };

  // Show installed state
  if (isInstalled) {
    return (
      <div className="flex items-center gap-2 px-3 md:px-4 py-2 bg-green-500/20 text-green-300 rounded-lg border border-green-500/50 text-xs md:text-sm font-medium cursor-default">
        <Check size={16} className="md:w-[18px] md:h-[18px]" />
        <span className="hidden sm:inline">Installed ✓</span>
        <span className="sm:hidden">✓</span>
      </div>
    );
  }

  // Only show button if browser supports installation (has beforeinstallprompt)
  if (!deferredPrompt) {
    return null;
  }

  // Show install button
  return (
    <button
      onClick={handleInstallClick}
      disabled={installing}
      className="flex items-center gap-2 px-3 md:px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 active:from-blue-800 active:to-blue-900 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg font-medium text-xs md:text-sm transition transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl"
      title="Install ICANera - One click install"
    >
      <Download size={16} className="md:w-[18px] md:h-[18px]" />
      <span className="hidden sm:inline">{installing ? 'Installing...' : 'Install'}</span>
      <span className="sm:hidden">📲</span>
    </button>
  );
}

export default PWAInstallButton;
