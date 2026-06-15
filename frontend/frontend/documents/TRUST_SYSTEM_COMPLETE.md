# TRUST System - Blockchain-Verified Cooperative Savings
## ICAN Capital Engine Integration

---

## 🏦 What is TRUST?

**TRUST** is the cooperative savings module integrated into ICAN Capital Engine. It combines:
- **Group savings** (SACCO model)
- **Democratic voting** (60% majority)
- **Blockchain verification** (immutable records)
- **Privacy protection** (member-controlled visibility)
- **Smart lending** (minimum balance requirements)

**Vision:** Enable communities to build generational wealth through transparent, trustworthy group savings.

---

## 🔗 Blockchain Integration

### Why Blockchain?

All TRUST transactions are recorded to an immutable blockchain to ensure:
- ✅ **Transparency** - Every transaction is publicly verifiable
- ✅ **Integrity** - Records cannot be tampered with
- ✅ **Auditability** - Complete transaction history available
- ✅ **Trust** - Cryptographic proof of authenticity
- ✅ **Accountability** - Anonymous but trackable

### What Gets Recorded?

| Transaction Type | Example | Hash Chain |
|------------------|---------|-----------|
| **Member Join** | User requests to join TRUST | `hash(member_join + prev_hash)` |
| **Voting** | Member votes approve/reject | `hash(vote + prev_hash)` |
| **Contribution** | Member adds $100 to pool | `hash(contribution + prev_hash)` |
| **Loan Approval** | Member borrows $1000 | `hash(loan_approval + prev_hash)` |

### Blockchain Architecture

```
Record 1: Member Alice joins
├─ Type: trust_member_join
├─ Hash: 3f4a2b8e...
└─ PrevHash: 0 (genesis)

Record 2: Member Bob votes APPROVE
├─ Type: trust_vote
├─ Hash: 7c9d1e5a...
└─ PrevHash: 3f4a2b8e... (chains back)

Record 3: Alice contributes $500
├─ Type: trust_contribution
├─ Hash: 9b2e6f3c...
└─ PrevHash: 7c9d1e5a... (chains back)

Record 4: Alice borrows $2000
├─ Type: trust_loan_approval
├─ Hash: 4d7a9c2e...
└─ PrevHash: 9b2e6f3c... (chains back)
```

Each hash is cryptographically linked to the previous one, creating an unbreakable chain.

---

## 📊 ICAN Capital Engine Navigation

The TRUST system is integrated into the main navigation bar:

```
ICAN Capital Engine
From Volatility to Global Capital

┌─────────────────────────────────────────────────┐
│ Dashboard  Security  Readiness  Growth  Trust  Settings │
└─────────────────────────────────────────────────┘
```

### Trust Menu Options

**My Trusts**
- View SACCOs you've joined
- Quick stats on each group
- Fast access to dashboards

**Explore**
- Browse available groups
- See member count, pool size
- Request to join

**Create**
- Start a new TRUST group
- Set name and description
- Become group administrator

**Dashboard**
- Full management interface
- Member approvals
- Financial tracking
- Blockchain verification

---

## 🔐 Privacy & Security

### Default: PRIVATE
Every member's financial data is **private by default**.

Only you can see:
- Your balance
- Your contributions
- Your loans
- Your interest earned

### Optional: SHARE
You can toggle visibility to share:
- Your total contributed amount
- Your current balance
- Your interest earned

Members see:
- ❌ Nothing about you (unless you share)
- ✅ Only your name (anonymous member ID)
- ✅ Only what you choose to show

### Admin Access
Administrators can:
- ✅ See all members' profiles (for verification)
- ✅ Approve/reject new members
- ✅ View group financials
- ❌ Cannot modify member data
- ❌ Cannot approve themselves

---

## 🗳️ Democratic Membership Process

### The 60% Rule

New members must be approved by **60% of existing members**:

