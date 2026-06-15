import React, { useEffect, useRef, useState } from 'react';
import SignUp from './SignUp';
import SignIn from './SignIn';
import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';

const ALLOWED_VIEWS = ['signin', 'signup', 'forgot-password', 'reset-password'];

const getSafeView = (view) => (ALLOWED_VIEWS.includes(view) ? view : 'signin');

const AuthPage = ({ onAuthSuccess, initialView = 'signin', onRecoveryHandled }) => {
  const [view, setView] = useState(getSafeView(initialView));
  const isRestoringAuthHistoryRef = useRef(false);
  const lastAuthViewRef = useRef(null);

  useEffect(() => {
    setView(getSafeView(initialView));
  }, [initialView]);

  useEffect(() => {
    if (!isRestoringAuthHistoryRef.current && lastAuthViewRef.current !== view) {
      const nextState = {
        ...(window.history.state || {}),
        __icanAuth: { view }
      };

      if (lastAuthViewRef.current === null) {
        window.history.replaceState(nextState, '', window.location.href);
      } else {
        window.history.pushState(nextState, '', window.location.href);
      }
    }

    lastAuthViewRef.current = view;
  }, [view]);

  useEffect(() => {
    const handlePopState = (event) => {
      const nextView = event.state?.__icanAuth?.view;
      if (ALLOWED_VIEWS.includes(nextView)) {
        isRestoringAuthHistoryRef.current = true;
        setView(nextView);
        lastAuthViewRef.current = nextView;
        window.setTimeout(() => {
          isRestoringAuthHistoryRef.current = false;
        }, 0);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleAuthSuccess = () => {
    if (onAuthSuccess) {
      onAuthSuccess();
    }
  };

  if (view === 'signup') {
    return (
      <SignUp
        onSwitchToSignIn={() => setView('signin')}
        onSuccess={handleAuthSuccess}
      />
    );
  }

  if (view === 'forgot-password') {
    return (
      <ForgotPassword
        onBack={() => setView('signin')}
      />
    );
  }

  if (view === 'reset-password') {
    return (
      <ResetPassword
        onBackToSignIn={() => {
          setView('signin');
          onRecoveryHandled?.();
        }}
      />
    );
  }

  return (
    <SignIn
      onSwitchToSignUp={() => setView('signup')}
      onForgotPassword={() => setView('forgot-password')}
      onSuccess={handleAuthSuccess}
    />
  );
};

export default AuthPage;
