import React, { useState } from 'react';
import { CheckCircle, AlertCircle, Loader2, ArrowLeft, KeyRound } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase/client';
import { hashPIN } from '../services/walletAccountService';

/**
 * Landing page for self-service wallet PIN recovery. New links use Supabase
 * Auth's recovery session and an account-scoped RPC. Older emailed token
 * links remain supported through redeem_pin_reset_token().
 */
const ResetPinPage = ({ onDone }) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Read the link's params once: the URL is cleaned right after a successful
  // reset, so re-reading it on re-render would change the page's wording.
  const [{ token, accountType, accountId, isSetup }] = useState(() => {
    const query = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const type = query.get('accountType') === 'business' ? 'business' : 'personal';
    return {
      token: query.get('token') || '',
      accountType: type,
      accountId: type === 'business' ? query.get('accountId') || null : null,
      // Links emailed during wallet creation carry purpose=setup: same
      // recovery flow, but the copy talks about setting a first PIN.
      isSetup: query.get('purpose') === 'setup'
    };
  });
  const [signedIn, setSignedIn] = useState(false);

  // Leave the recovery URL behind so a refresh opens the app instead of
  // showing this PIN form again.
  const clearRecoveryUrl = () => {
    if (typeof window !== 'undefined'
      && (window.location.pathname === '/reset-pin' || new URLSearchParams(window.location.search).get('flow') === 'pin')) {
      window.history.replaceState({}, '', '/');
    }
  };

  const handleBack = () => {
    clearRecoveryUrl();
    onDone?.();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!/^\d{4,6}$/.test(pin)) {
      setError('PIN must be 4-6 digits');
      return;
    }
    if (pin !== confirmPin) {
      setError('PINs do not match');
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      if (!supabase) throw new Error('Supabase is not initialized. Please refresh and try again.');

      let data;
      let err;
      let recoveryUserId = null;
      if (token) {
        ({ data, error: err } = await supabase.rpc('redeem_pin_reset_token', {
          p_token: token,
          p_new_pin_hash: hashPIN(pin)
        }));
      } else {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData?.session?.user) {
          throw new Error('This recovery link is invalid or expired. Request a new PIN reset email.');
        }
        recoveryUserId = sessionData.session.user.id;
        if (accountType === 'business' && accountId) {
          // iCanEra business wallet: the PIN is per business profile and
          // stored bcrypt-hashed server-side, so the raw PIN goes over TLS.
          ({ data, error: err } = await supabase.rpc('reset_business_wallet_pin_from_recovery', {
            p_business_profile_id: accountId,
            p_new_pin: pin
          }));
        } else {
          ({ data, error: err } = await supabase.rpc('reset_wallet_pin_from_recovery', {
            p_account_type: accountType,
            p_new_pin_hash: hashPIN(pin)
          }));
        }
      }

      if (err) throw err;

      const row = Array.isArray(data) ? data[0] : data;
      if (row?.success) {
        if (typeof window !== 'undefined') sessionStorage.removeItem('ican-pin-recovery-session');
        // First-time PIN from wallet creation: record when it was created, as
        // the in-app "Create Account" form does. Best effort — the PIN is
        // already saved.
        if (isSetup && accountType === 'personal' && recoveryUserId) {
          await supabase
            .from('user_accounts')
            .update({ pin_created_at: new Date().toISOString() })
            .eq('user_id', recoveryUserId)
            .eq('account_type', 'personal')
            .is('pin_created_at', null)
            .then(() => {}, () => {});
        }
        clearRecoveryUrl();
        const { data: after } = await supabase.auth.getSession();
        setSignedIn(!!after?.session?.user);
        setSuccess(true);
      } else {
        setError(row?.message || 'This reset link is invalid or has expired.');
      }
    } catch (err) {
      setError(err.message || 'Failed to reset PIN. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
        <div className="glass-card p-8 max-w-md w-full text-center">
          <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <CheckCircle className="w-8 h-8 text-green-400" />
          </div>
          <h2 className="text-2xl font-bold text-white mb-2">{isSetup ? 'PIN Set' : 'PIN Reset'}</h2>
          <p className="text-gray-400 mb-6">
            {isSetup
              ? 'Your wallet PIN is set and your wallet is ready. Sign in and use your new PIN.'
              : 'Your wallet PIN has been reset. Sign in and use your new PIN.'}
          </p>
          <button
            onClick={handleBack}
            className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
          >
            {signedIn ? 'Continue to Wallet' : 'Continue to Sign In'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4">
      <div className="glass-card p-8 max-w-md w-full">
        <button
          onClick={handleBack}
          className="flex items-center gap-2 text-gray-400 hover:text-white mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Sign In
        </button>

        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-r from-purple-600 to-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <KeyRound className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">{isSetup ? 'Set Your PIN' : 'Reset Your PIN'}</h1>
          <p className="text-gray-400">
            {isSetup ? `Choose a PIN for your new ${accountType} wallet` : `Choose a new PIN for your ${accountType} wallet`}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">New PIN</label>
            <input
              type="password"
              inputMode="numeric"
              value={pin}
              onChange={(e) => {
                setPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                setError('');
              }}
              placeholder="4-6 digits"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all tracking-[0.3em]"
              autoComplete="new-password"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Confirm New PIN</label>
            <input
              type="password"
              inputMode="numeric"
              value={confirmPin}
              onChange={(e) => {
                setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6));
                setError('');
              }}
              placeholder="Re-enter new PIN"
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all tracking-[0.3em]"
              autoComplete="new-password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                {isSetup ? 'Setting PIN...' : 'Resetting PIN...'}
              </>
            ) : (
              isSetup ? 'Set PIN' : 'Reset PIN'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPinPage;
