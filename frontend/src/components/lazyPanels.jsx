import React, { Suspense } from 'react';
import { lazyWithRetry, prefetchWhenIdle } from '../lib/lazyWithRetry';

// The two biggest screens in the product (CMMS ~465 KB, Wallet ~370 KB of
// source) used to be bundled into the dashboard, so every phone paid for both
// before it could show anything. They now download the first time they are
// opened — and once the phone has been idle for a moment after the dashboard
// appears, the Wallet is fetched quietly in the background so tapping in is instant.
const importWallet = () => import('./ICANWallet');
const importCmms = () => import('./CMSSModule');

export const ICANWallet = lazyWithRetry(importWallet);
export const CMMSModule = lazyWithRetry(importCmms);

// Only the Wallet is warmed up: it is the screen almost everyone opens first. CMMS is
// the largest download and most people never open it, so it loads on tap only.
export const prefetchHeavyPanels = () => prefetchWhenIdle([importWallet]);

// Shown inside the panel's own frame while its code downloads, so the rest of
// the dashboard (header, bottom navigation) stays on screen and tappable.
export const PanelFallback = () => (
  <div
    role="status"
    aria-live="polite"
    style={{
      minHeight: '40vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
      color: '#8a6a1f',
      fontSize: '0.9rem',
      letterSpacing: '0.04em',
    }}
  >
    Loading…
  </div>
);

export const PanelSuspense = ({ children }) => (
  <Suspense fallback={<PanelFallback />}>{children}</Suspense>
);

// A lazily loaded component that carries its own Suspense boundary, so it can
// replace a normal `import X from './X'` without touching any JSX: the rest of
// the screen stays visible and interactive while this piece downloads.
// `fallback` defaults to a small "Loading…" block; pass `null` for modals and
// overlays that should simply appear when ready.
export const lazyPanel = (importer, { fallback } = {}) => {
  const Lazy = lazyWithRetry(importer);
  const Wrapped = (props) => (
    <Suspense fallback={fallback === undefined ? <PanelFallback /> : fallback}>
      <Lazy {...props} />
    </Suspense>
  );
  return Wrapped;
};
