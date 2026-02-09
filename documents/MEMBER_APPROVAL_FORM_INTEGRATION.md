# MEMBER APPROVAL WORKFLOW - BUSINESSPROFILEFORM INTEGRATION

## Overview

When a member tries to edit the shareholder roster (add, remove, or update shareholders) in the `BusinessProfileForm`, the system should:

1. Detect which specific fields are being changed
2. Create an approval proposal via `memberApprovalService.proposeEdit()`
3. Notify all shareholders of the pending approval
4. Show the PendingApprovalsModal to the member
5. Only apply changes once all members approve

---

## Integration Points in BusinessProfileForm

### 1. Detect Member List Changes

**Current State:** The form has an "owners" step where members can be added/removed

**Location:** `frontend/src/components/BusinessProfileForm.jsx` - Step 2 (owners step)

**Detection Logic:**
```javascript
// When saving the form, compare old vs new owners array
const oldOwners = currentProfile.business_co_owners || [];
const newOwners = profile.business_co_owners || [];

// Detect changes
const addedMembers = newOwners.filter(n => !oldOwners.find(o => o.owner_id === n.owner_id));
const removedMembers = oldOwners.filter(o => !newOwners.find(n => n.owner_id === o.owner_id));
const updatedMembers = newOwners.filter(n => {
  const oldMember = oldOwners.find(o => o.owner_id === n.owner_id);
  return oldMember && JSON.stringify(oldMember) !== JSON.stringify(n);
});
```

### 2. Propose Edit for Each Change

**Service Method:** `memberApprovalService.proposeEdit()`

**Parameters:**
```javascript
{
  businessId,           // business_profile_id
  userId,              // currentUser.id
  email,               // currentUser.email
  name,                // currentUser name
  editType,            // 'add_member' | 'remove_member' | 'update_member'
  oldValue,            // JSONB of old member data
  newValue,            // JSONB of new member data
  description          // Human-readable description
}
```

**Example Usage:**
```javascript
// For adding a member
const result = await memberApprovalService.proposeEdit({
  businessId: profile.business_profile_id,
  userId: currentUser.id,
  email: currentUser.email,
  name: currentUser.user_metadata?.full_name || currentUser.email,
  editType: 'add_member',
  oldValue: null,
  newValue: {
    owner_name: newMember.owner_name,
    email: newMember.email,
    ownership_share: newMember.ownership_share,
    role: newMember.role
  },
  description: `Add ${newMember.owner_name} as co-owner with ${newMember.ownership_share}% share`
});

if (result.success) {
  console.log('Approval proposed. ID:', result.pending_edit_id);
  // Show success message and pending approval view
} else {
  console.error('Failed to propose edit:', result.error);
}
```

### 3. Handle Multiple Changes

**Challenge:** If user changes multiple owners in one form submission, create a proposal for each change

**Implementation:**
```javascript
// In handleCreateProfile or handleSubmit
const proposals = [];

// Propose each added member
for (const addedMember of addedMembers) {
  const proposal = await memberApprovalService.proposeEdit({
    businessId: profile.business_profile_id,
    userId: currentUser.id,
    email: currentUser.email,
    name: currentUserName,
    editType: 'add_member',
    oldValue: null,
    newValue: JSON.stringify(addedMember),
    description: `Add ${addedMember.owner_name} with ${addedMember.ownership_share}% ownership`
  });
  proposals.push(proposal);
}

// Propose each removed member
for (const removedMember of removedMembers) {
  const proposal = await memberApprovalService.proposeEdit({
    businessId: profile.business_profile_id,
    userId: currentUser.id,
    email: currentUser.email,
    name: currentUserName,
    editType: 'remove_member',
    oldValue: JSON.stringify(removedMember),
    newValue: null,
    description: `Remove ${removedMember.owner_name} from shareholders`
  });
  proposals.push(proposal);
}

// Propose each updated member
for (const updatedMember of updatedMembers) {
  const oldVersion = oldOwners.find(o => o.owner_id === updatedMember.owner_id);
  const proposal = await memberApprovalService.proposeEdit({
    businessId: profile.business_profile_id,
    userId: currentUser.id,
    email: currentUser.email,
    name: currentUserName,
    editType: 'update_member',
    oldValue: JSON.stringify(oldVersion),
    newValue: JSON.stringify(updatedMember),
    description: `Update ${updatedMember.owner_name} details`
  });
  proposals.push(proposal);
}

// Check if any proposals failed
const failedProposals = proposals.filter(p => !p.success);
if (failedProposals.length > 0) {
  alert(`⚠️ Failed to propose ${failedProposals.length} changes. Please try again.`);
  return;
}

// All proposals successful
alert(`✅ ${proposals.length} change(s) proposed for approval`);

// Optionally show modal with pending approvals
setShowPendingApprovalsModal(true);
```

