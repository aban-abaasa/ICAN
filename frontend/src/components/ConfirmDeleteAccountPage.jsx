import React, { useState } from 'react';
import { AlertTriangle, CheckCircle, Loader2, ArrowLeft, Trash2 } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase/client';

/**
 * Landing page for the self-service "delete my account" email link (see
 * backend/routes/emailRoutes.js POST /api/email/request-account-deletion and
 * backend/DELETE_ACCOUNT_EMAIL_SELFSERVICE.sql). Mirrors ResetPinPage.jsx's
 * shape but redeems the one-time token via the delete-account edge function,
 * which is where the account is actually deleted.
 */
const ConfirmDeleteAccountPage = ({ onDone }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const token = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('token') || ''
    : '';

  const handleBack = () => {
    if (window.location.pathname === '/confirm-delete-account') {
      window.history.replaceState({}, '', '/');
    }
    onDone?.();
  };

  const handleConfirm = async () => {
    setError('');

    if (!token) {
      setError('This link is missing its token. Open the deletion link from your email again.');
      return;
    }

    setLoading(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error: err } = await supabase.functions.invoke('delete-account', {
        body: { token }
      });

      if (err) {
        let message = err.message || 'Failed to delete account.';
        const context = err.context;
        if (context) {
          try {
            if (typeof context.json === 'function') {
              const details = await context.json();
              if (details?.message) message = details.message;
            } else if (typeof context.text === 'function') {
              const rawText = await context.text();
              try {
                const parsed = JSON.parse(rawText);
                if (parsed?.message) message = parsed.message;
                else if (rawText) message = rawText;
              } catch {
                if (rawText) message = rawText;
              }
            }
          } catch {
            // fall back to the generic message above
          }
        }
        throw new Error(message);
      }

      if (!data?.success) {
        throw new Error(data?.message || 'This deletion link is invalid or has expired.');
      }

      setSuccess(true);
      await supabase.auth.signOut();
    } catch (err) {
      setError(err.message || 'Failed to delete account. Please try again.');
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
          <h2 className="text-2xl font-bold text-white mb-2">Account Deleted</h2>
          <p className="text-gray-400 mb-6">Your account has been permanently deleted.</p>
          <button
            onClick={handleBack}
            className="w-full py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white font-semibold rounded-lg hover:from-purple-700 hover:to-blue-700 transition-all"
          >
            Back to Sign In
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
          <div className="w-16 h-16 bg-gradient-to-r from-red-600 to-red-700 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Trash2 className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Delete Your Account</h1>
          <p className="text-gray-400">This will permanently delete your account and all its data. This cannot be undone.</p>
        </div>

        {(error || !token) && (
          <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-red-400 text-sm">
              {error || 'This link is missing its token. Open the deletion link from your email again.'}
            </p>
          </div>
        )}

        <button
          onClick={handleConfirm}
          disabled={loading || !token}
          className="w-full py-3 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Deleting Account...
            </>
          ) : (
            'Permanently Delete My Account'
          )}
        </button>
      </div>
    </div>
  );
};

export default ConfirmDeleteAccountPage;
