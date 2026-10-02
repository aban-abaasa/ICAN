import React, { useEffect, useState } from 'react';
import { BadgeCheck, Clock, Loader2, ShieldAlert, ShieldX } from 'lucide-react';
import { getSupabase } from '../services/pitchingService';

/**
 * Standalone public page at /verify-agreement?id=&k=&s= (see main.jsx) -- what
 * scanning the QR on a printed investment agreement opens. No login. Calls the
 * anon-callable fn_verify_investment_agreement RPC
 * (backend/ADD_INVESTMENT_AGREEMENT_SEAL_VERIFY.sql) and shows the live record:
 * status, who signed and when, and whether the printed copy still matches it.
 */
const fmt = (v) => (v ? new Date(v).toLocaleString() : '—');

const PublicAgreementVerify = () => {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id') || '';
  const key = params.get('k') || '';
  const seal = params.get('s') || '';
  const [state, setState] = useState('loading'); // loading | found | missing | error
  const [info, setInfo] = useState(null);

  useEffect(() => {
    if (!id || !key) { setState('missing'); return; }
    getSupabase()
      .rpc('fn_verify_investment_agreement', { p_agreement_id: id, p_key: key, p_seal: seal || null })
      .then(({ data, error }) => {
        if (error) { setState('error'); return; }
        if (!data?.found) { setState('missing'); return; }
        setInfo(data);
        setState('found');
      })
      .catch(() => setState('error'));
  }, [id, key, seal]);

  const sealed = info?.status === 'sealed';
  const refunded = info?.status === 'expired';

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center px-4 py-10 text-white">
      <section className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-900/80 p-7 shadow-2xl backdrop-blur">
        {state === 'loading' && <Loader2 className="w-10 h-10 mx-auto animate-spin text-indigo-300" />}

        {state === 'found' && (
          <>
            <div className="text-center">
              {sealed ? (
                <BadgeCheck className="w-14 h-14 mx-auto mb-3 text-emerald-400" />
              ) : refunded ? (
                <ShieldAlert className="w-14 h-14 mx-auto mb-3 text-red-400" />
              ) : (
                <Clock className="w-14 h-14 mx-auto mb-3 text-amber-400" />
              )}
              <h1 className="text-xl font-bold mb-1">
                {sealed ? 'Genuine, sealed agreement' : refunded ? 'Agreement refunded' : 'Awaiting shareholder approval'}
              </h1>
              <p className="text-slate-400 text-sm mb-5">
                {sealed
                  ? `Approved by ${info.signed_count} of ${info.total_members} registered members of ${info.business_name}.`
                  : refunded
                    ? 'The approval window passed without reaching 60%, so the investment was refunded.'
                    : `${info.signed_count} of ${info.total_members} registered members have approved so far. 60% is required.`}
              </p>
            </div>

            <div className="space-y-2 text-sm bg-white/5 rounded-xl p-4 border border-white/10">
              <Row label="Business" value={info.business_name} />
              <Row label="Investor" value={info.investor_name} />
              <Row
                label="Investment"
                value={Number(info.shares_amount) > 0 ? `${info.shares_amount} shares` : info.investment_type === 'guarantor' ? 'Guarantee' : 'Partnership'}
              />
              <Row label="Amount" value={`${(Number(info.total_investment) || 0).toFixed(2)} IcanEra`} />
              <Row label="Signed" value={fmt(info.created_at)} />
              {info.sealed_at && <Row label="Sealed" value={fmt(info.sealed_at)} />}
              <Row label="Seal code" value={<span className="font-mono">{info.seal_code}</span>} />
            </div>

            <h2 className="text-sm font-semibold text-slate-300 mt-5 mb-2">Signatures</h2>
            <ul className="space-y-2">
              {(info.signers || []).map((s, i) => (
                <li key={i} className="flex items-center justify-between gap-3 text-sm bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.role} · {fmt(s.signed_at)}</p>
                    <p className="text-xs text-slate-500">Location: {s.location || 'not recorded'}</p>
                    {s.bio && <p className="text-xs text-slate-400 italic mt-1 line-clamp-3">{s.bio}</p>}
                  </div>
                  <span className="text-emerald-400 text-xs font-bold">SIGNED</span>
                </li>
              ))}
              {(info.signers || []).length === 0 && <li className="text-sm text-slate-500">No signatures recorded yet.</li>}
            </ul>

            {seal && (
              <div
                className={`mt-5 text-sm rounded-xl p-3 border ${
                  info.copy_matches
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                }`}
              >
                {info.copy_matches
                  ? 'This printed copy matches the current record.'
                  : 'The record has changed since this copy was printed (for example more members have signed). Compare the seal code above with the one on your copy.'}
              </div>
            )}
          </>
        )}

        {state === 'missing' && (
          <div className="text-center">
            <ShieldX className="w-14 h-14 mx-auto mb-4 text-red-400" />
            <h1 className="text-xl font-bold mb-1">Not found</h1>
            <p className="text-slate-400">This QR code does not match any agreement we hold. It may be invalid or altered.</p>
          </div>
        )}

        {state === 'error' && (
          <div className="text-center">
            <ShieldAlert className="w-14 h-14 mx-auto mb-4 text-amber-400" />
            <h1 className="text-xl font-bold mb-1">Could not check</h1>
            <p className="text-slate-400">We couldn't reach the server. Please check your connection and scan again.</p>
          </div>
        )}
      </section>
    </main>
  );
};

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3">
    <span className="text-slate-500">{label}</span>
    <span className="font-medium text-right">{value}</span>
  </div>
);

export default PublicAgreementVerify;
