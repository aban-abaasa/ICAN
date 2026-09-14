import React, { useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2 } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { requestCorporateContract } from '../services/corporateSubscriptionService';

const ContractPage = ({ onBack }) => {
  const { actualTheme } = useTheme();
  const isDarkTheme = actualTheme === 'dark';
  const [form, setForm] = useState({
    companyName: '', contactName: '', contactEmail: '', contactPhone: '', employeeCount: '', message: '',
  });
  const [state, setState] = useState('idle'); // idle | sending | done | error
  const [error, setError] = useState('');

  const cardBg = isDarkTheme ? 'bg-slate-900/80 border-slate-600/40' : 'bg-white border-slate-300/70';
  const mutedText = isDarkTheme ? 'text-slate-400' : 'text-slate-600';
  const headingText = isDarkTheme ? 'text-white' : 'text-slate-900';
  const inputCls = `w-full rounded-xl border px-4 py-3 text-sm outline-none transition focus:border-purple-400/60 ${
    isDarkTheme ? 'bg-slate-950/50 border-slate-600/40 text-white placeholder:text-slate-500' : 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-400'
  }`;
  const labelCls = `mb-1.5 block text-xs font-semibold uppercase tracking-wide ${isDarkTheme ? 'text-slate-300' : 'text-slate-600'}`;

  const update = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (state === 'sending') return;
    setError('');

    const employeeCount = parseInt(form.employeeCount, 10);
    if (!form.companyName.trim() || !form.contactName.trim() || !form.contactEmail.trim()) {
      setError('Company name, contact name and email are required.');
      return;
    }
    if (!employeeCount || employeeCount <= 0) {
      setError('Enter a valid number of employees.');
      return;
    }

    setState('sending');
    try {
      const result = await requestCorporateContract({
        companyName: form.companyName,
        contactName: form.contactName,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        employeeCount,
        message: form.message,
      });
      if (!result?.success) {
        setError(result?.message || 'Something went wrong. Please try again.');
        setState('idle');
        return;
      }
      setState('done');
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.');
      setState('idle');
    }
  };

  return (
    <div className={`min-h-screen ${
      isDarkTheme
        ? 'bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-slate-100'
        : 'bg-gradient-to-br from-slate-100 via-slate-50 to-slate-100 text-slate-900'
    }`}>
      <nav className={`sticky top-0 w-full z-50 backdrop-blur-md border-b ${isDarkTheme ? 'bg-slate-950/70 border-slate-700/40' : 'bg-white/70 border-slate-300/70'}`}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center gap-4">
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

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center mb-10">
          <h1 className={`text-3xl md:text-4xl font-black leading-tight ${headingText}`}>Request a Contract plan</h1>
          <p className={`mt-3 text-base leading-relaxed ${mutedText}`}>
            For teams over 100 employees. Tell us about your team and we&rsquo;ll come back with a negotiated monthly price,
            billed the same way every IcanEra corporate plan is &mdash; straight from your business&rsquo;s IcanEra Coin wallet.
          </p>
        </div>

        {state === 'done' ? (
          <div className={`ican-cove-card border p-8 text-center ${cardBg}`}>
            <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
            <h2 className={`text-xl font-black mb-2 ${headingText}`}>Request received</h2>
            <p className={mutedText}>The IcanEra team will reach out to {form.contactEmail} to discuss pricing for your team.</p>
          </div>
        ) : (
          <form onSubmit={submit} className={`ican-cove-card border p-6 md:p-8 space-y-5 ${cardBg}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className={labelCls}>Company name</label>
                <input className={inputCls} value={form.companyName} onChange={update('companyName')} required />
              </div>
              <div>
                <label className={labelCls}>Number of employees</label>
                <input type="number" min="1" className={inputCls} value={form.employeeCount} onChange={update('employeeCount')} placeholder="e.g. 250" required />
              </div>
              <div>
                <label className={labelCls}>Your name</label>
                <input className={inputCls} value={form.contactName} onChange={update('contactName')} required />
              </div>
              <div>
                <label className={labelCls}>Email address</label>
                <input type="email" className={inputCls} value={form.contactEmail} onChange={update('contactEmail')} required />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Phone (optional)</label>
                <input className={inputCls} value={form.contactPhone} onChange={update('contactPhone')} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>What do you need? (optional)</label>
                <textarea rows={4} className={inputCls} value={form.message} onChange={update('message')} placeholder="Team size, departments, anything else we should know" />
              </div>
            </div>

            {error && <p className="text-sm text-rose-500">{error}</p>}

            <button
              type="submit"
              disabled={state === 'sending'}
              className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 rounded-full font-bold text-sm bg-gradient-to-r from-yellow-500 to-yellow-400 hover:from-yellow-400 hover:to-yellow-300 text-slate-900 shadow-lg hover:shadow-xl hover:shadow-yellow-500/50 transition-all duration-300 disabled:opacity-50"
            >
              {state === 'sending' && <Loader2 className="w-4 h-4 animate-spin" />}
              {state === 'sending' ? 'Sending…' : 'Request a contract'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ContractPage;
