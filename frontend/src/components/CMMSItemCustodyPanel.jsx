import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader, LogOut, RotateCcw } from 'lucide-react';
import cmmsService from '../lib/supabase/services/cmmsService';

const STATUS_STYLES = {
  checked_out: 'bg-amber-500/15 text-amber-300',
  returned: 'bg-emerald-500/15 text-emerald-300',
  lost: 'bg-red-500/15 text-red-300'
};
const STATUS_LABELS = { checked_out: 'Out', returned: 'Returned', lost: 'Lost' };
const REQUEST_STYLES = {
  pending: 'bg-amber-500/15 text-amber-300',
  approved: 'bg-emerald-500/15 text-emerald-300',
  declined: 'bg-red-500/15 text-red-300',
  cancelled: 'bg-slate-600/30 text-slate-300'
};
const fmtDateTime = (d) => (d ? new Date(d).toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

// Items taken/returned: used as the "Items Taken/Returned" sub-tab in Staff
// Attendance and (embedded) on the employee Leave & Welfare screen.
// What the person may do comes from the server (fn_get_my_item_custody_access),
// driven by the role permissions the admin ticks under Role and tool
// configuration -> "Item requests & custody": request / see all / manage.
// Employees request an item and sign it back in when returned; managers
// approve or decline requests, record manually who took an item, and see the
// whole company's proof trail. The RPCs re-check everything server-side.
export default function CMMSItemCustodyPanel({ companyProfile, cmmsUsers, embedded = false }) {
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

  const inputClass = 'w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white';

  if (!access.loaded) {
    return embedded ? null : <div className="flex items-center gap-2 text-sm text-slate-400"><Loader className="h-4 w-4 animate-spin" /> Loading…</div>;
  }
  if (!hasAccess) {
    return embedded ? null : (
      <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-6 text-sm text-slate-300">
        Your role has not been given access to item requests. Ask an admin to enable “Item requests &amp; custody” for your role.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {embedded && <h3 className="flex items-center gap-2 font-semibold text-white"><LogOut className="h-4 w-4" /> Items I take &amp; return</h3>}
      {error && <div className="rounded-lg border border-red-500/50 bg-red-500/20 p-3 text-sm text-red-200">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 p-3 text-sm text-emerald-200">{notice}</div>}

      {(canRequest || canManage) && <form onSubmit={takeItem} className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white"><LogOut className="h-5 w-5 text-indigo-400" /> {canManage ? 'Record an item taken' : 'Request an item'}</h3>
        <p className="text-xs text-slate-400">{canManage
          ? 'Pick the item and who took it. Signing it back in when it is returned is the proof of custody.'
          : 'Ask for an item you need. Once a storeman or admin approves, it is signed out to you, and you sign it back in when you return it.'}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="mb-1 block text-xs uppercase text-slate-400">Item</label>
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
            <label className="mb-1 block text-xs uppercase text-slate-400">Quantity</label>
            <input type="number" min="1" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} className={inputClass} />
          </div>
          {canManage ? (
            <div>
              <label className="mb-1 block text-xs uppercase text-slate-400">Taken by</label>
              <select value={form.staffId} onChange={(e) => setForm((f) => ({ ...f, staffId: e.target.value }))} className={inputClass}>
                <option value="">Me</option>
                {staffOptions.filter((s) => s.id !== myCmmsUserId).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          ) : <div />}
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase text-slate-400">Purpose (optional)</label>
          <input type="text" value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} placeholder="e.g. Site visit, repair job..." className={inputClass} />
        </div>
        <button disabled={busy} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? <Loader className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />} {canManage ? 'Sign out item' : 'Send request'}
        </button>
      </form>}

      {canManage && pendingRequests.length > 0 && (
        <div className="space-y-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <h3 className="text-lg font-semibold text-white">Pending requests ({pendingRequests.length})</h3>
          {pendingRequests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-3">
              <div className="text-sm">
                <div className="font-medium text-white">{r.requester_name} wants {r.quantity} × {r.item_name}</div>
                <div className="text-xs text-slate-400">
                  {fmtDateTime(r.created_at)} · {r.quantity_in_stock} {r.unit_of_measure || 'units'} in stock{r.purpose ? ` · ${r.purpose}` : ''}
                </div>
              </div>
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => decideRequest(r, true)} className="rounded bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">Approve</button>
                <button disabled={busy} onClick={() => decideRequest(r, false)} className="rounded bg-red-500/80 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50">Decline</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!canManage && myRequests.length > 0 && (
        <div className="space-y-2 rounded-xl border border-slate-700 bg-slate-900/60 p-4">
          <h3 className="text-lg font-semibold text-white">My requests</h3>
          {myRequests.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-200">
              <div>
                {r.quantity} × {r.item_name}
                <span className="ml-2 text-xs text-slate-500">{fmtDateTime(r.created_at)}</span>
                {r.decision_note && <div className="text-xs text-slate-400">{r.decision_note}</div>}
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${REQUEST_STYLES[r.status] || ''}`}>{r.status}</span>
                {r.status === 'pending' && <button disabled={busy} onClick={() => cancelRequest(r)} className="text-xs text-slate-400 underline hover:text-white">Cancel</button>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">{canManage || canSeeAll ? 'Custody log' : 'My items'}</h3>
          <div className="flex items-center gap-2">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-white">
              <option value="checked_out">Currently out</option>
              <option value="returned">Returned</option>
              <option value="lost">Lost</option>
              <option value="all">All</option>
            </select>
            <button onClick={load} disabled={loading} className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm text-white hover:bg-slate-600 disabled:opacity-50">
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-800 text-xs uppercase text-slate-400">
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
            <tbody className="divide-y divide-slate-800 text-slate-200">
              {visibleLog.map((r) => (
                <tr key={r.id}>
                  <td className="px-3 py-2">
                    <div className="font-medium text-white">{r.item_name}</div>
                    {r.purpose && <div className="text-xs text-slate-400">{r.purpose}</div>}
                  </td>
                  <td className="px-3 py-2">
                    {r.holder_name}
                    {r.issued_by_name && <div className="text-xs text-slate-500">signed out by {r.issued_by_name}</div>}
                  </td>
                  <td className="px-3 py-2">{r.quantity}</td>
                  <td className="px-3 py-2">{fmtDateTime(r.taken_at)}</td>
                  <td className="px-3 py-2">
                    {fmtDateTime(r.returned_at)}
                    {r.return_condition && r.status !== 'checked_out' && <div className="text-xs capitalize text-slate-400">{r.return_condition}{r.return_notes ? ` — ${r.return_notes}` : ''}</div>}
                  </td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_STYLES[r.status] || ''}`}>{STATUS_LABELS[r.status] || r.status}</span></td>
                  <td className="px-3 py-2 text-right">
                    {r.status === 'checked_out' && (canManage || r.cmms_user_id === myCmmsUserId) && (
                      <button onClick={() => { setReturning(r); setError(''); }} className="inline-flex items-center gap-1.5 rounded bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/40">
                        <RotateCcw className="h-3 w-3" /> Sign back in
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && visibleLog.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No records to show.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {returning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-6">
            <h3 className="flex items-center gap-2 text-lg font-bold text-white"><RotateCcw className="h-5 w-5 text-emerald-400" /> Sign back in: {returning.item_name}</h3>
            <div>
              <label className="mb-1 block text-xs uppercase text-slate-400">Condition</label>
              <select value={returnForm.condition} onChange={(e) => setReturnForm((f) => ({ ...f, condition: e.target.value }))} className={inputClass}>
                <option value="good">Good — back in stock</option>
                <option value="damaged">Damaged — back in stock</option>
                <option value="lost">Lost — not returned</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs uppercase text-slate-400">Notes (optional)</label>
              <textarea rows={2} value={returnForm.notes} onChange={(e) => setReturnForm((f) => ({ ...f, notes: e.target.value }))} className={`${inputClass} resize-none`} />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setReturning(null)} className="flex-1 rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800">Cancel</button>
              <button onClick={returnItem} disabled={busy} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                {busy && <Loader className="h-4 w-4 animate-spin" />} Confirm return
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
