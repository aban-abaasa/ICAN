/**
 * 🌍 Country Check Middleware
 * Runs on app initialization and after login
 * Forces country selection if not already set
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase/client';
import icanCoinService from '../../services/icanCoinService';
import CountrySetup from './CountrySetup';

export default function CountryCheckMiddleware({ children }) {
  const { user, loading: authLoading } = useAuth();
  const [countrySet, setCountrySet] = useState(null);
  const [checking, setChecking] = useState(true);
  const [showCountrySetup, setShowCountrySetup] = useState(false);

  // Check if user has country set
  useEffect(() => {
    const checkCountryStatus = async () => {
      try {
        setChecking(true);

        // Only check if user is authenticated
        if (!user?.id) {
          console.log('🔐 No user authenticated yet');
          setCountrySet(null);
          setShowCountrySetup(false);
          setChecking(false);
          return;
        }

        console.log('🔍 Checking country for user:', user.id);

        // Get user's country from database
        // Check user_accounts table (where ICAN wallets are managed)
        const { data, error } = await supabase
          .from('user_accounts')
          .select('country_code, id, user_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        console.log('📊 Query result:', { data, error });

        if (error) {
          console.error('❌ Error checking country from user_accounts:', error);
          console.warn('⚠️ Could not find user_accounts record - showing country setup');
          setCountrySet(false);
          setShowCountrySetup(true);
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
          setCountrySet(true);
          setShowCountrySetup(false);
        }
      } catch (error) {
        console.error('❌ Error during country check:', error);
        console.warn('⚠️ Exception occurred - showing country setup as safety measure');
        setCountrySet(false);
        setShowCountrySetup(true);
      } finally {
        setChecking(false);
      }
    };

    if (!authLoading && user?.id) {
      checkCountryStatus();
    }
  }, [user?.id, authLoading]);

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
