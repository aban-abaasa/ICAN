# MEMBER APPROVAL SYSTEM - QUICK START GUIDE

## What Is This?

A complete system for requiring unanimous shareholder approval before roster changes can be applied to a business profile.

---

## Key Files & Locations

### Frontend Components

| File | Purpose | Location |
|------|---------|----------|
| ApprovalNotificationCenter.jsx | Bell icon + dropdown notifications | `frontend/src/components/ApprovalNotificationCenter.jsx` |
| PendingApprovalsModal.jsx | Full approval voting interface | `frontend/src/components/PendingApprovalsModal.jsx` |
| BusinessProfileCard.jsx | **UPDATED** - Now includes approval notifications | `frontend/src/components/BusinessProfileCard.jsx` |
| Pitchin.jsx | **UPDATED** - Passes user data to card | `frontend/src/components/Pitchin.jsx` |

### Frontend Services

| File | Purpose | Location |
|------|---------|----------|
| memberApprovalService.js | Approval workflow API calls | `frontend/src/services/memberApprovalService.js` |
| shareholderNotificationService.js | Notification API calls | `frontend/src/services/shareholderNotificationService.js` |

### Backend Database

| File | Purpose | Location |
|------|---------|----------|
| MEMBER_APPROVAL_SYSTEM.sql | Complete schema + functions | `backend/MEMBER_APPROVAL_SYSTEM.sql` |
| SHAREHOLDER_NOTIFICATIONS_SCHEMA.sql | Notification columns + tables | `backend/SHAREHOLDER_NOTIFICATIONS_SCHEMA.sql` |

### Documentation

| File | Purpose |
|------|---------|
| MEMBER_APPROVAL_SYSTEM_COMPLETE.md | Full system overview & implementation summary |
| MEMBER_APPROVAL_UI_INTEGRATION.md | Component usage, workflows, and testing |
| MEMBER_APPROVAL_FORM_INTEGRATION.md | How to integrate into BusinessProfileForm |

---

## Quick Usage

### 1. Show Approval Bell Icon in Business Profile

Already done in:
- `BusinessProfileCard.jsx` - Shows ApprovalNotificationCenter
- `Pitchin.jsx` - Passes currentUserId and currentUserEmail

Result: Members see a bell icon with unread approval count in their business profile card.

### 2. Allow Members to Vote on Approvals

Already done:
- ApprovalNotificationCenter shows dropdown with recent notifications
- Clicking "View All Approvals" opens PendingApprovalsModal
- Members can approve/reject with comments

Result: Members can click the bell and vote on pending approvals.

### 3. Integrate into BusinessProfileForm (NEXT STEP)

Read: `MEMBER_APPROVAL_FORM_INTEGRATION.md`

Tasks:
1. Detect changes to member roster in form
2. Call `memberApprovalService.proposeEdit()` for each change
3. Show approval banner instead of directly updating
4. After unanimous approval, automatically apply changes

---

## How It Works (30-second version)

```
1. Member tries to change shareholder roster
    ↓
2. System creates approval proposal
    ↓
3. ALL members are notified of pending approval
    ↓
4. Members vote via the bell icon dropdown
    ↓
5. Once ALL members approve → change applied automatically
    ↓
6. If ANY member rejects → change blocked, proposal rejected
```

---

## Component Props Reference

### ApprovalNotificationCenter

```javascript
<ApprovalNotificationCenter
  businessProfileId={profile.business_profile_id}  // string (UUID)
  currentUserId={currentUser?.id}                  // string (UUID)
  currentUserEmail={currentUser?.email}            // string (email)
/>
```

### PendingApprovalsModal

```javascript
<PendingApprovalsModal
  businessProfileId={profile.business_profile_id}  // string (UUID)
  currentUserId={currentUser?.id}                  // string (UUID)
  onClose={() => setShowModal(false)}              // function
/>
```

### BusinessProfileCard (Updated Props)

```javascript
<BusinessProfileCard
  profile={businessProfile}                        // object
  currentUserId={currentUser?.id}                  // NEW
  currentUserEmail={currentUser?.email}            // NEW
  onEdit={() => {}}                                // function
  onSelect={() => {}}                              // function
  isMember={true}                                  // boolean
/>
```

---

## Service Methods

### memberApprovalService

```javascript
import { memberApprovalService } from '../services/memberApprovalService';

// Propose a change
const result = await memberApprovalService.proposeEdit({
  businessId: 'uuid',
  userId: 'uuid',
  email: 'user@example.com',
  name: 'John Doe',
  editType: 'add_member',  // or 'remove_member', 'update_member'
  oldValue: null,
  newValue: { member_data },
  description: 'Add John as co-owner'
});

// Get pending approvals
const pending = await memberApprovalService.getPendingEdits(businessId);

// Vote to approve
await memberApprovalService.approveEdit(approvalId, memberId, optionalComment);

// Vote to reject
await memberApprovalService.rejectEdit(approvalId, memberId, requiredReason);

// Get my pending approvals
const myApprovals = await memberApprovalService.getApprovalNotifications(userId);

// Subscribe to real-time updates
const subscription = memberApprovalService.subscribeToApprovalUpdates(
  businessId,
  (updatedApprovals) => console.log('Updates:', updatedApprovals)
);
```

---

## Database Tables

### pending_edits
Tracks all proposed changes:

