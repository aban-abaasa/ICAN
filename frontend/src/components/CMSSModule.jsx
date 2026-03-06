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

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  CheckCircle2,
  MoreVertical,
  X,
  Clipboard
} from 'lucide-react';

// Import Supabase CMMS service
import cmmsService from '../lib/supabase/services/cmmsService';
import { supabase } from '../lib/supabase/client';
import { searchICANUsers, verifyICANUser } from '../services/pitchingService';
import NotificationsPanel from './NotificationsPanel';
import RequisitionWorkspace from './CMMS/RequisitionWorkspace.jsx';
import RequisitionApprovalsTab from './CMMS/RequisitionApprovalsTab.jsx';

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
  const [isCreator, setIsCreator] = useState(false);  // Track if user is company creator
  const [hasBusinessProfile, setHasBusinessProfile] = useState(false);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [accessDeniedReason, setAccessDeniedReason] = useState('');

  // Role-based permission matrix
  const rolePermissions = {
    guest: {
      canViewCompany: false,
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
      canViewCompany: false,
      canEditCompany: false,
      canManageUsers: true,
      canAssignRoles: true,
      canViewInventory: true,
      canEditInventory: false,
      canDeleteUsers: false,
      canViewFinancials: false,
      canManageServiceProviders: true,
      canCreateWorkOrders: true,
      canViewAllData: false,
      level: 5
    },
    supervisor: {
      canViewCompany: false,
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
      canViewCompany: false,
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
      canViewCompany: false,
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
      canViewCompany: false,
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
      canViewCompany: false,
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

  const normalizeRoleKey = (rawRole) => {
    if (!rawRole) return '';

    const roleToken = String(rawRole)
      .split(',')[0]
      .trim()
      .toLowerCase()
      .replace(/^cmms[_-]/, '')
      .replace(/[\s_]+/g, '-');

    const aliases = {
      administrator: 'admin',
      admin: 'admin',
      'department-coordinator': 'coordinator',
      coordinator: 'coordinator',
      'financial-officer': 'finance',
      'finance-officer': 'finance',
      finance: 'finance',
      supervisor: 'supervisor',
      technician: 'technician',
      storeman: 'storeman',
      'service-provider': 'service-provider',
      serviceprovider: 'service-provider',
      viewer: 'guest',
      guest: 'guest',
      assigned: 'assigned'
    };

    return aliases[roleToken] || roleToken;
  };

  const resolveUserRole = (primaryRole, roleLabels = '') => {
    let resolvedRole = normalizeRoleKey(primaryRole);

    if (!resolvedRole || resolvedRole === 'assigned' || !rolePermissions[resolvedRole]) {
      const fallbackRole = normalizeRoleKey(roleLabels);
      if (rolePermissions[fallbackRole]) {
        resolvedRole = fallbackRole;
      }
    }

    if (!resolvedRole || !rolePermissions[resolvedRole]) {
      resolvedRole = 'guest';
    }

    return resolvedRole;
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
      
      if (!user && !cachedCompanyId) {
        setAccessDeniedReason('âŒ No user logged in. Please sign in to access CMMS.');
        setIsAuthorized(false);
        return;
      }

      // If user is logged in, check if they're in the cmms_users table
      if (user?.email) {
        console.log('ðŸ” Searching for user in CMMS database:', user.email);
        
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
          console.log('âœ… User found in CMMS database:', cmmsUser.email);
          console.log('âœ… User company ID:', cmmsUser.cmms_company_id);
          
          // Save company ID to localStorage and state
          localStorage.setItem('cmms_company_id', cmmsUser.cmms_company_id);
          setUserCompanyId(cmmsUser.cmms_company_id);
          setNotificationCompanyId(cmmsUser.cmms_company_id);  // For welcome page notifications

          // Step 2: Query cmms_users_with_roles view which has built-in creator detection
          const { data: userWithRole, error: viewError } = await supabase
            .from('cmms_users_with_roles')
            .select('effective_role, role_labels, is_creator')
            .eq('id', cmmsUser.id)
            .maybeSingle();

          if (!viewError && userWithRole) {
            // Use effective_role from the view (already checks if creator in DB)
            let effectiveRole = resolveUserRole(userWithRole.effective_role, userWithRole.role_labels);
            let isUserCreator = userWithRole.is_creator || false;
            
            // Additional RPC check: Verify admin status using cmms_is_company_admin()
            try {
              const { data: isAdminResult, error: adminCheckError } = await supabase.rpc(
                'cmms_is_company_admin',
                { p_company_id: cmmsUser.cmms_company_id }
              );
              
              if (!adminCheckError && isAdminResult) {
                console.log('âœ… RPC verified: User is admin');
                effectiveRole = 'admin';
                isUserCreator = true;
              }
            } catch (rpcError) {
              console.log('â„¹ï¸ Admin RPC check skipped (not critical):', rpcError.message);
            }
            
            console.log(`ðŸ“‹ User effective role from view:`, effectiveRole);
            console.log(`ðŸ‘‘ User is creator:`, isUserCreator);
            console.log(`âœ… User authorized with effective role: ${effectiveRole}`);
            
            localStorage.setItem('cmms_user_role', effectiveRole);
            localStorage.setItem('cmms_user_is_creator', isUserCreator);
            setUserRole(effectiveRole);
            setIsCreator(isUserCreator);
            setHasBusinessProfile(true);
            setIsAuthorized(true);
            setAccessDeniedReason('');
            console.log('ðŸ”“ hasBusinessProfile set to TRUE - should load dashboard');
          } else {
            // Fallback: Check user roles the old way
            const { data: userRoles } = await supabase
              .from('cmms_user_roles')
              .select('cmms_role_id, cmms_roles(role_name)')
              .eq('cmms_user_id', cmmsUser.id)
              .eq('is_active', true);

            if (userRoles && userRoles.length > 0) {
              const roleNames = userRoles
                .map(ur => ur.cmms_roles?.role_name)
                .filter(Boolean);
              
              const primaryRole = resolveUserRole(roleNames[0], roleNames.join(', '));
              
              console.log(`ðŸ“‹ User roles found (fallback):`, roleNames);
              console.log(`âœ… User authorized with primary role: ${primaryRole}`);
              
              localStorage.setItem('cmms_user_role', primaryRole);
              setUserRole(primaryRole);
              setHasBusinessProfile(true);
              setIsAuthorized(true);
              setAccessDeniedReason('');
              console.log('ðŸ”“ hasBusinessProfile set to TRUE - should load dashboard');
            } else {
              console.log('âš ï¸ User in CMMS but no active roles assigned');
              
              // Try RPC admin check as final verification
              try {
                const { data: isAdminResult, error: adminCheckError } = await supabase.rpc(
                  'cmms_is_company_admin',
                  { p_company_id: cmmsUser.cmms_company_id }
                );
                
                if (!adminCheckError && isAdminResult) {
                  console.log('âœ… RPC verified: User is admin despite no roles showing');
                  localStorage.setItem('cmms_user_role', 'admin');
                  localStorage.setItem('cmms_user_is_creator', 'true');
                  setUserRole('admin');
                  setIsCreator(true);
                  setHasBusinessProfile(true);
                  setIsAuthorized(true);
                  setAccessDeniedReason('');
                  return;
                }
              } catch (rpcError) {
                console.log('â„¹ï¸ Admin RPC check skipped');
              }
              
              const defaultRole = 'guest';
              console.log(`ðŸ”‘ Assigning default role: ${defaultRole}`);
              localStorage.setItem('cmms_user_role', defaultRole);
              setUserRole(defaultRole);
              setHasBusinessProfile(true);
              setIsAuthorized(true);
              setAccessDeniedReason('');
              console.log('ðŸ”“ hasBusinessProfile set to TRUE - should load dashboard');
            }
          }

          // Load company data
          console.log('ðŸ“‚ Loading company data for company_id:', cmmsUser.cmms_company_id);
          await loadCompanyData(cmmsUser.cmms_company_id);  // Pass company ID directly
          return;
        } else if (user?.email) {
          // User not found in cmms_users table - check if they're a company creator
          console.log('âš ï¸ User not found in CMMS users table - checking if they are a company creator');
          
          const cachedOwnerEmail = localStorage.getItem('cmms_company_owner_email');
          const currentUserEmail = user.email.toLowerCase();
          const ownerEmailLower = cachedOwnerEmail?.toLowerCase();
          const isCreator = cachedOwnerEmail && currentUserEmail === ownerEmailLower;
          
          console.log('ðŸ” Creator check (not in cmms_users):', {
            cachedOwnerEmail,
            currentUserEmail,
            ownerEmailLower,
            isCreator,
            companyId: cachedCompanyId
          });
          
          if (isCreator && cachedCompanyId) {
            console.log('ðŸ”‘ User IS company creator (not in cmms_users) - granting admin access');
            localStorage.setItem('cmms_user_role', 'admin');
            localStorage.setItem('cmms_company_id', cachedCompanyId);
            setUserRole('admin');
            setIsCreator(true);  // Mark as creator for permission checks
            setUserCompanyId(cachedCompanyId);
            setHasBusinessProfile(true);
            setIsAuthorized(true);
            setAccessDeniedReason('');
            await loadCompanyData(cachedCompanyId);
            return;
          }
        }
      }

      // Fallback to cached data if user not in database
      // First: Check if user is a company creator
      const cachedOwnerEmail = localStorage.getItem('cmms_company_owner_email');
      if (user?.email && cachedOwnerEmail && user.email.toLowerCase() === cachedOwnerEmail.toLowerCase()) {
        // User is the company creator
        console.log('ðŸ”‘ User is company creator - using admin role');
        localStorage.setItem('cmms_user_role', 'admin');
        setUserRole('admin');
        setIsCreator(true);  // Mark as creator for permission checks
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
      
      const assignedRole = user?.assignedCmmsRole || cachedRole;
      
      // Normalize CMMS role names: CMMS_Admin -> admin, CMMS_Coordinator -> coordinator, etc.
      const normalizedRole = resolveUserRole(assignedRole);
      
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
        console.warn('âš ï¸ No company ID available - user may not be linked to company yet');
        return;
      }

      console.log('ðŸ” Loading company data for company_id:', companyIdToUse);

      // Fetch company profile from Supabase - this is the source of truth
      const { data: profile, error: profileError } = await supabase
        .from('cmms_company_profiles')
        .select('*')
        .eq('id', companyIdToUse)
        .maybeSingle();

      console.log('ðŸ” Company profile query response:', { profile, profileError });

      if (profileError) {
        console.warn('âš ï¸ Company profile query error:', profileError.message);
        // Log more details about the error
        console.warn('Error code:', profileError.code);
        console.warn('Company ID searched:', companyIdToUse);
        // Don't return - users might not have created profile yet
      } else if (profile) {
        console.log('âœ… Company profile loaded:', profile);
        console.log('âœ… Setting company name:', profile.company_name);
        setCmmsData(prev => ({
          ...prev,
          companyProfile: profile
        }));
        setUserCompanyId(profile.id);
        console.log('âœ… cmmsData.companyProfile updated in state');
      } else {
        console.warn('âš ï¸ No company profile found for ID:', companyIdToUse);
      }

      // Fetch users from cmms_users table
      const { data: users, error: usersError } = await supabase
        .from('cmms_users_with_roles')
        .select('*')
        .eq('cmms_company_id', companyIdToUse)
        .eq('is_active', true);

      if (usersError) {
        console.error('âŒ Error loading users from Supabase:', usersError);
        return;
      }

      if (users && users.length > 0) {
        console.log(`âœ… Loaded ${users.length} users from Supabase`);
        const formattedUsers = users.map(user => ({
          id: user.id,
          name: user.full_name || user.user_name || user.email?.split('@')[0] || 'User',
          email: user.email,
          phone: user.phone,
          role: resolveUserRole(user.effective_role, user.role_labels),
          department: user.department || user.department_name || '',
          department_id: user.department_id || null,
          status: 'Active',
          icanVerified: true,
          createdAt: user.created_at,
          isCreator: user.is_creator || false
        }));
        setCmmsData(prev => ({
          ...prev,
          users: formattedUsers
        }));
        
        // Check if current user is the company creator (first admin user)
        if (user?.email && userRole !== 'admin') {
          const creatorUser = users.find(u => u.is_creator === true);
          
          if (creatorUser && creatorUser.email.toLowerCase() === user.email.toLowerCase()) {
            console.log('ðŸ”‘ Current user is the company creator - upgrading to admin');
            localStorage.setItem('cmms_user_role', 'admin');
            localStorage.setItem('cmms_company_owner_email', user.email);
            localStorage.setItem('cmms_user_is_creator', 'true');
            setUserRole('admin');
            setIsCreator(true);  // Mark as creator for permission checks
          }
        }
        
        console.log('ðŸ“Š Updated cmmsData.users with', formattedUsers.length, 'users');
      } else {
        console.log('â„¹ï¸ No users found in company');
      }

      const { data: departments, error: departmentsError } = await cmmsService.getCmmsDepartments(companyIdToUse);
      if (!departmentsError) {
        setCmmsData(prev => ({
          ...prev,
          departments: departments || []
        }));
      } else {
        console.error('âŒ Error loading departments from Supabase:', departmentsError);
      }

      // Fetch inventory items from Supabase (source of truth)
      const { data: inventoryItems, error: inventoryError } = await cmmsService.getCompanyInventory(companyIdToUse);
      console.log('📊 Inventory fetch result:', { count: inventoryItems?.length, error: inventoryError, items: inventoryItems });
      
      if (!inventoryError && inventoryItems && inventoryItems.length > 0) {
        console.log(`✅ Loaded ${inventoryItems.length} inventory items from Supabase`);
        inventoryItems.forEach(item => {
          console.log(`  - ${item.item_code}: ${item.item_name} @ UGX ${item.unit_cost || item.unit_price || 'NaN'}`);
        });
        setCmmsData(prev => ({
          ...prev,
          inventory: inventoryItems
        }));
      } else if (!inventoryError) {
        console.log('⚠️ No inventory items found for this company');
        setCmmsData(prev => ({
          ...prev,
          inventory: []
        }));
      } else {
        console.error('❌ Error loading inventory from Supabase:', inventoryError);
        setCmmsData(prev => ({
          ...prev,
          inventory: []
        }));
      }
    } catch (err) {
      console.error('âŒ Exception loading company data from Supabase:', err);
    }
  };

  // ============================================
  // PERMISSION CHECK FUNCTION
  // ============================================
  const hasPermission = (permission) => {
    if (!isAuthorized || !userRole) return false;
    
    // Creators can manage users, but company profile stays admin-only.
    if (isCreator) {
      if (permission === 'canManageUsers') return true;
      if (permission === 'canAssignRoles') return true;
    }
    
    return rolePermissions[userRole]?.[permission] || false;
  };

  // ============================================
  // ROLES CONFIGURATION (SHARED - Accessible to all components)
  // ============================================
  const allRoles = [
    { id: 'admin', label: 'Admin', color: 'from-red-500 to-pink-600', icon: '👑' },
    { id: 'coordinator', label: 'Department Coordinator', color: 'from-blue-500 to-cyan-600', icon: '📋' },
    { id: 'supervisor', label: 'Supervisor', color: 'from-purple-500 to-indigo-600', icon: '👔' },
    { id: 'technician', label: 'Technician', color: 'from-green-500 to-emerald-600', icon: '🔧' },
    { id: 'storeman', label: 'Storeman', color: 'from-yellow-500 to-orange-600', icon: '📦' },
    { id: 'finance', label: 'Financial Officer', color: 'from-teal-500 to-cyan-600', icon: '💰' },
    { id: 'service-provider', label: 'Service Provider', color: 'from-violet-500 to-purple-600', icon: '🏢' }
  ];



  // ============================================
  // REQUISITION & APPROVAL WORKFLOW STATE
  // ============================================
  const [userCompanyId, setUserCompanyId] = useState(null);  // Track user's company
  const [notificationCompanyId, setNotificationCompanyId] = useState(null);  // For welcome page notifications
  
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
  
  // Calculate companyId from localStorage and user state
  const companyIdToUse = localStorage.getItem('cmms_company_id') || userCompanyId;
  
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

  useEffect(() => {
    if (!user?.email) return;
    setProfileFormData((prev) => (
      prev.email ? prev : { ...prev, email: user.email }
    ));
  }, [user?.email]);
  const [expandWelcome, setExpandWelcome] = useState(false);
  const [isCreatingProfile, setIsCreatingProfile] = useState(false);
  const [showCompanyForm, setShowCompanyForm] = useState(false);
  const [showNewUsersList, setShowNewUsersList] = useState(false);
  const [showCompanyDetails, setShowCompanyDetails] = useState(false);


  // ============================================
  // ROLE-BASED ACCESSIBLE TABS
  // ============================================
  // IMPORTANT: Role-based tab access is maintained for EVERY user
  // This means a user with 'technician' role sees only technician tabs
  // regardless if they're a company creator or just have an assigned role
  // 
  // Feature: Users can now create multiple company profiles but still maintain
  // their role-based access control. If assigned as 'technician', they only see
  // [inventory, requisitions] tabs even if they create/own a company.
  const getTabs = () => {
    // Define which tabs are accessible for each role
    // NOTE: Tab access is role-restricted, not company-restricted
    // So a technician can only see [inventory, requisitions] even if they create a company
    const tabsByRole = {
      guest: [],
      admin: ['company', 'departments', 'users', 'inventory', 'requisitions', 'approvals', 'reports'],
      coordinator: ['departments', 'users', 'inventory', 'requisitions', 'approvals', 'reports'],
      supervisor: ['inventory', 'requisitions', 'approvals', 'reports'],
      technician: ['inventory', 'requisitions'],
      storeman: ['inventory', 'requisitions'],
      finance: ['requisitions', 'approvals', 'reports'],
      'service-provider': ['requisitions', 'approvals']
    };
    
    return tabsByRole[userRole] || [];
  };

  useEffect(() => {
    if (!isAuthorized || !hasBusinessProfile) return;

    const allowedTabs = getTabs();
    if (!allowedTabs.length) return;
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0]);
    }
  }, [activeTab, hasBusinessProfile, isAuthorized, userRole, isCreator]);

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
    // Requisitions Manager State
    const [newRequisition, setNewRequisition] = useState({
      title: '',
      description: '',
      equipmentId: '',
      estimatedCost: 0,
      priority: 'normal',
      estimatedDays: 1,
      requiredByDate: '',
      items: []  // NEW: Track items to be serviced/purchased
    });
    
    const [selectedEquipment, setSelectedEquipment] = useState('');  // NEW: For equipment selector
    const [itemQuantity, setItemQuantity] = useState(1);  // NEW: For item quantity
    const [itemCost, setItemCost] = useState(0);  // NEW: For item cost
    
    const [loadingRequisitions, setLoadingRequisitions] = useState(false);
    const [isSubmittingRequisition, setIsSubmittingRequisition] = useState(false);
    const hasLoadedRequisitions = useRef(false);  // Track if already loaded to prevent blinking
    
    // Load requisitions from Supabase
    const loadRequisitionsFromSupabase = useCallback(async () => {
      console.log('🚀 loadRequisitionsFromSupabase called');
      console.log('   hasLoadedRequisitions:', hasLoadedRequisitions.current);
      
      if (hasLoadedRequisitions.current) {
        console.log('   ✓ Already loaded, returning early');
        return;
      }
      
      console.log('   📋 Starting load...');
      hasLoadedRequisitions.current = true;
      setLoadingRequisitions(true);
      
      // Safety timeout - force stop loading after 8 seconds
      const timeoutId = setTimeout(() => {
        console.warn('⚠️ Loading timeout - stopping spinner');
        setLoadingRequisitions(false);
      }, 8000);
      
      try {
        console.log('   📡 Fetching from company:', companyIdToUse);
        const { data, error } = await cmmsService.getCompanyRequisitions(companyIdToUse);
        
        clearTimeout(timeoutId);
        console.log('   ✅ Fetch returned, error:', error, 'data length:', data?.length);
        
        if (error) {
          console.error('   ❌ Fetch error:', error);
          setLoadingRequisitions(false);
          return;
        }

        // Transform Supabase data
        const transformedRequisitions = (data || []).map(req => ({
          id: req.id,
          title: req.purpose || 'Maintenance Request',
          description: req.justification || '',
          createdBy: req.requested_by_role || 'technician',
          createdByName: req.requested_by_name || 'Unknown',
          createdAt: new Date(req.requisition_date),
          status: req.status || 'pending_department_head',
          priority: req.urgency_level || 'normal',
          estimatedCost: req.total_estimated_cost || 0,
          estimatedDays: 1,
          requisitionNumber: req.requisition_number,
          budgetSufficient: req.budget_sufficient,
          approvals: {
            supervisor: req.dept_head_approved_at ? { approved: true } : null,
            coordinator: req.finance_approved_at ? { approved: true } : null,
            finance: null
          },
          assignedTechnician: null
        }));
        
        console.log(`   📊 Transformed ${transformedRequisitions.length} requisitions`);
        setCmmsData(prev => ({
          ...prev,
          requisitions: transformedRequisitions
        }));
        
        console.log('✅ Load complete');
        setLoadingRequisitions(false);
      } catch (error) {
        clearTimeout(timeoutId);
        console.error('   🔥 Exception:', error);
        setLoadingRequisitions(false);
      }
    }, [companyIdToUse]);
    
    // Fetch requisitions from Supabase when tab changes
    useEffect(() => {
      console.log('🔄 useEffect triggered - activeTab:', activeTab);
      
      if (activeTab !== 'requisitions') {
        console.log('❌ Not on requisitions tab, resetting...');
        hasLoadedRequisitions.current = false;
        return;
      }
      
      if (!companyIdToUse) {
        console.log('⚠️ No company ID available');
        return;
      }
      
      if (hasLoadedRequisitions.current) {
        console.log('✓ Already loaded, skipping');
        return;
      }
      
      console.log('▶️ Triggering load...');
      loadRequisitionsFromSupabase();
      // DO NOT include loadRequisitionsFromSupabase in deps - it causes circular updates
    }, [companyIdToUse, activeTab]);

    // NEW: Add item to requisition
    const handleAddItem = () => {
      if (!selectedEquipment || itemQuantity <= 0 || itemCost <= 0) {
        alert('⚠️ Please select equipment, set quantity and cost');
        return;
      }

      const newItem = {
        id: Date.now(),
        equipment: selectedEquipment,
        quantity: itemQuantity,
        costPerUnit: itemCost,
        totalCost: itemQuantity * itemCost
      };

      const updatedItems = [...newRequisition.items, newItem];
      const totalCost = updatedItems.reduce((sum, item) => sum + item.totalCost, 0);

      setNewRequisition(prev => ({
        ...prev,
        items: updatedItems,
        estimatedCost: totalCost
      }));

      // Reset the form
      setSelectedEquipment('');
      setItemQuantity(1);
      setItemCost(0);
    };

    // NEW: Remove item from requisition
    const handleRemoveItem = (itemId) => {
      const updatedItems = newRequisition.items.filter(item => item.id !== itemId);
      const totalCost = updatedItems.reduce((sum, item) => sum + item.totalCost, 0);

      setNewRequisition(prev => ({
        ...prev,
        items: updatedItems,
        estimatedCost: totalCost
      }));
    };

    const canCreateRequisition = ['technician', 'supervisor', 'coordinator'].includes(userRole);
    const canApproveSupervisor = userRole === 'supervisor';
    const canApproveCoordinator = userRole === 'coordinator';
    const canApproveFinance = userRole === 'finance';

    const handleCreateRequisition = async () => {
      if (!canCreateRequisition) {
        alert('❌ Only Technicians, Supervisors, and Coordinators can create requisitions.');
        return;
      }
      if (!newRequisition.title || !newRequisition.description) {
        alert('⚠️ Please fill in the Title and Description fields');
        return;
      }
      if (newRequisition.items.length === 0) {
        alert('⚠️ Please add at least one item to service or purchase');
        return;
      }
      if (newRequisition.estimatedCost <= 0) {
        alert('⚠️ Total cost must be greater than 0');
        return;
      }

      setIsSubmittingRequisition(true);
      try {
        console.log('💾 Starting requisition submission...');
        console.log('💾 Company ID:', companyIdToUse);
        console.log('💾 User ID:', user?.id);
        console.log('💾 Requisition:', newRequisition);
        
        // Get user's department (or use first available)
        const departmentId = cmmsData.departments?.[0]?.id || selectedDepartmentId;
        console.log('💾 Selected Department ID:', departmentId);
        
        if (!departmentId) {
          alert('⚠️ No department found. Please ensure you have a department assigned.');
          setIsSubmittingRequisition(false);
          return;
        }

        const { data, error } = await cmmsService.createRequisition(
          companyIdToUse,
          departmentId,
          {
            description: newRequisition.description,
            purpose: newRequisition.title,
            priority: newRequisition.priority,
            estimatedCost: newRequisition.estimatedCost,
            requiredByDate: newRequisition.requiredByDate,
            requesterName: user?.name || userRole,
            requesterEmail: user?.email || '',
            requesterRole: userRole,
            budgetSufficient: true,
            items: newRequisition.items  // NEW: Include items
          },
          user?.id
        );

        if (error) {
          console.error('❌ Error creating requisition:', error);
          alert('❌ Failed to create requisition. Please try again.');
          setIsSubmittingRequisition(false);
          return;
        }

        console.log('✅ Requisition created successfully!');
        
        // Add to local state
        const newReq = {
          id: data.id,
          title: newRequisition.title,
          description: newRequisition.description,
          createdBy: userRole,
          createdByName: user?.name || userRole,
          createdAt: new Date(),
          status: 'pending_department_head',
          priority: newRequisition.priority,
          estimatedCost: newRequisition.estimatedCost,
          estimatedDays: newRequisition.estimatedDays,
          requisitionNumber: data.requisition_number,
          budgetSufficient: data.budget_sufficient,
          items: newRequisition.items,  // NEW: Include items
          approvals: {
            supervisor: null,
            coordinator: null,
            finance: null
          },
          assignedTechnician: null
        };

        setCmmsData(prev => ({
          ...prev,
          requisitions: [newReq, ...prev.requisitions]
        }));

        // Reset form
        setNewRequisition({
          title: '',
          description: '',
          equipmentId: '',
          estimatedCost: 0,
          priority: 'normal',
          estimatedDays: 1,
          requiredByDate: '',
          items: []
        });
        
        // Reset equipment fields
        setSelectedEquipment('');
        setItemQuantity(1);
        setItemCost(0);

        alert('✅ Maintenance Requisition Created!\n\n📋 Reference: ' + data.requisition_number + '\n\n⏳ Awaiting Department Head Approval');
        setIsSubmittingRequisition(false);
      } catch (error) {
        console.error('❌ Exception creating requisition:', error);
        alert('❌ An error occurred while creating the requisition.');
        setIsSubmittingRequisition(false);
      }
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
        {/* Create Requisition Form - ALWAYS VISIBLE */}
        {canCreateRequisition && (
          <div className="glass-card p-6 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 border border-blue-500/20">
            <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
              <Plus className="w-6 h-6 text-blue-400" />
              Create Maintenance Requisition
            </h3>
            <p className="text-gray-400 text-sm mb-4">Submit a new maintenance request</p>

            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="text-xs font-semibold text-gray-300 uppercase">Requisition Title *</label>
                <input
                  type="text"
                  placeholder="e.g., Emergency AC Repair, Pump Replacement"
                  value={newRequisition.title}
                  onChange={(e) => setNewRequisition({...newRequisition, title: e.target.value})}
                  className="w-full px-3 py-2 mt-1 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 focus:bg-opacity-20 transition-all"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-300 uppercase">Priority Level</label>
                <select
                  value={newRequisition.priority}
                  onChange={(e) => setNewRequisition({...newRequisition, priority: e.target.value})}
                  className="w-full px-3 py-2 mt-1 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white focus:border-blue-400 transition-all"
                >
                  <option value="low">🟢 Low - Routine maintenance</option>
                  <option value="normal">🟡 Normal - Standard request</option>
                  <option value="urgent">🔴 Urgent - ASAP needed</option>
                  <option value="emergency">🚨 Emergency - Critical issue</option>
                </select>
              </div>
              
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-gray-300 uppercase">Work Description *</label>
                <textarea
                  placeholder="Detailed description of work needed, equipment affected, expected outcome..."
                  value={newRequisition.description}
                  onChange={(e) => setNewRequisition({...newRequisition, description: e.target.value})}
                  className="w-full px-3 py-2 mt-1 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 focus:bg-opacity-20 transition-all min-h-24"
                />
              </div>

              {/* NEW: Equipment & Items Section */}
              <div className="md:col-span-2">
                <label className="text-xs font-semibold text-gray-300 uppercase mb-3 block">🔧 Equipment/Items to Service or Purchase</label>
                
                <div className="grid md:grid-cols-4 gap-2 mb-3">
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Equipment/Item *</label>
                    <input
                      type="text"
                      placeholder="e.g., AC Compressor, Oil, Bearings"
                      value={selectedEquipment}
                      onChange={(e) => setSelectedEquipment(e.target.value)}
                      className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 transition-all text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Qty *</label>
                    <input
                      type="number"
                      placeholder="1"
                      min="1"
                      value={itemQuantity}
                      onChange={(e) => setItemQuantity(parseInt(e.target.value) || 1)}
                      className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 transition-all text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">Cost/Unit (UGX) *</label>
                    <input
                      type="number"
                      placeholder="0"
                      min="0"
                      value={itemCost}
                      onChange={(e) => setItemCost(parseFloat(e.target.value) || 0)}
                      className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 transition-all text-sm"
                    />
                  </div>
                  <div className="flex items-end">
                    <button
                      onClick={handleAddItem}
                      className="w-full px-3 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg font-bold hover:from-green-600 hover:to-green-700 transition-all text-sm"
                    >
                      ➕ Add Item
                    </button>
                  </div>
                </div>

                {/* Items List */}
                {newRequisition.items.length > 0 && (
                  <div className="mb-3 p-3 bg-white bg-opacity-5 border border-white border-opacity-10 rounded-lg">
                    <h4 className="text-xs font-semibold text-gray-300 uppercase mb-2">📋 Items to Service/Purchase ({newRequisition.items.length}):</h4>
                    <div className="space-y-2">
                      {newRequisition.items.map((item) => (
                        <div key={item.id} className="flex justify-between items-center p-2 bg-white bg-opacity-5 rounded border border-white border-opacity-10">
                          <div className="flex-1">
                            <span className="text-white font-medium">{item.equipment}</span>
                            <span className="text-gray-400 text-xs ml-2">× {item.quantity} @ UGX {item.costPerUnit.toLocaleString()} each</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-amber-400 font-bold">UGX {item.totalCost.toLocaleString()}</span>
                            <button
                              onClick={() => handleRemoveItem(item.id)}
                              className="px-2 py-1 text-xs bg-red-500/20 border border-red-400 text-red-300 rounded hover:bg-red-500/40 transition-all"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 uppercase">Estimated Cost (UGX) - Auto Calculated</label>
                <div className="mt-1">
                  <input
                    type="number"
                    placeholder="0"
                    value={newRequisition.estimatedCost}
                    disabled
                    className="w-full px-3 py-2 bg-white bg-opacity-5 border border-white border-opacity-20 rounded-lg text-amber-300 placeholder-gray-400 transition-all cursor-not-allowed"
                  />
                  {newRequisition.estimatedCost > 0 && (
                    <div className="mt-2 p-3 bg-amber-500/20 border border-amber-400 rounded text-amber-300 text-sm font-semibold">
                      💰 Total: UGX {newRequisition.estimatedCost.toLocaleString()}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-300 uppercase">Required By Date</label>
                <input
                  type="date"
                  value={newRequisition.requiredByDate}
                  onChange={(e) => setNewRequisition({...newRequisition, requiredByDate: e.target.value})}
                  className="w-full px-3 py-2 mt-1 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white focus:border-blue-400 transition-all"
                />
              </div>
            </div>

            {/* Cost Summary Before Submission */}
            <div className="mb-4 p-4 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-400/50 rounded-lg">
              <div className="flex justify-between items-center mb-2">
                <span className="text-gray-300 font-semibold">📋 Requisition Summary:</span>
                <span className="text-xs text-gray-400">Before you submit</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Title:</span>
                  <span className="text-white font-semibold">{newRequisition.title || '(Not set)'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Priority:</span>
                  <span className="text-white font-semibold capitalize">{newRequisition.priority}</span>
                </div>
                
                {/* Show items in summary */}
                {newRequisition.items.length > 0 && (
                  <div className="border-t border-white/20 pt-2 mt-2">
                    <span className="text-gray-300 font-semibold block mb-1">📦 Items: ({newRequisition.items.length})</span>
                    <div className="space-y-1 ml-2">
                      {newRequisition.items.map((item) => (
                        <div key={item.id} className="text-gray-300 text-xs">
                          • {item.equipment} × {item.quantity} = UGX {item.totalCost.toLocaleString()}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-between pt-2 border-t border-white/20">
                  <span className="text-amber-300 font-bold">💰 Total Cost Requested:</span>
                  <span className="text-amber-300 font-bold text-lg">UGX {newRequisition.estimatedCost.toLocaleString()}</span>
                </div>
              </div>
            </div>

            <button
              onClick={handleCreateRequisition}
              disabled={isSubmittingRequisition}
              className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-bold hover:from-blue-600 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmittingRequisition ? '⏳ Submitting...' : '📝 Submit Requisition for Approval'}
            </button>
          </div>
        )}

        {!canCreateRequisition && (
          <div className="glass-card p-4 bg-orange-500 bg-opacity-10 border-l-4 border-orange-500">
            <p className="text-orange-300 text-sm">
              🔒 <span className="font-semibold">View-Only Mode</span> - Only Technicians, Supervisors, and Coordinators can create requisitions.
            </p>
          </div>
        )}

        {/* Requisitions List - Independent of form */}
        {loadingRequisitions && (
          <div className="glass-card p-6 bg-cyan-500/10 border border-cyan-500/30">
            <div className="text-center py-8">
              <div className="inline-block">
                <div className="animate-spin rounded-full h-12 w-12 border border-cyan-400 border-t-transparent mx-auto mb-3"></div>
              </div>
              <p className="text-gray-400">Loading your maintenance requisitions...</p>
              <p className="text-gray-500 text-xs mt-2">This usually takes a few seconds</p>
            </div>
          </div>
        )}

        {!loadingRequisitions && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Clipboard className="w-6 h-6 text-cyan-400" />
              Maintenance Requisitions
              <span className="ml-2 px-2 py-1 bg-cyan-500 bg-opacity-30 rounded text-sm text-cyan-300">
                {cmmsData.requisitions.length}
              </span>
            </h3>
            <button
              onClick={() => {
                hasLoadedRequisitions.current = false;
                loadRequisitionsFromSupabase();
              }}
              className="px-3 py-1 text-xs bg-cyan-500/20 border border-cyan-400 text-cyan-300 rounded hover:bg-cyan-500/40 transition-all disabled:opacity-50"
              disabled={loadingRequisitions}
            >
              🔄 Refresh
            </button>
          </div>
          
          {cmmsData.requisitions.length === 0 ? (
            <div className="text-center py-8">
              <Clipboard className="w-12 h-12 text-gray-600 mx-auto mb-3 opacity-50" />
              <p className="text-gray-400 text-lg">No requisitions created yet</p>
              <p className="text-gray-500 text-sm mt-1">Create your first maintenance requisition to get started</p>
            </div>
          ) : (
            <div className="space-y-4">
              {cmmsData.requisitions.map(req => {
                const priorityConfig = {
                  low: { icon: '🟢', color: 'green', label: 'Low' },
                  normal: { icon: '🟡', color: 'yellow', label: 'Normal' },
                  urgent: { icon: '🔴', color: 'red', label: 'Urgent' },
                  emergency: { icon: '🚨', color: 'red', label: 'Emergency' }
                };
                
                const statusConfig = {
                  pending_department_head: { icon: '⏳', label: 'Pending Department Approval', color: 'yellow' },
                  pending_finance: { icon: '💰', label: 'Pending Finance Review', color: 'blue' },
                  approved: { icon: '✅', label: 'Approved & Ordered', color: 'green' },
                  completed: { icon: '🏁', label: 'Completed', color: 'green' }
                };

                const pConfig = priorityConfig[req.priority] || priorityConfig.normal;
                const sConfig = statusConfig[req.status] || statusConfig.pending_department_head;

                return (
                  <div key={req.id} className="border border-white/20 rounded-lg p-4 bg-white/5 hover:bg-white/10 transition-all">
                    {/* Header */}
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-white font-bold text-lg">{req.title}</h4>
                          <span className="text-xs bg-gray-700 text-gray-300 px-2 py-1 rounded">
                            {req.requisitionNumber || `REQ-${req.id.slice(0, 8)}`}
                          </span>
                        </div>
                        <p className="text-gray-400 text-sm">{req.description}</p>
                      </div>
                      <div className="text-right ml-4">
                        <div className="text-3xl mb-1">{sConfig.icon}</div>
                        <div className={`text-xs font-bold text-${sConfig.color}-300`}>{sConfig.label}</div>
                      </div>
                    </div>

                    {/* Details Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 pb-4 border-b border-white/10">
                      <div className="bg-white/5 p-2 rounded">
                        <div className="text-xs text-gray-400">Priority</div>
                        <div className="text-white font-semibold text-sm">{pConfig.icon} {pConfig.label}</div>
                      </div>
                      <div className="bg-white/5 p-2 rounded">
                        <div className="text-xs text-gray-400">Estimated Cost</div>
                        <div className="text-white font-semibold text-sm">UGX {req.estimatedCost.toLocaleString()}</div>
                      </div>
                      <div className="bg-white/5 p-2 rounded">
                        <div className="text-xs text-gray-400">Requested By</div>
                        <div className="text-white font-semibold text-sm">{req.createdByName}</div>
                      </div>
                      <div className="bg-white/5 p-2 rounded">
                        <div className="text-xs text-gray-400">Date Created</div>
                        <div className="text-white font-semibold text-sm">{new Date(req.createdAt).toLocaleDateString()}</div>
                      </div>
                    </div>

                    {/* Items List */}
                    {req.items && req.items.length > 0 && (
                      <div className="mb-4 pb-4 border-b border-white/10">
                        <div className="text-xs text-gray-400 mb-2">📦 Items to Service/Purchase:</div>
                        <div className="space-y-1">
                          {req.items.map((item) => (
                            <div key={item.id} className="text-xs text-gray-300 pl-2">
                              • <span className="text-white font-medium">{item.equipment}</span> × {item.quantity} @ UGX {item.costPerUnit?.toLocaleString() || 0} = <span className="text-amber-300 font-bold">UGX {item.totalCost?.toLocaleString() || 0}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Approval Status */}
                    <div className="mb-4 pb-4 border-b border-white/10">
                      <div className="text-xs text-gray-400 mb-2">Approval Chain:</div>
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <div className={`px-3 py-1 rounded bg-${req.approvals?.supervisor ? 'green' : 'gray'}-500 bg-opacity-30 text-${req.approvals?.supervisor ? 'green' : 'gray'}-300`}>
                          👔 Dept Head {req.approvals?.supervisor ? '✓' : '⏳'}
                        </div>
                        <span className="text-gray-600">→</span>
                        <div className={`px-3 py-1 rounded bg-${req.approvals?.coordinator ? 'green' : 'gray'}-500 bg-opacity-30 text-${req.approvals?.coordinator ? 'green' : 'gray'}-300`}>
                          💼 Finance {req.approvals?.coordinator ? '✓' : '⏳'}
                        </div>
                        <span className="text-gray-600">→</span>
                        <div className={`px-3 py-1 rounded ${req.status === 'approved' || req.status === 'completed' ? 'bg-green-500 bg-opacity-30 text-green-300' : 'bg-gray-500 bg-opacity-30 text-gray-300'}`}>
                          🎯 Execute {req.status === 'approved' || req.status === 'completed' ? '✓' : '⏳'}
                        </div>
                      </div>
                    </div>

                    {/* Budget Status */}
                    {req.budgetSufficient !== undefined && (
                      <div className={`text-xs px-3 py-2 rounded ${req.budgetSufficient ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                        {req.budgetSufficient ? '✅ Budget Available' : '❌ Budget Insufficient - May require additional approval'}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}
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
        <div className="glass-card p-4 md:p-6 bg-orange-500 bg-opacity-10 border-l-4 border-orange-500">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-orange-300 font-semibold text-sm md:text-base">🔒 Reports Access Restricted</p>
              <p className="text-gray-400 text-xs md:text-sm mt-1">Your role: <span className="text-blue-300 font-bold uppercase">{userRole}</span> does not have report access.</p>
            </div>
          </div>
        </div>
      );
    }

    const generateInventoryReport = () => {
      const lowStockCount = cmmsData.inventory.filter(i => i.quantity_in_stock <= (i.reorder_level || 0)).length;
      const totalValue = cmmsData.inventory.reduce((sum, i) => {
        const quantity = i.quantity_in_stock || 0;
        const price = i.unit_price || 0;
        return sum + (quantity * price);
      }, 0);
      
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
      <div className="space-y-4 md:space-y-6">
        {/* Inventory Report */}
        <div className="glass-card p-4 md:p-6">
          <h3 className="text-lg md:text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 md:w-6 md:h-6 text-blue-400" />
            {inventoryReport.title}
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
            <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded-lg">
              <div className="text-gray-400 text-xs md:text-sm">Total Items</div>
              <div className="text-2xl md:text-3xl font-bold text-blue-300 mt-2">{inventoryReport.totalItems}</div>
            </div>
            <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded-lg">
              <div className="text-gray-400 text-xs md:text-sm">Low Stock Alerts</div>
              <div className="text-2xl md:text-3xl font-bold text-orange-300 mt-2">{inventoryReport.lowStockAlerts}</div>
            </div>
            <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded-lg">
              <div className="text-gray-400 text-xs md:text-sm">Total Inventory Value</div>
              <div className="text-xl md:text-2xl font-bold text-green-300 mt-2">UGX {(inventoryReport.totalValue / 1000000).toFixed(1)}M</div>
            </div>
            <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded-lg">
              <div className="text-gray-400 text-xs md:text-sm">Average Item Cost</div>
              <div className="text-xl md:text-2xl font-bold text-purple-300 mt-2">UGX {(inventoryReport.averageCost / 1000).toFixed(0)}K</div>
            </div>
          </div>
        </div>

        {/* Requisition Report */}
        <div className="glass-card p-4 md:p-6">
          <h3 className="text-lg md:text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Wrench className="w-5 h-5 md:w-6 md:h-6 text-purple-400" />
            {requisitionReport.title}
          </h3>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 md:gap-4">
            <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded-lg">
              <div className="text-gray-400 text-xs md:text-sm">Total</div>
              <div className="text-2xl md:text-3xl font-bold text-blue-300 mt-2">{requisitionReport.totalRequisitions}</div>
            </div>
            <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded-lg">
              <div className="text-gray-400 text-xs md:text-sm">Pending</div>
              <div className="text-2xl md:text-3xl font-bold text-yellow-300 mt-2">{requisitionReport.pending}</div>
            </div>
            <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded-lg">
              <div className="text-gray-400 text-xs md:text-sm">Approved</div>
              <div className="text-2xl md:text-3xl font-bold text-green-300 mt-2">{requisitionReport.approved}</div>
            </div>
            <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded-lg">
              <div className="text-gray-400 text-xs md:text-sm">Completed</div>
              <div className="text-2xl md:text-3xl font-bold text-green-400 mt-2">{requisitionReport.completed}</div>
            </div>
            <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded-lg">
              <div className="text-gray-400 text-xs md:text-sm">Total Est. Cost</div>
              <div className="text-xl md:text-2xl font-bold text-green-300 mt-2">UGX {(requisitionReport.totalEstimatedCost / 1000000).toFixed(1)}M</div>
            </div>
          </div>
        </div>

        {/* Export Reports */}
        <div className="glass-card p-4 md:p-6">
          <h3 className="text-base md:text-lg font-bold text-white mb-4">Export Reports</h3>
          <div className="flex gap-2 md:gap-3 flex-wrap">
            <button className="px-3 md:px-4 py-2 bg-blue-500 bg-opacity-30 text-blue-300 rounded-lg hover:bg-opacity-50 transition-all font-semibold text-xs md:text-sm">
              📄 Download Inventory Report (PDF)
            </button>
            <button className="px-3 md:px-4 py-2 bg-purple-500 bg-opacity-30 text-purple-300 rounded-lg hover:bg-opacity-50 transition-all font-semibold text-xs md:text-sm">
              📄 Download Requisition Report (PDF)
            </button>
            <button className="px-3 md:px-4 py-2 bg-green-500 bg-opacity-30 text-green-300 rounded-lg hover:bg-opacity-50 transition-all font-semibold text-xs md:text-sm">
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
    const [showProfileForm, setShowProfileForm] = useState(false);
    const [isEditingProfile, setIsEditingProfile] = useState(false);
    const [isSavingProfile, setIsSavingProfile] = useState(false);
    const [isSavingDepartment, setIsSavingDepartment] = useState(false);
    const [profileError, setProfileError] = useState('');
    const [departmentError, setDepartmentError] = useState('');

    // Department templates by industry
    const departmentsByIndustry = {
      Manufacturing: [
        { name: 'Production', description: 'Manufacturing and production floor' },
        { name: 'Maintenance', description: 'Equipment and facility maintenance' },
        { name: 'Quality Assurance', description: 'Quality control and assurance' },
        { name: 'Operations', description: 'Daily operations management' },
        { name: 'Warehouse', description: 'Inventory and storage' },
      ],
      Healthcare: [
        { name: 'Operations', description: 'Daily operations management' },
        { name: 'Maintenance', description: 'Facility and equipment maintenance' },
        { name: 'Facilities', description: 'Building and grounds maintenance' },
        { name: 'Administration', description: 'Administrative operations' },
      ],
      Transportation: [
        { name: 'Fleet Management', description: 'Vehicle and fleet maintenance' },
        { name: 'Operations', description: 'Daily operations' },
        { name: 'Maintenance', description: 'Equipment maintenance' },
        { name: 'Logistics', description: 'Logistics and supply chain' },
      ],
      'Building Management': [
        { name: 'Maintenance', description: 'Building and facility maintenance' },
        { name: 'Operations', description: 'Daily operations' },
        { name: 'Security', description: 'Security and access control' },
        { name: 'Facilities', description: 'Facilities management' },
      ],
      Industrial: [
        { name: 'Production', description: 'Manufacturing and production' },
        { name: 'Maintenance', description: 'Equipment maintenance' },
        { name: 'Safety', description: 'Safety and compliance' },
        { name: 'Operations', description: 'Daily operations' },
      ],
      Energy: [
        { name: 'Operations', description: 'Energy operations' },
        { name: 'Maintenance', description: 'Equipment and system maintenance' },
        { name: 'Safety', description: 'Safety and environmental compliance' },
        { name: 'Support', description: 'Technical support' },
      ],
      Other: [
        { name: 'Operations', description: 'Daily operations' },
        { name: 'Maintenance', description: 'General maintenance' },
        { name: 'Administration', description: 'Administrative operations' },
      ]
    };

    const mapProfileToForm = (profile) => ({
      companyName: profile?.company_name || profile?.companyName || '',
      companyRegistration: profile?.company_registration || profile?.companyRegistration || '',
      location: profile?.location || '',
      phone: profile?.phone || '',
      email: profile?.email || '',
      industry: profile?.industry || 'Manufacturing',
      website: profile?.website || ''
    });

    const [formData, setFormData] = useState(mapProfileToForm(cmmsData.companyProfile));
    const [selectedDepartments, setSelectedDepartments] = useState([]);
    const [departmentForm, setDepartmentForm] = useState({
      department_name: '',
      description: '',
      location: ''
    });

    useEffect(() => {
      setFormData(mapProfileToForm(cmmsData.companyProfile));
      setSelectedDepartments([]);
      setDepartmentForm({ department_name: '', description: '', location: '' });
    }, [cmmsData.companyProfile]);

    // Strict: Only Admin can manage company profile
    if (!hasPermission('canEditCompany')) {
      return (
        <div className="glass-card p-4 md:p-6 bg-orange-500 bg-opacity-10 border-l-4 border-orange-500">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-orange-300 font-semibold text-sm md:text-base">Access Restricted</p>
              <p className="text-gray-400 text-xs md:text-sm mt-1">Only Administrators can view and edit company details. Your role: <span className="text-blue-300 font-bold uppercase">{userRole}</span></p>
            </div>
          </div>
        </div>
      );
    }

    const handleSaveProfile = async () => {
      setIsSavingProfile(true);
      setProfileError('');
      setDepartmentError('');

      try {
        // VALIDATE: At least one department is REQUIRED
        if (selectedDepartments.length === 0) {
          setDepartmentError('Please add at least one department before saving.');
          setIsSavingProfile(false);
          return;
        }

        let savedProfile;
        let savedDepartments = [];

        if (isEditingProfile && cmmsData.companyProfile?.id) {
          console.log('📝 Editing existing company:', cmmsData.companyProfile.id);
          // EDIT EXISTING: Update company profile
          const updateResponse = await cmmsService.updateCompanyProfile(cmmsData.companyProfile.id, formData);
          if (updateResponse.error) throw updateResponse.error;

          savedProfile = updateResponse.data;

          // For existing company, create new departments separately
          for (const dept of selectedDepartments) {
            const deptResult = await cmmsService.createCmmsDepartment(cmmsData.companyProfile.id, {
              department_name: dept.name || dept.department_name,
              description: dept.description || '',
              location: ''
            });
            if (deptResult.error) {
              throw new Error(`Failed to create department "${dept.name}": ${deptResult.error.message}`);
            }
          }

          // Reload departments list
          const { data: depts, error: listError } = await cmmsService.getCmmsDepartments(cmmsData.companyProfile.id);
          if (listError) throw listError;
          savedDepartments = depts || [];

          console.log('✅ Company profile updated with new departments');
        } else {
          console.log('🆕 Creating new company with departments:', selectedDepartments);
          // CREATE NEW: Use atomic function that creates company + departments together
          const createResponse = await cmmsService.createCompanyWithDepartments(
            formData, 
            selectedDepartments
          );
          
          if (createResponse.error) {
            console.error('❌ Error creating company with departments:', createResponse.error);
            throw createResponse.error;
          }

          savedProfile = createResponse.data?.company;
          savedDepartments = createResponse.data?.departments || [];

          console.log('✅ New company created with departments:', {
            companyId: savedProfile?.id,
            departmentCount: savedDepartments.length,
            departments: savedDepartments.map(d => d.department_name)
          });
        }

        if (savedProfile?.id) {
          localStorage.setItem('cmms_company_id', savedProfile.id);
          setUserCompanyId(savedProfile.id);
          setNotificationCompanyId(savedProfile.id);
        }

        setCmmsData(prev => ({
          ...prev,
          companyProfile: savedProfile || prev.companyProfile,
          departments: savedDepartments
        }));

        setSelectedDepartments([]);
        setShowProfileForm(false);
        setIsEditingProfile(false);
        if (onDataUpdate && typeof onDataUpdate === 'function') {
          onDataUpdate({ companyProfile: savedProfile || formData });
        }

        await loadCompanyData(savedProfile?.id || cmmsData.companyProfile?.id || userCompanyId);
      } catch (error) {
        console.error('❌ Profile save error:', error);
        setProfileError(error.message || 'Failed to save company profile');
      } finally {
        setIsSavingProfile(false);
      }
    };

    const handleRegisterDepartment = async () => {
      if (!cmmsData.companyProfile?.id) {
        setDepartmentError('Create or load a company profile first.');
        return;
      }

      if (!departmentForm.department_name.trim()) {
        setDepartmentError('Department name is required.');
        return;
      }

      setIsSavingDepartment(true);
      setDepartmentError('');
      try {
        const { error } = await cmmsService.createCmmsDepartment(cmmsData.companyProfile.id, departmentForm);
        if (error) throw error;

        const { data: depts, error: listError } = await cmmsService.getCmmsDepartments(cmmsData.companyProfile.id);
        if (listError) throw listError;

        setCmmsData(prev => ({
          ...prev,
          departments: depts || []
        }));

        setDepartmentForm({ department_name: '', description: '', location: '' });
      } catch (error) {
        setDepartmentError(error.message || 'Failed to register department');
      } finally {
        setIsSavingDepartment(false);
      }
    };

    const profile = cmmsData.companyProfile;
    const displayProfile = {
      companyName: profile?.company_name || profile?.companyName || '',
      companyRegistration: profile?.company_registration || profile?.companyRegistration || '',
      location: profile?.location || '',
      email: profile?.email || '',
      phone: profile?.phone || ''
    };

    const departments = cmmsData.departments || [];

    if (!profile && !showProfileForm) {
      return (
        <div className="glass-card p-4 md:p-6 space-y-4">
          <h3 className="text-lg md:text-xl font-bold text-white">Company Profile</h3>
          <p className="text-gray-300 text-sm">Create your company profile to continue.</p>
          <button
            onClick={() => setShowProfileForm(true)}
            className="px-4 py-2 bg-gradient-to-r from-blue-500 to-green-500 text-white rounded-lg font-semibold hover:from-blue-600 hover:to-green-600 transition-all text-sm"
          >
            Create Company Profile
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        {(showProfileForm || isEditingProfile || !profile) && (
          <div className="glass-card p-4 md:p-6 space-y-4">
            <h3 className="text-lg md:text-xl font-bold text-white">{profile ? '🏢 Edit Company Profile' : '🏢 Create Company Profile'}</h3>

            {profileError && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
                {profileError}
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {/* Company Name */}
              <div className="space-y-1.5">
                <label className="block text-gray-300 text-sm font-semibold">Company Name *</label>
                <input
                  type="text"
                  placeholder="Enter company name"
                  value={formData.companyName}
                  onChange={(e) => setFormData({ ...formData, companyName: e.target.value })}
                  className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-500 text-sm focus:border-blue-500 focus:border-opacity-50 outline-none"
                />
              </div>

              {/* Registration Number */}
              <div className="space-y-1.5">
                <label className="block text-gray-300 text-sm font-semibold">Registration Number</label>
                <input
                  type="text"
                  placeholder="e.g., TIN-123456789"
                  value={formData.companyRegistration}
                  onChange={(e) => setFormData({ ...formData, companyRegistration: e.target.value })}
                  className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-500 text-sm focus:border-blue-500 focus:border-opacity-50 outline-none"
                />
              </div>

              {/* Location */}
              <div className="space-y-1.5">
                <label className="block text-gray-300 text-sm font-semibold">Location</label>
                <input
                  type="text"
                  placeholder="City, Country"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-500 text-sm focus:border-blue-500 focus:border-opacity-50 outline-none"
                />
              </div>

              {/* Phone */}
              <div className="space-y-1.5">
                <label className="block text-gray-300 text-sm font-semibold">Phone *</label>
                <input
                  type="tel"
                  placeholder="+1 (555) 000-0000"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-500 text-sm focus:border-blue-500 focus:border-opacity-50 outline-none"
                />
              </div>

              {/* Email */}
              <div className="space-y-1.5">
                <label className="block text-gray-300 text-sm font-semibold">Email *</label>
                <input
                  type="email"
                  placeholder="contact@company.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-500 text-sm focus:border-blue-500 focus:border-opacity-50 outline-none"
                />
              </div>

              {/* Department Input - Moved Here */}
              <div className="space-y-3 md:col-span-2 bg-blue-500 bg-opacity-10 border border-blue-500 border-opacity-30 rounded-lg p-4">
                <h4 className="text-sm font-bold text-white mb-2">🏭 Add Departments <span className="text-red-400 text-xs">(Required)</span></h4>
                <p className="text-gray-400 text-xs mb-3">Create your own departments manually.</p>

                {departmentError && (
                  <div className="p-2 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-xs">
                    {departmentError}
                  </div>
                )}

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="e.g., Maintenance, Operations, Production"
                    value={departmentForm.department_name}
                    onChange={(e) => setDepartmentForm({ ...departmentForm, department_name: e.target.value })}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && departmentForm.department_name.trim()) {
                        setSelectedDepartments([...selectedDepartments, {
                          name: departmentForm.department_name,
                          description: departmentForm.description
                        }]);
                        setDepartmentForm({ department_name: '', description: '', location: '' });
                      }
                    }}
                    className="flex-1 px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-500 text-sm focus:border-blue-500 focus:border-opacity-50 outline-none"
                  />
                  <button
                    onClick={() => {
                      if (departmentForm.department_name.trim()) {
                        setSelectedDepartments([...selectedDepartments, {
                          name: departmentForm.department_name,
                          description: departmentForm.description
                        }]);
                        setDepartmentForm({ department_name: '', description: '', location: '' });
                      }
                    }}
                    className="px-3 py-2 bg-blue-500 bg-opacity-40 text-blue-100 rounded-lg font-semibold hover:bg-opacity-60 transition-all text-sm whitespace-nowrap"
                  >
                    + Add
                  </button>
                </div>

                <input
                  type="text"
                  placeholder="e.g., Equipment and facility maintenance"
                  value={departmentForm.description}
                  onChange={(e) => setDepartmentForm({ ...departmentForm, description: e.target.value })}
                  onKeyPress={(e) => {
                    if (e.key === 'Enter' && departmentForm.department_name.trim()) {
                      setSelectedDepartments([...selectedDepartments, {
                        name: departmentForm.department_name,
                        description: departmentForm.description
                      }]);
                      setDepartmentForm({ department_name: '', description: '', location: '' });
                    }
                  }}
                  className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-500 text-sm focus:border-blue-500 focus:border-opacity-50 outline-none"
                />

                {/* Selected Departments Preview */}
                {selectedDepartments.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-white border-opacity-20 space-y-1">
                    <div className="text-gray-300 text-xs font-semibold">Selected ({selectedDepartments.length})</div>
                    <div className="space-y-1">
                      {selectedDepartments.map((dept, idx) => (
                        <div key={idx} className="bg-green-500 bg-opacity-20 border border-green-500 border-opacity-30 rounded px-2 py-1 flex items-center justify-between text-xs">
                          <div>
                            <div className="text-white font-semibold">{dept.name}</div>
                            {dept.description && <div className="text-gray-400 text-xs">{dept.description}</div>}
                          </div>
                          <button
                            onClick={() => setSelectedDepartments(selectedDepartments.filter((_, i) => i !== idx))}
                            className="text-red-400 hover:text-red-300 transition-colors p-0.5 ml-2"
                            title="Remove"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2 md:gap-3">
              <button
                onClick={handleSaveProfile}
                disabled={isSavingProfile}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-green-500 text-white rounded-lg font-semibold hover:from-blue-600 hover:to-green-600 transition-all text-sm disabled:opacity-50"
              >
                {isSavingProfile ? 'Saving...' : profile ? 'Save Profile Changes' : 'Create Profile'}
              </button>
              {profile && (
                <button
                  onClick={() => {
                    setShowProfileForm(false);
                    setIsEditingProfile(false);
                    setProfileError('');
                    setDepartmentError('');
                    setSelectedDepartments([]);
                    setFormData(mapProfileToForm(cmmsData.companyProfile));
                  }}
                  className="px-4 py-2 bg-gray-500 bg-opacity-30 text-gray-300 rounded-lg font-semibold hover:bg-opacity-50 transition-all text-sm"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        {profile && !showProfileForm && !isEditingProfile && (
          <div className="glass-card p-4 md:p-6">
            <h3 className="text-lg md:text-xl font-bold text-white mb-4">📋 Company Profile</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 mb-6">
              <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded">
                <div className="text-gray-400 text-xs md:text-sm">Company Name</div>
                <div className="text-white font-bold text-sm md:text-base">{displayProfile.companyName}</div>
              </div>
              <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded">
                <div className="text-gray-400 text-xs md:text-sm">Registration</div>
                <div className="text-white font-bold text-sm md:text-base">{displayProfile.companyRegistration}</div>
              </div>
              <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded">
                <div className="text-gray-400 text-xs md:text-sm">Location</div>
                <div className="text-white font-bold text-sm md:text-base">{displayProfile.location}</div>
              </div>
              <div className="bg-white bg-opacity-5 p-3 md:p-4 rounded">
                <div className="text-gray-400 text-xs md:text-sm">Email</div>
                <div className="text-white font-bold text-sm md:text-base break-all">{displayProfile.email}</div>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => {
                  setIsEditingProfile(true);
                  setShowProfileForm(true);
                  setProfileError('');
                  setDepartmentError('');
                  setFormData(mapProfileToForm(cmmsData.companyProfile));
                  setDepartmentForm({ department_name: '', description: '', location: '' });
                  setSelectedDepartments([]);
                }}
                className="flex-1 px-4 py-2 bg-orange-500 bg-opacity-30 text-orange-300 rounded-lg hover:bg-opacity-40 transition-all text-sm font-semibold"
              >
                ✏️ Edit Profile
              </button>
              <button
                onClick={() => {
                  setShowProfileForm(true);
                  setIsEditingProfile(false);
                  setFormData({ companyName: '', companyRegistration: '', location: '', phone: '', email: '', industry: 'Manufacturing' });
                  setDepartmentForm({ department_name: '', description: '', location: '' });
                  setSelectedDepartments([]);
                  setProfileError('');
                  setDepartmentError('');
                }}
                className="flex-1 px-4 py-2 bg-green-500 bg-opacity-30 text-green-300 rounded-lg hover:bg-opacity-40 transition-all text-sm font-semibold"
              >
                ➕ Create Another Company
              </button>
            </div>

            {/* View Departments */}
            {departments.length > 0 && (
              <div className="mt-4 pt-4 border-t border-white border-opacity-20">
                <h4 className="text-sm font-bold text-gray-300 mb-3">🏭 Departments ({departments.length})</h4>
                <div className="space-y-2">
                  {departments.map(dept => (
                    <div key={dept.id} className="bg-white bg-opacity-5 border border-white border-opacity-10 rounded px-3 py-2">
                      <div className="text-white text-sm font-semibold">{dept.department_name}</div>
                      {(dept.location || dept.description) && (
                        <div className="text-gray-400 text-xs mt-1">{[dept.location, dept.description].filter(Boolean).join(' • ')}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // ============================================
  // USER ROLE MANAGEMENT (ADMIN ONLY)
  // ============================================
  const UserRoleManager = () => {
    const isAdminUser = userRole === 'admin' || isCreator;

    // Strict: Only Admin (or creator treated as admin) can manage users and assign roles
    if (!isAdminUser) {
      return (
        <div className="space-y-4">
          <div className="glass-card p-4 md:p-6 bg-orange-500 bg-opacity-10 border-l-4 border-orange-500">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <AlertTriangle className="w-5 h-5 sm:w-6 sm:h-6 text-orange-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-orange-300 font-semibold text-sm md:text-base">🔒 User Management Restricted</p>
                <p className="text-gray-400 text-xs md:text-sm mt-1">Only Administrators can manage users and assign roles. Your role: <span className="text-blue-300 font-bold uppercase">{userRole}</span></p>
              </div>
            </div>
          </div>
          
          {/* View-only user list for authorized roles */}
          {hasPermission('canViewCompany') && (
            <div className="glass-card p-4 md:p-6">
              <h3 className="text-base md:text-lg font-bold text-white mb-4 flex items-center gap-2">
                <Users className="w-4 h-4 md:w-5 md:h-5 text-blue-400" />
                Team Members (View Only)
              </h3>
              <div className="space-y-2 md:space-y-3">
                {cmmsData.users.length === 0 ? (
                  <p className="text-gray-400 text-sm">No team members assigned yet</p>
                ) : (
                  cmmsData.users.map(user => (
                    <div key={user.id} className="bg-white bg-opacity-5 p-2 md:p-3 rounded flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 border border-white border-opacity-10">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-white font-semibold text-sm break-words">{user.name}</p>
                          {user.isCreator && (
                            <span className="px-2 py-0.5 bg-amber-500 bg-opacity-40 text-amber-200 rounded text-xs font-bold flex items-center gap-1">
                              👑 Creator
                            </span>
                          )}
                        </div>
                        <p className="text-gray-400 text-xs break-all">{user.email}</p>
                      </div>
                      <span className="px-2 md:px-3 py-1 bg-blue-500 bg-opacity-30 text-blue-300 rounded text-xs md:text-sm font-semibold uppercase whitespace-nowrap">{user.role}</span>
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
      role: 'technician',
      department_id: '',
      assignedServices: []
    });

    const [emailSearchQuery, setEmailSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [searchingUsers, setSearchingUsers] = useState(false);
    const [verificationStatus, setVerificationStatus] = useState({});
    const [showDepartmentForm, setShowDepartmentForm] = useState(false);
    const [isSavingDepartment, setIsSavingDepartment] = useState(false);
    const [departmentForm, setDepartmentForm] = useState({
      department_name: '',
      description: '',
      location: ''
    });

    const departmentOptions = cmmsData.departments || [];
    const roleNeedsDepartment = ['coordinator', 'supervisor', 'technician', 'storeman'].includes(newUser.role);

    useEffect(() => {
      const hydrateDepartments = async () => {
        if (!userCompanyId || departmentOptions.length > 0) return;
        const { data: depts, error } = await cmmsService.getCmmsDepartments(userCompanyId);
        if (!error) {
          setCmmsData(prev => ({
            ...prev,
            departments: depts || []
          }));
        }
      };

      hydrateDepartments();
    }, [userCompanyId, departmentOptions.length]);

    const handleCreateDepartmentInline = async () => {
      if (!userCompanyId) {
        alert('âŒ Company not loaded yet.');
        return;
      }
      if (!departmentForm.department_name.trim()) {
        alert('âŒ Department name is required.');
        return;
      }

      setIsSavingDepartment(true);
      try {
        const { data, error } = await cmmsService.createCmmsDepartment(userCompanyId, departmentForm);
        if (error) {
          throw error;
        }

        const { data: depts, error: reloadError } = await cmmsService.getCmmsDepartments(userCompanyId);
        if (!reloadError) {
          setCmmsData(prev => ({
            ...prev,
            departments: depts || []
          }));
        }

        setNewUser(prev => ({ ...prev, department_id: data?.id || '' }));
        setDepartmentForm({ department_name: '', description: '', location: '' });
        setShowDepartmentForm(false);
      } catch (error) {
        alert(`âŒ Failed to create department: ${error.message || 'Unknown error'}`);
      } finally {
        setIsSavingDepartment(false);
      }
    };

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

    // Filter roles based on current user's role
    let roles = allRoles;
    if (userRole === 'coordinator') {
      // Coordinators can only assign Storeman and Service Provider roles
      roles = allRoles.filter(r => ['storeman', 'service-provider'].includes(r.id));
    } else if (userRole !== 'admin') {
      // Non-admin, non-coordinator users shouldn't reach here due to permission check
      roles = [];
    }

    const handleAddUser = async () => {
      if (!newUser.email) {
        alert('âŒ Please search and select a user from the dropdown');
        return;
      }

      if (!newUser.name) {
        alert('âŒ Please select a valid user');
        return;
      }

      if (!newUser.role) {
        alert('âŒ Please select a role');
        return;
      }

      if (roleNeedsDepartment && !newUser.department_id) {
        alert('âŒ Please select a department for this role.');
        return;
      }

      let isVerified = verificationStatus[newUser.email]?.exists;
      if (!isVerified) {
        const verification = await verifyICANUser(newUser.email);
        if (!verification.exists) {
          alert('âŒ User must have an ICAN account.\n\nPlease ask the user to:\n1. Sign up for ICAN\n2. Complete their ICAN profile\n3. Then they can be added to CMMS');
          return;
        }
      }

      const selectedDepartment = departmentOptions.find((dept) => dept.id === newUser.department_id);

      try {
        const { data: existingUser, error: checkError } = await supabase
          .from('cmms_users')
          .select('id')
          .eq('cmms_company_id', userCompanyId)
          .eq('email', newUser.email)
          .maybeSingle();

        let userId;

        if (existingUser) {
          userId = existingUser.id;

          const { error: updateUserError } = await supabase
            .from('cmms_users')
            .update({
              user_name: newUser.name || newUser.email.split('@')[0],
              phone: newUser.phone || null,
              department_id: roleNeedsDepartment ? newUser.department_id : null,
              role: newUser.role,
              is_active: true,
              updated_at: new Date().toISOString()
            })
            .eq('id', userId);

          if (updateUserError) {
            alert('âŒ Failed to update existing user: ' + updateUserError.message);
            return;
          }
        } else if (checkError && checkError.code !== 'PGRST116') {
          alert('âŒ Error checking user: ' + checkError.message);
          return;
        } else {
          const { data: insertedUser, error: userError } = await supabase
            .from('cmms_users')
            .insert([
              {
                cmms_company_id: userCompanyId,
                email: newUser.email,
                user_name: newUser.name || newUser.email.split('@')[0],
                phone: newUser.phone || null,
                department_id: roleNeedsDepartment ? newUser.department_id : null,
                role: newUser.role,
                is_active: true,
                is_creator: false
              }
            ])
            .select('id')
            .single();

          if (userError || !insertedUser) {
            alert('âŒ Error adding user to database: ' + (userError?.message || 'Unknown error'));
            return;
          }

          userId = insertedUser.id;
        }

        const { error: assignRoleError } = await supabase.rpc('assign_cmms_user_role_by_key', {
          p_company_id: userCompanyId,
          p_user_id: userId,
          p_role_key: newUser.role
        });

        if (assignRoleError) {
          alert('âš ï¸ User added but role assignment failed: ' + assignRoleError.message);
          return;
        }

        setNewlyAddedUserId(userId);
        setTimeout(() => setNewlyAddedUserId(null), 5000);

        try {
          await supabase
            .from('cmms_notifications')
            .insert([
              {
                cmms_user_id: userId,
                cmms_company_id: userCompanyId,
                notification_type: 'user_added_to_cmms',
                title: 'âœ… You\'ve been added to CMMS!',
                message: `Welcome to ${cmmsData.companyProfile?.companyName || 'the company'}! Your admin has added you as a ${newUser.role}. You can now access the CMMS dashboard and manage maintenance tasks.`,
                icon: 'ðŸŽ‰',
                action_tab: 'users',
                action_label: 'View Your Role in Users & Roles',
                action_link: '/cmms/users',
                is_read: false,
                created_at: new Date().toISOString()
              }
            ]);
        } catch (notificationError) {
          console.warn('Notification creation skipped:', notificationError.message);
        }

        await loadCompanyData(userCompanyId);

        setNewUser({ name: '', email: '', phone: '', role: 'technician', department_id: '', assignedServices: [] });
        setEmailSearchQuery('');
        setSearchResults([]);

        alert(`âœ… User added to CMMS successfully!\n\nðŸ“¬ Notification sent to ${newUser.email}\nðŸ”‘ Role: ${normalizeRoleKey(newUser.role)}\nðŸ¢ Department: ${selectedDepartment?.department_name || 'Not assigned'}`);
      } catch (error) {
        console.error('Exception adding user:', error);
        alert('âŒ Error: ' + error.message);
      }
    };

    const handleDeleteUser = (userId) => {
      setCmmsData(prev => ({
        ...prev,
        users: prev.users.filter(u => u.id !== userId)
      }));
    };

    const handleAssignAdmin = async (targetUser) => {
      const targetRole = normalizeRoleKey(targetUser.role);
      if (targetRole === 'admin') {
        alert('ℹ️ This user already has Admin access.');
        return;
      }

      // Verify current user is admin before allowing assignment
      const isCurrentUserAdmin = hasPermission('canAssignRoles');
      if (!isCurrentUserAdmin) {
        alert('❌ Only Admin users can assign Admin role.');
        return;
      }

      const confirmed = window.confirm(
        `⚠️ ADMIN ROLE ASSIGNMENT\n\n` +
        `You are about to promote:\n"${targetUser.name}" (${targetUser.email})\n\n` +
        `to Admin (🔓 Full CMMS Access)\n\n` +
        `They will be able to:\n` +
        `• Manage all users and assign roles\n` +
        `• Edit company profile\n` +
        `• Approve all requisitions\n` +
        `• View all financial data\n\n` +
        `Continue?`
      );
      if (!confirmed) return;

      try {
        // Call RPC to assign admin role
        const { error: assignRoleError } = await supabase.rpc('assign_cmms_user_role_by_key', {
          p_company_id: userCompanyId,
          p_user_id: targetUser.id,
          p_role_key: 'admin'
        });

        if (assignRoleError) {
          throw assignRoleError;
        }

        // Record who did the assignment (audit trail)
        console.log(`📝 AUDIT: Admin ${user?.email} assigned Admin role to ${targetUser.email}`);

        // Update UI
        setCmmsData(prev => ({
          ...prev,
          users: prev.users.map(existingUser => (
            existingUser.id === targetUser.id
              ? { ...existingUser, role: 'admin' }
              : existingUser
          ))
        }));

        // Send notification to newly promoted admin
        try {
          await supabase
            .from('cmms_notifications')
            .insert([
              {
                cmms_user_id: targetUser.id,
                cmms_company_id: userCompanyId,
                notification_type: 'promoted_to_admin',
                title: '⭐ You\'ve been promoted to Admin!',
                message: `${user?.email || 'An admin'} has promoted you to Admin. You now have full access to CMMS including user management and approvals.`,
                icon: '⭐',
                action_tab: 'users',
                action_label: 'View Admin Dashboard',
                is_read: false,
                created_at: new Date().toISOString()
              }
            ]);
        } catch (notifErr) {
          console.warn('Notification creation skipped:', notifErr.message);
        }

        alert(`✅ Success!\n\n"${targetUser.name}" is now an Admin.\n\n💌 Notification sent to ${targetUser.email}`);
      } catch (error) {
        console.error('Error assigning admin role:', error);
        alert(`❌ Failed to assign Admin role:\n${error.message}`);
      }
    };

    const handleUpdateUserDepartment = async (userId, departmentId) => {
      try {
        console.log(`🔄 Updating department for user ${userId} to department ${departmentId || 'None'}...`);

        // Update ONLY in Supabase (source of truth)
        const { error: updateError } = await supabase
          .from('cmms_users')
          .update({ 
            department_id: departmentId || null,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        if (updateError) {
          console.error('❌ Supabase update error:', updateError);
          throw updateError;
        }

        // Update local state for immediate UI feedback (but don't persist to localStorage)
        const updatedUser = cmmsData.users.find(u => u.id === userId);
        const newDeptName = departmentId 
          ? cmmsData.departments?.find(d => d.id === departmentId)?.department_name 
          : null;

        setCmmsData(prev => ({
          ...prev,
          users: prev.users.map(u =>
            u.id === userId
              ? { ...u, department_id: departmentId || null, department: newDeptName || null }
              : u
          )
        }));

        console.log(`✅ Department successfully updated in Supabase for ${updatedUser?.name} → ${newDeptName || 'No Department'}`);

        // Show success feedback
        const deptName = departmentId 
          ? cmmsData.departments?.find(d => d.id === departmentId)?.department_name 
          : 'No Department';
        alert(`✅ ${updatedUser?.name} reassigned to ${deptName}\n(Saved to Supabase)`);
      } catch (error) {
        console.error('❌ Error updating user department:', error);
        alert(`❌ Failed to update department:\n${error.message}`);
      }
    };

    return (
      <div className="space-y-6">
        {userRole === 'admin' && (
          <div className="glass-card p-4 bg-green-500 bg-opacity-10 border-l-4 border-green-500">
            <p className="text-green-300 font-semibold text-sm">Admin full access is active.</p>
            <p className="text-gray-300 text-xs mt-1">You can assign another Admin and manage all CMMS roles.</p>
          </div>
        )}

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
                    setNewUser({ name: '', email: '', phone: '', role: 'technician', department_id: '', assignedServices: [] });
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
            {newUser.email && roleNeedsDepartment && (
              <div className="space-y-2">
                <label className="text-white text-sm block">Department *</label>
                <select
                  value={newUser.department_id}
                  onChange={(e) => setNewUser({ ...newUser, department_id: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-700 border border-white border-opacity-20 rounded text-white font-medium focus:border-blue-500 focus:outline-none"
                >
                  <option value="">{departmentOptions.length === 0 ? 'Loading departments...' : 'Select Department...'}</option>
                  {departmentOptions.map(dept => (
                    <option key={dept.id} value={dept.id} className="bg-slate-700 text-white">
                      {dept.department_name || dept.name}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setShowDepartmentForm(prev => !prev)}
                  className="px-3 py-1.5 bg-blue-500 bg-opacity-30 text-blue-200 rounded text-xs font-semibold hover:bg-opacity-50 transition-all"
                >
                  {showDepartmentForm ? 'Hide Department Form' : 'Register New Department'}
                </button>

                {showDepartmentForm && (
                  <div className="bg-white bg-opacity-5 border border-white border-opacity-10 rounded p-3 space-y-2">
                    <input
                      type="text"
                      placeholder="Department Name *"
                      value={departmentForm.department_name}
                      onChange={(e) => setDepartmentForm({ ...departmentForm, department_name: e.target.value })}
                      className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
                    />
                    <input
                      type="text"
                      placeholder="Location"
                      value={departmentForm.location}
                      onChange={(e) => setDepartmentForm({ ...departmentForm, location: e.target.value })}
                      className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
                    />
                    <textarea
                      placeholder="Description"
                      value={departmentForm.description}
                      onChange={(e) => setDepartmentForm({ ...departmentForm, description: e.target.value })}
                      rows={2}
                      className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400"
                    />
                    <button
                      type="button"
                      onClick={handleCreateDepartmentInline}
                      disabled={isSavingDepartment}
                      className="px-3 py-2 bg-green-500 bg-opacity-30 text-green-200 rounded text-xs font-semibold hover:bg-opacity-50 transition-all disabled:opacity-50"
                    >
                      {isSavingDepartment ? 'Saving...' : 'Create Department'}
                    </button>
                  </div>
                )}
              </div>
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
              const normalizedUserRole = normalizeRoleKey(user.role);
              const role = allRoles.find(r => r.id === normalizedUserRole);
              const isNewlyAdded = newlyAddedUserId === user.id;
              const currentDept = cmmsData.departments?.find(d => d.id === user.department_id);
              
              return (
                <div 
                  key={user.id} 
                  className={`
                    bg-gradient-to-r ${role?.color} bg-opacity-20 border border-current border-opacity-30 
                    rounded-lg p-4 transition-all duration-500
                    ${isNewlyAdded ? 'ring-2 ring-green-400 shadow-lg shadow-green-500/50 scale-105' : 'hover:border-opacity-60'}
                  `}
                >
                  <div className="flex flex-col gap-4">
                    {/* User Info Row */}
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-2xl">{role?.icon}</span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="text-white font-bold">{user.name}</div>
                              {user.isCreator && (
                                <span className="px-2 py-0.5 bg-amber-500 bg-opacity-50 text-amber-100 text-xs rounded-full font-bold flex items-center gap-1">
                                  👑 Creator
                                </span>
                              )}
                              {isNewlyAdded && (
                                <span className="px-2 py-1 bg-green-500 bg-opacity-40 text-green-200 text-xs rounded-full font-semibold animate-pulse">
                                  ✨ NEW
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-gray-300">{role?.label || normalizedUserRole}</div>
                          </div>
                        </div>
                        <div className="text-xs text-gray-400 space-y-1">
                          <div>📧 {user.email}</div>
                          {user.phone && <div>📱 {user.phone}</div>}
                          {user.icanVerified && <div className="text-green-300">✅ ICAN Verified</div>}
                          {user.assignedServices && user.assignedServices.length > 0 && (
                            <div>🔧 {user.assignedServices.join(', ')}</div>
                          )}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        {userRole === 'admin' && normalizedUserRole !== 'admin' && !user.isCreator && (
                          <button
                            onClick={() => handleAssignAdmin(user)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs md:text-sm font-semibold transition-all flex items-center justify-center gap-1"
                            title="Promote this user to Admin - they will have full CMMS access"
                          >
                            ⭐ Make Admin
                          </button>
                        )}
                        {user.isCreator && normalizedUserRole === 'admin' && (
                          <div className="px-3 py-1.5 bg-amber-500 bg-opacity-60 text-amber-900 rounded text-xs font-semibold flex items-center justify-center gap-1">
                            👑 Creator Admin
                          </div>
                        )}
                        <button
                          onClick={() => handleDeleteUser(user.id)}
                          className="px-3 py-1.5 bg-red-500 bg-opacity-30 text-red-300 rounded text-xs md:text-sm hover:bg-opacity-50 font-semibold transition-all"
                          title="Remove this user from CMMS"
                        >
                          🗑️ Remove
                        </button>
                      </div>
                    </div>

                    {/* Department Assignment Row */}
                    {userRole === 'admin' && (
                      <div className="border-t border-white border-opacity-20 pt-3 mt-2">
                        <div className="flex flex-col md:flex-row items-start md:items-center gap-3">
                          <div className="flex-1">
                            <label className="text-xs font-semibold text-gray-300 block mb-1.5">
                              🏢 Assign to Department
                            </label>
                            <select
                              value={user.department_id || ''}
                              onChange={(e) => handleUpdateUserDepartment(user.id, e.target.value)}
                              className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-30 rounded text-white text-sm focus:border-blue-400 outline-none transition-all"
                            >
                              <option value="">← No Department Assigned</option>
                              {cmmsData.departments?.map(dept => (
                                <option key={dept.id} value={dept.id}>
                                  {dept.department_name}
                                </option>
                              ))}
                            </select>
                          </div>
                          {currentDept && (
                            <div className="flex items-center gap-2 px-3 py-2 bg-green-500 bg-opacity-20 border border-green-500 border-opacity-40 rounded text-xs text-green-200 font-semibold md:mt-6">
                              ✅ {currentDept.department_name}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
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
  // DEPARTMENT MANAGEMENT (ADMIN & COORDINATOR)
  // ============================================
  const DepartmentManager = () => {
    const [newDept, setNewDept] = useState({
      department_name: '',
      description: '',
      location: ''
    });
    const [editingDeptId, setEditingDeptId] = useState(null);
    const [editingDept, setEditingDept] = useState(null);
    const [deptError, setDeptError] = useState('');
    const [deptSuccess, setDeptSuccess] = useState('');
    const [isSavingDept, setIsSavingDept] = useState(false);

    const isAdmin = userRole === 'admin';
    const isCoordinator = userRole === 'coordinator';

    // Get departments managed by coordinator
    const getManagedDepartments = () => {
      if (isAdmin) return cmmsData.departments || [];
      if (isCoordinator) {
        // Coordinator can manage departments they're assigned to + all others
        return cmmsData.departments || [];
      }
      return [];
    };

    const managedDepts = getManagedDepartments();

    // Count staff per department
    const getStaffCount = (deptId) => {
      return cmmsData.users?.filter(u => u.department_id === deptId).length || 0;
    };

    // Get staff by department
    const getDepartmentStaff = (deptId) => {
      return cmmsData.users?.filter(u => u.department_id === deptId) || [];
    };

    const handleAddDepartment = async () => {
      if (!newDept.department_name.trim()) {
        setDeptError('Department name is required');
        return;
      }

      setIsSavingDept(true);
      setDeptError('');
      try {
        const { data, error } = await cmmsService.createCmmsDepartment(
          cmmsData.companyProfile?.id,
          newDept
        );

        if (error) throw error;

        // Update local state
        setCmmsData(prev => ({
          ...prev,
          departments: [...(prev.departments || []), { id: data.id, ...newDept, is_active: true }]
        }));

        setNewDept({ department_name: '', description: '', location: '' });
        setDeptSuccess(`✅ "${newDept.department_name}" created successfully!`);
        setTimeout(() => setDeptSuccess(''), 3000);
      } catch (error) {
        setDeptError(error.message || 'Failed to create department');
      } finally {
        setIsSavingDept(false);
      }
    };

    const handleEditDepartment = (dept) => {
      setEditingDeptId(dept.id);
      setEditingDept({ ...dept });
    };

    const handleSaveEditDepartment = async () => {
      if (!editingDept.department_name.trim()) {
        setDeptError('Department name is required');
        return;
      }

      setIsSavingDept(true);
      setDeptError('');
      try {
        const { error } = await cmmsService.updateCmmsDepartment(
          editingDept.id,
          {
            department_name: editingDept.department_name,
            description: editingDept.description,
            location: editingDept.location,
            is_active: true
          }
        );

        if (error) throw error;

        setCmmsData(prev => ({
          ...prev,
          departments: prev.departments.map(d => 
            d.id === editingDept.id ? editingDept : d
          )
        }));

        setEditingDeptId(null);
        setEditingDept(null);
        setDeptSuccess(`✅ "${editingDept.department_name}" updated successfully!`);
        setTimeout(() => setDeptSuccess(''), 3000);
      } catch (error) {
        setDeptError(error.message || 'Failed to update department');
      } finally {
        setIsSavingDept(false);
      }
    };

    const handleDeleteDepartment = async (dept) => {
      const staffCount = getStaffCount(dept.id);
      if (staffCount > 0 && !isAdmin) {
        setDeptError(`⚠️ Cannot delete department with ${staffCount} staff members. Admin only.`);
        return;
      }

      const confirmed = window.confirm(
        `⚠️ Delete "${dept.department_name}"?\n\n${staffCount > 0 ? `Warning: ${staffCount} staff member(s) assigned.` : 'This department has no staff.'}\n\nThis action cannot be undone.`
      );
      if (!confirmed) return;

      try {
        const { error } = await cmmsService.deleteCmmsDepartment(dept.id);
        if (error) throw error;

        setCmmsData(prev => ({
          ...prev,
          departments: prev.departments.filter(d => d.id !== dept.id)
        }));

        setDeptSuccess(`✅ "${dept.department_name}" deleted successfully!`);
        setTimeout(() => setDeptSuccess(''), 3000);
      } catch (error) {
        setDeptError(error.message || 'Failed to delete department');
      }
    };

    return (
      <div className="space-y-6">
        {/* Department Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="glass-card p-4 bg-blue-500 bg-opacity-10 border-l-4 border-blue-500">
            <div className="text-xs text-gray-400 font-semibold">TOTAL DEPARTMENTS</div>
            <div className="text-2xl font-bold text-blue-300 mt-1">{managedDepts.length}</div>
          </div>
          <div className="glass-card p-4 bg-green-500 bg-opacity-10 border-l-4 border-green-500">
            <div className="text-xs text-gray-400 font-semibold">ACTIVE STAFF</div>
            <div className="text-2xl font-bold text-green-300 mt-1">{cmmsData.users?.length || 0}</div>
          </div>
          <div className="glass-card p-4 bg-purple-500 bg-opacity-10 border-l-4 border-purple-500">
            <div className="text-xs text-gray-400 font-semibold">AVG STAFF/DEPT</div>
            <div className="text-2xl font-bold text-purple-300 mt-1">
              {managedDepts.length > 0 ? Math.ceil((cmmsData.users?.length || 0) / managedDepts.length) : 0}
            </div>
          </div>
        </div>

        {/* Add New Department */}
        {isAdmin && (
          <div className="glass-card p-6">
            <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
              <Plus className="w-6 h-6 text-blue-400" />
              Add New Department
            </h3>

            {deptError && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm mb-4">
                {deptError}
              </div>
            )}

            {deptSuccess && (
              <div className="p-3 bg-green-500/20 border border-green-500/50 rounded-lg text-green-200 text-sm mb-4">
                {deptSuccess}
              </div>
            )}

            <div className="space-y-3">
              <input
                type="text"
                placeholder="Department Name (e.g., Maintenance, Operations)"
                value={newDept.department_name}
                onChange={(e) => setNewDept({ ...newDept, department_name: e.target.value })}
                className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-500 text-sm focus:border-blue-500 outline-none"
              />
              <input
                type="text"
                placeholder="Description (e.g., Equipment and facility maintenance)"
                value={newDept.description}
                onChange={(e) => setNewDept({ ...newDept, description: e.target.value })}
                className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-500 text-sm focus:border-blue-500 outline-none"
              />
              <input
                type="text"
                placeholder="Location (e.g., Building A, Floor 2)"
                value={newDept.location}
                onChange={(e) => setNewDept({ ...newDept, location: e.target.value })}
                className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-500 text-sm focus:border-blue-500 outline-none"
              />
              <button
                onClick={handleAddDepartment}
                disabled={isSavingDept}
                className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-all disabled:opacity-50"
              >
                {isSavingDept ? '⏳ Creating...' : '✅ Create Department'}
              </button>
            </div>
          </div>
        )}

        {/* Departments List */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
            <Building className="w-6 h-6 text-green-400" />
            Departments ({managedDepts.length})
          </h3>

          <div className="space-y-3">
            {managedDepts.map(dept => {
              const staffCount = getStaffCount(dept.id);
              const staff = getDepartmentStaff(dept.id);
              const isEditing = editingDeptId === dept.id;

              if (isEditing) {
                return (
                  <div key={dept.id} className="bg-blue-500 bg-opacity-10 border border-blue-500 border-opacity-50 rounded-lg p-4">
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={editingDept.department_name}
                        onChange={(e) => setEditingDept({ ...editingDept, department_name: e.target.value })}
                        className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white text-sm focus:border-blue-500 outline-none"
                      />
                      <input
                        type="text"
                        value={editingDept.description || ''}
                        onChange={(e) => setEditingDept({ ...editingDept, description: e.target.value })}
                        className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white text-sm focus:border-blue-500 outline-none"
                      />
                      <input
                        type="text"
                        value={editingDept.location || ''}
                        onChange={(e) => setEditingDept({ ...editingDept, location: e.target.value })}
                        className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white text-sm focus:border-blue-500 outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveEditDepartment}
                          disabled={isSavingDept}
                          className="flex-1 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded font-semibold transition-all disabled:opacity-50"
                        >
                          💾 Save
                        </button>
                        <button
                          onClick={() => {
                            setEditingDeptId(null);
                            setEditingDept(null);
                          }}
                          className="flex-1 px-3 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded font-semibold transition-all"
                        >
                          ✕ Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div key={dept.id} className="bg-gradient-to-r from-indigo-500 bg-opacity-10 border border-indigo-500 border-opacity-30 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <h4 className="text-white font-bold text-lg">{dept.department_name}</h4>
                      <p className="text-gray-400 text-sm mt-1">{dept.description}</p>
                      {dept.location && <p className="text-gray-500 text-xs mt-1">📍 {dept.location}</p>}
                      <div className="mt-3 flex gap-2 flex-wrap">
                        <span className="px-2 py-1 bg-blue-500 bg-opacity-30 text-blue-200 text-xs rounded">
                          👥 {staffCount} Staff {staffCount === 1 ? 'Member' : 'Members'}
                        </span>
                        <span className={`px-2 py-1 ${dept.is_active ? 'bg-green-500' : 'bg-red-500'} bg-opacity-30 text-xs rounded`}>
                          {dept.is_active ? '✅ Active' : '❌ Inactive'}
                        </span>
                      </div>

                      {/* Staff List */}
                      {staffCount > 0 && (
                        <div className="mt-3 space-y-1">
                          <p className="text-xs font-semibold text-gray-300">Staff Members:</p>
                          {staff.map(member => {
                            const memberRole = allRoles.find(r => r.id === normalizeRoleKey(member.role));
                            return (
                              <div key={member.id} className="text-xs text-gray-400 flex items-center gap-2">
                                <span>{memberRole?.icon}</span>
                                <span>{member.name}</span>
                                <span className="text-gray-500">({memberRole?.label})</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col gap-2">
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => handleEditDepartment(dept)}
                            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-semibold transition-all"
                          >
                            ✏️ Edit
                          </button>
                          <button
                            onClick={() => handleDeleteDepartment(dept)}
                            className="px-3 py-1.5 bg-red-500 bg-opacity-30 text-red-300 rounded text-xs hover:bg-opacity-50 font-semibold transition-all"
                          >
                            🗑️ Delete
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {managedDepts.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                No departments yet. {isAdmin ? 'Create one to get started.' : 'Ask your admin to create departments.'}
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
    // All members can view inventory
    // Only Storeman and Admin can edit inventory
    const canViewInventory = true; // Allow all members to see inventory
    const canEditInventory = hasPermission('canEditInventory');
    const [expandedItems, setExpandedItems] = useState({});
    const [isAddingItem, setIsAddingItem] = useState(false);
    const [addItemError, setAddItemError] = useState(null);
    const [departments, setDepartments] = useState([]);
    const [storemen, setStoremen] = useState([]);
    const [isLoadingDepts, setIsLoadingDepts] = useState(false);

    const toggleExpandItem = (itemId) => {
      setExpandedItems(prev => ({
        ...prev,
        [itemId]: !prev[itemId]
      }));
    };

    const [newItem, setNewItem] = useState({
      item_name: '',
      category: 'Spare Parts',
      quantity_in_stock: 0,
      minimum_stock_level: 0,
      unit_cost: 0,
      supplier_name: '',
      storage_location: '',
      bin_number: '',
      unit_of_measure: 'pcs',
      lead_time_days: 0,
      department_id: '',
      assigned_storeman_id: ''
    });

    // Fetch departments from Supabase when component loads
    useEffect(() => {
      const fetchDepartments = async () => {
        if (!cmmsData.companyProfile?.id) return;
        
        setIsLoadingDepts(true);
        const { data: depts, error } = await cmmsService.getCmmsDepartments(cmmsData.companyProfile.id);
        
        if (!error && depts) {
          setDepartments(depts);
          console.log('✅ Departments loaded:', depts.length);
        } else {
          console.error('❌ Failed to load departments:', error);
        }
        setIsLoadingDepts(false);
      };

      fetchDepartments();
    }, [cmmsData.companyProfile?.id]);
    // Get storemen for current department from cmmsData
    const getStoremenForDepartment = (deptId) => {
      if (!deptId) return [];
      return cmmsData.users?.filter(u => 
        u.department_id === deptId && 
        (normalizeRoleKey(u.role) === 'storeman' || normalizeRoleKey(u.role) === 'admin')
      ) || [];
    };

    // Update storemen list when department changes
    useEffect(() => {
      if (!newItem.department_id) {
        setStoremen([]);
        return;
      }

      const stm = getStoremenForDepartment(newItem.department_id);
      setStoremen(stm);
      console.log('✅ Storemen loaded for department:', stm.length);
    }, [newItem.department_id, cmmsData.users]);

    const handleAddItem = async () => {
      if (!canEditInventory) {
        alert('🔒 You do not have permission to add inventory items.');
        return;
      }

      if (!newItem.item_name || newItem.item_name.trim() === '') {
        setAddItemError('❌ Item name is required');
        return;
      }

      if (newItem.quantity_in_stock < 0 || newItem.unit_cost < 0) {
        setAddItemError('❌ Quantity and cost cannot be negative');
        return;
      }

      setIsAddingItem(true);
      setAddItemError(null);

      try {
        // Get current company ID
        const companyId = cmmsData.companyProfile?.id;
        console.log('🔍 Frontend - Company Profile:', {
          companyProfile: cmmsData.companyProfile,
          companyId: companyId,
          companyIdType: typeof companyId,
          companyIdIsNull: companyId === null,
          companyIdIsUndefined: companyId === undefined
        });

        if (!companyId) {
          setAddItemError('❌ No company profile found. Please create a company first.');
          setIsAddingItem(false);
          return;
        }

        console.log('📝 Calling addInventoryItem with:', { companyId, itemName: newItem.item_name });

        // Call Supabase service
        const { data, error } = await cmmsService.addInventoryItem(companyId, newItem);

        if (error) {
          console.error('Supabase Error:', error);
          setAddItemError(`❌ Failed to add item: ${error.message || 'Unknown error'}`);
          setIsAddingItem(false);
          return;
        }

        if (!data) {
          setAddItemError('❌ Failed to add item - no data returned');
          setIsAddingItem(false);
          return;
        }

        // Update local state with new item
        setCmmsData(prev => ({
          ...prev,
          inventory: [...(prev.inventory || []), {
            id: data.id,
            item_code: data.item_code,
            item_name: data.item_name,
            category: data.category,
            quantity_in_stock: data.quantity_in_stock,
            minimum_stock_level: data.minimum_stock_level,
            unit_cost: data.unit_cost,
            supplier_name: data.supplier_name,
            storage_location: data.storage_location,
            bin_number: data.bin_number,
            unit_of_measure: data.unit_of_measure,
            is_active: data.is_active,
            created_at: data.created_at,
            updated_at: data.updated_at
          }]
        }));

        // Reset form
        setNewItem({
          item_name: '',
          category: 'Spare Parts',
          quantity_in_stock: 0,
          minimum_stock_level: 0,
          unit_cost: 0,
          supplier_name: '',
          storage_location: '',
          bin_number: '',
          unit_of_measure: 'pcs',
          lead_time_days: 0,
          department_id: '',
          assigned_storeman_id: ''
        });

        console.log('✅ Item added to Supabase successfully:', data);
      } catch (err) {
        console.error('Exception adding item:', err);
        setAddItemError(`❌ Error: ${err.message}`);
      } finally {
        setIsAddingItem(false);
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

    const lowStockItems = cmmsData.inventory.filter(item => item.quantity_in_stock <= item.minimum_stock_level);
    const totalInventoryValue = cmmsData.inventory.reduce((sum, item) => {
      const quantity = item.quantity_in_stock || 0;
      const price = item.unit_price || 0;
      return sum + (quantity * price);
    }, 0);
    const escrowPercent = 5;
    const escrowPreview = Math.round(totalInventoryValue * (escrowPercent / 100));

    return (
      <div className="space-y-4 md:space-y-6">
        {/* Permission Badge */}
        {!canEditInventory && (
          <div className="glass-card p-3 md:p-4 bg-blue-500 bg-opacity-10 border-l-4 border-blue-500">
            <p className="text-blue-300 text-xs md:text-sm">👁️ <span className="font-semibold">View-Only Mode</span> - You can see inventory but cannot make changes. Only Storeman and Admin can edit.</p>
          </div>
        )}

        {/* Add Inventory Item */}
        {canEditInventory && (
          <div className="glass-card p-5 md:p-6 space-y-4">
            {/* Error Message */}
            {addItemError && (
              <div className="p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-sm">
                {addItemError}
              </div>
            )}

            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div className="flex items-center gap-2">
                <Package className="w-5 h-5 md:w-6 md:h-6 text-blue-400" />
                <div>
                  <h3 className="text-lg md:text-xl font-bold text-white">Add Inventory Item</h3>
                  <p className="text-xs text-gray-300">Smart defaults keep stores funded to prevent the maintenance cliff.</p>
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-emerald-600/20 border border-emerald-400/40 text-emerald-100 text-sm">
                Escrow set‑aside ({escrowPercent}%): <span className="font-semibold">UGX {escrowPreview.toLocaleString()}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
              <div className="space-y-2">
                <label className="text-xs text-gray-300">Item Name <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  placeholder="e.g. Hydraulic Pump"
                  value={newItem.item_name}
                  onChange={(e) => setNewItem({...newItem, item_name: e.target.value})}
                  disabled={isAddingItem}
                  className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-300">Category</label>
                <div className="flex flex-wrap gap-2">
                  {['Spare Parts','Tools','Materials','Equipment','Consumables'].map(cat => (
                    <button
                      key={cat}
                      onClick={() => setNewItem({...newItem, category: cat})}
                      disabled={isAddingItem}
                      className={`px-3 py-2 rounded text-sm border transition-all ${newItem.category === cat ? 'bg-blue-500/30 border-blue-400 text-white' : 'bg-white/5 border-white/10 text-gray-200'} disabled:opacity-50`}
                      type="button"
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-300">Department <span className="text-red-400">*</span></label>
                <select
                  value={newItem.department_id}
                  onChange={(e) => {
                    setNewItem({
                      ...newItem, 
                      department_id: e.target.value,
                      assigned_storeman_id: '' // Reset storeman when department changes
                    });
                  }}
                  disabled={isAddingItem || isLoadingDepts}
                  className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white disabled:opacity-50"
                >
                  <option value="">{isLoadingDepts ? 'Loading departments...' : 'Select Department...'}</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.department_name || dept.name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400">Separates inventory by department.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-300">Assign Storeman <span className="text-red-400">*</span></label>
                <select
                  value={newItem.assigned_storeman_id}
                  onChange={(e) => setNewItem({...newItem, assigned_storeman_id: e.target.value})}
                  disabled={isAddingItem || !newItem.department_id || storemen.length === 0}
                  className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white disabled:opacity-50"
                >
                  <option value="">{!newItem.department_id ? 'Select Department First' : storemen.length === 0 ? 'No Storemen Available' : 'Select Storeman...'}</option>
                  {storemen.map(storeman => (
                    <option key={storeman.id} value={storeman.id}>
                      {storeman.name || storeman.user_name}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-400">Responsible storeman for this department.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-300">Quantity on hand</label>
                <input
                  type="number"
                  placeholder="0"
                  value={newItem.quantity_in_stock}
                  onChange={(e) => setNewItem({...newItem, quantity_in_stock: parseInt(e.target.value) || 0})}
                  disabled={isAddingItem}
                  className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm disabled:opacity-50"
                />
                <p className="text-[11px] text-gray-400">Auto-tracks low stock and escalates to repairs.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-300">Minimum stock</label>
                <input
                  type="number"
                  placeholder="Reorder at"
                  value={newItem.minimum_stock_level}
                  onChange={(e) => setNewItem({...newItem, minimum_stock_level: parseInt(e.target.value) || 0})}
                  disabled={isAddingItem}
                  className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm disabled:opacity-50"
                />
                <p className="text-[11px] text-gray-400">Keeps buffer before hitting the maintenance cliff.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-300">Unit Cost (UGX)</label>
                <input
                  type="number"
                  placeholder="0"
                  value={newItem.unit_cost}
                  onChange={(e) => setNewItem({...newItem, unit_cost: parseFloat(e.target.value) || 0})}
                  disabled={isAddingItem}
                  className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 disabled:opacity-50"
                />
                <p className="text-[11px] text-gray-400">Costs roll into escrow forecasting automatically.</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-300">Supplier Name</label>
                <input
                  type="text"
                  placeholder="Optional"
                  value={newItem.supplier_name}
                  onChange={(e) => setNewItem({...newItem, supplier_name: e.target.value})}
                  disabled={isAddingItem}
                  className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm disabled:opacity-50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs text-gray-300">Storage Location</label>
                <input
                  type="text"
                  placeholder="e.g. Warehouse A5"
                  value={newItem.storage_location}
                  onChange={(e) => setNewItem({...newItem, storage_location: e.target.value})}
                  disabled={isAddingItem}
                  className="px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded text-white placeholder-gray-400 text-sm disabled:opacity-50"
                />
              </div>
            </div>

            <button
              onClick={handleAddItem}
              disabled={isAddingItem}
              className="w-full px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-semibold hover:from-green-600 hover:to-emerald-700 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isAddingItem ? (
                <>
                  <Loader className="w-4 h-4 animate-spin" />
                  Adding Item...
                </>
              ) : (
                <>
                  ✓ Add Item to Supabase
                </>
              )}
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

        {/* Inventory List - Collapsible Items */}
        <div className="glass-card p-6">
          <h3 className="text-xl font-bold text-white mb-4">Inventory Items ({cmmsData.inventory.length})</h3>
          <div className="space-y-2 max-h-full overflow-y-auto">
            {cmmsData.inventory.map(item => {
              const isExpanded = expandedItems[item.id];
              const isLowStock = item.quantity_in_stock <= item.minimum_stock_level;
              const totalValue = item.unit_cost * item.quantity_in_stock;
              
              return (
                <div
                  key={item.id}
                  className={`rounded-lg border transition-all ${
                    isLowStock
                      ? 'bg-orange-500 bg-opacity-20 border-orange-500 border-opacity-50'
                      : 'bg-white bg-opacity-5 border-white border-opacity-20'
                  } ${
                    isExpanded ? 'p-4' : 'p-3'
                  }`}
                >
                  {/* Compact View - Always Shown */}
                  <div
                    onClick={() => toggleExpandItem(item.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleExpandItem(item.id);
                      }
                    }}
                    className="w-full text-left hover:opacity-80 transition-opacity cursor-pointer"
                  >
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2">
                          <div className="text-white font-semibold text-sm md:text-base truncate">{item.item_name}</div>
                          <div className="text-xs text-gray-400 flex-shrink-0">
                            {item.category}
                          </div>
                        </div>
                        {/* Compact Summary Line */}
                        <div className="text-xs text-gray-300 mt-1">
                          <span className="text-green-400">Stock: {item.quantity_in_stock}</span>
                          <span className="text-gray-500 mx-1">•</span>
                          <span className="text-blue-300">Min: {item.minimum_stock_level}</span>
                          <span className="text-gray-500 mx-1">•</span>
                          <span className="text-yellow-300">UGX {totalValue.toLocaleString()}</span>
                          {item.supplier_name && (
                            <>
                              <span className="text-gray-500 mx-1">•</span>
                              <span className="text-blue-300">📦 {item.supplier_name}</span>
                            </>
                          )}
                        </div>
                      </div>
                      
                      {/* Status Badge and Actions */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {isLowStock && (
                          <span className="px-2 py-1 bg-orange-500 text-white text-xs rounded font-bold whitespace-nowrap">⚠️ LOW</span>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleExpandItem(item.id);
                          }}
                          className="p-1 hover:bg-white hover:bg-opacity-10 rounded transition-all"
                          title={isExpanded ? 'Collapse' : 'Expand'}
                          type="button"
                        >
                          <span className="text-gray-400 text-lg">{isExpanded ? '▲' : '▼'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Expanded View - Full Details */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-white border-opacity-10 space-y-3">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                        {/* Basic Info */}
                        <div>
                          <p className="text-gray-400 text-xs uppercase tracking-wider">Item Name</p>
                          <p className="text-white font-semibold mt-1">{item.item_name}</p>
                        </div>
                        
                        <div>
                          <p className="text-gray-400 text-xs uppercase tracking-wider">Category</p>
                          <p className="text-white font-semibold mt-1">{item.category}</p>
                        </div>
                        
                        {/* Stock Information */}
                        <div>
                          <p className="text-gray-400 text-xs uppercase tracking-wider">Current Stock</p>
                          <p className={`font-semibold mt-1 ${
                            item.quantity_in_stock <= item.minimum_stock_level ? 'text-orange-400' : 'text-green-400'
                          }`}>
                            {item.quantity_in_stock} {item.unit_of_measure || 'units'}
                          </p>
                        </div>
                        
                        <div>
                          <p className="text-gray-400 text-xs uppercase tracking-wider">Minimum Stock Level</p>
                          <p className="text-blue-300 font-semibold mt-1">{item.minimum_stock_level} {item.unit_of_measure || 'units'}</p>
                        </div>
                        
                        {/* Pricing */}
                        <div>
                          <p className="text-gray-400 text-xs uppercase tracking-wider">Unit Cost</p>
                          <p className="text-yellow-300 font-semibold mt-1">UGX {item.unit_cost.toLocaleString()}</p>
                        </div>
                        
                        <div>
                          <p className="text-gray-400 text-xs uppercase tracking-wider">Total Value</p>
                          <p className="text-green-300 font-bold mt-1">UGX {totalValue.toLocaleString()}</p>
                        </div>
                        
                        {/* Assigned Storeman */}
                        <div className="md:col-span-2">
                          <p className="text-gray-400 text-xs uppercase tracking-wider">📦 Department & Assigned Storeman</p>
                          <p className="text-blue-300 font-semibold mt-1">
                            {(() => {
                              const dept = cmmsData.departments?.find(d => d.id === item.department_id);
                              const storeman = cmmsData.users?.find(u => u.id === item.assigned_storeman_id);
                              return `${dept?.department_name || dept?.name || 'Unassigned'} → ${storeman?.name || storeman?.user_name || 'No Storeman'}`;
                            })()}
                          </p>
                        </div>

                        {/* Supplier Name */}
                        <div className="md:col-span-2">
                          <p className="text-gray-400 text-xs uppercase tracking-wider">Supplier Name</p>
                          <p className="text-blue-300 font-semibold mt-1">
                            {item.supplier_name ? `🏭 ${item.supplier_name}` : 'Not specified'}
                          </p>
                        </div>

                        {/* Storage Location */}
                        {item.storage_location && (
                          <div className="md:col-span-2">
                            <p className="text-gray-400 text-xs uppercase tracking-wider">Storage Location</p>
                            <p className="text-gray-300 font-semibold mt-1">
                              📍 {item.storage_location}
                            </p>
                          </div>
                        )}
                        
                        {/* Metadata */}
                        {item.created_at && (
                          <div>
                            <p className="text-gray-400 text-xs uppercase tracking-wider">Added On</p>
                            <p className="text-gray-300 text-xs mt-1">
                              {new Date(item.created_at).toLocaleDateString()}
                            </p>
                          </div>
                        )}
                        
                        {item.updated_at && (
                          <div>
                            <p className="text-gray-400 text-xs uppercase tracking-wider">Last Updated</p>
                            <p className="text-gray-300 text-xs mt-1">
                              {new Date(item.updated_at).toLocaleDateString()}
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Edit/Delete Actions - Only for authorized users */}
                      {canEditInventory && (
                        <div className="mt-4 pt-4 border-t border-white border-opacity-10 flex gap-2">
                          <button
                            onClick={() => handleDeleteItem(item.id)}
                            className="flex-1 px-3 py-2 bg-red-500 bg-opacity-20 text-red-300 text-xs rounded hover:bg-opacity-40 transition-all font-semibold flex items-center justify-center gap-2"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete Item
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            
            {cmmsData.inventory.length === 0 && (
              <div className="text-center py-8 text-gray-400">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No inventory items yet.</p>
                {canEditInventory && <p className="text-xs mt-2">Add items using the form above.</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ============================================
  // CMMS TABS WITH 3-DOT MENU COMPONENT
  // ============================================
  const CMSTabsWithMenu = ({ activeTab, setActiveTab, getTabs }) => {
    const [menuOpen, setMenuOpen] = useState(false);
    const menuRef = useRef(null);
    const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

    const allTabs = [
      { id: 'company', label: '🏢 Company', icon: Building },
      { id: 'departments', label: '🏭 Departments', icon: Building },
      { id: 'users', label: '👥 Users & Roles', icon: Users },
      { id: 'inventory', label: '📦 Inventory', icon: Package },
      { id: 'requisitions', label: '📋 Requisitions', icon: Package },
      { id: 'reports', label: '📊 Reports', icon: Package }
    ];

    allTabs.splice(
      Math.max(allTabs.findIndex((tab) => tab.id === 'reports'), 0),
      0,
      { id: 'approvals', label: 'Approvals', icon: CheckCircle }
    );

    const accessibleTabs = allTabs.filter(tab => getTabs().includes(tab.id));

    // Track window resize for mobile detection
    useEffect(() => {
      const handleResize = () => setIsMobile(window.innerWidth < 768);
      window.addEventListener('resize', handleResize);
      return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Close menu when clicking outside
    useEffect(() => {
      const handleClickOutside = (e) => {
        if (menuRef.current && !menuRef.current.contains(e.target)) {
          setMenuOpen(false);
        }
      };

      if (menuOpen) {
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
      }
    }, [menuOpen]);

    // Mobile view - 3-dot menu only
    if (isMobile) {
      return (
        <div className="mb-6 border-b border-white border-opacity-10 -mx-4 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            {/* Current active tab display */}
            <div className="text-sm font-semibold text-blue-300">
              {accessibleTabs.find(t => t.id === activeTab)?.label || '🏢 Company'}
            </div>

            {/* 3-Dot Menu Button */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className={`p-2.5 rounded-lg transition-all flex items-center justify-center touch-target ${
                  menuOpen
                    ? 'bg-blue-500 bg-opacity-40 text-blue-200'
                    : 'bg-white bg-opacity-10 text-gray-300 active:bg-opacity-20'
                }`}
                title="Menu"
              >
                {menuOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <MoreVertical className="w-5 h-5" />
                )}
              </button>

              {/* Mobile Dropdown Menu */}
              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 bg-slate-800 border border-blue-500 border-opacity-50 rounded-lg shadow-2xl z-30 min-w-64 animate-in fade-in zoom-in-95 duration-200">
                  <div className="px-4 py-3 border-b border-slate-700 text-slate-300 text-xs font-semibold bg-slate-900 rounded-t-lg">
                    📋 NAVIGATION
                  </div>
                  <div className="divide-y divide-slate-700">
                    {accessibleTabs.map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          setMenuOpen(false);
                        }}
                        className={`
                          w-full px-4 py-3.5 text-sm font-medium transition-all text-left flex items-center gap-3
                          ${activeTab === tab.id
                            ? 'bg-blue-600 bg-opacity-50 text-blue-100'
                            : 'text-slate-300 active:bg-slate-700 active:text-white'
                          }
                        `}
                      >
                        <span className="text-lg">{tab.label.split(' ')[0]}</span>
                        <span className="flex-1">{tab.label}</span>
                        {activeTab === tab.id && (
                          <span className="text-blue-300">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    // Desktop view - Company tab + 3-dot menu
    const visibleTabs = accessibleTabs.slice(0, 1);
    const hiddenTabs = accessibleTabs.slice(1);

    return (
      <div className="mb-6 border-b border-white border-opacity-10 -mx-4 md:-mx-6 lg:-mx-8">
        <div className="flex gap-1 md:gap-2 items-center justify-between px-4 md:px-6 lg:px-8 py-2 md:py-3">
          {/* Visible Tabs */}
          <div className="flex gap-1 md:gap-2 items-center overflow-x-auto flex-1">
            {visibleTabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-2 md:px-4 py-2 md:py-3 text-xs md:text-sm font-semibold transition-all whitespace-nowrap border-b-2 ${
                  activeTab === tab.id
                    ? 'text-blue-300 border-blue-500'
                    : 'text-gray-400 border-transparent hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* 3-Dot Menu for Hidden Tabs - Desktop */}
          {hiddenTabs.length > 0 && (
            <div className="relative ml-2" ref={menuRef}>
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className={`p-2 rounded-lg transition-all flex items-center justify-center ${
                  menuOpen
                    ? 'bg-blue-500 bg-opacity-30 text-blue-300'
                    : 'bg-white bg-opacity-5 text-gray-400 hover:bg-opacity-10 hover:text-white'
                }`}
                title="More menu"
              >
                {menuOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <MoreVertical className="w-5 h-5" />
                )}
              </button>

              {/* Dropdown Menu - Desktop */}
              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 bg-slate-800 border border-blue-500 border-opacity-50 rounded-lg shadow-2xl z-20 min-w-max animate-in fade-in zoom-in-95 duration-200">
                  <div className="px-3 py-2 border-b border-slate-700 text-slate-300 text-xs font-semibold bg-slate-900 rounded-t-lg">
                    📋 MORE OPTIONS
                  </div>
                  <div className="py-1">
                    {hiddenTabs.map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          setMenuOpen(false);
                        }}
                        className={`
                          w-full px-4 py-2.5 text-sm font-medium transition-all text-left
                          border-b border-slate-700 last:border-b-0
                          ${activeTab === tab.id
                            ? 'bg-blue-600 bg-opacity-40 text-blue-200'
                            : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                          }
                        `}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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
    // Allow BOTH guests and users with roles to create company profiles
    // Users with roles can create additional company profiles and switch between them
    const handleCreateCompanyProfile = async () => {
      // Validate required fields
      if (!profileFormData.companyName || !profileFormData.email) {
        alert('⚠️ Please fill in Company Name and Company Email');
        return;
      }
      
      console.log('📝 Creating company profile...');
      console.log('Current user role:', userRole);
      console.log('Is authorized:', isAuthorized);
      console.log('Is creator:', isCreator);

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

        // Get the OWNER email - should be the current logged-in user, not the company email
        let ownerEmail = profileFormData.ownerEmail; // explicit owner email if provided
        
        // If no explicit owner email, get from currently logged-in user
        if (!ownerEmail && user?.email) {
          ownerEmail = user.email;
          console.log('✅ Using current logged-in user email as owner:', ownerEmail);
        }
        
        // Fallback: try to get from auth
        if (!ownerEmail) {
          const { data: { user: authUser } } = await supabase.auth.getUser();
          ownerEmail = authUser?.email;
          console.log('✅ Using auth user email as owner:', ownerEmail);
        }
        
        // Last resort: use company email
        if (!ownerEmail) {
          ownerEmail = profileFormData.email;
          console.log('⚠️ No owner email found, using company email:', ownerEmail);
        }

        console.log('✅ Owner email for CMMS storage:', ownerEmail);
        console.log('✅ Current logged-in user:', user?.email);

        // Step 3: Mark this user as the company creator in the database
        // This ensures the cmms_users_with_roles view returns admin role for this user
        if (adminUserData?.id) {
          console.log('🔑 Marking user as company creator in database...');
          const { error: creatorError } = await cmmsService.markCompanyCreator(
            companyData.id,
            adminUserData.id,
            ownerEmail
          );
          
          if (creatorError) {
            console.warn('⚠️ Failed to mark creator in database, continuing anyway:', creatorError);
            // Don't throw - this is not critical, UI will still work with localStorage
          } else {
            console.log('✅ Creator marked in database successfully');
          }
        }

        // Step 4: Store auth state in localStorage (Supabase is source of truth for profile data)
        localStorage.setItem('cmms_user_profile', 'true');
        localStorage.setItem('cmms_user_role', 'admin');
        localStorage.setItem('cmms_company_id', companyData.id);
        if (ownerEmail) {
          localStorage.setItem('cmms_company_owner_email', ownerEmail);
          console.log('💾 Stored owner email in localStorage:', ownerEmail);
        }
        localStorage.setItem('cmms_company_owner_id', adminUserData.id);

        // Step 4: Update component state with Supabase data
        setCmmsData(prev => ({
          ...prev,
          companyProfile: companyData,
          users: [adminUserData]
        }));
        
        setUserCompanyId(companyData.id);
        setHasBusinessProfile(true);
        setUserRole('admin');
        setIsCreator(true);  // Mark new company creator for permission checks
        setIsAuthorized(true);
        setActiveTab('company');
        
        console.log('✅ Profile created successfully, user is now admin with creator permissions');
        alert('🎉 Company profile created! You are now the Administrator.\n\n✅ Role-Based Tab Access Maintained: Your tab access is still controlled by your assigned role, not your company ownership.');
        
        // Log important: Role-based users can create companies but keep their role restrictions
        if (userRole && userRole !== 'creator') {
          console.log(`ℹ️ User created company profile while having role: ${userRole}`);
          console.log(`ℹ️ Tab access remains restricted to: ${getTabs().join(', ')}`);
        }
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
              {user?.id && notificationCompanyId && (
                <NotificationsPanel 
                  userId={user?.id} 
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
          </div>

          {/* Company Profile Form - Expandable */}
          {/* Available to: Guests AND Users with Roles */}
          {/* Users with roles can create their own company profile while maintaining their role-based tab access */}
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
                  onClick={handleCreateCompanyProfile}
                  disabled={isCreatingProfile}
                  className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-500 to-green-500 text-white rounded-lg font-semibold hover:from-blue-600 hover:to-green-600 transition-all text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isCreatingProfile ? '⏳ Creating...' : '✓ Create Profile'}
                </button>
                <button
                  onClick={() => setShowCompanyForm(false)}
                  disabled={isCreatingProfile}
                  className="px-4 py-2 bg-gray-500 bg-opacity-30 text-gray-300 rounded-lg font-semibold hover:bg-opacity-50 transition-all text-sm disabled:opacity-50"
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
    <div className="glass-card p-4 md:p-6 lg:p-8">
      {/* Responsive Header with Icon */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-6 md:mb-8 pb-4 md:pb-6 border-b border-white border-opacity-20 gap-4">
        <div className="flex items-center gap-2 sm:gap-4 flex-1">
          <button
            onClick={() => setShowCompanyDetails(!showCompanyDetails)}
            className={`
              flex flex-col items-center justify-center w-16 h-16 sm:w-20 sm:h-20 rounded-lg 
              transition-all transform hover:scale-110 shadow-lg flex-shrink-0
              ${showCompanyDetails
                ? 'bg-gradient-to-br from-indigo-600 to-indigo-800 ring-2 ring-indigo-400 scale-105'
                : 'bg-gradient-to-br from-indigo-500 to-indigo-700 hover:from-indigo-600 hover:to-indigo-800'
              }
            `}
            title="Company Details"
          >
            <Building className="w-7 h-7 sm:w-10 sm:h-10 text-white mb-1" />
            <span className="text-xs text-white font-bold text-center leading-tight">Company</span>
          </button>
          <div className="min-w-0">
            <h2 className="text-xl sm:text-2xl font-bold text-white truncate">CMMS</h2>
            <p className="text-gray-300 text-xs sm:text-sm mt-1">Management System</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-4 flex-wrap justify-end w-full sm:w-auto">
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
          
          <span className="bg-blue-500 bg-opacity-30 text-blue-200 px-3 md:px-4 py-1.5 md:py-2 rounded-full text-xs font-semibold whitespace-nowrap">
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

      {/* Tabs - Role-Based with 3-Dot Menu Collapse */}
      <CMSTabsWithMenu 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        getTabs={getTabs}
      />

      {/* Tab Content */}
      <div>
        {activeTab === 'company' && <CompanyProfileManager />}
        {activeTab === 'departments' && <DepartmentManager />}
        {activeTab === 'users' && <UserRoleManager />}
        {activeTab === 'inventory' && <InventoryManager />}
        {activeTab === 'requisitions' && (
          <RequisitionWorkspace
            userRole={userRole}
            user={user}
            companyId={companyIdToUse}
            cmmsData={cmmsData}
            setCmmsData={setCmmsData}
          />
        )}
        {activeTab === 'approvals' && (
          <RequisitionApprovalsTab
            userRole={userRole}
            companyId={companyIdToUse}
            cmmsData={cmmsData}
            setCmmsData={setCmmsData}
          />
        )}
        {activeTab === 'reports' && <ReportsManager />}
      </div>
    </div>
  );
};

export default CMMSModule;



