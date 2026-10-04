import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Car, CheckCircle, ChevronDown, Clock, LogIn, LogOut, RefreshCw, UserCheck, XCircle } from 'lucide-react';
import {
  decideVisitorVehicleApproval,
  getVehiclePhotoUrl,
  getVisitorApprovers,
  getVisitorVehicleApprovals,
  purgeVehiclePhotos,
  setVisitorApprover
} from '../services/cmmsVisitorVehicleService';

const STAGES = { check_in: { label: 'Entry', Icon: LogIn }, check_out: { label: 'Exit', Icon: LogOut } };
const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

const friendlyError = (rpcError) => {
  const message = rpcError?.message || '';
  if (rpcError?.code === 'PGRST202' || /could not find the function|schema cache/i.test(message)) {
    return 'Vehicle approvals have not been deployed to Supabase yet. Run backend/CMMS_VISITOR_VEHICLE_APPROVAL.sql in the Supabase SQL Editor, then retry.';
  }
  return message || 'Something went wrong. Please try again.';
};

// The bucket is private, so a photo is only ever shown through a short-lived signed URL.
export const VehiclePhoto = ({ path, alt = 'Vehicle photo' }) => {
  const [url, setUrl] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    let active = true;
    setState('loading');
    getVehiclePhotoUrl(path).then((signed) => {
      if (!active) return;
      setUrl(signed);
      setState(signed ? 'ready' : 'missing');
    });
    return () => { active = false; };
  }, [path]);

  if (state === 'loading') return <div className="h-28 w-40 animate-pulse rounded-lg bg-white/10" aria-label="Loading photo" />;
  if (state === 'missing') return <p className="text-xs cmms-classic-muted">Photo unavailable</p>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" title="Open full size" className="inline-block">
      <img src={url} alt={alt} loading="lazy" className="max-h-40 rounded-lg border border-white/20 object-cover" />
    </a>
  );
};

