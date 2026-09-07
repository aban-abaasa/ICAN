import React, { useEffect, useState } from 'react';
import { BadgeCheck, CheckCircle2, Lock, Loader2, Mail, MessageSquarePlus, ShieldX, Wallet } from 'lucide-react';
import cmmsServiceProviderContractsService from '../services/cmmsServiceProviderContractsService';
import { signIn, signUp } from '../services/authService';
import { supabase } from '../lib/supabase/client';

// Google sign-in redirects the whole page away and back, so the gate
// credential the provider already typed in (and which accessMode/verify
// function to re-check with) has to survive that round trip -- sessionStorage
// is the simplest thing that does, matching the redirectTo trick AuthContext.
// signInWithGoogle already uses to return standalone token pages (like this
// one) to themselves instead of the app root.
const GOOGLE_LINK_PENDING_KEY = 'sp_contract_wallet_link_pending';

/**
 * Standalone public page at /service-provider-contract?token=<access_token>
 * (see main.jsx) -- the ONLY thing an outside contractor with no CMMS/ICAN
 * account ever opens. No login, no providers, same reasoning as
 * PublicDocumentVerify.jsx.
 *
 * Every contract is private by construction: the link alone opens nothing.
 * A pre-auth check (fn_get_service_provider_contract_public) says whether
 * to prompt for a PIN or an email, and only fn_verify_service_provider_
 * contract_pin / _email hand back the contract + follow-ups + payments.
 * The same credential is re-sent on every follow-up post since this page
 * holds no session.
 */
