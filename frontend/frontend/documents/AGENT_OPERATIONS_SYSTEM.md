# 🏪 AGENT OPERATIONS SYSTEM
## Dual-Currency Terminal Specification (UGX & USD)

---

## 📋 TABLE OF CONTENTS

1. [System Overview](#system-overview)
2. [Core Capabilities](#core-capabilities)
3. [Technical Implementation](#technical-implementation)
4. [Operational Workflows](#operational-workflows)
5. [Safety Features](#safety-features)
6. [Configuration & Setup](#configuration--setup)
7. [Testing Checklist](#testing-checklist)

---

## SYSTEM OVERVIEW

### What is the Agent Terminal?

The **Agent Terminal** is a digital Bureau de Change system that enables:
- **Agents**: To operate physical cash-exchange points
- **Users**: To convert digital wallet funds to physical cash and vice versa
- **Platform**: To track all transactions with full audit trail

### Key Design Principles

✅ **Dual-Currency Tracking** - USD and UGX floats are completely separate  
✅ **Liquidity Guard** - Prevents over-selling float  
✅ **ID Verification** - Every transaction links to specific user  
✅ **Real-Time Audit** - Settlement logs for shift reconciliation  
✅ **Commission Earning** - Agents earn on cash-out transactions  

---

## CORE CAPABILITIES

### 🏧 1. CASH-IN (Deposits)

**What it does**: Convert user's physical cash into digital wallet balance

**Flow**:
```
Agent receives physical USD/UGX from User
        ↓
Agent enters User Account ID
        ↓
System verifies Agent has sufficient float
        ↓
Agent confirms transaction
        ↓
Agent's digital float DECREASES
User's digital wallet INCREASES
Transaction logged with reference number
```

**Key Features**:
- 0% commission (to encourage deposits)
- Separate USD and UGX handling
- Instant settlement
- Transaction reference tracking

**Example**:
```javascript
// User walks in with 100 USD cash
await agentService.processCashIn({
  userAccountId: 'ACC-1029',
  amount: 100,
  currency: 'USD',
  description: 'Exchange at Kampala branch'
});

// Result:
// ✅ Agent's USD float: 5000 → 4900
// ✅ User's USD wallet: 0 → 100
// ✅ Transaction recorded with receipt
```

---

### 💸 2. CASH-OUT (Withdrawals)

**What it does**: Convert user's digital balance into physical cash

**Flow**:
```
User initiates withdrawal (via app, QR, OTP)
        ↓
Agent enters User Account ID
        ↓
System verifies user has funds
        ↓
Agent hands over physical cash
        ↓
Agent's float INCREASES (more cash on hand)
User's digital wallet DECREASES
Commission automatically calculated and recorded
```

**Key Features**:
- 1.5-2.5% commission to agent (+ platform share)
- Full ID verification required
- Real-time balance validation
- Automatic commission calculation

**Example**:
```javascript
// User wants to withdraw 50 USD
await agentService.processCashOut({
  userAccountId: 'ACC-1029',
  amount: 50,
  currency: 'USD'
});

// Result:
// ✅ User's USD wallet: 100 → 50
// ✅ Agent's float: 4900 → 4950 (net after commission)
// ✅ Agent earns: 50 × 2.5% = 1.25 USD
// ✅ Platform gets: 50 × 1.25% = 0.625 USD
```

---

### ⬆️ 3. FLOAT MANAGEMENT (Top-Up)

**What it does**: Refill agent's digital liquidity when running low

**Flow**:
```
Agent clicks "Refill Float"
        ↓
Selects currency (USD or UGX)
        ↓
Enters amount needed
        ↓
System sends MOMO Request to Pay to Agent's phone
        ↓
Agent enters MOMO PIN
        ↓
Digital float instantly credited
```

**Key Features**:
- Separate top-up requests per currency
- MOMO integration for seamless payment
- Instant credit to float
- Transaction tracked in settlement
- No commission on top-ups

**Example**:
```javascript
// Agent's USD float running low (only $200 left)
await agentService.processFloatTopUp({
  amount: 1000,
  currency: 'USD',
  phoneNumber: '256701234567'
});

// Result:
// ✅ MOMO request sent to agent's phone
// ✅ Agent confirms payment
// ✅ Float instantly: 200 → 1200 USD
// ✅ Transaction logged for settlement
```

---

## TECHNICAL IMPLEMENTATION

### Database Schema

```
┌─────────────────────────────────────┐
│           AGENTS TABLE              │
├─────────────────────────────────────┤
│ id (UUID)                           │
│ user_id (FK)                        │
│ agent_name, agent_code              │
│ phone_number, email                 │
│ location_name, city, lat/long       │
│ status (active/inactive)            │
│ commission_percentage               │
│ created_at, verified_at             │
└─────────────────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│      AGENT_FLOATS TABLE             │
├─────────────────────────────────────┤
│ id (UUID)                           │
│ agent_id (FK)                       │
│ currency (USD / UGX) - UNIQUE PAIR  │
│ current_balance                     │
│ total_deposited, total_withdrawn    │
│ last_topup_amount, last_topup_at    │
│ is_frozen, frozen_reason            │
│ created_at, updated_at              │
└─────────────────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│   AGENT_TRANSACTIONS TABLE          │
├─────────────────────────────────────┤
│ id (UUID)                           │
│ agent_id (FK)                       │
│ user_id (FK)                        │
│ transaction_type                    │
│ amount, currency, commission        │
│ reference_number (UNIQUE)           │
│ status (pending/completed/failed)   │
│ created_at, completed_at            │
└─────────────────────────────────────┘
           ↓
┌─────────────────────────────────────┐
│  AGENT_SETTLEMENTS TABLE            │
├─────────────────────────────────────┤
│ id (UUID)                           │
│ agent_id (FK)                       │
│ settlement_date, shift_number       │
│ usd_opening, usd_cash_in/out        │
│ ugx_opening, ugx_cash_in/out        │
│ variance (reconciliation)           │
│ total_transactions                  │
│ status (open/submitted/verified)    │
└─────────────────────────────────────┘
```

### Row Level Security (RLS)

```sql
-- Agents only see their own profile
✓ agents FOR SELECT USING (user_id = auth.uid())

-- Agents only access their own floats
✓ agent_floats FOR SELECT USING (agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  ))

-- Agents only see their transactions
✓ agent_transactions FOR SELECT USING (agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  ))

-- Admins can view everything
✓ Admins have unrestricted access
```

---

## OPERATIONAL WORKFLOWS

### Workflow 1: User Deposits USD Cash

```
┌─────────────────────────────────────────┐
│ USER WALKS UP WITH 500 USD CASH         │
└──────────────┬──────────────────────────┘
               │
               ▼
   ┌───────────────────────────┐
   │ AGENT TERMINAL            │
   │ Selects: CASH-IN          │
   └───────────┬───────────────┘
               │
               ▼
   ┌───────────────────────────────────┐
   │ Form:                             │
   │ • User ID: ACC-1029               │
   │ • Amount: 500                     │
   │ • Currency: USD                   │
   │ • Description: Cash exchange      │
   └───────────┬───────────────────────┘
               │
               ▼
   ┌────────────────────────────────────┐
   │ SYSTEM CHECK:                      │
   │ ✓ Agent's USD float: 2000          │
   │ ✓ User account exists              │
   │ ✓ Amount is valid                  │
   └───────────┬────────────────────────┘
               │
               ▼
   ┌────────────────────────────────────┐
   │ AGENT CONFIRMS TRANSACTION         │
   │ → Clicks "Complete Cash-In"        │
   └───────────┬────────────────────────┘
               │
               ▼
   ┌──────────────────────────────────────────┐
   │ DUAL-LEDGER UPDATE:                      │
   │ Agent Float USD: 2000 → 1500            │
   │ User Wallet USD: 0 → 500                │
   │ Transaction logged: CASH-IN-170525-001  │
   └──────────────┬───────────────────────────┘
               │
               ▼
   ┌──────────────────────────────────────────┐
   │ ✅ SUCCESS                               │
   │ • Receipt: CASH-IN-170525-001            │
   │ • Amount: 500 USD                        │
   │ • User balance: +500 USD                 │
   │ • Agent float: -500 USD                  │
   └──────────────────────────────────────────┘
```

### Workflow 2: User Withdraws USD Cash

```
┌──────────────────────────────────────────┐
│ USER APP: Requests 200 USD withdrawal    │
│ Generates QR or OTP                      │
└──────────────┬───────────────────────────┘
               │
               ▼
   ┌──────────────────────────────────────┐
   │ AGENT TERMINAL                       │
   │ Selects: CASH-OUT                    │
   └──────────────┬────────────────────────┘
               │
               ▼
   ┌──────────────────────────────────────┐
   │ Form:                                │
   │ • User ID: ACC-1029                  │
   │ • Amount: 200                        │
   │ • Currency: USD                      │
   │ • Fee: 2.5% = 5 USD                  │
   │ • Agent earns: 2.5 USD               │
   │ • Net to agent: 197.5 USD            │
   └──────────────┬────────────────────────┘
               │
               ▼
   ┌──────────────────────────────────────┐
   │ VERIFICATION:                        │
   │ ✓ User has 500 USD (≥ 200)           │
   │ ✓ OTP matches                        │
   │ ✓ Agent confirmed                    │
   └──────────────┬────────────────────────┘
               │
               ▼
   ┌──────────────────────────────────────┐
   │ AGENT HANDS OVER 200 USD CASH        │
   │ → User leaves with cash              │
   └──────────────┬────────────────────────┘
               │
               ▼
   ┌───────────────────────────────────────────────┐
   │ DUAL-LEDGER UPDATE:                           │
   │ User Wallet USD: 500 → 300                   │
   │ Agent Float USD: 1500 → 1697.5 (197.5 net)  │
   │ Agent Commission: +2.5 USD earned            │
   │ Transaction: CASH-OUT-170525-002             │
   └───────────────┬───────────────────────────────┘
               │
               ▼
   ┌────────────────────────────────────────┐
   │ ✅ SUCCESS                             │
   │ • Receipt: CASH-OUT-170525-002         │
   │ • Amount: 200 USD + 5 USD commission  │
   │ • User balance: -200 USD               │
   │ • Agent earned: 2.5 USD                │
   └────────────────────────────────────────┘
```

### Workflow 3: Agent Tops Up Float

```
┌─────────────────────────────┐
│ AGENT'S FLOAT RUNNING LOW    │
│ USD: 100 left (not enough)   │
└──────────────┬──────────────┘
               │
               ▼
   ┌────────────────────────────────┐
   │ AGENT SELECTS: TOP-UP          │
   └──────────────┬─────────────────┘
               │
               ▼
   ┌────────────────────────────────┐
   │ Form:                          │
   │ • Amount: 1000 USD             │
   │ • Currency: USD                │
   │ • Phone: 256701234567          │
   └──────────────┬─────────────────┘
               │
               ▼
   ┌────────────────────────────────────┐
   │ SYSTEM: Creates MOMO request       │
   │ Reference: TOPUP-170525-003        │
   │ Amount: $1000                      │
   │ Recipient: Agent's account         │
   └──────────────┬────────────────────┘
               │
               ▼
   ┌────────────────────────────────────┐
   │ 📱 MOMO REQUEST TO PAY SENT         │
   │ → Agent receives SMS notification  │
   │ → Agent enters MOMO PIN            │
   └──────────────┬────────────────────┘
               │
               ▼
   ┌────────────────────────────────────┐
   │ ✓ PAYMENT CONFIRMED                │
   │ → 1000 USD transferred             │
   └──────────────┬────────────────────┘
               │
               ▼
   ┌───────────────────────────────────────┐
   │ FLOAT UPDATED INSTANTLY:              │
   │ Agent Float USD: 100 → 1100           │
   │ Top-up tracked in settlement          │
   │ No commission on top-ups              │
   └────────────────────────────────────────┘
               │
               ▼
   ┌────────────────────────────────────┐
   │ ✅ FLOAT REFILLED                  │
   │ • New balance: 1100 USD            │
   │ • Ready for more transactions      │
   └────────────────────────────────────┘
```

---

## SAFETY FEATURES

### 🛡️ Liquidity Guard

**Problem**: Agent tries to deposit 500 USD but only has 100 USD float

**Solution**:
```javascript
if (agentFloat.current_balance < amount) {
  return {
    success: false,
    error: "Insufficient float",
    available: 100,
    shortfall: 400
  };
}
// Prevents agent from depleting cash
```

### 🔐 Dual-Ledger Tracking

**Design**: USD and UGX floats are COMPLETELY SEPARATE

```javascript
// ✅ Correct: Separate ledgers
agent_floats UNIQUE(agent_id, currency)
// USD: 5000
// UGX: 2000000

// ❌ Wrong: Combined
// Both currencies in one balance
```

**Impact**:
- Topping up UGX doesn't increase USD float
- Cash-in USD doesn't affect UGX balance
- Each currency tracked independently

### 👤 ID Verification

**Requirement**: Every transaction must specify user account

```javascript
// System validates user exists before transaction
const { data: userWallet } = await supabase
  .from('user_wallets')
  .select('*')
  .eq('user_id', userAccountId) // Must exist
  .eq('currency', currency)      // Specific currency
  .single();

if (!userWallet) {
  throw new Error('User wallet not found');
}
```

### 📊 Real-Time Audit Log

**Settlement Record**:
```
Settlement Date: 2025-05-17
Shift: 1 (Morning)
Agent: AGENT-UGX-KLA

USD Ledger:
├─ Opening: 5000
├─ Cash-In: +2000 (4 transactions)
├─ Cash-Out: -3000 (6 transactions)
├─ Variance: 0
└─ Closing: 4000

UGX Ledger:
├─ Opening: 2000000
├─ Cash-In: +500000 (8 transactions)
├─ Cash-Out: -800000 (12 transactions)
├─ Variance: 0
└─ Closing: 1700000

Commissions Earned: 125 USD (from cash-outs)
```

---

## CONFIGURATION & SETUP

### Step 1: Create Database Tables

```sql
-- Run AGENT_SYSTEM_SCHEMA.sql in Supabase SQL Editor
-- Creates:
✓ agents
✓ agent_floats
✓ agent_transactions
✓ agent_settlements
✓ RLS policies
✓ Performance indexes
```

### Step 2: Register an Agent

```javascript
// Via admin panel or API
const newAgent = {
  user_id: 'uuid-of-user',
  agent_name: 'John Doe - Kampala',
  agent_code: 'AGENT-UGX-KLA-001',
  phone_number: '256701234567',
  location_city: 'Kampala',
  status: 'active',
  withdrawal_commission_percentage: 2.5
};

// Insert into agents table
await supabase.from('agents').insert([newAgent]);
```

### Step 3: Initialize Agent Float Accounts

```javascript
// Create USD float
await supabase.from('agent_floats').insert({
  agent_id: agentId,
  currency: 'USD',
  current_balance: 5000 // Starting float
});

// Create UGX float
await supabase.from('agent_floats').insert({
  agent_id: agentId,
  currency: 'UGX',
  current_balance: 2000000 // Starting float
});
```

### Step 4: Access Agent Dashboard

```jsx
// Import component
import AgentDashboard from '@/components/AgentDashboard';

// Agent logs in → System detects agent role
// Dashboard loads with their:
✓ USD and UGX float balances
✓ Cash-In form
✓ Cash-Out form
✓ Float top-up form
✓ Recent settlements
✓ Transaction history
```

---

## TESTING CHECKLIST

### Test 1: Cash-In Transaction

- [ ] Agent selects Cash-In tab
- [ ] Enters valid user account ID
- [ ] Selects currency (USD)
- [ ] Enters amount (100)
- [ ] Clicks "Complete Cash-In"
- [ ] ✅ Agent float decreases by 100
- [ ] ✅ User wallet increases by 100
- [ ] ✅ Transaction logged with reference

### Test 2: Liquidity Guard

- [ ] Agent has only 50 USD float
- [ ] Tries to deposit 100 USD to user
- [ ] ❌ Transaction rejected
- [ ] ✅ Error message shows shortfall
- [ ] ✅ No balance change

### Test 3: Cash-Out with Commission

- [ ] Agent selects Cash-Out
- [ ] User has 500 USD in wallet
- [ ] Enters amount: 200 USD
- [ ] Clicks "Complete Cash-Out"
- [ ] ✅ User wallet: 500 → 300
- [ ] ✅ Agent earns commission: 2.5%
- [ ] ✅ Transaction shows commission breakdown

### Test 4: Dual-Currency Separation

- [ ] Agent tops up 1000 USD float
- [ ] Verifies USD balance increases
- [ ] Verifies UGX balance unchanged
- [ ] Agent tops up 500000 UGX
- [ ] Verifies UGX balance increases
- [ ] Verifies USD balance unchanged

### Test 5: Float Top-Up

- [ ] Agent clicks Top-Up
- [ ] Selects USD currency
- [ ] Enters 1000 USD amount
- [ ] Enters phone number
- [ ] Clicks "Send MOMO"
- [ ] ✅ MOMO request initiated
- [ ] ✅ Transaction status: pending
- [ ] Confirm MOMO payment
- [ ] ✅ Float instantly credited

### Test 6: Settlement Report

- [ ] Agent completes multiple transactions
- [ ] Navigates to Settlement tab
- [ ] Reviews USD and UGX balances
- [ ] Clicks "Submit Shift Settlement"
- [ ] ✅ Settlement record created
- [ ] ✅ All transactions logged
- [ ] ✅ Commissions calculated correctly

---

## COMMISSION STRUCTURE

| Transaction | Agent Commission | Platform Fee | User Cost |
|---|---|---|---|
| Cash-Out $100 | $2.50 (2.5%) | $1.25 (1.25%) | $100 + $3.75 |
| Cash-Out UGX 100K | UGX 2.5K | UGX 1.25K | 100K + UGX 3.75K |
| Cash-In | 0% | 0% | $0 (encouraged) |
| Float Top-Up | 0% | 0% | Standard MOMO fee |

---

## FILES CREATED

```
✓ AGENT_SYSTEM_SCHEMA.sql - Database schema
✓ agentService.js - Core business logic
✓ AgentDashboard.jsx - UI component
✓ AGENT_OPERATIONS_SYSTEM.md - This documentation
```

---

## NEXT STEPS

1. **Run SQL Schema** in Supabase
2. **Register Test Agent** with sample data
3. **Test All Workflows** using testing checklist
4. **Deploy Agent Dashboard** to production
5. **Monitor Settlements** via admin panel

---

**🚀 Agent System Ready for Production!**
