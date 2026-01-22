import React, { useState, useEffect } from 'react';
import { Mail, Lock, AlertCircle, CheckCircle, Loader } from 'lucide-react';
import emailService from '../services/emailService';

/**
 * 🔐 PIN RESET FLOW
 * - User enters account details
 * - System sends unlock link to email
 * - User clicks link and creates new PIN
 * - Account automatically unlocked
 */

const PinResetFlow = ({ onSuccess, onCancel }) => {
  const [step, setStep] = useState('request'); // 'request', 'email-sent', 'reset-pin'
  const [accountNumber, setAccountNumber] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [requestId, setRequestId] = useState(null);
  const [unlockToken, setUnlockToken] = useState(null);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // ============================================
  // STEP 1: Request PIN Reset
  // ============================================
  const handleRequestReset = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Validate inputs
      if (!accountNumber.trim()) {
        throw new Error('Please enter your account number');
      }
      if (!email.trim() || !email.includes('@')) {
        throw new Error('Please enter a valid email address');
      }

      // Call backend to create unlock request
      // This would be a backend function in your system
      const response = await fetch('/api/request-pin-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account_number: accountNumber,
          email: email
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to create reset request');
      }

      setRequestId(data.request_id);
      setUnlockToken(data.unlock_token);

      // Send PIN reset email
      const emailResult = await emailService.sendPinResetEmail(
        email,
        accountNumber,
        `${window.location.origin}/reset-pin?request=${data.request_id}&token=${data.unlock_token}`,
        data.request_id
      );

      if (!emailResult.success) {
        console.warn('Email sent but with issues:', emailResult);
      }

      setStep('email-sent');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // STEP 2: Reset PIN with Token
  // ============================================
  const handleResetPin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Validate PIN
      if (!newPin || newPin.length !== 4) {
        throw new Error('PIN must be exactly 4 digits');
      }
      if (!/^\d+$/.test(newPin)) {
        throw new Error('PIN must contain only numbers');
      }
      if (newPin !== confirmPin) {
        throw new Error('PINs do not match');
      }

      // Hash PIN (same as frontend hash function)
      const hashedPin = btoa(newPin); // Base64 encoding

      // Call backend to reset PIN
      const response = await fetch('/api/reset-pin-with-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: requestId,
          unlock_token: unlockToken,
          new_pin_hash: hashedPin
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message || 'Failed to reset PIN');
      }

      setSuccessMessage(data.message);
      setStep('success');

      // Redirect to login after 3 seconds
      setTimeout(() => {
        if (onSuccess) onSuccess();
      }, 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================================
  // RENDER: Request Form
  // ============================================
  if (step === 'request') {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-purple-500/30 rounded-lg p-8 max-w-md w-full">
          <div className="flex items-center gap-3 mb-6">
            <Lock className="w-8 h-8 text-purple-400" />
            <h2 className="text-2xl font-bold text-white">Reset Your PIN</h2>
          </div>

          <p className="text-gray-300 mb-6">
            Enter your account details. We'll send a secure link to your email to reset your PIN.
          </p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
              <div className="flex gap-2">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleRequestReset} className="space-y-4">
            <div>
              <label className="block text-gray-300 text-sm font-semibold mb-2">
                Account Number
              </label>
              <input
                type="text"
                placeholder="e.g., ICAN-8071026101388866"
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value)}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 transition-all"
              />
            </div>

            <div>
              <label className="block text-gray-300 text-sm font-semibold mb-2">
                <Mail className="w-4 h-4 inline mr-2" />
                Email Address
              </label>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 transition-all"
              />
              <p className="text-xs text-gray-400 mt-1">
                We'll send a reset link to this email (valid for 24 hours)
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4" />
                    Send Reset Link
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ============================================
  // RENDER: Email Sent
  // ============================================
  if (step === 'email-sent') {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-purple-500/30 rounded-lg p-8 max-w-md w-full">
          <div className="flex items-center gap-3 mb-6">
            <Mail className="w-8 h-8 text-blue-400" />
            <h2 className="text-2xl font-bold text-white">Check Your Email</h2>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-6 mb-6 text-center">
            <p className="text-white font-semibold mb-2">📧 Reset link sent!</p>
            <p className="text-gray-300 text-sm">
              We've sent a PIN reset link to:<br />
              <strong>{email}</strong>
            </p>
          </div>

          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
            <p className="text-yellow-300 text-sm">
              ⏰ <strong>The link expires in 24 hours</strong>
            </p>
          </div>

          <div className="space-y-4 mb-6">
            <h3 className="text-white font-semibold">What to do next:</h3>
            <ol className="text-gray-300 text-sm space-y-2 ml-4 list-decimal">
              <li>Check your email inbox</li>
              <li>Click the "RESET PIN NOW" button</li>
              <li>Enter your new 4-digit PIN</li>
              <li>Your account will be unlocked</li>
              <li>Log in with your new PIN</li>
            </ol>
          </div>

          <div className="bg-gray-700/30 rounded-lg p-4 mb-6">
            <p className="text-gray-300 text-xs">
              💡 <strong>Tip:</strong> Check your spam folder if you don't see the email
            </p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-all"
            >
              Go Back
            </button>
            <button
              onClick={() => setStep('request')}
              className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg transition-all"
            >
              Resend Email
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // RENDER: Reset PIN Form
  // ============================================
  if (step === 'reset-pin') {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-purple-500/30 rounded-lg p-8 max-w-md w-full">
          <div className="flex items-center gap-3 mb-6">
            <Lock className="w-8 h-8 text-green-400" />
            <h2 className="text-2xl font-bold text-white">Create New PIN</h2>
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mb-4">
              <div className="flex gap-2">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
                <p className="text-red-300 text-sm">{error}</p>
              </div>
            </div>
          )}

          <form onSubmit={handleResetPin} className="space-y-4">
            <div>
              <label className="block text-gray-300 text-sm font-semibold mb-2">
                New 4-Digit PIN
              </label>
              <input
                type="password"
                placeholder="••••"
                maxLength="4"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 text-center tracking-widest focus:outline-none focus:border-green-400 transition-all text-2xl"
              />
              <p className="text-xs text-gray-400 mt-1">
                Must be 4 digits (numbers only)
              </p>
            </div>

            <div>
              <label className="block text-gray-300 text-sm font-semibold mb-2">
                Confirm PIN
              </label>
              <input
                type="password"
                placeholder="••••"
                maxLength="4"
                value={confirmPin}
                onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-500 text-center tracking-widest focus:outline-none focus:border-green-400 transition-all text-2xl"
              />
            </div>

            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <p className="text-blue-300 text-sm">
                💡 <strong>PIN Tips:</strong>
                <ul className="ml-4 mt-2 space-y-1 list-disc text-xs">
                  <li>Use a PIN you'll remember</li>
                  <li>Don't use obvious numbers (0000, 1234)</li>
                  <li>You'll need this PIN for every transaction</li>
                </ul>
              </p>
            </div>

            <div className="flex gap-3 pt-4">
              <button
                type="button"
                onClick={onCancel}
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || newPin.length !== 4 || confirmPin.length !== 4}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? (
                  <>
                    <Loader className="w-4 h-4 animate-spin" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4" />
                    Reset PIN
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ============================================
  // RENDER: Success
  // ============================================
  if (step === 'success') {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-purple-500/30 rounded-lg p-8 max-w-md w-full">
          <div className="flex items-center justify-center mb-6">
            <CheckCircle className="w-16 h-16 text-green-400" />
          </div>

          <h2 className="text-2xl font-bold text-white text-center mb-4">
            ✅ PIN Reset Successful!
          </h2>

          <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-6">
            <p className="text-green-300 text-sm text-center">
              {successMessage}
            </p>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-6">
            <p className="text-blue-300 text-sm">
              Your account has been unlocked and your PIN has been reset.<br /><br />
              <strong>Redirecting to login in 3 seconds...</strong>
            </p>
          </div>

          <button
            onClick={() => {
              if (onSuccess) onSuccess();
            }}
            className="w-full px-4 py-2 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg transition-all"
          >
            Log In Now
          </button>
        </div>
      </div>
    );
  }
};

export default PinResetFlow;
