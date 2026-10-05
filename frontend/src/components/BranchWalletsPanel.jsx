import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, CircleDot, Landmark, Loader, Lock, ShieldCheck, Snowflake, Trash2, UserPlus, X } from 'lucide-react';
import { getOwnershipChain } from '../services/businessOwnershipService';
import {
  APPROVER_LEVELS,
  OPERATION_LABELS,
  assignApprover,
  decideRequest,
  formatIcan,
  getMyPendingApprovals,
  getMyPinStatus,
  getWalletEvents,
  getWalletOverview,
  listApprovers,
  proposeFunding,
  proposeSweep,
  removeApprover,
  runDueAllowances,
  setAllowance,
  setMyApprovalPin,
  setWalletPolicy,
  setWalletStatus
} from '../services/branchWalletService';

const input = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white';
const smallBtn = 'rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50';

// One step of the approval ladder: done / waiting / not needed
function Step({ label, have, required, state }) {
  const tone = state === 'done' ? 'border-emerald-600/60 bg-emerald-900/20 text-emerald-300'
    : state === 'skip' ? 'border-slate-800 bg-slate-900/40 text-slate-600'
    : 'border-amber-600/50 bg-amber-900/10 text-amber-200';
  return (
    <div className={`flex-1 rounded-lg border px-2 py-1.5 text-center text-[11px] ${tone}`}>
      <span className="block font-semibold">{label}</span>
      <span>{state === 'skip' ? 'not needed' : state === 'owner' ? 'owners, with PIN' : `${have}/${required}`}</span>
    </div>
  );
}

function Ladder({ stage }) {
  if (!stage?.ladder) return null;
  const mother = stage.mother || {};
  return (
    <div className="mt-2 flex items-stretch gap-1.5">
      <Step label="Branch" have={stage.branch.have} required={stage.branch.required} state={stage.branch.ok ? 'done' : 'wait'} />
      <span className="self-center text-slate-600">›</span>
      <Step label="Mother" have={mother.have} required={mother.required} state={!mother.needed ? 'skip' : mother.ok ? 'done' : 'wait'} />
      {stage.owner_needed && (<><span className="self-center text-slate-600">›</span><Step label="Owners" state="owner" /></>)}
    </div>
  );
}

