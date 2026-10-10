import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { injectSpeedInsights } from '@vercel/speed-insights';
import './index.css';
// The IcanEra diamond: one loading indicator for the whole app (see diamond.css).
import './components/diamond.css';
import { installDiamondStyles } from './components/diamondArt';
import { ClassicLoadingScreen } from './components/SplashScreen';
import AmbientBackdrop from './components/AmbientBackdrop';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { I18nProvider } from './i18n/I18nProvider';
// Dependency-free on purpose (no Supabase import) — see referralCapture.js.
import { captureReferralFromUrl } from './services/referralCapture';
import { lazyWithRetry } from './lib/lazyWithRetry';

// A shared referral link (/?ref=CODE) can land on any page, signed in or not:
// remember the code now, App redeems it once the visitor has an account.
captureReferralFromUrl();

installDiamondStyles();

// Vercel Speed Insights (no-op outside a Vercel deployment). Called once here
// rather than as a component so it covers every branch rendered below.
injectSpeedInsights();

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
// same component just becomes fully interactive once they do. PublicShareFlow
// wraps both viewers so the linked item is the first step of a flow -- swipe
// on to more pitches, tap through other live updates, or open Explore --
// instead of the only thing the visitor can see.
const pitchShareMatch = window.location.pathname.match(/^\/pitchin\/([^/]+)/);
// A private, PIN-locked, time-limited pitch invite for one named investor
// (backend/PITCHIN_PRIVATE_INVESTOR_INVITES.sql) at /invite/<token> -- unlike
// pitchShareMatch above, this page shows nothing real until the PIN is
// verified server-side, but otherwise needs the same no-forced-login,
// sign-in-in-place treatment to invest, so it's wrapped the same way.
const privateInviteMatch = window.location.pathname.match(/^\/invite\/([^/]+)/);
const statusShareMatch = window.location.pathname.match(/^\/status\/([^/]+)/);
// A resume/portfolio share link (e.g. https://icanera.space/portfolio/<handle>)
// must be viewable by anyone, signed in or not -- same reasoning as the
// Pitchin/status share links above. Visitors can still sign in in place to
// rate/recommend the professional, without losing the page.
const portfolioShareMatch = window.location.pathname.match(/^\/portfolio\/([^/]+)/);
// A dropship storefront link (e.g. https://icanera.space/store/<businessProfileId>)
// must be browsable by anyone, signed in or not -- same reasoning as the
// Pitchin/status share links above. Only checkout (a real IcanEra payment)
// prompts sign-in, in place, without losing the cart.
const dropshipStoreMatch = window.location.pathname.match(/^\/store\/([^/]+)/);
// The public shop window (/shop): every reseller-listed product as a picture grid, for anyone (and
// search engines, via /api/share-preview?type=shop). Self-styled and needs no auth, so it sits
// outside both ThemeProvider and AuthProvider like the other standalone public pages.
const isPublicShopPath = /^\/shop\/?$/.test(window.location.pathname);
// The public icaneracoin price chart (/icaneracoin): live candlesticks + chart analysis for anyone, signed in
// or not, and what Google lands on when someone searches "icaneracoin". Self-styled and needs no auth, so
// like the shop it sits outside both ThemeProvider and AuthProvider.
const isPublicIcanChartPath = /^\/icaneracoin\/?$/i.test(window.location.pathname);
// An instalment plan (/plan/<code>) and the customer's list of them (/plans): the plan's code is a
// handle, not a secret -- the page itself needs the customer (or the seller's team) to be signed in.
const installmentPlanMatch = window.location.pathname.match(/^\/plan\/([A-Za-z0-9]{6,12})\/?$/);
const isMyInstallmentsPath = /^\/plans\/?$/.test(window.location.pathname);
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
// The QR printed on any recorded transaction's receipt (/r/<code>, see
// ADD_PUBLIC_TRANSACTION_QR.sql): the receipt for anyone, no account, plus payment when the
// owner switched it on. Same reasoning as the notice board -- AuthProvider (a visitor may sign
// in in place to pay from their wallet) but never the app's ThemeProvider.
const publicReceiptMatch = window.location.pathname.match(/^\/r\/([a-z0-9]{16,40})\/?$/);
// A business's STANDING pay QR (/p/<code>): printed once, the customer types any amount / lists items and
// pays. Standalone like the receipt page, but needs no providers at all (the bill it makes opens /r/<code>).
const publicPayCodeMatch = window.location.pathname.match(/^\/p\/([a-z0-9]{16,40})\/?$/);
// A candidate's written-test / live-interview link (see
// CMMS_WRITTEN_TESTS.sql, CMMS_INTERVIEW_SCHEDULES.sql) -- like the notice
// board, these need AuthProvider (a candidate must sign in/sign up with a
// lightweight ICAN account to proceed, and CandidateInterviewRoom hands the
// session straight to LiveBoardroom), but never the app's theme system.
const isCandidateTestPath = window.location.pathname === '/candidate-test';
const isCandidateInterviewPath = window.location.pathname === '/candidate-interview';
const isCandidateDocumentPath = window.location.pathname === '/candidate-document';
// Scanning a QR-sealed appointment letter/contract's "seal" opens this --
// fully public, no account, same reasoning as the report-share/attendance
// QR pages below.
const isDocumentVerifyPath = window.location.pathname === '/verify-document';
// Scanning the QR seal on a printed investment agreement (Pitchin) -- public,
// no login, shows the live signature record.
const isAgreementVerifyPath = window.location.pathname === '/verify-agreement';
// A service-provider contract link (CMMS_SERVICE_PROVIDER_CONTRACTS.sql) --
// the ONE page an outside contractor with no CMMS/ICAN account ever opens:
// their contract, task follow-ups, and payment history, time-limited and
// fully public, same no-login reasoning as the QR/verify pages above.
const isServiceProviderContractPath = window.location.pathname === '/service-provider-contract';
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
// A CMMS Clinical Operations consultation form's public share link (e.g.
// https://icanera.space/consultation-forms/<token>) -- same no-login
// share-link reasoning as the links above: a patient fills this out and
// submits with no ICAN account (CMMS_CLINICAL_CONSULTATION_FORMS.sql gates
// it by share_token + share_enabled instead of business membership).
const consultationFormShareMatch = window.location.pathname.match(/^\/consultation-forms\/([^/]+)/);
// Chunk-load retry + stale-cache recovery lives in lib/lazyWithRetry.js so every
// lazily loaded screen in the app shares it.
const lazyWithReloadOnChunkFailure = lazyWithRetry;

