/**
 * 🔐 GROUP WALLET PIN MODAL
 * Modal for setting and changing group wallet PIN
 */

import React, { useState } from 'react';
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle } from 'lucide-react';
import groupWalletAccountService from '../services/groupWalletAccountService';
import { getSupabaseClient } from '../lib/supabase/client';

const GroupWalletPINModal = ({ 
  groupId, 
  groupName, 
  onClose,
  isPINSet = false,
  onSuccess = null
}) => {
  const [mode, setMode] = useState(isPINSet ? 'change' : 'set'); // 'set' or 'change'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showPins, setShowPins] = useState({
    current: false,
    new: false,
    confirm: false
  });

  // Set PIN Mode
  const [setPinForm, setSetPinForm] = useState({
    pin: '',
    confirmPin: ''
  });

  // Change PIN Mode
  const [changePinForm, setChangePinForm] = useState({
    currentPin: '',
    newPin: '',
    confirmNewPin: ''
  });

  /**
   * Handle PIN Set (for first-time setup)
   */
  const handleSetPin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!setPinForm.pin || !setPinForm.confirmPin) {
      setError('Please enter PIN in both fields');
      return;
    }

    if (setPinForm.pin !== setPinForm.confirmPin) {
      setError('PINs do not match');
      return;
    }

    if (setPinForm.pin.length < 4 || setPinForm.pin.length > 6) {
      setError('PIN must be 4-6 digits');
      return;
    }

    if (!/^\d+$/.test(setPinForm.pin)) {
      setError('PIN must contain only digits');
      return;
    }

    setLoading(true);
    try {
      // Get current user
      const supabase = getSupabaseClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setError('Authentication error');
        return;
      }

      // Create wallet with PIN via service
      const result = await groupWalletAccountService.createGroupWallet({
        groupId: groupId,
        creatorId: user.id,
        pin: setPinForm.pin,
        approvalThreshold: 60,
        minWithdrawal: 10
      });

      if (!result.success) {
        setError(result.error || 'Failed to set PIN');
        return;
      }

      setSuccess('✅ PIN set successfully! Wallet is now active.');
      setSetPinForm({ pin: '', confirmPin: '' });

      // Call success callback
      if (onSuccess) onSuccess(result.account);

      // Close after 2 seconds
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      setError(err.message || 'Error setting PIN');
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle PIN Change (for existing PIN)
   */
  const handleChangePin = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!changePinForm.currentPin || !changePinForm.newPin || !changePinForm.confirmNewPin) {
      setError('Please fill in all PIN fields');
      return;
    }

    if (changePinForm.newPin !== changePinForm.confirmNewPin) {
      setError('New PINs do not match');
      return;
    }

    if (changePinForm.newPin.length < 4 || changePinForm.newPin.length > 6) {
      setError('New PIN must be 4-6 digits');
      return;
    }

    if (!/^\d+$/.test(changePinForm.newPin)) {
      setError('PIN must contain only digits');
      return;
    }

    setLoading(true);
    try {
      // Get current user
      const supabase = getSupabaseClient();
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) {
        setError('Authentication error');
        return;
      }

      // Change PIN via service
      const result = await groupWalletAccountService.changeGroupPIN(
        groupId,
        changePinForm.currentPin,
        changePinForm.newPin,
        user.id
      );

      if (!result.success) {
        setError(result.error || 'Failed to change PIN');
        return;
      }

      setSuccess('✅ PIN changed successfully!');
      setChangePinForm({
        currentPin: '',
        newPin: '',
        confirmNewPin: ''
      });

      // Call success callback
      if (onSuccess) onSuccess();

      // Close after 2 seconds
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (err) {
      setError(err.message || 'Error changing PIN');
    } finally {
      setLoading(false);
    }
  };

  /**
   * PIN Input Component
   */
  const PINInput = ({ value, onChange, onFocus, onBlur, show, toggleShow, placeholder }) => (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        inputMode="numeric"
        pattern="\d*"
        maxLength="6"
        value={value}
        onChange={onChange}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder={placeholder}
        className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 text-center text-2xl tracking-widest font-mono"
      />
      <button
        type="button"
        onClick={toggleShow}
        className="absolute right-3 top-3.5 text-slate-400 hover:text-slate-300 transition"
      >
        {show ? <EyeOff size={20} /> : <Eye size={20} />}
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] p-4">
      <div className="bg-slate-800 rounded-xl max-w-md w-full border border-slate-700 shadow-2xl">
        {/* Header */}
        <div className="p-6 border-b border-slate-700">
          <div className="flex items-center gap-3 mb-2">
            <Lock className="w-6 h-6 text-blue-400" />
            <h2 className="text-2xl font-bold text-white">
              {mode === 'set' ? '🔐 Set Wallet PIN' : '🔄 Change PIN'}
            </h2>
          </div>
          <p className="text-slate-400 text-sm">Group: <span className="font-semibold text-slate-300">{groupName}</span></p>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Error Alert */}
          {error && (
            <div className="flex gap-3 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          {/* Success Alert */}
          {success && (
            <div className="flex gap-3 p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
              <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
              <p className="text-emerald-300 text-sm">{success}</p>
            </div>
          )}

          <form onSubmit={mode === 'set' ? handleSetPin : handleChangePin} className="space-y-4">
            {/* Set PIN Form */}
            {mode === 'set' && (
              <>
                <div>
                  <label className="block text-slate-300 font-semibold mb-2 text-sm">
                    Create PIN (4-6 digits)
                  </label>
                  <PINInput
                    value={setPinForm.pin}
                    onChange={(e) => setSetPinForm({ ...setPinForm, pin: e.target.value.replace(/\D/g, '') })}
                    show={showPins.new}
                    toggleShow={() => setShowPins({ ...showPins, new: !showPins.new })}
                    placeholder="••••"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-2 text-sm">
                    Confirm PIN
                  </label>
                  <PINInput
                    value={setPinForm.confirmPin}
                    onChange={(e) => setSetPinForm({ ...setPinForm, confirmPin: e.target.value.replace(/\D/g, '') })}
                    show={showPins.confirm}
                    toggleShow={() => setShowPins({ ...showPins, confirm: !showPins.confirm })}
                    placeholder="••••"
                  />
                </div>

                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
                  <p className="text-blue-300 text-xs">
                    💡 <strong>Security Tip:</strong> Choose a PIN only you know. You'll need it to approve withdrawals.
                  </p>
                </div>
              </>
            )}

            {/* Change PIN Form */}
            {mode === 'change' && (
              <>
                <div>
                  <label className="block text-slate-300 font-semibold mb-2 text-sm">
                    Current PIN
                  </label>
                  <PINInput
                    value={changePinForm.currentPin}
                    onChange={(e) => setChangePinForm({ ...changePinForm, currentPin: e.target.value.replace(/\D/g, '') })}
                    show={showPins.current}
                    toggleShow={() => setShowPins({ ...showPins, current: !showPins.current })}
                    placeholder="••••"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-2 text-sm">
                    New PIN (4-6 digits)
                  </label>
                  <PINInput
                    value={changePinForm.newPin}
                    onChange={(e) => setChangePinForm({ ...changePinForm, newPin: e.target.value.replace(/\D/g, '') })}
                    show={showPins.new}
                    toggleShow={() => setShowPins({ ...showPins, new: !showPins.new })}
                    placeholder="••••"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-2 text-sm">
                    Confirm New PIN
                  </label>
                  <PINInput
                    value={changePinForm.confirmNewPin}
                    onChange={(e) => setChangePinForm({ ...changePinForm, confirmNewPin: e.target.value.replace(/\D/g, '') })}
                    show={showPins.confirm}
                    toggleShow={() => setShowPins({ ...showPins, confirm: !showPins.confirm })}
                    placeholder="••••"
                  />
                </div>
              </>
            )}

            {/* Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors font-medium"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:bg-slate-700 text-white rounded-lg transition-colors font-medium"
                disabled={loading}
              >
                {loading ? '⏳ Processing...' : (mode === 'set' ? '✅ Set PIN' : '🔄 Change PIN')}
              </button>
            </div>

            {/* Switch Mode Button */}
            {isPINSet && mode === 'change' && (
              <button
                type="button"
                onClick={() => {
                  setMode('set');
                  setChangePinForm({ currentPin: '', newPin: '', confirmNewPin: '' });
                  setError('');
                  setSuccess('');
                }}
                className="w-full text-center py-2 text-slate-400 hover:text-slate-300 text-sm transition"
              >
                ← Back
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
};

export default GroupWalletPINModal;
