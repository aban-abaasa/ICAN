# CMMS Requisition System - Quick Reference Guide

## 📦 Component Quick Links

### RequisitionForm
**File:** `frontend/src/components/CMMS/RequisitionForm.jsx`
**Purpose:** Create new maintenance requisitions
**For:** Technicians, Supervisors, Coordinators

```jsx
<RequisitionForm
  onSubmit={handleCreateRequisition}
  isSubmitting={isSubmitting}
  companyId={companyId}
  userId={user?.id}
  userRole={userRole}
/>
```

---

### RequisitionList
**File:** `frontend/src/components/CMMS/RequisitionList.jsx`
**Purpose:** Display all requisitions with status
**For:** All roles

```jsx
<RequisitionList
  requisitions={requisitions}
  isLoading={isLoading}
  onRefresh={loadRequisitions}
  userRole={userRole}
  onSelectRequisition={setSelected}
  onApproveRequisition={handleApprove}
  onConfirmRequisition={handleConfirm}
/>
```

---

### AdminApprovalPanel
**File:** `frontend/src/components/CMMS/AdminApprovalPanel.jsx`
**Purpose:** REQUIRED admin approval
**For:** Admin only

```jsx
{userRole === 'admin' && selectedRequisition && (
  <AdminApprovalPanel
    requisitionId={selectedRequisition.id}
    requisition={selectedRequisition}
    currentUserId={user?.id}
    currentUserRole={userRole}
    onApprovalSubmitted={handleApprovalDone}
  />
)}
```

---

### RequisitionConfirmations
**File:** `frontend/src/components/CMMS/RequisitionConfirmations.jsx`
**Purpose:** Optional coordinator/supervisor confirmations
**For:** Coordinator, Supervisor, Admin

```jsx
{(userRole === 'coordinator' || userRole === 'supervisor') && selectedRequisition && (
  <RequisitionConfirmations
    requisitionId={selectedRequisition.id}
    requisition={selectedRequisition}
    currentUserId={user?.id}
    currentUserRole={userRole}
    onConfirmationSubmitted={handleConfirmDone}
  />
)}
```

---

## 🔧 Service Functions

**File:** `frontend/src/lib/supabase/services/cmmsRequisitionConfirmationService.js`

### Create Requisition
```javascript
await cmmsRequisitionConfirmationService.createRequisitionWithConfirmations({
  cmms_company_id: companyId,
  department_id: departmentId,
  requested_by: userId,
  purpose: "AC Repair",
  justification: "Unit not cooling",
  urgency_level: "urgent",
  required_by_date: "2026-03-01",
  total_estimated_cost: 50000
});
```

### Admin Approve
```javascript
await cmmsRequisitionConfirmationService.approveRequisitionAsAdmin(
  requisitionId,
  adminId,
  'approved', // or 'rejected'
  'Notes here'
);
```

### Coordinator/Supervisor Confirm
```javascript
await cmmsRequisitionConfirmationService.submitRequisitionConfirmation(
  requisitionId,
  userId,
  'coordinator_confirmation', // or 'supervisor_confirmation'
  'confirmed', // or 'rejected'
  'Notes here'
);
```

### Load Workflow
```javascript
const result = await cmmsRequisitionConfirmationService.getRequisitionApprovalWorkflow(requisitionId);
// result.workflow contains full approval steps
```

### Get Pending Approvals (for Admin dashboard)
```javascript
const pending = await cmmsRequisitionConfirmationService.getPendingAdminApprovals(companyId);
// Shows only requisitions awaiting admin approval
```

---

## 📊 Status Values

```
REQUISITION STATUS:
- pending_confirmations    = Created, awaiting admin approval
- approved_by_admin        = Admin approved
- rejected_by_admin        = Admin rejected
- pending_finance          = Awaiting finance review
- approved                 = Fully approved
- ordered                  = PO placed
- delivered                = Items received
- closed                   = Completed

CONFIRMATION STATUS:
- pending                  = Awaiting action
- confirmed                = User confirmed
- rejected                 = User rejected

CONFIRMATION TYPES:
- admin_approval           = REQUIRED approval
- coordinator_confirmation = Optional confirmation
- supervisor_confirmation  = Optional confirmation
```

---

## 🔐 Permission Check

```javascript
// Check if user can perform action
const permissions = await cmmsRequisitionConfirmationService.checkRequisitionPermissions(
  userId,
  userRole,
  requisitionId
);

// permissions.canViewRequisition
// permissions.canApproveRequisition (admin only)
// permissions.canConfirmRequisition (coordinator/supervisor)
```

---

## 📑 Integration Steps

### Step 1: Copy Components
```bash
cp RequisitionForm.jsx           → frontend/src/components/CMMS/
cp RequisitionList.jsx           → frontend/src/components/CMMS/
cp RequisitionConfirmations.jsx  → frontend/src/components/CMMS/
cp AdminApprovalPanel.jsx        → frontend/src/components/CMMS/
```

### Step 2: Copy Service
```bash
cp cmmsRequisitionConfirmationService.js → frontend/src/lib/supabase/services/
```

### Step 3: Run SQL
```sql
-- Execute in Supabase SQL Editor:
-- Copy all content from CMMS_REQUISITION_CONFIRMATIONS_SETUP.sql
```