### 4. Prevent Direct Member Updates

**Current Behavior:** Currently members are updated directly in the database

**New Behavior:** 
- Instead of calling `updateBusinessProfile()` with member changes
- Call `memberApprovalService.proposeEdit()` for each member change
- Show pending approval view
- Changes are applied automatically via `apply_approved_edit()` once unanimous approval is reached

**Implementation in handleCreateProfile:**
```javascript
const handleCreateProfile = async (formData) => {
  try {
    // Only save non-member fields directly
    const nonMemberData = {
      business_name: formData.business_name,
      business_type: formData.business_type,
      description: formData.description,
      founded_year: formData.founded_year,
      business_address: formData.business_address,
      website: formData.website,
      total_capital: formData.total_capital,
      // Notification settings
      notify_on_share_purchase: formData.notify_on_share_purchase,
      notify_on_partner_investment: formData.notify_on_partner_investment,
      notify_on_support: formData.notify_on_support,
      notify_on_investment_signed: formData.notify_on_investment_signed,
      notify_via_email: formData.notify_via_email,
      notify_via_push_notification: formData.notify_via_push_notification,
      notify_via_in_app: formData.notify_via_in_app,
      shareholder_notification_level: formData.shareholder_notification_level,
      // Note: Don't include business_co_owners here
    };

    // Save general business info directly
    await pitchingService.updateBusinessProfile(
      profile.business_profile_id,
      nonMemberData
    );

    // Handle member changes separately through approval workflow
    if (memberChangesDetected(formData)) {
      const proposals = await proposeMemberChanges(formData);
      
      if (allProposalsSuccessful(proposals)) {
        // Show pending approvals
        setShowPendingApprovalsModal(true);
        setStep(6); // Go to review step
        alert(`✅ ${proposals.length} member change(s) proposed for approval`);
      } else {
        alert('❌ Failed to propose some member changes');
      }
    } else {
      setStep(6);
      alert('✅ Profile updated successfully');
    }
  } catch (error) {
    console.error('Error saving profile:', error);
    alert('❌ Error saving profile: ' + error.message);
  }
};
```

---

## UI Changes Needed

### 1. Add Modal State to BusinessProfileForm

```javascript
const [showPendingApprovalsModal, setShowPendingApprovalsModal] = useState(false);
const [pendingProposalCount, setPendingProposalCount] = useState(0);
```

### 2. Add Approval Status in Form

When changes are proposed, show a banner:

```jsx
{pendingProposalCount > 0 && (
  <div className="bg-yellow-900/20 border border-yellow-500/50 rounded-lg p-4 mb-4">
    <div className="flex items-center gap-3">
      <Clock className="w-5 h-5 text-yellow-400" />
      <div>
        <p className="font-semibold text-yellow-300">
          ⏳ {pendingProposalCount} Pending Approval{pendingProposalCount !== 1 ? 's' : ''}
        </p>
        <p className="text-yellow-200 text-sm">
          All shareholders must approve these changes. You'll be notified once voting is complete.
        </p>
      </div>
    </div>
  </div>
)}
```

### 3. Modify Owners Step UI

Add a note that changes require approval:

```jsx
<div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-3 mb-4">
  <div className="flex items-center gap-2">
    <AlertCircle className="w-4 h-4 text-blue-400" />
    <p className="text-blue-300 text-sm">
      Any changes to the shareholder roster will require unanimous approval from all members.
    </p>
  </div>
</div>
```

---

## Database Flow

### When Member Proposes Change:

```
BusinessProfileForm
       ↓
memberApprovalService.proposeEdit()
       ↓
MEMBER_APPROVAL_SYSTEM.propose_member_edit() [SQL Function]
       ↓
INSERT pending_edits (status = 'pending')
INSERT member_approvals (for ALL members, proposer auto-approved)
CALL notify_members_approval_needed()
       ↓
shareholder_notifications table updated
       ↓
Return pending_edit_id to frontend
```

### When All Members Approve:

```
Member votes in PendingApprovalsModal
       ↓
memberApprovalService.approveEdit()
       ↓
MEMBER_APPROVAL_SYSTEM.respond_to_edit() [SQL Function]
       ↓
UPDATE member_approvals (status = 'approved')
UPDATE pending_edits (approval_received_count += 1)
CHECK if unanimous approval reached
       ↓
IF all approved:
  CALL apply_approved_edit()
  UPDATE business_co_owners with new_value
ELSE:
  Wait for more votes
```

---

## Edge Cases to Handle

### 1. What if proposer is the only member?
- Auto-approval happens
- Change is applied immediately
- No voting needed

