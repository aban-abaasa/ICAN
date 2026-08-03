import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, Check, Loader, Search, Trash2, UserPlus, X } from 'lucide-react';
import { searchICANUsers } from '../services/pitchingService';
import {
  getBusinessAccessMembers,
  grantBusinessAccess,
  revokeBusinessAccess,
  getBusinessCompensation,
  saveBusinessCompensation
} from '../services/businessManagementService';

const defaultPermissions = {
  manage_business: true,
  manage_payroll: true,
  manage_assets: false,
  manage_inventory: false
};

export default function BusinessAdministrationModal({ profile, onClose }) {
  const [tab, setTab] = useState('access');
  const [members, setMembers] = useState([]);
  const [compensation, setCompensation] = useState([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [permissions, setPermissions] = useState(defaultPermissions);
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [salary, setSalary] = useState({ pay_type: 'monthly', base_salary: '', currency: 'UGX', overtime_rate: '', notes: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    const [accessResult, compensationResult] = await Promise.all([
      getBusinessAccessMembers(profile.id),
      getBusinessCompensation(profile.id)
    ]);
    setMembers(accessResult.data || []);
    setCompensation(compensationResult.data || []);
    setError(accessResult.error?.message || compensationResult.error?.message || '');
    setLoading(false);
  };

  useEffect(() => { load(); }, [profile.id]);

  const employeeOptions = useMemo(() => members.filter(member => member.employment_status === 'active'), [members]);

  const handleSearch = async (value) => {
    setQuery(value);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    const found = await searchICANUsers(value.trim());
    setResults(found.filter(user => !members.some(member => member.auth_user_id === user.id)));
  };

  const addAccess = async (user) => {
    setSaving(true);
    setError('');
    const result = await grantBusinessAccess(profile.id, user, permissions);
    if (!result.success) setError(result.error);
    else {
      setQuery('');
      setResults([]);
      await load();
    }
    setSaving(false);
  };

  const removeAccess = async (member) => {
    if (!window.confirm(`Suspend business access for ${member.user?.full_name || member.user?.email}?`)) return;
    const result = await revokeBusinessAccess(member.id);
    if (!result.success) setError(result.error);
    else setMembers(previous => previous.filter(item => item.id !== member.id));
  };

  const saveSalary = async (event) => {
    event.preventDefault();
    if (!selectedEmployee) {
      setError('Select an employee first.');
      return;
    }
    setSaving(true);
    setError('');
    const result = await saveBusinessCompensation(profile.id, selectedEmployee, salary);
    if (!result.success) setError(result.error);
    else {
      setSalary({ pay_type: 'monthly', base_salary: '', currency: 'UGX', overtime_rate: '', notes: '' });
      await load();
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Briefcase className="h-5 w-5 text-amber-400" />
            <div>
              <h2 className="font-bold text-white">Business Administration</h2>
              <p className="text-xs text-slate-500">{profile.business_name}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={20} /></button>
        </div>

        <div className="mb-4 flex gap-2 border-b border-slate-800">
          <button onClick={() => setTab('access')} className={`px-3 py-2 text-sm ${tab === 'access' ? 'border-b-2 border-amber-400 text-amber-300' : 'text-slate-400'}`}>Admin access</button>
          <button onClick={() => setTab('salary')} className={`px-3 py-2 text-sm ${tab === 'salary' ? 'border-b-2 border-amber-400 text-amber-300' : 'text-slate-400'}`}>Salaries</button>
        </div>

        {error && <p className="mb-3 rounded-lg border border-red-800/50 bg-red-900/20 p-2 text-sm text-red-300">{error}</p>}
        {loading ? <div className="flex items-center gap-2 text-sm text-slate-400"><Loader className="animate-spin" size={16} /> Loading business management...</div> : (
          tab === 'access' ? (
            <div className="space-y-4">
              <p className="text-sm text-slate-400">Grant employees access to manage this business profile, payroll, assets, or inventory. This does not grant ownership.</p>
              <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                <div className="mb-3 flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
                  <Search size={16} className="text-slate-500" />
                  <input value={query} onChange={event => handleSearch(event.target.value)} placeholder="Search employee by name or email" className="flex-1 bg-transparent text-sm text-white outline-none" />
                </div>
                {results.length > 0 && <div className="mb-3 space-y-1">{results.map(user => <button key={user.id} onClick={() => addAccess(user)} disabled={saving} className="flex w-full items-center justify-between rounded-lg bg-slate-800 px-3 py-2 text-left hover:bg-slate-700"><span><span className="block text-sm text-white">{user.name}</span><span className="block text-xs text-slate-400">{user.email}</span></span><UserPlus size={16} className="text-emerald-400" /></button>)}</div>}
                <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 sm:grid-cols-4">
                  {Object.entries(permissions).map(([key, enabled]) => <label key={key} className="flex items-center gap-1.5"><input type="checkbox" checked={enabled} onChange={event => setPermissions(previous => ({ ...previous, [key]: event.target.checked }))} />{key.replace('manage_', '')}</label>)}
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-500">ACTIVE BUSINESS ACCESS</p>
                {members.filter(member => member.employment_status === 'active').length === 0 ? <p className="text-sm text-slate-500">No delegated administrators yet.</p> : members.filter(member => member.employment_status === 'active').map(member => <div key={member.id} className="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-2"><span><span className="block text-sm text-white">{member.user?.full_name || member.user?.email}</span><span className="block text-xs text-slate-500">{Object.keys(member.permissions || {}).filter(key => member.permissions[key]).join(', ') || 'No permissions'}</span></span><button onClick={() => removeAccess(member)} className="text-red-400 hover:text-red-300" title="Suspend access"><Trash2 size={16} /></button></div>)}
              </div>
            </div>
          ) : (
            <form onSubmit={saveSalary} className="space-y-4">
              <p className="text-sm text-slate-400">Set employee compensation for payroll. Salary records are separate from shareholder ownership.</p>
              <label className="block text-sm text-slate-300">Employee<select value={selectedEmployee} onChange={event => setSelectedEmployee(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"><option value="">Select an employee</option>{employeeOptions.map(member => <option key={member.auth_user_id} value={member.auth_user_id}>{member.user?.full_name || member.user?.email}</option>)}</select></label>
              <div className="grid grid-cols-2 gap-3">
                <label className="text-sm text-slate-300">Pay type<select value={salary.pay_type} onChange={event => setSalary(previous => ({ ...previous, pay_type: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white"><option value="monthly">Monthly salary</option><option value="hourly">Hourly</option><option value="per_ride">Per ride</option><option value="hybrid">Hybrid</option></select></label>
                <label className="text-sm text-slate-300">Currency<input value={salary.currency} onChange={event => setSalary(previous => ({ ...previous, currency: event.target.value.toUpperCase() }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" maxLength={6} /></label>
                <label className="text-sm text-slate-300">Base amount<input type="number" min="0" value={salary.base_salary} onChange={event => setSalary(previous => ({ ...previous, base_salary: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>
                <label className="text-sm text-slate-300">Overtime/rate<input type="number" min="0" value={salary.overtime_rate} onChange={event => setSalary(previous => ({ ...previous, overtime_rate: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-white" /></label>
              </div>
              <button disabled={saving} className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-50">{saving ? <Loader size={15} className="animate-spin" /> : <Check size={15} />} Save compensation</button>
              <div className="space-y-2 border-t border-slate-800 pt-4"><p className="text-xs font-semibold text-slate-500">CURRENT COMPENSATION</p>{compensation.length === 0 ? <p className="text-sm text-slate-500">No salary records yet.</p> : compensation.map(item => <div key={item.id} className="flex justify-between rounded-lg bg-slate-900/60 px-3 py-2 text-sm"><span className="text-slate-300">{employeeOptions.find(member => member.auth_user_id === item.employee_user_id)?.user?.full_name || item.employee_user_id}</span><span className="text-emerald-300">{item.currency} {Number(item.base_salary).toLocaleString()} / {item.pay_type}</span></div>)}</div>
            </form>
          )
        )}
      </div>
    </div>
  );
}
