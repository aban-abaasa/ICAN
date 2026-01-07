// ============================================
// CMMS (Computerized Maintenance Management System)
// ============================================
// Role hierarchy:
// Admin (creates company, assigns all roles)
//   ├── Department Coordinators
//   │   ├── Supervisors
//   │   ├── Technicians
//   │   └── Storemen
//   ├── Financial Officer
//   └── Service Providers (can select multiple service types)

import React, { useState } from 'react';
import {
  Building,
  User,
  Users,
  Package,
  Wrench,
  AlertTriangle,
  CheckCircle,
  Trash2,
  Plus
} from 'lucide-react';

const CMMSModule = ({ 
  onDataUpdate,
  netWorth,
  currentJourneyStage,
  user = null  // Current logged-in user
}) => {
  // ============================================
  // ACCESS CONTROL & AUTHORIZATION
  // ============================================
  const [userRole, setUserRole] = useState(null);
  const [hasBusinessProfile, setHasBusinessProfile] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [accessDeniedReason, setAccessDeniedReason] = useState('');

  // Role-based permission matrix
  const rolePermissions = {
    admin: {
      canViewCompany: true,
      canEditCompany: true,
      canManageUsers: true,
      canAssignRoles: true,
      canViewInventory: true,
      canEditInventory: true,
      canDeleteUsers: true,
      canViewFinancials: true,
      canManageServiceProviders: true,
      canCreateWorkOrders: true,
      canViewAllData: true,
      level: 7
    },
    coordinator: {
      canViewCompany: true,
      canEditCompany: false,
      canManageUsers: false,
      canAssignRoles: false,
      canViewInventory: true,
      canEditInventory: false,
      canDeleteUsers: false,
      canViewFinancials: false,
      canManageServiceProviders: false,
      canCreateWorkOrders: true,
      canViewAllData: false,
      level: 5
    },
    supervisor: {
      canViewCompany: true,
      canEditCompany: false,
      canManageUsers: false,
      canAssignRoles: false,
      canViewInventory: true,
      canEditInventory: false,
      canDeleteUsers: false,
      canViewFinancials: false,
      canManageServiceProviders: false,
      canCreateWorkOrders: true,
      canViewAllData: false,
      level: 4
    },
    technician: {
      canViewCompany: true,
      canEditCompany: false,
      canManageUsers: false,
      canAssignRoles: false,
      canViewInventory: true,
      canEditInventory: false,
      canDeleteUsers: false,
      canViewFinancials: false,
      canManageServiceProviders: false,
      canCreateWorkOrders: false,
      canViewAllData: false,
      level: 2
    },
    storeman: {
      canViewCompany: true,
      canEditCompany: false,
      canManageUsers: false,
      canAssignRoles: false,
      canViewInventory: true,
      canEditInventory: true,
      canDeleteUsers: false,
      canViewFinancials: false,
      canManageServiceProviders: false,
      canCreateWorkOrders: false,
      canViewAllData: false,
      level: 2
    },
    finance: {
      canViewCompany: true,
      canEditCompany: false,
      canManageUsers: false,
      canAssignRoles: false,
      canViewInventory: true,
      canEditInventory: false,
      canDeleteUsers: false,
      canViewFinancials: true,
      canManageServiceProviders: false,
      canCreateWorkOrders: false,
      canViewAllData: false,
      level: 4
    },
    'service-provider': {
      canViewCompany: true,
      canEditCompany: false,
      canManageUsers: false,
      canAssignRoles: false,
      canViewInventory: true,
      canEditInventory: false,
      canDeleteUsers: false,
      canViewFinancials: false,
      canManageServiceProviders: false,
      canCreateWorkOrders: true,
      canViewAllData: false,
      level: 1
    }
  };

  // ============================================
  // CHECK USER AUTHORIZATION
  // ============================================
  useEffect(() => {
    checkAuthorization();
  }, []);

  const checkAuthorization = () => {
    // Check 1: User must exist
    if (!user) {
      setAccessDeniedReason('❌ No user logged in. Please sign in to access CMMS.');
      setIsAuthorized(false);
      return;
    }

    // Check 2: User must have business profile
    const hasProfile = user?.businessProfile || localStorage.getItem('cmms_user_profile');
    if (!hasProfile && !user?.assignedCmmsRole) {
      setAccessDeniedReason('❌ Business profile not found. Create a business profile or contact your administrator.');
      setIsAuthorized(false);
      return;
    }

    // Check 3: User must have been assigned a role by admin
    const assignedRole = user?.assignedCmmsRole || localStorage.getItem('cmms_user_role');
    if (!assignedRole) {
      setAccessDeniedReason('❌ You have not been assigned a CMMS role. Contact your administrator for access.');
      setIsAuthorized(false);
      return;
    }

    // Check 4: Verify role exists
    if (!rolePermissions[assignedRole]) {
      setAccessDeniedReason('❌ Invalid role assigned. Contact your administrator.');
      setIsAuthorized(false);
      return;
    }

    // All checks passed
    setUserRole(assignedRole);
    setHasBusinessProfile(true);
    setIsAuthorized(true);
    setAccessDeniedReason('');
  };

  // ============================================
  // PERMISSION CHECK FUNCTION
  // ============================================
  const hasPermission = (permission) => {
    if (!isAuthorized || !userRole) return false;
    return rolePermissions[userRole]?.[permission] || false;
  };

  // ============================================
  // ACCESS DENIED VIEW
  // ============================================
  if (!isAuthorized) {
    return (
      <div className="glass-card p-8 border-l-4 border-red-500">
        <div className="flex items-start gap-4">
          <AlertTriangle className="w-12 h-12 text-red-400 flex-shrink-0 mt-1" />
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-red-300 mb-3">CMMS Access Denied</h2>
            <div className="bg-red-500 bg-opacity-20 border border-red-500 border-opacity-30 rounded-lg p-4 mb-4">
              <p className="text-red-200 font-semibold text-lg">{accessDeniedReason}</p>
            </div>
            <div className="space-y-2 text-gray-300">
              <h3 className="font-bold text-white">To access CMMS, you need:</h3>
              <div className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <span>✓ A valid business profile registered in the system</span>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle className="w-5 h-5 text-green-400 flex-shrink-0 mt-0.5" />
                <span>✓ Administrator assignment with a specific role (Admin, Coordinator, Supervisor, Technician, Storeman, Finance Officer, or Service Provider)</span>
              </div>
              <div className="mt-4 p-3 bg-blue-500 bg-opacity-20 border border-blue-500 border-opacity-30 rounded">
                <p className="text-blue-300 text-sm">💡 Contact your system administrator to request CMMS access with your business profile.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ============================================
  // REQUISITION & APPROVAL WORKFLOW STATE
  // ============================================
  const [cmmsData, setCmmsData] = useState({
    companyProfile: null,
    users: [],
    departments: [],
    workOrders: [],
    inventory: [],
    serviceProviders: [],
    maintenancePlans: [],
    requisitions: []  // NEW: Workflow requisitions
  });

  const [activeTab, setActiveTab] = useState('company');
  const [editingUser, setEditingUser] = useState(null);

  // Requisition status workflow
  const requisitionStatuses = [
    { id: 'draft', label: 'Draft', color: 'gray', icon: '📝' },
    { id: 'pending-supervisor', label: 'Pending Supervisor Approval', color: 'yellow', icon: '⏳' },
    { id: 'supervisor-rejected', label: 'Rejected by Supervisor', color: 'red', icon: '❌' },
    { id: 'supervisor-approved', label: 'Supervisor Approved', color: 'blue', icon: '✓' },
    { id: 'pending-coordinator', label: 'Pending Coordinator Review', color: 'yellow', icon: '⏳' },
    { id: 'coordinator-rejected', label: 'Rejected by Coordinator', color: 'red', icon: '❌' },
    { id: 'coordinator-approved', label: 'Coordinator Approved', color: 'blue', icon: '✓' },
    { id: 'pending-finance', label: 'Pending Finance Approval', color: 'yellow', icon: '💰' },
    { id: 'finance-rejected', label: 'Rejected by Finance', color: 'red', icon: '❌' },
    { id: 'finance-approved', label: 'Finance Approved - Ready', color: 'green', icon: '💚' },
    { id: 'in-progress', label: 'In Progress', color: 'blue', icon: '🔧' },
    { id: 'completed', label: 'Completed', color: 'green', icon: '✅' }
  ];

  // ============================================
  // REQUISITION MANAGER (TECHNICIAN & WORKFLOW)
  // ============================================
  const RequisitionManager = () => {
    const [newRequisition, setNewRequisition] = useState({
      title: '',
      description: '',
      equipmentId: '',
      estimatedCost: 0,
      priority: 'Medium',
      estimatedDays: 1
    });

    const canCreateRequisition = ['technician', 'supervisor', 'coordinator'].includes(userRole);
    const canApproveSupervisor = userRole === 'supervisor';
    const canApproveCoordinator = userRole === 'coordinator';
    const canApproveFinance = userRole === 'finance';

    const handleCreateRequisition = () => {
      if (!canCreateRequisition) {
        alert('❌ Only Technicians, Supervisors, and Coordinators can create requisitions.');
        return;
      }
      if (!newRequisition.title || !newRequisition.description) {
        alert('Please fill in all required fields');
        return;
      }

      const requisition = {
        id: Date.now(),
        ...newRequisition,
        createdBy: userRole,
        createdByName: user?.name || userRole,
        createdAt: new Date(),
        status: 'pending-supervisor',
        approvals: {
          supervisor: null,
          coordinator: null,
          finance: null
        },
        assignedTechnician: userRole === 'technician' ? user?.name : null
      };

      setCmmsData(prev => ({
        ...prev,
        requisitions: [...prev.requisitions, requisition]
      }));

      setNewRequisition({
        title: '',
        description: '',
        equipmentId: '',
        estimatedCost: 0,
        priority: 'Medium',
        estimatedDays: 1
      });

      onDataUpdate({ requisitions: [...cmmsData.requisitions, requisition] });
    };

    const handleSupervisorApproval = (requisitionId, approved, notes = '') => {
      if (!canApproveSupervisor) {
        alert('❌ Only Supervisors can approve at this stage');
        return;
      }

      setCmmsData(prev => ({
        ...prev,
        requisitions: prev.requisitions.map(req => {
          if (req.id === requisitionId && req.status === 'pending-supervisor') {
            return {
              ...req,
              status: approved ? 'supervisor-approved' : 'supervisor-rejected',
              approvals: {
                ...req.approvals,
                supervisor: {
                  approved,
                  approvedBy: user?.name || 'Supervisor',
                  approvedAt: new Date(),
                  notes
                }
              }
            };
          }
          return req;
        })
      }));
    };

    const handleCoordinatorApproval = (requisitionId, approved, notes = '') => {
      if (!canApproveCoordinator) {
        alert('❌ Only Coordinators can approve at this stage');
        return;
      }

      setCmmsData(prev => ({
        ...prev,
        requisitions: prev.requisitions.map(req => {
          if (req.id === requisitionId && req.status === 'supervisor-approved') {
            return {
              ...req,
              status: approved ? 'pending-finance' : 'coordinator-rejected',
              approvals: {
                ...req.approvals,
                coordinator: {
                  approved,
                  approvedBy: user?.name || 'Coordinator',
                  approvedAt: new Date(),
                  notes
                }
              }
            };
          }
          return req;
        })
      }));
    };

    const handleFinanceApproval = (requisitionId, approved, notes = '') => {
      if (!canApproveFinance) {
        alert('❌ Only Finance Officers can approve at this stage');
        return;
      }

      setCmmsData(prev => ({
        ...prev,
        requisitions: prev.requisitions.map(req => {
          if (req.id === requisitionId && req.status === 'pending-finance') {
            return {
              ...req,
              status: approved ? 'finance-approved' : 'finance-rejected',
              approvals: {
                ...req.approvals,
                finance: {
                  approved,
                  approvedBy: user?.name || 'Finance Officer',
                  approvedAt: new Date(),
                  notes
                }
              }
            };
          }
          return req;
        })
      }));
    };

    const handleAssignTechnician = (requisitionId, technicianName) => {
      if (!['coordinator', 'supervisor', 'admin'].includes(userRole)) {
        alert('❌ Only Coordinators, Supervisors, and Admins can assign technicians');
        return;
      }

      setCmmsData(prev => ({
        ...prev,
        requisitions: prev.requisitions.map(req => {
          if (req.id === requisitionId && req.status === 'finance-approved') {
            return {
              ...req,
              status: 'in-progress',
              assignedTechnician: technicianName,
              assignedAt: new Date()
            };
          }
          return req;
        })
      }));
    };

    const handleCompleteRequisition = (requisitionId) => {
      setCmmsData(prev => ({
        ...prev,
        requisitions: prev.requisitions.map(req => {
          if (req.id === requisitionId && req.status === 'in-progress') {
            return {
              ...req,
              status: 'completed',
              completedAt: new Date()
            };
          }
          return req;
        })
      }));
    };

    return (
      <div className="space-y-6">
        {/* Create Requisition Form - Technicians Only */}
        {canCreateRequisition && (
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Plus className="w-6 h-6 text-green-400" />
              Create Maintenance Requisition
            </h3>

            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <input
                type="text"
                placeholder="Requisition Title"
                value={newRequisition.title}
                onChange={(e) => setNewRequisition({...newRequisition, title: e.target.value})}
                className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 md:col-span-2"
              />
              <textarea
                placeholder="Description of work needed"
                value={newRequisition.description}
                onChange={(e) => setNewRequisition({...newRequisition, description: e.target.value})}
                className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 md:col-span-2 min-h-24"
              />
              <select
                value={newRequisition.priority}
                onChange={(e) => setNewRequisition({...newRequisition, priority: e.target.value})}
                className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white"
              >
                <option value="Low">Low Priority</option>
                <option value="Medium">Medium Priority</option>
                <option value="High">High Priority</option>
                <option value="Emergency">Emergency</option>
              </select>
              <input
                type="number"
                placeholder="Estimated Cost (UGX)"
                value={newRequisition.estimatedCost}
                onChange={(e) => setNewRequisition({...newRequisition, estimatedCost: parseFloat(e.target.value) || 0})}
                className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
              />
              <input
                type="number"
                placeholder="Estimated Days"
                value={newRequisition.estimatedDays}
                onChange={(e) => setNewRequisition({...newRequisition, estimatedDays: parseInt(e.target.value) || 1})}
                className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
              />
            </div>

            <button
              onClick={handleCreateRequisition}
              className="w-full px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition-all"
            >
              📝 Submit Requisition for Supervisor Approval
            </button>
          </div>
        )}

        {!canCreateRequisition && (
          <div className="glass-card p-4 bg-orange-500 bg-opacity-10 border-l-4 border-orange-500">
            <p className="text-orange-300 text-sm">🔒 <span className="font-semibold">View-Only Mode</span> - Only Technicians, Supervisors, and Coordinators can create requisitions.</p>
          </div>
        )}

        {/* Requisitions Workflow Display */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4">Maintenance Requisitions</h3>
          
          {cmmsData.requisitions.length === 0 ? (
            <p className="text-gray-400">No requisitions yet</p>
          ) : (
            <div className="space-y-4">
              {cmmsData.requisitions.map(req => {
                const statusInfo = requisitionStatuses.find(s => s.id === req.status);
                const showSupervisorApproval = req.status === 'pending-supervisor' && canApproveSupervisor;
                const showCoordinatorApproval = req.status === 'supervisor-approved' && canApproveCoordinator;
                const showFinanceApproval = req.status === 'pending-finance' && canApproveFinance;
                const canAssignTech = req.status === 'finance-approved' && ['coordinator', 'supervisor', 'admin'].includes(userRole);
                const canComplete = req.status === 'in-progress' && (userRole === 'technician' || userRole === 'supervisor');

                return (
                  <div key={req.id} className="border border-white border-opacity-20 rounded-lg p-4 bg-white bg-opacity-5">
                    {/* Requisition Header */}
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <h4 className="text-white font-bold text-lg">{req.title}</h4>
                        <p className="text-gray-400 text-sm mt-1">{req.description}</p>
                      </div>
                      <div className="flex items-center gap-2 text-right">
                        <span className="text-2xl">{statusInfo?.icon}</span>
                        <div>
                          <div className={`text-xs font-bold text-${statusInfo?.color}-300`}>{statusInfo?.label}</div>
                          <div className="text-xs text-gray-500">{req.priority} Priority</div>
                        </div>
                      </div>
                    </div>

                    {/* Requisition Details */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 pb-4 border-b border-white border-opacity-10">
                      <div>
                        <div className="text-xs text-gray-400">Estimated Cost</div>
                        <div className="text-white font-semibold">UGX {req.estimatedCost.toLocaleString()}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400">Est. Duration</div>
                        <div className="text-white font-semibold">{req.estimatedDays} day(s)</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400">Created By</div>
                        <div className="text-white font-semibold">{req.createdByName}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400">Assigned To</div>
                        <div className="text-white font-semibold">{req.assignedTechnician || 'Unassigned'}</div>
                      </div>
                    </div>

                    {/* Approval Chain */}
                    <div className="mb-4 pb-4 border-b border-white border-opacity-10">
                      <div className="text-xs text-gray-400 mb-2">Approval Chain:</div>
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <div className={`px-3 py-1 rounded ${req.approvals.supervisor ? 'bg-green-500 bg-opacity-30 text-green-300' : 'bg-gray-500 bg-opacity-30 text-gray-300'}`}>
                          👔 Supervisor {req.approvals.supervisor?.approved ? '✓' : '⏳'}
                        </div>
                        <span className="text-gray-500">→</span>
                        <div className={`px-3 py-1 rounded ${req.approvals.coordinator ? 'bg-green-500 bg-opacity-30 text-green-300' : 'bg-gray-500 bg-opacity-30 text-gray-300'}`}>
                          📋 Coordinator {req.approvals.coordinator?.approved ? '✓' : '⏳'}
                        </div>
                        <span className="text-gray-500">→</span>
                        <div className={`px-3 py-1 rounded ${req.approvals.finance ? 'bg-green-500 bg-opacity-30 text-green-300' : 'bg-gray-500 bg-opacity-30 text-gray-300'}`}>
                          💰 Finance {req.approvals.finance?.approved ? '✓' : '⏳'}
                        </div>
                        <span className="text-gray-500">→</span>
                        <div className={`px-3 py-1 rounded ${req.status === 'in-progress' || req.status === 'completed' ? 'bg-green-500 bg-opacity-30 text-green-300' : 'bg-gray-500 bg-opacity-30 text-gray-300'}`}>
                          🔧 Execute {req.status === 'completed' ? '✓' : '⏳'}
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons Based on Role & Status */}
                    <div className="flex gap-2 flex-wrap">
                      {showSupervisorApproval && (
                        <>
                          <button
                            onClick={() => handleSupervisorApproval(req.id, true, 'Approved by supervisor')}
                            className="px-3 py-1 bg-green-500 bg-opacity-30 text-green-300 rounded hover:bg-opacity-50 transition-all text-sm font-semibold"
                          >
                            ✓ Approve & Forward to Coordinator
                          </button>
                          <button
                            onClick={() => handleSupervisorApproval(req.id, false, 'Rejected by supervisor')}
                            className="px-3 py-1 bg-red-500 bg-opacity-30 text-red-300 rounded hover:bg-opacity-50 transition-all text-sm font-semibold"
                          >
                            ❌ Reject
                          </button>
                        </>
                      )}

                      {showCoordinatorApproval && (
                        <>
                          <button
                            onClick={() => handleCoordinatorApproval(req.id, true, 'Approved by coordinator')}
                            className="px-3 py-1 bg-green-500 bg-opacity-30 text-green-300 rounded hover:bg-opacity-50 transition-all text-sm font-semibold"
                          >
                            ✓ Approve & Send to Finance
                          </button>
                          <button
                            onClick={() => handleCoordinatorApproval(req.id, false, 'Rejected by coordinator')}
                            className="px-3 py-1 bg-red-500 bg-opacity-30 text-red-300 rounded hover:bg-opacity-50 transition-all text-sm font-semibold"
                          >
                            ❌ Reject
                          </button>
                        </>
                      )}

                      {showFinanceApproval && (
                        <>
                          <button
                            onClick={() => handleFinanceApproval(req.id, true, 'Approved by finance')}
                            className="px-3 py-1 bg-green-500 bg-opacity-30 text-green-300 rounded hover:bg-opacity-50 transition-all text-sm font-semibold"
                          >
                            ✓ Approve - Ready to Execute
                          </button>
                          <button
                            onClick={() => handleFinanceApproval(req.id, false, 'Rejected by finance')}
                            className="px-3 py-1 bg-red-500 bg-opacity-30 text-red-300 rounded hover:bg-opacity-50 transition-all text-sm font-semibold"
                          >
                            ❌ Reject
                          </button>
                        </>
                      )}

                      {canAssignTech && (
                        <button
                          onClick={() => handleAssignTechnician(req.id, user?.name || 'Technician')}
                          className="px-3 py-1 bg-blue-500 bg-opacity-30 text-blue-300 rounded hover:bg-opacity-50 transition-all text-sm font-semibold"
                        >
                          🎯 Assign Technician & Start Work
                        </button>
                      )}

                      {canComplete && (
                        <button
                          onClick={() => handleCompleteRequisition(req.id)}
                          className="px-3 py-1 bg-green-500 bg-opacity-30 text-green-300 rounded hover:bg-opacity-50 transition-all text-sm font-semibold"
                        >
                          ✅ Mark as Completed
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  // ============================================
  // COMPANY PROFILE MANAGEMENT (ADMIN ONLY)
  // ============================================
  const CompanyProfileManager = () => {
    // Strict: Only Admin can manage company profile
    if (!hasPermission('canEditCompany')) {
      return (
        <div className="glass-card p-6 bg-orange-500 bg-opacity-10 border-l-4 border-orange-500">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-orange-400" />
            <div>
              <p className="text-orange-300 font-semibold">🔒 Access Restricted</p>
              <p className="text-gray-400 text-sm mt-1">Only Administrators can manage company profiles. Your role: <span className="text-blue-300 font-bold uppercase">{userRole}</span></p>
            </div>
          </div>
        </div>
      );
    }

    const [formData, setFormData] = useState({
      companyName: cmmsData.companyProfile?.companyName || '',
      companyRegistration: cmmsData.companyProfile?.companyRegistration || '',
      location: cmmsData.companyProfile?.location || '',
      phone: cmmsData.companyProfile?.phone || '',
      email: cmmsData.companyProfile?.email || '',
      industry: cmmsData.companyProfile?.industry || 'Manufacturing'
    });

    const handleSaveProfile = () => {
      setCmmsData(prev => ({
        ...prev,
        companyProfile: { ...formData, createdAt: new Date(), createdBy: userRole }
      }));
      onDataUpdate({ companyProfile: formData });
    };

    if (!cmmsData.companyProfile) {
      return (
        <div className="glass-card p-6 space-y-4">
          <h3 className="text-xl font-bold text-white flex items-center gap-2">
            <Building className="w-6 h-6 text-blue-400" />
            Create Company Profile
          </h3>

          <div className="grid md:grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Company Name"
              value={formData.companyName}
              onChange={(e) => setFormData({...formData, companyName: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="text"
              placeholder="Registration Number"
              value={formData.companyRegistration}
              onChange={(e) => setFormData({...formData, companyRegistration: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="text"
              placeholder="Location"
              value={formData.location}
              onChange={(e) => setFormData({...formData, location: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="tel"
              placeholder="Phone"
              value={formData.phone}
              onChange={(e) => setFormData({...formData, phone: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="email"
              placeholder="Email"
              value={formData.email}
              onChange={(e) => setFormData({...formData, email: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <select
              value={formData.industry}
              onChange={(e) => setFormData({...formData, industry: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white"
            >
              <option value="Manufacturing">Manufacturing</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Transportation">Transportation</option>
              <option value="Building Management">Building Management</option>
              <option value="Industrial">Industrial</option>
              <option value="Energy">Energy</option>
              <option value="Other">Other</option>
            </select>
          </div>

          <button
            onClick={handleSaveProfile}
            className="w-full px-4 py-2 bg-gradient-to-r from-blue-500 to-green-500 text-white rounded-lg font-semibold hover:from-blue-600 hover:to-green-600 transition-all"
          >
            Create Company Profile
          </button>
        </div>
      );
    }

    return (
      <div className="glass-card p-6">
        <h3 className="text-xl font-bold text-white mb-4">Company Profile</h3>
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white bg-opacity-5 p-4 rounded">
            <div className="text-gray-400 text-sm">Company Name</div>
            <div className="text-white font-bold">{cmmsData.companyProfile.companyName}</div>
          </div>
          <div className="bg-white bg-opacity-5 p-4 rounded">
            <div className="text-gray-400 text-sm">Registration</div>
            <div className="text-white font-bold">{cmmsData.companyProfile.companyRegistration}</div>
          </div>
          <div className="bg-white bg-opacity-5 p-4 rounded">
            <div className="text-gray-400 text-sm">Location</div>
            <div className="text-white font-bold">{cmmsData.companyProfile.location}</div>
          </div>
          <div className="bg-white bg-opacity-5 p-4 rounded">
            <div className="text-gray-400 text-sm">Email</div>
            <div className="text-white font-bold">{cmmsData.companyProfile.email}</div>
          </div>
        </div>
        <button
          onClick={() => setCmmsData(prev => ({...prev, companyProfile: null}))}
          className="px-4 py-2 bg-orange-500 bg-opacity-30 text-orange-300 rounded-lg hover:bg-opacity-40 transition-all"
        >
          Edit Profile
        </button>
      </div>
    );
  };

  // ============================================
  // USER ROLE MANAGEMENT (ADMIN ONLY)
  // ============================================
  const UserRoleManager = () => {
    // Strict: Only Admin can manage users and assign roles
    if (!hasPermission('canManageUsers') || !hasPermission('canAssignRoles')) {
      return (
        <div className="space-y-4">
          <div className="glass-card p-6 bg-orange-500 bg-opacity-10 border-l-4 border-orange-500">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-6 h-6 text-orange-400" />
              <div>
                <p className="text-orange-300 font-semibold">🔒 User Management Restricted</p>
                <p className="text-gray-400 text-sm mt-1">Only Administrators can manage users and assign roles. Your role: <span className="text-blue-300 font-bold uppercase">{userRole}</span></p>
              </div>
            </div>
          </div>
          
          {/* View-only user list for authorized roles */}
          {hasPermission('canViewCompany') && (
            <div className="glass-card p-6">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-400" />
                Team Members (View Only)
              </h3>
              <div className="space-y-3">
                {cmmsData.users.length === 0 ? (
                  <p className="text-gray-400">No team members assigned yet</p>
                ) : (
                  cmmsData.users.map(user => (
                    <div key={user.id} className="bg-white bg-opacity-5 p-3 rounded flex justify-between items-center">
                      <div>
                        <p className="text-white font-semibold">{user.name}</p>
                        <p className="text-gray-400 text-sm">{user.email}</p>
                      </div>
                      <span className="px-3 py-1 bg-blue-500 bg-opacity-30 text-blue-300 rounded text-sm font-semibold uppercase">{user.role}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    const [newUser, setNewUser] = useState({
      name: '',
      email: '',
      phone: '',
      role: 'Technician',
      department: '',
      assignedServices: []
    });

    const roles = [
      { id: 'admin', label: 'Admin', color: 'from-red-500 to-pink-600', icon: '👑' },
      { id: 'coordinator', label: 'Department Coordinator', color: 'from-blue-500 to-cyan-600', icon: '📋' },
      { id: 'supervisor', label: 'Supervisor', color: 'from-purple-500 to-indigo-600', icon: '👔' },
      { id: 'technician', label: 'Technician', color: 'from-green-500 to-emerald-600', icon: '🔧' },
      { id: 'storeman', label: 'Storeman', color: 'from-yellow-500 to-orange-600', icon: '📦' },
      { id: 'finance', label: 'Financial Officer', color: 'from-teal-500 to-cyan-600', icon: '💰' },
      { id: 'service-provider', label: 'Service Provider', color: 'from-violet-500 to-purple-600', icon: '🏢' }
    ];

    const handleAddUser = () => {
      if (newUser.name && newUser.email && newUser.role) {
        const user = {
          id: Date.now(),
          ...newUser,
          createdAt: new Date(),
          status: 'Active'
        };
        setCmmsData(prev => ({
          ...prev,
          users: [...prev.users, user]
        }));
        setNewUser({ name: '', email: '', phone: '', role: 'Technician', department: '', assignedServices: [] });
      }
    };

    const handleDeleteUser = (userId) => {
      setCmmsData(prev => ({
        ...prev,
        users: prev.users.filter(u => u.id !== userId)
      }));
    };

    return (
      <div className="space-y-6">
        {/* Add New User Form */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <User className="w-6 h-6 text-blue-400" />
            Add New User
          </h3>

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            <input
              type="text"
              placeholder="Full Name"
              value={newUser.name}
              onChange={(e) => setNewUser({...newUser, name: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="email"
              placeholder="Email"
              value={newUser.email}
              onChange={(e) => setNewUser({...newUser, email: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="tel"
              placeholder="Phone"
              value={newUser.phone}
              onChange={(e) => setNewUser({...newUser, phone: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <select
              value={newUser.role}
              onChange={(e) => setNewUser({...newUser, role: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white"
            >
              {roles.map(r => (
                <option key={r.id} value={r.id}>{r.label}</option>
              ))}
            </select>
          </div>

          {(newUser.role === 'coordinator' || newUser.role === 'supervisor' || newUser.role === 'technician' || newUser.role === 'storeman') && (
            <input
              type="text"
              placeholder="Department"
              value={newUser.department}
              onChange={(e) => setNewUser({...newUser, department: e.target.value})}
              className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 mb-4"
            />
          )}

          {newUser.role === 'service-provider' && (
            <div className="mb-4">
              <label className="text-white text-sm mb-2 block">Select Services (can choose multiple):</label>
              <div className="grid grid-cols-2 gap-2">
                {['Preventive Maintenance', 'Corrective Maintenance', 'Installation', 'Inspection', 'Repair', 'Upgrade'].map(service => (
                  <button
                    key={service}
                    onClick={() => {
                      if (newUser.assignedServices.includes(service)) {
                        setNewUser({
                          ...newUser,
                          assignedServices: newUser.assignedServices.filter(s => s !== service)
                        });
                      } else {
                        setNewUser({
                          ...newUser,
                          assignedServices: [...newUser.assignedServices, service]
                        });
                      }
                    }}
                    className={`px-3 py-2 rounded text-sm font-medium transition-all ${
                      newUser.assignedServices.includes(service)
                        ? 'bg-green-500 text-white'
                        : 'bg-white bg-opacity-10 text-gray-300 hover:bg-opacity-20'
                    }`}
                  >
                    {newUser.assignedServices.includes(service) ? '✓ ' : '○ '}{service}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleAddUser}
            className="w-full px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition-all"
          >
            Add User
          </button>
        </div>

        {/* Users List */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4">Users & Roles ({cmmsData.users.length})</h3>
          <div className="space-y-3">
            {cmmsData.users.map(user => {
              const role = roles.find(r => r.id === user.role);
              return (
                <div key={user.id} className={`bg-gradient-to-r ${role?.color} bg-opacity-20 border border-current border-opacity-30 rounded-lg p-4`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{role?.icon}</span>
                        <div>
                          <div className="text-white font-bold">{user.name}</div>
                          <div className="text-xs text-gray-300">{role?.label}</div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 space-y-1">
                        <div>📧 {user.email}</div>
                        {user.phone && <div>📱 {user.phone}</div>}
                        {user.department && <div>🏢 {user.department}</div>}
                        {user.assignedServices && user.assignedServices.length > 0 && (
                          <div>🔧 {user.assignedServices.join(', ')}</div>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteUser(user.id)}
                      className="px-3 py-1 bg-red-500 bg-opacity-30 text-red-300 rounded text-sm hover:bg-opacity-50 transition-all"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
            {cmmsData.users.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                No users assigned yet. Add users to get started.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // INVENTORY TRACKING
  // ============================================
  const InventoryManager = () => {
    // Strict: Only Storeman and Admin can edit inventory
    const canViewInventory = hasPermission('canViewInventory');
    const canEditInventory = hasPermission('canEditInventory');

    if (!canViewInventory) {
      return (
        <div className="glass-card p-6 bg-red-500 bg-opacity-10 border-l-4 border-red-500">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-red-400" />
            <div>
              <p className="text-red-300 font-semibold">🔒 Inventory Access Denied</p>
              <p className="text-gray-400 text-sm mt-1">Your role (<span className="text-blue-300 font-bold uppercase">{userRole}</span>) does not have access to inventory data.</p>
            </div>
          </div>
        </div>
      );
    }

    const [newItem, setNewItem] = useState({
      name: '',
      category: 'Spare Parts',
      quantity: 0,
      minStock: 0,
      cost: 0,
      storeman: ''
    });

    const handleAddItem = () => {
      if (!canEditInventory) {
        alert('🔒 You do not have permission to add inventory items.');
        return;
      }
      if (newItem.name && newItem.quantity >= 0) {
        setCmmsData(prev => ({
          ...prev,
          inventory: [...prev.inventory, {
            id: Date.now(),
            ...newItem,
            createdAt: new Date(),
            lastRestocked: new Date(),
            createdBy: userRole,
            lastModifiedBy: userRole
          }]
        }));
        setNewItem({ name: '', category: 'Spare Parts', quantity: 0, minStock: 0, cost: 0, storeman: '' });
      }
    };

    const handleDeleteItem = (itemId) => {
      if (!canEditInventory) {
        alert('🔒 You do not have permission to delete inventory items.');
        return;
      }
      setCmmsData(prev => ({
        ...prev,
        inventory: prev.inventory.filter(item => item.id !== itemId)
      }));
    };

    const lowStockItems = cmmsData.inventory.filter(item => item.quantity <= item.minStock);
    const totalInventoryValue = cmmsData.inventory.reduce((sum, item) => sum + (item.quantity * item.cost), 0);

    return (
      <div className="space-y-6">
        {/* Permission Badge */}
        {!canEditInventory && (
          <div className="glass-card p-4 bg-blue-500 bg-opacity-10 border-l-4 border-blue-500">
            <p className="text-blue-300 text-sm">👁️ <span className="font-semibold">View-Only Mode</span> - You can see inventory but cannot make changes. Only Storeman and Admin can edit.</p>
          </div>
        )}

        {/* Add Inventory Item */}
        {canEditInventory && (
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Package className="w-6 h-6 text-blue-400" />
              Add Inventory Item
            </h3>

            <div className="grid md:grid-cols-3 gap-4 mb-4">
              <input
                type="text"
                placeholder="Item Name"
              value={newItem.name}
              onChange={(e) => setNewItem({...newItem, name: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <select
              value={newItem.category}
              onChange={(e) => setNewItem({...newItem, category: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white"
            >
              <option value="Spare Parts">Spare Parts</option>
              <option value="Tools">Tools</option>
              <option value="Materials">Materials</option>
              <option value="Equipment">Equipment</option>
              <option value="Consumables">Consumables</option>
            </select>
            <input
              type="number"
              placeholder="Quantity"
              value={newItem.quantity}
              onChange={(e) => setNewItem({...newItem, quantity: parseInt(e.target.value) || 0})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="number"
              placeholder="Min Stock Level"
              value={newItem.minStock}
              onChange={(e) => setNewItem({...newItem, minStock: parseInt(e.target.value) || 0})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <input
              type="number"
              placeholder="Unit Cost (UGX)"
              value={newItem.cost}
              onChange={(e) => setNewItem({...newItem, cost: parseFloat(e.target.value) || 0})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
            />
            <select
              value={newItem.storeman}
              onChange={(e) => setNewItem({...newItem, storeman: e.target.value})}
              className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white"
            >
              <option value="">Assign Storeman</option>
              {cmmsData.users.filter(u => u.role === 'storeman').map(u => (
                <option key={u.id} value={u.name}>{u.name}</option>
              ))}
            </select>
          </div>

          <button
            onClick={handleAddItem}
            className="w-full px-4 py-2 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition-all"
          >
            ✓ Add Item
          </button>
            </div>
        )}

        {/* Inventory Stats */}
        <div className="grid md:grid-cols-3 gap-4">
          <div className="glass-card p-4">
            <div className="text-gray-400 text-sm">Total Items</div>
            <div className="text-3xl font-bold text-blue-300">{cmmsData.inventory.length}</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-gray-400 text-sm">Inventory Value</div>
            <div className="text-3xl font-bold text-green-300">UGX {(totalInventoryValue / 1000000).toFixed(1)}M</div>
          </div>
          <div className="glass-card p-4">
            <div className="text-gray-400 text-sm">Low Stock Alerts</div>
            <div className="text-3xl font-bold text-orange-300">{lowStockItems.length}</div>
          </div>
        </div>

        {/* Inventory List */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4">Inventory Items</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {cmmsData.inventory.map(item => (
              <div key={item.id} className={`p-3 rounded-lg border ${
                item.quantity <= item.minStock
                  ? 'bg-orange-500 bg-opacity-20 border-orange-500 border-opacity-50'
                  : 'bg-white bg-opacity-5 border-white border-opacity-20'
              }`}>
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <div className="text-white font-semibold">{item.name}</div>
                    <div className="text-xs text-gray-400">
                      {item.category} • Stock: {item.quantity} (Min: {item.minStock}) • Cost: UGX {(item.cost * item.quantity).toLocaleString()}
                    </div>
                    {item.storeman && <div className="text-xs text-blue-300 mt-1">📦 {item.storeman}</div>}
                  </div>
                  {item.quantity <= item.minStock && (
                    <span className="px-2 py-1 bg-orange-500 text-white text-xs rounded font-bold">⚠️ LOW STOCK</span>
                  )}
                  {canEditInventory && (
                    <button
                      onClick={() => handleDeleteItem(item.id)}
                      className="ml-2 px-2 py-1 bg-red-500 bg-opacity-30 text-red-300 text-xs rounded hover:bg-opacity-50 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {cmmsData.inventory.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                No inventory items yet.
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // MAIN CMMS INTERFACE
  // ============================================
  return (
    <div className="glass-card p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-white flex items-center gap-3">
          <Wrench className="w-8 h-8 text-purple-400" />
          CMMS Management System
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          {cmmsData.companyProfile ? (
            <span className="bg-green-500 bg-opacity-20 text-green-300 px-3 py-1 rounded-full text-sm">✓ {cmmsData.companyProfile.companyName}</span>
          ) : (
            <span className="bg-yellow-500 bg-opacity-20 text-yellow-300 px-3 py-1 rounded-full text-sm">⚠ Setup Required</span>
          )}
          <span className="bg-blue-500 bg-opacity-30 text-blue-200 px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-1">
            🔑 Your Role: <span className="uppercase">{userRole}</span>
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6 border-b border-white border-opacity-10 overflow-x-auto">
        {[
          { id: 'company', label: '🏢 Company', icon: Building },
          { id: 'users', label: '👥 Users & Roles', icon: Users },
          { id: 'inventory', label: '📦 Inventory', icon: Package },
          { id: 'requisitions', label: '📋 Requisitions & Approvals', icon: Package }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-3 font-semibold transition-all whitespace-nowrap border-b-2 ${
              activeTab === tab.id
                ? 'text-blue-300 border-blue-500'
                : 'text-gray-400 border-transparent hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'company' && <CompanyProfileManager />}
        {activeTab === 'users' && <UserRoleManager />}
        {activeTab === 'inventory' && <InventoryManager />}
        {activeTab === 'requisitions' && <RequisitionManager />}
      </div>
    </div>
  );
};

export default CMMSModule;
