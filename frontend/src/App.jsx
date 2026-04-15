import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from './context/AuthContext';
import { AuthPage } from './components/auth';
import CountryCheckMiddleware from './components/auth/CountryCheckMiddleware';
import ICANCapitalEngine from './components/ICAN_Capital_Engine';
import LandingPage from './components/LandingPage';
import MobileView from './components/MobileView';
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
  const [isMobile, setIsMobile] = useState(() => {
    // Safe check for window object (SSR compatibility)
    if (typeof window !== 'undefined') {
      return window.innerWidth < 768;
    }
    return false;
  });
  const [appError, setAppError] = useState(null);
  const isRestoringAppHistoryRef = useRef(false);
  const lastPublicViewRef = useRef(null);

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
    if (user || isRecoveryMode || isResetPasswordPath) return;

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
  }, [user, showLanding, isRecoveryMode, isResetPasswordPath]);

  useEffect(() => {
    const handlePopState = (event) => {
      if (user || isRecoveryMode || isResetPasswordPath) return;

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
  }, [user, isRecoveryMode, isResetPasswordPath]);

  const handleRecoveryHandled = () => {
    clearRecoveryMode();
    setShowLanding(false);

    if (window.location.pathname === '/reset-password') {
      window.history.replaceState({}, '', '/');
    }

    setIsResetPasswordPath(false);
  };

  // Show loading screen while checking auth status
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-purple-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-400">Loading ICAN...</p>
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
        <AuthPage
          initialView="reset-password"
          onRecoveryHandled={handleRecoveryHandled}
        />
      </ErrorBoundary>
    );
  }

  if (!user) {
    if (showLanding) {
      return (
        <ErrorBoundary>
          <LandingPage onGetStarted={() => setShowLanding(false)} />
        </ErrorBoundary>
      );
    }
    return (
      <ErrorBoundary>
        <AuthPage />
      </ErrorBoundary>
    );
  }

  // User is logged in, show appropriate view
  // CountryCheckMiddleware will verify country is set - if not, shows mandatory modal
  if (isMobile) {
    console.log('📱 Rendering mobile view (with country check)');
    return (
      <ErrorBoundary>
        <CountryCheckMiddleware>
          <MobileView userProfile={user} />
        </CountryCheckMiddleware>
      </ErrorBoundary>
    );
  }

  // User is logged in, show main app (desktop) with country check
  console.log('🖥️ Rendering desktop view (with country check)');
  return (
    <ErrorBoundary>
      <CountryCheckMiddleware>
        <ICANCapitalEngine />
      </CountryCheckMiddleware>
    </ErrorBoundary>
  );
};

export default App;
