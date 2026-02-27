# CMMS Requisition System - Architecture & Separation

## System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      CMSSModule (Parent)                         │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   RequisitionManager                      │    │
│  │          (Now uses separated components)                │    │
│  │                                                           │    │
│  │  ┌─────────────────────────────────────────────┐         │    │
│  │  │  RequisitionForm                            │         │    │
│  │  │  ├─ Create new requisitions               │         │    │
│  │  │  ├─ Add/remove items                       │         │    │
│  │  │  ├─ Calculate totals                       │         │    │
│  │  │  └─ Submit for approval                    │         │    │
│  │  └─────────────────────────────────────────────┘         │    │
│  │                      ↓                                     │    │
│  │  ┌─────────────────────────────────────────────┐         │    │
│  │  │  RequisitionList                            │         │    │
│  │  │  ├─ Display all requisitions               │         │    │
│  │  │  ├─ Filter by status                        │         │    │
│  │  │  ├─ Show action items                       │         │    │
│  │  │  ├─ Select for approval                     │         │    │
│  │  │  └─ View approval chain                     │         │    │
│  │  └─────────────────────────────────────────────┘         │    │
│  │           ↙              ↓              ↘                │    │
│  │  ┌──────────────────┐  ┌────────────┐  ┌──────────────┐ │    │
│  │  │AdminApprovalPanel│  │Finance View│  │Confirmations │ │    │
│  │  │                  │  │(read-only) │  │(optional)    │ │    │
│  │  │ ✅ REQUIRED      │  │            │  │              │ │    │
│  │  │ Approve/Reject   │  │  View only │  │ Coordinator  │ │    │
│  │  │ with notes       │  │ workflow   │  │ Supervisor   │ │    │
│  │  │                  │  │            │  │              │ │    │
│  │  └──────────────────┘  └────────────┘  └──────────────┘ │    │
│  │                                                           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

## Component Relationships

```
CREATE OR SUBMIT
     ↓
RequisitionForm → cmmsRequisitionConfirmationService.createRequisitionWithConfirmations()
     ↓
Database: cmms_requisitions (created)
Database: cmms_requisition_confirmations (pending)
     ↓
LOAD & VIEW
     ↓
RequisitionList → cmmsRequisitionConfirmationService.getRequisitionsWithConfirmations()
     ↓
Shows workflow steps → RequisitionConfirmations (if coordinator/supervisor)
                   → AdminApprovalPanel (if admin)
                   → Finance view (if financial officer)
```

## Data Flow

### Creating a Requisition

```
User fills RequisitionForm
           ↓
[Title, Description, Items, Cost, Priority, Date]
           ↓
onSubmit() → cmmsRequisitionConfirmationService.createRequisitionWithConfirmations()
           ↓
Backend Function: create_requisition_with_confirmations()
           ├→ INSERT INTO cmms_requisitions
           ├→ INSERT INTO cmms_requisition_confirmations (admin_approval, pending)
           └→ RETURN requisition_id
           ↓
Alert: "Requisition created. Awaiting admin approval..."
```

### Approving a Requisition (Admin)

```
Admin selects requisition from RequisitionList
           ↓
AdminApprovalPanel loads workflow
           ↓
Admin clicks "Approve" or "Reject"
           ↓
approveRequisitionAsAdmin()
           ↓
Backend Function: approve_requisition_as_admin()
           ├→ UPDATE cmms_requisition_confirmations
           │  (confirmation_status = 'approved'/'rejected')
           ├→ UPDATE cmms_requisitions
           │  (status = 'approved_by_admin'/'rejected_by_admin')
           └→ Log activity
           ↓
Refresh data
```

### Confirming a Requisition (Coordinator/Supervisor)

```
Coordinator/Supervisor selects requisition
           ↓
RequisitionConfirmations loads workflow
           ↓
Optional confirmation form displayed
           ↓
User clicks "Confirm" or "Reject"
           ↓
submitRequisitionConfirmation()
           ↓
Backend Function: submit_requisition_confirmation()
           ├→ INSERT/UPDATE cmms_requisition_confirmations
           │  (confirmation_type = 'coordinator'/'supervisor')
           └→ confirmation_status = 'confirmed'/'rejected'
           ↓
Refresh workflow
```

## Database Schema

```
cmms_requisitions
├── id (PK)
├── cmms_company_id (FK)
├── department_id (FK)
├── requisition_number
├── requested_by (FK)
├── purpose
├── justification
├── urgency_level
├── required_by_date
├── total_estimated_cost
├── status
└── timestamps

cmms_requisition_confirmations (NEW)
├── id (PK)
├── requisition_id (FK)
├── cmms_company_id (FK)
├── confirmed_by (FK)
├── confirmation_type ('admin_approval', 'coordinator_confirmation', 'supervisor_confirmation')
├── is_required (TRUE only for admin_approval)
├── confirmation_status ('pending', 'confirmed', 'rejected')
├── confirmation_notes
└── timestamps

vw_requisitions_with_confirmations (VIEW)
├── Shows requisition data
├── Admin approval status
├── Coordinator confirmation count
├── Supervisor confirmation count
└── Overall workflow status
```

## State Management

### RequisitionForm
```
Local State:
- newRequisition {
    title, description, priority, items[], 
    estimatedCost, requiredByDate
  }
- selectedEquipment, itemQuantity, itemCost
- isSubmitting

Props:
- onSubmit, isSubmitting, companyId, userId, userRole
```

