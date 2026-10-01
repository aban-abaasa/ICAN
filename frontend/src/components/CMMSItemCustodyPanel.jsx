import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader, LogOut, RotateCcw } from 'lucide-react';
import cmmsService from '../lib/supabase/services/cmmsService';

// Classic ivory/gold surface by default; the dark theme presets re-point the
// tones and the form-field look below (same approach as CMMSEmployeeWelfare).
const CUSTODY_STYLES = `
.custody-scope { --cu-ok-bg: rgba(16,185,129,.15); --cu-ok: #047857; --cu-warn-bg: rgba(245,158,11,.15); --cu-warn: #b45309; --cu-bad-bg: rgba(239,68,68,.13); --cu-bad: #dc2626; --cu-neutral-bg: rgba(100,116,139,.15); --cu-neutral: #475569; --cu-line: rgba(196,160,82,.28); }
:root[data-theme="dark"] .custody-scope, :root[data-theme="purple"] .custody-scope, :root[data-theme="green"] .custody-scope, :root[data-theme="ocean"] .custody-scope, :root[data-theme="sienna"] .custody-scope { --cu-ok-bg: rgba(16,185,129,.18); --cu-ok: #6ee7b7; --cu-warn-bg: rgba(245,158,11,.18); --cu-warn: #fcd34d; --cu-bad-bg: rgba(239,68,68,.18); --cu-bad: #fca5a5; --cu-neutral-bg: rgba(148,163,184,.18); --cu-neutral: #cbd5e1; --cu-line: var(--color-border); }
.cu-pill { display: inline-flex; border-radius: 999px; padding: .25rem .65rem; font-size: .7rem; font-weight: 700; white-space: nowrap; }
.cu-ok { background: var(--cu-ok-bg); color: var(--cu-ok); }
.cu-warn { background: var(--cu-warn-bg); color: var(--cu-warn); }
.cu-bad { background: var(--cu-bad-bg); color: var(--cu-bad); }
.cu-neutral { background: var(--cu-neutral-bg); color: var(--cu-neutral); }
.cmms-custody-field { width: 100%; border-radius: 10px; border: 1px solid rgba(196,160,82,.45); background: #fff; color: #1e293b; padding: .5rem .75rem; font-size: .875rem; }
.cmms-custody-field:focus { outline: none; border-color: #c4a052; box-shadow: 0 0 0 3px rgba(196,160,82,.2); }
:root[data-theme="dark"] .custody-scope .cmms-custody-field, :root[data-theme="purple"] .custody-scope .cmms-custody-field, :root[data-theme="green"] .custody-scope .cmms-custody-field, :root[data-theme="ocean"] .custody-scope .cmms-custody-field, :root[data-theme="sienna"] .custody-scope .cmms-custody-field { background: var(--color-bg); color: var(--color-text); border-color: var(--color-border); }
.cmms-custody-table { border-top: 1px solid var(--cu-line); border-bottom: 1px solid var(--cu-line); }
.cmms-custody-table th { border-bottom: 1px solid var(--cu-line); }
.cmms-custody-body tr + tr td { border-top: 1px solid var(--cu-line); }
`;
const STATUS_STYLES = { checked_out: 'cu-warn', returned: 'cu-ok', lost: 'cu-bad' };
const STATUS_LABELS = { checked_out: 'Out', returned: 'Returned', lost: 'Lost' };
const REQUEST_STYLES = { pending: 'cu-warn', approved: 'cu-ok', declined: 'cu-bad', cancelled: 'cu-neutral' };
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