### Step 4: Update CMSSModule.jsx
```javascript
// After imports:
import RequisitionForm from './CMMS/RequisitionForm';
import RequisitionList from './CMMS/RequisitionList';
import RequisitionConfirmations from './CMMS/RequisitionConfirmations';
import AdminApprovalPanel from './CMMS/AdminApprovalPanel';

// In RequisitionManager return statement:
return (
  <div className="space-y-6">
    <RequisitionForm ... />
    <RequisitionList ... />
    {userRole === 'admin' && selectedRequisition && <AdminApprovalPanel ... />}
    {(userRole === 'coordinator' || userRole === 'supervisor') && selectedRequisition && <RequisitionConfirmations ... />}
  </div>
);
```

---

## 🎯 Common Tasks

### Show All Requisitions
```jsx
<RequisitionList
  requisitions={requisitions}
  isLoading={loading}
  onRefresh={loadRequisitions}
  userRole={userRole}
/>
```

### Show Pending Approvals (Admin Dashboard)
```jsx
const [pendingApprovals, setPendingApprovals] = useState([]);

useEffect(() => {
  const load = async () => {
    const pending = await cmmsRequisitionConfirmationService.getPendingAdminApprovals(companyId);
    setPendingApprovals(pending);
  };
  load();
}, [companyId]);

// Show as badge or counter
<span className="badge">{pendingApprovals.length} pending</span>
```

### Auto-Load Workflow on Selection
```jsx
const [workflow, setWorkflow] = useState(null);

const handleSelectRequisition = async (req) => {
  const result = await cmmsRequisitionConfirmationService.getRequisitionApprovalWorkflow(req.id);
  if (result.success) {
    setWorkflow(result.workflow);
  }
};
```

### Handle Approval Action
```jsx
const handleApprove = async (requisitionId) => {
  const result = await cmmsRequisitionConfirmationService.approveRequisitionAsAdmin(
    requisitionId,
    user.id,
    'approved',
    approvalNotes
  );
  
  if (result.success) {
    alert('✅ Approved!');
    await loadRequisitions(); // Refresh list
  }
};
```

---

## 🐛 Troubleshooting

### "Only admins can approve" error
- Check `currentUserRole` is 'admin'
- Verify user role in `cmms_users` table

### "User not found" error
- Ensure `userId` exists in `cmms_users`
- Check authentication context

### "Requisition not found" error
- Verify `requisitionId` UUID is valid
- Check requisition exists in `cmms_requisitions`

### Permissions denied in RLS
- Check RLS policies in database
- Verify user's company_id matches
- Ensure `auth.uid()` is set correctly

### Workflow not loading
- Check `requisitionId` is valid
- Verify requisition has confirmations created
- Check browser console for detailed error

---

## 📝 SQL Queries Reference

```sql
-- Get all confirmations for a requisition
SELECT * FROM cmms_requisition_confirmations 
WHERE requisition_id = '...' 
ORDER BY confirmation_type, created_at DESC;

-- Get pending admin approvals
SELECT * FROM cmms_requisitions 
WHERE cmms_company_id = '...'
AND status = 'pending_confirmations'
ORDER BY requisition_date ASC;

-- Get requisition with confirmations view
SELECT * FROM vw_requisitions_with_confirmations 
WHERE id = '...'
AND cmms_company_id = '...';

-- Get coordinator confirmations count
SELECT COUNT(*) FROM cmms_requisition_confirmations 
WHERE requisition_id = '...' 
AND confirmation_type = 'coordinator_confirmation'
AND confirmation_status = 'confirmed';
```

---

## 📦 File Structure

```
frontend/
├── src/
│   ├── components/
│   │   └── CMMS/
│   │       ├── RequisitionForm.jsx           ✅ NEW
│   │       ├── RequisitionList.jsx           ✅ NEW
│   │       ├── RequisitionConfirmations.jsx  ✅ NEW
│   │       ├── AdminApprovalPanel.jsx        ✅ NEW
│   │       └── CMSSRequisitionManager.jsx    ✅ NEW (reference)
│   └── lib/
│       └── supabase/
│           └── services/
│               └── cmmsRequisitionConfirmationService.js ✅ NEW
└── CMMS_FRONTEND_SEPARATION_SUMMARY.md      ✅ NEW (docs)
└── CMMS_ARCHITECTURE_DIAGRAM.md             ✅ NEW (docs)

backend/
└── CMMS_REQUISITION_CONFIRMATIONS_SETUP.sql ✅ NEW (database)
```

---

## 🚀 Deployment Checklist

- [ ] All 4 components copied to `frontend/src/components/CMMS/`
- [ ] Service copied to `frontend/src/lib/supabase/services/`
- [ ] SQL setup executed in Supabase
- [ ] Components imported in CMSSModule
- [ ] RequisitionManager updated to use components
- [ ] Test create requisition (technician)
- [ ] Test view list (all roles)
- [ ] Test admin approve (admin only)
- [ ] Test confirm (coordinator/supervisor)
- [ ] Test financial view (financial officer read-only)
- [ ] Verify RLS policies blocking unauthorized access
- [ ] Check browser console for errors
- [ ] Test on different roles/companies

---

## 📞 Support Files

- `CMMS_FRONTEND_SEPARATION_SUMMARY.md` - Overview of changes
- `CMMS_ARCHITECTURE_DIAGRAM.md` - Detailed architecture
- `CMSSRequisitionManager.jsx` - Full integration example
- `CMMS_REQUISITION_CONFIRMATIONS_SETUP.sql` - Database setup

---

**Last Updated:** February 27, 2026
**Version:** 1.0
**Status:** ✅ Ready for Use
