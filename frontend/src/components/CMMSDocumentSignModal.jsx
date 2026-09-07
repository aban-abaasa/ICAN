import React, { useState } from 'react';
import { X, ShieldCheck } from 'lucide-react';
import walletAccountService from '../services/walletAccountService';
import cmmsEmploymentDocumentsService from '../services/cmmsEmploymentDocumentsService';

/**
 * Employee-side e-signature for an issued appointment letter/contract --
 * same wallet-PIN-as-signature convention as investment agreements
 * (ShareholderSignatureModal.jsx): the PIN is verified, then only a masked
 * form + timestamp is ever stored, never the PIN itself.
 */
const CMMSDocumentSignModal = ({ document, userId, onClose, onSigned }) => {
  const [pin, setPin] = useState('');
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');

  const sign = async () => {
    if (pin.length < 4) { setError('Enter your wallet PIN'); return; }
    setSigning(true); setError('');
    const verifyResult = await walletAccountService.verifyUserPIN(userId, pin);
    if (!verifyResult.success) { setError(verifyResult.error); setSigning(false); return; }

    const pinMasked = pin[0] + '*'.repeat(Math.max(0, pin.length - 2)) + pin[pin.length - 1];
    const signResult = await cmmsEmploymentDocumentsService.signEmploymentDocument(document.id, pinMasked, 'wallet_pin');
    setSigning(false);
    if (!signResult.success) { setError(signResult.error); return; }
    onSigned?.();
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
      <div className="glass-card w-full max-w-sm p-6 border border-purple-400/30">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-white flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-emerald-300" /> Sign document</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-300 mb-1">{document.title}</p>
        <p className="text-xs text-gray-500 mb-4">Enter your IcanEra wallet PIN to sign. This signature is legally binding.</p>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          placeholder="Wallet PIN"
          className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20 text-center tracking-widest text-lg"
        />
        {error && <p className="text-red-300 text-sm mt-2">{error}</p>}
        <button disabled={signing} onClick={sign} className="w-full mt-4 px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold disabled:opacity-50">
          {signing ? 'Signing…' : 'Sign with wallet PIN'}
        </button>
      </div>
    </div>
  );
};

export default CMMSDocumentSignModal;
