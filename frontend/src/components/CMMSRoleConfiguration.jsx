import React, { useEffect, useMemo, useState } from 'react';
import { Briefcase, Check, Edit2, KeyRound, Plus, Save, ShieldCheck, Trash2, Users, X } from 'lucide-react';
import CmmsPageShell from './CmmsPageShell.jsx';
import CmmsFold from './CmmsFold.jsx';
import { supabase } from '../lib/supabase/client';

export const CMMS_TOOL_OPTIONS = [
  { id: 'company', label: 'Company configuration', permission: 'canViewCompany', actions: ['view', 'edit'] },
  { id: 'departments', label: 'Departments', permission: 'canManageDepartments', actions: ['view', 'create', 'edit', 'delete'] },
  { id: 'users', label: 'Users and role assignments', permission: 'canManageUsers', actions: ['view', 'create', 'edit', 'assign'] },
  { id: 'inventory', label: 'Inventory', permission: 'canViewInventory', actions: ['view', 'create', 'edit', 'approve'] },
  // Action keys are read directly by backend attendance RPCs via
  // cmms_attendance_has_action() — keep them in sync with
  // backend/CMMS_ATTENDANCE_ROLE_BASED_PERMISSIONS.sql if you rename them.
  // view: see every staff member's records, not just your own.
  // manual: manually check another staff member in or out.
  // days: credit (never reduce) a staff member's attendance day count.
  // print: export attendance records/summary to Excel or PDF.
  // welfare: decide staff leave/probation/HR requests in the "Leave &
  // Welfare" sub-tab -- deliberately its own checkbox (not reused from
  // manual/days) so an admin can hand out attendance duties without also
  // handing out HR approval power, or vice versa. See
  // cmms_can_manage_welfare() in backend/CMMS_EMPLOYEE_WELFARE_SYSTEM.sql.
  { id: 'attendance', label: 'Staff attendance & QR check-in', permission: 'canManageAttendance', actions: ['view', 'manual', 'days', 'print', 'welfare'] },
  // Leave & welfare: every employee can already REQUEST leave/welfare help;
  // this is who may decide those requests. Read server-side by
  // cmms_can_manage_welfare()/cmms_can_view_welfare() -- see
  // backend/CMMS_LEAVE_APPROVAL_ROLE_ACCESS.sql. Separate from the attendance
  // tool's "welfare" tick so approving leave doesn't also expose every staff
  // member's attendance records.
  // approve: decide leave, probation and welfare requests.
  // see_all: read-only view of the company-wide leave/welfare dashboard.
  { id: 'leave-welfare', label: 'Leave & welfare approvals', permission: 'canApproveLeave', actions: ['approve', 'see_all'], permissionOnly: true },
  // Items taken/returned (Staff Attendance -> "Items Taken/Returned" and the
  // employee Leave & Welfare screen). Read server-side by
  // _cmms_item_custody_can() in backend/CMMS_STAFF_ITEM_CUSTODY_LOG.sql --
  // keep the action keys in sync if you rename them.
  // request: ask for an item and sign it back in when returned.
  // see_all: see every staff member's item requests/records (otherwise only your own).
  // manage: approve/decline requests, record who took an item, receive returns
  //   for others -- implies request and see_all.
  // permissionOnly: a permission set, not a business module/tab, so it stays out
  // of the "Choose CMMS features" module switches.
  { id: 'item-custody', label: 'Item requests & custody (take/return)', permission: 'canRequestItems', actions: ['request', 'see_all', 'manage'], permissionOnly: true },
  { id: 'visitor-mgmt', label: 'Visitor management', permission: 'canManageVisitors', actions: ['view', 'create', 'edit', 'flag', 'approve'] },
  { id: 'payroll', label: 'Payroll', permission: 'canViewFinancials', actions: ['view', 'create', 'edit', 'approve'], scopes: true },
  { id: 'fees', label: 'School fees', permission: 'canManageFees', actions: ['view', 'create', 'edit', 'approve'], scopes: true },
  { id: 'production', label: 'Production and WIP', permission: 'canManageProduction', actions: ['view', 'create', 'edit', 'approve'], scopes: true },
  { id: 'quality', label: 'Quality control', permission: 'canManageQuality', actions: ['view', 'create', 'edit', 'approve'], scopes: true },
  { id: 'clinical', label: 'Clinical operations', permission: 'canManageClinical', actions: ['view', 'create', 'edit', 'approve'], scopes: true },
  { id: 'pharmacy', label: 'Pharmacy and supplies', permission: 'canManagePharmacy', actions: ['view', 'create', 'edit', 'approve'], scopes: true },
  { id: 'transport', label: 'Transport', permission: 'canManageTransport', actions: ['view', 'create', 'edit', 'approve', 'assign'], scopes: true },
  { id: 'requisitions', label: 'Requisitions and supplier orders', permission: 'canViewRequisitions', actions: ['view', 'create', 'edit', 'purchase', 'approve', 'assign'], scopes: true },
  { id: 'approvals', label: 'Approvals', permission: 'canApproveRequisitions', actions: ['view', 'approve', 'reject'], scopes: true },
  { id: 'reports', label: 'Reports', permission: 'canViewReports', actions: ['view', 'create', 'export'], scopes: true },
  // publish_contract is separate from assign so a role can hand out tasks
  // without also being trusted to publish a public, no-login contract link
  // (and its payment records) to an outside service provider -- same
  // reasoning as manage_applications below. See
  // backend/CMMS_SERVICE_PROVIDER_CONTRACTS.sql.
  { id: 'tasks', label: 'Tasks and work orders', permission: 'canCreateWorkOrders', actions: ['view', 'create', 'edit', 'assign', 'approve', 'complete', 'publish_contract'] },
  // Public posts (visibility: 'public') are readable with no login at
  // /notices/<companyId> once published -- see CMMS_ANNOUNCEMENTS_AND_JOBS.sql.
  // manage_applications is separate from edit/delete so a role can be
  // trusted to draft postings without also seeing applicant PII, or vice versa.
  { id: 'announcements', label: 'Announcements & job postings', permission: 'canManageAnnouncements', actions: ['view', 'create', 'edit', 'delete', 'manage_applications'] },
  // 'view' sees every bid placed on this company's own opportunities
  // (bids are otherwise private to the bidder); 'manage' posts/edits an
  // opportunity and picks a winning bid. See
  // backend/CMMS_BUSINESS_OPPORTUNITIES_AND_BIDS.sql.
  { id: 'opportunities', label: 'Business opportunities & bids', permission: 'canManageOpportunities', actions: ['view', 'manage'] }
];

