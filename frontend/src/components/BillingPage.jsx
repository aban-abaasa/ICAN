import React, { useEffect, useState } from 'react';
import { ArrowLeft, AlertTriangle, CheckCircle2, Clock, Loader2, XCircle } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { getMyCorporateSubscription, getMyCorporateSubscriptionCharges } from '../services/corporateSubscriptionService';

const STATUS_META = {
  trialing: { label: 'Free trial', color: '#06b6d4', Icon: Clock },
  active: { label: 'Active', color: '#22c55e', Icon: CheckCircle2 },
  past_due: { label: 'Past due', color: '#f59e0b', Icon: AlertTriangle },
  canceled: { label: 'Canceled', color: '#ef4444', Icon: XCircle },
};

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-UG', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-UG', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

const BillingPage = ({ onBack }) => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const businessProfileId = new URLSearchParams(window.location.search).get('business') || '';

  const [sub, setSub] = useState(null);
  const [charges, setCharges] = useState([]);
  const [state, setState] = useState('loading'); // loading | ready | error | missing
  const [error, setError] = useState('');

  useEffect(() => {
    if (!businessProfileId) { setState('missing'); return; }
    let cancelled = false;
    (async () => {
      try {
        const [subData, chargeData] = await Promise.all([
          getMyCorporateSubscription(businessProfileId),
          getMyCorporateSubscriptionCharges(businessProfileId),
        ]);
        if (cancelled) return;
        setSub(subData);
        setCharges(chargeData);
        setState('ready');
      } catch (err) {
        if (cancelled) return;
        setError(err.message || 'Could not load billing information.');
        setState('error');
      }
    })();
    return () => { cancelled = true; };
  }, [businessProfileId]);

  const cardBg = isDarkTheme ? 'bg-slate-900/80 border-slate-600/40' : 'bg-white border-slate-300/70';
  const mutedText = isDarkTheme ? 'text-slate-400' : 'text-slate-600';
  const headingText = isDarkTheme ? 'text-white' : 'text-slate-900';

  return (
    <div className={`min-h-screen ${
      isDarkTheme
        ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100'
        : 'bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100 text-slate-900'
    }`}>
      <nav className={`sticky top-0 w-full z-50 backdrop-blur-md border-b ${isDarkTheme ? 'bg-slate-950/70 border-slate-700/40' : 'bg-white/70 border-slate-300/70'}`}>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
          <button
            onClick={onBack}
            className={`flex items-center gap-1.5 text-sm font-semibold transition-colors ${isDarkTheme ? 'text-slate-300 hover:text-white' : 'text-slate-600 hover:text-slate-900'}`}
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div
            className="text-2xl font-black tracking-tight ml-auto"
            style={{ color: 'var(--color-secondary)', textShadow: isDarkTheme ? '0 0 14px rgba(129, 140, 248, 0.35)' : '0 1px 0 rgba(255,255,255,0.5)' }}
          >
            IcanEra
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h1 className={`text-3xl md:text-4xl font-black leading-tight mb-8 ${headingText}`}>Billing</h1>

        {state === 'missing' && (
          <div className={`ican-cove-card border p-8 text-center ${cardBg}`}>
            <p className={headingText}>No business selected.</p>
            <p className={`mt-2 text-sm ${mutedText}`}>
              Open Billing from your business dashboard inside IcanEra so it can link your subscription — this page needs a
              business to look up (the link should include <code>?business=&lt;your business id&gt;</code>).
            </p>
          </div>
        )}

        {state === 'loading' && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
          </div>
        )}

        {state === 'error' && (
          <div className={`ican-cove-card border p-8 text-center ${cardBg}`}>
            <p className="text-rose-500 font-semibold">{error}</p>
          </div>
        )}

        {state === 'ready' && !sub && (
          <div className={`ican-cove-card border p-8 text-center ${cardBg}`}>
            <p className={headingText}>No corporate subscription yet.</p>
            <p className={`mt-2 text-sm ${mutedText}`}>Start a free trial from the pricing page to see billing here.</p>
          </div>
        )}

        {state === 'ready' && sub && (
          <>
            <div className={`ican-cove-card border p-6 md:p-8 mb-8 ${cardBg}`}>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
                <div>
                  <p className={`text-xs uppercase tracking-wide font-semibold ${mutedText}`}>Current plan</p>
                  <p className={`text-2xl font-black capitalize ${headingText}`}>{sub.tier}</p>
                </div>
                {(() => {
                  const meta = STATUS_META[sub.status] || STATUS_META.active;
                  const { Icon } = meta;
                  return (
                    <div className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-bold"
                      style={{ borderColor: `${meta.color}55`, background: `${meta.color}15`, color: meta.color }}>
                      <Icon className="w-4 h-4" /> {meta.label}
                    </div>
                  );
                })()}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                <div>
                  <p className={`text-xs ${mutedText}`}>Monthly price</p>
                  <p className={`font-bold ${headingText}`}>{Number(sub.monthly_price_ic).toFixed(2)} IC</p>
                </div>
                <div>
                  <p className={`text-xs ${mutedText}`}>Employees</p>
                  <p className={`font-bold ${headingText}`}>{sub.employee_count}</p>
                </div>
                <div>
                  <p className={`text-xs ${mutedText}`}>{sub.status === 'trialing' ? 'Trial ends' : 'Next billing'}</p>
                  <p className={`font-bold ${headingText}`}>{fmtDate(sub.status === 'trialing' ? sub.trial_ends_at : sub.next_billing_at)}</p>
                </div>
                <div>
                  <p className={`text-xs ${mutedText}`}>Pitchin storage</p>
                  <p className={`font-bold ${headingText}`}>{sub.storage_mb ? `${(sub.storage_mb / 1000).toFixed(1)} GB/mo` : 'Unlimited'}</p>
                </div>
              </div>

              {sub.status === 'past_due' && (
                <div className="mt-5 rounded-xl border p-4 text-sm" style={{ borderColor: '#f59e0b55', background: '#f59e0b15', color: '#f59e0b' }}>
                  Your last renewal failed — top up your IcanEra Coin wallet before the 5-day grace period ends to avoid cancellation.
                </div>
              )}
            </div>

            <div className={`ican-cove-card border p-6 md:p-8 ${cardBg}`}>
              <p className={`text-sm font-bold mb-4 ${headingText}`}>Billing history</p>
              {charges.length === 0 ? (
                <p className={`text-sm ${mutedText}`}>No charges yet.</p>
              ) : (
                <div className="space-y-2">
                  {charges.map((c) => (
                    <div key={c.id} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${isDarkTheme ? 'border-slate-700/50' : 'border-slate-200'}`}>
                      <div>
                        <p className={headingText}>{c.outcome === 'charged' ? 'Charged' : 'Insufficient funds'}</p>
                        <p className={`text-xs ${mutedText}`}>{fmtDateTime(c.created_at)}</p>
                      </div>
                      <p className={`font-bold ${c.outcome === 'charged' ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {c.outcome === 'charged' ? '-' : ''}{Number(c.amount_ic).toFixed(2)} IC
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default BillingPage;