// ---------------------------------------------------------------- my approvals
function MyApprovals({ onDone }) {
  const [pin, setPin] = useState({ loading: true, has: false });
  const [items, setItems] = useState([]);
  const [pins, setPins] = useState({});
  const [setup, setSetup] = useState({ a: '', b: '' });
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const [status, pending] = await Promise.all([getMyPinStatus(), getMyPendingApprovals()]);
    setPin({ loading: false, has: Boolean(status.data?.has_pin) });
    setItems(pending.data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const savePin = async (event) => {
    event.preventDefault();
    if (setup.a !== setup.b) { setError('The two PINs do not match.'); return; }
    setBusy('pin'); setError('');
    const { error: pinError } = await setMyApprovalPin(setup.a);
    setBusy('');
    if (pinError) { setError(pinError.message); return; }
    setSetup({ a: '', b: '' });
    load();
  };

  const decide = async (item, decision) => {
    setBusy(item.transaction_id);
    setMessage((previous) => ({ ...previous, [item.transaction_id]: '' }));
    const { data, error: decideError } = await decideRequest(item.transaction_id, decision, pins[item.transaction_id] || '');
    setBusy('');
    const text = decideError ? decideError.message : data?.success === false ? (data.error || 'Not completed') : null;
    if (text) { setMessage((previous) => ({ ...previous, [item.transaction_id]: text })); return; }
    setPins((previous) => ({ ...previous, [item.transaction_id]: '' }));
    await load();
    onDone?.();
  };

  if (pin.loading) return null;
  if (!pin.has && items.length === 0) return null;   // not an approver and nothing waiting: stay out of the way

  return (
    <section className="rounded-xl border border-amber-700/40 bg-amber-900/5 p-3">
      <p className="mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide text-amber-300"><ShieldCheck size={14} /> MY APPROVALS {items.length > 0 && <span className="rounded-full bg-amber-500 px-2 text-[10px] text-slate-900">{items.length}</span>}</p>

      {!pin.has && (
        <form onSubmit={savePin} className="mb-3 space-y-2 rounded-lg border border-slate-700 bg-slate-950/60 p-3">
          <p className="text-sm text-slate-300">Set your own approval PIN (4 to 8 digits). You sign requests with it; the business-wallet PIN is never shared.</p>
          <div className="grid grid-cols-2 gap-2">
            <input type="password" inputMode="numeric" placeholder="New PIN" value={setup.a} onChange={(event) => setSetup((previous) => ({ ...previous, a: event.target.value }))} className={input} />
            <input type="password" inputMode="numeric" placeholder="Repeat PIN" value={setup.b} onChange={(event) => setSetup((previous) => ({ ...previous, b: event.target.value }))} className={input} />
          </div>
          <button disabled={busy === 'pin'} className={`${smallBtn} bg-amber-600 text-white hover:bg-amber-500`}>Save PIN</button>
        </form>
      )}
      {error && <p className="mb-2 text-xs text-red-300">{error}</p>}

      {items.length === 0 ? <p className="text-sm text-slate-500">Nothing is waiting for you.</p> : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.transaction_id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-white">{item.wallet_label || item.business_name}</span>
                <span className="text-base font-bold text-amber-200">{formatIcan(item.amount_ican)}</span>
              </div>
              <p className="text-xs text-slate-400">
                {OPERATION_LABELS[item.operation_type] || 'Payment'}{item.recipient_name ? ` → ${item.recipient_name}` : ''}
                {item.note ? ` · “${item.note}”` : ''} · you sign as <strong className="text-slate-200">{item.my_level} approver</strong>
              </p>
              <Ladder stage={item.stage} />
              {pin.has && !item.already_decided && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <input type="password" inputMode="numeric" placeholder="Your PIN" value={pins[item.transaction_id] || ''}
                    onChange={(event) => setPins((previous) => ({ ...previous, [item.transaction_id]: event.target.value }))}
                    className="w-28 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white" />
                  <button disabled={busy === item.transaction_id || !(pins[item.transaction_id] || '').length} onClick={() => decide(item, 'approved')} className={`${smallBtn} flex items-center gap-1 bg-emerald-600 text-white hover:bg-emerald-500`}><Check size={13} /> Approve</button>
                  <button disabled={busy === item.transaction_id || !(pins[item.transaction_id] || '').length} onClick={() => decide(item, 'rejected')} className={`${smallBtn} flex items-center gap-1 border border-slate-600 text-slate-200 hover:bg-slate-800`}><X size={13} /> Reject</button>
                </div>
              )}
              {item.already_decided && <p className="mt-2 text-xs text-slate-500">You have already signed this; it is waiting on the others.</p>}
              {message[item.transaction_id] && <p className="mt-2 text-xs text-red-300">{message[item.transaction_id]}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------ per-branch drawer
function MoveMoney({ node, run }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const canFund = node.parent_id && node.my_rank >= 1 && node.can_fund;
  const sweepTarget = node.parent_id || node.sweep_target;
  const canSweep = sweepTarget && node.can_sweep;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-300">Amount (ICAN)<input type="number" min="0" step="any" value={amount} onChange={(event) => setAmount(event.target.value)} className={input} /></label>
        <label className="text-xs text-slate-300">Note<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="optional" className={input} /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        {canFund && <button disabled={!Number(amount)} onClick={() => run(() => proposeFunding(node.parent_id, node.business_id, Number(amount), note || null), 'Funding request created. It follows the mother account’s approval rules.').then((ok) => ok && setAmount(''))} className={`${smallBtn} flex items-center gap-1 bg-emerald-600 text-white hover:bg-emerald-500`}><ArrowDownToLine size={13} /> Fund this branch</button>}
        {canSweep && <button disabled={!Number(amount)} onClick={() => run(() => proposeSweep(node.business_id, sweepTarget, Number(amount), note || null), 'Sweep request created. It follows this wallet’s approval rules.').then((ok) => ok && setAmount(''))} className={`${smallBtn} flex items-center gap-1 border border-slate-600 text-slate-200 hover:bg-slate-800`}><ArrowUpFromLine size={13} /> Sweep to mother</button>}
      </div>
      <p className="text-[11px] text-slate-500">These create pending requests. Nothing moves until the right approvers sign.</p>
    </div>
  );
}

function Rules({ node, run }) {
  const p = node.policy || {};
  const [form, setForm] = useState({
    enabled: Boolean(p.enabled), wallet_label: p.wallet_label || '', per_tx_limit_ican: p.per_tx_limit_ican ?? '', daily_limit_ican: p.daily_limit_ican ?? '',
    branch_approval_up_to_ican: p.branch_approval_up_to_ican ?? 1000, branch_approvals_required: p.branch_approvals_required ?? 1,
    mother_approvals_required: p.mother_approvals_required ?? 1, allow_owner_override: p.allow_owner_override ?? true
  });
  const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const hasMother = Boolean(node.parent_id);
  const save = () => run(() => setWalletPolicy(node.business_id, {
    ...form,
    per_tx_limit_ican: form.per_tx_limit_ican === '' ? null : Number(form.per_tx_limit_ican),
    daily_limit_ican: form.daily_limit_ican === '' ? null : Number(form.daily_limit_ican),
    branch_approval_up_to_ican: Number(form.branch_approval_up_to_ican),
    branch_approvals_required: Number(form.branch_approvals_required),
    mother_approvals_required: Number(form.mother_approvals_required)
  }), 'Rules saved.');
  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={form.enabled} onChange={set('enabled')} /> Use an approval ladder and spending limits for this wallet</label>
      <label className="block text-xs text-slate-300">Wallet name<input value={form.wallet_label} onChange={set('wallet_label')} placeholder="e.g. Nairobi operations" className={input} /></label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-300">Limit per payment<input type="number" min="0" step="any" value={form.per_tx_limit_ican} onChange={set('per_tx_limit_ican')} placeholder="none" className={input} /></label>
        <label className="text-xs text-slate-300">Limit per day<input type="number" min="0" step="any" value={form.daily_limit_ican} onChange={set('daily_limit_ican')} placeholder="none" className={input} /></label>
        <label className="text-xs text-slate-300">Branch can release up to<input type="number" min="0" step="any" value={form.branch_approval_up_to_ican} onChange={set('branch_approval_up_to_ican')} className={input} /></label>
        <label className="text-xs text-slate-300">Branch approvals needed<input type="number" min="1" max="5" value={form.branch_approvals_required} onChange={set('branch_approvals_required')} className={input} /></label>
        {hasMother && <label className="text-xs text-slate-300">Mother approvals above that<input type="number" min="1" max="3" value={form.mother_approvals_required} onChange={set('mother_approvals_required')} className={input} /></label>}
      </div>
      {hasMother ? (
        <label className="flex items-start gap-2 text-xs text-slate-300"><input type="checkbox" className="mt-0.5" checked={form.allow_owner_override} onChange={set('allow_owner_override')} /> Owners can still approve with the business-wallet PIN (turn off to force every payment through the ladder)</label>
      ) : <p className="text-[11px] text-slate-500">With no mother account above it, payments over the branch limit go to the owners, with the business-wallet PIN.</p>}
      <button onClick={save} className={`${smallBtn} bg-amber-600 text-white hover:bg-amber-500`}>Save rules</button>
    </div>
  );
}

function Approvers({ node, run }) {
  const [rows, setRows] = useState(null);
  const [email, setEmail] = useState('');
  const [level, setLevel] = useState('branch');
  const [max, setMax] = useState('');
  const load = useCallback(async () => setRows((await listApprovers(node.business_id)).data || []), [node.business_id]);
  useEffect(() => { load(); }, [load]);
  const hasMother = Boolean(node.parent_id);
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-3">
        <p className="mb-2 text-xs font-semibold text-slate-400">ASSIGN AN APPROVER</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Their ICAN e-mail" className={`${input} mt-0`} />
          <select value={level} onChange={(event) => setLevel(event.target.value)} className={`${input} mt-0`}>
            {APPROVER_LEVELS.filter((item) => hasMother || item.value === 'branch').map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
          <input type="number" min="0" step="any" value={max} onChange={(event) => setMax(event.target.value)} placeholder="Max amount (optional)" className={`${input} mt-0`} />
        </div>
        <p className="mt-1 text-[11px] text-slate-500">{APPROVER_LEVELS.find((item) => item.value === level)?.hint}</p>
        <button disabled={!email} onClick={() => run(() => assignApprover(node.business_id, email.trim(), level, max ? Number(max) : null), 'Approver assigned.').then((ok) => { if (ok) { setEmail(''); setMax(''); load(); } })}
          className={`${smallBtn} mt-2 flex items-center gap-1 bg-amber-600 text-white hover:bg-amber-500`}><UserPlus size={13} /> Assign</button>
      </div>
      {rows === null ? <p className="text-sm text-slate-500">Loading…</p> : rows.length === 0 ? <p className="text-sm text-slate-500">No approvers assigned yet.</p> : (
        <ul className="space-y-1">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-2 text-sm">
              <span><span className="text-white">{row.email}</span>
                <span className="ml-2 rounded bg-slate-800 px-1.5 text-[11px] text-slate-300">{row.level}</span>
                {row.max_amount_ican && <span className="ml-2 text-[11px] text-slate-500">up to {formatIcan(row.max_amount_ican)}</span>}
                {!row.has_pin && <span className="ml-2 text-[11px] text-amber-300">has not set a PIN yet</span>}
              </span>
              <button onClick={() => run(() => removeApprover(node.business_id, row.id), 'Approver removed.').then((ok) => ok && load())} className="text-red-400 hover:text-red-300" title="Remove"><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Allowance({ node, run }) {
  const a = node.allowance || {};
  const [form, setForm] = useState({
    enabled: a.enabled ?? true, mode: a.mode || 'top_up', float_target_ican: a.float_target_ican ?? '', amount_ican: a.amount_ican ?? '',
    period: a.period || 'monthly', sweep_above_ican: a.sweep_above_ican ?? ''
  });
  const set = (key) => (event) => setForm((previous) => ({ ...previous, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const save = () => run(() => setAllowance(node.business_id, {
    enabled: form.enabled, mode: form.mode, period: form.period,
    float_target_ican: form.mode === 'top_up' ? Number(form.float_target_ican) : null,
    amount_ican: form.mode === 'fixed' ? Number(form.amount_ican) : null,
    sweep_above_ican: form.sweep_above_ican === '' ? null : Number(form.sweep_above_ican)
  }), 'Allowance saved. The first request is created when you next open this page.');
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-400">Keep this branch funded without chasing it: on schedule, a funding request tops its wallet up to a float, and anything above a ceiling is proposed back to the mother account. Requests are only <em>proposed</em>; approvers still sign.</p>
      <label className="flex items-center gap-2 text-sm text-slate-200"><input type="checkbox" checked={form.enabled} onChange={set('enabled')} /> Allowance on</label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-slate-300">Style
          <select value={form.mode} onChange={set('mode')} className={input}><option value="top_up">Top up to a float</option><option value="fixed">Fixed amount</option></select></label>
        <label className="text-xs text-slate-300">Every
          <select value={form.period} onChange={set('period')} className={input}><option value="weekly">Week</option><option value="monthly">Month</option></select></label>
        {form.mode === 'top_up'
          ? <label className="text-xs text-slate-300">Float to maintain (ICAN)<input type="number" min="0" step="any" value={form.float_target_ican} onChange={set('float_target_ican')} className={input} /></label>
          : <label className="text-xs text-slate-300">Amount each time (ICAN)<input type="number" min="0" step="any" value={form.amount_ican} onChange={set('amount_ican')} className={input} /></label>}
        <label className="text-xs text-slate-300">Sweep back what is above<input type="number" min="0" step="any" value={form.sweep_above_ican} onChange={set('sweep_above_ican')} placeholder="never" className={input} /></label>
      </div>
      <button onClick={save} className={`${smallBtn} bg-amber-600 text-white hover:bg-amber-500`}>Save allowance</button>
    </div>
  );
}

function Activity({ node }) {
  const [rows, setRows] = useState(null);
  useEffect(() => { getWalletEvents(node.business_id).then(({ data }) => setRows(data || [])); }, [node.business_id]);
  if (rows === null) return <p className="text-sm text-slate-500">Loading…</p>;
  if (rows.length === 0) return <p className="text-sm text-slate-500">No wallet decisions recorded yet.</p>;
  return (
    <ul className="space-y-1 text-xs text-slate-400">
      {rows.map((row, index) => (
        <li key={`${row.created_at}-${index}`} className="rounded bg-slate-900/60 px-2 py-1">
          {new Date(row.created_at).toLocaleString()} · <span className="text-slate-200">{row.event.replace(/_/g, ' ')}</span>{row.actor_email ? <span className="text-slate-500"> · {row.actor_email}</span> : null}
          {row.details?.amount_ican ? <span> · {formatIcan(row.details.amount_ican)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------- the panel
export default function BranchWalletsPanel({ profile }) {
  const [nodes, setNodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [open, setOpen] = useState(null);       // { id, tab }
  const [tick, setTick] = useState(0);
  const [motherId, setMotherId] = useState(null);   // the business above this one, when it has an owner

  useEffect(() => { getOwnershipChain(profile.id).then(({ data }) => setMotherId(data?.[0]?.business_id || null)); }, [profile.id]);

  const load = useCallback(async () => {
    setLoading(true);
    // allowances only ever create pending requests; run any that are due
    await runDueAllowances();
    const { data, error: loadError } = await getWalletOverview(profile.id);
    setNodes(data || []);
    setError(loadError?.message || '');
    setLoading(false);
  }, [profile.id]);
  useEffect(() => { load(); }, [load, tick]);

  const run = async (action, success) => {
    setError(''); setNotice('');
    const { error: actionError } = await action();
    if (actionError) { setError(actionError.message); return false; }
    if (success) setNotice(success);
    setTick((value) => value + 1);
    return true;
  };

  // The root's rank says whether this person administers it; who can fund / sweep follows from that.
  const root = nodes.find((node) => node.depth === 0);
  const decorated = useMemo(() => nodes.map((node) => ({
    ...node,
    can_fund: Boolean(root && root.my_rank >= 3 && node.depth > 0),
    sweep_target: node.depth === 0 ? motherId : null,
    can_sweep: node.depth > 0 ? node.my_rank >= 2 : (node.my_rank >= 3 && Boolean(motherId))
  })), [nodes, root, motherId]);
  const total = decorated.reduce((sum, node) => sum + Number(node.balance || 0), 0);

  if (loading && nodes.length === 0) return <div className="flex items-center gap-2 text-sm text-slate-400"><Loader className="animate-spin" size={16} /> Loading wallets…</div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-400">
        Every branch has its own business wallet. Here the mother account funds them, sets how each may spend, and
        names who approves what. All money still moves through the normal business-wallet requests.
      </p>
      {error && <p className="rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-2 text-sm text-emerald-300">{notice}</p>}

      <MyApprovals onDone={() => setTick((value) => value + 1)} />

      {decorated.length > 1 && (
        <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3">
          <span className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500"><Landmark size={14} /> WHOLE BUSINESS</span>
          <span className="text-lg font-bold text-white">{formatIcan(total)}</span>
        </div>
      )}

      <ul className="space-y-2">
        {decorated.map((node) => {
          const policy = node.policy;
          const frozen = node.wallet_status === 'frozen' || node.wallet_status === 'suspended';
          const floatTarget = node.allowance?.float_target_ican ? Number(node.allowance.float_target_ican) : null;
          const pct = floatTarget ? Math.min(100, Math.round((Number(node.balance) / floatTarget) * 100)) : null;
          const govern = node.my_rank >= 2;
          const isOpen = open?.id === node.business_id;
          return (
            <li key={node.business_id} style={{ marginLeft: `${node.depth * 1.25}rem` }}>
              <div className={`rounded-xl border p-3 ${node.depth === 0 ? 'border-amber-700/40 bg-amber-900/10' : 'border-slate-800 bg-slate-950/60'} ${frozen ? 'ring-1 ring-sky-700/60' : ''}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-white">
                      {node.depth === 0 ? <Landmark size={15} className="text-amber-400" /> : <CircleDot size={14} className="text-slate-500" />}
                      {policy?.wallet_label || node.business_name}
                      {node.depth === 0 && <span className="text-xs font-normal text-slate-500">mother account</span>}
                      {frozen && <span className="flex items-center gap-1 rounded bg-sky-900/40 px-1.5 text-[11px] text-sky-300"><Snowflake size={11} /> {node.wallet_status}</span>}
                    </p>
                    <p className="text-[11px] text-slate-500">{node.wallet_exists ? `Wallet •••• ${node.wallet_last4}` : 'No wallet yet'}{policy?.wallet_label ? ` · ${node.business_name}` : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-white">{formatIcan(node.balance)}</p>
                    <p className="text-[11px] text-slate-500">
                      {Number(node.funded_30d) > 0 ? `+${formatIcan(node.funded_30d)} in · ` : ''}{formatIcan(node.spent_30d)} spent (30 days)
                    </p>
                  </div>
                </div>

                {pct !== null && (
                  <div className="mt-2" title={`Float target ${formatIcan(floatTarget)}`}>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full ${pct < 30 ? 'bg-orange-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></div>
                    <p className="mt-0.5 text-[11px] text-slate-500">{pct}% of its {formatIcan(floatTarget)} float</p>
                  </div>
                )}

                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  {policy?.enabled ? (
                    <>
                      <span className="rounded bg-emerald-900/30 px-1.5 py-0.5 text-emerald-300">Approval ladder on</span>
                      {policy.per_tx_limit_ican && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">≤ {formatIcan(policy.per_tx_limit_ican)} / payment</span>}
                      {policy.daily_limit_ican && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">≤ {formatIcan(policy.daily_limit_ican)} / day</span>}
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">branch signs up to {formatIcan(policy.branch_approval_up_to_ican)}</span>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300">{node.approver_count} approver{node.approver_count === 1 ? '' : 's'}</span>
                    </>
                  ) : <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">Standard owner approval</span>}
                  {node.pending_count > 0 && <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-amber-300">{node.pending_count} waiting</span>}
                  {!govern && node.depth > 0 && <span className="flex items-center gap-1 rounded bg-slate-800 px-1.5 py-0.5 text-slate-400"><Lock size={10} /> view only</span>}
                </div>

                {(govern || node.my_rank >= 3) && (
                  <div className="mt-2 flex flex-wrap gap-3 text-xs">
                    {['Move money', 'Rules', 'Approvers', ...(node.depth > 0 ? ['Allowance'] : []), 'Activity'].map((tab) => (
                      <button key={tab} onClick={() => setOpen(isOpen && open.tab === tab ? null : { id: node.business_id, tab })} className={isOpen && open.tab === tab ? 'text-amber-300' : 'text-slate-400 hover:text-slate-200'}>{tab}</button>
                    ))}
                    {node.wallet_exists && (
                      <button onClick={() => {
                        if (!frozen && !window.confirm(`Freeze ${node.business_name}'s wallet? It will stop starting or releasing any payment until a governing administrator unfreezes it.`)) return;
                        run(() => setWalletStatus(node.business_id, frozen ? 'active' : 'frozen', frozen ? null : 'Frozen from branch wallets'), frozen ? 'Wallet unfrozen.' : 'Wallet frozen.');
                      }} className={`ml-auto flex items-center gap-1 ${frozen ? 'text-emerald-300' : 'text-sky-300'} hover:underline`}><Snowflake size={12} /> {frozen ? 'Unfreeze' : 'Freeze'}</button>
                    )}
                  </div>
                )}

                {isOpen && (
                  <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                    {open.tab === 'Move money' && <MoveMoney node={node} run={run} />}
                    {open.tab === 'Rules' && <Rules node={node} run={run} />}
                    {open.tab === 'Approvers' && <Approvers node={node} run={run} />}
                    {open.tab === 'Allowance' && <Allowance node={node} run={run} />}
                    {open.tab === 'Activity' && <Activity node={node} />}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {decorated.length === 1 && (
        <p className="text-sm text-slate-500">No branch wallets yet. Add branches under <strong>Branches &amp; ownership</strong> and choose how much control you keep over their wallets.</p>
      )}
    </div>
  );
}
