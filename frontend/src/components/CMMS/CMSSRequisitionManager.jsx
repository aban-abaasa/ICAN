/**
 * CMMS Requisition System - Component Integration Guide
 * 
 * This guide shows how to use the separated requisition components
 * Created to replace the monolithic RequisitionManager in CMSSModule
 */

// ============================================================
// 1. COMPONENT OVERVIEW
// ============================================================

/*
The requisition system is now separated into 4 independent components:

1. RequisitionForm
   - Purpose: Create new maintenance requisitions
   - Users: Technicians, Supervisors, Coordinators
   - Features: Item management, cost calculation, priority setting
   
2. RequisitionList
   - Purpose: View all requisitions with status tracking
   - Users: All roles (Admin, Coordinator, Supervisor, Finance Officer)
   - Features: Role-based filtering, actionable items highlighting
   
3. RequisitionConfirmations
   - Purpose: Handle optional coordinator/supervisor confirmations
   - Users: Coordinators, Supervisors, Admin
   - Features: Workflow visualization, confirmation tracking
   
4. AdminApprovalPanel
   - Purpose: Handle MANDATORY admin approval
   - Users: Admin only
   - Features: Required approval, reject with reason, approval history
*/

// ============================================================
// 2. BASIC USAGE EXAMPLE
// ============================================================

import React, { useState, useCallback } from 'react';
import RequisitionForm from './CMMS/RequisitionForm';
import RequisitionList from './CMMS/RequisitionList';
import RequisitionConfirmations from './CMMS/RequisitionConfirmations';
import AdminApprovalPanel from './CMMS/AdminApprovalPanel';
import cmmsService from '../lib/supabase/services/cmmsService';
import cmmsRequisitionConfirmationService from '../lib/supabase/services/cmmsRequisitionConfirmationService';

const CMSSRequisitionManager = ({ user, userRole, companyId, departmentId }) => {
  const [requisitions, setRequisitions] = useState([]);
  const [selectedRequisition, setSelectedRequisition] = useState(null);
  const [isLoadingRequisitions, setIsLoadingRequisitions] = useState(false);
  const [isSubmittingForm, setIsSubmittingForm] = useState(false);

  // ============================================================
  // 3. LOAD REQUISITIONS
  // ============================================================
  
  const loadRequisitions = useCallback(async () => {
    setIsLoadingRequisitions(true);
    try {
      const { data, error } = await cmmsService.getCompanyRequisitions(companyId);
      
      if (error) {
        console.error('Error loading requisitions:', error);
        return;
      }

      // Transform Supabase data to component format
      const transformed = (data || []).map(req => ({
        id: req.id,
        title: req.purpose || 'Maintenance Request',
        description: req.justification || '',
        createdBy: req.requested_by_role || 'technician',
        createdByName: req.requested_by_name || 'Unknown',
        createdAt: new Date(req.requisition_date),
        status: req.status || 'pending_department_head',
        priority: req.urgency_level || 'normal',
        estimatedCost: req.total_estimated_cost || 0,
        requisitionNumber: req.requisition_number,
        budgetSufficient: req.budget_sufficient,
        items: req.items || [],
        approvals: {
          supervisor: req.dept_head_approved_at ? { approved: true } : null,
          coordinator: req.finance_approved_at ? { approved: true } : null,
          finance: null
        }
      }));

      setRequisitions(transformed);
    } finally {
      setIsLoadingRequisitions(false);
    }
  }, [companyId]);

  // ============================================================
  // 4. CREATE REQUISITION
  // ============================================================

  const handleCreateRequisition = async (formData) => {
    setIsSubmittingForm(true);
    try {
      const result = await cmmsRequisitionConfirmationService.createRequisitionWithConfirmations({
        cmms_company_id: companyId,
        department_id: departmentId,
        requested_by: user?.id,
        purpose: formData.title,
        justification: formData.description,
        urgency_level: formData.priority,
        required_by_date: formData.requiredByDate || null,
        total_estimated_cost: formData.estimatedCost
      });

      if (result.success) {
        alert('✅ Requisition created successfully!');
        await loadRequisitions();
      } else {
        alert(`❌ Error: ${result.error}`);
      }
    } finally {
      setIsSubmittingForm(false);
    }
  };

  // ============================================================
  // 5. ADMIN APPROVE
  // ============================================================

  const handleApproveRequisition = async (requisitionId, status) => {
    const result = await cmmsRequisitionConfirmationService.approveRequisitionAsAdmin(
      requisitionId,
      user?.id,
      status,
      '' // optional notes
    );

    if (result.success) {
      alert(`✅ Requisition ${status}ed`);
      await loadRequisitions();
    }
  };

  // ============================================================
  // 6. CONFIRM REQUISITION (Coordinator/Supervisor)
  // ============================================================

  const handleConfirmRequisition = async (requisitionId, status) => {
    const confirmationType = userRole === 'coordinator' 
      ? 'coordinator_confirmation' 
      : 'supervisor_confirmation';

    const result = await cmmsRequisitionConfirmationService.submitRequisitionConfirmation(
      requisitionId,
      user?.id,
      confirmationType,
      status,
      '' // optional notes
    );

    if (result.success) {
      alert('✅ Confirmation submitted');
      setSelectedRequisition(null);
      await loadRequisitions();
    }
  };

  // ============================================================
  // 7. RENDER LAYOUT
  // ============================================================

  return (
    <div className="space-y-6">
      {/* Form - Only for users who can create */}
      {['technician', 'supervisor', 'coordinator'].includes(userRole) && (
        <RequisitionForm
          onSubmit={handleCreateRequisition}
          isSubmitting={isSubmittingForm}
          companyId={companyId}
          userId={user?.id}
          userRole={userRole}
        />
      )}

      {/* Requisition List - For all users */}
      <RequisitionList
        requisitions={requisitions}
        isLoading={isLoadingRequisitions}
        onRefresh={loadRequisitions}
        userRole={userRole}
        onSelectRequisition={setSelectedRequisition}
        onApproveRequisition={handleApproveRequisition}
        onConfirmRequisition={handleConfirmRequisition}
      />

      {/* Admin Approval Panel - Only for admins AND only when requisition selected */}
      {userRole === 'admin' && selectedRequisition && (
        <AdminApprovalPanel
          requisitionId={selectedRequisition.id}
          requisition={selectedRequisition}
          currentUserId={user?.id}
          currentUserRole={userRole}
          onApprovalSubmitted={() => {
            setSelectedRequisition(null);
            loadRequisitions();
          }}
        />
      )}

      {/* Confirmations - Only for coordinators/supervisors AND when requisition selected */}
      {(userRole === 'coordinator' || userRole === 'supervisor') && selectedRequisition && (
        <RequisitionConfirmations
          requisitionId={selectedRequisition.id}
          requisition={selectedRequisition}
          currentUserId={user?.id}
          currentUserRole={userRole}
          onConfirmationSubmitted={() => {
            setSelectedRequisition(null);
            loadRequisitions();
          }}
        />
      )}
    </div>
  );
};

