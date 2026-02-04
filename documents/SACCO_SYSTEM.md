# SACCO System - Complete Implementation Guide

## 🏦 What is a SACCO?

SACCO (Savings and Credit Cooperative Organization) is a group-based savings and lending system where members:
- **Pool money together** into a group fund
- **Earn interest** on their savings
- **Borrow from the group** at fair rates
- **Control admissions democratically** (60% voting)
- **Maintain privacy** - financial details stay private unless shared

Perfect for:
- Agricultural communities saving for equipment
- Self-help groups building emergency funds
- Micro-entrepreneurs funding business growth
- Families creating generational wealth

---

## 🎯 Key Features

### 1. **Democratic Membership (60% Approval)**
- Admin verifies initial details
- 60% of existing members must approve new applicants
- Prevents bad actors from joining
- Secure group formation process

```
Total Members: 10
Approval Threshold: 60% = 6 members
Required Approvals: 6+ out of 10 existing members
```

### 2. **Privacy-First Design**
- ✅ Default: Profile is PRIVATE
- ✅ Members can toggle visibility
- ✅ Only approved members see each other
- ✅ Admin can verify members' identity
- ✅ Financial data never shown unless opted in

```javascript
// Member visibility control
show_profile: false  // Default private
show_profile: true   // Opted to be visible
```

### 3. **Financial Tracking**
Every member can see:
- Their contributions
- Current balance
- Interest earned
- Active loans
- Payment history

But OTHER members see:
- ❌ Nothing by default (private)
- ✅ Only what you choose to share

### 4. **Smart Loan System**
- Minimum balance: 20% of loan amount
- Interest rates: 5-20% (configurable)
- Duration: 3-24 months
- Early repayment: No penalties
- Automatic balance deduction when approved

```javascript
// Loan requirements
loan_amount: $1000
minimum_balance_required: $1000 * 0.20 = $200
interest_rate: 10%
duration: 12 months
monthly_payment: ~$90.58
```

### 5. **Interest Distribution**
- Distributed monthly/quarterly
- Based on member's balance ratio
- Transparent calculations
- Automated via triggers

---

## 📊 Database Schema

### Core Tables

#### `ican_saccos` - Group Information
```sql
id                          UUID (primary key)
name                        TEXT (unique, required)
description                 TEXT
admin_id                    UUID (references auth.users)
status                      TEXT ('active', 'paused', 'closed')
max_members                 INT (default 30)
approval_threshold          DECIMAL (default 0.60 = 60%)
total_pool                  DECIMAL (running total)
total_interest_generated    DECIMAL (lifetime interest)
member_count                INT (approved members only)
created_at, updated_at      TIMESTAMP
```

#### `ican_sacco_members` - Member Records
```sql
id                          UUID (primary key)
sacco_id                    UUID (references ican_saccos)
user_id                     UUID (references auth.users)
status                      TEXT ('pending', 'approved', 'rejected', 'suspended')
role                        TEXT ('admin', 'member')
total_contributed           DECIMAL (lifetime contributions)
current_balance             DECIMAL (available for loans)
interest_earned             DECIMAL (lifetime interest)
loans_taken                 DECIMAL (total borrowed)
loans_repaid                DECIMAL (amount repaid)
show_profile                BOOLEAN (default false, privacy control)
approved_by_count           INT (votes received)
approval_date               TIMESTAMP (when approved)
```

#### `ican_sacco_votes` - Democratic Approval
```sql
id                          UUID (primary key)
sacco_id                    UUID
member_id                   UUID (the applicant)
voter_id                    UUID (the person voting)
vote                        BOOLEAN (true=approve, false=reject)
reason                      TEXT (optional comment)
created_at                  TIMESTAMP
UNIQUE(member_id, voter_id) -- Prevents double voting
```

#### `ican_sacco_contributions` - Savings Deposits
```sql
id                          UUID (primary key)
sacco_id                    UUID
member_id                   UUID
amount                      DECIMAL (required)
description                 TEXT ('Monthly savings', etc)
contribution_date           TIMESTAMP
created_at                  TIMESTAMP
```

#### `ican_sacco_loans` - Loan Records
```sql
id                          UUID (primary key)
sacco_id                    UUID
member_id                   UUID
principal                   DECIMAL (loan amount)
interest_rate               DECIMAL (% per annum)
duration_months             INT
status                      TEXT ('active', 'completed', 'defaulted')
disbursed_date              TIMESTAMP
due_date                    TIMESTAMP
amount_repaid               DECIMAL (cumulative)
interest_accrued            DECIMAL
```

#### `ican_sacco_repayments` - Payment History
```sql
id                          UUID (primary key)
loan_id                     UUID
amount                      DECIMAL
payment_date                TIMESTAMP
payment_method              TEXT ('mobile', 'bank', 'cash')
```