```
Current Members: 10 (all approved)
Approval Threshold: 60%
Required Votes: ceil(10 × 0.60) = 6 members

Scenario 1: Gets 5 approvals → REJECTED (need 6)
Scenario 2: Gets 6 approvals → APPROVED ✓
Scenario 3: Gets 3 rejections + 7 approvals → APPROVED ✓
```

### Approval Workflow

```
1. NEW MEMBER
   ↓ Request to join
   
2. PENDING
   ↓ Admin can verify identity
   ↓ Members vote approve/reject
   
3. VOTING PERIOD
   ├─ If 60% approve → Status = APPROVED
   └─ If not enough votes → Waiting
   
4. APPROVED
   ├─ Can now make contributions
   ├─ Can view other members
   └─ Can request loans
```

### Voting Records

Every vote is recorded to blockchain:

```javascript
{
  type: "trust_vote",
  trust_id: "uuid",
  member_id: "applicant_uuid",
  voter_id: "voter_uuid",
  vote: "APPROVE",  // or "REJECT"
  reason: "Good standing member",
  timestamp: "2026-01-02T10:30:00Z",
  hash: "7c9d1e5a..." // cryptographically unique
}
```

---

## 💰 Financial Operations

### Contributions

Members contribute to the group pool:

```javascript
// Member contributes $500
{
  type: "trust_contribution",
  trust_id: "uuid",
  contributor_id: "member_uuid",
  amount: 500,
  currency: "USD",
  description: "Monthly savings"
}
```

**What happens:**
- Member's balance: +$500
- Group pool: +$500
- Member earns interest on contribution
- Transaction recorded to blockchain

### Loans

Members can borrow from the group:

```javascript
// Member borrows $1000
{
  type: "trust_loan_approval",
  trust_id: "uuid",
  borrower_id: "member_uuid",
  loan_id: "uuid",
  loan_amount: 1000,
  interest_rate: 10,  // % per annum
  duration_months: 12
}
```

**Requirements:**
- Member must have 20% minimum balance = $200
- Cannot borrow more than 5x your balance
- Interest rates: 5-20% (group-set)
- Duration: 3-24 months
- Early repayment: No penalties

**Example:**
```
Loan Request: $1000 @ 10% for 12 months
─────────────────────────────────
Monthly Payment: $91.67
Total Interest: $100
Total Repaid: $1100

After 6 months: Can repay remainder anytime
After 12 months: Loan completed
```

### Interest Distribution

Members earn interest on their balance:

```javascript
// Monthly interest distribution
{
  type: "trust_interest",
  member_id: "uuid",
  amount: 4.17,  // Calculated as: balance × rate / 12
  distribution_date: "2026-02-02",
  period: "2026-01"
}
```

**Calculation:**
```
Member Balance: $1000
Annual Interest Rate: 5%
Monthly Interest: $1000 × 0.05 / 12 = $4.17
```

---

## 🔍 Blockchain Verification

### Audit Trail

Access complete transaction history:

```
TRUST: "Green Valley Farmers"
Verification Rate: 100% (24/24 records verified)
Chain Integrity: ✓ VALID

Record 1: Member Alice joins
├─ Hash: 3f4a2b8e...
├─ Valid: ✓
└─ Time: 2026-01-02 08:00:00Z

Record 2: Member Bob approves Alice
├─ Hash: 7c9d1e5a...
├─ Valid: ✓
└─ Time: 2026-01-02 08:15:00Z
```

### Verification Process

Each record is verified by:

1. **Hash Verification** - Recalculate hash, must match
2. **Chain Verification** - Previous hash must match record before it
3. **Timestamp Verification** - Timestamp is sequential
4. **Data Integrity** - JSONB data unchanged

```javascript
// Example verification result
{
  recordId: "uuid",
  isValid: true,
  chainValid: true,
  hashValid: true,
  verificationDetails: {
    recordHash: "7c9d1e5a...",
    previousHash: "3f4a2b8e...",
    expectedPreviousHash: "3f4a2b8e...",
    recordType: "trust_vote"
  }
}
```