// ============================================================
// 8. INTEGRATION INTO EXISTING CMSSModule
// ============================================================

/*
To integrate into your existing CMSSModule:

1. Import the components:
   ```
   import RequisitionForm from './CMMS/RequisitionForm';
   import RequisitionList from './CMMS/RequisitionList';
   import RequisitionConfirmations from './CMMS/RequisitionConfirmations';
   import AdminApprovalPanel from './CMMS/AdminApprovalPanel';
   ```

2. Replace the RequisitionManager function with:
   ```
   const RequisitionManager = () => {
     const [selectedRequisition, setSelectedRequisition] = useState(null);
     const [isLoadingRequisitions, setIsLoadingRequisitions] = useState(false);
     
     // ... load and manage requisitions ...
     
     return (
       <div className="space-y-6">
         <RequisitionForm
           onSubmit={handleCreateRequisition}
           isSubmitting={isSubmittingForm}
           companyId={companyIdToUse}
           userId={user?.id}
           userRole={userRole}
         />
         
         <RequisitionList
           requisitions={cmmsData.requisitions}
           isLoading={isLoadingRequisitions}
           onRefresh={loadRequisitionsFromSupabase}
           userRole={userRole}
           onSelectRequisition={setSelectedRequisition}
           onApproveRequisition={handleApproveRequisition}
           onConfirmRequisition={handleConfirmRequisition}
         />
         
         {userRole === 'admin' && selectedRequisition && (
           <AdminApprovalPanel
             requisitionId={selectedRequisition.id}
             requisition={selectedRequisition}
             currentUserId={user?.id}
             currentUserRole={userRole}
             onApprovalSubmitted={() => {
               setSelectedRequisition(null);
               loadRequisitionsFromSupabase();
             }}
           />
         )}
         
         {(userRole === 'coordinator' || userRole === 'supervisor') && selectedRequisition && (
           <RequisitionConfirmations
             requisitionId={selectedRequisition.id}
             requisition={selectedRequisition}
             currentUserId={user?.id}
             currentUserRole={userRole}
             onConfirmationSubmitted={() => {
               setSelectedRequisition(null);
               loadRequisitionsFromSupabase();
             }}
           />
         )}
       </div>
     );
   };
   ```

3. Create the necessary service functions in cmmsService if not already present
*/

