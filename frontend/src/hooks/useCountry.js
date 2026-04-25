/**
 * 🌍 useCountry Hook
 * Check if user has selected a country and manage country state
 * Works for both new and existing users
 */

import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase/client';
import icanCoinService from '../services/icanCoinService';
import { CountryService } from '../services/countryService';

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
      const normalizedCountryCode = String(countryCode || '').trim().toUpperCase();
      if (!normalizedCountryCode) throw new Error('Country code is required');

      const preferredCurrency = CountryService.getCurrencyCode(normalizedCountryCode);

      const { data: updatedRows, error: updateError } = await supabase
        .from('user_accounts')
        .update({
          country_code: normalizedCountryCode,
          preferred_currency: preferredCurrency,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', user.id)
        .select('id');

      if (updateError) throw updateError;

      // If account row does not exist yet, create it so country setup can complete.
      if (!updatedRows || updatedRows.length === 0) {
        const accountNumber = `ICAN-${Date.now()}-${Math.floor(Math.random() * 1000000)
          .toString()
          .padStart(6, '0')}`;

        const { error: insertError } = await supabase
          .from('user_accounts')
          .insert([{
            user_id: user.id,
            account_number: accountNumber,
            account_type: 'personal',
            status: 'active',
            account_holder_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'ICAN User',
            email: user.email || null,
            country_code: normalizedCountryCode,
            preferred_currency: preferredCurrency
          }]);

        if (insertError) throw insertError;
      }

      setCountry(normalizedCountryCode);
      setIsCountrySet(true);
      return { success: true, country: normalizedCountryCode };
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
