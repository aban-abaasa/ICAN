import React, { useEffect, useMemo, useState } from 'react';
import { Loader, Wallet, Mail } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getSupabaseClient } from '../lib/supabase/client';
import { walletAccountService } from '../services/walletAccountService';
import { CountryService } from '../services/countryService';

const SKINS = {
  slate: {
    wrap: 'rounded-xl border border-emerald-700/40 bg-emerald-500/10 p-3 space-y-2.5',
    head: 'text-emerald-300', body: 'text-slate-300', faint: 'text-slate-500', err: 'text-xs text-red-400',
    input: 'w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500',
    btn: 'w-full min-h-[44px] py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold transition flex items-center justify-center gap-2',
    btn2: 'text-xs text-slate-300 underline hover:text-white',
  },
  nb: {
    wrap: 'rounded-xl border nb-border nb-surface-alt p-3 space-y-2.5',
    head: 'nb-text', body: 'nb-text-muted', faint: 'nb-text-faint', err: 'nb-error-text text-xs',
    input: 'w-full px-3 py-2 rounded-xl nb-input text-sm',
    btn: 'w-full min-h-[44px] py-2.5 rounded-xl nb-btn-primary disabled:opacity-50 text-sm font-semibold transition flex items-center justify-center gap-2',
    btn2: 'text-xs nb-link underline',
  },
};

/**
 * Shown at checkout to a signed-in customer who has no IcanEra wallet PIN yet -- typically someone who
 * just arrived with "Continue with Google". It is the wallet's own account creation, in place: the name and
 * phone already typed into the cart are reused, the customer picks their country (required for every
 * IcanEra user), and the same emailed PIN-setup link the wallet uses is sent. The page keeps the cart
 * and carries on by itself the moment the PIN exists (useWalletReady re-checks when the tab regains focus).
 *
 *   skin         'slate' | 'nb'
 *   defaultName/defaultPhone  what the cart form already holds
 *   onCheck      () => Promise — re-check the wallet; the parent flips to the pay button when ready
 */
export default function WalletSetupInline({ skin = 'slate', defaultName = '', defaultPhone = '', onCheck }) {
  const k = SKINS[skin] || SKINS.slate;
  const { user } = useAuth();
  const [name, setName] = useState(defaultName || user?.user_metadata?.full_name || user?.user_metadata?.name || '');
  const [phone, setPhone] = useState(defaultPhone || '');
  const [country, setCountry] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentTo, setSentTo] = useState('');

  const countries = useMemo(
    () => Object.entries(CountryService.getCountries()).map(([code, c]) => ({ code, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    []
  );

  // The cart form fills in after this mounts -- adopt it unless the customer already typed here.
  useEffect(() => { if (defaultName && !name) setName(defaultName); }, [defaultName]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (defaultPhone && !phone) setPhone(defaultPhone); }, [defaultPhone]); // eslint-disable-line react-hooks/exhaustive-deps

  // A country they already chose (signed up before, or an earlier attempt) is kept.
  useEffect(() => {
    if (!user?.id) return;
    walletAccountService.checkUserAccount(user.id).then((account) => {
      if (account?.country_code) setCountry((prev) => prev || account.country_code);
    });
  }, [user?.id]);

  const create = async () => {
    setError('');
    if (!name.trim()) { setError('Enter your name'); return; }
    if (phone.replace(/\D/g, '').length < 7) { setError('Enter a phone number we can reach you on'); return; }
    if (!country) { setError('Choose your country'); return; }
    setBusy(true);
    try {
      const supabase = getSupabaseClient();
      // Same requirement as everywhere else in IcanEra: every user has a country.
      const { error: countryError } = await supabase.from('user_accounts').update({ country_code: country }).eq('user_id', user.id);
      if (countryError) throw countryError;
      const result = await walletAccountService.sendPinSetupLink({
        userId: user.id,
        authEmail: user.email,
        accountHolderName: name.trim(),
        phoneNumber: phone.trim(),
        email: user.email,
        preferredCurrency: CountryService.getCurrencyCode(country),
      });
      if (!result.success) throw new Error(result.error);
      setSentTo(result.sentTo);
    } catch (err) {
      setError(err?.message || 'Could not create your wallet. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const check = async () => {
    setBusy(true);
    setError('');
    const state = await onCheck?.();
    setBusy(false);
    if (state !== 'ready') setError("We can't see your PIN yet. Open the link in your email, set the PIN, then come back and tap Continue.");
  };

  if (sentTo) {
    return (
      <div className={k.wrap} data-testid="wallet-setup-sent">
        <p className={`text-sm font-semibold flex items-center gap-2 ${k.head}`}><Mail className="w-4 h-4" />Check your email</p>
        <p className={`text-xs leading-relaxed ${k.body}`}>
          We sent a link to <b>{sentTo}</b>. Open it and choose your wallet PIN (4–6 digits) — then come back here; your cart is waiting and checkout continues on its own.
        </p>
        <button type="button" onClick={check} disabled={busy} className={k.btn}>
          {busy ? <Loader className="w-4 h-4 animate-spin" /> : null}
          I've set my PIN — Continue
        </button>
        {error && <p className={k.err} role="alert">{error}</p>}
        <p className={`text-center ${k.faint}`}><button type="button" onClick={() => setSentTo('')} className={k.btn2}>Send the link again</button></p>
      </div>
    );
  }

  return (
    <div className={k.wrap} data-testid="wallet-setup-form">
      <p className={`text-sm font-semibold flex items-center gap-2 ${k.head}`}><Wallet className="w-4 h-4" />One last step: create your IcanEra wallet</p>
      <p className={`text-xs leading-relaxed ${k.body}`}>
        You're signed in. Your wallet needs a PIN to pay — it takes a minute and works everywhere on IcanEra.
      </p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" className={k.input} />
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" autoComplete="tel" inputMode="tel" className={k.input} />
      <select value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Your country" className={k.input}>
        <option value="">Choose your country…</option>
        {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
      </select>
      <button type="button" onClick={create} disabled={busy} className={k.btn}>
        {busy ? <Loader className="w-4 h-4 animate-spin" /> : <Wallet className="w-4 h-4" />}
        {busy ? 'Creating your wallet…' : 'Create my wallet & set PIN'}
      </button>
      {error && <p className={k.err} role="alert">{error}</p>}
    </div>
  );
}
