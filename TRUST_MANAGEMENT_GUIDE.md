# TRUST System - Group Management Guide

## Overview
The TRUST System now includes comprehensive group management features for creators and admins to oversee their cooperative savings groups.

---

## 🎛️ Management Features

### 1. **Edit Group Settings**
Creators can modify:
- Group Name
- Description
- Monthly Contribution Amount

**How to Access:**
1. Go to "My Groups" tab
2. Click "View Details" on your group
3. Click "⚙️ Manage Group" button
4. Edit the fields
5. Click "💾 Save Settings"

---

### 2. **Control Group Status**
Manage the lifecycle of your group:

**Available Statuses:**
- 🟢 **Active** - Group is running normally
- ⏸️ **Paused** - Group is temporarily suspended (no contributions accepted)
- 🟠 **Completed** - Group has completed its cycle
- 🔒 **Archived** - Group is closed permanently

**How to Change Status:**
1. Open Management Modal
2. Go to "Group Status" section
3. Choose action:
   - **Pause Group** - Temporarily stop contributions
   - **Resume Group** - Restart a paused group
   - **Close Group** - Permanently archive (cannot undo)

---

### 3. **Members Management**
Complete control over group membership:

#### View All Members
- See member #, role, and contributions
- Scrollable list of all active members
- Real-time contribution tracking

#### Promote to Admin
**What it does:** Upgrade a member to admin role
**When to use:** Delegate management tasks
**Who can do it:** Creator and current admins
**Process:**
1. Find member in the list
2. Click "📤" (Promote button)
3. Member becomes admin with management privileges

**Admin Permissions:**
- View all group transactions
- Cannot close group (creator only)
- Can manage other members

#### Demote from Admin
**What it does:** Downgrade admin back to member
**When to use:** Remove admin privileges
**Process:**
1. Find admin member
2. Click "📥" (Demote button)
3. Member loses admin privileges

#### Remove Member
**What it does:** Remove member from group
**When to use:** 
- Member wants to leave
- Member is inactive
- Enforcing group rules
**Process:**
1. Find member to remove
2. Click "✕" (Remove button)
3. Confirm removal
4. Member is marked inactive, cannot rejoin

**Note:** Member data is preserved in records for blockchain verification

---

## 📊 Management Dashboard

The management modal shows:

### Group Information
- Current name and description
- Monthly contribution amount
- Group status
- Member count

### Statistics (from Group Details)
- Total Contributed
- Total Payouts
- Verified Transactions Count
- Current Status

### Member List
Sortable by:
- Member number (order joined)
- Role (creator/admin/member)
- Contribution amount
- Status (active)

---

## 🔐 Permission Model

### Creator Permissions
✅ Edit all group settings
✅ Promote/demote members
✅ Remove members
✅ Pause/resume group
✅ Close/archive group
✅ View all transactions
✅ Full audit trail

### Admin Permissions
✅ Edit group settings (on behalf of creator)
✅ Promote/demote other members
✅ Remove members
✅ View all transactions
❌ Cannot close group (creator only)

### Member Permissions
✅ View group details
✅ Make contributions
✅ View own transactions
✅ Leave group voluntarily
❌ Cannot manage other members

---

## 💼 Use Cases

### Scenario 1: Growing Group
1. Start group as creator
2. As group grows, promote helpful members to admins
3. Admins help manage day-to-day operations
4. Creator oversees overall strategy

### Scenario 2: Removing Inactive Member
1. Member hasn't contributed for 3 months
2. Open group management
3. Find member in list
4. Click remove button
5. Position opens for new member (if group not full)

### Scenario 3: Adjusting Contribution
1. Group votes to increase monthly amount from $100 to $150
2. Creator edits in management panel
3. Save new amount
4. All future contributions reflect new amount

### Scenario 4: Temporary Pause
1. Group encounters temporary financial constraint
2. Creator pauses group
3. Members cannot make contributions
4. Creator resumes when ready
5. Group continues normally

### Scenario 5: End of Cycle
1. Group completes 12-month savings cycle
2. All members have received payouts
3. Creator closes/archives group
4. Records preserved on blockchain
5. Members can view final history

---

## 🔄 Workflow Examples

### Typical Monthly Management
```
Week 1: Creator monitors contributions
Week 2: Send reminders for outstanding payments
Week 3: Approve new member requests
Week 4: Generate monthly report & prepare payout
```

### End-of-Year Workflow
```
1. Verify all contributions recorded
2. Calculate final balances
3. Approve payout schedule
4. Process final transactions
5. Close group
6. Archive records
```

---

## ⚠️ Important Notes

### Cannot Undo
- **Closing a group** - Results in archival, cannot reopen
- **Removing a member** - Member cannot rejoin
- **Transaction changes** - All recorded on blockchain

### Auto-Limitations
- Cannot remove creator
- Cannot exceed 30 members
- Cannot set negative contribution amounts
- Cannot modify past transactions

### Best Practices
1. **Communicate Changes** - Notify members before major changes
2. **Keep Records** - Screenshot monthly reports
3. **Regular Reviews** - Check member status weekly
4. **Document Decisions** - Note why members were removed
5. **Fair Enforcement** - Apply rules equally to all members

---

## 📱 Mobile Management

All management features work on mobile:
- Responsive management modal
- Touch-friendly buttons
- Scrollable member list
- Confirmation dialogs for critical actions

---

## 🔗 Integration with Blockchain

All management actions are logged:
- Member changes recorded
- Status updates timestamped
- Transaction history immutable
- Full audit trail available
- Can export records for compliance

---

## 🚨 Error Handling

**"Failed to update group"**
- Check internet connection
- Verify you're the creator
- Try again after a moment

**"Member not found"**
- Member may have already been removed
- Refresh the page
- Check active members list

**"Cannot close group"**
- Only creator can close group
- Ensure you're logged in as creator
- Wait for any pending operations to complete

---

## 📋 Audit Trail

All management actions create records:
- Who made the change
- When it was made
- What was changed
- For security and transparency

View records in group transaction history.

---

## 🎓 Advanced Management

### Promoting Strategic Members
Choose members who are:
- Consistently on time with contributions
- Active and engaged
- Trustworthy
- Willing to help others

### Handling Disputes
When members disagree:
1. Document the issue
2. Review transaction records
3. Consult blockchain hash for verification
4. Make fair decision
5. Communicate clearly

### Scaling to Max Members
When group reaches 30:
1. Can no longer accept new members
2. Create a new group if needed
3. Keep first group running
4. Consider promoting members from first group to second

---

## 📞 Support

**For management questions:**
1. Check this guide first
2. Review specific scenario section
3. Verify permissions
4. Check error messages

---

## ✅ Management Checklist

Use this checklist for regular group maintenance:

- [ ] Review all active members weekly
- [ ] Check contribution status monthly
- [ ] Verify no overdue payments
- [ ] Update group settings as needed
- [ ] Promote deserving members
- [ ] Archive old records
- [ ] Communicate with admins
- [ ] Send monthly statements
- [ ] Plan next cycle
- [ ] Review blockchain hashes for verification

---

**Version**: 1.0.0
**Last Updated**: 2024
**Status**: Management Features Complete
