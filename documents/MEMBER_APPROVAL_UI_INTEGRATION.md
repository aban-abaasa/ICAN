# MEMBER APPROVAL SYSTEM - UI INTEGRATION GUIDE

## Overview

The Member Approval System consists of three main React components that work together to provide a complete workflow for approving shareholder roster changes:

### Components

1. **ApprovalNotificationCenter** - Bell icon with dropdown showing pending approvals
2. **PendingApprovalsModal** - Full-screen modal for viewing and voting on approvals
3. **BusinessProfileCard** - Updated to include approval notifications

---

## Component Details

### 1. ApprovalNotificationCenter.jsx

**Purpose:** Displays approval notifications and provides quick access to pending approvals

**Location:** `frontend/src/components/ApprovalNotificationCenter.jsx`

**Props:**
- `businessProfileId` (string) - ID of the business profile
- `currentUserId` (string) - UUID of the current user
- `currentUserEmail` (string) - Email of the current user

**Functionality:**
- Shows bell icon with unread count badge
- Dropdown menu with pending approval notifications
- Real-time subscription to approval updates
- "View All Approvals" button opens the full modal

**Key Features:**
- Real-time updates via `memberApprovalService.subscribeToApprovalUpdates()`
- Filters notifications by business profile
- Unread count badge shows pending approvals
- Hover tooltip explains approval workflow

**Usage in BusinessProfileCard:**
```jsx
<ApprovalNotificationCenter
  businessProfileId={profile.business_profile_id}
  currentUserId={currentUser?.id}
  currentUserEmail={currentUser?.email}
/>
```

---

### 2. PendingApprovalsModal.jsx

**Purpose:** Full-screen modal for viewing all pending approvals and allowing members to vote

**Location:** `frontend/src/components/PendingApprovalsModal.jsx`

**Props:**
- `businessProfileId` (string) - ID of the business profile
- `currentUserId` (string) - UUID of the current user
- `onClose` (function) - Callback when modal is closed

**Functionality:**
- Lists all pending edits with approval status
- Shows approval progress bar (X/Y members approved)
- Lists all members and their approval status (✓ Approved, ✗ Rejected, ⏳ Pending)
- Allows member to approve or reject pending approvals
- Required comment field for rejections (optional for approvals)
- Real-time loading of pending edits
- Displays rejection reason if edit was rejected

**Edit Types Display:**
- `add_member` → "➕ Add Member"
- `remove_member` → "➖ Remove Member"
- `update_member` → "✏️ Update Member"

**Status Indicators:**
- ✓ APPROVED (green) - Edit was unanimously approved
- ✗ REJECTED (red) - Edit was rejected by at least one member
- ⏳ PENDING (yellow) - Awaiting member approvals

**Member Approval Status Icons:**
- ✓ Green checkmark - Member approved
- ✗ Red X mark - Member rejected
- ⏳ Yellow clock - Member hasn't responded yet

**Service Integration:**
```javascript
// Load pending edits
const edits = await memberApprovalService.getPendingEdits(businessProfileId);

// Load individual approvals
const editApprovals = await memberApprovalService.getPendingEditApprovals(editId);

// Approve an edit
await memberApprovalService.approveEdit(approvalId, currentUserId, optionalComment);

// Reject an edit
await memberApprovalService.rejectEdit(approvalId, currentUserId, requiredReason);
```

---

### 3. BusinessProfileCard.jsx

**Updated Functionality:**

The card now includes the `ApprovalNotificationCenter` component in the header:

```jsx
<BusinessProfileCard 
  profile={currentBusinessProfile} 
  onEdit={() => setShowProfileSelector(true)}
  onSelect={() => {}}
  isMember={true}
  currentUserId={currentUser?.id}
  currentUserEmail={currentUser?.email}
  onNotification={() => console.log('Member notification clicked')}
/>
```

**New Props:**
- `currentUserId` (string) - Current user's UUID
- `currentUserEmail` (string) - Current user's email

**UI Changes:**
- Approval bell icon appears to the left of notification settings bell
- Shows unread approval count badge
- Bell icon has dropdown with pending approvals
- Clicking "View All Approvals" opens the full modal

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Member tries to edit shareholder roster in BusinessProfile  │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
        ┌──────────────────────────────┐
        │ Call memberApprovalService   │
        │ .proposeEdit()               │
        └──────────┬───────────────────┘
                   │
                   ▼
    ┌─────────────────────────────────┐
    │ MEMBER_APPROVAL_SYSTEM.sql      │
    │ - Creates pending_edit record   │
    │ - Creates member_approvals      │
    │ - Auto-approves proposer        │
    │ - Sends notifications           │
    └──────────┬────────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ ApprovalNotificationCenter       │
    │ - Shows bell icon with badge     │
    │ - Real-time updates via RLS      │
    │ - Dropdown with notifications    │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ Member clicks notification       │
    │ or "View All Approvals"          │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ PendingApprovalsModal opens      │
    │ - Shows all pending edits        │
    │ - Shows approval progress        │
    │ - Lists member statuses          │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ Member votes (Approve/Reject)    │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ memberApprovalService            │
    │ .approveEdit() or .rejectEdit()  │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │ MEMBER_APPROVAL_SYSTEM.sql       │
    │ - Updates member_approvals       │
    │ - Checks unanimous approval      │
    │ - Updates pending_edit status    │
    └──────────┬───────────────────────┘
               │
               ├─ If all approved → apply_approved_edit()
               │
               └─ If rejected → mark as rejected
```

---

## Integration Steps

### Step 1: Updated BusinessProfileCard Component

The component now imports and includes `ApprovalNotificationCenter`:

```jsx
import ApprovalNotificationCenter from './ApprovalNotificationCenter';

