import React, { useEffect, useState } from 'react';
import { Loader, ShieldCheck, ChevronRight, Store, ArrowLeft } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { AuthPage } from './auth';
import { getMyInstallmentPlans, getMyBusinessAccounts, formatUGX, STATUS_LABELS } from '../services/installmentService';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/**
 * /plans — everything the signed-in customer is paying for: the businesses
 * they have an account with (what they have paid and still owe each) and every
 * instalment plan, open ones first.
 */
const PublicMyInstallments = () => {
  const { user, loading: authLoading } = useAuth();
  const [plans, setPlans] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([getMyInstallmentPlans(), getMyBusinessAccounts()])
      .then(([p, a]) => { if (!cancelled) { setPlans(p); setAccounts(a); } })
      .catch((err) => { if (!cancelled) setError(err.message || 'Could not load your plans'); });
    return () => { cancelled = true; };
  }, [user]);

  if (authLoading) return <div className="fixed inset-0 bg-slate-950 flex items-center justify-center"><Loader className="w-10 h-10 text-white animate-spin" /></div>;

  if (!user) {
    return (
      <div className="fixed inset-0 bg-slate-950 overflow-y-auto">
        <div className="max-w-md mx-auto px-4 pt-8 text-center">
          <ShieldCheck className="w-10 h-10 text-indigo-400 mx-auto mb-3" />
          <h1 className="text-xl font-bold text-white mb-1">Track your payments</h1>
          <p className="text-sm text-slate-400 mb-4">Sign in to see every plan you are paying off, with each business you have an account with.</p>
        </div>
        <AuthPage initialView="signin" onAuthSuccess={() => {}} />
      </div>
    );
  }

  const order = { awaiting_deposit: 0, active: 1, ready: 2, pickup_ready: 3, dispatched: 4, completed: 5, cancelled: 6, lapsed: 6 };
  const sorted = (plans || []).slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-y-auto">
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur border-b border-slate-800 px-4 py-3 flex items-center gap-2">
        <a href="/" className="p-1.5 rounded-full text-slate-400 hover:text-white hover:bg-white/10" aria-label="Back"><ArrowLeft className="w-5 h-5" /></a>
        <h1 className="text-white font-semibold">My payments</h1>
      </div>
      <div className="max-w-lg mx-auto p-4 space-y-4 pb-24">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!plans && !error && <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-slate-500 animate-spin" /></div>}

        {accounts.length > 0 && (
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">My accounts</p>
            <div className="space-y-2">
              {accounts.map((a) => (
                <div key={a.business_profile_id} className="rounded-xl border border-slate-800 bg-slate-900/70 p-3 flex items-center gap-3">
                  <Store className="w-5 h-5 text-indigo-300 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white font-medium truncate">{a.business_name}</p>
                    <p className="text-[11px] text-slate-500">Customer since {fmtDate(a.joined_at)} · {a.open_plans} open plan{a.open_plans === 1 ? '' : 's'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-500">Paid</p><p className="text-sm text-emerald-300 font-semibold">{formatUGX(a.paid_ugx)}</p>
                    {a.balance_ugx > 0 && <p className="text-[11px] text-slate-400">Owing {formatUGX(a.balance_ugx)}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {plans && (
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold mb-2">Instalment plans</p>
            {sorted.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-10">No plans yet. Choose “Pay in instalments” when you check out on a store or business website.</p>
            ) : (
              <div className="space-y-2">
                {sorted.map((p) => (
                  <a key={p.code} href={`/plan/${p.code}`} className="block rounded-xl border border-slate-800 bg-slate-900/70 p-3 hover:bg-slate-900 transition">
                    <div className="flex items-center gap-2">
                      <p className="text-sm text-white font-medium truncate flex-1">{p.seller_name || 'Order'} · {p.items.map((i) => i.name).slice(0, 2).join(', ')}{p.items.length > 2 ? '…' : ''}</p>
                      <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
                    </div>
                    <div className="flex justify-between text-xs mt-1">
                      <span className="text-slate-400">{STATUS_LABELS[p.status] || p.status} · {p.code}</span>
                      <span className="text-slate-300">{formatUGX(p.paid_ugx)} of {formatUGX(p.total_ugx)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden mt-2">
                      <div className="h-full bg-indigo-500" style={{ width: `${Math.min(100, Math.round((p.paid_ugx / Math.max(p.total_ugx, 1)) * 100))}%` }} />
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default PublicMyInstallments;
