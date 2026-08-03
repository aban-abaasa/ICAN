import React, { useEffect, useMemo, useState } from 'react';
import { Check, DollarSign, Loader, ShieldCheck } from 'lucide-react';
import { getBusinessAccessMembers, getBusinessCompensation, resolveEmployeeAuthIds, saveBusinessCompensation } from '../services/businessManagementService';

export default function CMMSPayrollPanel({ companyProfile, users = [], userRole, isCreator, currentUser }) {
  const businessProfileId = companyProfile?.pichin_business_profile_id;
  const simpleMode = (companyProfile?.business_mode || 'sole_proprietor') === 'sole_proprietor';
  const [assignedMembers, setAssignedMembers] = useState([]);
  const [resolvedUsers, setResolvedUsers] = useState([]);
  const employeeSource = useMemo(() => [...users, ...resolvedUsers], [users, resolvedUsers]);
  const employees = useMemo(() => {
    const byId = new Map();
    employeeSource.filter(user => user.authUserId).forEach(user => byId.set(user.authUserId, user));
    const adminId = currentUser?.id || currentUser?.user?.id || currentUser?.user_id;
    if (adminId && (isCreator || userRole === 'admin') && !byId.has(adminId)) {
      byId.set(adminId, {
        authUserId: adminId,
        name: currentUser.full_name || currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Company administrator',
        email: currentUser.email || '',
        role: 'admin',
        isCreator: Boolean(isCreator)
      });
    }
    assignedMembers.filter(member => member.auth_user_id && ['invited', 'active'].includes(member.employment_status || 'active')).forEach(member => {
      const id = member.auth_user_id;
      byId.set(id, {
        authUserId: id,
        name: member.user?.full_name || member.job_title || 'Assigned employee',
        email: member.user?.email || '',
        role: member.role || member.job_title || 'Employee',
        department: member.department,
        jobTitle: member.job_title
      });
    });
    return [...byId.values()];
  }, [assignedMembers, employeeSource, currentUser, userRole, isCreator]);
  const [records, setRecords] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [form, setForm] = useState({ pay_type: 'monthly', base_salary: '', currency: 'UGX', overtime_rate: '', payroll_status: 'on_pay' });
  const [loading, setLoading] = useState(Boolean(businessProfileId));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const load = async () => {
    if (!businessProfileId) return;
    setLoading(true);
    const [result, memberResult, resolvedResult] = await Promise.all([
      getBusinessCompensation(businessProfileId),
      getBusinessAccessMembers(businessProfileId),
      resolveEmployeeAuthIds(users)
    ]);
    setRecords(result.data || []);
    setAssignedMembers(memberResult.data || []);
    setResolvedUsers(resolvedResult || []);
    setError(result.error?.message || memberResult.error?.message || '');
    setLoading(false);
  };

  useEffect(() => { load(); }, [businessProfileId, users]);

  const save = async event => {
    event.preventDefault();
    if (!businessProfileId) return;
    if (!employeeId) {
      setError('Select a CMMS employee.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    const result = await saveBusinessCompensation(businessProfileId, employeeId, form);
    if (!result.success) setError(result.error);
    else {
      setMessage('Salary saved to the shared business payroll.');
      setForm({ pay_type: 'monthly', base_salary: '', currency: 'UGX', overtime_rate: '', payroll_status: 'on_pay' });
      await load();
    }
    setSaving(false);
  };

  const selectEmployee = event => {
    const id = event.target.value;
    setEmployeeId(id);
    const current = records.find(record => record.employee_user_id === id);
    if (current) {
      setForm({
        pay_type: current.pay_type || 'monthly',
        base_salary: current.base_salary ?? '',
        currency: current.currency || 'UGX',
        overtime_rate: current.overtime_rate ?? '',
        payroll_status: current.payroll_status || 'on_pay'
      });
    }
  };

  if (!businessProfileId) {
    return <div className="rounded-2xl border border-amber-700/40 bg-amber-900/15 p-6 text-sm text-amber-200">Link this CMMS company to its Pichin business profile before using payroll.</div>;
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-700/60 bg-slate-900/70 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3"><DollarSign className="h-6 w-6 text-emerald-400" /><div><h2 className="text-xl font-bold text-white">CMMS Payroll</h2><p className="text-sm text-slate-400">Employee compensation for {companyProfile.company_name}</p></div></div>
        <span className="flex items-center gap-1 rounded-full border border-emerald-700/40 bg-emerald-900/20 px-2 py-1 text-xs text-emerald-300"><ShieldCheck size={13} /> {simpleMode ? 'Sole proprietor mode' : `${companyProfile.business_mode || 'Organisation'} mode`}</span>
      </div>
      <p className="text-sm text-slate-400">{simpleMode ? 'Simple payroll: assign a salary or rate to an employee and keep the record in the shared Pichin business account.' : `Role-controlled payroll. Current access: ${userRole || 'member'}${isCreator ? ' (creator)' : ''}. Approval and payroll-period workflows can be added by authorised finance administrators.`}</p>

      {loading ? <div className="flex items-center gap-2 text-sm text-slate-400"><Loader size={16} className="animate-spin" /> Loading payroll...</div> : <>
        {error && <p className="rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300">{error}</p>}
        {message && <p className="rounded-lg border border-emerald-800/50 bg-emerald-900/20 p-2 text-sm text-emerald-300">{message}</p>}
        <form onSubmit={save} className="grid gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 md:grid-cols-2">
          <label className="text-sm text-slate-300 md:col-span-2">Employee<select required value={employeeId} onChange={selectEmployee} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"><option value="">Select employee</option>{employees.map(employee => <option key={employee.authUserId} value={employee.authUserId}>{employee.name} — {employee.role || employee.jobTitle || employee.department || 'Employee'}{employee.email ? ` — ${employee.email}` : ''}</option>)}</select>{employees.length === 0 && <span className="mt-1 block text-xs text-amber-300">Add an active employee in CMMS Users before assigning payroll.</span>}</label>
          <label className="text-sm text-slate-300">Pay type<select value={form.pay_type} onChange={event => setForm(previous => ({ ...previous, pay_type: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"><option value="monthly">Monthly salary</option><option value="hourly">Hourly</option>{!simpleMode && <><option value="per_ride">Per ride</option><option value="hybrid">Hybrid</option></>}</select></label>
          <label className="text-sm text-slate-300">Payroll status<select value={form.payroll_status} onChange={event => setForm(previous => ({ ...previous, payroll_status: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"><option value="on_pay">On pay</option><option value="on_hold">On hold</option><option value="ended">Ended</option></select></label>
          <label className="text-sm text-slate-300">Currency<input value={form.currency} onChange={event => setForm(previous => ({ ...previous, currency: event.target.value.toUpperCase() }))} maxLength={6} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>
          <label className="text-sm text-slate-300">Base amount<input required type="number" min="0.01" step="0.01" value={form.base_salary} onChange={event => setForm(previous => ({ ...previous, base_salary: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>
          <label className="text-sm text-slate-300">Overtime/rate<input type="number" min="0" step="0.01" value={form.overtime_rate} onChange={event => setForm(previous => ({ ...previous, overtime_rate: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>
          <button disabled={saving || employees.length === 0} className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 md:col-span-2">{saving ? <Loader size={16} className="animate-spin" /> : <Check size={16} />} Save salary</button>
        </form>
        <div><h3 className="mb-2 text-xs font-semibold text-slate-500">CURRENT COMPENSATION</h3>{records.length === 0 ? <p className="text-sm text-slate-500">No compensation records yet.</p> : <div className="space-y-2">{records.map(record => { const employee = employees.find(candidate => candidate.authUserId === record.employee_user_id); return <div key={record.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-950/60 px-3 py-2 text-sm"><span className="text-slate-300">{employee?.name || record.employee_user_id}<span className="ml-2 text-xs text-slate-500">{employee?.role || employee?.jobTitle || employee?.department || 'Employee'}</span></span><span className={record.payroll_status === 'on_pay' ? 'text-emerald-300' : 'text-amber-300'}>{record.currency} {Number(record.base_salary).toLocaleString()} / {record.pay_type} · {record.payroll_status === 'on_pay' ? 'On pay' : record.payroll_status === 'on_hold' ? 'On hold' : 'Ended'}</span></div>; })}</div>}</div>
      </>}
    </div>
  );
}