### 2. What if new member is added but not yet in business_co_owners?
- Still create approval proposal
- Other members can vote on adding them
- Once approved, they're added to roster

### 3. What if user cancels form without submitting?
- No proposals created
- No approval flow started

### 4. What if member leaves during approval voting?
- Their vote still counts if already cast
- Can't vote if not responded yet (member_id check prevents)

### 5. What if approvals expire?
- 7-day expiration in pending_edits table
- Automatic cleanup via `handle_expired_edits()` cron job
- Original values remain (change not applied)

---

## Testing Scenarios

### Scenario 1: Single Member Added
1. Open business profile
2. Go to owners step
3. Add new shareholder (John Doe, 10%)
4. Submit form
5. Approval proposal created
6. Other members notified
7. PendingApprovalsModal shows pending edit
8. Members vote to approve
9. Change applied to business_co_owners

### Scenario 2: Multiple Changes at Once
1. Add new member (Alice, 15%)
2. Update existing member (Bob: 20% → 25%)
3. Remove member (Charlie)
4. Submit form
5. 3 approval proposals created
6. Each member must approve all 3 changes
7. Once all approve, all 3 applied

### Scenario 3: Member Rejects Change
1. Proposal created for adding new member
2. Member 1 approves
3. Member 2 approves
4. Member 3 rejects with reason "Not qualified"
5. Edit marked as rejected
6. Original roster retained
7. Member who proposed can try different member or updated terms

---

## Implementation Checklist

- [ ] Import memberApprovalService in BusinessProfileForm
- [ ] Add pendingProposalCount state
- [ ] Create memberChangesDetected() helper function
- [ ] Create proposeMemberChanges() function
- [ ] Modify handleCreateProfile to call proposeEdit instead of updateBusinessProfile for members
- [ ] Add UI banner showing pending proposals
- [ ] Add info banner in owners step explaining approval requirement
- [ ] Pass businessProfileId to PendingApprovalsModal
- [ ] Reload profile after approval completion
- [ ] Test with multiple members
- [ ] Test with rejection scenarios
- [ ] Test with single-member business (auto-approval)
- [ ] Test error handling

---

## Code Template for proposeMemberChanges()

```javascript
const proposeMemberChanges = async (formData) => {
  const currentOwners = profile.business_co_owners || [];
  const newOwners = formData.business_co_owners || [];
  
  const added = newOwners.filter(n => !currentOwners.find(o => o.owner_id === n.owner_id));
  const removed = currentOwners.filter(o => !newOwners.find(n => n.owner_id === o.owner_id));
  const updated = newOwners.filter(n => {
    const old = currentOwners.find(o => o.owner_id === n.owner_id);
    return old && JSON.stringify(old) !== JSON.stringify(n);
  });

  const proposals = [];
  const userName = currentUser.user_metadata?.full_name || currentUser.email;

  // Propose additions
  for (const member of added) {
    const result = await memberApprovalService.proposeEdit({
      businessId: profile.business_profile_id,
      userId: currentUser.id,
      email: currentUser.email,
      name: userName,
      editType: 'add_member',
      oldValue: null,
      newValue: JSON.stringify(member),
      description: `Add ${member.owner_name} as shareholder (${member.ownership_share}%)`
    });
    proposals.push(result);
  }

  // Propose removals
  for (const member of removed) {
    const result = await memberApprovalService.proposeEdit({
      businessId: profile.business_profile_id,
      userId: currentUser.id,
      email: currentUser.email,
      name: userName,
      editType: 'remove_member',
      oldValue: JSON.stringify(member),
      newValue: null,
      description: `Remove ${member.owner_name} from shareholders`
    });
    proposals.push(result);
  }

  // Propose updates
  for (const member of updated) {
    const oldVersion = currentOwners.find(o => o.owner_id === member.owner_id);
    const result = await memberApprovalService.proposeEdit({
      businessId: profile.business_profile_id,
      userId: currentUser.id,
      email: currentUser.email,
      name: userName,
      editType: 'update_member',
      oldValue: JSON.stringify(oldVersion),
      newValue: JSON.stringify(member),
      description: `Update ${member.owner_name}'s equity share`
    });
    proposals.push(result);
  }

  return proposals;
};
```

---

## Summary

The Member Approval Workflow integrates into BusinessProfileForm by:

1. **Detection** - Identifying which members were added/removed/updated
2. **Proposal** - Creating approval proposals via memberApprovalService
3. **Notification** - Notifying all shareholders of pending votes
4. **Voting** - Members vote through PendingApprovalsModal
5. **Application** - Changes applied automatically once unanimous approval reached

This ensures democratic governance where all shareholders have equal say in roster changes.
