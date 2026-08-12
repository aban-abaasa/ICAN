import React, { useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, Loader2, XCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';

// Store-wallet approvals deliberately use a server RPC: the browser never
// changes balances, and a supplier can only be credited by the wallet engine.
export default function SupplierOrderPaymentApprovals({ companyId, canApprove }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    if (!companyId || !canApprove) { setOrders([]); setLoading(false); return; }
    setLoading(true); setError('');
    const { data, error: rpcError } = await supabase.rpc('cmms_get_supplier_payment_approvals', {
      p_cmms_company_id: companyId,
    });
    if (rpcError) setError(rpcError.message);
    else setOrders(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [companyId, canApprove]);

  const decide = async (orderId, decision) => {
    if (decision === 'approved' && !pin) { setError('Enter the business-wallet PIN to approve payment.'); return; }
    setBusyId(orderId); setError('');
    const { error: rpcError } = await supabase.rpc('cmms_decide_supplier_order_payment', {
      p_order_id: orderId, p_decision: decision, p_pin: decision === 'approved' ? pin : null,
    });
    if (rpcError) setError(rpcError.message);
    else { setPin(''); await load(); }
    setBusyId(null);
  };

  if (!canApprove) return null;
  return <section className="mb-5 rounded-xl border border-amber-400/30 bg-amber-500/10 p-4">
    <div className="mb-3 flex items-center gap-2"><CreditCard className="h-5 w-5 text-amber-300" /><div><h3 className="font-bold text-white">Store supplier-payment approvals</h3><p className="text-xs text-gray-300">For wholesale stores: approve manager orders to pay suppliers from the store wallet.</p></div></div>
    {loading ? <div className="flex items-center gap-2 text-sm text-gray-300"><Loader2 className="h-4 w-4 animate-spin" /> Loading payment requests…</div> : orders.length === 0 ? <p className="text-sm text-gray-300">No supplier payments are awaiting approval.</p> : <>
      <input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} placeholder="Business-wallet PIN" className="mb-3 w-full rounded border border-white/20 bg-slate-950 px-3 py-2 text-white" />
      <div className="space-y-2">{orders.map(order => {
        const amount = order.metadata?.amount_ugx ?? Number(order.unit_price || 0) * Number(order.quantity || 0);
        return <div key={order.id} className="rounded-lg bg-black/25 p-3 text-sm text-gray-200"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-white">{order.order_number}</strong><span className="ml-2">{order.quantity} × UGX {Number(order.unit_price || 0).toLocaleString()}</span><div className="text-xs text-gray-400">Total: UGX {Number(amount || 0).toLocaleString()} · supplier wallet receives payment after approval</div></div><div className="flex gap-2"><button disabled={busyId === order.id} onClick={() => decide(order.id, 'rejected')} className="rounded bg-red-500/20 px-3 py-1.5 text-red-200"><XCircle className="mr-1 inline h-4 w-4" />Reject</button><button disabled={busyId === order.id} onClick={() => decide(order.id, 'approved')} className="rounded bg-emerald-600 px-3 py-1.5 font-semibold text-white">{busyId === order.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="mr-1 inline h-4 w-4" />Approve & pay</>}</button></div></div></div>;
      })}</div>
    </>}
    {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
  </section>;
}
