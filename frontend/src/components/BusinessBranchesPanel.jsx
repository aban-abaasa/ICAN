import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Check, ChevronRight, GitBranch, Loader, Plug, PlugZap, Plus, Search, Unlink, X } from 'lucide-react';
import {
  CMMS_ACCESS_LEVELS,
  RELATIONSHIPS,
  WALLET_CONTROL_LEVELS,
  endBranchLink,
  getBranchTree,
  getMyBranchRequests,
  getMyUnlinkedBusinesses,
  getOwnershipChain,
  getOwnershipHistory,
  proposeBranch,
  respondToBranchRequest,
  searchBusinessesForBranch,
  updateBranchArrangement
} from '../services/businessOwnershipService';
import { formatMoney, getInventoryReport } from '../services/cmmsAssetLedgerService';

const accessLabel = (level) => CMMS_ACCESS_LEVELS.find((item) => item.value === level)?.label || level;
const relationshipLabel = (value) => RELATIONSHIPS.find((item) => item.value === value)?.label || value;

const selectClass = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white';
const inputClass = selectClass;

function AccessPicker({ value, onChange, max = 'full', levels = CMMS_ACCESS_LEVELS }) {
  const order = levels.map((level) => level.value);
  return (
    <div className="mt-1 grid grid-cols-3 gap-1.5">
      {levels.map((level) => {
        const disabled = order.indexOf(level.value) > order.indexOf(max);
        const active = value === level.value;
        return (
          <button
            key={level.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(level.value)}
            title={level.hint}
            className={`rounded-lg border px-2 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-35 ${
              active ? 'border-amber-400 bg-amber-500/15 text-amber-200' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500'
            }`}
          >
            {level.label}
          </button>
        );
      })}
    </div>
  );
}

