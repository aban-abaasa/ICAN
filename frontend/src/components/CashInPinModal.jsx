import React, { useState } from 'react';
import './CashInPinModal.css';

/**
 * 🔐 PIN VERIFICATION MODAL
 * Requests 4-digit PIN from user before approving cash-in
 * Features: Numeric keypad, attempt counter, visual feedback
 */
const CashInPinModal = ({ 
  isOpen, 
  onSubmit, 
  onCancel,
  amount,
  currency,
  userAccount,
  isLoading = false,
  error = null,
  attemptsRemaining = 3
}) => {
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [localError, setLocalError] = useState(error);

  if (!isOpen) return null;

  const handlePinChange = (e) => {
    const value = e.target.value.replace(/[^\d]/g, '').slice(0, 4);
    setPin(value);
    setLocalError(null);
  };

  const handleNumericInput = (num) => {
    if (pin.length < 4) {
      const newPin = pin + num;
      setPin(newPin);
      setLocalError(null);
    }
  };

  const handleBackspace = () => {
    setPin(pin.slice(0, -1));
    setLocalError(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (pin.length !== 4) {
      setLocalError('PIN must be 4 digits');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(pin);
      setPin('');
    } catch (err) {
      setLocalError(err.message || 'PIN verification failed');
      setPin('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    setPin('');
    setLocalError(null);
    onCancel();
  };

  return (
    <div className="pin-modal-overlay">
      <div className="pin-modal">
        <div className="pin-modal-header">
          <h2>🔐 Verify PIN</h2>
          <p>Enter your 4-digit PIN to confirm</p>
        </div>

        <div className="pin-modal-amount">
          <p className="amount-label">Transferring</p>
          <p className="amount-value">{amount} {currency}</p>
          <p className="user-account">From: {userAccount}</p>
        </div>

        <form onSubmit={handleSubmit} className="pin-form">
          {/* PIN Display */}
          <div className="pin-display-container">
            <div className="pin-dots">
              {[0, 1, 2, 3].map((index) => (
                <div
                  key={index}
                  className={`pin-dot ${index < pin.length ? 'filled' : ''}`}
                >
                  {showPin && pin[index] ? pin[index] : '•'}
                </div>
              ))}
            </div>
            <button
              type="button"
              className="show-pin-btn"
              onClick={() => setShowPin(!showPin)}
              title={showPin ? 'Hide PIN' : 'Show PIN'}
            >
              {showPin ? '👁️‍🗨️' : '👁️'}
            </button>
          </div>

          {/* Error Message */}
          {(localError || error) && (
            <div className="pin-error">
              <p>⚠️ {localError || error}</p>
              {attemptsRemaining && (
                <p className="attempts-remaining">
                  Attempts remaining: {attemptsRemaining}
                </p>
              )}
            </div>
          )}

          {/* Numeric Keypad */}
          <div className="numeric-keypad">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
              <button
                key={num}
                type="button"
                className="keypad-btn number-btn"
                onClick={() => handleNumericInput(num)}
                disabled={pin.length >= 4 || isSubmitting}
              >
                {num}
              </button>
            ))}
            <button
              type="button"
              className="keypad-btn zero-btn"
              onClick={() => handleNumericInput(0)}
              disabled={pin.length >= 4 || isSubmitting}
            >
              0
            </button>
            <button
              type="button"
              className="keypad-btn backspace-btn"
              onClick={handleBackspace}
              disabled={pin.length === 0 || isSubmitting}
            >
              ⌫
            </button>
          </div>

          {/* Action Buttons */}
          <div className="pin-modal-actions">
            <button
              type="button"
              className="btn-cancel"
              onClick={handleCancel}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-confirm"
              disabled={pin.length !== 4 || isSubmitting || isLoading}
            >
              {isSubmitting || isLoading ? 'Verifying...' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CashInPinModal;
