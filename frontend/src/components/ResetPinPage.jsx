import React, { useState } from 'react';
import { CheckCircle, AlertCircle, Loader2, ArrowLeft, KeyRound } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase/client';
import { hashPIN } from '../services/walletAccountService';

/**
 * Landing page for the self-service "reset my wallet PIN" email link
 * (see backend/routes/emailRoutes.js POST /request-pin-reset and
 * backend/PIN_RESET_EMAIL_SELFSERVICE.sql). Mirrors ResetPassword.jsx's
 * shape but redeems a one-time token via redeem_pin_reset_token() instead
 * of going through Supabase Auth's recovery session.
 */
const ResetPinPage = ({ onDone }) => {
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const token = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token') || ''
    : '';

  const handleBack = () => {
    if (window.location.pathname === '/reset-pin') {
      window.history.replaceState({}, '', '/');
    }
    onDone?.();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('This link is missing its token. Open the reset link from your email again.');
      return;
    }
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
      const { data, error: err } = await supabase.rpc('redeem_pin_reset_token', {
        p_token: token,
        p_new_pin_hash: hashPIN(pin)
      });

      if (err) throw err;

      const row = Array.isArray(data) ? data[0] : data;
      if (row?.success) {
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
          <h2 className="text-2xl font-bold text-white mb-2">PIN Reset</h2>
          <p className="text-gray-400 mb-6">Your wallet PIN has been reset. Sign in and use your new PIN.</p>
          <button
            onClick={handleBack}
            className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
          >
            Continue to Sign In
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
          <h1 className="text-3xl font-bold text-white mb-2">Reset Your PIN</h1>
          <p className="text-gray-400">Choose a new PIN for your wallet</p>
        </div>

        {(error || !token) && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-red-400 text-sm">
              {error || 'This link is missing its token. Open the reset link from your email again.'}
            </p>
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
            disabled={loading || !token}
            className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                Resetting PIN...
              </>
            ) : (
              'Reset PIN'
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default ResetPinPage;
