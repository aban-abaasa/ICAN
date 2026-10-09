/**
 * 🌍 Country Check Middleware
 * Runs on app initialization and after login
 * Forces country selection if not already set (unless offline)
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase/client';
import icanCoinService from '../../services/icanCoinService';
import CountrySetup from './CountrySetup';

// How long the country lookup may hold the loading screen. On a slow mobile connection
// the request can stall (e.g. waiting on a token refresh) and never settle.
const COUNTRY_CHECK_TIMEOUT_MS = 6000;

const countryCacheKey = (userId) => `ican_country_set_${userId}`;

const readCountryCache = (userId) => {
  try { return localStorage.getItem(countryCacheKey(userId)) === '1'; } catch (_) { return false; }
};

const writeCountryCache = (userId) => {
  try { localStorage.setItem(countryCacheKey(userId), '1'); } catch (_) { /* storage unavailable */ }
};

const withTimeout = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`Country check timed out after ${ms}ms`)), ms);
  Promise.resolve(promise).then(
    (value) => { clearTimeout(timer); resolve(value); },
    (error) => { clearTimeout(timer); reject(error); },
  );
});

export default function CountryCheckMiddleware({ children }) {
  const { user, loading: authLoading, isOfflineMode } = useAuth();
  const [countrySet, setCountrySet] = useState(null);
  const [checking, setChecking] = useState(true);
  const [showCountrySetup, setShowCountrySetup] = useState(false);

  // Check if user has country set
  useEffect(() => {
    if (authLoading) return undefined;

    // Nobody signed in: nothing to check, let the children (login/signup) render.
    if (!user?.id) {
      console.log('🔐 No user authenticated yet');
      setCountrySet(null);
      setShowCountrySetup(false);
      setChecking(false);
      return undefined;
    }

    let cancelled = false;

    const checkCountryStatus = async () => {
      // A country already confirmed on this device lets the app open straight away;
      // the lookup below still runs and can pull the user back to setup if it is gone.
      if (readCountryCache(user.id)) {
        setCountrySet(true);
        setShowCountrySetup(false);
        setChecking(false);
      } else {
        setChecking(true);
      }

      try {
        // 📴 OFFLINE MODE: Skip country check when offline
        // User can set country later when back online
        if (!navigator.onLine || isOfflineMode) {
          console.log('📴 User offline - skipping country check. Allowing app access.');
          console.log('💡 User can set country later when back online.');
          setCountrySet(true);
          setShowCountrySetup(false);
          return;
        }

        console.log('🔍 Checking country for user:', user.id);

        // Get user's country from database
        // Check user_accounts table (where ICAN wallets are managed)
        const { data, error } = await withTimeout(
          supabase
            .from('user_accounts')
            .select('country_code, id, user_id')
            .eq('user_id', user.id)
            .limit(1)
            .maybeSingle(),
          COUNTRY_CHECK_TIMEOUT_MS,
        );
        if (cancelled) return;

        console.log('📊 Query result:', { data, error });

        if (error) {
          // The lookup failed, which says nothing about whether a country is set.
          // Don't lock the user into the mandatory setup over a failed request.
          console.error('❌ Error checking country from user_accounts:', error);
          console.warn('⚠️ Country check failed - allowing app access, will re-check next load');
          setCountrySet(true);
          setShowCountrySetup(false);
          return;
        }

        if (!data) {
          console.warn('⚠️ user_accounts record is null - showing country setup');
          setCountrySet(false);
          setShowCountrySetup(true);
          return;
        }

        // STRICT CHECK: country_code MUST be set (not null, not empty, not undefined)
        const hasCountry = data.country_code && data.country_code.trim().length > 0;

        if (!hasCountry) {
          console.log('🌍 User has NO country set - BLOCKING - showing CountrySetup modal');
          setCountrySet(false);
          setShowCountrySetup(true);
        } else {
          console.log('✅ User country is SET:', data.country_code, '- ALLOWING app access');
          writeCountryCache(user.id);
          setCountrySet(true);
          setShowCountrySetup(false);
        }
      } catch (error) {
        if (cancelled) return;
        // Timeout or network failure: same as above, don't hold the app hostage.
        console.warn('⚠️ Country check slow or failed - allowing app access:', error?.message || error);
        setCountrySet(true);
        setShowCountrySetup(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    };

    checkCountryStatus();

    return () => { cancelled = true; };
  }, [user?.id, authLoading, isOfflineMode]);

  // Still checking authentication and country
  if (authLoading || checking) {
    return (
      <div className="country-check-loading">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading your account...</p>
        </div>
      </div>
    );
  }

  // User not authenticated - show children (login/signup pages)
  if (!user?.id) {
    return children;
  }

  // User authenticated but no country set - show MANDATORY setup (cannot close)
  if (showCountrySetup) {
    return (
      <CountrySetup
        isModal={true}
        isMandatory={true}
        onCountrySet={(countryCode) => {
          console.log('✅ Country set successfully:', countryCode);
          setCountrySet(true);
          setShowCountrySetup(false);
          // Reload to refresh all components with new country
          window.location.reload();
        }}
      />
    );
  }

  // User authenticated and country set - show app
  return children;
}

// Inline styles
const style = document.createElement('style');
style.textContent = `
  .country-check-loading {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  }

  .loading-spinner {
    text-align: center;
    color: white;
  }

  .spinner {
    width: 50px;
    height: 50px;
    border: 4px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
    margin: 0 auto 20px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .loading-spinner p {
    font-size: 16px;
    margin: 0;
  }
`;
document.head.appendChild(style);
