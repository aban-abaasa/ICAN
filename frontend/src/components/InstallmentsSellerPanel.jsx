import React, { useCallback, useEffect, useState } from 'react';
import { Loader, Users, ListChecks, ToggleLeft, ToggleRight, XCircle, Package } from 'lucide-react';
import {
  getSellerInstallmentPlans, sellerCancelInstallmentPlan, getBusinessSiteCustomers, getBusinessSiteInfo, setBusinessSiteAccounts,
  formatUGX, STATUS_LABELS,
} from '../services/installmentService';

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-UG', { day: 'numeric', month: 'short' }) : '');
const OPEN = ['awaiting_deposit', 'active', 'ready'];

/**
 * The seller's view of instalments: who is paying what, who is waiting to
 * collect, the customers who created an account on the website, and the switch
 * that lets people create those accounts (and pay in instalments) at all.
 * Handing goods over is done by the store scanning the customer's pickup QR
 * (the same receipt scan used for deliveries) — that is also what pays the
 * seller and the store.
 */
const InstallmentsSellerPanel = ({ businessProfileId }) => {
  const [view, setView] = useState('plans'); // plans | customers
  const [plans, setPlans] = useState(null);
  const [customers, setCustomers] = useState(null);
  const [accountsOn, setAccountsOn] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);

  const load = useCallback(async () => {
    try {
      const [p, c, info] = await Promise.all([
        getSellerInstallmentPlans(businessProfileId), getBusinessSiteCustomers(businessProfileId), getBusinessSiteInfo(businessProfileId),
      ]);
      setPlans(p); setCustomers(c); setAccountsOn(info.accounts_enabled !== false); setError('');
    } catch (err) {
      setError(err.message || 'Could not load instalments');
    }
  }, [businessProfileId]);

  useEffect(() => { load(); }, [load]);

  const toggleAccounts = async () => {
    setBusy('accounts');
    try { await setBusinessSiteAccounts(businessProfileId, !accountsOn); setAccountsOn(!accountsOn); } catch (err) { setError(err.message); }
    setBusy(null);
  };

  const cancel = async (plan) => {
    const reason = window.prompt(`Cancel ${plan.customer_name || 'this customer'}'s plan ${plan.code}? ${formatUGX(plan.paid_ugx)} is returned to them in full. Reason (optional):`, '');
    if (reason === null) return;
    setBusy(plan.code);
    try { await sellerCancelInstallmentPlan(plan.code, reason); await load(); } catch (err) { setError(err.message); }
    setBusy(null);
  };

  if (!plans && !error) return <div className="flex justify-center py-10"><Loader className="w-6 h-6 text-slate-500 animate-spin" /></div>;

  const open = (plans || []).filter((p) => OPEN.includes(p.status));
  const waiting = (plans || []).filter((p) => p.status === 'pickup_ready');
  const owed = open.reduce((sum, p) => sum + Number(p.balance_ugx || 0), 0);

  return (
    <div className="space-y-3">
      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bgSecondary)' }}>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Customer accounts &amp; instalments</p>
          <p className="text-xs" style={{ color: 'var(--color-textSecondary)' }}>
            {accountsOn ? 'People can create an account on your website, track their payments and pay in instalments.' : 'Off: your website does not offer accounts or instalments.'}
          </p>
        </div>
        <button onClick={toggleAccounts} disabled={busy === 'accounts'} className="shrink-0" aria-label="Toggle customer accounts" aria-pressed={accountsOn}>
          {accountsOn ? <ToggleRight className="w-9 h-9 text-emerald-400" /> : <ToggleLeft className="w-9 h-9 text-slate-500" />}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[['Open plans', open.length], ['Customers owe', formatUGX(owed)], ['To collect', waiting.length]].map(([label, value]) => (
          <div key={label} className="rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bgSecondary)' }}>
            <p className="text-[11px]" style={{ color: 'var(--color-textSecondary)' }}>{label}</p>
            <p className="text-sm font-bold break-words" style={{ color: 'var(--color-text)' }}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {[['plans', 'Plans', ListChecks], ['customers', 'Customers', Users]].map(([id, label, Icon]) => (
          <button key={id} onClick={() => setView(id)} className={`flex items-center justify-center gap-2 rounded-xl border py-2 text-xs font-semibold transition ${view === id ? 'border-indigo-500 bg-indigo-500/10 text-white' : 'border-slate-800 text-slate-400 hover:bg-slate-800/50'}`}>
            <Icon className="w-4 h-4" />{label}{id === 'customers' && customers ? ` (${customers.length})` : ''}
          </button>
        ))}
      </div>

      {view === 'plans' && (
        (plans || []).length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">No instalment plans yet. They appear here when a customer chooses “Pay in instalments” on your storefront or website.</p>
        ) : (
          <div className="space-y-2">
            {plans.map((p) => (
              <div key={p.code} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', borderLeft: `3px solid ${p.status === 'pickup_ready' ? '#10b981' : '#6366f1'}`, backgroundColor: 'var(--color-bgSecondary)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{p.customer_name || 'Customer'}{p.customer_phone ? ` · ${p.customer_phone}` : ''}</p>
                    <p className="text-xs truncate" style={{ color: 'var(--color-textSecondary)' }}>{p.items.map((i) => `${i.name} ×${Number(i.quantity)}`).join(', ')}</p>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-300 shrink-0">{STATUS_LABELS[p.status] || p.status}</span>
                </div>
                <div className="flex justify-between text-xs mt-1.5" style={{ color: 'var(--color-textSecondary)' }}>
                  <span>{p.code} · {fmtDate(p.created_at)}{OPEN.includes(p.status) ? ` · due by ${fmtDate(p.final_due_at)}` : ''}</span>
                  <span style={{ color: 'var(--color-text)' }}>{formatUGX(p.paid_ugx)} of {formatUGX(p.total_ugx)}</span>
                </div>
                {p.status === 'pickup_ready' && (
                  <p className="text-xs text-emerald-400 mt-1.5 flex items-center gap-1.5"><Package className="w-3.5 h-3.5" />Waiting to collect at {p.store_name} — the store scans their QR to hand over and release payment.</p>
                )}
                {OPEN.includes(p.status) && (
                  <button onClick={() => cancel(p)} disabled={busy === p.code} className="mt-2 text-xs text-slate-500 hover:text-red-400 flex items-center gap-1">
                    {busy === p.code ? <Loader className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}Cancel &amp; refund (e.g. out of stock)
                  </button>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {view === 'customers' && (
        (customers || []).length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-8">No customers have created an account on your website yet.</p>
        ) : (
          <div className="space-y-2">
            {customers.map((c) => (
              <div key={c.user_id} className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-bgSecondary)' }}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{c.full_name || 'Customer'}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--color-textSecondary)' }}>{c.phone || 'No phone'} · joined {fmtDate(c.joined_at)}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-emerald-400 font-semibold">Paid {formatUGX(c.paid_ugx)}</p>
                  {c.balance_ugx > 0 && <p className="text-[11px] text-slate-400">Owes {formatUGX(c.balance_ugx)}</p>}
                  <p className="text-[11px] text-slate-500">{c.plans} plan{c.plans === 1 ? '' : 's'}</p>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
};

export default InstallmentsSellerPanel;
