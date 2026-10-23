import React, { useEffect, useRef, useState } from 'react';
import { Camera, ShieldCheck, X } from 'lucide-react';
import NationalIdField from './NationalIdField';
import { claimNationalId, requestIdVerification } from '../services/nationalIdService';
import { checkProofImage } from '../utils/nationalId';
import { scrollFocusedIntoView } from '../utils/scrollFocus';
import './wallet-access-classic.css';

// One picture picker with a preview. `capture` asks a phone for its front camera (selfie); on a computer it is ignored.
function PhotoPicker({ id, label, hint, file, onFile, capture, disabled }) {
  const [preview, setPreview] = useState('');
  const [problem, setProblem] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!file) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const choose = (e) => {
    const picked = e.target.files?.[0] || null;
    const check = picked ? checkProofImage(picked, label.toLowerCase()) : { ok: true };
    setProblem(check.ok ? '' : check.error);
    onFile(check.ok ? picked : null);
    if (!check.ok && inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      <label className="wa-label" htmlFor={id}>{label} *</label>
      <div className="flex items-center gap-3">
        {preview
          ? <img src={preview} alt={`Preview of your ${label.toLowerCase()}`} className="h-16 w-16 shrink-0 rounded object-cover" />
          : <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-dashed" aria-hidden="true"><Camera className="h-5 w-5 opacity-60" /></span>}
        <input
          ref={inputRef}
          id={id}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture={capture}
          disabled={disabled}
          onChange={choose}
          aria-describedby={`${id}-hint`}
          className="wa-input min-w-0 flex-1 py-2"
        />
      </div>
      <p id={`${id}-hint`} className="wa-small mt-1">
        {problem ? <span role="alert">{problem}</span> : hint}
      </p>
    </div>
  );
}

/**
 * Asks a reviewer to confirm that a national ID is really this person's.
 *
 *   mode 'verify'  the ID already saved on the wallet
 *   mode 'claim'   an ID that someone else saved first (asks for the ID number too; `initialCountry` / `initialValue`
 *                  carry over what was just typed)
 *
 * The person gives their name exactly as printed, a photo of the ID, and a selfie holding it. The photos go to the app's
 * existing storage folder; a reviewer in the Dev console approves or rejects. See backend/NATIONAL_ID_OWNERSHIP.sql.
 *
 *   walletName     the wallet's current name, which has to fit the name on the ID
 *   onClose        dismiss without sending
 *   onDone         called once the request is sent
 */
export default function NationalIdVerifyDialog({ mode = 'verify', walletName = '', initialCountry = '', initialValue = '', onClose, onDone }) {
  const claim = mode === 'claim';
  const [country, setCountry] = useState(initialCountry);
  const [value, setValue] = useState(initialValue);
  const [nameOnId, setNameOnId] = useState('');
  const [note, setNote] = useState('');
  const [idPhoto, setIdPhoto] = useState(null);
  const [selfie, setSelfie] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const send = claim ? claimNationalId : requestIdVerification;
      const result = await send({ country, value, nameOnId, idPhoto, selfie, note, walletName });
      if (!result.success) { setError(result.error); return; }
      setSent(true);
      onDone?.(result);
    } catch (err) {
      setError(err?.message || 'Could not send your request. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const ready = !!nameOnId.trim() && !!idPhoto && !!selfie && (!claim || (!!country && !!value.trim()));

  return (
    <div className="wa-overlay" style={{ zIndex: 70 }} role="presentation">
      <div role="dialog" aria-modal="true" aria-labelledby="nid-verify-title" className="wa-card">
        <header className="wa-head">
          <button type="button" onClick={onClose} aria-label="Close" className="wa-close"><X className="h-4 w-4" /></button>
          <span className="wa-seal" aria-hidden="true"><ShieldCheck className="h-5 w-5" /></span>
          <p className="wa-eyebrow">IcanEra Wallet</p>
          <h2 id="nid-verify-title" className="wa-title">{claim ? 'This ID is mine' : 'Verify your national ID'}</h2>
          <p className="wa-subtitle">{claim ? 'Prove it is yours and we will move it to your wallet' : 'Show that the ID on your wallet is really yours'}</p>
          <div className="wa-rule" aria-hidden="true" />
        </header>

        <div className="wa-body" onFocus={scrollFocusedIntoView}>
          {sent ? (
            <div role="status">
              <p className="wa-notice">Sent. A reviewer will check it.</p>
              <p className="wa-p mt-3">
                {claim
                  ? 'Until then the ID stays where it is. If the reviewer agrees it is yours it moves to your wallet, and whoever saved it first loses it.'
                  : 'You can keep using your wallet meanwhile. Your wallet shows “ID verified” to people who pay you once it is approved.'}
              </p>
              <button type="button" onClick={onClose} className="wa-btn wa-btn-primary mt-5 w-full">Done</button>
            </div>
          ) : (
            <form onSubmit={submit} autoComplete="off">
              <p className="wa-p">
                {claim
                  ? 'Someone saved this ID on their wallet before you. Anyone can type any ID number, so we ask the real owner to prove it.'
                  : 'Anyone can type an ID number, so we ask you to prove yours. Only reviewers see the photos, and they are never shown to other users.'}
              </p>
              <div className="mt-4 space-y-4">
                {claim && (
                  <NationalIdField
                    idPrefix="verify-nid"
                    country={country}
                    onCountryChange={setCountry}
                    value={value}
                    onChange={setValue}
                    disabled={busy}
                  />
                )}
                <div>
                  <label className="wa-label" htmlFor="nid-name">Your full name, exactly as printed on the ID *</label>
                  <input
                    id="nid-name"
                    type="text"
                    value={nameOnId}
                    onChange={(e) => setNameOnId(e.target.value)}
                    disabled={busy}
                    autoComplete="off"
                    autoCapitalize="words"
                    spellCheck={false}
                    placeholder="e.g. KATO BOB MUGISHA"
                    aria-describedby="nid-name-hint"
                    className="wa-input"
                  />
                  <p id="nid-name-hint" className="wa-small mt-1">
                    {walletName ? `Your wallet is named “${walletName}”; it has to match the name on the ID.` : 'It has to match the name on your wallet.'}
                  </p>
                </div>
                <PhotoPicker id="nid-photo" label="Photo of your ID" hint="The side with your photo and ID number. Make sure it is sharp and not cut off." file={idPhoto} onFile={setIdPhoto} disabled={busy} />
                <PhotoPicker id="nid-selfie" label="Selfie holding your ID" hint="Your face and the ID in the same picture." file={selfie} onFile={setSelfie} capture="user" disabled={busy} />
                <div>
                  <label className="wa-label" htmlFor="nid-note">Anything the reviewer should know (optional)</label>
                  <textarea
                    id="nid-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    disabled={busy}
                    maxLength={500}
                    rows={2}
                    placeholder={claim ? 'e.g. someone else used my ID number; call me on…' : 'e.g. the best time to call you'}
                    className="wa-input"
                  />
                </div>
              </div>
              {error && <p role="alert" className="wa-alert mt-3">{error}</p>}
              <button type="submit" disabled={busy || !ready} className="wa-btn wa-btn-primary mt-5 w-full">
                {busy ? 'Sending…' : 'Send for review'}
              </button>
              <p className="wa-small mt-2 text-center italic">Photos of IDs are sensitive: only send your own, and never share them with anyone else.</p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
