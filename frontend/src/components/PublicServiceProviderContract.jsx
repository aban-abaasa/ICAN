import React, { useEffect, useState } from 'react';
import { BadgeCheck, Lock, Loader2, Mail, MessageSquarePlus, ShieldX, Wallet } from 'lucide-react';
import cmmsServiceProviderContractsService from '../services/cmmsServiceProviderContractsService';

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

  useEffect(() => {
    if (!token) { setPhase('invalid'); return; }
    cmmsServiceProviderContractsService.getServiceProviderContractGateStatus(token).then((result) => {
      if (!result.success) { setPhase('invalid'); return; }
      setPhase(result.data.status);
      if (result.data.access_mode) setAccessMode(result.data.access_mode);
    });
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
              {info.payments?.map((p, i) => (
                <div key={i} className="flex items-center justify-between text-sm border-b border-white/5 py-1.5">
                  <span className="text-slate-400">{new Date(p.payment_date).toLocaleDateString()}{p.method ? ` · ${p.method}` : ''}</span>
                  <span className="font-medium">{p.currency} {Number(p.amount).toLocaleString()}</span>
                </div>
              ))}
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