const PublicServiceProviderContract = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [phase, setPhase] = useState('loading'); // loading | pin_required | email_required | locked | invalid | unlocked
  const [gateInput, setGateInput] = useState('');
  const [gateError, setGateError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [credential, setCredential] = useState(''); // remembered after unlock, resent when posting a follow-up
  const [accessMode, setAccessMode] = useState(null); // 'pin' | 'email', set once the gate is known
  const [info, setInfo] = useState(null);
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [confirmingId, setConfirmingId] = useState(null);
  const [walletMode, setWalletMode] = useState('signin'); // 'signin' | 'signup'
  const [walletForm, setWalletForm] = useState({ email: '', password: '', fullName: '' });
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState('');

  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }
    cmmsServiceProviderContractsService.getServiceProviderContractGateStatus(token).then((result) => {
      if (!result.success) { setPhase('invalid'); return; }
      setPhase(result.data.status);
      if (result.data.access_mode) setAccessMode(result.data.access_mode);
    });
  }, [token]);

  // Coming back from Google: re-unlock with the credential saved before
  // redirecting, then link the now-signed-in wallet.
  useEffect(() => {
    const raw = sessionStorage.getItem(GOOGLE_LINK_PENDING_KEY);
    if (!raw) return;
    sessionStorage.removeItem(GOOGLE_LINK_PENDING_KEY);
    let pending;
    try { pending = JSON.parse(raw); } catch { return; }
    if (!pending || pending.token !== token) return;

    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const verify = pending.accessMode === 'email'
        ? cmmsServiceProviderContractsService.verifyServiceProviderContractEmail
        : cmmsServiceProviderContractsService.verifyServiceProviderContractPin;
      const result = await verify(token, pending.credential);
      if (!result.success || result.data.status !== 'ok') return;
      setCredential(pending.credential);
      setAccessMode(pending.accessMode);
      setInfo(result.data);
      setPhase('unlocked');
      const link = await cmmsServiceProviderContractsService.linkServiceProviderWallet(token, pending.credential);
      if (link.success) {
        const refreshed = await verify(token, pending.credential);
        if (refreshed.success && refreshed.data.status === 'ok') setInfo(refreshed.data);
      } else {
        setWalletError(link.error || 'Signed in, but could not link your wallet to this contract.');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleUnlock = async (event) => {
    event.preventDefault();
    if (!gateInput.trim()) return;
    setVerifying(true);
    setGateError('');
    const verify = phase === 'pin_required'
      ? cmmsServiceProviderContractsService.verifyServiceProviderContractPin
      : cmmsServiceProviderContractsService.verifyServiceProviderContractEmail;
    const result = await verify(token, gateInput.trim());
    setVerifying(false);
    if (!result.success || result.data.status !== 'ok') {
      const status = result.data?.status;
      if (status === 'locked') { setPhase('locked'); return; }
      setGateError(status === 'invalid_pin' ? 'Incorrect PIN.' : status === 'not_allowed' ? 'That email is not authorized to view this contract.' : 'Could not verify. Try again.');
      return;
    }
    setCredential(gateInput.trim());
    setInfo(result.data);
    setPhase('unlocked');
  };

  const reload = async () => {
    const verify = accessMode === 'email'
      ? cmmsServiceProviderContractsService.verifyServiceProviderContractEmail
      : cmmsServiceProviderContractsService.verifyServiceProviderContractPin;
    const result = await verify(token, credential);
    if (result.success && result.data.status === 'ok') setInfo(result.data);
  };

  const handlePostFollowup = async (event) => {
    event.preventDefault();
    if (!note.trim()) return;
    setPosting(true);
    setPostError('');
    const result = await cmmsServiceProviderContractsService.addServiceProviderFollowupPublic(token, credential, note.trim());
    setPosting(false);
    if (!result.success) { setPostError(result.error || 'Could not post your update.'); return; }
    setNote('');
    await reload();
  };

  const handleConfirmPayment = async (paymentId) => {
    setConfirmingId(paymentId);
    const result = await cmmsServiceProviderContractsService.confirmServiceProviderPayment(token, credential, paymentId);
    setConfirmingId(null);
    if (result.success) await reload();
  };

  const handleWalletAuth = async (event) => {
    event.preventDefault();
    if (!walletForm.email.trim() || !walletForm.password) return;
    setWalletBusy(true);
    setWalletError('');
    try {
      const result = walletMode === 'signup'
        ? await signUp(walletForm.email.trim(), walletForm.password, { fullName: walletForm.fullName })
        : await signIn(walletForm.email.trim(), walletForm.password);
      if (result.error) throw new Error(result.error.message || 'Could not sign in / sign up.');
      if (result.needsEmailConfirmation) {
        setWalletError('Account created. Check your email to confirm it, then come back to this link and sign in to finish linking your wallet.');
        setWalletBusy(false);
        return;
      }
      const link = await cmmsServiceProviderContractsService.linkServiceProviderWallet(token, credential);
      if (!link.success) throw new Error(link.error || 'Could not link your wallet to this contract.');
      await reload();
    } catch (err) {
      setWalletError(err.message || 'Could not sign in / sign up.');
    }
    setWalletBusy(false);
  };

  const handleGoogleWalletLink = async () => {
    setWalletError('');
    try {
      sessionStorage.setItem(GOOGLE_LINK_PENDING_KEY, JSON.stringify({ token, credential, accessMode }));
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href },
      });
      if (error) throw error;
    } catch (err) {
      sessionStorage.removeItem(GOOGLE_LINK_PENDING_KEY);
      setWalletError(err.message || 'Could not start Google sign-in.');
    }
  };

  const content = info?.content || {};

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center px-4 py-10 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-2xl backdrop-blur">
        {phase === 'loading' && <Loader2 className="w-10 h-10 mx-auto animate-spin text-indigo-300" />}

        {phase === 'invalid' && (
          <div className="text-center">
            <ShieldX className="w-14 h-14 mx-auto mb-4 text-red-400" />
            <h1 className="text-xl font-bold mb-1">Not found</h1>
            <p className="text-slate-400">This link does not match any active contract, or it has been revoked / expired.</p>
          </div>
        )}

        {phase === 'locked' && (
          <div className="text-center">
            <Lock className="w-14 h-14 mx-auto mb-4 text-amber-400" />
            <h1 className="text-xl font-bold mb-1">Too many attempts</h1>
            <p className="text-slate-400">This link is temporarily locked after too many incorrect tries. Please try again in a few minutes.</p>
          </div>
        )}

        {(phase === 'pin_required' || phase === 'email_required') && (
          <div>
            <div className="text-center mb-5">
              {phase === 'pin_required' ? <Lock className="w-12 h-12 mx-auto mb-3 text-indigo-300" /> : <Mail className="w-12 h-12 mx-auto mb-3 text-indigo-300" />}
              <h1 className="text-xl font-bold mb-1">This contract is private</h1>
              <p className="text-slate-400 text-sm">
                {phase === 'pin_required' ? 'Enter the PIN you were given to view it.' : 'Enter the email address this contract was issued to.'}
              </p>
            </div>
            <form onSubmit={handleUnlock} className="space-y-3">
              <input
                type={phase === 'pin_required' ? 'password' : 'email'}
                value={gateInput}
                onChange={(e) => setGateInput(e.target.value)}
                placeholder={phase === 'pin_required' ? 'Enter PIN' : 'you@example.com'}
                className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2.5 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                autoFocus
              />
              {gateError && <p className="text-red-400 text-xs">{gateError}</p>}
              <button
                type="submit"
                disabled={verifying || !gateInput.trim()}
                className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {verifying ? 'Checking...' : 'Unlock'}
              </button>
            </form>
          </div>
        )}

        {phase === 'unlocked' && info && (
          <div>
            <div className="text-center mb-5">
              <BadgeCheck className="w-12 h-12 mx-auto mb-3 text-emerald-400" />
              <h1 className="text-xl font-bold mb-1">{info.title}</h1>
              <p className="text-slate-400 text-sm">Issued by {info.company_name} to {info.provider_name}</p>
            </div>

            <div className="space-y-2 text-sm bg-white/5 rounded-xl p-4 border border-white/10 mb-5">
              {info.job_title && <Row label="Task" value={info.job_title} />}
              {content.scope_of_work && <Row label="Scope of work" value={content.scope_of_work} />}
              {content.rate && <Row label="Rate" value={content.rate} />}
              {content.terms && <Row label="Terms" value={content.terms} />}
              {info.valid_until && <Row label="Access valid until" value={new Date(info.valid_until).toLocaleDateString()} />}
            </div>

            <div className="mb-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-2"><Wallet className="w-4 h-4" /> Payments</h2>
              {!info.payments?.length && <p className="text-slate-500 text-sm">No payments recorded yet.</p>}
              {info.payments?.map((p) => {
                const walletNotSentYet = p.payment_method === 'wallet' && p.wallet_status !== 'completed';
                return (
                  <div key={p.id} className="flex items-center justify-between text-sm border-b border-white/5 py-1.5 gap-2">
                    <span className="text-slate-400">{new Date(p.payment_date).toLocaleDateString()}{p.method ? ` · ${p.method}` : ''}</span>
                    <span className="font-medium shrink-0">{p.currency} {Number(p.amount).toLocaleString()}</span>
                    {p.confirmed_at ? (
                      <span title={`Confirmed ${new Date(p.confirmed_at).toLocaleString()}`} className="flex items-center gap-1 text-emerald-400 text-xs shrink-0"><CheckCircle2 className="w-3.5 h-3.5" /> Received</span>
                    ) : walletNotSentYet ? (
                      <span className={`text-xs shrink-0 ${['rejected', 'cancelled'].includes(p.wallet_status) ? 'text-red-400' : 'text-amber-400'}`}
                        title="The company still needs to send this through their wallet before you can confirm it">
                        {p.wallet_status === 'rejected' ? 'Payment failed' : p.wallet_status === 'cancelled' ? 'Payment cancelled' : 'Not sent yet'}
                      </span>
                    ) : (
                      <button
                        onClick={() => handleConfirmPayment(p.id)}
                        disabled={confirmingId === p.id}
                        className="text-xs px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 shrink-0"
                      >
                        {confirmingId === p.id ? '...' : 'Confirm received'}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="mb-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-2"><Wallet className="w-4 h-4" /> IcanEra Wallet</h2>
              {info.wallet_linked ? (
                <p className="text-emerald-400 text-sm flex items-center gap-1.5"><CheckCircle2 className="w-4 h-4" /> Linked -- the company can pay you directly to your wallet.</p>
              ) : (
                <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <p className="text-slate-400 text-xs mb-3">Sign in or create a free IcanEra Wallet account so this company can pay you straight into your wallet, instead of only cash.</p>
                  <button type="button" onClick={handleGoogleWalletLink}
                    className="w-full mb-3 rounded-lg bg-white text-slate-800 py-2 text-sm font-semibold hover:bg-slate-100">
                    Continue with Google
                  </button>
                  <div className="flex items-center gap-2 mb-3 text-[11px] text-slate-500"><div className="flex-1 h-px bg-white/10" />or<div className="flex-1 h-px bg-white/10" /></div>
                  <div className="flex gap-2 mb-3">
                    <button type="button" onClick={() => setWalletMode('signin')} className={`flex-1 text-xs py-1.5 rounded border ${walletMode === 'signin' ? 'bg-indigo-600 border-indigo-500' : 'bg-white/5 border-white/10 text-slate-400'}`}>Sign in</button>
                    <button type="button" onClick={() => setWalletMode('signup')} className={`flex-1 text-xs py-1.5 rounded border ${walletMode === 'signup' ? 'bg-indigo-600 border-indigo-500' : 'bg-white/5 border-white/10 text-slate-400'}`}>Create account</button>
                  </div>
                  <form onSubmit={handleWalletAuth} className="space-y-2">
                    {walletMode === 'signup' && (
                      <input type="text" value={walletForm.fullName} onChange={(e) => setWalletForm({ ...walletForm, fullName: e.target.value })}
                        placeholder="Full name" className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm placeholder:text-slate-500" />
                    )}
                    <input type="email" required value={walletForm.email} onChange={(e) => setWalletForm({ ...walletForm, email: e.target.value })}
                      placeholder="you@example.com" className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm placeholder:text-slate-500" />
                    <input type="password" required value={walletForm.password} onChange={(e) => setWalletForm({ ...walletForm, password: e.target.value })}
                      placeholder="Password" className="w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm placeholder:text-slate-500" />
                    {walletError && <p className="text-red-400 text-xs">{walletError}</p>}
                    <button type="submit" disabled={walletBusy} className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 py-2 text-sm font-semibold disabled:opacity-50">
                      {walletBusy ? 'Working...' : walletMode === 'signup' ? 'Create account & link wallet' : 'Sign in & link wallet'}
                    </button>
                  </form>
                </div>
              )}
            </div>

            <div className="mb-5">
              <h2 className="text-sm font-semibold text-slate-300 mb-2 flex items-center gap-2"><MessageSquarePlus className="w-4 h-4" /> Follow-ups</h2>
              {!info.followups?.length && <p className="text-slate-500 text-sm">No follow-up notes yet.</p>}
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {info.followups?.map((f, i) => (
                  <div key={i} className="text-sm bg-white/5 rounded-lg p-2.5 border border-white/10">
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-semibold ${f.author_type === 'provider' ? 'text-indigo-300' : 'text-emerald-300'}`}>
                        {f.author_type === 'provider' ? 'You' : 'Company'}
                      </span>
                      <span className="text-xs text-slate-500">{new Date(f.created_at).toLocaleString()}</span>
                    </div>
                    <p className="text-slate-200">{f.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <form onSubmit={handlePostFollowup} className="flex gap-2">
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Post a progress update..."
                className="flex-1 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <button
                type="submit"
                disabled={posting || !note.trim()}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {posting ? '...' : 'Post'}
              </button>
            </form>
            {postError && <p className="text-red-400 text-xs mt-2">{postError}</p>}
          </div>
        )}
      </section>
    </main>
  );
};

const Row = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3"><span className="text-slate-500 shrink-0">{label}</span><span className="font-medium text-right">{value}</span></div>
);

export default PublicServiceProviderContract;
