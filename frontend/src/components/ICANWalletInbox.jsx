import React, { useEffect, useState } from 'react';
import { Bell, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { enableWalletPhoneAlerts } from '../services/walletPushService';

// Shared inbox: records are produced in the database for every connected app.
export default function ICANWalletInbox() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [pushMessage, setPushMessage] = useState('');

  const load = async () => {
    const { data } = await supabase.rpc('ican_get_wallet_inbox', { p_unread_only: false });
    setItems(data || []);
  };
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, []);
  const unread = items.filter((item) => !item.read_at).length;
  const read = async (id) => { await supabase.rpc('ican_mark_wallet_inbox_read', { p_notification_id: id }); await load(); };

  return <div className="relative">
    <button onClick={() => setOpen((value) => !value)} className="relative rounded-lg p-2 text-sky-200 hover:bg-sky-400/10" title="ICANera Wallet notifications">
      <Bell className="h-5 w-5" />
      {unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1 text-xs font-bold text-white">{unread}</span>}
    </button>
    {open && <div className="absolute right-0 z-50 mt-2 w-96 max-w-[90vw] rounded-xl border border-sky-300/30 bg-slate-950 p-3 shadow-2xl">
      <h3 className="mb-2 font-bold text-white">ICANera Wallet notifications</h3>
      <button onClick={async () => { try { await enableWalletPhoneAlerts(); setPushMessage('Phone alerts enabled for this installed device.'); } catch (error) { setPushMessage(error.message); } }} className="mb-3 rounded bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white">Enable phone alerts</button>
      {pushMessage && <p className="mb-2 text-xs text-sky-200">{pushMessage}</p>}
      {items.length === 0 ? <p className="text-sm text-gray-400">No wallet notifications yet.</p> : <div className="max-h-96 space-y-2 overflow-auto">{items.slice(0, 30).map((item) => <button key={item.id} onClick={() => read(item.id)} className={`w-full rounded-lg p-3 text-left ${item.read_at ? 'bg-white/5' : 'bg-sky-500/15 border border-sky-300/30'}`}><div className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 text-sky-300" /><div><p className="text-sm font-semibold text-white">{item.title}</p><p className="text-xs text-gray-300">{item.message}</p>{item.amount_ican != null && <p className="mt-1 text-xs text-emerald-300">{Number(item.amount_ican).toLocaleString()} ICAN · {item.source_app}</p>}</div></div></button>)}</div>}
    </div>}
  </div>;
}
