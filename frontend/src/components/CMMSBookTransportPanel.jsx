import React, { useEffect, useState } from 'react';
import { Car, Check, Loader } from 'lucide-react';
import { supabase } from '../lib/supabase/client';

export default function CMMSBookTransportPanel({ companyProfile }) {
  const businessProfileId = companyProfile?.pichin_business_profile_id;
  const [contracts, setContracts] = useState([]);
  const [form, setForm] = useState({ contract_id: '', vehicle_type: 'car', ride_count: 1, pickup: '', dropoff: '', scheduled_at: '', recurrence: 'once' });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!businessProfileId) return;
    supabase.from('mbg_corporate_transport_contracts')
      .select('id, contract_name, billing_cycle, currency, status')
      .eq('business_profile_id', businessProfileId)
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .then(({ data, error: contractError }) => {
        if (contractError) {
          const missingTable = contractError.code === '42P01' || /does not exist/i.test(contractError.message || '');
          setError(missingTable
            ? 'BodaGo corporate transport is not installed in this Supabase project. Run mybodaguy/backend/database/SHARED_CORPORATE_TRANSPORT_AND_MONTHLY_RIDERS.sql first.'
            : contractError.message);
        }
        setContracts(data || []);
        if (data?.[0]) setForm(previous => ({ ...previous, contract_id: data[0].id }));
      });
  }, [businessProfileId]);

  const submit = async event => {
    event.preventDefault();
    if (!businessProfileId || !form.contract_id) {
      setError('Link this CMMS company to a Pichin business profile before booking transport.');
      return;
    }
    setSaving(true);
    setMessage('');
    setError('');
    const { data: authData } = await supabase.auth.getUser();
    const { error: insertError } = await supabase.from('mbg_corporate_ride_requests').insert({
      contract_id: form.contract_id,
      business_profile_id: businessProfileId,
      requested_by: authData?.user?.id,
      ride_count: Number(form.ride_count) || 1,
      recurrence: form.recurrence,
      pickup_location: form.pickup,
      dropoff_location: form.dropoff,
      scheduled_for: form.scheduled_at || null,
      requested_vehicle_type: form.vehicle_type,
      status: 'pending'
    });
    if (insertError) setError(insertError.message);
    else {
      setMessage('Transport request submitted to BodaGo.');
      setForm(previous => ({ ...previous, ride_count: 1, pickup: '', dropoff: '', scheduled_at: '' }));
    }
    setSaving(false);
  };

  return (
    <div className="max-w-2xl space-y-5 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6">
      <div className="flex items-center gap-3"><Car className="h-6 w-6 text-orange-400" /><div><h2 className="text-xl font-bold text-white">Book Transport</h2><p className="text-sm text-slate-400">CMMS manages company assets and employees; BodaGo manages contracts, riders, and rides.</p></div></div>
      {error && <p className="rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300">{error}</p>}
      {message && <p className="rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-2 text-sm text-emerald-300">{message}</p>}
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-2">
        <label className="text-sm text-slate-300 md:col-span-2">Transport contract<select required value={form.contract_id} onChange={event => setForm({ ...form, contract_id: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="">Select active contract</option>{contracts.map(contract => <option key={contract.id} value={contract.id}>{contract.contract_name} — {contract.billing_cycle}</option>)}</select></label>
        <label className="text-sm text-slate-300">Vehicle type<select value={form.vehicle_type} onChange={event => setForm({ ...form, vehicle_type: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="bike">Bike</option><option value="car">Car</option><option value="van">Van</option><option value="truck">Truck</option></select></label>
        <label className="text-sm text-slate-300">Number of rides<input type="number" min="1" value={form.ride_count} onChange={event => setForm({ ...form, ride_count: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
        <label className="text-sm text-slate-300">Pickup location<input required value={form.pickup} onChange={event => setForm({ ...form, pickup: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
        <label className="text-sm text-slate-300">Drop-off location<input required value={form.dropoff} onChange={event => setForm({ ...form, dropoff: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
        <label className="text-sm text-slate-300">Schedule<input type="datetime-local" value={form.scheduled_at} onChange={event => setForm({ ...form, scheduled_at: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white" /></label>
        <label className="text-sm text-slate-300">Recurrence<select value={form.recurrence} onChange={event => setForm({ ...form, recurrence: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white"><option value="once">Once</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
        <button disabled={saving} className="flex items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-500 disabled:opacity-50 md:col-span-2">{saving ? <Loader size={16} className="animate-spin" /> : <Check size={16} />} Request BodaGo transport</button>
      </form>
    </div>
  );
}
