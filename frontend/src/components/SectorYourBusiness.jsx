import React, { useCallback, useEffect, useState } from 'react';
import { Briefcase, ChevronRight } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { getDataTerms, getDataConsentStatus, acceptDataTerms } from '../services/sectorMarketService';

// "Your business" on the Sector Markets screen: the businesses the signed-in person owns (read from their Pitchin business
// profiles, the same ones Manage your business opens), and whether each one is sharing its sales anonymously into its sector.
// A sector opens only from real sales of businesses that agreed, so this is where an owner turns that on, or opens
// Manage your business. Renders nothing for someone with no business, or when the sector feature is not installed.

export const MANAGE_BUSINESS_EVENT = 'ican-open-manage-business';
export const openManageBusiness = () => window.dispatchEvent(new CustomEvent(MANAGE_BUSINESS_EVENT));

export default function SectorYourBusiness({ userId }) {
  const [rows, setRows] = useState(null);       // null: loading; [] none
  const [terms, setTerms] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!userId) { setRows([]); return; }
    try {
      const { data } = await supabase.from('business_profiles').select('id, business_name').eq('user_id', userId).order('created_at', { ascending: true });
      const [t, list] = await Promise.all([
        getDataTerms().catch(() => null),
        Promise.all((data || []).map(async (b) => {
          const status = await getDataConsentStatus(b.id).catch(() => null);
          return { id: b.id, name: b.business_name || 'Your business', accepted: status ? status.accepted === true : null };
        })),
      ]);
      setTerms(t);
      setRows(list);
    } catch {
      setRows([]);
    }
  }, [userId]);
  useEffect(() => { load(); }, [load]);

  const accept = async (id) => {
    if (!terms) return;
    setBusyId(id); setError('');
    const res = await acceptDataTerms(id, terms.version).catch((e) => ({ success: false, error: e?.message }));
    setBusyId(null);
    if (res.success) load(); else setError(res.error || 'Could not save your answer. Please try again.');
  };

  if (!userId || !rows || rows.length === 0 || !terms) return null;

  return (
    <section className="rounded-2xl border border-indigo-400/25 bg-indigo-500/5 p-4 space-y-3" aria-label="Your business">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-indigo-500/20"><Briefcase className="h-5 w-5 text-indigo-300" /></div>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-white">Your business counts here</h4>
          <p className="text-xs text-slate-400">A sector opens from the real, combined sales of businesses that agree to share them anonymously. Your name and customers are never shown.</p>
        </div>
      </div>
      <ul className="space-y-2">
        {rows.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-950/60 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{b.name}</p>
              <p className={`text-xs ${b.accepted ? 'text-emerald-400' : 'text-slate-400'}`}>
                {b.accepted === null ? 'Sharing status unavailable' : b.accepted ? 'Sharing sales anonymously' : 'Not sharing sales yet'}
              </p>
            </div>
            {b.accepted === false && (
              <button type="button" onClick={() => accept(b.id)} disabled={busyId === b.id}
                className="flex-shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-900 disabled:opacity-50">
                {busyId === b.id ? 'Saving…' : 'Share anonymously'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-red-400" role="alert">{error}</p>}
      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer text-slate-300">What exactly is shared?</summary>
        <p className="mt-1 leading-relaxed">{terms.body}</p>
      </details>
      <button type="button" onClick={openManageBusiness}
        className="flex w-full items-center justify-between rounded-lg border border-indigo-400/30 px-3 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/10">
        Manage your business <ChevronRight className="h-4 w-4" />
      </button>
    </section>
  );
}