// ============================================================
// 9. COMPONENT PROPS REFERENCE
// ============================================================

/*

RequisitionForm Props:
  - onSubmit: (formData) => Promise - Handle form submission
  - isSubmitting: boolean - Show loading state
  - companyId: string - Company UUID
  - userId: string - Current user UUID
  - userRole: string - User's role

RequisitionList Props:
  - requisitions: Array - List of requisitions
  - isLoading: boolean - Loading state
  - onRefresh: () => Promise - Refresh handler
  - userRole: string - User's role
  - onSelectRequisition: (requisition) => void - Selection handler
  - onApproveRequisition: (id, status) => Promise - Approval handler
  - onConfirmRequisition: (id, status) => Promise - Confirmation handler

RequisitionConfirmations Props:
  - requisitionId: string - Requisition UUID
  - requisition: Object - Requisition data
  - currentUserId: string - Current user UUID
  - currentUserRole: string - User's role
  - onConfirmationSubmitted: () => void - Submission callback
  - isLoading: boolean - Loading state

AdminApprovalPanel Props:
  - requisitionId: string - Requisition UUID
  - requisition: Object - Requisition data
  - currentUserId: string - Current user UUID
  - currentUserRole: string - Must be 'admin'
  - onApprovalSubmitted: (status) => void - Submission callback
  - isLoading: boolean - Loading state

*/

// ============================================================
// 10. FILE STRUCTURE
// ============================================================

/*
frontend/src/components/CMMS/
├── RequisitionForm.jsx         - Create new requisitions
├── RequisitionList.jsx         - View all requisitions
├── RequisitionConfirmations.jsx - Coordinator/Supervisor confirmations
└── AdminApprovalPanel.jsx      - Admin mandatory approval

frontend/src/lib/supabase/services/
├── cmmsService.js              - General CMMS operations
└── cmmsRequisitionConfirmationService.js - New confirmation operations

backend/
└── CMMS_REQUISITION_CONFIRMATIONS_SETUP.sql - Database schema & functions
*/

// ============================================================
// 11. WORKFLOW DIAGRAM
// ============================================================

/*

USER SUBMITS REQUISITION
         ↓
   RequisitionForm
         ↓
Creates requisition + pending admin_approval confirmation
         ↓
         ├─→ AdminApprovalPanel (Admin MUST approve)
         │        ↓(Must be approved)
         │    Status → approved_by_admin
         │
         ├─→ RequisitionConfirmations (Optional)
         │   ├─→ Coordinator confirmation (optional)
         │   └─→ Supervisor confirmation (optional)
         │
         └─→ RequisitionList (Shows all requisitions)
              ├─ View all requisitions
              ├─ Filter by status
              └─ See action items

*/

// ============================================================
// 12. ROLE PERMISSIONS SUMMARY
// ============================================================

/*

ADMIN:
  ✅ Create requisitions
  ✅ View all requisitions
  ✅ MUST approve requisitions (required)
  ✅ Can confirm (optional)
  ✅ Full access to all stages

COORDINATOR:
  ✅ Create requisitions
  ✅ View own/company requisitions
  ❌ Cannot approve (not required)
  ✅ Can confirm requisitions (optional)

SUPERVISOR:
  ✅ Create requisitions
  ✅ View own/company requisitions
  ❌ Cannot approve (not required)
  ✅ Can confirm requisitions (optional)

TECHNICIAN:
  ✅ Create requisitions
  ✅ View own requisitions
  ❌ Cannot approve
  ❌ Cannot confirm

FINANCIAL_OFFICER:
  ❌ Cannot create requisitions
  ✅ View requisitions (read-only)
  ❌ Cannot approve
  ❌ Cannot confirm
  ✅ Can see confirmation details

*/

// ============================================================
// 13. STATUS FLOW
// ============================================================

/*

pending_confirmations
  → Awaits admin approval
  → Optional coordinator/supervisor confirmations in parallel
  
approved_by_admin
  → Admin has approved
  → Can proceed with procurement
  → Coordinator/supervisor confirmations optional
  
rejected_by_admin
  → Admin rejected the requisition
  → Requester must submit new requisition
  
pending_finance
  → Admin approved, awaiting finance review
  
pending_department_head (legacy, for backward compatibility)
  → Will be migrated to new system

*/

export default CMSSRequisitionManager;
