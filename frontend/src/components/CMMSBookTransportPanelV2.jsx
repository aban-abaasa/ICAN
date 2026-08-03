import React, { useEffect, useState } from 'react';
import { Car, Check, Loader, Plus, RefreshCw, X } from 'lucide-react';
import { supabase } from '../lib/supabase/client';

const blankContract = { contract_name: '', billing_cycle: 'monthly', monthly_limit: '', credit_limit: '', currency: 'UGX', starts_on: new Date().toISOString().slice(0, 10), ends_on: '' };
const blankRequest = { contract_id: '', vehicle_type: 'car', ride_count: 1, pickup: '', dropoff: '', scheduled_at: '', recurrence: 'once' };
const money = (value, currency = 'UGX') => `${currency} ${Number(value || 0).toLocaleString()}`;

export default function CMMSBookTransportPanel({ companyProfile }) {
  const businessProfileId = companyProfile?.pichin_business_profile_id;
  const [contracts, setContracts] = useState([]);
  const [requests, setRequests] = useState([]);
  const [contractForm, setContractForm] = useState(blankContract);
  const [requestForm, setRequestForm] = useState(blankRequest);
  const [showContractForm, setShowContractForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    if (!businessProfileId) { setLoading(false); return; }
    setLoading(true); setError('');
    const [contractsResult, requestsResult] = await Promise.all([
      supabase.from('mbg_corporate_transport_contracts').select('id,contract_name,billing_cycle,monthly_limit,credit_limit,currency,status,starts_on,ends_on,created_at').eq('business_profile_id', businessProfileId).order('created_at', { ascending: false }),
      supabase.from('mbg_corporate_ride_requests').select('id,contract_id,ride_count,requested_vehicle_type,recurrence,pickup_location,dropoff_location,scheduled_for,status,estimated_total,created_at').eq('business_profile_id', businessProfileId).order('created_at', { ascending: false }).limit(20)
    ]);
    const readError = contractsResult.error || requestsResult.error;
    if (readError) setError(readError.code === '42P01' || /does not exist/i.test(readError.message || '')
      ? 'Install BodaGo transport first by running mybodaguy/backend/database/SHARED_CORPORATE_TRANSPORT_AND_MONTHLY_RIDERS.sql in Supabase.'
      : readError.message);
    const nextContracts = contractsResult.data || [];
    setContracts(nextContracts); setRequests(requestsResult.data || []);
    setRequestForm(previous => ({ ...previous, contract_id: nextContracts.some(c => c.id === previous.contract_id) ? previous.contract_id : nextContracts.find(c => c.status === 'active')?.id || '' }));
    setLoading(false);
  };

  useEffect(() => { load(); }, [businessProfileId]);

  const createContract = async event => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    if (!businessProfileId || !contractForm.contract_name.trim()) { setError('Enter a contract name first.'); setSaving(false); return; }
    const { data: auth } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase.from('mbg_corporate_transport_contracts').insert({
      business_profile_id: businessProfileId, contract_name: contractForm.contract_name.trim(), billing_cycle: contractForm.billing_cycle,
      monthly_limit: contractForm.monthly_limit === '' ? null : Number(contractForm.monthly_limit), credit_limit: contractForm.credit_limit === '' ? null : Number(contractForm.credit_limit),
      currency: (contractForm.currency || 'UGX').trim().toUpperCase(), starts_on: contractForm.starts_on, ends_on: contractForm.ends_on || null, created_by: auth?.user?.id, status: 'active'
    }).select('id,contract_name,billing_cycle,monthly_limit,credit_limit,currency,status,starts_on,ends_on,created_at').single();
    if (insertError) setError(insertError.message);
    else { setContracts(previous => [data, ...previous]); setRequestForm(previous => ({ ...previous, contract_id: data.id })); setContractForm(blankContract); setShowContractForm(false); setMessage('Transport contract created and activated.'); }
    setSaving(false);
  };

  const submitRequest = async event => {
    event.preventDefault(); setSaving(true); setError(''); setMessage('');
    const selected = contracts.find(c => c.id === requestForm.contract_id);
    if (!businessProfileId || !selected || selected.status !== 'active') { setError('Select an active contract first.'); setSaving(false); return; }
    const { data: auth } = await supabase.auth.getUser();
    const { data, error: insertError } = await supabase.from('mbg_corporate_ride_requests').insert({
      contract_id: selected.id, business_profile_id: businessProfileId, requested_by: auth?.user?.id, ride_count: Math.max(1, Number(requestForm.ride_count) || 1),
      requested_vehicle_type: requestForm.vehicle_type, recurrence: requestForm.recurrence, pickup_location: requestForm.pickup.trim(), dropoff_location: requestForm.dropoff.trim(), scheduled_for: requestForm.scheduled_at || null, status: 'pending'
    }).select('id,contract_id,ride_count,requested_vehicle_type,recurrence,pickup_location,dropoff_location,scheduled_for,status,estimated_total,created_at').single();
    if (insertError) setError(insertError.message);
    else { setRequests(previous => [data, ...previous]); setRequestForm(previous => ({ ...previous, ride_count: 1, pickup: '', dropoff: '', scheduled_at: '' })); setMessage('Transport request submitted to BodaGo for dispatch.'); }
    setSaving(false);
  };

  const cancelRequest = async id => {
    setCancelling(id); setError('');
    const { error: updateError } = await supabase.from('mbg_corporate_ride_requests').update({ status: 'cancelled' }).eq('id', id).eq('business_profile_id', businessProfileId).eq('status', 'pending');
    if (updateError) setError(updateError.message);
    else { setRequests(previous => previous.map(row => row.id === id ? { ...row, status: 'cancelled' } : row)); setMessage('Pending transport request cancelled.'); }
    setCancelling(null);
  };

  const activeContracts = contracts.filter(c => c.status === 'active');
  const contractName = id => contracts.find(c => c.id === id)?.contract_name || 'Contract';
  const input = 'mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white';

  return <div className="max-w-3xl space-y-5 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6">
    <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><Car className="h-6 w-6 text-orange-400" /><div><h2 className="text-xl font-bold text-white">Book Transport</h2><p className="text-sm text-slate-400">CMMS manages company assets and employees; BodaGo manages contracts, riders, and rides.</p></div></div><button type="button" onClick={load} className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button></div>
    {!businessProfileId && <p className="rounded-lg border border-amber-800/50 bg-amber-900/20 p-3 text-sm text-amber-300">Link the Pichin business profile before using company transport.</p>}
    {error && <p className="rounded-lg border border-red-800/50 bg-red-900/20 p-3 text-sm text-red-300">{error}</p>}{message && <p className="rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-3 text-sm text-emerald-300">{message}</p>}

    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4"><div className="flex items-center justify-between gap-2"><div><h3 className="font-semibold text-white">Transport contracts</h3><p className="text-xs text-slate-500">Create the commercial agreement BodaGo uses to dispatch rides.</p></div><button type="button" onClick={() => setShowContractForm(value => !value)} className="flex items-center gap-1 rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white"><Plus size={14} /> New contract</button></div>
      {showContractForm && <form onSubmit={createContract} className="grid gap-3 border-t border-slate-800 pt-3 md:grid-cols-2"><label className="text-sm text-slate-300 md:col-span-2">Contract name<input required value={contractForm.contract_name} onChange={e => setContractForm({ ...contractForm, contract_name: e.target.value })} placeholder="Company monthly transport" className={input} /></label><label className="text-sm text-slate-300">Billing cycle<select value={contractForm.billing_cycle} onChange={e => setContractForm({ ...contractForm, billing_cycle: e.target.value })} className={input}><option value="monthly">Monthly</option><option value="prepaid">Prepaid</option></select></label><label className="text-sm text-slate-300">Currency<input maxLength={3} value={contractForm.currency} onChange={e => setContractForm({ ...contractForm, currency: e.target.value })} className={input} /></label><label className="text-sm text-slate-300">Monthly limit<input type="number" min="0" value={contractForm.monthly_limit} onChange={e => setContractForm({ ...contractForm, monthly_limit: e.target.value })} placeholder="Optional" className={input} /></label><label className="text-sm text-slate-300">Credit limit<input type="number" min="0" value={contractForm.credit_limit} onChange={e => setContractForm({ ...contractForm, credit_limit: e.target.value })} placeholder="Optional" className={input} /></label><label className="text-sm text-slate-300">Starts on<input type="date" required value={contractForm.starts_on} onChange={e => setContractForm({ ...contractForm, starts_on: e.target.value })} className={input} /></label><label className="text-sm text-slate-300">Ends on<input type="date" value={contractForm.ends_on} onChange={e => setContractForm({ ...contractForm, ends_on: e.target.value })} className={input} /></label><button disabled={saving} className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50 md:col-span-2">{saving ? <Loader size={15} className="animate-spin" /> : <Check size={15} />} Activate contract</button></form>}
      {loading ? <div className="flex gap-2 text-sm text-slate-500"><Loader size={15} className="animate-spin" />Loading contracts…</div> : contracts.length === 0 ? <p className="text-sm text-slate-500">No transport contracts yet. Create one to begin.</p> : <div className="grid gap-2 md:grid-cols-2">{contracts.map(contract => <button type="button" key={contract.id} disabled={contract.status !== 'active'} onClick={() => setRequestForm({ ...requestForm, contract_id: contract.id })} className={`rounded-lg border p-3 text-left ${requestForm.contract_id === contract.id ? 'border-orange-500 bg-orange-500/10' : 'border-slate-800 bg-slate-900/60'} disabled:cursor-not-allowed disabled:opacity-60`}><div className="flex justify-between gap-2"><span className="font-medium text-white">{contract.contract_name}</span><span className="text-xs capitalize text-slate-400">{contract.status}</span></div><p className="mt-1 text-xs text-slate-500">{contract.billing_cycle} · {contract.monthly_limit ? money(contract.monthly_limit, contract.currency) : 'No monthly cap'}</p></button>)}</div>}
    </section>

    <form onSubmit={submitRequest} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-4 md:grid-cols-2"><div className="md:col-span-2"><h3 className="font-semibold text-white">Request a ride or route</h3><p className="text-xs text-slate-500">The request remains pending until BodaGo assigns a rider.</p></div><label className="text-sm text-slate-300 md:col-span-2">Active contract<select required value={requestForm.contract_id} onChange={e => setRequestForm({ ...requestForm, contract_id: e.target.value })} className={input}><option value="">Select active contract</option>{activeContracts.map(contract => <option key={contract.id} value={contract.id}>{contract.contract_name} — {contract.billing_cycle}</option>)}</select></label><label className="text-sm text-slate-300">Vehicle<select value={requestForm.vehicle_type} onChange={e => setRequestForm({ ...requestForm, vehicle_type: e.target.value })} className={input}><option value="bicycle">Bicycle</option><option value="motorcycle">Motorcycle</option><option value="tuktuk">Tuk-tuk</option><option value="car">Car</option><option value="van">Van</option><option value="truck">Truck</option></select></label><label className="text-sm text-slate-300">Number of rides<input type="number" min="1" required value={requestForm.ride_count} onChange={e => setRequestForm({ ...requestForm, ride_count: e.target.value })} className={input} /></label><label className="text-sm text-slate-300">Pickup<input required value={requestForm.pickup} onChange={e => setRequestForm({ ...requestForm, pickup: e.target.value })} className={input} /></label><label className="text-sm text-slate-300">Drop-off<input required value={requestForm.dropoff} onChange={e => setRequestForm({ ...requestForm, dropoff: e.target.value })} className={input} /></label><label className="text-sm text-slate-300">Schedule<input type="datetime-local" value={requestForm.scheduled_at} onChange={e => setRequestForm({ ...requestForm, scheduled_at: e.target.value })} className={input} /></label><label className="text-sm text-slate-300">Recurrence<select value={requestForm.recurrence} onChange={e => setRequestForm({ ...requestForm, recurrence: e.target.value })} className={input}><option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><button disabled={saving || activeContracts.length === 0} className="flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white disabled:opacity-50 md:col-span-2">{saving ? <Loader size={16} className="animate-spin" /> : <Check size={16} />} Request BodaGo transport</button></form>

    <section className="space-y-3"><h3 className="font-semibold text-white">Recent transport requests</h3>{requests.length === 0 ? <p className="text-sm text-slate-500">No requests submitted yet.</p> : <div className="space-y-2">{requests.map(request => <div key={request.id} className="flex flex-col gap-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="font-medium text-white">{contractName(request.contract_id)}</span><span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs capitalize text-slate-300">{request.status}</span></div><p className="text-xs text-slate-400">{request.ride_count} ride{request.ride_count === 1 ? '' : 's'} · {request.requested_vehicle_type || 'Any'} · {request.pickup_location} → {request.dropoff_location}</p><p className="text-xs text-slate-600">{request.scheduled_for ? new Date(request.scheduled_for).toLocaleString() : 'As soon as dispatched'}{request.estimated_total > 0 ? ` · Estimate ${money(request.estimated_total)}` : ''}</p></div>{request.status === 'pending' && <button type="button" onClick={() => cancelRequest(request.id)} disabled={cancelling === request.id} className="flex items-center justify-center gap-1 rounded-lg border border-red-800/60 px-3 py-2 text-xs text-red-300"><X size={13} /> Cancel</button>}</div>)}</div>}</section>
  </div>;
}
