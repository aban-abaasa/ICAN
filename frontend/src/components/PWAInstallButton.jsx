import React, { useEffect, useState } from 'react';
import { Download, Check, Share, PlusSquare, X } from 'lucide-react';

/**
 * PWA Install Button
 * - Chrome/Edge/Android: uses the native beforeinstallprompt flow.
 * - iOS Safari & iOS Chrome (both WebKit): beforeinstallprompt never fires,
 *   there is no programmatic install API at all, so we show the button
 *   anyway and open instructions for the manual Share -> Add to Home
 *   Screen flow, which is the only way to install a PWA on iOS/iPadOS.
 */

const isIos = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13+ reports as "MacIntel" with touch support unless the site
  // requests desktop mode, so a plain UA sniff for "iPad" misses it.
  const isIpadOs13Plus = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || isIpadOs13Plus;
};

export function PWAInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [showIosInstructions, setShowIosInstructions] = useState(false);
  const [iosDevice] = useState(isIos);

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

  // Neither iOS Safari nor iOS Chrome ever fires beforeinstallprompt, and
  // there's no programmatic install API on iOS at all — so without this
  // branch the button simply never renders for any Apple device.
  if (!deferredPrompt && !iosDevice) {
    return null;
  }

  if (iosDevice) {
    return (
      <>
        <button
          onClick={() => setShowIosInstructions(true)}
          className="flex items-center gap-2 px-3 md:px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 active:from-blue-800 active:to-blue-900 text-white rounded-lg font-medium text-xs md:text-sm transition transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl"
          title="Install IcanEra on your iPhone or iPad"
        >
          <Download size={16} className="md:w-[18px] md:h-[18px]" />
          <span className="hidden sm:inline">Install</span>
          <span className="sm:hidden">📲</span>
        </button>
        {showIosInstructions && (
          <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50 p-3 sm:items-center" onClick={() => setShowIosInstructions(false)}>
            <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900">Install IcanEra</h2>
                <button onClick={() => setShowIosInstructions(false)} aria-label="Close install instructions" className="rounded-lg p-1 text-gray-400 hover:bg-gray-100">
                  <X size={20} />
                </button>
              </div>
              <ol className="space-y-3 text-sm text-gray-700">
                <li className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">1</span>
                  <span className="flex items-center gap-1.5">Tap the Share icon <Share size={16} className="inline text-blue-600" /> in Safari or Chrome's toolbar</span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">2</span>
                  <span className="flex items-center gap-1.5">Scroll down and tap <strong>Add to Home Screen</strong> <PlusSquare size={16} className="inline text-blue-600" /></span>
                </li>
                <li className="flex items-center gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100 font-semibold text-blue-700">3</span>
                  <span>Tap <strong>Add</strong> to confirm — IcanEra now opens full-screen from your Home Screen</span>
                </li>
              </ol>
              <button onClick={() => setShowIosInstructions(false)} className="mt-5 w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-700">
                Got it
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  // Show install button
  return (
    <button
      onClick={handleInstallClick}
      disabled={installing}
      className="flex items-center gap-2 px-3 md:px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 active:from-blue-800 active:to-blue-900 disabled:opacity-60 disabled:cursor-not-allowed text-white rounded-lg font-medium text-xs md:text-sm transition transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl"
      title="Install IcanEra - One click install"
    >
      <Download size={16} className="md:w-[18px] md:h-[18px]" />
      <span className="hidden sm:inline">{installing ? 'Installing...' : 'Install'}</span>
      <span className="sm:hidden">📲</span>
    </button>
  );
}

export default PWAInstallButton;