const App = lazyWithReloadOnChunkFailure(() => import('./App'));
const PublicStaffAttendanceCheckIn = lazyWithReloadOnChunkFailure(() => import('./components/PublicStaffAttendanceCheckIn'));
const PublicVisitorCheckIn = lazyWithReloadOnChunkFailure(() => import('./components/PublicVisitorCheckIn'));
const PublicShareFlow = lazyWithReloadOnChunkFailure(() => import('./components/PublicShareFlow'));
const PrivatePitchInviteViewer = lazyWithReloadOnChunkFailure(() => import('./components/PrivatePitchInviteViewer'));
const PublicPortfolioPage = lazyWithReloadOnChunkFailure(() => import('./components/profile/PublicPortfolioPage'));
const PublicDropshipStorefront = lazyWithReloadOnChunkFailure(() => import('./components/PublicDropshipStorefront'));
const PublicShopPage = lazyWithReloadOnChunkFailure(() => import('./components/PublicShopPage'));
const PublicIcanChartPage = lazyWithReloadOnChunkFailure(() => import('./components/PublicIcanChartPage'));
const PublicInstallmentPlan = lazyWithReloadOnChunkFailure(() => import('./components/PublicInstallmentPlan'));
const PublicMyInstallments = lazyWithReloadOnChunkFailure(() => import('./components/PublicMyInstallments'));
const PublicCompanyNoticeBoard = lazyWithReloadOnChunkFailure(() => import('./components/PublicCompanyNoticeBoard'));
const PublicTransactionPage = lazyWithReloadOnChunkFailure(() => import('./components/PublicTransactionPage'));
const PublicPayCodePage = lazyWithReloadOnChunkFailure(() => import('./components/PublicPayCodePage'));
const PublicReportViewer = lazyWithReloadOnChunkFailure(() => import('./components/PublicReportViewer'));
const PublicReportExportViewer = lazyWithReloadOnChunkFailure(() => import('./components/PublicReportExportViewer'));
const PublicConsultationFormViewer = lazyWithReloadOnChunkFailure(() => import('./components/PublicConsultationFormViewer'));
const CandidateTestRunner = lazyWithReloadOnChunkFailure(() => import('./components/CandidateTestRunner'));
const CandidateInterviewRoom = lazyWithReloadOnChunkFailure(() => import('./components/CandidateInterviewRoom'));
const CandidateDocumentViewer = lazyWithReloadOnChunkFailure(() => import('./components/CandidateDocumentViewer'));
const PublicDocumentVerify = lazyWithReloadOnChunkFailure(() => import('./components/PublicDocumentVerify'));
const PublicAgreementVerify = lazyWithReloadOnChunkFailure(() => import('./components/PublicAgreementVerify'));
const PublicServiceProviderContract = lazyWithReloadOnChunkFailure(() => import('./components/PublicServiceProviderContract'));
const PhoneAlertsPrompt = lazyWithReloadOnChunkFailure(() => import('./components/PhoneAlertsPrompt'));
// First paint while the app's chunks load: the opening diamond, the same screen
// App shows while it checks the session, so startup never flashes a blank page.
const Loading = () => <ClassicLoadingScreen />;

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
          : isPublicShopPath ? <PublicShopPage />
          : isPublicIcanChartPath ? <PublicIcanChartPage />
          : isVisitorQrPath ? <PublicVisitorCheckIn />
          : isDocumentVerifyPath ? <PublicDocumentVerify />
          : isAgreementVerifyPath ? <PublicAgreementVerify />
          : isServiceProviderContractPath ? <PublicServiceProviderContract />
          : reportShareMatch ? <PublicReportViewer shareToken={reportShareMatch[1]} />
          : reportExportShareMatch ? <PublicReportExportViewer shareToken={reportExportShareMatch[1]} />
          : consultationFormShareMatch ? <PublicConsultationFormViewer shareToken={consultationFormShareMatch[1]} />
          : publicPayCodeMatch ? <PublicPayCodePage code={publicPayCodeMatch[1]} />
          : cmmsNoticeBoardMatch ? (
            <AuthProvider>
              <PublicCompanyNoticeBoard companyId={cmmsNoticeBoardMatch[1]} />
            </AuthProvider>
          ) : publicReceiptMatch ? (
            <AuthProvider>
              <PublicTransactionPage code={publicReceiptMatch[1]} />
            </AuthProvider>
          ) : isCandidateTestPath ? (
            <AuthProvider>
              <CandidateTestRunner />
            </AuthProvider>
          ) : isCandidateInterviewPath ? (
            <AuthProvider>
              <CandidateInterviewRoom />
            </AuthProvider>
          ) : isCandidateDocumentPath ? (
            <AuthProvider>
              <CandidateDocumentViewer />
            </AuthProvider>
          ) : (
            <ThemeProvider>
              <AuthProvider>
                <I18nProvider>
                {pitchShareMatch ? <PublicShareFlow kind="pitch" id={pitchShareMatch[1]} />
                  : privateInviteMatch ? <PrivatePitchInviteViewer token={privateInviteMatch[1]} />
                  : statusShareMatch ? <PublicShareFlow kind="status" id={statusShareMatch[1]} />
                  : dropshipStoreMatch ? <PublicDropshipStorefront businessProfileId={dropshipStoreMatch[1]} />
                  : installmentPlanMatch ? <PublicInstallmentPlan code={installmentPlanMatch[1].toUpperCase()} />
                  : isMyInstallmentsPath ? <PublicMyInstallments />
                  : portfolioShareMatch ? <PublicPortfolioPage handle={portfolioShareMatch[1]} />
                  : <><App /><PhoneAlertsPrompt /><AmbientBackdrop /></>}
                </I18nProvider>
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
