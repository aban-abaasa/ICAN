import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2, LockKeyhole, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { enableWalletPhoneAlerts, disableWalletPhoneAlerts, getWalletPhoneAlertsStatus } from '../services/walletPushService';
import { approveBusinessWalletTransaction } from '../services/icanWalletService';

// Shared inbox: records are produced in the database for every connected app.
export default function ICANWalletInbox() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const [phoneAlertsEnabled, setPhoneAlertsEnabled] = useState(false);
  const [approvalItem, setApprovalItem] = useState(null);
  const [pin, setPin] = useState('');
  const [approvalError, setApprovalError] = useState('');
  const [approving, setApproving] = useState(false);

  const load = async () => {
    const { data } = await supabase.rpc('ican_get_wallet_inbox', { p_unread_only: false });
    setItems(data || []);
  };
  useEffect(() => {
    load();
    getWalletPhoneAlertsStatus().then((status) => setPhoneAlertsEnabled(status.enabled)).catch(() => {});
    const channel = supabase
      .channel('ican-wallet-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ican_wallet_inbox_notifications' }, load)
      .subscribe();
    const id = setInterval(load, 30000);
    return () => { clearInterval(id); supabase.removeChannel(channel); };
  }, []);

  const togglePhoneAlerts = async () => {
    try {
      if (phoneAlertsEnabled) {
        await disableWalletPhoneAlerts();
        setPhoneAlertsEnabled(false);
        setPushMessage('Phone alerts are off for this device.');
      } else {
        await enableWalletPhoneAlerts();
        setPhoneAlertsEnabled(true);
        setPushMessage('Phone alerts are enabled for this device.');
      }
    } catch (error) {
      setPushMessage(error.message);
    }
  };

  const unread = items.filter((item) => !item.read_at).length;
  const read = async (id) => { await supabase.rpc('ican_mark_wallet_inbox_read', { p_notification_id: id }); await load(); };
  const remove = async (id, event) => {
    event.stopPropagation();
    setItems((prev) => prev.filter((item) => item.id !== id));
    await supabase.rpc('ican_delete_wallet_inbox_notification', { p_notification_id: id });
  };
  const clearAll = async () => {
    setItems([]);
    await supabase.rpc('ican_clear_wallet_inbox', { p_read_only: false });
  };
  const selectItem = async (item) => {
    if (item.notification_type === 'wallet_approval_required' && item.business_wallet_transaction_id) {
      setApprovalItem(item); setPin(''); setApprovalError('');
      return;
    }
    await read(item.id);
  };
  const approve = async () => {
    if (!/^\d{4,6}$/.test(pin)) { setApprovalError('Enter the 4-6 digit business-wallet PIN.'); return; }
    setApproving(true); setApprovalError('');
    try {
      await approveBusinessWalletTransaction(approvalItem.business_wallet_transaction_id, 'approved', pin);
      await read(approvalItem.id);
      setApprovalItem(null); setPin('');
    } catch (error) {
      setApprovalError(error?.message || 'Could not approve this wallet payment.');
    } finally {
      setApproving(false);
    }
  };

  return <div className="relative">
    <button onClick={() => setOpen((value) => !value)} className="relative rounded-lg p-2 text-sky-200 hover:bg-sky-400/10" title="IcanEra Wallet notifications">
      <Bell className="h-5 w-5" />
      {unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-xs font-bold text-white">{unread}</span>}
    </button>
    {open && <div className="absolute right-0 z-50 mt-2 w-96 max-w-[90vw] rounded-xl border border-sky-300/30 bg-slate-950 p-3 shadow-2xl">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-bold text-white">IcanEra Wallet notifications</h3>
        {items.length > 0 && <button onClick={clearAll} className="text-xs text-gray-400 hover:text-red-300">Clear all</button>}
      </div>
      <button onClick={togglePhoneAlerts} className={`mb-3 rounded px-3 py-1.5 text-xs font-semibold text-white ${phoneAlertsEnabled ? 'bg-slate-700 hover:bg-slate-600' : 'bg-sky-600 hover:bg-sky-500'}`}>{phoneAlertsEnabled ? 'Disable phone alerts' : 'Enable phone alerts'}</button>
      {pushMessage && <p className="mb-2 text-xs text-sky-200">{pushMessage}</p>}
      {items.length === 0 ? <p className="text-sm text-gray-400">No wallet notifications yet.</p> : <div className="max-h-96 space-y-2 overflow-auto">{items.slice(0, 30).map((item) => <div key={item.id} onClick={() => selectItem(item)} className={`group relative w-full cursor-pointer rounded-lg p-3 pr-8 text-left ${item.read_at ? 'bg-white/5' : 'bg-sky-500/15 border border-sky-300/30'}`}><button onClick={(event) => remove(item.id, event)} title="Delete" className="absolute right-2 top-2 rounded p-1 text-gray-500 opacity-0 hover:bg-white/10 hover:text-red-300 group-hover:opacity-100"><Trash2 className="h-3.5 w-3.5" /></button><div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-sky-300" /><div><p className="text-sm font-semibold text-white">{item.title}</p><p className="text-xs text-gray-300">{item.message}</p>{item.amount_ican != null && <p className="mt-1 text-xs text-emerald-300">{Number(item.amount_ican).toLocaleString()} IcanEra · {item.source_app}</p>}{item.notification_type === 'wallet_approval_required' && <p className="mt-1 text-xs font-semibold text-amber-300">Click to review and approve with PIN</p>}</div></div></div>)}</div>}
      {approvalItem && <div className="mt-3 rounded-lg border border-amber-300/40 bg-amber-300/10 p-3"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-100"><LockKeyhole className="h-4 w-4" />Approve business-wallet payment</div><p className="mb-3 text-xs text-amber-50/80">Enter the business-wallet PIN to approve and pay {Number(approvalItem.amount_ican || 0).toLocaleString()} IcanEra.</p><input autoFocus type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Business-wallet PIN" className="mb-2 w-full rounded border border-sky-200/40 bg-slate-900 px-3 py-2 text-white" /><div className="flex justify-end gap-2"><button disabled={approving} onClick={() => { setApprovalItem(null); setPin(''); setApprovalError(''); }} className="rounded px-2 py-1 text-sm text-slate-200">Cancel</button><button disabled={approving || pin.length < 4} onClick={approve} className="rounded bg-emerald-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50">{approving ? 'Approving…' : 'Approve & pay'}</button></div>{approvalError && <p className="mt-2 text-xs text-red-300">{approvalError}</p>}</div>}
    </div>}
  </div>;
}
