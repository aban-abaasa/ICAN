import React, { useEffect, useState } from 'react';
import { BadgeCheck, Loader2, MessageSquarePlus, ShieldX, Wallet } from 'lucide-react';
import cmmsServiceProviderContractsService from '../services/cmmsServiceProviderContractsService';

/**
 * Standalone public page at /service-provider-contract?token=<access_token>
 * (see main.jsx) -- the ONLY thing an outside contractor with no CMMS/ICAN
 * account ever opens. No login, no providers, same reasoning as
 * PublicDocumentVerify.jsx. Shows the contract, its task, its follow-up
 * history, and its payment/transaction history -- nothing else -- via the
 * anon-callable fn_get_service_provider_contract_public RPC. The contractor
 * can post their own follow-up note through fn_add_service_provider_followup.
 */
const PublicServiceProviderContract = () => {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [state, setState] = useState('loading'); // loading | valid | invalid | error
  const [info, setInfo] = useState(null);
  const [note, setNote] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');

  const load = () => {
    if (!token) { setState('error'); return; }
    cmmsServiceProviderContractsService.getServiceProviderContractPublic(token).then((result) => {
      if (!result.success) { setState('error'); return; }
      setInfo(result.data);
      setState(result.data.is_valid ? 'valid' : 'invalid');
    });
  };

  useEffect(load, [token]);

  const handlePostFollowup = async (event) => {
    event.preventDefault();
    if (!note.trim()) return;
    setPosting(true);
    setPostError('');
    const result = await cmmsServiceProviderContractsService.addServiceProviderFollowupPublic(token, note.trim());
    setPosting(false);
    if (!result.success) { setPostError(result.error || 'Could not post your update.'); return; }
    setNote('');
    load();
  };

  const content = info?.content || {};

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center px-4 py-10 text-white">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-2xl backdrop-blur">
        {state === 'loading' && <Loader2 className="w-10 h-10 mx-auto animate-spin text-indigo-300" />}

        {state === 'error' && (
          <div className="text-center">
            <ShieldX className="w-14 h-14 mx-auto mb-4 text-red-400" />
            <h1 className="text-xl font-bold mb-1">Not found</h1>
            <p className="text-slate-400">This link does not match any contract we've issued. It may be invalid or have been mistyped.</p>
          </div>
        )}

        {state === 'invalid' && (
          <div className="text-center">
            <ShieldX className="w-14 h-14 mx-auto mb-4 text-amber-400" />
            <h1 className="text-xl font-bold mb-1">Link no longer active</h1>
            <p className="text-slate-400">This contract from {info?.company_name || 'the company'} has been revoked or its access period has ended. Contact them directly if you believe this is a mistake.</p>
          </div>
        )}

        {state === 'valid' && (
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
