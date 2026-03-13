import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, Clipboard, Loader, Package, Plus, Search } from 'lucide-react';
import cmmsService from '../../lib/supabase/services/cmmsService';

const STATUS_META = {
  pending_department_head: {
    label: 'Pending Department Review',
    badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-500/40'
  },
  pending_finance: {
    label: 'Pending Finance Review',
    badgeClass: 'bg-sky-500/20 text-sky-300 border-sky-500/40'
  },
  approved: {
    label: 'Approved',
    badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
  },
  completed: {
    label: 'Completed',
    badgeClass: 'bg-emerald-600/20 text-emerald-200 border-emerald-600/40'
  },
  rejected_by_department_head: {
    label: 'Rejected by Department',
    badgeClass: 'bg-rose-500/20 text-rose-300 border-rose-500/40'
  },
  rejected_by_finance: {
    label: 'Rejected by Finance',
    badgeClass: 'bg-rose-600/20 text-rose-200 border-rose-600/40'
  }
};

const PRIORITY_META = {
  low: 'Low',
  normal: 'Normal',
  urgent: 'Urgent',
  emergency: 'Emergency'
};

const normalizeLineItem = (item = {}) => {
  const quantity = Number(item.quantity ?? item.requested_quantity ?? 0);
  const costPerUnit = Number(item.costPerUnit ?? item.unit_price ?? item.unit_cost ?? 0);
  const totalCost = Number(item.totalCost ?? item.line_total ?? quantity * costPerUnit);
  const equipment = item.equipment || item.item_name || item.item || 'Inventory item';

  return {
    ...item,
    id: item.id || `${equipment}-${quantity}-${costPerUnit}`,
    equipment,
    quantity: Number.isFinite(quantity) ? quantity : 0,
    costPerUnit: Number.isFinite(costPerUnit) ? costPerUnit : 0,
    totalCost: Number.isFinite(totalCost) ? totalCost : 0,
    condition: item.condition || item.item_condition || item.item_description || ''
  };
};

const mapRequisitionFromDb = (req) => ({
  id: req.id,
  title: req.purpose || 'Maintenance Request',
  description: req.justification || '',
  createdBy: req.requested_by_role || 'unknown',
  createdByName: req.requested_by_name || 'Unknown',
  createdAt: req.requisition_date ? new Date(req.requisition_date) : new Date(),
  status: req.status || 'pending_department_head',
  priority: req.urgency_level || 'normal',
  estimatedCost: Number(req.total_estimated_cost || 0),
  requisitionNumber: req.requisition_number || '',
  budgetSufficient: req.budget_sufficient,
  deptHeadApprovedAt: req.dept_head_approved_at,
  financeApprovedAt: req.finance_approved_at,
  requiredByDate: req.required_by_date || '',
  department_id: req.department_id || null,
  createdByEmail: req.requested_by_email || '',
  items: Array.isArray(req.items) ? req.items.map(normalizeLineItem) : []
});

const emptyForm = {
  title: '',
  description: '',
  priority: 'normal',
  requiredByDate: '',
  items: [],
  estimatedCost: 0
};

const formatUgx = (value) => `UGX ${Number(value || 0).toLocaleString()}`;

