import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './context/AuthContext';
import { AuthPage } from './components/auth';
import CountryCheckMiddleware from './components/auth/CountryCheckMiddleware';
import ICANCapitalEngine from './components/ICAN_Capital_Engine';
import LandingPage from './components/LandingPage';
import PricingPage from './components/PricingPage';
import ContractPage from './components/ContractPage';
import BillingPage from './components/BillingPage';
import MobileView from './components/MobileView';
import ActionQueue from './components/ActionQueue';
import { SplashScreen } from './components/SplashScreen';
import ICANDevPanel, { SESSION_KEY as ICAN_DEV_KEY } from './components/ICANDevPanel';
import ResetPinPage from './components/ResetPinPage';
import ConfirmDeleteAccountPage from './components/ConfirmDeleteAccountPage';
import DecoyPortal from './components/DecoyPortal';
import SupportConsole from './components/SupportConsole';
import ChatWidget from './components/ChatWidget';
import { offlineManager } from './lib/offlineManager';
import { Loader2, AlertCircle } from 'lucide-react';

// Error Boundary for mobile crashes
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('🔴 Error caught by boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
          <div className="text-center max-w-sm">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-white mb-2">Something went wrong</h1>
            <p className="text-gray-400 mb-4">{this.state.error?.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg font-medium"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const App = () => {
  const { user, loading, isRecoveryMode, clearRecoveryMode } = useAuth();
  const [showLanding, setShowLanding] = useState(!user);
  const [isResetPasswordPath, setIsResetPasswordPath] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname === '/reset-password';
    }
    return false;
  });
  const [isResetPinPath, setIsResetPinPath] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname === '/reset-pin';
    }
    return false;
  });
  const [isConfirmDeleteAccountPath, setIsConfirmDeleteAccountPath] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname === '/confirm-delete-account';
    }
    return false;
  });
  const [isDecoyPortalPath] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname === '/decoy-portal';
    }
    return false;
  });
  const [isSupportConsolePath] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname === '/support-console';
    }
    return false;
  });
  const [isPricingPath, setIsPricingPath] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname === '/pricing';
    }
    return false;
  });
  const [isContractPath, setIsContractPath] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname === '/contract';
    }
    return false;
  });
  const [isBillingPath, setIsBillingPath] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.location.pathname === '/billing';
    }
    return false;
  });
  const [isMobile, setIsMobile] = useState(() => {
    // Safe check for window object (SSR compatibility)
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768;
    }
    return false;
  });
  const [appError, setAppError] = useState(null);
  const [showSplash, setShowSplash] = useState(false);
  // A "Create your own IcanEra portfolio" link (from someone else's public
  // /portfolio/<handle> page) lands a signed-out visitor straight on sign-up
  // instead of the landing page — see PublicPortfolioPage.jsx's startOwnPortfolio.
  const [wantsSignup] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('auth') === 'signup';
    }
    return false;
  });
  useEffect(() => {
    if (!wantsSignup) return;
    try {
      const params = new URLSearchParams(window.location.search);
      params.delete('auth');
      const rest = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
    } catch (_) { /* URL not available */ }
  }, [wantsSignup]);
  const isRestoringAppHistoryRef = useRef(false);
  const lastPublicViewRef = useRef(null);

  // Initialize PWA offline manager on mount
  useEffect(() => {
    const initOfflineManager = async () => {
      try {
        console.log('[App] Initializing offline manager...');
        // offlineManager initializes automatically in its constructor
        // but we can add additional setup here if needed
        console.log('[App] Offline manager initialized');
      } catch (error) {
        console.error('[App] Error initializing offline manager:', error);
      }
    };

    initOfflineManager();
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    
    // Log device info for debugging
    console.log('📱 Device Info:', {
      width: window.innerWidth,
      height: window.innerHeight,
      isMobile,
      userAgent: navigator.userAgent
    });

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const handlePopState = () => {
      setIsResetPasswordPath(window.location.pathname === '/reset-password');
      setIsResetPinPath(window.location.pathname === '/reset-pin');
      setIsConfirmDeleteAccountPath(window.location.pathname === '/confirm-delete-account');
      setIsPricingPath(window.location.pathname === '/pricing');
      setIsContractPath(window.location.pathname === '/contract');
      setIsBillingPath(window.location.pathname === '/billing');
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Global error handler
  useEffect(() => {
    const handleError = (event) => {
      console.error('🔴 Global error:', event.error);
      setAppError(event.error?.message || 'An error occurred');
    };

    const handleUnhandledRejection = (event) => {
      console.error('🔴 Unhandled rejection:', event.reason);
      setAppError(event.reason?.message || 'An error occurred');
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    if (user || isRecoveryMode || isResetPasswordPath || isResetPinPath || isConfirmDeleteAccountPath) return;

    const publicView = showLanding ? 'landing' : 'auth';

    if (!isRestoringAppHistoryRef.current && lastPublicViewRef.current !== publicView) {
      const nextState = {
        ...(window.history.state || {}),
        __icanApp: {
          publicView
        }
      };

      if (lastPublicViewRef.current === null) {
        window.history.replaceState(nextState, '', window.location.href);
      } else {
        window.history.pushState(nextState, '', window.location.href);
      }
    }

    lastPublicViewRef.current = publicView;
  }, [user, showLanding, isRecoveryMode, isResetPasswordPath, isResetPinPath, isConfirmDeleteAccountPath]);

  useEffect(() => {
    const handlePopState = (event) => {
      if (user || isRecoveryMode || isResetPasswordPath || isResetPinPath || isConfirmDeleteAccountPath) return;

      const view = event.state?.__icanApp?.publicView;
      if (view === 'landing' || view === 'auth') {
        isRestoringAppHistoryRef.current = true;
        setShowLanding(view === 'landing');
        lastPublicViewRef.current = view;
        window.setTimeout(() => {
          isRestoringAppHistoryRef.current = false;
        }, 0);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [user, isRecoveryMode, isResetPasswordPath, isResetPinPath, isConfirmDeleteAccountPath]);

  const handleRecoveryHandled = () => {
    clearRecoveryMode();
    setShowLanding(false);

    if (window.location.pathname === '/reset-password') {
      window.history.replaceState({}, '', '/');
    }

    setIsResetPasswordPath(false);
  };

  const handlePinResetDone = () => {
    setShowLanding(false);
    setIsResetPinPath(false);
  };

  const handleConfirmDeleteAccountDone = () => {
    setShowLanding(false);
    setIsConfirmDeleteAccountPath(false);
  };

  const handlePricingBack = () => {
    window.history.pushState({}, '', '/');
    setIsPricingPath(false);
  };

  const handlePricingGetStarted = (tierKey) => {
    if (tierKey === 'contract') {
      window.history.pushState({}, '', '/contract');
      setIsPricingPath(false);
      setIsContractPath(true);
      return;
    }
    window.history.pushState({}, '', '/');
    setIsPricingPath(false);
    setShowSplash(true);
    setTimeout(() => setShowLanding(false), 800);
  };

  const handleContractBack = () => {
    window.history.pushState({}, '', '/pricing');
    setIsContractPath(false);
    setIsPricingPath(true);
  };

  const handleBillingBack = () => {
    window.history.pushState({}, '', '/');
    setIsBillingPath(false);
  };

  // Decoy portal — checked before anything else in this component, including
  // the dev-panel intercept below. Renders a fully isolated, static fake
  // dashboard with zero imports that reach Supabase or any real API; a
  // flagged IP redirected here (see the reputation gate in
  // backend/middleware/canweShield.js) must never brush against real auth
  // state or a real network call.
  if (isDecoyPortalPath) {
    return <DecoyPortal />;
  }

  // Scoped support-team board — its own Gmail-allowlist/PIN gate (see
  // SupportConsole.jsx + backend/SUPPORT_CONSOLE.sql), independent of the
  // main app's dashboard/onboarding flow below even when `user` is set
  // (e.g. a signed-in customer landing here should see "not authorized",
  // not get dropped into their own ICAN dashboard).
  if (isSupportConsolePath) {
    return <SupportConsole />;
  }

  // Developer panel — silent intercept, no auth session required
  if (sessionStorage.getItem(ICAN_DEV_KEY) === 'true') {
    return <ICANDevPanel onExit={() => window.location.reload()} />;
  }

  // Show loading screen while checking auth status
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-purple-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading IcanEra...</p>
        </div>
      </div>
    );
  }

  // Show error screen if there's an app error
  if (appError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
        <div className="text-center max-w-sm">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-white mb-2">App Error</h1>
          <p className="text-gray-400 mb-4">{appError}</p>
          <button
            onClick={() => {
              setAppError(null);
              window.location.reload();
            }}
            className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg font-medium"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (isRecoveryMode || isResetPasswordPath) {
    return (
      <ErrorBoundary>
        <SplashScreen show={showSplash} onHide={() => setShowSplash(false)} />
        <AuthPage
          initialView="reset-password"
          onRecoveryHandled={handleRecoveryHandled}
        />
      </ErrorBoundary>
    );
  }

  if (isResetPinPath) {
    return (
      <ErrorBoundary>
        <SplashScreen show={showSplash} onHide={() => setShowSplash(false)} />
        <ResetPinPage onDone={handlePinResetDone} />
      </ErrorBoundary>
    );
  }

  if (isConfirmDeleteAccountPath) {
    return (
      <ErrorBoundary>
        <SplashScreen show={showSplash} onHide={() => setShowSplash(false)} />
        <ConfirmDeleteAccountPage onDone={handleConfirmDeleteAccountDone} />
      </ErrorBoundary>
    );
  }

  if (isPricingPath) {
    return (
      <ErrorBoundary>
        <SplashScreen show={showSplash} onHide={() => setShowSplash(false)} />
        <PricingPage onBack={handlePricingBack} onGetStarted={handlePricingGetStarted} />
      </ErrorBoundary>
    );
  }

  if (isContractPath) {
    return (
      <ErrorBoundary>
        <SplashScreen show={showSplash} onHide={() => setShowSplash(false)} />
        <ContractPage onBack={handleContractBack} />
      </ErrorBoundary>
    );
  }

  if (isBillingPath) {
    return (
      <ErrorBoundary>
        <SplashScreen show={showSplash} onHide={() => setShowSplash(false)} />
        <BillingPage onBack={handleBillingBack} />
      </ErrorBoundary>
    );
  }

  if (!user) {
    if (wantsSignup) {
      return (
        <ErrorBoundary>
          <SplashScreen show={showSplash} onHide={() => setShowSplash(false)} />
          <AuthPage initialView="signup" />
          <ChatWidget />
        </ErrorBoundary>
      );
    }
    if (showLanding) {
      return (
        <ErrorBoundary>
          <SplashScreen show={showSplash} onHide={() => setShowSplash(false)} />
          <LandingPage onGetStarted={() => {
            setShowSplash(true);
            setTimeout(() => setShowLanding(false), 800);
          }} />
          <ChatWidget />
        </ErrorBoundary>
      );
    }
    return (
      <ErrorBoundary>
        <SplashScreen show={showSplash} onHide={() => setShowSplash(false)} />
        <AuthPage />
        <ChatWidget />
      </ErrorBoundary>
    );
  }

  // User is logged in, show appropriate view
  // CountryCheckMiddleware will verify country is set - if not, shows mandatory modal
  if (isMobile) {
    console.log('📱 Rendering mobile view (with country check)');
    return (
      <ErrorBoundary>
        <SplashScreen show={showSplash} onHide={() => setShowSplash(false)} />
        <ActionQueue />
        <CountryCheckMiddleware>
          <MobileView userProfile={user} />
        </CountryCheckMiddleware>
        <ChatWidget hasBottomNav />
      </ErrorBoundary>
    );
  }

  // User is logged in, show main app (desktop) with country check
  console.log('🖥️ Rendering desktop view (with country check)');
  return (
    <ErrorBoundary>
      <SplashScreen show={showSplash} onHide={() => setShowSplash(false)} />
      <ActionQueue />
      <CountryCheckMiddleware>
        <ICANCapitalEngine />
      </CountryCheckMiddleware>
      <ChatWidget />
    </ErrorBoundary>
  );
};

export default App;