### RequisitionList
```
Props:
- requisitions[] - All requisitions
- isLoading - Loading state
- onRefresh - Refresh callback
- userRole - To determine views
- onSelectRequisition - Selection handler
- onApproveRequisition - Approval handler
- onConfirmRequisition - Confirmation handler

Local State:
- selectedRequisition - Currently expanded
```

### RequisitionConfirmations
```
Local State:
- confirmations[] - All confirmations
- workflow - Full workflow data
- confirmationNotes - User notes
- submittingConfirmation - Loading state
- selectedConfirmationType - Which dialog open

Props:
- requisitionId, requisition
- currentUserId, currentUserRole
- onConfirmationSubmitted
- isLoading
```

### AdminApprovalPanel
```
Local State:
- approvalStatus - pending/approved/rejected
- approvalNotes - Admin's notes
- submittingApproval - Loading state
- selectedAction - approve/reject
- workflow - Full workflow
- error - Error message

Props:
- requisitionId, requisition
- currentUserId, currentUserRole (must be admin)
- onApprovalSubmitted
- isLoading
```

## Permission Matrix

```
                    Create  View   Approve  Confirm  Finance_View
Admin                ✅      ✅     ✅★       ✅       ✅
Coordinator          ✅      ✅     ❌       ✅       ❌
Supervisor           ✅      ✅     ❌       ✅       ❌
Technician           ✅      Own    ❌       ❌       ❌
Financial Officer    ❌      ✅     ❌       ❌       ✅

Legend:
✅ = Can perform
❌ = Cannot perform
✅★ = REQUIRED (must approve before proceeding)
```

## Status Workflow

```
                    ┌─ pending_confirmations
                    │  ├─ Admin must approve (✅★)
                    │  └─ Coordinator/Supervisor can confirm (optional)
                    ↓
         ┌─ approved_by_admin
         │  └─ Coordinator/Supervisor confirmations collected
         ↓
  pending_finance ──→ Admin/Finance review
         ↓
      approved ──→ Can be ordered
         ↓
      ordered ──→ PO placed
         ↓
    delivered ──→ Items received
         ↓
      closed ──→ Requisition complete

REJECTION BRANCH:
rejected_by_admin ──→ Requester must create new requisition
```

## Service Layer Functions

```
cmmsRequisitionConfirmationService

CREATE & INITIALIZE:
├─ createRequisitionWithConfirmations(data)
│  └─ Creates requisition + pending admin_approval confirmation
│
RETRIEVE:
├─ getRequisitionConfirmations(requisitionId)
├─ getRequisitionsWithConfirmations(companyId, status)
├─ getRequisitionApprovalWorkflow(requisitionId)
├─ checkRequisitionPermissions(userId, userRole, requisitionId)
└─ getPendingAdminApprovals(companyId)

SUBMIT ACTIONS:
├─ submitRequisitionConfirmation(requisitionId, userId, type, status, notes)
│  └─ For coordinator_confirmation, supervisor_confirmation
│
└─ approveRequisitionAsAdmin(requisitionId, adminId, status, notes)
   └─ For admin_approval (REQUIRED)
```

## Error Handling

```
Frontend Flow:
1. User submits action
   ↓
2. Try → Call service function
   ↓
3. Service → Call Supabase RPC or query
   ↓
4. If error:
   - Show alert with error message
   - Log to console
   - Return { success: false, error: message }
   ↓
5. If success:
   - Show success alert
   - Reload data
   - Return { success: true, ... }
```

## Component Lifecycle

```
RequisitionForm:
- Mount: Initialize empty form
- Submit: Send data → Create requisition
- Unmount: Not persistent (cleaned up)

RequisitionList:
- Mount: Load requisitions
- Update userRole -> Filter appropriately
- onChange requisitions -> Re-render list
- Refresh: Reload from API

RequisitionConfirmations:
- Mount: Load workflow for requisition
- Select action -> Load form
- Submit: Send confirmation
- Success: Reload workflow

AdminApprovalPanel:
- Mount: Load workflow + approval status
- Click approve/reject -> Load action form
- Submit: Send approval
- Success: Update status
```

## Performance Considerations

1. **Lazy Loading**: Components only render when needed
   - AdminApprovalPanel only renders for admins
   - RequisitionConfirmations only for coordinator/supervisor

2. **Memoization**: Consider React.memo for large lists
   ```jsx
   export default React.memo(RequisitionCard);
   ```

3. **Queries**: Service functions use RLS policies for security
   - Only fetch data user can see
   - Filter at database level

4. **Caching**: Reload on action, not on interval
   - onRefresh() called manually
   - Fresh data after each action

## Security

1. **RLS Policies**: Enforced at database level
   - Admin sees all confirmations
   - Coordinator/Supervisor see company-level
   - Financial Officer read-only
   - Users only insert their own

2. **Role Validation**: 
   - Backend checks role on every function call
   - Frontend shows/hides UI based on role
   - API rejects unauthorized requests

3. **Audit Trail**:
   - All actions logged with timestamps
   - Who confirmed/approved and when
   - Notes recorded for decisions

---

**Last Updated:** February 27, 2026
**Status:** ✅ Architecture Complete
