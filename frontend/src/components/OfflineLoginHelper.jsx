/**
 * OfflineLoginHelper - Shows cached sessions for quick offline login
 * Like WhatsApp showing recent accounts
 */

import React, { useState, useEffect } from 'react';

const OfflineLoginHelper = ({ onOfflineLogin, onOnlineLogin }) => {
  const [cachedSessions, setCachedSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showCached, setShowCached] = useState(false);

  useEffect(() => {
    // Load cached sessions from offline auth manager
    const loadCachedSessions = async () => {
      try {
        const { offlineAuthManager } = await import('../lib/offlineAuthManager');
        const sessions = await offlineAuthManager.getAllCachedSessions();
        setCachedSessions(sessions);
        setShowCached(sessions.length > 0);
      } catch (error) {
        console.error('Failed to load cached sessions:', error);
      }
    };

    loadCachedSessions();
  }, []);

  const handleCachedSessionClick = async (session) => {
    setLoading(true);
    try {
      // Try to login with offline cache
      const result = await onOfflineLogin(session.email);
      console.log('✅ Offline login successful:', session.email);
    } catch (error) {
      console.error('❌ Offline login failed:', error);
    } finally {
      setLoading(false);
    }
  };

  if (!showCached || cachedSessions.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 p-4 bg-slate-800 rounded-lg border border-slate-700">
      <div className="text-sm text-gray-400 mb-3 font-semibold">
        📱 Quick Login (Offline Sessions)
      </div>

      <div className="space-y-2">
        {cachedSessions.map((session) => (
          <button
            key={session.email}
            onClick={() => handleCachedSessionClick(session)}
            disabled={loading}
            className="w-full p-3 text-left bg-slate-700 hover:bg-slate-600 rounded-lg transition disabled:opacity-50 flex items-center justify-between"
          >
            <div>
              <div className="text-sm font-medium text-white">
                {session.email}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                Last used: {new Date(session.lastUsed).toLocaleDateString()}
              </div>
            </div>
            <div className="text-2xl">👤</div>
          </button>
        ))}
      </div>

      <div className="mt-3 text-xs text-gray-500 text-center">
        💡 These sessions work even offline
      </div>

      {!navigator.onLine && (
        <div className="mt-3 p-2 bg-orange-900 border border-orange-700 rounded text-orange-200 text-xs flex items-start gap-2">
          <span>📴</span>
          <span>You're offline. Log in with a cached session or connect to the internet.</span>
        </div>
      )}
    </div>
  );
};

export default OfflineLoginHelper;