// In the header icon area:
{isMember && currentUserId && (
  <ApprovalNotificationCenter
    businessProfileId={profile.business_profile_id}
    currentUserId={currentUserId}
    currentUserEmail={currentUserEmail}
  />
)}
```

### Step 2: Pass User Data from Parent Components

When rendering `BusinessProfileCard`, pass current user info:

```jsx
<BusinessProfileCard 
  profile={currentBusinessProfile} 
  currentUserId={currentUser?.id}
  currentUserEmail={currentUser?.email}
  isMember={true}
/>
```

### Step 3: Real-Time Updates

The system uses Supabase RLS subscriptions for real-time updates:

```javascript
// In ApprovalNotificationCenter:
const subscription = memberApprovalService.subscribeToApprovalUpdates(
  businessProfileId,
  (updatedApprovals) => {
    // Update UI with new approval status
  }
);
```

---

## User Workflows

### Workflow 1: Member Receives Approval Request

1. Member is a shareholder in a business
2. Another member proposes adding/removing/updating a shareholder
3. In `ApprovalNotificationCenter`:
   - Bell icon shows unread count badge
   - Dropdown shows notification about the pending edit
4. Member clicks notification or "View All Approvals"
5. `PendingApprovalsModal` opens showing:
   - Edit details
   - Approval progress (1/3 members approved)
   - List of who approved/rejected/pending
   - Option to approve or reject

### Workflow 2: Member Approves a Change

1. Member opens `PendingApprovalsModal`
2. Finds pending edit they haven't voted on yet
3. Optionally adds a comment
4. Clicks "Approve" button
5. Service calls `memberApprovalService.approveEdit()`
6. Backend updates `member_approvals` table
7. Progress bar updates in real-time
8. If all members approved, change is automatically applied
9. Notifications sent to all members

### Workflow 3: Member Rejects a Change

1. Member opens `PendingApprovalsModal`
2. Finds pending edit they haven't voted on yet
3. Enters a reason for rejection (required)
4. Clicks "Reject" button
5. Service calls `memberApprovalService.rejectEdit()`
6. Backend marks edit as rejected
7. Rejection reason displayed to all members
8. Original values retained (change not applied)

---

## Error Handling

### In ApprovalNotificationCenter:
```javascript
try {
  const approvals = await memberApprovalService.getApprovalNotifications(currentUserId);
  setNotifications(approvals);
} catch (error) {
  console.error('Error loading approval notifications:', error);
  // UI shows empty state
}
```

### In PendingApprovalsModal:
```javascript
if (result.success) {
  // Reload data
  loadPendingEdits();
} else {
  alert('❌ Error approving: ' + result.error);
}
```

---

## Database Tables Referenced

### pending_edits
- `edit_id` - Primary key
- `business_id` - Which business
- `proposed_by_id` - Who proposed it
- `edit_type` - (add_member, remove_member, update_member)
- `old_value` - Previous value (JSONB)
- `new_value` - Proposed value (JSONB)
- `status` - (pending, approved, rejected, applied)
- `approval_required_count` - Number of members needed
- `approval_received_count` - Current approval count
- `created_at` / `expires_at` - 7-day expiration

### member_approvals
- `id` - Primary key
- `edit_id` - References pending_edits
- `member_id` - Member voting
- `member_email` - Member email for display
- `status` - (pending, approved, rejected)
- `comment` - Optional comment
- `responded_at` - When they voted
- `created_at` - When approval was created

---

## Visual Indicators

### In BusinessProfileCard Header:
```
[🔔 with "2" badge] [🔔 Settings] [✏️ Edit]
 └─ Approval bell      └─ Notification   └─ Edit profile
    with unread count     settings
```

### In ApprovalNotificationCenter Dropdown:
- Status icons next to each notification
- ✓ APPROVED (green)
- ✗ REJECTED (red)
- ⏳ PENDING (yellow)

### In PendingApprovalsModal:
- Progress bar shows % of members approved
- Member status: ✓ (green), ✗ (red), ⏳ (yellow)
- Edit status pill: ✓ APPROVED, ✗ REJECTED, ⏳ PENDING

---

## Dependencies

**React Components:**
- lucide-react (icons)
- ApprovalNotificationCenter → PendingApprovalsModal
- BusinessProfileCard → ApprovalNotificationCenter

**Services:**
- memberApprovalService.js (all RPC calls)
- shareholderNotificationService.js (underlying notifications)

**Database:**
- MEMBER_APPROVAL_SYSTEM.sql (tables, functions, RLS)
- SHAREHOLDER_NOTIFICATIONS_SCHEMA.sql (notification columns)

---

## Testing Checklist

- [ ] Bell icon appears in BusinessProfileCard when isMember=true
- [ ] Unread count badge shows correct number
- [ ] Dropdown displays pending approvals
- [ ] "View All Approvals" button opens modal
- [ ] Modal loads pending edits from database
- [ ] Approval progress bar calculates correctly
- [ ] Member status icons display properly
- [ ] Can approve with optional comment
- [ ] Can reject with required comment
- [ ] Real-time updates when another member votes
- [ ] Modal closes and reloads on successful vote
- [ ] Error messages display for failed operations
- [ ] Empty state shows when no pending approvals
- [ ] 7-day expiration timer displays
- [ ] Auto-application occurs after unanimous approval

---

## Next Steps

1. **Integrate into BusinessProfileForm** - Add approval workflow to edit member flow
2. **Handle Approval Expiration** - Create background job to clean up 7-day expired approvals
3. **Member Approval Dashboard** - Create separate page to review all historical approvals
4. **Notification Email Templates** - Create email notifying members of pending approvals
5. **Analytics & Reporting** - Track approval workflow metrics