const CMMSVisitorVehicleApprovals = ({ companyId, canManageApprovers, onPendingChange, onDecided }) => {
  const [pending, setPending] = useState([]);
  const [history, setHistory] = useState([]);
  const [approvers, setApprovers] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showApprovers, setShowApprovers] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [declining, setDeclining] = useState({}); // approval_id -> reason, while its decline box is open

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const [pendingRes, historyRes] = await Promise.all([
      getVisitorVehicleApprovals(companyId, 'pending'),
      getVisitorVehicleApprovals(companyId, 'decided')
    ]);
    const failed = pendingRes.error || historyRes.error;
    setError(failed ? friendlyError(failed) : '');
    setPending(pendingRes.data);
    setHistory(historyRes.data);
    onPendingChange?.(pendingRes.data.filter((row) => row.assigned_to_me).length);
    setLoading(false);
  }, [companyId]);

  const loadApprovers = useCallback(async () => {
    if (!companyId || !canManageApprovers) return;
    const { data, error: approversError } = await getVisitorApprovers(companyId);
    if (approversError) setError(friendlyError(approversError));
    setApprovers(data);
  }, [companyId, canManageApprovers]);

  // A new request can land at any moment, so the queue refreshes itself while open.
  useEffect(() => {
    load();
    const timer = setInterval(load, 20000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => { loadApprovers(); }, [loadApprovers]);

  const decide = async (item, approve) => {
    const note = (declining[item.approval_id] || '').trim();
    if (!approve && !note) {
      setError('Please give a reason for declining — the visitor will see it.');
      return;
    }
    setBusyId(item.approval_id);
    setError('');
    const { data, error: decideError } = await decideVisitorVehicleApproval(item.approval_id, approve, approve ? null : note);
    if (decideError) {
      setError(friendlyError(decideError));
    } else {
      setDeclining(({ [item.approval_id]: _closed, ...rest }) => rest);
      // The visit is over, so its photo can go from Storage right away.
      if (data?.purge_photo) await purgeVehiclePhotos(companyId);
      onDecided?.();
      await load();
    }
    setBusyId(null);
  };

  const toggleApprover = async (row) => {
    setBusyId(row.cmms_user_id);
    setError('');
    // Flip the tick straight away; the reload below puts the server's truth back if the change failed.
    setApprovers((rows) => rows.map((r) => (r.cmms_user_id === row.cmms_user_id ? { ...r, is_approver: !r.is_approver } : r)));
    const { error: toggleError } = await setVisitorApprover(companyId, row.cmms_user_id, !row.is_approver);
    if (toggleError) setError(friendlyError(toggleError));
    await Promise.all([loadApprovers(), load()]);
    setBusyId(null);
  };

  const approverCount = approvers.filter((row) => row.is_approver).length;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex gap-3 rounded-lg border border-red-500/50 bg-red-500/20 p-4 text-red-200">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {canManageApprovers && (
        <section className="cmms-sec cmms-accent-navy" data-open={showApprovers}>
          <button type="button" onClick={() => setShowApprovers((open) => !open)} aria-expanded={showApprovers}
            className="flex w-full items-center gap-3 text-left !bg-transparent" style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
            <span className="cmms-medallion"><UserCheck className="h-4 w-4" aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="cmms-classic-heading cmms-sec-title block">Who approves vehicles?</span>
              <span className="block truncate text-xs cmms-classic-muted">
                {approverCount ? `${approverCount} approver${approverCount === 1 ? '' : 's'} · requests take turns` : 'Nobody chosen · approvals are off'}
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 flex-shrink-0 cmms-classic-muted transition-transform duration-300 ${showApprovers ? 'rotate-180' : ''}`} />
          </button>
          {showApprovers && (
            <div className="cmms-sec-body mt-4 space-y-3">
              <p className="text-xs cmms-classic-muted">
                A visitor who comes with a vehicle (a vehicle number or photo) needs approval to enter and again to leave.
                Each request goes to the next person you tick below, so the duty rotates. With nobody ticked, approvals are off.
                Approvers need the Visitor Management tool in their role to see their requests.
              </p>
              <ul className="space-y-1.5">
                {approvers.map((row) => (
                  <li key={row.cmms_user_id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-white/10 px-3 py-2">
                      <input type="checkbox" checked={row.is_approver} disabled={busyId === row.cmms_user_id}
                        onChange={() => toggleApprover(row)} className="h-4 w-4" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{row.user_name}</span>
                        <span className="block truncate text-xs cmms-classic-muted">
                          {row.email}
                          {row.is_approver ? ` · ${row.pending_count} waiting${row.last_assigned_at ? ` · last assigned ${fmtWhen(row.last_assigned_at)}` : ' · next in line'}` : ''}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">
          {pending.length ? `${pending.length} waiting for approval` : 'Nothing waiting for approval'}
        </p>
        <button type="button" onClick={load} disabled={loading} className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary flex items-center gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {pending.length === 0 ? (
        <div className="py-10 text-center text-gray-400">
          <Car className="mx-auto mb-3 h-12 w-12 opacity-50" />
          <p>No vehicle approvals are waiting.</p>
          {canManageApprovers && approvers.length > 0 && approverCount === 0 && (
            <p className="mt-1 text-xs">Approvals are off until you choose at least one approver above.</p>
          )}
        </div>
      ) : (
        <ul className="grid gap-2.5 lg:grid-cols-2">
          {pending.map((item) => {
            const stage = STAGES[item.stage] || STAGES.check_in;
            const StageIcon = stage.Icon;
            const decliningNow = declining[item.approval_id] !== undefined;
            const busy = busyId === item.approval_id;
            return (
              <li key={item.approval_id} className="cmms-staff-card space-y-2.5">
                <div className="flex items-start gap-3">
                  <span className="cmms-monogram"><StageIcon className="h-4 w-4" aria-hidden="true" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{item.visitor_name}</p>
                    <p className="truncate text-xs cmms-classic-muted">{stage.label} request · {fmtWhen(item.requested_at)}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {item.vehicle_number && <span className="cmms-classic-chip !normal-case inline-flex items-center gap-1"><Car className="h-3 w-3" /> {item.vehicle_number}</span>}
                      {item.host_name && <span className="cmms-classic-chip !normal-case">Host: {item.host_name}</span>}
                      <span className="cmms-classic-chip !normal-case inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" /> {item.assigned_to_me ? 'Assigned to you' : item.assigned_name ? `Assigned to ${item.assigned_name}` : 'No approver assigned'}
                      </span>
                    </div>
                  </div>
                </div>

                <dl className="cmms-field-list">
                  {item.visitor_phone && <div className="cmms-field-row"><dt>Phone</dt><dd>{item.visitor_phone}</dd></div>}
                  {item.purpose && <div className="cmms-field-row"><dt>Purpose</dt><dd>{item.purpose}</dd></div>}
                  <div className="cmms-field-row"><dt>Location</dt><dd>{item.check_in_location || '-'}</dd></div>
                  <div className="cmms-field-row"><dt>Arrived</dt><dd>{fmtWhen(item.check_in_time)}</dd></div>
                </dl>

                {item.vehicle_photo_path && <VehiclePhoto path={item.vehicle_photo_path} alt={`Vehicle of ${item.visitor_name}`} />}

                {decliningNow ? (
                  <div className="space-y-2">
                    <label className="block text-xs font-semibold cmms-classic-muted">
                      Reason (the visitor will see this)
                      <textarea rows={2} value={declining[item.approval_id]} autoFocus
                        onChange={(e) => setDeclining((current) => ({ ...current, [item.approval_id]: e.target.value }))}
                        placeholder={item.stage === 'check_in' ? 'e.g. Plate does not match the booking' : 'e.g. Please wait for security to check the vehicle'}
                        className="mt-1 w-full rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm" />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={() => decide(item, false)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50">
                        <XCircle className="h-3.5 w-3.5" /> {busy ? 'Declining…' : 'Confirm decline'}
                      </button>
                      <button type="button" disabled={busy}
                        onClick={() => setDeclining(({ [item.approval_id]: _closed, ...rest }) => rest)}
                        className="!h-auto !min-h-0 !px-3 !py-1.5 text-xs cmms-classic-btn-secondary">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button type="button" disabled={busy} onClick={() => decide(item, true)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                      <CheckCircle className="h-3.5 w-3.5" /> {busy ? 'Approving…' : item.stage === 'check_in' ? 'Approve entry' : 'Approve exit'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setDeclining((current) => ({ ...current, [item.approval_id]: '' }))}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/60 px-3 py-1.5 text-xs font-semibold text-red-500 hover:bg-red-500/10 disabled:opacity-50">
                      <XCircle className="h-3.5 w-3.5" /> Decline
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <section className="cmms-sec cmms-accent-gold" data-open={showHistory}>
        <button type="button" onClick={() => setShowHistory((open) => !open)} aria-expanded={showHistory}
          className="flex w-full items-center gap-3 text-left !bg-transparent" style={{ background: 'transparent', border: 0, padding: 0, boxShadow: 'none' }}>
          <span className="min-w-0 flex-1">
            <span className="cmms-classic-heading cmms-sec-title block">Recent decisions</span>
            <span className="block truncate text-xs cmms-classic-muted">{history.length ? `${history.length} most recent` : 'None yet'}</span>
          </span>
          <ChevronDown className={`h-4 w-4 flex-shrink-0 cmms-classic-muted transition-transform duration-300 ${showHistory ? 'rotate-180' : ''}`} />
        </button>
        {showHistory && (
          <ul className="cmms-sec-body mt-4 space-y-2">
            {history.length === 0 && <li className="text-sm cmms-classic-muted">Nothing has been decided yet.</li>}
            {history.map((item) => (
              <li key={item.approval_id} className="rounded-lg border border-white/10 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{item.visitor_name}</span>
                  <span className="cmms-classic-chip !normal-case">{(STAGES[item.stage] || STAGES.check_in).label}</span>
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={item.status === 'approved' ? { background: 'rgba(16,185,129,0.15)', color: '#047857' } : { background: 'rgba(239,68,68,0.13)', color: '#dc2626' }}>
                    {item.status === 'approved' ? '✓ Approved' : '✕ Declined'}
                  </span>
                </div>
                <p className="mt-0.5 text-xs cmms-classic-muted">
                  {item.vehicle_number ? `${item.vehicle_number} · ` : ''}by {item.decided_by_name || 'staff'} · {fmtWhen(item.decided_at)}
                  {item.decision_note ? ` · “${item.decision_note}”` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

export default CMMSVisitorVehicleApprovals;
