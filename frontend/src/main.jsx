import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';

// Keep QR attendance separate from the ICAN application bundle. A scanned
// code renders only the small verification/check-in page and never mounts the
// dashboard, wallet, landing page, or CMMS workspace.
const isAttendanceQrPath = window.location.pathname === '/staff-attendance';
const isVisitorQrPath = window.location.pathname === '/visitor-check-in';
const App = React.lazy(() => import('./App'));
const PublicStaffAttendanceCheckIn = React.lazy(() => import('./components/PublicStaffAttendanceCheckIn'));
const PublicVisitorCheckIn = React.lazy(() => import('./components/PublicVisitorCheckIn'));
const Loading = () => <div className="min-h-screen bg-slate-950" />;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <Suspense fallback={<Loading />}>
        {isAttendanceQrPath ? <PublicStaffAttendanceCheckIn /> : isVisitorQrPath ? <PublicVisitorCheckIn /> : <AuthProvider><App /></AuthProvider>}
      </Suspense>
    </ThemeProvider>
  </React.StrictMode>,
);

// The production PWA caches app assets for offline use. Keep it disabled in
// Vite development: a cached bundle can otherwise preserve old environment
// variables after .env changes and make Supabase look unconfigured.
if (import.meta.env.DEV && 'serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
    .then(() => console.info('[PWA] Service workers disabled for local development.'))
    .catch((error) => console.warn('[PWA] Could not disable local service worker:', error));
}

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('[PWA] Service Worker registered:', registration);
      })
      .catch(error => {
        console.warn('[PWA] Service Worker registration failed:', error);
      });
  });
}