const RequisitionWorkspace = ({ userRole, user, companyId, cmmsData, setCmmsData, userDepartmentId }) => {
  const [form, setForm] = useState(emptyForm);
  const [selectedItem, setSelectedItem] = useState('');
  const [itemQuantity, setItemQuantity] = useState(1);
  const [itemCost, setItemCost] = useState('');
  const [itemCondition, setItemCondition] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [expandedReqId, setExpandedReqId] = useState(null);
  const hasLoaded = useRef(false);
  const pendingRequiredAmount = (Number(itemQuantity) || 0) * (Number(itemCost) || 0);

  const canCreateRequisition = ['technician', 'service-provider', 'supervisor', 'coordinator', 'admin'].includes(userRole);
  // Technicians and service-providers can submit only; they cannot browse the register
  const canViewRequisitionList = !['technician', 'service-provider'].includes(userRole);

  const inventoryOptions = useMemo(() => {
    const names = (cmmsData.inventory || [])
      .map((item) => item.item_name || item.itemName)
      .filter(Boolean);
    return Array.from(new Set(names)).sort((a, b) => a.localeCompare(b));
  }, [cmmsData.inventory]);

  const loadRequisitions = useCallback(
    async (force = false) => {
      if (!companyId) return;
      if (hasLoaded.current && !force) return;

      hasLoaded.current = true;
      setIsLoading(true);
      try {
        const { data, error } = await cmmsService.getCompanyRequisitions(companyId);
        if (error) {
          console.error('Failed to load requisitions:', error);
          return;
        }

        const transformed = (data || []).map(mapRequisitionFromDb);
        setCmmsData((prev) => ({
          ...prev,
          requisitions: transformed
        }));
      } catch (error) {
        console.error('Error loading requisitions:', error);
      } finally {
        setIsLoading(false);
      }
    },
    [companyId, setCmmsData]
  );

  useEffect(() => {
    hasLoaded.current = false;
    loadRequisitions(false);
  }, [companyId, loadRequisitions]);

  const handleAddLineItem = () => {
    const quantity = Number(itemQuantity);
    const unitCost = Number(itemCost);

    if (!selectedItem.trim()) {
      alert('Please select an item.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      alert('Quantity must be greater than 0.');
      return;
    }
    if (!Number.isFinite(unitCost) || unitCost <= 0) {
      alert('Unit cost must be greater than 0.');
      return;
    }
    if (!itemCondition.trim()) {
      alert('Please provide the item condition.');
      return;
    }

    const item = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      equipment: selectedItem,
      quantity,
      costPerUnit: unitCost,
      totalCost: quantity * unitCost,
      condition: itemCondition.trim()
    };

    setForm((prev) => {
      const items = [...prev.items, item];
      return {
        ...prev,
        items,
        estimatedCost: items.reduce((sum, current) => sum + Number(current.totalCost || 0), 0)
      };
    });

    setSelectedItem('');
    setItemQuantity(1);
    setItemCost('');
    setItemCondition('');
  };

  const handleRemoveLineItem = (itemId) => {
    setForm((prev) => {
      const items = prev.items.filter((item) => item.id !== itemId);
      return {
        ...prev,
        items,
        estimatedCost: items.reduce((sum, current) => sum + Number(current.totalCost || 0), 0)
      };
    });
  };

  const handleCreateRequisition = async () => {
    if (!canCreateRequisition) {
      alert('Your role can view requisitions but cannot create new ones.');
      return;
    }
    if (!form.title.trim() || !form.description.trim()) {
      alert('Title and description are required.');
      return;
    }
    if (!form.items.length) {
      alert('Add at least one line item.');
      return;
    }
    if (form.estimatedCost <= 0) {
      alert('Estimated cost must be greater than 0.');
      return;
    }

    const departmentId = cmmsData.departments?.[0]?.id;
    if (!departmentId) {
      alert('No department found. Please add or assign a department first.');
      return;
    }
    if (!companyId) {
      alert('Company profile is missing. Refresh and try again.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { data, error } = await cmmsService.createRequisition(
        companyId,
        departmentId,
        {
          description: form.description,
          purpose: form.title,
          priority: form.priority,
          estimatedCost: form.estimatedCost,
          requiredByDate: form.requiredByDate,
          requesterName: user?.name || userRole || 'Unknown',
          requesterEmail: user?.email || '',
          requesterRole: userRole || 'unknown',
          budgetSufficient: true,
          items: form.items
        },
        user?.id
      );

      if (error || !data) {
        console.error('Error creating requisition:', error);
        const dbMessage = error?.message || 'Failed to create requisition.';
        const isRls = String(error?.code || '') === '42501' || /row-level security|policy/i.test(dbMessage);
        alert(
          isRls
            ? `${dbMessage}\n\nAsk admin to confirm this user has CMMS access for the selected company/department and requisition INSERT policy includes this identity.`
            : dbMessage
        );
        return;
      }

      const created = {
        id: data.id,
        title: form.title,
        description: form.description,
        createdBy: userRole || 'unknown',
        createdByName: user?.name || userRole || 'Unknown',
        createdAt: new Date(),
        status: data.status || 'pending_department_head',
        priority: form.priority,
        estimatedCost: Number(form.estimatedCost || 0),
        requisitionNumber: data.requisition_number || '',
        budgetSufficient: data.budget_sufficient,
        requiredByDate: form.requiredByDate,
        items: form.items
      };

      setCmmsData((prev) => ({
        ...prev,
        requisitions: [created, ...(prev.requisitions || [])]
      }));

      setForm(emptyForm);
      setSelectedItem('');
      setItemQuantity(1);
      setItemCost('');
      setItemCondition('');
      alert(`Requisition created: ${data.requisition_number || data.id}`);
    } catch (error) {
      console.error('Unexpected error creating requisition:', error);
      alert('An unexpected error occurred while creating the requisition.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const requisitions = cmmsData.requisitions || [];

  // Scope to the user's department (admin sees all when userDepartmentId is null)
  // Scope: service-providers see only their own submissions; others scoped by department
  const userScopedRequisitions = useMemo(() => {
    if (userRole === 'service-provider') {
      const myEmail = user?.email?.toLowerCase();
      return requisitions.filter(
        (req) => req.createdByEmail?.toLowerCase() === myEmail
      );
    }
    if (!userDepartmentId) return requisitions;
    return requisitions.filter(
      (req) => !req.department_id || req.department_id === userDepartmentId
    );
  }, [requisitions, userDepartmentId, userRole, user?.email]);

  const filteredRequisitions = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();

    return userScopedRequisitions.filter((req) => {
      const matchesStatus = statusFilter === 'all' ? true : req.status === statusFilter;
      if (!matchesStatus) return false;

      if (!term) return true;

      const haystack = [
        req.title,
        req.description,
        req.requisitionNumber,
        req.createdByName,
        req.priority
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      return haystack.includes(term);
    });
  }, [userScopedRequisitions, searchTerm, statusFilter]);

  const metrics = useMemo(() => {
    const all = userScopedRequisitions.length;
    const pending = userScopedRequisitions.filter((req) =>
      ['pending_department_head', 'pending_finance'].includes(req.status)
    ).length;
    const completed = userScopedRequisitions.filter((req) => req.status === 'completed').length;
    const totalEstimated = userScopedRequisitions.reduce((sum, req) => sum + Number(req.estimatedCost || 0), 0);

    return { all, pending, completed, totalEstimated };
  }, [userScopedRequisitions]);

  return (
    <div className="space-y-6">
      {/* Department scope banner */}
      {/* Department / ownership scope banner */}
      <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border ${
        userRole === 'service-provider'
          ? 'bg-violet-500/10 border-violet-500/30 text-violet-300'
          : userDepartmentId
            ? 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
            : 'bg-slate-700/40 border-slate-600/40 text-slate-300'
      }`}>
        <Clipboard className="w-4 h-4 shrink-0" />
        {userRole === 'service-provider'
          ? 'Showing: Your submitted requisitions only'
          : userDepartmentId
            ? (() => {
                const dept = cmmsData.departments?.find((d) => d.id === userDepartmentId);
                return `Showing: ${dept?.name || 'Your Department'} requisitions only`;
              })()
            : 'Showing: All Departments'}
      </div>

      {canViewRequisitionList && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-4">
          <div className="text-xs uppercase tracking-wide text-cyan-300">Total Requisitions</div>
          <div className="mt-2 text-2xl font-bold text-white">{metrics.all}</div>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
          <div className="text-xs uppercase tracking-wide text-amber-300">Open Queue</div>
          <div className="mt-2 text-2xl font-bold text-white">{metrics.pending}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="text-xs uppercase tracking-wide text-emerald-300">Completed</div>
          <div className="mt-2 text-2xl font-bold text-white">{metrics.completed}</div>
        </div>
        <div className="rounded-xl border border-fuchsia-500/30 bg-fuchsia-500/10 p-4">
          <div className="text-xs uppercase tracking-wide text-fuchsia-300">Estimated Value</div>
          <div className="mt-2 text-xl font-bold text-white">UGX {metrics.totalEstimated.toLocaleString()}</div>
        </div>
      </div>
      )}

      {canCreateRequisition ? (
        <section className="rounded-2xl border border-white/10 bg-gradient-to-br from-slate-900/80 via-slate-900/55 to-cyan-900/35 p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-cyan-300" />
                New Maintenance Requisition
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Redesigned intake form with line items and automatic totals.
              </p>
            </div>
            <button
              onClick={() => {
                setForm(emptyForm);
                setSelectedItem('');
                setItemQuantity(1);
                setItemCost('');
                setItemCondition('');
              }}
              className="px-3 py-2 text-xs font-semibold rounded-lg border border-slate-600 text-slate-300 hover:bg-slate-800/70 transition-colors"
            >
              Reset
            </button>
          </div>

          <div className="grid lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 space-y-3">
              <div>
                <label className="text-xs text-slate-300 uppercase tracking-wide">Title</label>
                <input
                  type="text"
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="Example: Generator preventive service"
                  className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                />
              </div>

              <div>
                <label className="text-xs text-slate-300 uppercase tracking-wide">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                  rows={4}
                  placeholder="Describe the maintenance requirement and expected outcome."
                  className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-slate-300 uppercase tracking-wide">Priority</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm((prev) => ({ ...prev, priority: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                  >
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent</option>
                    <option value="emergency">Emergency</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-slate-300 uppercase tracking-wide">Required By</label>
                  <input
                    type="date"
                    value={form.requiredByDate}
                    onChange={(e) => setForm((prev) => ({ ...prev, requiredByDate: e.target.value }))}
                    className="mt-1 w-full rounded-lg border border-white/15 bg-slate-950/45 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-3">
              <div className="rounded-xl border border-cyan-500/25 bg-slate-950/55 p-3">
                <h4 className="text-sm font-semibold text-cyan-200 mb-2">Line Items</h4>
                <div className="space-y-2">
                  <select
                    value={selectedItem}
                    onChange={(e) => setSelectedItem(e.target.value)}
                    className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                  >
                    <option value="">Select inventory item</option>
                    {inventoryOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      min="1"
                      value={itemQuantity}
                      onChange={(e) => setItemQuantity(Number(e.target.value) || 1)}
                      placeholder="Required Qty"
                      className="rounded-lg border border-white/15 bg-slate-900 px-2.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                    />
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={itemCost}
                      onChange={(e) => setItemCost(e.target.value)}
                      placeholder="Unit cost"
                      className="rounded-lg border border-white/15 bg-slate-900 px-2.5 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                    />
                  </div>
                  <input
                    type="text"
                    value={itemCondition}
                    onChange={(e) => setItemCondition(e.target.value)}
                    placeholder="Condition (required)"
                    className="w-full rounded-lg border border-white/15 bg-slate-900 px-2.5 py-2 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
                  />
                  <p className="text-[11px] text-slate-400">
                    Required amount per item = Required Qty x Unit cost
                  </p>
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <p className="text-[11px] uppercase tracking-wide text-amber-200">Required Amount (This Item)</p>
                    <p className="text-sm font-semibold text-amber-100">{formatUgx(pendingRequiredAmount)}</p>
                  </div>

                  <button
                    type="button"
                    onClick={handleAddLineItem}
                    className="w-full rounded-lg bg-cyan-600 px-3 py-2 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors"
                  >
                    Add Item
                  </button>
                </div>

                <div className="mt-3 space-y-2 max-h-52 overflow-y-auto">
                  {form.items.length === 0 && (
                    <div className="rounded-lg border border-dashed border-slate-600 px-3 py-4 text-xs text-slate-400 text-center">
                      No line items yet.
                    </div>
                  )}
                  {form.items.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-lg border border-white/10 bg-slate-900/50 px-3 py-2 text-[11px] uppercase tracking-wide text-slate-400">
                      <span>Required Qty</span>
                      <span>Unit Cost</span>
                      <span>Condition</span>
                      <span className="text-right sm:text-left">Required Amount</span>
                    </div>
                  )}
                  {form.items.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-white/10 bg-slate-900/70 px-3 py-3"
                    >
                      <div className="min-w-0 mb-2">
                        <p className="text-sm text-white truncate">{item.equipment}</p>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-start">
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-400">Required Qty</div>
                          <div className="text-sm text-white">{item.quantity}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-400">Unit Cost</div>
                          <div className="text-sm text-white">{formatUgx(item.costPerUnit)}</div>
                        </div>
                        <div>
                          <div className="text-[10px] uppercase tracking-wide text-slate-400">Condition</div>
                          <div className="text-sm text-white">{item.condition || 'Not specified'}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-[10px] uppercase tracking-wide text-slate-400">Required Amount</div>
                          <div className="text-sm text-amber-300 font-semibold">
                            {formatUgx(item.totalCost)}
                          </div>
                        </div>
                      </div>
                      <div className="mt-2 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveLineItem(item.id)}
                          className="text-xs text-rose-300 hover:text-rose-200"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                <div className="text-xs uppercase tracking-wide text-amber-200">Estimated Total</div>
                <div className="mt-1 text-xl font-bold text-white">{formatUgx(form.estimatedCost)}</div>
              </div>

              <button
                onClick={handleCreateRequisition}
                disabled={isSubmitting}
                className="w-full rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:from-cyan-500 hover:to-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Creating...' : 'Create Requisition'}
              </button>
            </div>
          </div>
        </section>
      ) : (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          Your role can view requisitions but cannot create new ones.
        </div>
      )}

      {canViewRequisitionList && (
      <section className="rounded-2xl border border-white/10 bg-slate-900/45 p-5">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <h3 className="text-lg md:text-xl font-bold text-white flex items-center gap-2">
            <Clipboard className="w-5 h-5 text-cyan-300" />
            Requisition Register
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search requisitions"
                className="pl-8 pr-3 py-2 rounded-lg border border-white/15 bg-slate-950/50 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-white/15 bg-slate-950/50 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-cyan-500/60"
            >
              <option value="all">All statuses</option>
              {Object.entries(STATUS_META).map(([status, meta]) => (
                <option key={status} value={status}>
                  {meta.label}
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                hasLoaded.current = false;
                loadRequisitions(true);
              }}
              disabled={isLoading}
              className="rounded-lg border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-sm font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-60"
            >
              Refresh
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="py-10 text-center">
            <Loader className="w-8 h-8 text-cyan-300 mx-auto animate-spin" />
            <p className="text-sm text-slate-400 mt-3">Loading requisitions...</p>
          </div>
        ) : filteredRequisitions.length === 0 ? (
          <div className="py-10 text-center">
            <Package className="w-10 h-10 text-slate-600 mx-auto mb-2" />
            <p className="text-slate-300">No requisitions match your current filters.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRequisitions.map((req) => {
              const status = STATUS_META[req.status] || STATUS_META.pending_department_head;
              const isExpanded = expandedReqId === req.id;
              return (
                <article
                  key={req.id}
                  onClick={() => setExpandedReqId(isExpanded ? null : req.id)}
                  className="rounded-xl border border-white/10 bg-gradient-to-br from-slate-950/65 to-slate-900/45 p-4 cursor-pointer transition-all hover:border-white/20"
                >
                  {/* Always visible: title row */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center flex-wrap gap-2 min-w-0">
                      <h4 className="text-base font-semibold text-white truncate">{req.title}</h4>
                      <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-300 flex-shrink-0">
                        {req.requisitionNumber || req.id}
                      </span>
                      <span className={`rounded-md border px-2 py-0.5 text-xs flex-shrink-0 ${status.badgeClass}`}>
                        {status.label}
                      </span>
                    </div>
                    <ChevronDown className={`w-5 h-5 text-slate-400 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-4">
                      <p className="text-sm text-slate-300 mb-3">{req.description}</p>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs text-slate-400">Estimated Cost</span>
                        <span className="text-base font-bold text-amber-300">{formatUgx(req.estimatedCost)}</span>
                      </div>

                      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                        <div className="rounded-lg bg-slate-900/60 border border-white/5 p-2">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Priority</p>
                          <p className="text-sm text-white">{PRIORITY_META[req.priority] || 'Normal'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-900/60 border border-white/5 p-2">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Requested By</p>
                          <p className="text-sm text-white">{req.createdByName || 'Unknown'}</p>
                        </div>
                        <div className="rounded-lg bg-slate-900/60 border border-white/5 p-2">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Created</p>
                          <p className="text-sm text-white">{new Date(req.createdAt).toLocaleDateString()}</p>
                        </div>
                        <div className="rounded-lg bg-slate-900/60 border border-white/5 p-2">
                          <p className="text-[11px] uppercase tracking-wide text-slate-500">Required By</p>
                          <p className="text-sm text-white">
                            {req.requiredByDate ? new Date(req.requiredByDate).toLocaleDateString() : 'Not set'}
                          </p>
                        </div>
                      </div>

                      {Array.isArray(req.items) && req.items.length > 0 && (
                        <div className="mt-3 rounded-lg border border-white/10 bg-slate-950/40 p-2.5">
                          <p className="text-[11px] uppercase tracking-wide text-slate-400 mb-2">Line Items</p>
                          <div className="space-y-2">
                            {req.items.map((item, index) => (
                              <div key={item.id || `${req.id}-item-${index}`} className="rounded-md border border-white/10 bg-slate-900/60 p-2">
                                <p className="text-sm text-white truncate">{item.equipment || item.item_name || 'Inventory item'}</p>
                                <div className="mt-1.5 grid grid-cols-2 sm:grid-cols-4 gap-2">
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Required Qty</p>
                                    <p className="text-sm text-white">{Number(item.quantity || 0)}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Unit Cost</p>
                                    <p className="text-sm text-white">{formatUgx(item.costPerUnit)}</p>
                                  </div>
                                  <div>
                                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Condition</p>
                                    <p className="text-sm text-white">{item.condition || 'Not specified'}</p>
                                  </div>
                                  <div className="text-right">
                                    <p className="text-[10px] uppercase tracking-wide text-slate-500">Required Amount</p>
                                    <p className="text-sm font-semibold text-amber-300">{formatUgx(item.totalCost)}</p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
      )}
    </div>
  );
};

export default RequisitionWorkspace;
