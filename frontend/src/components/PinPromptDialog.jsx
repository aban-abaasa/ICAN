import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Delete, X } from 'lucide-react';

const PIN_MIN = 4;
const PIN_MAX = 6;

// Classic printed-card PIN dialog: the PIN is always masked, never lands in a
// browser popup, is cleared the moment the dialog closes, and the visible
// summary shows exactly what is being authorised.
const PinDialog = ({ request, onSubmit, onCancel }) => {
  const [pin, setPin] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const add = (d) => setPin((p) => (p.length < PIN_MAX ? p + d : p));
  const canSubmit = pin.length >= PIN_MIN;
  const submit = (e) => {
    e?.preventDefault();
    if (canSubmit) onSubmit(pin);
  };

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form
        onSubmit={submit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pin-dialog-title"
        autoComplete="off"
        className="w-full max-w-sm rounded-sm border-2 border-[#1f1a12]/70 bg-[#fffdf6] p-5 text-[#1f1a12] shadow-[6px_6px_0_0_rgba(31,26,18,0.25)]"
      >
        <div className="flex items-start justify-between gap-3 border-b-4 border-double border-[#1f1a12]/30 pb-3">
          <div className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-[#14532d]" />
            <h2 id="pin-dialog-title" className="font-serif text-lg font-bold">{request.title || 'Confirm with your PIN'}</h2>
          </div>
          <button type="button" onClick={onCancel} aria-label="Cancel" className="rounded-sm p-1 hover:bg-[#1f1a12]/10"><X className="h-4 w-4" /></button>
        </div>

        {request.message && <p className="mt-3 text-sm text-[#1f1a12]/80">{request.message}</p>}
        {request.error && <p role="alert" className="mt-3 rounded-sm border border-red-700/40 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800">{request.error}</p>}

        <div className="mt-4 flex justify-center gap-2" aria-hidden="true">
          {Array.from({ length: PIN_MAX }).map((_, i) => (
            <span key={i} className={`flex h-10 w-9 items-center justify-center rounded-sm border-2 text-xl ${i < pin.length ? 'border-[#14532d] bg-[#14532d]/10' : 'border-[#1f1a12]/30'} ${i >= PIN_MIN && i >= pin.length ? 'opacity-40' : ''}`}>
              {i < pin.length ? '•' : ''}
            </span>
          ))}
        </div>
        <p className="mt-1 text-center text-[11px] text-[#1f1a12]/60">{PIN_MIN}–{PIN_MAX} digits · never shared with anyone</p>

        {/* real input keeps hardware keyboards, password managers off and screen readers working */}
        <input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="new-password"
          maxLength={PIN_MAX}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, PIN_MAX))}
          aria-label="Transaction PIN"
          className="sr-only"
        />

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <button key={d} type="button" onClick={() => add(String(d))} className="h-12 rounded-sm border-2 border-[#1f1a12]/40 bg-white text-lg font-bold shadow-[2px_2px_0_0_rgba(31,26,18,0.15)] active:translate-y-px hover:border-[#14532d]">{d}</button>
          ))}
          <button type="button" onClick={() => setPin('')} className="h-12 rounded-sm border-2 border-[#1f1a12]/40 text-xs font-semibold hover:border-[#14532d]">Clear</button>
          <button type="button" onClick={() => add('0')} className="h-12 rounded-sm border-2 border-[#1f1a12]/40 bg-white text-lg font-bold shadow-[2px_2px_0_0_rgba(31,26,18,0.15)] active:translate-y-px hover:border-[#14532d]">0</button>
          <button type="button" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Delete last digit" className="flex h-12 items-center justify-center rounded-sm border-2 border-[#1f1a12]/40 hover:border-[#14532d]"><Delete className="h-5 w-5" /></button>
        </div>

        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 rounded-sm border-2 border-[#1f1a12]/60 py-2.5 text-sm font-semibold hover:bg-[#1f1a12] hover:text-[#f7f3e8]">Cancel</button>
          <button type="submit" disabled={!canSubmit} className="flex-1 rounded-sm border-2 border-[#14532d] bg-[#14532d] py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Confirm</button>
        </div>
      </form>
    </div>
  );
};

/**
 * const { askPin, pinDialog } = usePinPrompt();
 * const pin = await askPin({ title, message });   // string, or null if cancelled
 * ...render {pinDialog} once in the component tree.
 */
export const usePinPrompt = () => {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const finish = useCallback((value) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setRequest(null); // unmounting drops the typed PIN from state
    resolve?.(value);
  }, []);

  const askPin = useCallback((options = {}) => new Promise((resolve) => {
    resolverRef.current?.(null); // never leave an earlier prompt hanging
    resolverRef.current = resolve;
    setRequest(options);
  }), []);

  const onCancel = useCallback(() => finish(null), [finish]);
  const onSubmit = useCallback((pin) => finish(pin), [finish]);

  const pinDialog = request ? <PinDialog request={request} onSubmit={onSubmit} onCancel={onCancel} /> : null;
  return { askPin, pinDialog };
};

export default usePinPrompt;