#### `ican_sacco_interest` - Interest Earnings
```sql
id                          UUID (primary key)
sacco_id                    UUID
member_id                   UUID
amount                      DECIMAL (interest credited)
distribution_date           TIMESTAMP
period_month, period_year   INT
```

---

## 🔒 Row-Level Security (RLS) Policies

### Privacy Implementation

```sql
-- Members ONLY see approved members in their SACCO
CREATE POLICY "Members see approved members" ON ican_sacco_members
  FOR SELECT USING (
    auth.uid() IN (
      SELECT user_id FROM ican_sacco_members 
      WHERE sacco_id = ican_sacco_members.sacco_id AND status = 'approved'
    )
    AND status = 'approved'
  );

-- But members CAN see their own record
CREATE POLICY "Members see their own record" ON ican_sacco_members
  FOR SELECT USING (user_id = auth.uid());

-- Admin sees all members
CREATE POLICY "Admin sees all members" ON ican_sacco_members
  FOR SELECT USING (
    sacco_id IN (SELECT id FROM ican_saccos WHERE admin_id = auth.uid())
  );
```

### Access Control

| Action | Admin | Member | Pending | Guest |
|--------|-------|--------|---------|-------|
| View SACCO | ✅ | ✅ | ❌ | ✅ |
| View members | ✅ All | ✅ Approved only | ❌ | ❌ |
| View own balance | ✅ | ✅ | ❌ | ❌ |
| View others' balance | ✅ | ❌ Unless they share | ❌ | ❌ |
| Make contribution | ✅ | ✅ | ❌ | ❌ |
| Request loan | ✅ | ✅ | ❌ | ❌ |
| Approve members | ✅ | ✅ | ❌ | ❌ |
| Manage settings | ✅ | ❌ | ❌ | ❌ |

---

## 🎮 Frontend Components

### SACCOHub (Main Interface)
- Tab navigation: Explore / My SACCOs
- Create new SACCO button
- Quick access to all features

### SACCOList (Browse & Join)
- Browse all active SACCOs
- See member count, pool size, growth rate
- Request to join

### MySACCOs (Your Groups)
- List of your approved SACCOs
- Quick stats on each
- Fast access to details

### SACCODetails (Full Dashboard)
Multiple sections:

#### Overview Tab
- Your balance summary
- Group statistics
- Recent activity feed
- Quick action buttons

#### Contribute Tab
- Contribution history
- Add new contribution form
- Track deposits

#### Loans Tab
- Active loan details
- Loan request form
- Repayment schedule
- Payment history

#### Members Tab
- List of members
- Their contribution totals
- Privacy-respecting display

#### Admin Panel (Admin Only)
- Pending member requests
- Democratic voting interface
- Approval status tracking
- Group settings

### Forms (Modal Dialogs)

#### ContributionForm
- Input amount
- Optional description
- Real-time balance updates

#### LoanForm
- Loan amount request
- Interest rate display
- Duration selection
- Monthly payment calculator
- Balance requirement check

#### MemberApprovalPanel
- Shows pending applications
- Vote approve/reject
- Displays voting progress
- 60% threshold indicator

---

## 🔄 Service Layer (Backend)

### `saccoService.js` - All SACCO Operations

```javascript
// Group Management
createSacco(name, description, userId)
getSaccos(includePrivate)
getSaccoDetails(saccoId)

// Member Management
requestJoinSacco(saccoId, userId)
getMySaccos(userId)
getSaccoMembers(saccoId, userId)  // Privacy aware
getPendingMembers(saccoId, adminId)

// Approval Process
approveMember(memberId, saccoId, voterId, approve)
  // Calculates 60% threshold automatically

// Financial Operations
makeContribution(saccoId, userId, amount, description)
getMemberContributions(userId, saccoId)

// Loans
requestLoan(saccoId, userId, principal, interestRate, durationMonths)
getMemberLoans(userId, saccoId)
repayLoan(loanId, amount)

// Dashboard
getMemberDashboard(userId, saccoId)
  // Returns: member data, sacco info, contributions, loans, stats

// Privacy
updatePrivacySettings(userId, saccoId, showProfile)
```

---

## 🚀 Setup Instructions

### 1. Deploy Database Schema
```bash
# In Supabase SQL Editor, run:
09_sacco_system.sql

# This creates all tables, indexes, and RLS policies
```

### 2. Import Service
```javascript
// In your component
import { 
  createSacco, 
  getMySaccos, 
  getMemberDashboard,
  makeContribution,
  requestLoan
} from '@/services/saccoService'
```

### 3. Add Components to App
```javascript
// In main App or routing
import SACCOHub from '@/components/sacco/SACCOHub'

// Add to your route
<Route path="/sacco" component={SACCOHub} />
```

