import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase/client';

const labels = { production: 'Production and WIP', quality: 'Quality Control', clinical: 'Clinical Operations', pharmacy: 'Pharmacy and Supplies' };

export default function CMMSOperationsPanel({ businessProfileId, mode }) {
  const [events, setEvents] = useState([]);
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const load = async () => {
    if (!businessProfileId) return;
    const { data, error: loadError } = await supabase.from('cmms_operational_events').select('*').eq('business_profile_id', businessProfileId).eq('app_key', `cmms_${mode}`).order('event_at', { ascending: false }).limit(50);
    setEvents(data || []); setError(loadError?.message || '');
  };
  useEffect(() => { load(); }, [businessProfileId, mode]);
  const addEvent = async (event) => {
    event.preventDefault();
    const { data, error: saveError } = await supabase.from('cmms_operational_events').insert({ business_profile_id: businessProfileId, app_key: `cmms_${mode}`, event_type: mode, idempotency_key: crypto.randomUUID(), payload: { description } }).select().single();
    if (saveError) setError(saveError.message); else { setEvents(previous => [data, ...previous]); setDescription(''); }
  };
  return <div className="space-y-5"><div><h2 className="text-2xl font-bold text-white">{labels[mode]}</h2><p className="text-sm text-slate-400">Record and monitor {mode === 'production' ? 'production runs, WIP locks, and output checks' : mode === 'quality' ? 'quality inspections and non-conformities' : mode === 'clinical' ? 'clinical operational activities' : 'pharmacy stock and supply activities'}.</p></div><form onSubmit={addEvent} className="flex gap-3"><input required value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe an operation, check, or issue" className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-white" /><button className="rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white">Record</button></form>{error && <p className="text-sm text-red-300">{error}</p>}<div className="space-y-2">{events.map(item => <div key={item.id} className="rounded-lg border border-white/10 bg-white/5 p-3 text-white"><span className="text-xs text-slate-400">{new Date(item.event_at).toLocaleString()}</span><p>{item.payload?.description || item.event_type}</p></div>)}{!events.length && <p className="text-slate-400">No operational records yet.</p>}</div></div>;
}
