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
// A shared Pitchin/status link (e.g. https://icanera.space/pitchin/<id>) must
// open that exact video for whoever receives it, whether they have an ICAN
// account or not -- the whole point of a share link is that it doesn't force
// login just to watch. App's normal tree gates everything behind
// `if (!user) return <AuthPage/>`, so these render instead of <App/>, not
// inside it. They're still wrapped in AuthProvider (unlike the QR pages
// above) so a viewer can sign in in place to like/comment/invest, and the
// same component just becomes fully interactive once they do.
const pitchShareMatch = window.location.pathname.match(/^\/pitchin\/([^/]+)/);
const statusShareMatch = window.location.pathname.match(/^\/status\/([^/]+)/);
// A dropship storefront link (e.g. https://icanera.space/store/<businessProfileId>)
// must be browsable by anyone, signed in or not -- same reasoning as the
// Pitchin/status share links above. Only checkout (a real ICANera payment)
// prompts sign-in, in place, without losing the cart.
const dropshipStoreMatch = window.location.pathname.match(/^\/store\/([^/]+)/);
const App = React.lazy(() => import('./App'));
const PublicStaffAttendanceCheckIn = React.lazy(() => import('./components/PublicStaffAttendanceCheckIn'));
const PublicVisitorCheckIn = React.lazy(() => import('./components/PublicVisitorCheckIn'));
const PublicPitchViewer = React.lazy(() => import('./components/PublicPitchViewer'));
const PublicStatusViewer = React.lazy(() => import('./components/PublicStatusViewer'));
const PublicDropshipStorefront = React.lazy(() => import('./components/PublicDropshipStorefront'));
const Loading = () => <div className="min-h-screen bg-slate-950" />;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <Suspense fallback={<Loading />}>
        {isAttendanceQrPath ? <PublicStaffAttendanceCheckIn /> : isVisitorQrPath ? <PublicVisitorCheckIn /> : (
          <AuthProvider>
            {pitchShareMatch ? <PublicPitchViewer pitchId={pitchShareMatch[1]} />
              : statusShareMatch ? <PublicStatusViewer statusId={statusShareMatch[1]} />
              : dropshipStoreMatch ? <PublicDropshipStorefront businessProfileId={dropshipStoreMatch[1]} />
              : <App />}
          </AuthProvider>
        )}
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
