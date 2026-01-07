import React, { useState } from 'react';
import SignUp from './SignUp';
import SignIn from './SignIn';
import ForgotPassword from './ForgotPassword';

const AuthPage = ({ onAuthSuccess }) => {
  const [view, setView] = useState('signin'); // 'signin', 'signup', 'forgot-password'

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

  return (
    <SignIn
      onSwitchToSignUp={() => setView('signup')}
      onForgotPassword={() => setView('forgot-password')}
      onSuccess={handleAuthSuccess}
    />
  );
};

export default AuthPage;
