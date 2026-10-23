import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, BadgeCheck, RefreshCw, ShieldCheck } from 'lucide-react';
import { devNationalId } from '../services/nationalIdService';
import { resolveMediaValues } from '../services/r2StorageService';

/**
 * ID checks tab of the ICAN dev panel: people asking a reviewer to confirm that a national ID is really theirs
 * (backend/NATIONAL_ID_OWNERSHIP.sql). Talks to ican_id_dev_list / ican_id_dev_review with the panel's dev token, like every other tab.
 *
 *   verify  the person says the ID already saved on their wallet is theirs.
 *   claim   the person says an ID someone else saved first is really theirs. Approving MOVES the ID to them and the
 *           earlier holder is left with no ID; if that holder is already verified it needs an explicit second confirmation.
 *
 * The photos are shown through the app's existing storage preview route. The ID number itself is never available, only its
 * last four characters: compare the photo with the name and the last four.
 */

const card = { background: 'var(--dp-card)', borderColor: 'var(--dp-card-bd)' };
const field = { background: 'var(--dp-inner)', borderColor: 'var(--dp-inner-bd)', color: 'var(--dp-txt)' };
const FILTERS = [['pending', 'Waiting'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']];

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

function Photo({ src, label }) {
  if (!src || !/^https?:/.test(src)) return <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>{label}: not available</p>;
  return (
    <a href={src} target="_blank" rel="noopener noreferrer" className="block">
      <img src={src} alt={label} className="h-40 w-full rounded-lg border object-contain" style={{ borderColor: 'var(--dp-inner-bd)', background: 'var(--dp-inner)' }} />
      <span className="mt-1 block text-xs" style={{ color: 'var(--dp-muted)' }}>{label} · open full size</span>
    </a>
  );
}

function CheckCard({ check, devToken, onDecided }) {
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pending = check.status === 'pending';
  const claim = check.kind === 'claim';
  const holder = check.holder;
  const holderVerified = !!holder?.verified;

  const decide = async (approve) => {
    if (approve && claim && holder && !window.confirm(`Move this ID to ${check.walletName || 'this person'}? ${holder.walletName || 'The earlier holder'} will be left with no ID.`)) return;
    setBusy(true);
    setError('');
    try {
      const res = await devNationalId.review(devToken, { checkId: check.id, approve, note: reason, replaceVerified: override });
      if (res.missing) { setError('The ID ownership SQL is not installed.'); return; }
      onDecided();
    } catch (e) {
      setError(e.message || 'That did not work.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="rounded-xl border p-4 space-y-3" style={card}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${claim ? 'bg-amber-500/20 text-amber-400' : 'bg-sky-500/20 text-sky-400'}`}>
            {claim ? 'Claim: ID saved by someone else' : 'Verify own ID'}
          </span>
          {!pending && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${check.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
              {check.status}
            </span>
          )}
        </div>
        <span className="text-xs" style={{ color: 'var(--dp-muted)' }}>{when(check.createdAt)}</span>
      </header>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Wallet name</dt><dd style={{ color: 'var(--dp-txt)' }}>{check.walletName || '—'}</dd></div>
        <div>
          <dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Name on the ID (typed)</dt>
          <dd style={{ color: 'var(--dp-txt)' }}>{check.nameOnId}</dd>
          <dd className={`text-xs ${!check.walletName ? '' : check.nameMatchesWallet ? 'text-emerald-400' : 'text-red-400'}`} style={check.walletName ? undefined : { color: 'var(--dp-muted)' }}>
            {!check.walletName ? 'no wallet name yet' : check.nameMatchesWallet ? '✓ fits the wallet name' : '✗ does not fit the wallet name'}
          </dd>
        </div>
        <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>ID</dt><dd style={{ color: 'var(--dp-txt)' }}>{check.country} · {check.idType} ending {check.last4}</dd></div>
        <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Contact</dt><dd className="break-all" style={{ color: 'var(--dp-txt)' }}>{check.phone || '—'}{check.email ? ` · ${check.email}` : ''}</dd></div>
        <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Wallet country</dt><dd style={{ color: 'var(--dp-txt)' }}>{check.accountCountry || '—'}</dd></div>
        <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Wallet opened</dt><dd style={{ color: 'var(--dp-txt)' }}>{when(check.walletCreatedAt)}</dd></div>
      </dl>

      {check.note && <p className="text-sm" style={{ color: 'var(--dp-txt)' }}><span className="text-xs" style={{ color: 'var(--dp-muted)' }}>Their note: </span>{check.note}</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Photo src={check.idPhoto} label="Photo of the ID" />
        <Photo src={check.selfie} label="Selfie holding the ID" />
      </div>

      {claim && pending && (
        <div className="rounded-lg border p-3 text-sm" style={{ ...field, borderColor: holderVerified ? 'rgba(239,68,68,0.5)' : 'var(--dp-inner-bd)' }}>
          {holder ? (
            <>
              <p className="flex items-center gap-1 font-semibold">
                {holderVerified ? <BadgeCheck className="h-4 w-4 text-emerald-400" /> : <AlertTriangle className="h-4 w-4 text-amber-400" />}
                Held now by {holder.walletName || 'another wallet'} · {holderVerified ? 'VERIFIED' : 'not verified'}
              </p>
              <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>
                Saved {when(holder.savedAt)} · {holder.phone || '—'}{holder.email ? ` · ${holder.email}` : ''}
              </p>
              {holderVerified && (
                <label className="mt-2 flex items-start gap-2 text-xs text-red-300">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} className="mt-0.5" />
                  <span>I am certain this person, not the verified holder, owns the ID. Take it from the verified holder.</span>
                </label>
              )}
            </>
          ) : <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>Nobody holds this ID any more.</p>}
        </div>
      )}
      {pending && check.competing > 0 && (
        <p className="text-xs text-amber-400">{check.competing} other request{check.competing === 1 ? '' : 's'} on the same ID {check.competing === 1 ? 'is' : 'are'} waiting too. Decide them together.</p>
      )}

      {pending ? (
        <div className="space-y-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Note (kept; required when rejecting, shown to the person)"
            maxLength={500}
            className="w-full rounded-lg border px-3 py-2 text-sm"
            style={field}
            aria-label="Note for the decision"
          />
          {error && <p className="text-sm text-red-400" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || (!!check.walletName && !check.nameMatchesWallet) || (claim && holderVerified && !override)} onClick={() => decide(true)}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-500 disabled:opacity-40">Approve</button>
            <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => decide(false)}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-40">Reject</button>
          </div>
        </div>
      ) : (
        <p className="text-xs" style={{ color: 'var(--dp-muted)' }}>
          Decided {when(check.reviewedAt)} by {check.reviewedBy || '—'}{check.reviewNote ? ` · ${check.reviewNote}` : ''}
        </p>
      )}
    </article>
  );
}

export default function ICANIdChecksDevTab({ devToken }) {
  const [filter, setFilter] = useState('pending');
  const [data, setData] = useState(null);
  const [missing, setMissing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    try {
      const res = await devNationalId.list(devToken, filter);
      if (res.missing) { setMissing(true); return; }
      const checks = await resolveMediaValues(res.data.checks || [], ['idPhoto', 'selfie']);
      setData({ ...res.data, checks });
    } catch (e) {
      setError(e.message || 'Could not load.');
    } finally {
      setLoading(false);
    }
  }, [devToken, filter]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  if (loading) return <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>Loading…</p>;
  if (missing) return <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>ID ownership is not installed yet. Run NATIONAL_ID_PER_COUNTRY.sql and then NATIONAL_ID_OWNERSHIP.sql in Supabase.</p>;
  if (!data) return <p className="text-sm text-red-400">{error || 'Nothing to show.'}</p>;

  const { counts = {}, policy = {} } = data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-bold" style={{ color: 'var(--dp-txt)' }}><ShieldCheck className="h-5 w-5 text-cyan-400" />ID checks</h2>
        <button type="button" onClick={load} className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs" style={field}><RefreshCw className="h-3.5 w-3.5" />Refresh</button>
      </div>
      {error && <p className="text-sm text-red-400" role="alert">{error}</p>}

      <div className="rounded-xl border p-4" style={card}>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Waiting for a decision</dt><dd className="font-semibold" style={{ color: 'var(--dp-txt)' }}>{counts.pending ?? 0}</dd></div>
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Verified IDs</dt><dd style={{ color: 'var(--dp-txt)' }}>{counts.verifiedIds ?? 0}</dd></div>
          <div><dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Saved, not verified</dt><dd style={{ color: 'var(--dp-txt)' }}>{counts.unverifiedIds ?? 0}</dd></div>
          <div>
            <dt className="text-xs" style={{ color: 'var(--dp-muted)' }}>Rules in force</dt>
            <dd style={{ color: 'var(--dp-txt)' }}>{!policy.enforced ? 'ID not required yet' : policy.requireVerified ? 'Verified ID required to send' : 'ID required to send'}</dd>
          </div>
        </dl>
        <p className="mt-2 text-xs" style={{ color: 'var(--dp-muted)' }}>
          Turn the rules on or off with SQL (see NATIONAL_ID_PER_COUNTRY.sql): <code>enforced</code> asks every wallet for an ID before money leaves it;
          <code> require_verified</code> goes further and asks for a verified one. Switch <code>require_verified</code> on only when the waiting list is short.
        </p>
      </div>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter requests">
        {FILTERS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)}
            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${filter === id ? 'bg-cyan-600 text-white' : ''}`} style={filter === id ? undefined : field}>{label}</button>
        ))}
      </div>

      {data.checks.length === 0 && <p className="text-sm" style={{ color: 'var(--dp-muted)' }}>Nothing here.</p>}
      {data.checks.map((check) => <CheckCard key={check.id} check={check} devToken={devToken} onDecided={load} />)}
    </div>
  );
}