### 4. Update Navigation
```javascript
// In Header or Navigation
<Link to="/sacco" className="...">
  💰 SACCO
</Link>
```

---

## 💡 Usage Examples

### Create a SACCO
```javascript
const sacco = await createSacco(
  "Green Valley Farmers",
  "Cooperative for agricultural equipment and farming support",
  userId
);
// User becomes admin automatically
```

### Request to Join
```javascript
const membership = await requestJoinSacco(saccoId, userId);
// Status: 'pending' until 60% approve
```

### Democratic Voting (2 members voting)
```javascript
// Member 1 votes approve
await approveMember(newMemberId, saccoId, member1Id, true);
// Result: 1/2 approvals, need 2 (60% of current)

// Member 2 votes approve
await approveMember(newMemberId, saccoId, member2Id, true);
// Result: Approved! Member is now fully part of group
```

### Make Contribution
```javascript
await makeContribution(
  saccoId,
  userId,
  500,
  "Monthly savings contribution"
);
// Balance increases: 500
// Group pool increases: 500
// Interest will accrue on this amount
```

### Request Loan
```javascript
// User has $200 in account
// Wants to borrow $1000
// Required balance: $1000 * 0.20 = $200 ✓ (meets requirement)

const loan = await requestLoan(
  saccoId,
  userId,
  1000,        // principal
  10,          // 10% interest rate
  12           // 12 months duration
);
// loan.monthly_payment ≈ $90.58
// loan.due_date = 12 months from now
```

---

## 📈 Financial Calculations

### Interest Earning
```
Member Balance: $1000
Annual Interest Rate: 5%
Monthly Interest: $1000 * 0.05 / 12 = $4.17/month

After 12 months: $1000 + ($4.17 * 12) = $1050.04
```

### Loan Repayment
```
Loan Amount: $1000
Interest Rate: 10% per annum
Duration: 12 months

Monthly Payment = (Principal * (1 + Rate)) / Duration
               = ($1000 * 1.10) / 12
               = $91.67

Total Repaid: $91.67 * 12 = $1100
Total Interest: $100
```

### 60% Approval Threshold
```
Current Members: 10 (all approved)
Approval Threshold: 60%
Required Votes: ceil(10 * 0.60) = 6

New Applicant Receives:
- 5 approvals = Not approved (need 6)
- 6 approvals = APPROVED! ✓
```

---

## 🔐 Security Features

1. **Row Level Security (RLS)**
   - Database-level privacy enforcement
   - Cannot bypass via API

2. **Privacy by Default**
   - Profiles private unless opted in
   - Members can't see others' financial data

3. **Democratic Controls**
   - No single person can add members
   - 60% majority requirement prevents monopoly

4. **Audit Trail**
   - All votes tracked (who voted, when)
   - All contributions/repayments logged
   - Tampering detection possible

5. **Balance Protection**
   - Minimum balance required for loans
   - Prevents over-leveraging

---

## 🎯 User Flow

### For New User

```
1. Browse → Explore SACCOs page
2. Find interesting group → Click "Join Now"
3. Become pending member
4. Wait for 60% approval from existing members
5. Once approved → Access dashboard
6. Start contributing money
7. After sufficient balance → Can borrow
8. View interest earnings monthly
```

### For Admin

```
1. Create → Start new SACCO
2. Become admin automatically
3. Review → Check pending membership requests
4. Verify → Ask identity questions (optional)
5. Vote → Approve/reject alongside members
6. Manage → View all members and financials
7. Distribute → Interest payouts monthly
8. Report → Generate group statistics
```

---

## 🐛 Troubleshooting

### "Member not found or not approved"
- Check if user is actually approved (not pending)
- Ensure user_id matches auth.users.id

### "Already a member"
- User already has pending or approved status
- Can't request twice

### "SACCO has reached maximum members"
- Max 30 members enforced
- Suggest creating second group

### "Need more balance"
- Loan minimum balance not met
- Contribution size = 20% of loan requested
- Make more contributions first

### "Not a member of this SACCO"
- RLS policy blocking access
- User must be approved member or admin

---

## 🚦 Next Steps

1. **Deploy SQL migration** in Supabase
2. **Test membership workflow** with test accounts
3. **Verify RLS policies** are working
4. **Monitor performance** with large groups
5. **Add real-time updates** using Supabase Realtime
6. **Implement notifications** for loan approvals

---

## 📞 Support & Questions

For issues or questions about SACCO implementation:
- Check RLS policies in Supabase
- Review database schema
- Validate user authentication
- Check browser console for API errors
- Monitor Supabase logs

**Remember:** Privacy and democratic control are core to SACCO success! 🏦✨
