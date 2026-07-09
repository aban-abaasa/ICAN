import React, { useState, useEffect, useRef } from 'react';
import { X, Lock, Clock, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase/client';

/**
 * 🔐 PIN RECOVERY MODAL
 *
 * Appears when an account is locked (too many failed PIN attempts) or the
 * user has forgotten their PIN. Submits a request and waits for a developer
 * to review and resolve it from the dev panel — there is no self-service
 * unlock here by design, so a locked account can't just unlock itself.
 *
 * Pass groupId/groupName when this is for a shared group wallet PIN rather
 * than the caller's own personal/business account.
 */
const PINRecoveryModal = ({ isOpen, onClose, userId, userEmail, groupId = null, groupName = null }) => {
  const [requestType, setRequestType] = useState('pin_reset'); // 'pin_reset' | 'account_unlock'
  const [reason, setReason] = useState('');
  const [step, setStep] = useState('request'); // 'request', 'pending', 'resolved'
  const [requestId, setRequestId] = useState(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [resolvedStatus, setResolvedStatus] = useState(null); // 'completed' | 'rejected'
  const [newPin, setNewPin] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const pollRef = useRef(null);

  useEffect(() => {
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  if (!isOpen) return null;

  const pollStatus = (id) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
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
    }, 5000);
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
        ...(groupId ? { p_group_id: groupId } : {})
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

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-2000 p-4">
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

        {/* Step 1: Submit a request */}
        {step === 'request' && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">
                This goes straight to a developer for review — there's no instant self-unlock.
                Submit your request below and check back here for the outcome.
              </p>
            </div>

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
          </div>
        )}
      </div>
    </div>
  );
};

export default PINRecoveryModal;