```sql
edit_id              UUID PRIMARY KEY
business_id          UUID  -- Which business
proposed_by_id       UUID  -- Who proposed
proposed_by_name     TEXT
edit_type            VARCHAR -- 'add_member', 'remove_member', 'update_member'
old_value            JSONB -- Previous value
new_value            JSONB -- Proposed new value
status               VARCHAR -- 'pending', 'approved', 'rejected', 'applied'
approval_required_count   INT -- How many members total
approval_received_count   INT -- How many approved so far
created_at           TIMESTAMP
expires_at           TIMESTAMP -- 7 days from creation
```

### member_approvals
Records each member's vote:

```sql
id                   UUID PRIMARY KEY
edit_id              UUID -- References pending_edits
member_id            UUID -- Member voting
member_email         TEXT
status               VARCHAR -- 'pending', 'approved', 'rejected'
comment              TEXT -- Optional comment/reason
responded_at         TIMESTAMP -- When they voted
```

---

## UI Elements

### Bell Icon Location

```
BusinessProfileCard Header
├── [🔔 Approval Bell] ← ApprovalNotificationCenter
│   ├── Unread badge showing count
│   ├── Dropdown showing recent notifications
│   └── "View All Approvals" button
├── [📢 Notification Settings]
└── [✏️ Edit]
```

### Modal Flow

```
Bell Icon Dropdown
    ↓ (Click "View All Approvals")
PendingApprovalsModal
    ├── Lists all pending edits
    ├── Shows approval progress bar
    ├── Lists member votes (✓ ✗ ⏳)
    └── Approve/Reject buttons with comments
```

---

## Testing This System

### Test 1: See Approval Bell Icon

1. Open Pitchin.jsx dashboard
2. Look at business profile card header
3. Should see bell icon (ApprovalNotificationCenter) next to notification settings

### Test 2: Create Approval Proposal

1. In database, run: `SELECT * FROM pending_edits;` (should be empty)
2. Call `memberApprovalService.proposeEdit()` with test data
3. Check database: should see new entry in pending_edits
4. Check notifications: should see approval request in bell dropdown

### Test 3: Vote on Approval

1. Open modal from bell dropdown
2. Should see pending edit with approval progress
3. Click "Approve" button
4. Modal refreshes, your vote shows ✓
5. If all members voted, edit marked as 'applied'

### Test 4: Real-Time Updates

1. New member approves in another browser tab
2. Modal should update in real-time
3. Progress bar and member list update automatically

---

## Common Issues & Fixes

### Issue: Bell icon not showing
**Solution:** Verify `isMember={true}` and `currentUserId` props are passed to BusinessProfileCard

### Issue: Modal loads forever
**Solution:** Check businessProfileId is valid UUID and memberApprovalService has RPC access

### Issue: Can't approve
**Solution:** Verify current user is in business_profile_members and approved_by_count < required_count

### Issue: Comment field showing error
**Solution:** For rejection, comment is required. For approval, it's optional.

---

## What's Already Done ✅

| Feature | Status |
|---------|--------|
| Database schema created | ✅ DONE |
| Service methods built | ✅ DONE |
| ApprovalsNotificationCenter component | ✅ DONE |
| PendingApprovalsModal component | ✅ DONE |
| BusinessProfileCard integration | ✅ DONE |
| Real-time subscriptions | ✅ DONE |
| Auto-approval after unanimous vote | ✅ DONE (in SQL) |
| Error handling | ✅ DONE |

---

## What's Left To Do (Next Steps)

| Task | Effort | Impact |
|------|--------|--------|
| Integrate into BusinessProfileForm | Medium | High - Blocks actual usage |
| Add email notifications | High | Medium - Better UX |
| Create dashboard for approval history | Medium | Low - Nice-to-have |
| Add approval deadline timers | Low | Low - Nice-to-have |

---

## File Relationships

```
Pitchin.jsx
├── BusinessProfileCard.jsx
│   └── ApprovalNotificationCenter.jsx
│       ├── memberApprovalService.js
│       │   └── MEMBER_APPROVAL_SYSTEM.sql
│       │
│       └── PendingApprovalsModal.jsx
│           └── memberApprovalService.js
│
└── (Future) BusinessProfileForm.jsx
    └── memberApprovalService.js
```

---

## Key Concepts

**Unanimous Approval:** All members must approve (100% consensus)

**Auto-Approval of Proposer:** Person making proposal automatically approves their own change

**7-Day Expiration:** If not all members vote within 7 days, proposal expires and original values are kept

**Real-Time Updates:** Uses Supabase subscriptions so members see votes as they happen

**Edit Types:** Three types of changes can be proposed:
- `add_member` - Add new shareholder
- `remove_member` - Remove shareholder
- `update_member` - Change shareholder details (share %, role, etc.)

---

## Quick Links

- **Component Usage:** See `MEMBER_APPROVAL_UI_INTEGRATION.md`
- **Form Integration:** See `MEMBER_APPROVAL_FORM_INTEGRATION.md`
- **Full Details:** See `MEMBER_APPROVAL_SYSTEM_COMPLETE.md`

---

## Contact & Questions

If you need to modify or extend this system:

1. First read the relevant documentation file
2. Check the database schema in MEMBER_APPROVAL_SYSTEM.sql
3. Review the service methods in memberApprovalService.js
4. Look at component props and state management

---

**System Ready for:** Integration into BusinessProfileForm ✅

**Estimated Next Effort:** 4-6 hours to fully integrate form workflow
