/**
 * 🌍 useCountry Hook
 * Check if user has selected a country and manage country state
 * Works for both new and existing users
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase/client';
import icanCoinService from '../services/icanCoinService';

export const useCountry = () => {
  const { user } = useAuth();
  const [country, setCountry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isCountrySet, setIsCountrySet] = useState(false);

  useEffect(() => {
    const fetchCountry = async () => {
      try {
        if (!user?.id) {
          setLoading(false);
          return;
        }

        // Get user's country from database
        const userCountry = await icanCoinService.getUserCountry(user.id);
        setCountry(userCountry);

        // Check in Supabase if country was explicitly set (not null)
        const { data } = await supabase
          .from('user_accounts')
          .select('country_code')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle();

        // Country is set if it exists in DB and is not null
        if (data?.country_code && data.country_code !== null) {
          setIsCountrySet(true);
        } else {
          setIsCountrySet(false);
        }

        setError(null);
      } catch (err) {
        console.error('Failed to fetch country:', err);
        setError(err.message);
        setIsCountrySet(false);
      } finally {
        setLoading(false);
      }
    };

    fetchCountry();
  }, [user?.id]);

  /**
   * Check if country is set
   * Returns true only if user has explicitly set a country
   */
  const hasCountry = () => {
    return isCountrySet && country && country !== null;
  };

  /**
   * Update user's country
   */
  const updateCountry = async (countryCode) => {
    try {
      if (!user?.id) throw new Error('User not authenticated');

      const { error: updateError } = await supabase
        .from('user_accounts')
        .update({ country_code: countryCode })
        .eq('user_id', user.id);

      if (updateError) throw updateError;

      setCountry(countryCode);
      setIsCountrySet(true);
      return { success: true, country: countryCode };
    } catch (err) {
      console.error('Failed to update country:', err);
      return { success: false, error: err.message };
    }
  };

  return {
    country,
    loading,
    error,
    hasCountry,
    isCountrySet,
    updateCountry
  };
};

export default useCountry;
