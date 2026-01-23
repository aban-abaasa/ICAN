import React, { useState } from 'react';
import { useAuth } from './context/AuthContext';
import { AuthPage } from './components/auth';
import ICANCapitalEngine from './components/ICAN_Capital_Engine';
import LandingPage from './components/LandingPage';
import { Loader2 } from 'lucide-react';

const App = () => {
  const { user, loading } = useAuth();
  const [showLanding, setShowLanding] = useState(!user); // Show landing by default when not logged in

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

  // If user is not logged in
  if (!user) {
    if (showLanding) {
      return <LandingPage onGetStarted={() => setShowLanding(false)} />;
    }
    return <AuthPage />;
  }

  // User is logged in, show main app
  return <ICANCapitalEngine />;
};

export default App;
