import React, { useEffect, useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import NationalIdField from './NationalIdField';
import useNationalIdStatus from '../hooks/useNationalIdStatus';
import { saveNationalId } from '../services/nationalIdService';
import './wallet-access-classic.css';

const REMINDER_DISMISSED_KEY = 'ican_national_id_reminder_dismissed';

/**
 * For a wallet that already exists but has no national ID on file.
 *
 *   - Before enforcement is switched on (national_id_enforcement.enforced = false):
 *     a slim, dismissible reminder; the dialog is optional.
 *   - Once enforced: a dialog nobody can close until an ID is saved. (The database also
 *     refuses to let money leave such a wallet, so this is the friendly front door, not the lock.)
 *
 * Renders nothing when the migration is not installed, the person is exempt, or an ID is on file.
 *
 *   countryHint  the country from sign-up, used only if the wallet itself has none recorded
 *   onSaved      called after the ID is saved
 */
export default function NationalIdGate({ countryHint = '', onSaved }) {
  const { status, refresh } = useNationalIdStatus(true);
  const [country, setCountry] = useState('');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(REMINDER_DISMISSED_KEY) === '1'; } catch { return false; }
  });

  const needsId = !!status && status.available && status.authenticated !== false && !status.exempt && !status.hasId;
  const enforced = needsId && status.enforced;
  const walletCountry = status?.accountCountry || '';

  // The wallet's own country wins; otherwise start from the sign-up country.
  useEffect(() => {
    setCountry((prev) => prev || walletCountry || String(countryHint || '').toUpperCase());
  }, [walletCountry, countryHint]);

  if (!needsId) return null;

  const dialogOpen = enforced || open;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await saveNationalId(country, value);
      if (!result.success) { setError(result.error); return; }
      setValue('');
      await refresh();
      onSaved?.(result);
    } catch (err) {
      setError(err?.message || 'Could not save your national ID. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const dismissReminder = () => {
    setDismissed(true);
    try { sessionStorage.setItem(REMINDER_DISMISSED_KEY, '1'); } catch { /* private mode: it just comes back next visit */ }
  };

  return (
    <>
      {!enforced && !dismissed && (
        <div role="status" className="fixed bottom-4 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 items-start justify-between gap-3 rounded-xl border border-amber-400/40 bg-slate-900/95 p-3 text-sm text-amber-100 shadow-xl backdrop-blur">
          <p className="min-w-0">
            <b>Add your national ID to keep your wallet working.</b> Wallets without one will soon be unable to send or withdraw money.
            {' '}<button type="button" onClick={() => setOpen(true)} className="underline font-semibold">Add it now</button>
          </p>
          <button type="button" onClick={dismissReminder} aria-label="Dismiss reminder" className="shrink-0 opacity-70 hover:opacity-100"><X className="h-4 w-4" /></button>
        </div>
      )}

      {dialogOpen && (
        <div className="wa-overlay" style={{ zIndex: 60 }} role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="national-id-gate-title" className="wa-card">
            <header className="wa-head">
              {!enforced && <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="wa-close"><X className="h-4 w-4" /></button>}
              <span className="wa-seal" aria-hidden="true"><ShieldCheck className="h-5 w-5" /></span>
              <p className="wa-eyebrow">IcanEra Wallet</p>
              <h2 id="national-id-gate-title" className="wa-title">Add your national ID</h2>
              <p className="wa-subtitle">{enforced ? 'Required before you can send or withdraw money' : 'Keeps your wallet safe and private'}</p>
              <div className="wa-rule" aria-hidden="true" />
            </header>
            <div className="wa-body">
              <p className="wa-p">
                Every IcanEra wallet is tied to one national ID. It stops anyone opening a second wallet in your name and
                makes it far harder for someone else to take over yours. You can still receive money meanwhile.
              </p>
              <form onSubmit={submit} className="mt-4" autoComplete="off">
                <NationalIdField
                  idPrefix="gate-nid"
                  country={country}
                  onCountryChange={setCountry}
                  countryLocked={!!walletCountry}
                  value={value}
                  onChange={setValue}
                  disabled={saving}
                />
                {error && <p role="alert" className="wa-alert mt-3">{error}</p>}
                <button type="submit" disabled={saving || !country || !value.trim()} className="wa-btn wa-btn-primary w-full mt-5">
                  {saving ? 'Saving…' : 'Save my national ID'}
                </button>
                <p className="wa-small mt-2 text-center italic">This can't be changed from the app once saved — check it carefully.</p>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