export default function BusinessBranchesPanel({ profile }) {
  const businessId = profile.id;
  const [tree, setTree] = useState([]);
  const [chain, setChain] = useState([]);
  const [requests, setRequests] = useState([]);
  const [history, setHistory] = useState([]);
  const [mine, setMine] = useState([]);
  const [feed, setFeed] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [respondAccess, setRespondAccess] = useState({});
  const [respondWallet, setRespondWallet] = useState({});

  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState([]);
  const [childId, setChildId] = useState('');
  const [draft, setDraft] = useState({ relationship: 'branch', ownershipPercent: 100, cmmsAccess: 'summary', walletControl: 'view' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const [treeResult, chainResult, requestResult, mineResult] = await Promise.all([
      getBranchTree(businessId),
      getOwnershipChain(businessId),
      getMyBranchRequests(),
      getMyUnlinkedBusinesses()
    ]);
    const nodes = treeResult.data || [];
    setTree(nodes);
    setChain(chainResult.data || []);
    setRequests((requestResult.data || []).filter((request) => request.parent_id === businessId || request.child_id === businessId));
    setMine((mineResult.data || []).filter((business) => business.business_id !== businessId));
    setError(treeResult.error?.message || '');

    // The real feed: the consolidated CMMS report for the tree, read through the
    // access each branch agreed to share.
    const rootCompany = nodes.find((node) => node.depth === 0)?.cmms_company_id;
    if (rootCompany && nodes.filter((node) => node.cmms_company_id).length > 1) {
      const report = await getInventoryReport(rootCompany, null, 'group');
      const map = {};
      (report.data?.branches || []).forEach((branch) => { map[branch.company_id] = { ...branch, base: report.data.base_currency }; });
      setFeed(map);
    } else {
      setFeed({});
    }
    setLoading(false);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  const run = async (key, action, success) => {
    setBusy(key);
    setError('');
    setNotice('');
    const result = await action();
    setBusy('');
    if (result.error) {
      setError(result.error.message || 'That did not work.');
      return false;
    }
    if (success) setNotice(success);
    await load();
    return true;
  };

  const onSearch = async (value) => {
    setQuery(value);
    setChildId('');
    if (value.trim().length < 3) { setFound([]); return; }
    const result = await searchBusinessesForBranch(value.trim());
    setFound((result.data || []).filter((business) => business.business_id !== businessId));
  };

  const choices = useMemo(() => {
    const seen = new Set();
    return [...mine.map((business) => ({ ...business, administered_by_me: true })), ...found]
      .filter((business) => (seen.has(business.business_id) ? false : seen.add(business.business_id)));
  }, [mine, found]);

  const selected = choices.find((business) => business.business_id === childId);

  const submitAdd = async (event) => {
    event.preventDefault();
    if (!childId) { setError('Choose the business to add as a branch.'); return; }
    const ok = await run('add', () => proposeBranch(businessId, childId, draft),
      selected?.administered_by_me ? 'Branch added.' : 'Request sent. It becomes part of the tree when that business’s administrator accepts.');
    if (ok) { setAdding(false); setChildId(''); setQuery(''); setFound([]); }
  };

  const openEdit = (node) => {
    setEditingId(node.link_id);
    setEditForm({ ownershipPercent: node.ownership_percent, relationship: node.relationship, cmmsAccess: node.cmms_access_level, walletControl: node.wallet_control || 'none' });
  };

  const saveEdit = async (node) => {
    const patch = {};
    if (Number(editForm.ownershipPercent) !== Number(node.ownership_percent)) patch.ownershipPercent = Number(editForm.ownershipPercent);
    if (editForm.relationship !== node.relationship) patch.relationship = editForm.relationship;
    if (editForm.cmmsAccess !== node.cmms_access_level) patch.cmmsAccess = editForm.cmmsAccess;
    if (editForm.walletControl !== (node.wallet_control || 'none')) patch.walletControl = editForm.walletControl;
    if (Object.keys(patch).length === 0) { setEditingId(null); return; }
    const ok = await run(`edit-${node.link_id}`, () => updateBranchArrangement(node.link_id, patch), 'Arrangement updated.');
    if (ok) setEditingId(null);
  };

  const removeLink = async (node) => {
    const reason = window.prompt(`End the link with ${node.business_name}? Add a reason for the record (optional):`, '');
    if (reason === null) return;
    await run(`end-${node.link_id}`, () => endBranchLink(node.link_id, reason || null), 'Link ended. History is kept.');
  };

  const toggleHistory = async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next) setHistory((await getOwnershipHistory(businessId)).data || []);
  };

  const incoming = requests.filter((request) => request.direction === 'incoming' && request.child_id === businessId);
  const outgoing = requests.filter((request) => request.direction === 'outgoing' || request.parent_id === businessId);
  const branchNodes = tree.filter((node) => node.depth > 0);

  if (loading) {
    return <div className="flex items-center gap-2 text-sm text-slate-400"><Loader className="animate-spin" size={16} /> Loading the ownership tree...</div>;
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate-400">
        Keep the tree of who owns whom. Each branch is a business profile of its own; when it also runs a CMMS, it feeds
        the parent’s consolidated CMMS view, limited to what the branch agrees to share.
      </p>

      {error && <p className="rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300">{error}</p>}
      {notice && <p className="rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-2 text-sm text-emerald-300">{notice}</p>}

      {/* Requests waiting for this business to answer */}
      {incoming.map((request) => (
        <div key={request.link_id} className="rounded-xl border border-amber-700/50 bg-amber-900/10 p-3">
          <p className="text-sm text-amber-200">
            <strong>{request.parent_name}</strong> asks to add <strong>{profile.business_name}</strong> as a {relationshipLabel(request.relationship).toLowerCase()}
            {' '}({Number(request.ownership_percent)}% owned). CMMS sharing proposed: <strong>{accessLabel(request.cmms_access_level)}</strong>.
          </p>
          <p className="mt-2 text-xs text-slate-400">Accept at the proposed level or share less. You can change this later.</p>
          <AccessPicker
            value={respondAccess[request.link_id] || request.cmms_access_level}
            max={request.cmms_access_level}
            onChange={(level) => setRespondAccess((previous) => ({ ...previous, [request.link_id]: level }))}
          />
          <p className="mt-3 text-xs text-slate-400">
            Control over your business wallet proposed: <strong className="text-amber-200">{WALLET_CONTROL_LEVELS.find((item) => item.value === (request.wallet_control || 'none'))?.label}</strong>. Accept at that level or less.
          </p>
          <AccessPicker
            levels={WALLET_CONTROL_LEVELS}
            value={respondWallet[request.link_id] || request.wallet_control || 'none'}
            max={request.wallet_control || 'none'}
            onChange={(level) => setRespondWallet((previous) => ({ ...previous, [request.link_id]: level }))}
          />
          <div className="mt-3 flex gap-2">
            <button
              disabled={!!busy}
              onClick={() => run(`ok-${request.link_id}`, () => respondToBranchRequest(request.link_id, true, respondAccess[request.link_id] || request.cmms_access_level, respondWallet[request.link_id] || request.wallet_control || 'none'), 'You are now part of the tree.')}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            ><Check size={14} /> Accept</button>
            <button
              disabled={!!busy}
              onClick={() => run(`no-${request.link_id}`, () => respondToBranchRequest(request.link_id, false), 'Request declined.')}
              className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            ><X size={14} /> Decline</button>
          </div>
        </div>
      ))}

      {/* Who owns this business */}
      {chain.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500">OWNED BY</p>
          <div className="flex flex-wrap items-center gap-1 text-sm">
            <span className="rounded bg-slate-800 px-2 py-1 text-slate-300">{profile.business_name}</span>
            {chain.map((owner) => (
              <React.Fragment key={owner.business_id}>
                <ChevronRight size={14} className="text-slate-600" />
                <span className="rounded bg-slate-800 px-2 py-1 text-white" title={`${relationshipLabel(owner.relationship)} · CMMS: ${accessLabel(owner.cmms_access_level)}`}>
                  {owner.business_name} <span className="text-xs text-amber-300">{Number(owner.ownership_percent)}%</span>
                </span>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* The tree */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="flex items-center gap-2 text-xs font-semibold tracking-wide text-slate-500"><GitBranch size={14} /> BRANCHES &amp; OWNERSHIP</p>
          <button onClick={() => { setAdding((value) => !value); setError(''); }} className="flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500">
            <Plus size={14} /> Add branch
          </button>
        </div>

        <ul className="space-y-1">
          {tree.map((node) => {
            const isRoot = node.depth === 0;
            const feedRow = node.cmms_company_id ? feed[node.cmms_company_id] : null;
            const pending = node.status === 'pending';
            return (
              <li key={`${node.business_id}-${node.link_id || 'root'}`} style={{ marginLeft: `${node.depth * 1.25}rem` }}>
                <div className={`rounded-lg border px-3 py-2 ${isRoot ? 'border-amber-700/40 bg-amber-900/10' : 'border-slate-800 bg-slate-950/60'} ${pending ? 'opacity-70' : ''}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    {node.depth > 0 && <span className="text-slate-600">└</span>}
                    <Building2 size={15} className={isRoot ? 'text-amber-400' : 'text-slate-400'} />
                    <span className="font-semibold text-white">{node.business_name}</span>
                    {isRoot && <span className="text-xs text-slate-500">this business</span>}
                    {!isRoot && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300">{relationshipLabel(node.relationship)}</span>}
                    {!isRoot && (
                      <span className="text-xs text-amber-300" title="Share of this business you own, and the share through the whole chain">
                        {Number(node.ownership_percent)}%{node.depth > 1 ? ` · ${Number(node.effective_percent)}% effective` : ''}
                      </span>
                    )}
                    {pending && <span className="rounded bg-yellow-900/40 px-1.5 py-0.5 text-[11px] text-yellow-300">Awaiting acceptance</span>}
                    <span className="ml-auto flex flex-wrap items-center justify-end gap-1 text-xs">
                      {!isRoot && (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-300" title="What the parent may do with this branch’s wallet">
                          Wallet · {WALLET_CONTROL_LEVELS.find((item) => item.value === (node.effective_wallet || 'none'))?.label}
                        </span>
                      )}
                      {node.cmms_company_id ? (
                        <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 ${node.effective_access === 'none' ? 'bg-slate-800 text-slate-400' : 'bg-emerald-900/30 text-emerald-300'}`}
                          title={`CMMS: ${node.cmms_company_name}`}>
                          {node.effective_access === 'none' ? <Plug size={12} /> : <PlugZap size={12} />}
                          CMMS · {isRoot ? 'head office' : accessLabel(node.effective_access)}
                        </span>
                      ) : (
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-500" title="No CMMS company is linked to this business profile yet">No CMMS yet</span>
                      )}
                    </span>
                  </div>

                  {feedRow && !isRoot && (
                    <p className="mt-1 text-xs text-slate-400">
                      Assets {formatMoney(feedRow.assets?.net_book_value, feedRow.currency)} net book
                      {' · '}Consumables {formatMoney(feedRow.consumables?.value, feedRow.currency)}
                      {feedRow.currency !== feedRow.base && <span className="text-slate-500"> ({feedRow.currency})</span>}
                    </p>
                  )}

                  {!isRoot && node.can_manage && !pending && editingId !== node.link_id && (
                    <div className="mt-2 flex gap-3 text-xs">
                      <button onClick={() => openEdit(node)} className="text-amber-300 hover:text-amber-200">Edit arrangement</button>
                      <button onClick={() => removeLink(node)} className="flex items-center gap-1 text-red-400 hover:text-red-300"><Unlink size={12} /> End link</button>
                    </div>
                  )}
                  {pending && node.can_manage && (
                    <button onClick={() => removeLink(node)} className="mt-2 text-xs text-red-400 hover:text-red-300">Withdraw request</button>
                  )}

                  {editingId !== null && editingId === node.link_id && (
                    <div className="mt-3 space-y-3 rounded-lg border border-slate-700 bg-slate-900 p-3">
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs text-slate-300">Relationship
                          <select value={editForm.relationship} onChange={(event) => setEditForm((previous) => ({ ...previous, relationship: event.target.value }))} className={selectClass}>
                            {RELATIONSHIPS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                          </select>
                        </label>
                        <label className="text-xs text-slate-300">Ownership %
                          <input type="number" min="0.001" max="100" step="0.001" value={editForm.ownershipPercent}
                            onChange={(event) => setEditForm((previous) => ({ ...previous, ownershipPercent: event.target.value }))} className={inputClass} />
                        </label>
                      </div>
                      <div>
                        <p className="text-xs text-slate-300">CMMS sharing</p>
                        <AccessPicker value={editForm.cmmsAccess} onChange={(level) => setEditForm((previous) => ({ ...previous, cmmsAccess: level }))} />
                        <p className="mt-1 text-[11px] text-slate-500">The parent can only lower this. Raising it is the branch’s decision.</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-300">Parent’s control over the branch wallet</p>
                        <AccessPicker levels={WALLET_CONTROL_LEVELS} value={editForm.walletControl} onChange={(level) => setEditForm((previous) => ({ ...previous, walletControl: level }))} />
                        <p className="mt-1 text-[11px] text-slate-500">{WALLET_CONTROL_LEVELS.find((level) => level.value === editForm.walletControl)?.hint}</p>
                      </div>
                      <div className="flex gap-2">
                        <button disabled={!!busy} onClick={() => saveEdit(node)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">Save</button>
                        <button onClick={() => setEditingId(null)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-800">Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {branchNodes.length === 0 && outgoing.length === 0 && (
          <p className="mt-2 text-sm text-slate-500">No branches yet. Add one to start the tree.</p>
        )}
      </div>

      {/* Add branch */}
      {adding && (
        <form onSubmit={submitAdd} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <p className="text-xs font-semibold tracking-wide text-slate-500">ADD A BRANCH</p>
          {mine.length > 0 && (
            <label className="block text-sm text-slate-300">One of your businesses
              <select value={mine.some((business) => business.business_id === childId) ? childId : ''} onChange={(event) => setChildId(event.target.value)} className={selectClass}>
                <option value="">Choose…</option>
                {mine.map((business) => <option key={business.business_id} value={business.business_id}>{business.business_name}{business.has_cmms ? ' · has CMMS' : ''}</option>)}
              </select>
            </label>
          )}
          <label className="block text-sm text-slate-300">…or find another business
            <div className="mt-1 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
              <Search size={15} className="text-slate-500" />
              <input value={query} onChange={(event) => onSearch(event.target.value)} placeholder="Business name (3+ letters)" className="flex-1 bg-transparent text-sm text-white outline-none" />
            </div>
          </label>
          {found.length > 0 && (
            <div className="space-y-1">
              {found.map((business) => (
                <button type="button" key={business.business_id} onClick={() => setChildId(business.business_id)}
                  className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${childId === business.business_id ? 'bg-amber-500/15 text-amber-200' : 'bg-slate-800 text-white hover:bg-slate-700'}`}>
                  <span>{business.business_name}</span>
                  <span className="text-xs text-slate-400">{business.administered_by_me ? 'yours' : 'needs their approval'}</span>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm text-slate-300">Relationship
              <select value={draft.relationship} onChange={(event) => setDraft((previous) => ({ ...previous, relationship: event.target.value }))} className={selectClass}>
                {RELATIONSHIPS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label className="text-sm text-slate-300">You own (%)
              <input type="number" min="0.001" max="100" step="0.001" value={draft.ownershipPercent}
                onChange={(event) => setDraft((previous) => ({ ...previous, ownershipPercent: event.target.value }))} className={inputClass} />
            </label>
          </div>
          <div>
            <p className="text-sm text-slate-300">How much of its CMMS should it share with you?</p>
            <AccessPicker value={draft.cmmsAccess} onChange={(level) => setDraft((previous) => ({ ...previous, cmmsAccess: level }))} />
            <p className="mt-1 text-xs text-slate-500">{CMMS_ACCESS_LEVELS.find((level) => level.value === draft.cmmsAccess)?.hint}</p>
          </div>
          <div>
            <p className="text-sm text-slate-300">How much control should you have over its business wallet?</p>
            <AccessPicker levels={WALLET_CONTROL_LEVELS} value={draft.walletControl} onChange={(level) => setDraft((previous) => ({ ...previous, walletControl: level }))} />
            <p className="mt-1 text-xs text-slate-500">{WALLET_CONTROL_LEVELS.find((level) => level.value === draft.walletControl)?.hint}</p>
          </div>
          <div className="flex gap-2">
            <button disabled={!!busy || !childId} className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50">
              {busy === 'add' ? <Loader size={14} className="animate-spin" /> : <Plus size={14} />} {selected && !selected.administered_by_me ? 'Send request' : 'Add branch'}
            </button>
            <button type="button" onClick={() => setAdding(false)} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">Cancel</button>
          </div>
        </form>
      )}

      <button onClick={toggleHistory} className="text-xs text-slate-400 hover:text-slate-200">{showHistory ? 'Hide' : 'Show'} ownership history</button>
      {showHistory && (
        <ul className="space-y-1 text-xs text-slate-400">
          {history.length === 0 && <li>No history yet.</li>}
          {history.map((entry, index) => (
            <li key={`${entry.created_at}-${index}`} className="rounded bg-slate-900/60 px-2 py-1">
              {new Date(entry.created_at).toLocaleDateString()} · <span className="text-slate-200">{entry.event.replace(/_/g, ' ')}</span> · {entry.parent_name} → {entry.child_name}
              {entry.actor_email ? <span className="text-slate-500"> · {entry.actor_email}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
