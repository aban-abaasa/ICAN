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
// A resume/portfolio share link (e.g. https://icanera.space/portfolio/<handle>)
// must be viewable by anyone, signed in or not -- same reasoning as the
// Pitchin/status share links above. Visitors can still sign in in place to
// rate/recommend the professional, without losing the page.
const portfolioShareMatch = window.location.pathname.match(/^\/portfolio\/([^/]+)/);
// A dropship storefront link (e.g. https://icanera.space/store/<businessProfileId>)
// must be browsable by anyone, signed in or not -- same reasoning as the
// Pitchin/status share links above. Only checkout (a real ICANera payment)
// prompts sign-in, in place, without losing the cart.
const dropshipStoreMatch = window.location.pathname.match(/^\/store\/([^/]+)/);
// A CMMS company's public notice board (announcements + job postings) at
// /notices/<companyId> -- same no-login share-link reasoning as the links
// above. Job applicants submit their application right on this page with
// no account at all (not even a "sign in to interact" prompt), since the
// whole point of the feature is that applying never requires an account.
// Rendered outside <ThemeProvider> (below) rather than inside it like the
// other share links: ThemeProvider doesn't just hand down theme colors via
// context, it reaches out and sets an inline background-color directly on
// <html>/<body> and injects a page-wide stylesheet that repaints every
// stock Tailwind color class -- a hardcoded background this standalone,
// bring-your-own-palette page must never inherit.
const cmmsNoticeBoardMatch = window.location.pathname.match(/^\/notices\/([^/]+)/);
// A shared CMMS report link (e.g. https://icanera.space/reports/<token>) --
// same no-login share-link reasoning as the links above, except access can
// additionally be gated by a password or an emailed one-time code
// (PublicReportViewer.jsx handles all three modes itself by calling the
// anon-callable RPCs in CMMS_REPORT_SHARING_SYSTEM.sql). Rendered with no
// providers at all, like the QR check-in pages below, since a report
// viewer never needs an ICAN session or the app's theme system.
const reportShareMatch = window.location.pathname.match(/^\/reports\/([^/]+)/);
// A shared, department-scoped "Written Reports" export link (e.g.
// https://icanera.space/report-exports/<token>) -- same reasoning as
// reportShareMatch above, except it opens the grouped Department ->
// Employee -> Reports view the Export Reports panel's Download/Print
// buttons produce, rather than a single report.
const reportExportShareMatch = window.location.pathname.match(/^\/report-exports\/([^/]+)/);
// A stale service-worker/browser cache can leave a phone holding an
// index.html that points at a JS chunk hash the last deploy removed from the
// server — the chunk 404s, the dynamic import() rejects, and with no retry
// the Suspense fallback (a bare dark div) is the last thing that ever
// renders: a silent blank screen with no error visible to the user or to us.
// Reload once (bypassing every cache we control) before giving up, so the
// fresh index.html/chunks a normal browser visit would get are fetched
// instead of leaving the app permanently stuck.
const lazyWithReloadOnChunkFailure = (importer) => React.lazy(() =>
  importer().catch(async (error) => {
    const reloadedKey = 'ican-chunk-reload-attempted';
    if (sessionStorage.getItem(reloadedKey)) {
      throw error; // Already retried once this session — a real error, not a stale cache.
    }
    sessionStorage.setItem(reloadedKey, '1');
    console.warn('[App] Chunk load failed, clearing caches and reloading once:', error);
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ('caches' in window) {
        const names = await caches.keys();
        await Promise.all(names.map((name) => caches.delete(name)));
      }
    } catch (cleanupError) {
      console.warn('[App] Cache cleanup before reload failed:', cleanupError);
    }
    window.location.reload();
    return new Promise(() => {}); // Hang here; the reload is already in flight.
  })
);

const App = lazyWithReloadOnChunkFailure(() => import('./App'));
const PublicStaffAttendanceCheckIn = lazyWithReloadOnChunkFailure(() => import('./components/PublicStaffAttendanceCheckIn'));
const PublicVisitorCheckIn = lazyWithReloadOnChunkFailure(() => import('./components/PublicVisitorCheckIn'));
const PublicPitchViewer = lazyWithReloadOnChunkFailure(() => import('./components/PublicPitchViewer'));
const PublicStatusViewer = lazyWithReloadOnChunkFailure(() => import('./components/PublicStatusViewer'));
const PublicPortfolioPage = lazyWithReloadOnChunkFailure(() => import('./components/profile/PublicPortfolioPage'));
const PublicDropshipStorefront = lazyWithReloadOnChunkFailure(() => import('./components/PublicDropshipStorefront'));
const PublicCompanyNoticeBoard = lazyWithReloadOnChunkFailure(() => import('./components/PublicCompanyNoticeBoard'));
const PublicReportViewer = lazyWithReloadOnChunkFailure(() => import('./components/PublicReportViewer'));
const PublicReportExportViewer = lazyWithReloadOnChunkFailure(() => import('./components/PublicReportExportViewer'));
const Loading = () => <div className="min-h-screen bg-slate-950" />;

// Without this, ANY uncaught error during first render (a chunk failure that
// survived the retry above, or an unrelated bug) unmounts everything and
// leaves the exact same silent blank screen — invisible to the user and to
// us. This turns that into a visible, actionable message.
class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[App] Uncaught render error:', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center p-6 text-center">
        <div>
          <p className="text-slate-200 font-medium mb-3">Something went wrong loading IcanEra.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <Suspense fallback={<Loading />}>
        {isAttendanceQrPath ? <PublicStaffAttendanceCheckIn />
          : isVisitorQrPath ? <PublicVisitorCheckIn />
          : reportShareMatch ? <PublicReportViewer shareToken={reportShareMatch[1]} />
          : reportExportShareMatch ? <PublicReportExportViewer shareToken={reportExportShareMatch[1]} />
          : cmmsNoticeBoardMatch ? (
            <AuthProvider>
              <PublicCompanyNoticeBoard companyId={cmmsNoticeBoardMatch[1]} />
            </AuthProvider>
          ) : (
            <ThemeProvider>
              <AuthProvider>
                {pitchShareMatch ? <PublicPitchViewer pitchId={pitchShareMatch[1]} />
                  : statusShareMatch ? <PublicStatusViewer statusId={statusShareMatch[1]} />
                  : dropshipStoreMatch ? <PublicDropshipStorefront businessProfileId={dropshipStoreMatch[1]} />
                  : portfolioShareMatch ? <PublicPortfolioPage handle={portfolioShareMatch[1]} />
                  : <App />}
              </AuthProvider>
            </ThemeProvider>
          )}
      </Suspense>
    </AppErrorBoundary>
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
