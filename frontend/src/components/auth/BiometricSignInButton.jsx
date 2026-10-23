import React from 'react';
import { Fingerprint, ScanFace } from 'lucide-react';
import { DiamondSpinner } from '../IcanDiamond';

/**
 * "Sign in with fingerprint or face". The device decides which it uses (fingerprint, Face ID, Windows Hello ...), so the
 * button names both. `prominent` is the main call to action, shown first on a device that is already set up.
 */
export default function BiometricSignInButton({ palette, label, busyLabel, loading, disabled, prominent, onClick }) {
  const style = prominent
    ? { backgroundImage: palette.primaryGradient, color: palette.primaryText, boxShadow: palette.primaryShadow }
    : { backgroundColor: palette.secondaryBg, color: palette.secondaryText, border: `1px solid ${palette.cardBorder}` };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading}
      className={`w-full ${prominent ? 'ia-primary-action py-3.5 font-semibold' : 'py-3 font-medium'} px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed`}
      style={style}
    >
      {loading ? (
        <DiamondSpinner className="animate-spin w-5 h-5" />
      ) : (
        <span className="flex items-center gap-1" aria-hidden="true">
          <Fingerprint className="w-5 h-5" />
          <ScanFace className="w-5 h-5" />
        </span>
      )}
      {loading ? busyLabel : label}
    </button>
  );
}