### Analytics Dashboard

View statistical insights:

**Voting Analytics**
- Total votes cast
- Approval rate
- Rejection rate
- Recent voting activity

**Financial Analytics**
- Total contributed: $X,XXX
- Total loaned: $X,XXX
- Average contribution: $XXX
- Average loan: $XXX

**Blockchain Statistics**
- Total records: 247
- Verified records: 247
- Chain integrity: ✓ VALID
- Last transaction: 2 hours ago

---

## 🚀 Quick Start

### 1. Create a TRUST Group

```
Click: Trust → Create
├─ Name: "Green Valley Farmers"
├─ Description: "Cooperative for agricultural loans"
└─ Submit

You become: Administrator
Status: Active
Members: 1 (you)
```

### 2. Other Members Join

```
Click: Trust → Explore
├─ Find "Green Valley Farmers"
└─ Click: Join Now
  ↓
Status: Pending
(Wait for 60% approval)
```

### 3. Admin Reviews & Votes

```
Click: Admin Panel
├─ See pending members
├─ Verify their identity (optional)
└─ Vote approve/reject
  ↓
System calculates: Need 60% approval
After threshold met: Member approved!
Blockchain record created
```

### 4. Members Contribute

```
Click: Contribute
├─ Amount: $500
├─ Description: "Monthly savings"
└─ Submit
  ↓
Balance: +$500
Pool: +$500
Interest: Starts accruing
Blockchain: Transaction recorded
```

### 5. Members Borrow

```
Click: Request Loan
├─ Amount: $1000
├─ Rate: 10% (default)
├─ Duration: 12 months
└─ Submit
  ↓
Check: Do you have $200+ balance? ✓
Loan: APPROVED
Amount: Disbursed
Blockchain: Loan recorded
```

---

## 📋 Key Features Comparison

| Feature | TRUST | Traditional Bank |
|---------|-------|-----------------|
| **Membership** | Democratic 60% voting | Single approval |
| **Transparency** | Blockchain verified | Opaque |
| **Interest Rates** | Member-set 5-20% | Fixed 2-4% |
| **Loan Approval** | Instant (min balance met) | 5-7 days |
| **Privacy** | Member controlled | No choice |
| **Audit Trail** | Cryptographic proof | Bank records only |
| **Cost** | Minimal fees | Monthly charges |

---

## 🎯 Use Cases

### Agricultural Communities
```
TRUST: "Coffee Farmers Cooperative"
Members: 25 farmers
Purpose: Equipment financing
Average Loan: $2,000
Pool Size: $50,000
```

### Urban Self-Help Groups
```
TRUST: "Market Women Savings"
Members: 20 traders
Purpose: Business expansion
Average Contribution: $100/month
Annual Interest: 8%
```

### Family Wealth Building
```
TRUST: "Mwangi Family Fund"
Members: 12 family
Purpose: Education & healthcare
Target: $100,000 in 3 years
```

---

## 🔒 Data Storage

### Database Structure

```sql
ican_saccos
├─ id, name, description
├─ admin_id, status
├─ max_members (30)
├─ approval_threshold (0.60)
├─ total_pool, total_interest_generated
└─ member_count

ican_sacco_members
├─ sacco_id, user_id
├─ status (pending/approved/rejected/suspended)
├─ total_contributed, current_balance
├─ interest_earned, loans_taken
├─ show_profile (privacy control)
└─ approved_by_count, approval_date

ican_blockchain_records
├─ trust_id, user_id
├─ record_type (member_join/vote/contribution/loan_approval)
├─ record_data (JSONB, flexible)
├─ record_hash, previous_hash (blockchain)
├─ is_verified, verification_count
└─ created_at, updated_at
```

---

## 🛡️ Security Features

