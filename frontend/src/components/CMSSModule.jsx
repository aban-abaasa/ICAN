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

import React, { useState, useEffect } from 'react';
import {
  Building,
  User,
  Users,
  Package,
  Wrench,
  AlertTriangle,
  CheckCircle,
  Trash2,
  Plus,
  Loader,
  Search,
  CheckCircle2
} from 'lucide-react';

// Import Supabase CMMS service
import cmmsService from '../lib/supabase/services/cmmsService';
import { supabase } from '../lib/supabase/client';
import { searchICANUsers, verifyICANUser } from '../services/pitchingService';
import NotificationsPanel from './NotificationsPanel';

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
    guest: {
      canViewCompany: false,
      canEditCompany: true,  // Can only create profile
      canManageUsers: false,
      canAssignRoles: false,
      canViewInventory: false,
      canEditInventory: false,
      canDeleteUsers: false,
      canViewFinancials: false,
      canManageServiceProviders: false,
      canCreateWorkOrders: false,
      canViewAllData: false,
      level: 0
    },
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
  // CHECK USER AUTHORIZATION & LOAD COMPANY DATA
  // ============================================
  useEffect(() => {
    const initializeUser = async () => {
      await checkAuthorizationAndLoadCompanyData();
    };
    initializeUser();
  }, [user]);

  // Check authorization and load company data from database
  const checkAuthorizationAndLoadCompanyData = async () => {
    try {
      // Check 1: User must exist (or have cached data)
      const cachedCompanyId = localStorage.getItem('cmms_company_id');
      const cachedRole = localStorage.getItem('cmms_user_role');
      const cachedCmmsUserId = localStorage.getItem('cmms_user_id');
      
      // Restore CMMS user ID if cached
      if (cachedCmmsUserId) {
        setCmmsUserId(cachedCmmsUserId);
      }
      
      if (!user && !cachedCompanyId) {
        setAccessDeniedReason('❌ No user logged in. Please sign in to access CMMS.');
        setIsAuthorized(false);
        return;
      }

      // If user is logged in, check if they're in the cmms_users table
      if (user?.email) {
        console.log('🔍 Searching for user in CMMS database:', user.email);
        
        // Step 1: Find user in cmms_users table (case-insensitive search)
        const { data: cmmsUsers, error: userError } = await supabase
          .from('cmms_users')
          .select('id, email, cmms_company_id, is_active')
          .ilike('email', user.email);

        if (userError) {
          console.error('Error querying cmms_users:', userError);
        }

        if (cmmsUsers && cmmsUsers.length > 0) {
          const cmmsUser = cmmsUsers[0];
          console.log('✅ User found in CMMS database:', cmmsUser.email);
          console.log('✅ User company ID:', cmmsUser.cmms_company_id);
          
          // Save company ID and user ID to localStorage and state
          localStorage.setItem('cmms_company_id', cmmsUser.cmms_company_id);
          localStorage.setItem('cmms_user_id', cmmsUser.id);
          setUserCompanyId(cmmsUser.cmms_company_id);
          setCmmsUserId(cmmsUser.id);
          setNotificationCompanyId(cmmsUser.cmms_company_id);  // For welcome page notifications

          // Step 2: Get user's roles separately (better reliability)
          const { data: userRoles, error: rolesError } = await supabase
            .from('cmms_user_roles')
            .select('cmms_role_id, cmms_roles(role_name)')
            .eq('cmms_user_id', cmmsUser.id)
            .eq('is_active', true);

          if (rolesError) {
            console.error('Error fetching user roles:', rolesError);
          }

          if (userRoles && userRoles.length > 0) {
            const roleNames = userRoles
              .map(ur => ur.cmms_roles?.role_name)
              .filter(Boolean);
            
            const primaryRole = roleNames[0] || 'viewer';
            
            console.log(`📋 User roles found:`, roleNames);
            console.log(`✅ User authorized with primary role: ${primaryRole}`);
            
            localStorage.setItem('cmms_user_role', primaryRole);
            setUserRole(primaryRole);
            setHasBusinessProfile(true);  // ✅ SET THIS SO DASHBOARD LOADS
            setIsAuthorized(true);
            setAccessDeniedReason('');
            console.log('🔓 hasBusinessProfile set to TRUE - should load dashboard');
          } else {
            console.log('⚠️ User in CMMS but no active roles assigned - assigning viewer role');
            localStorage.setItem('cmms_user_role', 'viewer');
            setUserRole('viewer');
            setHasBusinessProfile(true);  // ✅ SET THIS SO DASHBOARD LOADS
            setIsAuthorized(true);
            setAccessDeniedReason('');
            console.log('🔓 hasBusinessProfile set to TRUE (viewer) - should load dashboard');
          }

          // Load company data
          console.log('📂 Loading company data for company_id:', cmmsUser.cmms_company_id);
          await loadCompanyData(cmmsUser.cmms_company_id);  // Pass company ID directly
          return;
        }
      }

      // Fallback to cached data if user not in database
      const assignedRole = user?.assignedCmmsRole || cachedRole;
      
      // Normalize CMMS role names: CMMS_Admin -> admin, CMMS_Coordinator -> coordinator, etc.
      let normalizedRole = assignedRole;
      if (assignedRole && assignedRole.startsWith('CMMS_')) {
        normalizedRole = assignedRole.replace('CMMS_', '').toLowerCase();
      } else if (assignedRole) {
        normalizedRole = assignedRole.toLowerCase();
      }
      
      if (normalizedRole && rolePermissions[normalizedRole]) {
        // Fully authorized with role
        setUserRole(normalizedRole);
        setHasBusinessProfile(true);
        setIsAuthorized(true);
        setAccessDeniedReason('');
        if (cachedCompanyId) {
          setUserCompanyId(cachedCompanyId);
          await loadCompanyData(cachedCompanyId);
        } else {
          await loadCompanyData();
        }
        return;
      }

      // Check 3: If user has business profile but no role, allow limited access
      const hasProfile = user?.businessProfile || localStorage.getItem('cmms_user_profile') || cachedCompanyId;
      if (hasProfile) {
      // Has profile but no role - can view company info and wait for admin
      setUserRole('guest');  // Temporary role for profile creation
      setHasBusinessProfile(true);
      setIsAuthorized(true);
      setAccessDeniedReason('');
      if (cachedCompanyId) {
        setUserCompanyId(cachedCompanyId);
        await loadCompanyData(cachedCompanyId);
      } else {
        await loadCompanyData();
      }
      return;
    }

    // User exists but has neither profile nor role - allow them to create profile
    setUserRole('guest');  // Temporary role for profile creation
    setHasBusinessProfile(false);
    setIsAuthorized(true);  // Allow access to create profile
    setAccessDeniedReason('');
    } catch (error) {
      console.error('Error during authorization check:', error);
      setAccessDeniedReason('Error loading CMMS data. Please try again.');
      setIsAuthorized(false);
    }
  };

  // Load company profile and users from Supabase (source of truth)
  const loadCompanyData = async (companyIdParam = null) => {
    try {
      // Use parameter first, then cached, then state
      const companyIdToUse = companyIdParam || localStorage.getItem('cmms_company_id') || userCompanyId;
      
      if (!companyIdToUse) {
        console.warn('⚠️ No company ID available - user may not be linked to company yet');
        return;
      }

      console.log('🔍 Loading company data for company_id:', companyIdToUse);

      // Fetch company profile from Supabase - this is the source of truth
      const { data: profile, error: profileError } = await supabase
        .from('cmms_company_profiles')
        .select('*')
        .eq('id', companyIdToUse)
        .single();

      console.log('🔍 Company profile query response:', { profile, profileError });

      if (profileError) {
        console.warn('⚠️ Company profile query error:', profileError.message);
        // Log more details about the error
        console.warn('Error code:', profileError.code);
        console.warn('Company ID searched:', companyIdToUse);
        // Don't return - users might not have created profile yet
      } else if (profile) {
        console.log('✅ Company profile loaded:', profile);
        console.log('✅ Setting company name:', profile.company_name);
        setCmmsData(prev => ({
          ...prev,
          companyProfile: profile
        }));
        setUserCompanyId(profile.id);
        console.log('✅ cmmsData.companyProfile updated in state');
      } else {
        console.warn('⚠️ No company profile found for ID:', companyIdToUse);
      }

      // Fetch users from cmms_users table
      const { data: users, error: usersError } = await supabase
        .from('cmms_users_with_roles')
        .select('*')
        .eq('cmms_company_id', companyIdToUse)
        .eq('is_active', true);

      if (usersError) {
        console.error('❌ Error loading users from Supabase:', usersError);
        return;
      }

      if (users && users.length > 0) {
        console.log(`✅ Loaded ${users.length} users from Supabase`);
        const formattedUsers = users.map(user => ({
          id: user.id,
          name: user.full_name,
          email: user.email,
          phone: user.phone,
          role: user.role_labels ? user.role_labels.split(', ')[0] : 'Viewer',
          department: user.department,
          status: 'Active',
          icanVerified: true,
          createdAt: user.created_at
        }));
        setCmmsData(prev => ({
          ...prev,
          users: formattedUsers
        }));
        console.log('📊 Updated cmmsData.users with', formattedUsers.length, 'users');
      } else {
        console.log('ℹ️ No users found in company');
      }
    } catch (err) {
      console.error('❌ Exception loading company data from Supabase:', err);
    }
  };

  // ============================================
  // PERMISSION CHECK FUNCTION
  // ============================================
  const hasPermission = (permission) => {
    if (!isAuthorized || !userRole) return false;
    return rolePermissions[userRole]?.[permission] || false;
  };



  // ============================================
  // REQUISITION & APPROVAL WORKFLOW STATE
  // ============================================
  const [userCompanyId, setUserCompanyId] = useState(null);  // Track user's company
  const [notificationCompanyId, setNotificationCompanyId] = useState(null);  // For welcome page notifications
  const [cmmsUserId, setCmmsUserId] = useState(null);  // Track CMMS user ID for notifications
  
  const [cmmsData, setCmmsData] = useState({
    companyProfile: null,
    users: [],
    departments: [],
    workOrders: [],
    inventory: [],
    serviceProviders: [],
    maintenancePlans: [],
    requisitions: [],
    reports: []  // NEW: For role-based reports
  });

  const [activeTab, setActiveTab] = useState('company');
  const [editingUser, setEditingUser] = useState(null);
  const [newlyAddedUserId, setNewlyAddedUserId] = useState(null);  // Track newly added user for UI highlight
  
  // Profile creation form state - moved to top to avoid hook order issues
  const [profileFormData, setProfileFormData] = useState({
    companyName: '',
    companyRegistration: '',
    location: '',
    industry: '',
    phone: '',
    email: '',
    ownerName: '',
    ownerEmail: ''
  });
  const [expandWelcome, setExpandWelcome] = useState(false);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [showNewUsersList, setShowNewUsersList] = useState(false);
  const [showCompanyDetails, setShowCompanyDetails] = useState(false);
  
  // ============================================
  // NEW CMMS FEATURES - ONLY SHOW AFTER PROFILE CREATED
  // ============================================
  const [showEquipmentManager, setShowEquipmentManager] = useState(false);
  const [showWorkOrders, setShowWorkOrders] = useState(false);
  const [showInventory, setShowInventory] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [showServiceProviders, setShowServiceProviders] = useState(false);
  const [showCostTracking, setShowCostTracking] = useState(false);
  const [showComplianceLog, setShowComplianceLog] = useState(false);
  const [showMaintenanceCalendar, setShowMaintenanceCalendar] = useState(false);
  
  // Equipment data
  const [equipment, setEquipment] = useState([]);
  const [workOrders, setWorkOrders] = useState([]);
  const [sparePartsInventory, setSparePartsInventory] = useState([]);
  const [serviceProviders, setServiceProviders] = useState([]);
  const [costRecords, setCostRecords] = useState([]);
  const [complianceLog, setComplianceLog] = useState([]);


  // ============================================
  // ROLE-BASED ACCESSIBLE TABS
  // ============================================
  const getTabs = () => {
    // Define which tabs are accessible for each role
    const tabsByRole = {
      guest: ['company'],
      admin: ['company', 'users', 'inventory', 'requisitions', 'reports'],
      coordinator: ['company', 'users', 'inventory', 'requisitions', 'reports'],
      supervisor: ['company', 'inventory', 'requisitions', 'reports'],
      technician: ['company', 'inventory', 'requisitions'],
      storeman: ['inventory', 'requisitions'],
      finance: ['requisitions', 'reports'],
      'service-provider': ['requisitions', 'company']
    };
    
    return tabsByRole[userRole] || ['company'];
  };

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
  // EQUIPMENT MANAGEMENT (ONLY AFTER PROFILE CREATED)
  // ============================================
  const EquipmentManager = () => {
    const [newEquipment, setNewEquipment] = useState({
      name: '',
      type: '',
      serialNumber: '',
      location: '',
      purchaseDate: '',
      lastMaintenance: '',
      status: 'operational'
    });

    const handleAddEquipment = () => {
      if (!newEquipment.name || !newEquipment.type) {
        alert('❌ Equipment name and type are required');
        return;
      }
      setEquipment([...equipment, { ...newEquipment, id: Date.now() }]);
      setNewEquipment({ name: '', type: '', serialNumber: '', location: '', purchaseDate: '', lastMaintenance: '', status: 'operational' });
      alert('✅ Equipment added successfully');
    };

    const handleDeleteEquipment = (id) => {
      setEquipment(equipment.filter(e => e.id !== id));
      alert('✅ Equipment removed');
    };

    return (
      <div className="glass-card p-6 mt-6 border border-orange-500 border-opacity-30">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Wrench className="w-6 h-6 text-orange-400" />
          Equipment Management
        </h3>
        
        <div className="grid md:grid-cols-3 gap-3 mb-6">
          <input type="text" placeholder="Equipment Name *" value={newEquipment.name} onChange={(e) => setNewEquipment({...newEquipment, name: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="text" placeholder="Type (e.g., Pump, Motor)" value={newEquipment.type} onChange={(e) => setNewEquipment({...newEquipment, type: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="text" placeholder="Serial Number" value={newEquipment.serialNumber} onChange={(e) => setNewEquipment({...newEquipment, serialNumber: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="text" placeholder="Location" value={newEquipment.location} onChange={(e) => setNewEquipment({...newEquipment, location: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="date" value={newEquipment.purchaseDate} onChange={(e) => setNewEquipment({...newEquipment, purchaseDate: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white text-sm" />
          <select value={newEquipment.status} onChange={(e) => setNewEquipment({...newEquipment, status: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white text-sm">
            <option value="operational">Operational</option>
            <option value="maintenance">Under Maintenance</option>
            <option value="broken">Broken</option>
            <option value="retired">Retired</option>
          </select>
        </div>
        <button onClick={handleAddEquipment} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded font-semibold mb-6">+ Add Equipment</button>

        <div className="space-y-3">
          {equipment.length === 0 ? (
            <p className="text-gray-400 text-center py-4">No equipment registered yet</p>
          ) : (
            equipment.map(item => (
              <div key={item.id} className="bg-orange-500 bg-opacity-10 p-4 rounded border border-orange-500 border-opacity-30">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h4 className="text-white font-bold">{item.name}</h4>
                    <p className="text-sm text-gray-300">Type: {item.type} | Serial: {item.serialNumber}</p>
                    <p className="text-xs text-gray-400">Location: {item.location} | Status: <span className="font-semibold text-orange-300">{item.status}</span></p>
                  </div>
                  <button onClick={() => handleDeleteEquipment(item.id)} className="text-red-400 hover:text-red-300">
                    <Trash2 className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // ============================================
  // WORK ORDERS MANAGER
  // ============================================
  const WorkOrdersManager = () => {
    const [newOrder, setNewOrder] = useState({
      title: '',
      description: '',
      equipmentId: '',
      priority: 'medium',
      assignedTo: '',
      dueDate: ''
    });

    const handleCreateOrder = () => {
      if (!newOrder.title) {
        alert('❌ Work order title is required');
        return;
      }
      setWorkOrders([...workOrders, { ...newOrder, id: Date.now(), status: 'pending', createdAt: new Date() }]);
      setNewOrder({ title: '', description: '', equipmentId: '', priority: 'medium', assignedTo: '', dueDate: '' });
      alert('✅ Work order created');
    };

    return (
      <div className="glass-card p-6 mt-6 border border-red-500 border-opacity-30">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <AlertTriangle className="w-6 h-6 text-red-400" />
          Work Orders & Maintenance Tasks
        </h3>

        <div className="grid md:grid-cols-2 gap-3 mb-6">
          <input type="text" placeholder="Work Order Title *" value={newOrder.title} onChange={(e) => setNewOrder({...newOrder, title: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <select value={newOrder.priority} onChange={(e) => setNewOrder({...newOrder, priority: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white text-sm">
            <option value="low">Low Priority</option>
            <option value="medium">Medium Priority</option>
            <option value="high">High Priority</option>
            <option value="critical">Critical</option>
          </select>
          <textarea placeholder="Description" value={newOrder.description} onChange={(e) => setNewOrder({...newOrder, description: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm col-span-2" rows="2" />
          <input type="text" placeholder="Assign To" value={newOrder.assignedTo} onChange={(e) => setNewOrder({...newOrder, assignedTo: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="date" value={newOrder.dueDate} onChange={(e) => setNewOrder({...newOrder, dueDate: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white text-sm" />
        </div>
        <button onClick={handleCreateOrder} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded font-semibold mb-6">+ Create Work Order</button>

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {workOrders.length === 0 ? (
            <p className="text-gray-400 text-center py-4">No work orders yet</p>
          ) : (
            workOrders.map(order => (
              <div key={order.id} className="bg-red-500 bg-opacity-10 p-4 rounded border border-red-500 border-opacity-30">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h4 className="text-white font-bold">{order.title}</h4>
                    <p className="text-sm text-gray-300">{order.description}</p>
                    <p className="text-xs text-gray-400 mt-1">Assigned: {order.assignedTo || 'Unassigned'} | Due: {order.dueDate || 'No date'} | Priority: <span className={`font-semibold ${order.priority === 'critical' ? 'text-red-400' : 'text-orange-300'}`}>{order.priority.toUpperCase()}</span></p>
                  </div>
                  <span className="bg-red-500 text-white px-2 py-1 rounded text-xs font-bold">{order.status}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // ============================================
  // SPARE PARTS INVENTORY MANAGER
  // ============================================
  const SparePartsManager = () => {
    const [newPart, setNewPart] = useState({
      name: '',
      partNumber: '',
      quantity: 0,
      minStock: 0,
      location: '',
      supplier: '',
      cost: 0
    });

    const handleAddPart = () => {
      if (!newPart.name || !newPart.partNumber) {
        alert('❌ Part name and number are required');
        return;
      }
      setSparePartsInventory([...sparePartsInventory, { ...newPart, id: Date.now() }]);
      setNewPart({ name: '', partNumber: '', quantity: 0, minStock: 0, location: '', supplier: '', cost: 0 });
      alert('✅ Spare part added to inventory');
    };

    return (
      <div className="glass-card p-6 mt-6 border border-indigo-500 border-opacity-30">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Package className="w-6 h-6 text-indigo-400" />
          Spare Parts Inventory
        </h3>

        <div className="grid md:grid-cols-3 gap-3 mb-6">
          <input type="text" placeholder="Part Name *" value={newPart.name} onChange={(e) => setNewPart({...newPart, name: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="text" placeholder="Part Number *" value={newPart.partNumber} onChange={(e) => setNewPart({...newPart, partNumber: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="number" placeholder="Current Qty" value={newPart.quantity} onChange={(e) => setNewPart({...newPart, quantity: parseInt(e.target.value) || 0})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="number" placeholder="Min Stock Level" value={newPart.minStock} onChange={(e) => setNewPart({...newPart, minStock: parseInt(e.target.value) || 0})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="text" placeholder="Storage Location" value={newPart.location} onChange={(e) => setNewPart({...newPart, location: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="number" placeholder="Unit Cost" value={newPart.cost} onChange={(e) => setNewPart({...newPart, cost: parseFloat(e.target.value) || 0})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="text" placeholder="Supplier" value={newPart.supplier} onChange={(e) => setNewPart({...newPart, supplier: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm col-span-2" />
        </div>
        <button onClick={handleAddPart} className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded font-semibold mb-6">+ Add Spare Part</button>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-gray-300">
            <thead className="border-b border-gray-600">
              <tr>
                <th className="text-left py-2 px-2">Part Name</th>
                <th className="text-left py-2 px-2">Part #</th>
                <th className="text-center py-2 px-2">Qty</th>
                <th className="text-center py-2 px-2">Min</th>
                <th className="text-left py-2 px-2">Location</th>
                <th className="text-right py-2 px-2">Cost/Unit</th>
              </tr>
            </thead>
            <tbody>
              {sparePartsInventory.length === 0 ? (
                <tr><td colSpan="6" className="text-center py-4 text-gray-400">No spare parts in inventory</td></tr>
              ) : (
                sparePartsInventory.map(part => (
                  <tr key={part.id} className="border-b border-gray-700 hover:bg-white hover:bg-opacity-5">
                    <td className="py-2 px-2">{part.name}</td>
                    <td className="py-2 px-2">{part.partNumber}</td>
                    <td className="text-center py-2 px-2 font-bold">{part.quantity}</td>
                    <td className="text-center py-2 px-2">{part.minStock}</td>
                    <td className="py-2 px-2">{part.location}</td>
                    <td className="text-right py-2 px-2">${part.cost.toFixed(2)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ============================================
  // REPORTS & ANALYTICS MANAGER
  // ============================================
  const CMSReportsManager = () => {
    const totalEquipment = equipment.length;
    const activeOrders = workOrders.filter(o => o.status === 'pending').length;
    const lowStockItems = sparePartsInventory.filter(p => p.quantity <= p.minStock).length;
    const totalInventoryCost = sparePartsInventory.reduce((sum, p) => sum + (p.quantity * p.cost), 0);

    return (
      <div className="glass-card p-6 mt-6 border border-cyan-500 border-opacity-30">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <CheckCircle2 className="w-6 h-6 text-cyan-400" />
          Reports & Analytics
        </h3>

        <div className="grid md:grid-cols-4 gap-4 mb-6">
          <div className="bg-cyan-500 bg-opacity-10 p-4 rounded border border-cyan-500 border-opacity-30">
            <div className="text-cyan-300 text-sm font-semibold">Total Equipment</div>
            <div className="text-3xl font-bold text-white mt-2">{totalEquipment}</div>
          </div>
          <div className="bg-red-500 bg-opacity-10 p-4 rounded border border-red-500 border-opacity-30">
            <div className="text-red-300 text-sm font-semibold">Active Work Orders</div>
            <div className="text-3xl font-bold text-white mt-2">{activeOrders}</div>
          </div>
          <div className="bg-yellow-500 bg-opacity-10 p-4 rounded border border-yellow-500 border-opacity-30">
            <div className="text-yellow-300 text-sm font-semibold">Low Stock Items</div>
            <div className="text-3xl font-bold text-white mt-2">{lowStockItems}</div>
          </div>
          <div className="bg-green-500 bg-opacity-10 p-4 rounded border border-green-500 border-opacity-30">
            <div className="text-green-300 text-sm font-semibold">Inventory Value</div>
            <div className="text-2xl font-bold text-white mt-2">${totalInventoryCost.toFixed(2)}</div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white bg-opacity-5 p-4 rounded">
            <h4 className="text-white font-bold mb-2">Equipment Status</h4>
            <div className="text-gray-300 text-sm">
              {equipment.length === 0 ? 'No equipment registered' : `${equipment.length} assets in tracking system`}
            </div>
          </div>
          <div className="bg-white bg-opacity-5 p-4 rounded">
            <h4 className="text-white font-bold mb-2">Maintenance Performance</h4>
            <div className="text-gray-300 text-sm">
              Work orders created: {workOrders.length} | Pending: {activeOrders}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // SERVICE PROVIDERS MANAGER
  // ============================================
  const ServiceProvidersManager = () => {
    const [newProvider, setNewProvider] = useState({
      name: '',
      serviceType: '',
      contact: '',
      phone: '',
      email: '',
      specialization: ''
    });

    const handleAddProvider = () => {
      if (!newProvider.name || !newProvider.serviceType) {
        alert('❌ Provider name and service type are required');
        return;
      }
      setServiceProviders([...serviceProviders, { ...newProvider, id: Date.now() }]);
      setNewProvider({ name: '', serviceType: '', contact: '', phone: '', email: '', specialization: '' });
      alert('✅ Service provider added');
    };

    return (
      <div className="glass-card p-6 mt-6 border border-pink-500 border-opacity-30">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Users className="w-6 h-6 text-pink-400" />
          Maintenance Service Providers & Vendors
        </h3>

        <div className="grid md:grid-cols-3 gap-3 mb-6">
          <input type="text" placeholder="Provider Name *" value={newProvider.name} onChange={(e) => setNewProvider({...newProvider, name: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="text" placeholder="Service Type *" value={newProvider.serviceType} onChange={(e) => setNewProvider({...newProvider, serviceType: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="text" placeholder="Contact Person" value={newProvider.contact} onChange={(e) => setNewProvider({...newProvider, contact: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="tel" placeholder="Phone" value={newProvider.phone} onChange={(e) => setNewProvider({...newProvider, phone: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="email" placeholder="Email" value={newProvider.email} onChange={(e) => setNewProvider({...newProvider, email: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="text" placeholder="Specialization" value={newProvider.specialization} onChange={(e) => setNewProvider({...newProvider, specialization: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
        </div>
        <button onClick={handleAddProvider} className="px-4 py-2 bg-pink-500 hover:bg-pink-600 text-white rounded font-semibold mb-6">+ Add Service Provider</button>

        <div className="space-y-3">
          {serviceProviders.length === 0 ? (
            <p className="text-gray-400 text-center py-4">No service providers registered yet</p>
          ) : (
            serviceProviders.map(provider => (
              <div key={provider.id} className="bg-pink-500 bg-opacity-10 p-4 rounded border border-pink-500 border-opacity-30">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="text-white font-bold">{provider.name}</h4>
                    <p className="text-sm text-gray-300">Service: {provider.serviceType} | Specialization: {provider.specialization}</p>
                    <p className="text-xs text-gray-400">Contact: {provider.contact} | 📞 {provider.phone} | 📧 {provider.email}</p>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // ============================================
  // COST TRACKING MANAGER
  // ============================================
  const CostTrackingManager = () => {
    const [newCost, setNewCost] = useState({
      description: '',
      amount: 0,
      category: 'maintenance',
      date: new Date().toISOString().split('T')[0],
      supplier: ''
    });

    const handleAddCost = () => {
      if (!newCost.description || newCost.amount <= 0) {
        alert('❌ Description and amount are required');
        return;
      }
      setCostRecords([...costRecords, { ...newCost, id: Date.now() }]);
      setNewCost({ description: '', amount: 0, category: 'maintenance', date: new Date().toISOString().split('T')[0], supplier: '' });
      alert('✅ Cost record added');
    };

    const totalCosts = costRecords.reduce((sum, record) => sum + record.amount, 0);

    return (
      <div className="glass-card p-6 mt-6 border border-lime-500 border-opacity-30">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <CheckCircle className="w-6 h-6 text-lime-400" />
          Cost Tracking & Budget
        </h3>

        <div className="bg-lime-500 bg-opacity-10 p-4 rounded border border-lime-500 border-opacity-30 mb-6">
          <div className="text-lime-300 text-sm font-semibold">Total Maintenance Costs</div>
          <div className="text-3xl font-bold text-white mt-2">${totalCosts.toFixed(2)}</div>
        </div>

        <div className="grid md:grid-cols-3 gap-3 mb-6">
          <input type="text" placeholder="Description *" value={newCost.description} onChange={(e) => setNewCost({...newCost, description: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <input type="number" placeholder="Amount (USD) *" value={newCost.amount} onChange={(e) => setNewCost({...newCost, amount: parseFloat(e.target.value) || 0})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <select value={newCost.category} onChange={(e) => setNewCost({...newCost, category: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white text-sm">
            <option value="maintenance">Maintenance</option>
            <option value="repair">Repair</option>
            <option value="parts">Spare Parts</option>
            <option value="labor">Labor</option>
            <option value="other">Other</option>
          </select>
          <input type="date" value={newCost.date} onChange={(e) => setNewCost({...newCost, date: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white text-sm" />
          <input type="text" placeholder="Supplier/Vendor" value={newCost.supplier} onChange={(e) => setNewCost({...newCost, supplier: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm col-span-2" />
        </div>
        <button onClick={handleAddCost} className="px-4 py-2 bg-lime-500 hover:bg-lime-600 text-white rounded font-semibold mb-6">+ Record Cost</button>

        <div className="max-h-60 overflow-y-auto space-y-2">
          {costRecords.length === 0 ? (
            <p className="text-gray-400 text-center py-4">No cost records yet</p>
          ) : (
            costRecords.map(record => (
              <div key={record.id} className="bg-white bg-opacity-5 p-3 rounded text-sm">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-semibold text-white">{record.description}</span>
                    <p className="text-xs text-gray-400">Category: {record.category} | {record.date} | {record.supplier}</p>
                  </div>
                  <span className="font-bold text-lime-300">${record.amount.toFixed(2)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

  // ============================================
  // COMPLIANCE LOG MANAGER
  // ============================================
  const ComplianceLogManager = () => {
    const [newLog, setNewLog] = useState({
      activity: '',
      category: 'maintenance',
      date: new Date().toISOString().split('T')[0],
      performedBy: '',
      notes: ''
    });

    const handleAddLog = () => {
      if (!newLog.activity) {
        alert('❌ Activity description is required');
        return;
      }
      setComplianceLog([...complianceLog, { ...newLog, id: Date.now() }]);
      setNewLog({ activity: '', category: 'maintenance', date: new Date().toISOString().split('T')[0], performedBy: '', notes: '' });
      alert('✅ Compliance record added');
    };

    return (
      <div className="glass-card p-6 mt-6 border border-yellow-500 border-opacity-30">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <CheckCircle className="w-6 h-6 text-yellow-400" />
          Compliance & Audit Trail
        </h3>

        <div className="grid md:grid-cols-2 gap-3 mb-6">
          <input type="text" placeholder="Activity *" value={newLog.activity} onChange={(e) => setNewLog({...newLog, activity: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <select value={newLog.category} onChange={(e) => setNewLog({...newLog, category: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white text-sm">
            <option value="maintenance">Maintenance</option>
            <option value="inspection">Inspection</option>
            <option value="safety">Safety Check</option>
            <option value="training">Training</option>
            <option value="audit">Audit</option>
            <option value="other">Other</option>
          </select>
          <input type="date" value={newLog.date} onChange={(e) => setNewLog({...newLog, date: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white text-sm" />
          <input type="text" placeholder="Performed By" value={newLog.performedBy} onChange={(e) => setNewLog({...newLog, performedBy: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm" />
          <textarea placeholder="Notes & Details" value={newLog.notes} onChange={(e) => setNewLog({...newLog, notes: e.target.value})} className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm col-span-2" rows="2" />
        </div>
        <button onClick={handleAddLog} className="px-4 py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded font-semibold mb-6">+ Log Activity</button>

        <div className="max-h-60 overflow-y-auto space-y-2">
          {complianceLog.length === 0 ? (
            <p className="text-gray-400 text-center py-4">No compliance records yet</p>
          ) : (
            complianceLog.map(log => (
              <div key={log.id} className="bg-yellow-500 bg-opacity-10 p-3 rounded text-sm border-l-2 border-yellow-500">
                <div className="flex justify-between items-start">
                  <div>
                    <span className="font-semibold text-white">{log.activity}</span>
                    <p className="text-xs text-gray-400 mt-1">Category: {log.category} | {log.date} | By: {log.performedBy}</p>
                    {log.notes && <p className="text-xs text-gray-300 mt-1 italic">{log.notes}</p>}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };

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
  // REPORTS & ANALYTICS (ROLE-BASED)
  // ============================================
  const ReportsManager = () => {
    const canViewReports = hasPermission('canViewFinancials') || hasPermission('canManageUsers');

    if (!canViewReports) {
      return (
        <div className="glass-card p-6 bg-orange-500 bg-opacity-10 border-l-4 border-orange-500">
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-6 h-6 text-orange-400" />
            <div>
              <p className="text-orange-300 font-semibold">🔒 Reports Access Restricted</p>
              <p className="text-gray-400 text-sm mt-1">Your role: <span className="text-blue-300 font-bold uppercase">{userRole}</span> does not have report access.</p>
            </div>
          </div>
        </div>
      );
    }

    const generateInventoryReport = () => {
      const lowStockCount = cmmsData.inventory.filter(i => i.quantity <= i.minStock).length;
      const totalValue = cmmsData.inventory.reduce((sum, i) => sum + (i.quantity * i.cost), 0);
      
      return {
        title: 'Inventory Status Report',
        date: new Date().toLocaleDateString(),
        totalItems: cmmsData.inventory.length,
        lowStockAlerts: lowStockCount,
        totalValue: totalValue,
        averageCost: cmmsData.inventory.length > 0 ? totalValue / cmmsData.inventory.length : 0
      };
    };

    const generateRequisitionReport = () => {
      const pending = cmmsData.requisitions.filter(r => r.status.includes('pending')).length;
      const approved = cmmsData.requisitions.filter(r => r.status === 'finance-approved').length;
      const completed = cmmsData.requisitions.filter(r => r.status === 'completed').length;
      const totalCost = cmmsData.requisitions.reduce((sum, r) => sum + r.estimatedCost, 0);

      return {
        title: 'Requisition Status Report',
        date: new Date().toLocaleDateString(),
        totalRequisitions: cmmsData.requisitions.length,
        pending,
        approved,
        completed,
        totalEstimatedCost: totalCost
      };
    };

    const inventoryReport = generateInventoryReport();
    const requisitionReport = generateRequisitionReport();

    return (
      <div className="space-y-6">
        {/* Inventory Report */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Package className="w-6 h-6 text-blue-400" />
            {inventoryReport.title}
          </h3>
          <div className="grid md:grid-cols-4 gap-4">
            <div className="bg-white bg-opacity-5 p-4 rounded-lg">
              <div className="text-gray-400 text-sm">Total Items</div>
              <div className="text-3xl font-bold text-blue-300 mt-2">{inventoryReport.totalItems}</div>
            </div>
            <div className="bg-white bg-opacity-5 p-4 rounded-lg">
              <div className="text-gray-400 text-sm">Low Stock Alerts</div>
              <div className="text-3xl font-bold text-orange-300 mt-2">{inventoryReport.lowStockAlerts}</div>
            </div>
            <div className="bg-white bg-opacity-5 p-4 rounded-lg">
              <div className="text-gray-400 text-sm">Total Inventory Value</div>
              <div className="text-2xl font-bold text-green-300 mt-2">UGX {(inventoryReport.totalValue / 1000000).toFixed(1)}M</div>
            </div>
            <div className="bg-white bg-opacity-5 p-4 rounded-lg">
              <div className="text-gray-400 text-sm">Average Item Cost</div>
              <div className="text-2xl font-bold text-purple-300 mt-2">UGX {(inventoryReport.averageCost / 1000).toFixed(0)}K</div>
            </div>
          </div>
        </div>

        {/* Requisition Report */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Wrench className="w-6 h-6 text-purple-400" />
            {requisitionReport.title}
          </h3>
          <div className="grid md:grid-cols-5 gap-4">
            <div className="bg-white bg-opacity-5 p-4 rounded-lg">
              <div className="text-gray-400 text-sm">Total</div>
              <div className="text-3xl font-bold text-blue-300 mt-2">{requisitionReport.totalRequisitions}</div>
            </div>
            <div className="bg-white bg-opacity-5 p-4 rounded-lg">
              <div className="text-gray-400 text-sm">Pending</div>
              <div className="text-3xl font-bold text-yellow-300 mt-2">{requisitionReport.pending}</div>
            </div>
            <div className="bg-white bg-opacity-5 p-4 rounded-lg">
              <div className="text-gray-400 text-sm">Approved</div>
              <div className="text-3xl font-bold text-green-300 mt-2">{requisitionReport.approved}</div>
            </div>
            <div className="bg-white bg-opacity-5 p-4 rounded-lg">
              <div className="text-gray-400 text-sm">Completed</div>
              <div className="text-3xl font-bold text-green-400 mt-2">{requisitionReport.completed}</div>
            </div>
            <div className="bg-white bg-opacity-5 p-4 rounded-lg">
              <div className="text-gray-400 text-sm">Total Est. Cost</div>
              <div className="text-2xl font-bold text-green-300 mt-2">UGX {(requisitionReport.totalEstimatedCost / 1000000).toFixed(1)}M</div>
            </div>
          </div>
        </div>

        {/* Export Reports */}
        <div className="glass-card p-6">
          <h3 className="text-lg font-bold text-white mb-4">Export Reports</h3>
          <div className="flex gap-3 flex-wrap">
            <button className="px-4 py-2 bg-blue-500 bg-opacity-30 text-blue-300 rounded-lg hover:bg-opacity-50 transition-all font-semibold">
              📄 Download Inventory Report (PDF)
            </button>
            <button className="px-4 py-2 bg-purple-500 bg-opacity-30 text-purple-300 rounded-lg hover:bg-opacity-50 transition-all font-semibold">
              📄 Download Requisition Report (PDF)
            </button>
            <button className="px-4 py-2 bg-green-500 bg-opacity-30 text-green-300 rounded-lg hover:bg-opacity-50 transition-all font-semibold">
              📊 Export to Excel
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // COMPANY PROFILE MANAGEMENT (ADMIN ONLY)
  // ============================================
  const CompanyProfileManager = () => {
    // State must be declared BEFORE any conditional returns
    const [showProfileForm, setShowProfileForm] = useState(false);

    const [formData, setFormData] = useState({
      companyName: cmmsData.companyProfile?.companyName || '',
      companyRegistration: cmmsData.companyProfile?.companyRegistration || '',
      location: cmmsData.companyProfile?.location || '',
      phone: cmmsData.companyProfile?.phone || '',
      email: cmmsData.companyProfile?.email || '',
      industry: cmmsData.companyProfile?.industry || 'Manufacturing'
    });

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

    const handleSaveProfile = () => {
      setCmmsData(prev => ({
        ...prev,
        companyProfile: { ...formData, createdAt: new Date(), createdBy: userRole }
      }));
      onDataUpdate({ companyProfile: formData });
    };

    if (!cmmsData.companyProfile) {
      return (
        <div className="space-y-4">
          {/* Collapsed Icon Row */}
          <div className="flex gap-3 items-center justify-start">
            {/* Create Company Profile Icon */}
            <button
              onClick={() => setShowProfileForm(!showProfileForm)}
              className={`
                flex flex-col items-center justify-center w-20 h-20 rounded-lg
                transition-all duration-300 transform hover:scale-110
                ${showProfileForm 
                  ? 'bg-gradient-to-br from-blue-600 to-blue-800 ring-2 ring-blue-400' 
                  : 'bg-gradient-to-br from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800'
                }
              `}
              title="Create Company Profile"
            >
              <Building className="w-8 h-8 text-white mb-1" />
              <span className="text-xs text-white font-bold text-center">Company</span>
            </button>

            {/* Newly Added Users Icon */}
            <div 
              className={`
                flex flex-col items-center justify-center w-20 h-20 rounded-lg
                bg-gradient-to-br from-green-500 to-green-700 hover:from-green-600 hover:to-green-800
                transition-all duration-300 transform hover:scale-110 relative
              `}
              title="Newly Added Users"
            >
              <User className="w-8 h-8 text-white mb-1" />
              <span className="text-xs text-white font-bold text-center">New Users</span>
              {newlyAddedUserId && (
                <span className="absolute -top-2 -right-2 w-6 h-6 bg-yellow-400 text-gray-900 rounded-full text-xs font-bold flex items-center justify-center animate-pulse">
                  1
                </span>
              )}
            </div>
          </div>

          {/* Expandable Form */}
          {showProfileForm && (
            <div className="glass-card p-6 space-y-4 animate-in fade-in slide-in-from-top-4 duration-300">
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

              <div className="flex gap-3">
                <button
                  onClick={handleSaveProfile}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-green-500 text-white rounded-lg font-semibold hover:from-blue-600 hover:to-green-600 transition-all"
                >
                  ✓ Create Profile & Get Access Code
                </button>
                <button
                  onClick={() => setShowProfileForm(false)}
                  className="px-4 py-2 bg-gray-500 bg-opacity-30 text-gray-300 rounded-lg font-semibold hover:bg-opacity-50 transition-all"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
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

    const [emailSearchQuery, setEmailSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchingUsers, setSearchingUsers] = useState(false);
    const [verificationStatus, setVerificationStatus] = useState({});

    // Search ICAN users - exact function from BusinessProfileForm
    const handleSearchUsers = async (query) => {
      setEmailSearchQuery(query);
      if (query.length < 2) {
        setSearchResults([]);
        return;
      }

      setSearchingUsers(true);
      try {
        const results = await searchICANUsers(query);
        setSearchResults(results);
      } catch (error) {
        console.error('Error searching users:', error);
        setSearchResults([]);
      } finally {
        setSearchingUsers(false);
      }
    };

    // Select user from dropdown - exact function from BusinessProfileForm
    const handleSelectUser = async (user) => {
      const updatedUser = {
        ...newUser,
        name: user.name || '',
        email: user.email || '',
        phone: user.phone || newUser.phone
      };
      
      setNewUser(updatedUser);
      
      // Verify the user
      const verification = await verifyICANUser(user.email);
      if (verification.exists) {
        setVerificationStatus(prev => ({
          ...prev,
          [user.email]: { exists: true }
        }));
        console.log(`✅ User verified: ${user.name} (${user.email})`);
      }
      
      // Clear search UI
      setSearchResults([]);
      setEmailSearchQuery('');
    };

    const roles = [
      { id: 'admin', label: 'Admin', color: 'from-red-500 to-pink-600', icon: '👑' },
      { id: 'coordinator', label: 'Department Coordinator', color: 'from-blue-500 to-cyan-600', icon: '📋' },
      { id: 'supervisor', label: 'Supervisor', color: 'from-purple-500 to-indigo-600', icon: '👔' },
      { id: 'technician', label: 'Technician', color: 'from-green-500 to-emerald-600', icon: '🔧' },
      { id: 'storeman', label: 'Storeman', color: 'from-yellow-500 to-orange-600', icon: '📦' },
      { id: 'finance', label: 'Financial Officer', color: 'from-teal-500 to-cyan-600', icon: '💰' },
      { id: 'service-provider', label: 'Service Provider', color: 'from-violet-500 to-purple-600', icon: '🏢' }
    ];

    const handleAddUser = async () => {
      // User selection from dropdown is required
      if (!newUser.email) {
        alert('❌ Please search and select a user from the dropdown');
        return;
      }

      if (!newUser.name) {
        alert('❌ Please select a valid user');
        return;
      }

      if (!newUser.role) {
        alert('❌ Please select a role');
        return;
      }

      // Verify ICAN account exists
      let isVerified = verificationStatus[newUser.email]?.exists;
      if (!isVerified) {
        const verification = await verifyICANUser(newUser.email);
        if (!verification.exists) {
          alert('❌ User must have an ICAN account.\n\nPlease ask the user to:\n1. Sign up for ICAN\n2. Complete their ICAN profile\n3. Then they can be added to CMMS');
          return;
        }
      }

      // User has ICAN account - proceed to add to CMMS
      try {
        // First check if user already exists in this company
        const { data: existingUser, error: checkError } = await supabase
          .from('cmms_users')
          .select('id')
          .eq('cmms_company_id', userCompanyId)
          .eq('email', newUser.email)
          .single();

        let userId;

        if (existingUser) {
          // User already exists - just use their ID for role assignment
          console.log('ℹ️ User already exists in company, updating roles');
          userId = existingUser.id;
        } else if (checkError && checkError.code !== 'PGRST116') {
          // Unexpected error (PGRST116 means no rows found, which is expected)
          console.error('Error checking user existence:', checkError);
          alert('❌ Error checking user: ' + checkError.message);
          return;
        } else {
          // User doesn't exist - insert them
          const { data: insertedUser, error: userError } = await supabase
            .from('cmms_users')
            .insert([
              {
                cmms_company_id: userCompanyId,
                email: newUser.email,
                user_name: newUser.email.split('@')[0],
                full_name: newUser.name,
                phone: newUser.phone || null,
                department: newUser.department || null,
                job_title: newUser.role,
                is_active: true,
                status: 'active',
                ican_verified: true,
                ican_verified_at: new Date().toISOString()
              }
            ])
            .select();

          if (userError) {
            console.error('Error inserting user:', userError);
            alert('❌ Error adding user to database: ' + userError.message);
            return;
          }

          if (!insertedUser || insertedUser.length === 0) {
            alert('❌ Failed to add user to database');
            return;
          }

          userId = insertedUser[0].id;
        }

        // Get the role ID from cmms_roles
        const { data: roleData, error: roleError } = await supabase
          .from('cmms_roles')
          .select('id')
          .eq('role_name', newUser.role.toLowerCase())
          .single();

        if (roleError) {
          console.error('Error fetching role:', roleError);
          alert('❌ Error assigning role: ' + roleError.message);
          return;
        }

        // Check if role assignment already exists
        const { data: existingRole, error: checkRoleError } = await supabase
          .from('cmms_user_roles')
          .select('id')
          .eq('cmms_company_id', userCompanyId)
          .eq('cmms_user_id', userId)
          .eq('cmms_role_id', roleData.id)
          .single();

        if (!existingRole || (checkRoleError && checkRoleError.code === 'PGRST116')) {
          // Role assignment doesn't exist - create it
          const { error: assignError } = await supabase
            .from('cmms_user_roles')
            .insert([
              {
                cmms_company_id: userCompanyId,
                cmms_user_id: userId,
                cmms_role_id: roleData.id,
                is_active: true
              }
            ]);

          if (assignError && assignError.code !== '23505') { // 23505 is unique constraint error
            console.error('Error assigning role:', assignError);
            alert('⚠️ User added but role assignment failed: ' + assignError.message);
            return;
          }
        }

        // Update local state to show new user immediately
        const newUserObj = {
          id: userId,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone,
          role: newUser.role,
          department: newUser.department,
          status: 'Active',
          icanVerified: true,
          createdAt: new Date()
        };
        
        setCmmsData(prev => ({
          ...prev,
          users: [...prev.users, newUserObj]
        }));

        // Mark this user as newly added (for UI highlight)
        setNewlyAddedUserId(userId);
        
        // Remove highlight after 5 seconds
        setTimeout(() => setNewlyAddedUserId(null), 5000);

        // 📢 SEND NOTIFICATION TO NEWLY ADDED USER
        try {
          console.log(`📬 Creating notification for ${newUser.email}`);
          const { error: notifError } = await supabase
            .from('cmms_notifications')
            .insert([
              {
                cmms_user_id: userId,
                cmms_company_id: userCompanyId,
                notification_type: 'user_added_to_cmms',
                title: '✅ You\'ve been added to CMMS!',
                message: `Welcome to ${cmmsData.companyProfile?.companyName || 'the company'}! Your admin has added you as a ${newUser.role}. You can now access the CMMS dashboard and manage maintenance tasks.`,
                icon: '🎉',
                action_tab: 'users',
                action_label: `View Your Role in Users & Roles`,
                action_link: '/cmms/users',
                is_read: false,
                created_at: new Date().toISOString()
              }
            ]);

          if (notifError) {
            console.warn('⚠️ Could not save notification to database:', notifError.message);
          } else {
            console.log('✅ Notification created successfully');
          }
        } catch (err) {
          console.warn('⚠️ Error creating notification:', err);
        }

        setNewUser({ name: '', email: '', phone: '', role: 'Technician', department: '', assignedServices: [] });
        setEmailSearchQuery('');
        setSearchResults([]);
        
        // Show success message with user notification info and company profile details
        alert(`✅ User added to CMMS successfully!\n\n📬 Notification sent to ${newUser.email}\n\n🏢 Company Profile: "${cmmsData.companyProfile?.companyName || 'Your Company'}"\n🔑 Role: ${newUserObj.role}\n\nWhen they log in, they will see the company profile and their role in the Users & Roles tab.`);
      } catch (error) {
        console.error('Exception adding user:', error);
        alert('❌ Error: ' + error.message);
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
        {/* Add New User Form with Dropdown Search */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <User className="w-6 h-6 text-blue-400" />
            Add User to CMMS
          </h3>

          <div className="space-y-4">
            {/* User Search & Selection - EXACT from BusinessProfileForm */}
            <div>
              <label className="text-slate-300 text-sm block mb-2">Search ICAN User (by name or email) *</label>
              <div className="relative">
                <div className="flex items-center gap-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded px-3 py-2 focus-within:border-blue-500 focus-within:border-opacity-100">
                  <Search className="w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={emailSearchQuery}
                    onChange={(e) => handleSearchUsers(e.target.value)}
                    onBlur={() => setTimeout(() => setSearchResults([]), 300)}
                    placeholder="Type name or email to search..."
                    className="flex-1 bg-transparent text-white outline-none placeholder-gray-400"
                    autoComplete="off"
                  />
                  {searchingUsers && (
                    <Loader className="w-4 h-4 text-blue-400 animate-spin" />
                  )}
                  {searchResults.length > 0 && (
                    <span className="text-green-400 text-xs">({searchResults.length} found)</span>
                  )}
                </div>
                
                {/* Search Results Dropdown */}
                {searchResults.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-slate-700 border border-blue-500 rounded shadow-lg z-20 max-h-48 overflow-y-auto">
                    <div className="px-3 py-2 bg-slate-800 text-slate-400 text-xs border-b border-slate-600">
                      👆 Click to select and auto-fill
                    </div>
                    {searchResults.map(user => (
                      <button
                        key={user.email}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => handleSelectUser(user)}
                        className="w-full text-left px-3 py-2 hover:bg-blue-600/30 text-white border-b border-slate-600 last:border-b-0 transition flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-xs text-slate-400">{user.email}</p>
                        </div>
                        <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {/* No results message */}
                {emailSearchQuery.length >= 2 && searchResults.length === 0 && !searchingUsers && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-slate-700 border border-orange-500 rounded shadow-lg z-20 p-3">
                    <p className="text-orange-300 text-sm">⚠️ No ICAN users found matching "{emailSearchQuery}"</p>
                    <p className="text-slate-400 text-xs mt-1">The person must have an ICAN account first.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Auto-filled Name */}
            <div>
              <label className="text-slate-300 text-sm block mb-2">
                Full Name {newUser.name && <span className="text-green-400">✓ Auto-filled</span>}
              </label>
              <div className="flex items-center gap-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded px-3 py-2">
                <input
                  type="text"
                  value={newUser.name}
                  readOnly
                  placeholder="← Search and select a user first"
                  className="flex-1 bg-transparent text-white outline-none placeholder-gray-400 cursor-not-allowed"
                />
                {newUser.email && verificationStatus[newUser.email]?.exists && (
                  <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                )}
              </div>
            </div>

            {/* Show selected user email */}
            {newUser.email && (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-900/30 rounded border border-blue-500/50">
                <span className="text-blue-300 text-sm">📧 Selected: <strong>{newUser.email}</strong></span>
                <button
                  onClick={() => {
                    setNewUser({ name: '', email: '', phone: '', role: 'Technician', department: '', assignedServices: [] });
                    setEmailSearchQuery('');
                  }}
                  className="ml-auto text-red-400 hover:text-red-300 text-xs"
                >
                  ✕ Clear
                </button>
              </div>
            )}

            {/* Verification Status */}
            {newUser.email && verificationStatus[newUser.email] && (
              <div className={`flex items-center gap-2 px-3 py-2 rounded ${
                verificationStatus[newUser.email]?.exists 
                  ? 'bg-green-900/30 text-green-300' 
                  : 'bg-red-900/30 text-red-300'
              }`}>
                {verificationStatus[newUser.email]?.exists ? (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm">✓ ICAN account verified - Ready to add!</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-4 h-4" />
                    <span className="text-sm text-xs">{verificationStatus[newUser.email]?.error}</span>
                  </>
                )}
              </div>
            )}

            {/* Phone (Optional) */}
            {newUser.email && (
              <input
                type="tel"
                placeholder="Phone (optional)"
                value={newUser.phone}
                onChange={(e) => setNewUser({...newUser, phone: e.target.value})}
                className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
              />
            )}

            {/* Role Selection */}
            {newUser.email && (
              <div>
                <label className="text-white text-sm block mb-2">Role *</label>
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                  className="w-full px-3 py-2 bg-slate-700 border border-white border-opacity-20 rounded text-white font-medium focus:border-blue-500 focus:outline-none"
                >
                  {roles.map(r => (
                    <option key={r.id} value={r.id} className="bg-slate-700 text-white">
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Department - conditional */}
            {newUser.email && (newUser.role === 'coordinator' || newUser.role === 'supervisor' || newUser.role === 'technician' || newUser.role === 'storeman') && (
              <input
                type="text"
                placeholder="Department"
                value={newUser.department}
                onChange={(e) => setNewUser({...newUser, department: e.target.value})}
                className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
              />
            )}

            {/* Services - conditional */}
            {newUser.email && newUser.role === 'service-provider' && (
              <div>
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

            {/* Add Button */}
            {newUser.email && (
              <button
                onClick={handleAddUser}
                className="w-full px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Add User to CMMS
              </button>
            )}
          </div>
        </div>

        {/* Users List */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Users className="w-6 h-6 text-green-400" />
            Users & Roles ({cmmsData.users.length})
          </h3>
          <div className="space-y-3">
            {cmmsData.users.map(user => {
              const role = roles.find(r => r.id === user.role);
              const isNewlyAdded = newlyAddedUserId === user.id;
              
              return (
                <div 
                  key={user.id} 
                  className={`
                    bg-gradient-to-r ${role?.color} bg-opacity-20 border border-current border-opacity-30 
                    rounded-lg p-4 transition-all duration-500
                    ${isNewlyAdded ? 'ring-2 ring-green-400 shadow-lg shadow-green-500/50 scale-105' : 'hover:border-opacity-60'}
                  `}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-2xl">{role?.icon}</span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <div className="text-white font-bold">{user.name}</div>
                            {isNewlyAdded && (
                              <span className="px-2 py-1 bg-green-500 bg-opacity-40 text-green-200 text-xs rounded-full font-semibold animate-pulse">
                                ✨ NEW
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-300">{role?.label}</div>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400 space-y-1">
                        <div>📧 {user.email}</div>
                        {user.phone && <div>📱 {user.phone}</div>}
                        {user.department && <div>🏢 {user.department}</div>}
                        {user.icanVerified && <div className="text-green-300">✅ ICAN Verified</div>}
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
  
  // Show profile creation for guests or new users without profile
  // Allow access even without sign-in to create company profile
  // Once profile created and role set to admin, show dashboard
  if (!hasBusinessProfile || userRole === 'guest') {
    const handleCreateProfileAsGuest = async () => {
      // Validate required fields
      if (!profileFormData.companyName || !profileFormData.email) {
        alert('⚠️ Please fill in Company Name and Company Email');
        return;
      }

      setIsCreatingProfile(true);
      try {
        // Step 1: Create company profile in Supabase
        const { data: companyData, error: companyError } = await cmmsService.createCompanyProfile({
          companyName: profileFormData.companyName,
          companyRegistration: profileFormData.companyRegistration,
          location: profileFormData.location,
          industry: profileFormData.industry,
          phone: profileFormData.phone,
          email: profileFormData.email,
          website: ''
        });

        if (companyError) throw companyError;

        console.log('✅ Company created in Supabase:', companyData);

        // Step 2: Create admin user for the company
        const { data: adminUserData, error: adminError } = await cmmsService.createAdminUser(
          companyData.id,
          {
            name: profileFormData.ownerName || 'Company Owner',
            email: profileFormData.ownerEmail || profileFormData.email,
            phone: profileFormData.phone
          }
        );

        if (adminError) throw adminError;

        console.log('✅ Admin user created:', adminUserData);
        // Step 3: Store auth state in localStorage (Supabase is source of truth for profile data)
        localStorage.setItem('cmms_user_profile', 'true');
        localStorage.setItem('cmms_user_role', 'admin');
        localStorage.setItem('cmms_company_id', companyData.id);
        localStorage.setItem('cmms_company_owner', adminUserData.id);
        localStorage.setItem('cmms_user_id', adminUserData.id);

        // Step 4: Update component state with Supabase data
        setCmmsData(prev => ({
          ...prev,
          companyProfile: companyData,
          users: [adminUserData]
        }));
        
        setUserCompanyId(companyData.id);
        setCmmsUserId(adminUserData.id);
        setHasBusinessProfile(true);
        setUserRole('admin');
        setIsAuthorized(true);
        setActiveTab('company');
        
        console.log('✅ Profile created successfully, user is now admin');
        alert('🎉 Company profile created! You are now the Administrator.');
      } catch (error) {
        console.error('❌ Error creating profile:', error);
        alert('❌ Error creating company profile: ' + (error.message || 'Unknown error'));
      } finally {
        setIsCreatingProfile(false);
      }
    };

    return (
      <div className="glass-card p-8">
        {/* Welcome Header with Icons */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-8 pb-6 border-b border-white border-opacity-20">
            <div>
              <h2 className="text-2xl font-bold text-white">👋 Welcome to CMMS</h2>
              <p className="text-gray-300 text-sm mt-1">Manage your company and team</p>
            </div>
            <div className="flex items-center gap-3">
              {/* Notifications Bell */}
              {cmmsUserId && notificationCompanyId && (
                <NotificationsPanel 
                  userId={cmmsUserId} 
                  companyId={notificationCompanyId}
                  onActionClick={(tab) => {
                    console.log(`🔔 Notification action triggered, navigating to: ${tab}`);
                    setActiveTab(tab);
                  }}
                />
              )}
              {/* Commented out Show Details button */}
              {/* <button
                onClick={() => setExpandWelcome(!expandWelcome)}
                className="px-4 py-2 bg-blue-500 bg-opacity-30 hover:bg-opacity-50 text-blue-300 rounded-lg transition-all font-semibold whitespace-nowrap"
              >
                {expandWelcome ? '▼ Hide Details' : '▶ Show Details'}
              </button> */}
            </div>
          </div>

          {/* Icon Row - Main Navigation */}
          <div className="flex gap-6 items-start flex-wrap">
            {/* Company Profile Icon */}
            <div className="flex flex-col items-center">
              <button 
                onClick={() => setShowCompanyForm(!showCompanyForm)}
                className={`
                  flex flex-col items-center justify-center w-24 h-24 rounded-lg 
                  transition-all transform hover:scale-110 shadow-lg
                  ${showCompanyForm 
                    ? 'bg-gradient-to-br from-blue-600 to-blue-800 ring-2 ring-blue-400 scale-105' 
                    : 'bg-gradient-to-br from-blue-500 to-blue-700 hover:from-blue-600 hover:to-blue-800'
                  }
                `} 
                title="Create Company Profile"
              >
                <Building className="w-10 h-10 text-white mb-2" />
                <span className="text-xs text-white font-bold text-center">Company</span>
              </button>
              <span className="text-xs text-gray-400 mt-3">Profile Setup</span>
            </div>

            {/* Newly Added Users Icon */}
            <div className="flex flex-col items-center relative">
              <button
                onClick={() => setShowNewUsersList(!showNewUsersList)}
                className={`
                  flex flex-col items-center justify-center w-24 h-24 rounded-lg 
                  transition-all transform hover:scale-110 shadow-lg
                  ${showNewUsersList
                    ? 'bg-gradient-to-br from-green-600 to-green-800 ring-2 ring-green-400 scale-105'
                    : 'bg-gradient-to-br from-green-500 to-green-700 hover:from-green-600 hover:to-green-800'
                  }
                `}
                title="View Newly Added Users"
              >
                <User className="w-10 h-10 text-white mb-2" />
                <span className="text-xs text-white font-bold text-center">New Users</span>
                {cmmsData.users.length > 0 && (
                  <span className="absolute -top-3 -right-3 w-7 h-7 bg-yellow-400 text-gray-900 rounded-full text-xs font-bold flex items-center justify-center animate-pulse shadow-lg">
                    {cmmsData.users.length}
                  </span>
                )}
              </button>
              <span className="text-xs text-gray-400 mt-3">Recently Added</span>
            </div>

            {/* Admin Controls Icon */}
            <div className="flex flex-col items-center">
              <button className="flex flex-col items-center justify-center w-24 h-24 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 hover:from-purple-600 hover:to-purple-800 transition-all transform hover:scale-110 shadow-lg" title="Manage Team">
                <Users className="w-10 h-10 text-white mb-2" />
                <span className="text-xs text-white font-bold text-center">Team</span>
              </button>
              <span className="text-xs text-gray-400 mt-3">Manage Staff</span>
            </div>

            {/* ADDITIONAL FEATURES - ONLY VISIBLE AFTER PROFILE CREATED */}
            {hasBusinessProfile && (
              <>
                {/* Equipment Management Icon */}
                <div className="flex flex-col items-center">
                  <button 
                    onClick={() => setShowEquipmentManager(!showEquipmentManager)}
                    className={`
                      flex flex-col items-center justify-center w-24 h-24 rounded-lg 
                      transition-all transform hover:scale-110 shadow-lg
                      ${showEquipmentManager 
                        ? 'bg-gradient-to-br from-orange-600 to-orange-800 ring-2 ring-orange-400 scale-105' 
                        : 'bg-gradient-to-br from-orange-500 to-orange-700 hover:from-orange-600 hover:to-orange-800'
                      }
                    `}
                    title="Equipment Management"
                  >
                    <Wrench className="w-10 h-10 text-white mb-2" />
                    <span className="text-xs text-white font-bold text-center">Equipment</span>
                  </button>
                  <span className="text-xs text-gray-400 mt-3">Asset Tracking</span>
                </div>

                {/* Work Orders Icon */}
                <div className="flex flex-col items-center">
                  <button 
                    onClick={() => setShowWorkOrders(!showWorkOrders)}
                    className={`
                      flex flex-col items-center justify-center w-24 h-24 rounded-lg 
                      transition-all transform hover:scale-110 shadow-lg
                      ${showWorkOrders 
                        ? 'bg-gradient-to-br from-red-600 to-red-800 ring-2 ring-red-400 scale-105' 
                        : 'bg-gradient-to-br from-red-500 to-red-700 hover:from-red-600 hover:to-red-800'
                      }
                    `}
                    title="Work Orders"
                  >
                    <AlertTriangle className="w-10 h-10 text-white mb-2" />
                    <span className="text-xs text-white font-bold text-center">Work Orders</span>
                  </button>
                  <span className="text-xs text-gray-400 mt-3">Maintenance Tasks</span>
                </div>

                {/* Spare Parts Inventory Icon */}
                <div className="flex flex-col items-center">
                  <button 
                    onClick={() => setShowInventory(!showInventory)}
                    className={`
                      flex flex-col items-center justify-center w-24 h-24 rounded-lg 
                      transition-all transform hover:scale-110 shadow-lg
                      ${showInventory 
                        ? 'bg-gradient-to-br from-indigo-600 to-indigo-800 ring-2 ring-indigo-400 scale-105' 
                        : 'bg-gradient-to-br from-indigo-500 to-indigo-700 hover:from-indigo-600 hover:to-indigo-800'
                      }
                    `}
                    title="Spare Parts Inventory"
                  >
                    <Package className="w-10 h-10 text-white mb-2" />
                    <span className="text-xs text-white font-bold text-center">Spare Parts</span>
                  </button>
                  <span className="text-xs text-gray-400 mt-3">Inventory</span>
                </div>

                {/* Reports & Analytics Icon */}
                <div className="flex flex-col items-center">
                  <button 
                    onClick={() => setShowReports(!showReports)}
                    className={`
                      flex flex-col items-center justify-center w-24 h-24 rounded-lg 
                      transition-all transform hover:scale-110 shadow-lg
                      ${showReports 
                        ? 'bg-gradient-to-br from-cyan-600 to-cyan-800 ring-2 ring-cyan-400 scale-105' 
                        : 'bg-gradient-to-br from-cyan-500 to-cyan-700 hover:from-cyan-600 hover:to-cyan-800'
                      }
                    `}
                    title="Reports & Analytics"
                  >
                    <CheckCircle2 className="w-10 h-10 text-white mb-2" />
                    <span className="text-xs text-white font-bold text-center">Reports</span>
                  </button>
                  <span className="text-xs text-gray-400 mt-3">Analytics</span>
                </div>

                {/* Service Providers Icon */}
                <div className="flex flex-col items-center">
                  <button 
                    onClick={() => setShowServiceProviders(!showServiceProviders)}
                    className={`
                      flex flex-col items-center justify-center w-24 h-24 rounded-lg 
                      transition-all transform hover:scale-110 shadow-lg
                      ${showServiceProviders 
                        ? 'bg-gradient-to-br from-pink-600 to-pink-800 ring-2 ring-pink-400 scale-105' 
                        : 'bg-gradient-to-br from-pink-500 to-pink-700 hover:from-pink-600 hover:to-pink-800'
                      }
                    `}
                    title="Service Providers"
                  >
                    <Users className="w-10 h-10 text-white mb-2" />
                    <span className="text-xs text-white font-bold text-center">Vendors</span>
                  </button>
                  <span className="text-xs text-gray-400 mt-3">Maintenance Partners</span>
                </div>

                {/* Cost Tracking Icon */}
                <div className="flex flex-col items-center">
                  <button 
                    onClick={() => setShowCostTracking(!showCostTracking)}
                    className={`
                      flex flex-col items-center justify-center w-24 h-24 rounded-lg 
                      transition-all transform hover:scale-110 shadow-lg
                      ${showCostTracking 
                        ? 'bg-gradient-to-br from-lime-600 to-lime-800 ring-2 ring-lime-400 scale-105' 
                        : 'bg-gradient-to-br from-lime-500 to-lime-700 hover:from-lime-600 hover:to-lime-800'
                      }
                    `}
                    title="Cost Tracking"
                  >
                    <CheckCircle className="w-10 h-10 text-white mb-2" />
                    <span className="text-xs text-white font-bold text-center">Costs</span>
                  </button>
                  <span className="text-xs text-gray-400 mt-3">Budget Tracking</span>
                </div>

                {/* Compliance Log Icon */}
                <div className="flex flex-col items-center">
                  <button 
                    onClick={() => setShowComplianceLog(!showComplianceLog)}
                    className={`
                      flex flex-col items-center justify-center w-24 h-24 rounded-lg 
                      transition-all transform hover:scale-110 shadow-lg
                      ${showComplianceLog 
                        ? 'bg-gradient-to-br from-yellow-600 to-yellow-800 ring-2 ring-yellow-400 scale-105' 
                        : 'bg-gradient-to-br from-yellow-500 to-yellow-700 hover:from-yellow-600 hover:to-yellow-800'
                      }
                    `}
                    title="Compliance & Audit"
                  >
                    <CheckCircle className="w-10 h-10 text-white mb-2" />
                    <span className="text-xs text-white font-bold text-center">Compliance</span>
                  </button>
                  <span className="text-xs text-gray-400 mt-3">Audit Trail</span>
                </div>
              </>
            )}
          </div>

          {/* Company Profile Form - Expandable */}
          {showCompanyForm && (
            <div className="mb-6 bg-blue-500 bg-opacity-10 border border-blue-500 border-opacity-30 rounded-lg p-6 animate-in fade-in slide-in-from-top-4 duration-300">
              <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Building className="w-5 h-5 text-blue-400" />
                Create Your Company Profile
              </h3>
              <div className="grid md:grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Company Name *"
                  value={profileFormData.companyName}
                  onChange={(e) => setProfileFormData({...profileFormData, companyName: e.target.value})}
                  className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm"
                />
                <input
                  type="text"
                  placeholder="Registration Number"
                  value={profileFormData.companyRegistration}
                  onChange={(e) => setProfileFormData({...profileFormData, companyRegistration: e.target.value})}
                  className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm"
                />
                <input
                  type="text"
                  placeholder="Location"
                  value={profileFormData.location}
                  onChange={(e) => setProfileFormData({...profileFormData, location: e.target.value})}
                  className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm"
                />
                <select 
                  value={profileFormData.industry}
                  onChange={(e) => setProfileFormData({...profileFormData, industry: e.target.value})}
                  className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white text-sm"
                >
                  <option value="Manufacturing">Manufacturing</option>
                  <option value="Healthcare">Healthcare</option>
                  <option value="Transportation">Transportation</option>
                  <option value="Building Management">Building Management</option>
                  <option value="Industrial">Industrial</option>
                  <option value="Energy">Energy</option>
                  <option value="Other">Other</option>
                </select>
                <input
                  type="tel"
                  placeholder="Phone *"
                  value={profileFormData.phone}
                  onChange={(e) => setProfileFormData({...profileFormData, phone: e.target.value})}
                  className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm"
                />
                <input
                  type="email"
                  placeholder="Company Email *"
                  value={profileFormData.email}
                  onChange={(e) => setProfileFormData({...profileFormData, email: e.target.value})}
                  className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm"
                />
              </div>
              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleCreateProfileAsGuest}
                  disabled={isCreatingProfile}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-green-500 text-white rounded-lg font-semibold hover:from-blue-600 hover:to-green-600 transition-all text-sm disabled:opacity-50"
                >
                  {isCreatingProfile ? '⏳ Creating...' : '✓ Create Profile'}
                </button>
                <button
                  onClick={() => setShowCompanyForm(false)}
                  className="px-4 py-2 bg-gray-500 bg-opacity-30 text-gray-300 rounded-lg font-semibold hover:bg-opacity-50 transition-all text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* New Users List - Expandable */}
          {showNewUsersList && (
            <div className="mb-6 bg-green-500 bg-opacity-10 border border-green-500 border-opacity-30 rounded-lg p-6 animate-in fade-in slide-in-from-top-4 duration-300">
              {cmmsData.users.length > 0 ? (
                <>
                  <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                    <User className="w-5 h-5 text-green-400" />
                    Recently Added Users ({cmmsData.users.length})
                  </h3>
                  <div className="space-y-3 max-h-72 overflow-y-auto">
                    {cmmsData.users.map(user => (
                      <div key={user.id} className={`p-3 rounded-lg border transition-all ${
                        user.icanVerified && user.role
                          ? 'bg-green-900 bg-opacity-50 border-green-400 border-opacity-60'
                          : 'bg-yellow-900 bg-opacity-40 border-yellow-500 border-opacity-40'
                      }`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1">
                            <div className="text-white font-semibold text-sm flex items-center gap-2">
                              {user.name}
                              {user.icanVerified && user.role && (
                                <span className="text-xs bg-green-500 bg-opacity-50 text-green-100 px-2 py-0.5 rounded">✓ CMMS Active</span>
                              )}
                              {!user.icanVerified || !user.role && (
                                <span className="text-xs bg-yellow-500 bg-opacity-50 text-yellow-100 px-2 py-0.5 rounded">⚠ Pending Setup</span>
                              )}
                            </div>
                            <div className="text-green-300 text-xs mt-1">📧 {user.email}</div>
                            <div className="flex items-center gap-3 mt-2">
                              <div className={`text-xs font-semibold px-2 py-1 rounded ${
                                user.role
                                  ? 'bg-blue-600 bg-opacity-60 text-blue-100'
                                  : 'bg-gray-600 bg-opacity-40 text-gray-300'
                              }`}>
                                🔑 Role: {user.role || 'Unassigned'}
                              </div>
                              <div className={`text-xs font-semibold px-2 py-1 rounded ${
                                user.icanVerified && user.role
                                  ? 'bg-purple-600 bg-opacity-60 text-purple-100'
                                  : 'bg-gray-600 bg-opacity-40 text-gray-300'
                              }`}>
                                🚪 Dashboard: {user.icanVerified && user.role ? 'Access ✓' : 'Blocked'}
                              </div>
                            </div>
                          </div>
                          {user.phone && <div className="text-gray-400 text-xs whitespace-nowrap">📱 {user.phone}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-12">
                  <div className="text-4xl mb-3">👤</div>
                  <div className="text-white font-semibold text-lg mb-2">You are not employed yet</div>
                  <div className="text-gray-400 text-sm">Contact your company admin to add you to the CMMS system</div>
                </div>
              )}
              <button
                onClick={() => setShowNewUsersList(false)}
                className="w-full mt-4 px-4 py-2 bg-gray-500 bg-opacity-30 text-gray-300 rounded-lg font-semibold hover:bg-opacity-50 transition-all text-sm"
              >
                Close
              </button>
            </div>
          )}

          {/* RENDER NEW FEATURE MANAGERS - ONLY SHOW IF PROFILE EXISTS */}
          {hasBusinessProfile && (
            <>
              {showEquipmentManager && <EquipmentManager />}
              {showWorkOrders && <WorkOrdersManager />}
              {showInventory && <SparePartsManager />}
              {showReports && <CMSReportsManager />}
              {showServiceProviders && <ServiceProvidersManager />}
              {showCostTracking && <CostTrackingManager />}
              {showComplianceLog && <ComplianceLogManager />}
            </>
          )}
        </div>

        {/* Only show tip when user clicks Show Details */}
        {expandWelcome && (
          <div className="mb-8 bg-blue-500 bg-opacity-20 border border-blue-500 border-opacity-30 rounded-lg p-6 animate-in fade-in slide-in-from-top-4 duration-300">
            <p className="text-blue-300 text-sm mb-3">
              ✨ <span className="font-semibold">How It Works:</span> Click on any icon above to expand that section and manage your CMMS.
            </p>
            <div className="bg-blue-900 bg-opacity-50 border-l-4 border-blue-400 p-4 rounded">
              <p className="text-blue-200 text-xs">
                🔐 <strong>Security Note:</strong> Users must have an ICAN account before they can be added to CMMS. The admin will verify their ICAN profile during user assignment.
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };



  // ============================================
  // MAIN CMMS INTERFACE FOR AUTHORIZED USERS
  // ============================================
  return (
    <div className="glass-card p-6">
      {/* Compact Header with Icon */}
      <div className="flex items-center justify-between mb-8 pb-6 border-b border-white border-opacity-20">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setShowCompanyDetails(!showCompanyDetails)}
            className={`
              flex flex-col items-center justify-center w-20 h-20 rounded-lg 
              transition-all transform hover:scale-110 shadow-lg
              ${showCompanyDetails
                ? 'bg-gradient-to-br from-indigo-600 to-indigo-800 ring-2 ring-indigo-400 scale-105'
                : 'bg-gradient-to-br from-indigo-500 to-indigo-700 hover:from-indigo-600 hover:to-indigo-800'
              }
            `}
            title="Company Details"
          >
            <Building className="w-10 h-10 text-white mb-2" />
            <span className="text-xs text-white font-bold text-center">Company</span>
          </button>
          <div>
            <h2 className="text-2xl font-bold text-white">CMMS</h2>
            <p className="text-gray-300 text-sm mt-1">Management System</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Notifications Bell */}
          {userCompanyId && (
            <NotificationsPanel 
              userId={user?.id} 
              companyId={userCompanyId}
              onActionClick={(tab) => {
                console.log(`🔔 Notification action triggered, navigating to: ${tab}`);
                setActiveTab(tab);
              }}
            />
          )}
          
          <span className="bg-blue-500 bg-opacity-30 text-blue-200 px-4 py-2 rounded-full text-xs font-semibold">
            🔑 {userRole?.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Company Details Panel - Expandable */}
      {/* 
      {showCompanyDetails && (
        <div className="mb-8 bg-indigo-500 bg-opacity-10 border border-indigo-500 border-opacity-30 rounded-lg p-6 animate-in fade-in slide-in-from-top-4 duration-300">
          <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
            <Building className="w-5 h-5 text-indigo-400" />
            Company Information
          </h3>
          {cmmsData.companyProfile ? (
            <div className="grid md:grid-cols-2 gap-4">
              <div className="bg-indigo-900 bg-opacity-40 p-4 rounded-lg border border-indigo-500 border-opacity-30">
                <div className="text-indigo-300 text-xs font-semibold uppercase mb-1">Company Name</div>
                <div className="text-white font-bold text-lg">{cmmsData.companyProfile.companyName}</div>
              </div>
              {cmmsData.companyProfile.location && (
                <div className="bg-indigo-900 bg-opacity-40 p-4 rounded-lg border border-indigo-500 border-opacity-30">
                  <div className="text-indigo-300 text-xs font-semibold uppercase mb-1">📍 Location</div>
                  <div className="text-white font-bold">{cmmsData.companyProfile.location}</div>
                </div>
              )}
              {cmmsData.companyProfile.phone && (
                <div className="bg-indigo-900 bg-opacity-40 p-4 rounded-lg border border-indigo-500 border-opacity-30">
                  <div className="text-indigo-300 text-xs font-semibold uppercase mb-1">📞 Phone</div>
                  <div className="text-white font-bold">{cmmsData.companyProfile.phone}</div>
                </div>
              )}
              {cmmsData.companyProfile.email && (
                <div className="bg-indigo-900 bg-opacity-40 p-4 rounded-lg border border-indigo-500 border-opacity-30">
                  <div className="text-indigo-300 text-xs font-semibold uppercase mb-1">📧 Email</div>
                  <div className="text-white font-bold text-sm">{cmmsData.companyProfile.email}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-6 text-indigo-300">
              ⚠️ No company profile created yet. Click the Company icon in the Welcome section to create one.
            </div>
          )}
          <button
            onClick={() => setShowCompanyDetails(false)}
            className="w-full mt-4 px-4 py-2 bg-gray-500 bg-opacity-30 text-gray-300 rounded-lg font-semibold hover:bg-opacity-50 transition-all text-sm"
          >
            Close
          </button>
        </div>
      )}
      */}

      {/* Tabs - Role-Based */}
      <div className="flex gap-2 mb-6 border-b border-white border-opacity-10 overflow-x-auto">
        {[
          { id: 'company', label: '🏢 Company', icon: Building },
          { id: 'users', label: '👥 Users & Roles', icon: Users },
          { id: 'inventory', label: '📦 Inventory', icon: Package },
          { id: 'requisitions', label: '📋 Requisitions & Approvals', icon: Package },
          { id: 'reports', label: '📊 Reports', icon: Package }
        ]
          .filter(tab => getTabs().includes(tab.id))
          .map(tab => (
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
        {activeTab === 'reports' && <ReportsManager />}
      </div>
    </div>
  );
};

export default CMMSModule;

