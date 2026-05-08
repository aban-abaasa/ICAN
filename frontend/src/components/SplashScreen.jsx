import React, { useEffect, useState } from 'react';
import { Loader } from 'lucide-react';

/**
 * Splash Screen
 * Shows briefly during app loading/transitions
 * Auto-hides after duration
 */

export function SplashScreen({ duration = 2000, show = true, onHide }) {
  const [visible, setVisible] = useState(show);

  useEffect(() => {
    if (!show) {
      setVisible(false);
      return;
    }

    setVisible(true);
    const timer = setTimeout(() => {
      setVisible(false);
      onHide?.();
    }, duration);

    return () => clearTimeout(timer);
  }, [show, duration, onHide]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 -left-4 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
        <div className="absolute top-0 -right-4 w-72 h-72 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-20 w-72 h-72 bg-pink-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>

      {/* Content */}
      <div className="relative z-10 text-center space-y-4">
        {/* Logo/Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-24 h-24 bg-gradient-to-br from-purple-400 to-purple-600 rounded-3xl flex items-center justify-center shadow-2xl animate-pulse">
            <span className="text-5xl">💼</span>
          </div>
        </div>

        {/* Text */}
        <h1 className="text-4xl font-bold text-white drop-shadow-lg">
          IcanEra
        </h1>
        <p className="text-purple-200 text-lg drop-shadow-md">
          Business Management Platform
        </p>

        {/* Loading Spinner */}
        <div className="flex justify-center mt-8">
          <Loader className="w-8 h-8 text-purple-400 animate-spin" />
        </div>

        {/* Status Text */}
        <p className="text-purple-300 text-sm mt-6">
          Loading your financial universe...
        </p>
      </div>

      <style>{`
        @keyframes blob {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          33% {
            transform: translate(30px, -50px) scale(1.1);
          }
          66% {
            transform: translate(-20px, 20px) scale(0.9);
          }
        }

        .animate-blob {
          animation: blob 7s infinite;
        }

        .animation-delay-2000 {
          animation-delay: 2s;
        }

        .animation-delay-4000 {
          animation-delay: 4s;
        }
      `}</style>
    </div>
  );
}

export default SplashScreen;