✅ **Row Level Security (RLS)**
- Database enforces privacy rules
- Cannot bypass via API

✅ **Cryptographic Hashing**
- SHA256 hashing for records
- Hash chain for integrity

✅ **Immutable Audit Trail**
- Cannot delete or modify records
- Complete transaction history

✅ **Democratic Controls**
- No single person can approve members
- 60% majority prevents tyranny

✅ **Privacy by Default**
- Member profiles private unless shared
- Financial data encrypted

---

## 📈 Getting Started

### For Administrators

1. **Create TRUST** in Dashboard → Trust → Create
2. **Share code** with potential members
3. **Review requests** in Admin Panel
4. **Vote on members** alongside your group
5. **Monitor financials** in Dashboard

### For Members

1. **Find TRUST** in Dashboard → Trust → Explore
2. **Request to join** groups you trust
3. **Wait for approval** (60% voting)
4. **Make first contribution** to build balance
5. **Access loans** once you have 20%+ balance
6. **Earn interest** on your savings monthly

---

## ⚠️ Important Notes

### Maximums & Minimums
- Max members: **30 per group**
- Min contribution: **Any amount**
- Min balance for loans: **20% of loan amount**
- Max loan: **5x your balance**
- Interest rates: **5-20% per annum**

### Voting Requirements
- Approval threshold: **60% of members**
- One vote per member: **Per applicant**
- Admin can verify: **Before voting**
- Cannot self-approve: **Voting required**

### Privacy Defaults
- Profile: **PRIVATE** (default)
- Balance visibility: **Off** (default)
- Member list: **Approved members only**
- Admin exceptions: **Can see all profiles**

---

## 🎓 Examples

### Example 1: Starting a TRUST

```
Person A creates "Bike Repair Cooperative"
├─ Becomes admin
├─ Sets description: "Group to buy tools"
├─ Invites 15 friends
└─ Sets profile to public ✓

Friend B requests to join
├─ Status: Pending
├─ Admin verifies: Known mechanic ✓
├─ Group votes: 10 approve, 3 reject
├─ 10/15 = 67% > 60% THRESHOLD
└─ Friend B: APPROVED ✓

Blockchain Record Created:
{
  type: "trust_member_join",
  trust_id: "bike-coop",
  user_id: "friend-b",
  member_name: "Friend B",
  hash: "a1b2c3d4..."
}
```

### Example 2: Contribution & Loan

```
Member C has balance: $500

Month 1: Contributes $300
├─ New balance: $800
├─ Interest starts: $800 × 5% / 12 = $3.33/month
└─ Blockchain: Contribution recorded

Month 2: Earns interest
├─ Balance: $800 + $3.33 = $803.33
└─ Blockchain: Interest distributed

Month 3: Requests loan $2000
├─ Min balance required: $2000 × 20% = $400
├─ Current balance: $803.33 ✓
├─ APPROVED!
└─ Blockchain: Loan recorded
  └─ Monthly payment: $183.33
```

### Example 3: Voting

```
Member D joins "Farmers Cooperative"
├─ Current members: 10
├─ Approval threshold: 60%
├─ Required approvals: 6

Members vote:
├─ Member A: APPROVE (record 1)
├─ Member B: APPROVE (record 2)
├─ Member C: APPROVE (record 3)
├─ Member E: REJECT  (record 4)
├─ Member F: APPROVE (record 5)
├─ Member G: APPROVE (record 6)
│
└─ THRESHOLD MET! Member D: APPROVED ✓

Blockchain Results:
- 6 votes recorded
- 6 unique hashes in chain
- 100% verification rate
- Audit trail complete
```

---

## 🤝 Support & Questions

For support or questions about TRUST:
1. Check blockchain audit trail for transaction details
2. Review member approval records
3. Contact group administrator
4. View complete blockchain history

**Remember:** In TRUST, transparency and democracy are paramount! 🏦✨
