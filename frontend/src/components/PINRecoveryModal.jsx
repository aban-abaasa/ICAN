import React, { useState, useEffect, useRef } from 'react';
import { X, Lock, Clock, CheckCircle, XCircle, AlertCircle, Mail } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase/client';

/**
 * 🔐 PIN RECOVERY MODAL
 *
 * Appears when an account is locked (too many failed PIN attempts) or the
 * user has forgotten their PIN. For a personal/business account (no
 * groupId), offers two alternative paths:
 *  - "Email me a reset link" — self-service, mirrors the sign-in page's
 *    Forgot Password. Backend generates a one-time token and emails it
 *    (POST /api/email/request-pin-reset); the emailed link lands on
 *    ResetPinPage, which redeems it via the redeem_pin_reset_token() RPC
 *    (see backend/PIN_RESET_EMAIL_SELFSERVICE.sql).
 *  - "Request developer review" — the original flow: submits a request and
 *    waits for a developer to resolve it from the dev panel.
 * Group wallet PINs (groupId set) only offer the developer-review path,
 * since a shared PIN's recovery shouldn't be a single member's call.
 */
const PINRecoveryModal = ({ isOpen, onClose, userId, userEmail, groupId = null, groupName = null }) => {
  const [requestType, setRequestType] = useState('pin_reset'); // 'pin_reset' | 'account_unlock'
  const [reason, setReason] = useState('');
  const [step, setStep] = useState(groupId ? 'request' : 'choose'); // 'choose', 'request', 'pending', 'resolved', 'email_request', 'email_sent'
  const [requestId, setRequestId] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [resolvedStatus, setResolvedStatus] = useState(null); // 'completed' | 'rejected'
  const [newPin, setNewPin] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [emailSentTo, setEmailSentTo] = useState(null);
  const [accountType, setAccountType] = useState('personal'); // 'personal' | 'business' — ignored for group wallets
  const pollRef = useRef(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  useEffect(() => {
    if (!isOpen || !userId) return undefined;

    let cancelled = false;
    const restoreRequest = async () => {
      try {
        const supabase = getSupabaseClient();
        let query = supabase
          .from('account_unlock_requests')
          .select('id, status, resolved_pin_plain, request_type, created_at')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(1);
        if (groupId) query = query.eq('group_id', groupId);
        else query = query.is('group_id', null);
        const { data, error: err } = await query;
        const row = data?.[0];
        if (cancelled || err || !row) return;

        setRequestId(row.id);
        if (row.status === 'completed' || row.status === 'rejected') {
          setResolvedStatus(row.status);
          setNewPin(row.resolved_pin_plain || null);
          setStatusMessage(row.status === 'completed' ? 'Resolved — try again now.' : 'This request was rejected.');
          setStep('resolved');
        } else if (row.status === 'pending') {
          setStep('pending');
          pollStatus(row.id);
        }
      } catch {
        // The request form remains available if the status lookup fails.
      }
    };

    restoreRequest();
    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current); };
  }, [isOpen, userId, groupId]);

  if (!isOpen) return null;

  const pollStatus = (id) => {
    if (pollRef.current) clearInterval(pollRef.current);
    const check = async () => {
      try {
        const supabase = getSupabaseClient();
        const { data, error: err } = await supabase.rpc('get_unlock_request_status', {
          p_request_id: id
        });
        if (err || !data?.[0]) return;
        const row = data[0];
        if (row.status === 'completed' || row.status === 'rejected') {
          clearInterval(pollRef.current);
          setResolvedStatus(row.status);
          setStatusMessage(row.message);
          setNewPin(row.new_pin || null);
          setStep('resolved');
        }
      } catch {
        // transient — next tick will retry
      }
    };
    check();
    pollRef.current = setInterval(check, 5000);
  };

  const handleSubmitRequest = async () => {
    if (!userId) {
      setError('User ID not found');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      const fullReason = groupId
        ? `Group wallet "${groupName || groupId}" — ${reason || 'no additional details'}`
        : (reason || null);

      const { data, error: err } = await supabase.rpc('request_account_unlock', {
        p_user_id: userId,
        p_request_type: requestType,
        p_reason: fullReason,
        ...(groupId ? { p_group_id: groupId } : { p_account_type: accountType })
      });

      if (err) throw err;

      if (data && data[0]?.success) {
        setRequestId(data[0].request_id);
        setStatusMessage(data[0].message);
        setStep('pending');
        pollStatus(data[0].request_id);
      } else {
        setError(data?.[0]?.message || 'Failed to submit request');
      }
    } catch (err) {
      console.error('Recovery request error:', err);
      setError(err.message || 'Error submitting request');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestEmailReset = async () => {
    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;

      if (!accessToken) {
        throw new Error('Your session expired — please sign in again.');
      }

      const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';
      const response = await fetch(`${backendUrl}/api/email/request-pin-reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ accountType })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to send reset link');
      }

      setEmailSentTo(userEmail);
      setStep('email_sent');
    } catch (err) {
      console.error('Email PIN reset request error:', err);
      setError(err.message || 'Failed to send reset link');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[2000] p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Lock className="text-red-500" size={24} />
            <h2 className="text-xl font-bold">
              {groupId ? 'Group Wallet Locked' : 'Account Recovery'}
            </h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Step 0: Choose a recovery path (personal/business accounts only) */}
        {step === 'choose' && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Which account?</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setAccountType('personal')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    accountType === 'personal'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  Personal (ICAN)
                </button>
                <button
                  type="button"
                  onClick={() => setAccountType('business')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    accountType === 'business'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  Business
                </button>
              </div>
            </div>

            <p className="text-sm text-gray-600">How would you like to recover access?</p>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
                <AlertCircle size={18} className="text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <button
              onClick={handleRequestEmailReset}
              disabled={loading}
              className="w-full text-left bg-blue-50 hover:bg-blue-100 disabled:opacity-50 border border-blue-200 rounded-lg p-4 flex gap-3 transition-colors"
            >
              <Mail className="text-blue-600 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <p className="font-medium text-blue-900">
                  {loading ? 'Sending...' : 'Email me a reset link'}
                </p>
                <p className="text-xs text-blue-700 mt-1">
                  We'll send a one-time link to {userEmail || 'your registered email'} to set a new PIN yourself.
                </p>
              </div>
            </button>

            <button
              onClick={() => { setError(null); setStep('request'); }}
              disabled={loading}
              className="w-full text-left bg-gray-50 hover:bg-gray-100 disabled:opacity-50 border border-gray-200 rounded-lg p-4 flex gap-3 transition-colors"
            >
              <Clock className="text-gray-600 flex-shrink-0 mt-0.5" size={20} />
              <div>
                <p className="font-medium text-gray-900">Request developer review</p>
                <p className="text-xs text-gray-600 mt-1">
                  A developer reviews and resolves your request from the dev panel instead.
                </p>
              </div>
            </button>
          </div>
        )}

        {/* Step: link sent */}
        {step === 'email_sent' && (
          <div className="space-y-4 text-center py-2">
            <div className="flex justify-center">
              <CheckCircle size={48} className="text-green-500" />
            </div>
            <p className="font-semibold text-green-600">Check your email</p>
            <p className="text-sm text-gray-600">
              We've sent a PIN reset link to {emailSentTo || 'your registered email'}. It expires in 30 minutes and works once.
            </p>
            <button
              onClick={onClose}
              className="w-full bg-gray-800 hover:bg-gray-900 text-white font-medium py-2 rounded-lg transition-colors"
            >
              Close
            </button>
            <button
              onClick={() => { setError(null); setStep('choose'); }}
              className="w-full text-sm text-blue-600 hover:text-blue-800"
            >
              Back to recovery options
            </button>
          </div>
        )}

        {/* Step 1: Submit a request */}
        {step === 'request' && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">
                This goes straight to a developer for review — there's no instant self-unlock.
                Submit your request below and check back here for the outcome.
              </p>
            </div>

            {!groupId && (
              <div className="flex items-center justify-between">
                <button
                  onClick={() => { setError(null); setStep('choose'); }}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  ← Back to recovery options
                </button>
                <span className="text-xs text-gray-500">
                  {accountType === 'business' ? 'Business account' : 'Personal (ICAN) account'}
                </span>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
                <AlertCircle size={18} className="text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">What's going on?</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setRequestType('pin_reset')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    requestType === 'pin_reset'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  I forgot my PIN
                </button>
                <button
                  type="button"
                  onClick={() => setRequestType('account_unlock')}
                  className={`px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${
                    requestType === 'account_unlock'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  I know my PIN, just locked
                </button>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Anything else the developer should know? (optional)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. locked myself out trying to remember an old PIN"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-blue-500"
              />
            </div>

            <button
              onClick={handleSubmitRequest}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
            >
              {loading ? 'Submitting...' : 'Submit Request'}
            </button>

            <p className="text-xs text-gray-500 text-center">
              Signed in as {userEmail || 'your account'}
            </p>
          </div>
        )}

        {/* Step 2: Waiting on a developer */}
        {step === 'pending' && (
          <div className="space-y-4 text-center py-2">
            <div className="flex justify-center">
              <Clock size={40} className="text-amber-500 animate-pulse" />
            </div>
            <p className="font-semibold text-gray-800">Request submitted</p>
            <p className="text-sm text-gray-600">{statusMessage}</p>
            <p className="text-xs text-gray-400">This page will update automatically once it's resolved.</p>
          </div>
        )}

        {/* Step 3: Resolved */}
        {step === 'resolved' && (
          <div className="space-y-4 text-center py-2">
            <div className="flex justify-center">
              {resolvedStatus === 'completed'
                ? <CheckCircle size={48} className="text-green-500" />
                : <XCircle size={48} className="text-red-500" />}
            </div>
            <p className={`font-semibold ${resolvedStatus === 'completed' ? 'text-green-600' : 'text-red-600'}`}>
              {resolvedStatus === 'completed' ? 'Request resolved!' : 'Request rejected'}
            </p>
            <p className="text-sm text-gray-600">{statusMessage}</p>
            {resolvedStatus === 'completed' && newPin && (
              <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                <p className="text-xs text-green-700 mb-1">Your new PIN</p>
                <p className="text-3xl font-bold tracking-[0.3em] text-green-800">{newPin}</p>
                <p className="text-xs text-green-700 mt-2">Use this to log in — you can change it afterwards.</p>
              </div>
            )}
            <button
              onClick={onClose}
              className="w-full bg-gray-800 hover:bg-gray-900 text-white font-medium py-2 rounded-lg transition-colors"
            >
              Close
            </button>
            {resolvedStatus === 'completed' && (
              <button
                onClick={() => {
                  setStep(groupId ? 'request' : 'choose');
                  setRequestId(null);
                  setResolvedStatus(null);
                  setNewPin(null);
                  setStatusMessage('');
                }}
                className="w-full text-sm text-blue-600 hover:text-blue-800"
              >
                Start another recovery request
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PINRecoveryModal;