const EMPLOYMENT_TYPES = [
  { id: 'full_time', label: 'Full-time' },
  { id: 'part_time', label: 'Part-time' },
  { id: 'contract', label: 'Contract' },
  { id: 'internship', label: 'Internship' },
  { id: 'temporary', label: 'Temporary' },
  { id: 'volunteer', label: 'Volunteer' },
];

const emptyRole = {
  display_name: '', description: '', permission_level: 1, tool_access: {},
  job_title: '', department: '', employment_type: '', positions_available: '',
  salary_range: '', job_description: '', responsibilities: '', required_skills: '',
};

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
      tool_access: {
        ...(current.tool_access || {}),
        [tool.id]: selectedTools[tool.id]
          ? false
          // Reporting is the basic employee voice: when an administrator
          // enables Reports for a role it can submit a report by default.
          // The administrator can still uncheck Create or Export afterwards.
          : tool.id === 'reports' ? { view: true, create: true } : { view: true }
      }
    }));
  };

  const toggleAction = (tool, action) => {
    setDraft((current) => {
      const currentAccess = current.tool_access?.[tool.id];
      const actions = currentAccess && typeof currentAccess === 'object' ? currentAccess : {};
      return {
        ...current,
        tool_access: {
          ...(current.tool_access || {}),
          [tool.id]: { ...actions, [action]: !actions[action], view: true }
        }
      };
    });
  };

  const hasAction = (tool, action) => {
    const access = selectedTools[tool.id];
    return Boolean(access && typeof access === 'object' && access[action]);
  };

  const getScope = (tool) => {
    const access = selectedTools[tool.id];
    return access && typeof access === 'object' ? access.scope || 'department' : 'department';
  };

  const setScope = (tool, scope) => {
    setDraft((current) => {
      const access = current.tool_access?.[tool.id];
      return {
        ...current,
        tool_access: {
          ...(current.tool_access || {}),
          [tool.id]: { ...(access && typeof access === 'object' ? access : { view: true }), scope }
        }
      };
    });
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
      // Position Details -- optional HR facts a job posting can auto-fill
      // from (see CMMSAnnouncementsPanel.jsx's "Fill from role"). All
      // nullable: a role can stay a pure permission bundle.
      job_title: draft.job_title?.trim() || null,
      department: draft.department?.trim() || null,
      employment_type: draft.employment_type || null,
      positions_available: draft.positions_available ? Number(draft.positions_available) : null,
      salary_range: draft.salary_range?.trim() || null,
      job_description: draft.job_description?.trim() || null,
      responsibilities: draft.responsibilities?.trim() || null,
      required_skills: draft.required_skills?.trim() || null,
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

  if (!isAdmin) return <div className="cmms-classic-callout p-4 text-sm text-orange-300">Only the company administrator can configure CMMS roles and tools.</div>;

  const customRoles = roles.filter((r) => !r.is_system_role && r.cmms_company_id === companyId);
  return (
    <CmmsPageShell
      title="Roles & tools"
      subtitle="Who can open what"
      icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}
      chips={[`${roles.length} role${roles.length === 1 ? '' : 's'}`, `${customRoles.length} custom`, `${CMMS_TOOL_OPTIONS.length} tools`]}
      info="Create any role your company needs and choose exactly which CMMS tools it can access. Roles are company-specific; fixed roles can be deactivated and replaced with your own names and tool combinations."
    >
      <CmmsFold
        title="Company roles"
        icon={<Users className="h-4 w-4" aria-hidden="true" />}
        accent="navy"
        hint={`${roles.length} role${roles.length === 1 ? '' : 's'}`}
        defaultOpen
      >
        <>{loading ? <p className="cmms-classic-muted">Loading roles…</p> : <div>{roles.map((role) => <div key={role.id} className="flex flex-wrap items-center justify-between gap-3 py-3 border-b last:border-b-0" style={{ borderColor: 'var(--color-border)' }}><div className="min-w-0 flex-1"><p className="cmms-classic-heading text-sm break-words">{role.display_name || role.role_name}</p><p className="text-xs cmms-classic-muted break-words">{role.description || 'No description'} · {Object.values(role.tool_access || {}).filter(Boolean).length} tools</p></div><div className="flex gap-1 shrink-0">{!role.is_system_role && role.cmms_company_id === companyId && <><button onClick={() => { setDraft({ ...role, tool_access: role.tool_access || {} }); setEditingId(role.id); }} className="p-2.5 text-blue-300 active:text-white active:bg-white/10 rounded-lg" title="Edit role"><Edit2 className="w-5 h-5" /></button><button onClick={() => deleteRole(role)} className="p-2.5 text-red-300 active:text-white active:bg-white/10 rounded-lg" title="Deactivate role"><Trash2 className="w-5 h-5" /></button></>}</div></div>)}</div>}</>
      </CmmsFold>

      <CmmsFold
        key={editingId || 'new'}
        title={editingId ? 'Edit role' : 'Create a role'}
        icon={editingId ? <Edit2 className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
        accent="emerald"
        hint={editingId ? 'Editing' : undefined}
        hintTone={editingId ? 'warn' : undefined}
        defaultOpen={Boolean(editingId)}
      >
        {editingId && <div className="flex justify-end"><button type="button" onClick={reset} className="cmms-classic-btn-secondary !h-auto !min-h-0 inline-flex items-center gap-1.5 !px-3 !py-1 text-xs"><X className="w-3.5 h-3.5" /> Cancel edit</button></div>}
        <form onSubmit={saveRole} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block text-xs font-semibold text-gray-400 mb-1">Role name</span>
              <input required value={draft.display_name || ''} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} placeholder="For example: Fleet Planner" className="w-full px-3 py-2.5 rounded bg-white/10 text-white border border-white/20 text-base" />
            </label>
            <label className="block">
              <span className="block text-xs font-semibold text-gray-400 mb-1">Permission level <span className="text-gray-500 font-normal">(1-10)</span></span>
              <input type="number" min="1" max="10" value={draft.permission_level || 1} onChange={(e) => setDraft({ ...draft, permission_level: e.target.value })} placeholder="Permission level" className="w-full px-3 py-2.5 rounded bg-white/10 text-white border border-white/20 text-base" />
            </label>
          </div>
          <label className="block">
            <span className="block text-xs font-semibold text-gray-400 mb-1">Description</span>
            <textarea value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Describe what this role is responsible for" rows={2} className="w-full px-3 py-2.5 rounded bg-white/10 text-white border border-white/20 text-base" />
          </label>
          <div>
            <p className="cmms-classic-label mb-1 flex items-center gap-1.5"><ShieldCheck className="h-3.5 w-3.5" /> Tools this role may access</p>
            <div className="grid sm:grid-cols-2 gap-x-6">
              {CMMS_TOOL_OPTIONS.map((tool) => {
                const enabled = Boolean(selectedTools[tool.id]);
                return <div key={tool.id} className={`inv-row inv-row-tool py-2.5 ${enabled ? '' : 'opacity-80'}`} style={enabled ? { '--row-accent': '#34d399' } : undefined}>
                  <button type="button" onClick={() => toggleTool(tool)} className={`w-full flex items-center gap-2 text-left font-semibold py-1.5 -m-1.5 px-1.5 rounded ${enabled ? 'text-green-200' : 'cmms-classic-muted active:bg-white/5'}`}>
                    <Check className={`shrink-0 w-5 h-5 ${enabled ? 'opacity-100' : 'opacity-20'}`} />
                    <span className="flex-1 min-w-0 break-words">{tool.label}</span>
                  </button>
                  {enabled && <div className="flex flex-wrap gap-1.5 mt-3 pl-1">
                    {tool.actions.map((action) => {
                      const active = hasAction(tool, action);
                      return <button
                        key={action}
                        type="button"
                        onClick={() => toggleAction(tool, action)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold capitalize border transition-colors ${active ? 'bg-green-500 border-green-400 text-white shadow-sm shadow-green-900/40' : 'bg-white/5 border-white/15 text-gray-500 active:bg-white/10'}`}
                      >
                        {active && <Check className="w-3.5 h-3.5" />}
                        {action.replace(/_/g, ' ')}
                      </button>;
                    })}
                    {tool.scopes && <div className="basis-full mt-2">
                      <span className="block text-xs cmms-classic-muted mb-1">Data scope <span className="opacity-75">(own, department, cross-department, or company-wide)</span></span>
                      <select value={getScope(tool)} onChange={(event) => setScope(tool, event.target.value)} className="w-full rounded bg-slate-900 border border-white/20 px-3 py-2 text-white text-sm">
                        <option value="own">Own records only</option>
                        <option value="department">Department only</option>
                        <option value="cross_department">Cross-department</option>
                        <option value="company">Company-wide</option>
                      </select>
                    </div>}
                  </div>}
                </div>;
              })}
            </div>
          </div>
          <CmmsFold title="Position details" icon={<Briefcase className="h-4 w-4" aria-hidden="true" />} accent="gold" hint="Optional" info={'Fill this in once and a job posting created "from this role" auto-fills these fields instead of retyping them — see Announcements & job postings.'}>
            <div className="grid sm:grid-cols-2 gap-3">
              <input value={draft.job_title || ''} onChange={(e) => setDraft({ ...draft, job_title: e.target.value })} placeholder="Job title (e.g. Warehouse Supervisor)" className="px-3 py-2.5 rounded bg-white/10 text-white border border-white/20 text-base" />
              <input value={draft.department || ''} onChange={(e) => setDraft({ ...draft, department: e.target.value })} placeholder="Department" className="px-3 py-2.5 rounded bg-white/10 text-white border border-white/20 text-base" />
              <select value={draft.employment_type || ''} onChange={(e) => setDraft({ ...draft, employment_type: e.target.value })} className="px-3 py-2.5 rounded bg-slate-900 text-white border border-white/20 text-base">
                <option value="">Employment type</option>
                {EMPLOYMENT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <input type="number" min="1" value={draft.positions_available || ''} onChange={(e) => setDraft({ ...draft, positions_available: e.target.value })} placeholder="Positions available" className="px-3 py-2.5 rounded bg-white/10 text-white border border-white/20 text-base" />
              <input value={draft.salary_range || ''} onChange={(e) => setDraft({ ...draft, salary_range: e.target.value })} placeholder="Salary range (e.g. UGX 800,000 - 1,200,000)" className="px-3 py-2.5 rounded bg-white/10 text-white border border-white/20 text-base sm:col-span-2" />
              <textarea value={draft.job_description || ''} onChange={(e) => setDraft({ ...draft, job_description: e.target.value })} placeholder="Job description" rows={2} className="px-3 py-2.5 rounded bg-white/10 text-white border border-white/20 text-base sm:col-span-2" />
              <textarea value={draft.responsibilities || ''} onChange={(e) => setDraft({ ...draft, responsibilities: e.target.value })} placeholder="Key responsibilities" rows={2} className="px-3 py-2.5 rounded bg-white/10 text-white border border-white/20 text-base sm:col-span-2" />
              <textarea value={draft.required_skills || ''} onChange={(e) => setDraft({ ...draft, required_skills: e.target.value })} placeholder="Required skills / qualifications" rows={2} className="px-3 py-2.5 rounded bg-white/10 text-white border border-white/20 text-base sm:col-span-2" />
            </div>
          </CmmsFold>
          {error && <p className="text-red-300 text-sm">{error}</p>}
          <button disabled={saving} className="cmms-classic-btn-primary w-full sm:w-auto px-4 py-3 sm:py-2 flex items-center justify-center gap-2"><Save className="w-4 h-4" />{saving ? 'Saving…' : editingId ? 'Update role' : 'Create role'}</button>
        </form>
      </CmmsFold>
      </CmmsPageShell>
  );
};

export default CMMSRoleConfiguration;
