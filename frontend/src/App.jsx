import React, { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { AuthPage } from './components/auth';
import ICANCapitalEngine from './components/ICAN_Capital_Engine';
import LandingPage from './components/LandingPage';
import MobileView from './components/MobileView';
import { Loader2 } from 'lucide-react';

const App = () => {
  const { user, loading } = useAuth();
  const [showLanding, setShowLanding] = useState(!user); // Show landing by default when not logged in
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

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

  // User is logged in, show appropriate view
  if (isMobile) {
    return <MobileView userProfile={user} />;
  }

  // User is logged in, show main app (desktop)
  return <ICANCapitalEngine />;
};

export default App;
