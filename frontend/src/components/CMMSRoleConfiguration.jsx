import React, { useEffect, useMemo, useState } from 'react';
import { Check, Edit2, Plus, Save, Trash2, X } from 'lucide-react';
import { supabase } from '../lib/supabase/client';

export const CMMS_TOOL_OPTIONS = [
  { id: 'company', label: 'Company configuration', permission: 'canViewCompany' },
  { id: 'departments', label: 'Departments', permission: 'canManageDepartments' },
  { id: 'users', label: 'Users and role assignments', permission: 'canManageUsers' },
  { id: 'inventory', label: 'Inventory', permission: 'canViewInventory' },
  { id: 'payroll', label: 'Payroll', permission: 'canViewFinancials' },
  { id: 'transport', label: 'Transport', permission: 'canManageTransport' },
  { id: 'requisitions', label: 'Requisitions', permission: 'canViewRequisitions' },
  { id: 'approvals', label: 'Approvals', permission: 'canApproveRequisitions' },
  { id: 'reports', label: 'Reports', permission: 'canViewReports' },
  { id: 'tasks', label: 'Tasks and work orders', permission: 'canCreateWorkOrders' }
];

const emptyRole = { display_name: '', description: '', permission_level: 1, tool_access: {} };

const makeKey = (name) => `custom_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}_${Date.now()}`;

const CMMSRoleConfiguration = ({ companyId, isAdmin, onRolesChanged }) => {
  const [roles, setRoles] = useState([]);
  const [draft, setDraft] = useState(emptyRole);
  const [editingId, setEditingId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const loadRoles = async () => {
    if (!companyId) return;
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('cmms_roles')
      .select('*')
      .or(`cmms_company_id.eq.${companyId},cmms_company_id.is.null`)
      .eq('is_active', true)
      .order('permission_level', { ascending: false })
      .order('display_name', { ascending: true });
    if (loadError) setError(loadError.message);
    setRoles(data || []);
    setLoading(false);
    onRolesChanged?.(data || []);
  };

  useEffect(() => { loadRoles(); }, [companyId]);

  const selectedTools = useMemo(() => draft.tool_access || {}, [draft.tool_access]);
  const reset = () => { setDraft(emptyRole); setEditingId(null); setError(''); };

  const toggleTool = (tool) => {
    setDraft((current) => ({
      ...current,
      tool_access: { ...(current.tool_access || {}), [tool.id]: !selectedTools[tool.id] }
    }));
  };

  const saveRole = async (event) => {
    event.preventDefault();
    if (!draft.display_name.trim() || !companyId) return;
    setSaving(true); setError('');
    const payload = {
      cmms_company_id: companyId,
      display_name: draft.display_name.trim(),
      role_name: editingId ? draft.role_name : makeKey(draft.display_name),
      description: draft.description?.trim() || null,
      permission_level: Number(draft.permission_level) || 1,
      tool_access: selectedTools,
      is_system_role: false,
      is_active: true,
      updated_at: new Date().toISOString()
    };
    const query = editingId
      ? supabase.from('cmms_roles').update(payload).eq('id', editingId).eq('cmms_company_id', companyId)
      : supabase.from('cmms_roles').insert(payload);
    const { error: saveError } = await query;
    if (saveError) setError(saveError.message);
    else { reset(); await loadRoles(); }
    setSaving(false);
  };

  const deleteRole = async (role) => {
    if (role.is_system_role || !window.confirm(`Deactivate the ${role.display_name} role?`)) return;
    const { error: deleteError } = await supabase.from('cmms_roles').update({ is_active: false }).eq('id', role.id).eq('cmms_company_id', companyId);
    if (deleteError) setError(deleteError.message); else await loadRoles();
  };

  if (!isAdmin) return <div className="glass-card p-6 text-orange-200">Only the company administrator can configure CMMS roles and tools.</div>;

  return (
    <div className="space-y-6">
      <div className="glass-card p-5 border border-purple-400/30">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <div><h2 className="text-xl font-bold text-white">Role and tool configuration</h2><p className="text-sm text-gray-400">Create any role your company needs and choose exactly which CMMS tools it can access.</p></div>
          {editingId && <button type="button" onClick={reset} className="text-gray-300 hover:text-white"><X className="w-5 h-5" /></button>}
        </div>
        <form onSubmit={saveRole} className="space-y-4 mt-5">
          <div className="grid md:grid-cols-2 gap-3">
            <input required value={draft.display_name || ''} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} placeholder="Role name (for example: Fleet Planner)" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
            <input type="number" min="1" max="10" value={draft.permission_level || 1} onChange={(e) => setDraft({ ...draft, permission_level: e.target.value })} placeholder="Permission level" className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
          </div>
          <textarea value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Describe what this role is responsible for" rows={2} className="w-full px-3 py-2 rounded bg-white/10 text-white border border-white/20" />
          <div><p className="text-white font-semibold mb-2">Tools this role may access</p><div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {CMMS_TOOL_OPTIONS.map((tool) => <button type="button" key={tool.id} onClick={() => toggleTool(tool)} className={`text-left px-3 py-2 rounded border ${selectedTools[tool.id] ? 'bg-green-500/20 border-green-400 text-green-200' : 'bg-white/5 border-white/10 text-gray-400'}`}><Check className={`inline w-4 h-4 mr-2 ${selectedTools[tool.id] ? 'opacity-100' : 'opacity-20'}`} />{tool.label}</button>)}
          </div></div>
          {error && <p className="text-red-300 text-sm">{error}</p>}
          <button disabled={saving} className="px-4 py-2 rounded bg-purple-600 hover:bg-purple-500 text-white font-semibold flex items-center gap-2"><Save className="w-4 h-4" />{saving ? 'Saving…' : editingId ? 'Update role' : 'Create role'}</button>
        </form>
      </div>
      <div className="glass-card p-5"><h3 className="text-lg font-bold text-white mb-4">Company roles ({roles.length})</h3>{loading ? <p className="text-gray-400">Loading roles…</p> : <div className="space-y-2">{roles.map((role) => <div key={role.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded bg-white/5 border border-white/10"><div><p className="text-white font-semibold">{role.display_name || role.role_name}</p><p className="text-xs text-gray-400">{role.description || 'No description'} · {Object.values(role.tool_access || {}).filter(Boolean).length} tools</p></div><div className="flex gap-2">{!role.is_system_role && role.cmms_company_id === companyId && <><button onClick={() => { setDraft({ ...role, tool_access: role.tool_access || {} }); setEditingId(role.id); }} className="p-2 text-blue-300 hover:text-white" title="Edit role"><Edit2 className="w-4 h-4" /></button><button onClick={() => deleteRole(role)} className="p-2 text-red-300 hover:text-white" title="Deactivate role"><Trash2 className="w-4 h-4" /></button></>}</div></div>)}</div>}</div>
      <div className="text-xs text-gray-400 flex items-center gap-2"><Plus className="w-4 h-4" />Roles are company-specific. Existing fixed roles can be deactivated and replaced with your company’s own names and tool combinations.</div>
    </div>
  );
};

export default CMMSRoleConfiguration;
