import React, { useState } from 'react';
import { X, Lock, Mail, CheckCircle, AlertCircle } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase/client';

/**
 * 🔐 PIN RECOVERY MODAL
 * 
 * Appears when account is locked due to failed PIN attempts
 * Allows users to request PIN reset via email
 */
const PINRecoveryModal = ({ isOpen, onClose, userId, userEmail }) => {
  const [step, setStep] = useState('request'); // 'request', 'token', 'success'
  const [requestId, setRequestId] = useState(null);
  const [unlockToken, setUnlockToken] = useState('');
  const [newPin, setNewPin] = useState('');
  const [newPinConfirm, setNewPinConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  if (!isOpen) return null;

  const hashPIN = (pin) => {
    let hash = 0;
    const string = `pin-${pin}-salt-ican-hash`;
    
    for (let i = 0; i < string.length; i++) {
      const char = string.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    return btoa(`hash-${Math.abs(hash)}-${pin.length}`);
  };

  const handleRequestPINReset = async () => {
    if (!userId) {
      setError('User ID not found');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = getSupabaseClient();
      const { data, error: err } = await supabase.rpc('request_account_unlock', {
        p_user_id: userId,
        p_request_type: 'pin_reset',
        p_reason: 'Account locked - user requested PIN reset'
      });

      if (err) {
        throw err;
      }

      if (data && data[0]?.success) {
        setSuccess(data[0].message);
        setRequestId(data[0].request_id);
        setUnlockToken(data[0].unlock_token);
        setStep('token');
      } else {
        setError(data?.[0]?.message || 'Failed to request PIN reset');
      }
    } catch (err) {
      console.error('PIN reset request error:', err);
      setError(err.message || 'Error requesting PIN reset');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPIN = async () => {
    setError(null);

    if (newPin.length !== 4) {
      setError('PIN must be 4 digits');
      return;
    }

    if (newPin !== newPinConfirm) {
      setError('PINs do not match');
      return;
    }

    setLoading(true);

    try {
      const supabase = getSupabaseClient();
      const hashedPin = hashPIN(newPin);

      const { data, error: err } = await supabase.rpc('reset_pin_with_token', {
        p_request_id: requestId,
        p_unlock_token: unlockToken,
        p_new_pin_hash: hashedPin
      });

      if (err) {
        throw err;
      }

      if (data && data[0]?.success) {
        setSuccess(data[0].message);
        setStep('success');
        setNewPin('');
        setNewPinConfirm('');
        
        // Close modal after 3 seconds
        setTimeout(() => {
          onClose();
        }, 3000);
      } else {
        setError(data?.[0]?.message || 'Failed to reset PIN');
      }
    } catch (err) {
      console.error('PIN reset error:', err);
      setError(err.message || 'Error resetting PIN');
    } finally {
      setLoading(false);
    }
  };

  const handleNumericInput = (num, field) => {
    if (field === 'new' && newPin.length < 4) {
      setNewPin(newPin + num);
    } else if (field === 'confirm' && newPinConfirm.length < 4) {
      setNewPinConfirm(newPinConfirm + num);
    }
  };

  const handleBackspace = (field) => {
    if (field === 'new') {
      setNewPin(newPin.slice(0, -1));
    } else {
      setNewPinConfirm(newPinConfirm.slice(0, -1));
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-2000 p-4">
      <div className="bg-white rounded-lg shadow-2xl max-w-md w-full p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Lock className="text-red-500" size={24} />
            <h2 className="text-xl font-bold">Account Locked</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={20} />
          </button>
        </div>

        {/* Step 1: Request PIN Reset */}
        {step === 'request' && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm text-red-800">
                Your account has been locked due to too many failed PIN attempts. You can reset your PIN via email.
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
                <AlertCircle size={18} className="text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <button
              onClick={handleRequestPINReset}
              disabled={loading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
            >
              {loading ? 'Sending...' : `Send Reset Link to ${userEmail}`}
            </button>

            <p className="text-xs text-gray-500 text-center">
              You'll receive an email with a link to reset your PIN
            </p>
          </div>
        )}

        {/* Step 2: Enter Unlock Token & New PIN */}
        {step === 'token' && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4">
              <p className="text-sm text-green-800">
                ✅ Check your email for the unlock token
              </p>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex gap-2">
                <AlertCircle size={18} className="text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                New PIN (4 digits)
              </label>
              <div className="flex gap-2 mb-2">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="w-12 h-12 border-2 border-gray-300 rounded-lg flex items-center justify-center text-lg font-bold"
                  >
                    {newPin[i] ? '•' : ''}
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Confirm PIN
              </label>
              <div className="flex gap-2 mb-2">
                {[0, 1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="w-12 h-12 border-2 border-gray-300 rounded-lg flex items-center justify-center text-lg font-bold"
                  >
                    {newPinConfirm[i] ? '•' : ''}
                  </div>
                ))}
              </div>
            </div>

            {/* Numeric Keypad */}
            <div className="grid grid-cols-3 gap-2 my-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  onClick={() => {
                    if (newPin.length < 4) handleNumericInput(num, 'new');
                    else if (newPinConfirm.length < 4) handleNumericInput(num, 'confirm');
                  }}
                  className="py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-semibold"
                >
                  {num}
                </button>
              ))}
              <button
                onClick={() => handleNumericInput(0, 'new')}
                className="py-2 bg-gray-100 hover:bg-gray-200 rounded-lg font-semibold col-span-2"
              >
                0
              </button>
              <button
                onClick={() => {
                  if (newPin.length > newPinConfirm.length) handleBackspace('new');
                  else handleBackspace('confirm');
                }}
                className="py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg font-semibold"
              >
                ⌫
              </button>
            </div>

            <button
              onClick={handleResetPIN}
              disabled={loading || newPin.length !== 4 || newPinConfirm.length !== 4}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium py-2 rounded-lg transition-colors"
            >
              {loading ? 'Resetting...' : 'Reset PIN'}
            </button>
          </div>
        )}

        {/* Step 3: Success */}
        {step === 'success' && (
          <div className="space-y-4">
            <div className="flex justify-center">
              <CheckCircle size={48} className="text-green-500" />
            </div>
            <p className="text-center font-semibold text-green-600">
              ✅ PIN Reset Successful!
            </p>
            <p className="text-center text-sm text-gray-600">
              Your account is now unlocked. You can log in with your new PIN.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default PINRecoveryModal;
