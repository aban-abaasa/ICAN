import React from 'react';
import { Fingerprint } from 'lucide-react';
import { DiamondSpinner } from '../IcanDiamond';

/**
 * Fingerprint / face sign-in, collapsed to one icon. The device decides which it uses (fingerprint, Face ID, Windows Hello ...),
 * so the words live in the tooltip and the screen-reader label. `prominent` is the larger, filled tile shown on its own on a
 * device that is already set up; otherwise it is a small tile in the row of other ways in.
 */
export default function BiometricSignInButton({ label, busyLabel, loading, disabled, prominent, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading}
      aria-label={loading ? busyLabel : label}
      title={label}
      className={`ia-alt-btn ia-icon-btn ${prominent ? 'ia-icon-btn--primary ia-icon-btn--large' : ''}`}
    >
      {loading ? (
        <DiamondSpinner className="animate-spin w-6 h-6" />
      ) : (
        <Fingerprint className={prominent ? 'w-9 h-9' : 'w-6 h-6'} aria-hidden="true" />
      )}
    </button>
  );
}