// Items taken/returned: used as the "Items Taken/Returned" sub-tab in Staff
// Attendance and (embedded) on the employee Leave & Welfare screen.
// What the person may do comes from the server (fn_get_my_item_custody_access),
// driven by the role permissions the admin ticks under Role and tool
// configuration -> "Item requests & custody": request / see all / manage.
// Employees request an item and sign it back in when returned; managers
// approve or decline requests, record manually who took an item, and see the
// whole company's proof trail. The RPCs re-check everything server-side.
export default function CMMSItemCustodyPanel({ companyProfile, cmmsUsers, embedded = false, bare = false }) {
  const companyId = companyProfile?.id;
  const [access, setAccess] = useState({ loaded: false, cmmsUserId: null, canRequest: false, canSeeAll: false, canManage: false });
  const [staffUsers, setStaffUsers] = useState(cmmsUsers || []);
  const [inventory, setInventory] = useState([]);
  const [log, setLog] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('checked_out');
  const [form, setForm] = useState({ itemId: '', quantity: 1, purpose: '', staffId: '' });
  const [open, setOpen] = useState(bare);
  const [returning, setReturning] = useState(null);
  const [returnForm, setReturnForm] = useState({ condition: 'good', notes: '' });

  const { canRequest, canSeeAll, canManage, cmmsUserId: myCmmsUserId } = access;
  const hasAccess = canRequest || canSeeAll || canManage;

  const staffOptions = useMemo(() => staffUsers
    .filter((u) => u?.is_active !== false)
    .map((u) => ({ id: u.id, label: u.full_name || u.user_name || u.name || u.email || 'Unnamed staff' })), [staffUsers]);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    const accessRes = await cmmsService.getMyItemCustodyAccess(companyId);
    setAccess({ loaded: true, ...accessRes.data });
    if (!(accessRes.data.canRequest || accessRes.data.canSeeAll || accessRes.data.canManage)) {
      setLoading(false);
      return;
    }
    const [invRes, logRes, reqRes] = await Promise.all([
      cmmsService.getCompanyInventory(companyId),
      cmmsService.getItemCustodyLog(companyId, { status: statusFilter === 'all' ? undefined : statusFilter }),
      cmmsService.getItemRequests(companyId)
    ]);
    if (invRes.error) setError(invRes.error.message || 'Could not load inventory.');
    if (logRes.error) setError(logRes.error.message || 'Could not load the custody log.');
    if (reqRes.error) setError(reqRes.error.message || 'Could not load item requests.');
    setInventory((invRes.data || []).filter((i) => i.is_active !== false));
    setLog(logRes.data || []);
    setRequests(reqRes.data || []);
    if (accessRes.data.canManage && !(cmmsUsers && cmmsUsers.length)) {
      const usersRes = await cmmsService.getCompanyUsers(companyId);
      setStaffUsers(usersRes.data || []);
    }
    setLoading(false);
  }, [companyId, statusFilter, cmmsUsers]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (cmmsUsers?.length) setStaffUsers(cmmsUsers); }, [cmmsUsers]);

  // The server already limits these to the person's own records unless their
  // role can see everyone's.
  const visibleLog = log;
  const selectedItem = inventory.find((i) => i.id === form.itemId);
  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const myRequests = requests.filter((r) => r.requested_by_cmms_user_id === myCmmsUserId).slice(0, 10);

  const takeItem = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const quantity = Number(form.quantity);
    if (!selectedItem) return setError('Choose the item being taken.');
    if (!quantity || quantity <= 0) return setError('Enter a quantity greater than zero.');
    if (quantity > Number(selectedItem.quantity_in_stock)) return setError(`Only ${selectedItem.quantity_in_stock} in stock.`);
    setBusy(true);
    const purpose = form.purpose.trim() || undefined;
    const { data, error: err } = canManage
      ? await cmmsService.checkoutInventoryItem(selectedItem.id, {
        quantity,
        purpose,
        cmmsUserId: form.staffId && form.staffId !== myCmmsUserId ? form.staffId : undefined
      })
      : await cmmsService.requestInventoryItem(selectedItem.id, { quantity, purpose });
    setBusy(false);
    if (err || !data?.success) return setError(err?.message || (canManage ? 'Could not sign this item out.' : 'Could not send your request.'));
    setNotice(data.message || (canManage ? 'Item signed out.' : 'Request sent.'));
    setForm({ itemId: '', quantity: 1, purpose: '', staffId: '' });
    load();
  };

  const decideRequest = async (request, approve) => {
    setBusy(true);
    setError('');
    setNotice('');
    const { data, error: err } = await cmmsService.decideItemRequest(request.id, approve);
    setBusy(false);
    if (err || !data?.success) return setError(err?.message || 'Could not update this request.');
    setNotice(data.message);
    load();
  };

  const cancelRequest = async (request) => {
    setBusy(true);
    setError('');
    const { data, error: err } = await cmmsService.cancelItemRequest(request.id);
    setBusy(false);
    if (err || !data?.success) return setError(err?.message || 'Could not cancel this request.');
    setNotice(data.message);
    load();
  };

  const returnItem = async () => {
    if (!returning) return;
    setBusy(true);
    setError('');
    const { data, error: err } = await cmmsService.returnInventoryItem(returning.id, {
      condition: returnForm.condition,
      notes: returnForm.notes.trim() || undefined
    });
    setBusy(false);
    if (err || !data?.success) return setError(err?.message || 'Could not sign this item back in.');
    setNotice(data.message || 'Item signed back in.');
    setReturning(null);
    setReturnForm({ condition: 'good', notes: '' });
    load();
  };

  const inputClass = "cmms-custody-field";

  if (!access.loaded) {
    return embedded ? null : <div className="flex items-center gap-2 text-sm cmms-classic-muted"><Loader className="h-4 w-4 animate-spin" /> Loading…</div>;
  }
  if (!hasAccess) {
    return embedded ? null : (
      <div className="cmms-classic-card p-6 text-sm cmms-classic-muted">
        Your role has not been given access to item requests. Ask an admin to enable “Item requests &amp; custody” for your role.
      </div>
    );
  }

  const stillOut = log.filter((r) => r.status === 'checked_out' && r.cmms_user_id === myCmmsUserId).length;

  return (
    <div className="custody-scope space-y-5">
      <style>{CUSTODY_STYLES}</style>
      {embedded && !bare && (
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
          className="cmms-classic-divider !mt-0 !pt-0 flex w-full items-center justify-between gap-3 py-3 text-left !bg-transparent"
          style={{ background: 'transparent', border: 0, boxShadow: 'none', borderTop: '1px solid var(--cu-line)' }}>
          <span className="flex min-w-0 items-center gap-2"><LogOut className="h-4 w-4 flex-shrink-0 cmms-classic-muted" /><span className="cmms-classic-heading truncate text-sm">Items I take &amp; return</span></span>
          <span className="flex flex-shrink-0 items-center gap-2">
            {(pendingRequests.length > 0 || stillOut > 0) && <span className={`text-xs ${pendingRequests.length > 0 ? 'cmms-tone-warn font-semibold' : 'cmms-classic-muted'}`}>{pendingRequests.length > 0 ? `${pendingRequests.length} pending` : `${stillOut} out`}</span>}
            <ChevronDown className={`h-4 w-4 cmms-classic-muted transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </span>
        </button>
      )}
      {(!embedded || open) && <>
      {error && <div className="cu-bad rounded-lg p-3 text-sm">{error}</div>}
      {notice && <div className="cu-ok rounded-lg p-3 text-sm">{notice}</div>}

      {(canRequest || canManage) && <form onSubmit={takeItem} className="cmms-classic-divider space-y-3">
        <h3 className="flex items-center gap-2 text-lg font-semibold cmms-classic-heading"><LogOut className="h-5 w-5 text-[var(--color-primary)]" /> {canManage ? 'Record an item taken' : 'Request an item'}</h3>
        <p className="text-xs cmms-classic-muted">{canManage
          ? 'Pick the item and who took it. Signing it back in when it is returned is the proof of custody.'
          : 'Ask for an item you need. Once a storeman or admin approves, it is signed out to you, and you sign it back in when you return it.'}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="cmms-classic-label mb-1">Item</label>
            <select value={form.itemId} onChange={(e) => setForm((f) => ({ ...f, itemId: e.target.value }))} className={inputClass}>
              <option value="">-- Select item --</option>
              {inventory.map((i) => (
                <option key={i.id} value={i.id} disabled={Number(i.quantity_in_stock) <= 0}>
                  {i.item_name} ({i.quantity_in_stock} {i.unit_of_measure || 'units'} in stock)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="cmms-classic-label mb-1">Quantity</label>
            <input type="number" min="1" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} className={inputClass} />
          </div>
          {canManage ? (
            <div>
              <label className="cmms-classic-label mb-1">Taken by</label>
              <select value={form.staffId} onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value }))} className={inputClass}>
                <option value="">Me</option>
                {staffOptions.filter((s) => s.id !== myCmmsUserId).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          ) : <div />}
        </div>
        <div>
          <label className="cmms-classic-label mb-1">Purpose (optional)</label>
          <input type="text" value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} placeholder="e.g. Site visit, repair job..." className={inputClass} />
        </div>
        <button disabled={busy} className="cmms-classic-btn-primary flex items-center gap-2 px-4 py-2 text-sm">
          {busy ? <Loader className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />} {canManage ? 'Sign out item' : 'Send request'}
        </button>
      </form>}

      {canManage && pendingRequests.length > 0 && (
        <div className="cmms-classic-divider space-y-3">
          <h3 className="text-lg font-semibold cmms-classic-heading">Pending requests ({pendingRequests.length})</h3>
          {pendingRequests.map((r) => (
            <div key={r.id} className="flex flex-col gap-3 cmms-classic-callout sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <div className="font-medium cmms-classic-heading">{r.requester_name} wants {r.quantity} × {r.item_name}</div>
                <div className="text-xs cmms-classic-muted">
                  {fmtDateTime(r.created_at)} · {r.quantity_in_stock} {r.unit_of_measure || 'units'} in stock{r.purpose ? ` · ${r.purpose}` : ''}
                </div>
              </div>
              <div className="flex gap-2 [&>button]:flex-1 sm:[&>button]:flex-none">
                <button disabled={busy} onClick={() => decideRequest(r, true)} className="cmms-classic-btn-primary px-3 py-1.5 text-xs">Approve</button>
                <button disabled={busy} onClick={() => decideRequest(r, false)} className="cmms-classic-btn-secondary px-3 py-1.5 text-xs">Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!canManage && myRequests.length > 0 && (
        <div className="cmms-classic-divider space-y-2">
          <h3 className="text-lg font-semibold cmms-classic-heading">My requests</h3>
          {myRequests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 text-sm cmms-classic-muted">
              <div>
                {r.quantity} × {r.item_name}
                <span className="ml-2 text-xs cmms-classic-muted">{fmtDateTime(r.created_at)}</span>
                {r.decision_note && <div className="text-xs cmms-classic-muted">{r.decision_note}</div>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`cu-pill capitalize ${REQUEST_STYLES[r.status] || ''}`}>{r.status}</span>
                {r.status === 'pending' && <button disabled={busy} onClick={() => cancelRequest(r)} className="text-xs cmms-classic-muted underline hover:cmms-classic-heading">Cancel</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="cmms-classic-divider space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold cmms-classic-heading">{canManage || canSeeAll ? 'Custody log' : 'My items'}</h3>
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="cmms-custody-field !w-auto !py-1.5 max-w-[11rem]">
              <option value="checked_out">Currently out</option>
              <option value="returned">Returned</option>
              <option value="lost">Lost</option>
              <option value="all">All</option>
            </select>
            <button onClick={load} disabled={loading} className="cmms-classic-btn-secondary px-3 py-1.5 text-sm disabled:opacity-50">
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="space-y-2 sm:hidden">
          {visibleLog.map((r) => (
            <div key={r.id} className="cmms-custody-table py-2 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="break-words font-semibold cmms-classic-heading">{r.item_name} <span className="font-normal cmms-classic-muted">× {r.quantity}</span></div>
                  <div className="text-xs cmms-classic-muted">{r.holder_name}{r.issued_by_name ? ` · signed out by ${r.issued_by_name}` : ''}</div>
                </div>
                <span className={`cu-pill ${STATUS_STYLES[r.status] || ''}`}>{STATUS_LABELS[r.status] || r.status}</span>
              </div>
              {r.purpose && <div className="text-xs cmms-classic-muted">{r.purpose}</div>}
              <div className="mt-1 text-xs cmms-classic-muted">Taken {fmtDateTime(r.taken_at)}{r.returned_at ? ` · Returned ${fmtDateTime(r.returned_at)}` : ''}</div>
              {r.status === 'checked_out' && (canManage || r.cmms_user_id === myCmmsUserId) && (
                <button onClick={() => { setReturning(r); setError(''); }} className="cmms-classic-btn-secondary mt-2 inline-flex w-full items-center justify-center gap-1.5 px-3 py-2 text-xs"><RotateCcw className="h-3 w-3" /> Sign back in</button>
              )}
            </div>
          ))}
          {!loading && visibleLog.length === 0 && <p className="py-6 text-center text-sm cmms-classic-muted">No records to show.</p>}
        </div>

        <div className="hidden overflow-x-auto cmms-custody-table sm:block">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase cmms-classic-label">
              <tr>
                <th className="px-3 py-2">Item</th>
                <th className="px-3 py-2">Staff</th>
                <th className="px-3 py-2">Qty</th>
                <th className="px-3 py-2">Taken</th>
                <th className="px-3 py-2">Returned</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="cmms-custody-body">
              {visibleLog.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium cmms-classic-heading">{r.item_name}</div>
                    {r.purpose && <div className="text-xs cmms-classic-muted">{r.purpose}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {r.holder_name}
                    {r.issued_by_name && <div className="text-xs cmms-classic-muted">signed out by {r.issued_by_name}</div>}
                  </td>
                  <td className="px-3 py-2">{r.quantity}</td>
                  <td className="px-3 py-2">{fmtDateTime(r.taken_at)}</td>
                  <td className="px-3 py-2">
                    {fmtDateTime(r.returned_at)}
                    {r.return_condition && r.status !== 'checked_out' && <div className="text-xs capitalize cmms-classic-muted">{r.return_condition}{r.return_notes ? ` — ${r.return_notes}` : ''}</div>}
                  </td>
                  <td className="px-3 py-2"><span className={`cu-pill ${STATUS_STYLES[r.status] || ''}`}>{STATUS_LABELS[r.status] || r.status}</span></td>
                  <td className="px-3 py-2 text-right">
                    {r.status === 'checked_out' && (canManage || r.cmms_user_id === myCmmsUserId) && (
                      <button onClick={() => { setReturning(r); setError(''); }} className="cmms-classic-btn-secondary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs">
                        <RotateCcw className="h-3 w-3" /> Sign back in
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && visibleLog.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center cmms-classic-muted">No records to show.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {returning && (
        <div className="custody-scope fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-3 cmms-classic-card p-6">
            <h3 className="flex items-center gap-2 text-lg font-bold cmms-classic-heading"><RotateCcw className="h-5 w-5 text-[var(--color-primary)]" /> Sign back in: {returning.item_name}</h3>
            <div>
              <label className="cmms-classic-label mb-1">Condition</label>
              <select value={returnForm.condition} onChange={(e) => setReturnForm((f) => ({ ...f, condition: e.target.value }))} className={inputClass}>
                <option value="good">Good — back in stock</option>
                <option value="damaged">Damaged — back in stock</option>
                <option value="lost">Lost — not returned</option>
              </select>
            </div>
            <div>
              <label className="cmms-classic-label mb-1">Notes (optional)</label>
              <textarea rows={2} value={returnForm.notes} onChange={(e) => setReturnForm((f) => ({ ...f, notes: e.target.value }))} className={`${inputClass} resize-none`} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setReturning(null)} className="cmms-classic-btn-secondary flex-1 px-4 py-2 text-sm">Cancel</button>
              <button onClick={returnItem} disabled={busy} className="cmms-classic-btn-primary flex flex-1 items-center justify-center gap-2 px-4 py-2 text-sm disabled:opacity-50">
                {busy && <Loader className="h-4 w-4 animate-spin" />} Confirm return
              </button>
            </div>
          </div>
        </div>
      )}
      </>}
    </div>
  );
}
