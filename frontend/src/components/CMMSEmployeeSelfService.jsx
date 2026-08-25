import React, { useEffect, useState } from 'react';
import { Bus, CalendarDays, DollarSign, Loader } from 'lucide-react';
import { supabase } from '../lib/supabase/client';

const money = (value, currency = 'UGX') => `${currency} ${Number(value || 0).toLocaleString()}`;

// This screen intentionally makes employee-level requests only. It is used
// for roles whose tool scope is "own" and must never receive company payroll
// or transport records through component props.
export default function CMMSEmployeeSelfService({ companyProfile, mode }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [compensation, setCompensation] = useState(null);
  const [entries, setEntries] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [rides, setRides] = useState([]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true); setError('');
      const { data: authData, error: authError } = await supabase.auth.getUser();
      const employeeId = authData?.user?.id;
      if (authError || !employeeId || !companyProfile?.id) {
        if (!cancelled) { setError('Sign in to view your employee records.'); setLoading(false); }
        return;
      }

      if (mode === 'payroll') {
        // Email is the stable membership key across the older CMMS schemas
        // (some use ican_user_id, others use auth_user_id).
        const { data: cmmsUser } = await supabase.from('cmms_users')
          .select('id').eq('cmms_company_id', companyProfile.id)
          .ilike('email', authData.user.email || '').maybeSingle();
        const [compensationResult, entriesResult, attendanceResult] = await Promise.all([
          supabase.from('business_compensation_profiles').select('base_salary,currency,pay_frequency,payroll_status,effective_from')
            .eq('business_profile_id', companyProfile.pichin_business_profile_id).eq('employee_user_id', employeeId)
            .order('effective_from', { ascending: false }).limit(1),
          supabase.from('business_payroll_entries').select('id,base_amount,net_amount,status,metadata,created_at')
            .eq('business_profile_id', companyProfile.pichin_business_profile_id).eq('employee_user_id', employeeId)
            .order('created_at', { ascending: false }).limit(12),
          cmmsUser?.id
            ? supabase.from('cmms_staff_attendance').select('check_in_time,check_out_time,status,late_minutes,early_departure_minutes')
              .eq('cmms_company_id', companyProfile.id).eq('cmms_user_id', cmmsUser.id)
              .order('check_in_time', { ascending: false }).limit(31)
            : Promise.resolve({ data: [], error: null })
        ]);
        if (!cancelled) {
          setCompensation(compensationResult.data?.[0] || null);
          setEntries(entriesResult.data || []);
          setAttendance(attendanceResult.data || []);
          setError(compensationResult.error?.message || entriesResult.error?.message || attendanceResult.error?.message || '');
        }
      } else {
        const { data, error: ridesError } = await supabase.from('mbg_corporate_ride_requests')
          .select('id,ride_count,requested_vehicle_type,recurrence,pickup_location,dropoff_location,scheduled_for,status,estimated_total,created_at')
          .eq('business_profile_id', companyProfile.pichin_business_profile_id).eq('requested_by', employeeId)
          .order('created_at', { ascending: false }).limit(30);
        if (!cancelled) { setRides(data || []); setError(ridesError?.message || ''); }
      }
      if (!cancelled) setLoading(false);
    };
    load();
    return () => { cancelled = true; };
  }, [companyProfile?.id, companyProfile?.pichin_business_profile_id, mode]);

  if (loading) return <div className="flex items-center gap-2 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 text-sm text-slate-300"><Loader className="h-4 w-4 animate-spin" /> Loading your records…</div>;
  if (error) return <div className="rounded-2xl border border-red-700/40 bg-red-900/15 p-6 text-sm text-red-200">{error}</div>;

  if (mode === 'transport') return <div className="space-y-4 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6"><div className="flex items-center gap-3"><Bus className="h-6 w-6 text-orange-400" /><div><h2 className="text-xl font-bold text-white">My transport records</h2><p className="text-sm text-slate-400">Only transport requests made by your account are shown.</p></div></div>{rides.length === 0 ? <p className="text-sm text-slate-400">No personal transport records yet.</p> : <div className="space-y-2">{rides.map(ride => <div key={ride.id} className="rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm"><div className="flex justify-between gap-3"><span className="font-semibold text-white capitalize">{ride.status}</span><span className="text-slate-400">{new Date(ride.created_at).toLocaleDateString()}</span></div><p className="mt-1 text-slate-300">{ride.pickup_location} → {ride.dropoff_location}</p><p className="mt-1 text-xs text-slate-500">{ride.ride_count} ride(s) · {ride.requested_vehicle_type || 'Any vehicle'}{ride.estimated_total ? ` · ${money(ride.estimated_total)}` : ''}</p></div>)}</div>}</div>;

  return <div className="space-y-4 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6"><div className="flex items-center gap-3"><DollarSign className="h-6 w-6 text-emerald-400" /><div><h2 className="text-xl font-bold text-white">My salary and attendance</h2><p className="text-sm text-slate-400">Only your salary, payroll entries, and attendance are shown.</p></div></div>{compensation && <div className="rounded-xl border border-emerald-800/40 bg-emerald-950/20 p-4"><p className="text-xs uppercase text-emerald-300">Current salary</p><p className="mt-1 text-2xl font-bold text-white">{money(compensation.base_salary, compensation.currency)}</p><p className="text-xs text-slate-400 capitalize">{compensation.pay_frequency || 'monthly'} · {compensation.payroll_status || 'on pay'}</p></div>}<section><h3 className="mb-2 flex items-center gap-2 font-semibold text-white"><CalendarDays className="h-4 w-4" /> My attendance</h3><p className="text-sm text-slate-400">{attendance.length} recent check-in record(s).</p></section><section><h3 className="mb-2 font-semibold text-white">My payroll entries</h3>{entries.length === 0 ? <p className="text-sm text-slate-400">No payroll entries yet.</p> : <div className="space-y-2">{entries.map(entry => <div key={entry.id} className="flex justify-between rounded-lg border border-slate-800 bg-slate-950/50 p-3 text-sm"><span className="capitalize text-slate-300">{entry.status || 'draft'}</span><span className="font-semibold text-emerald-300">{money(entry.net_amount ?? entry.base_amount, entry.metadata?.currency)}</span></div>)}</div>}</section></div>;
}
