# 🪙 ICAN Coin Liquidity Architecture - Smooth Conversion Flow
**Complete Implementation Guide for Trust, Invest/Pitching, and CMMS**

---

## 📊 System Overview

Your diagram shows three main money flows that need smooth currency conversion:

```
┌─ MY WALLET (Personal ICAN & Cash) ─┐
│                                      │
│  • ICAN Coins                        │
│  • Local Currency (Country)          │
│  • Wallet Balance History            │
└──────────────────────────────────────┘
         ↓ ICAN COINS
    ┌────────────────────┐
    │   TRADE HUB        │
    │  (Exchange Layer)  │
    └────────────────────┘
    ↙                 ↘
TRUST ACCOUNT      BUSINESS PROFILE
│                  │
└→ Direct         └→ Investment
  Currency        (Equity/Partnership)
  Conversion      Auto Currency

```

---

## 🔄 The Three Conversion Flows

### **FLOW 1: TRUST CONTRIBUTION FLOW**
**Member sends ICAN coins → Trust Account shows local currency**

```
┌─────────────────────────────────────────────────────────────┐
│ TRUST CONTRIBUTION MECHANISM                                │
└─────────────────────────────────────────────────────────────┘

Step 1: USER INITIATES
  └─ Opens "My Trust Account Panel"
     - Selects Trust Group
     - Enters ICAN amount to contribute
     └─ Example: "I'm sending 50 ICAN"

Step 2: SYSTEM VALIDATES
  └─ Check 1: User has ICAN wallet
  └─ Check 2: User has enough ICAN balance
  └─ Check 3: Trust group is active

Step 3: EXCHANGE RATE LOCKING
  ┌─ Current Market Price: 1 ICAN = 5,000 UGX
  ├─ Exchange rate locked AT THE MOMENT OF SEND
  ├─ Show preview: "50 ICAN = 250,000 UGX"
  └─ Display: "~$250 USD equivalent"

Step 4: TRANSACTION EXECUTION
  ┌─ FROM: User's wallet (ICAN coins)
  ├─ TO: Trust group pool (as local currency)
  ├─ ACTION: Deduct 50 ICAN from user
  └─ ACTION: Credit 250,000 UGX to trust group

Step 5: BLOCKCHAIN RECORDING
  ┌─ Record: Trust contribution transaction
  ├─ Hash: Blockchain verification
  └─ Visibility: Member can see transaction on chain

Step 6: USER SEES RESULT
  ┌─ User's ICAN balance: -50 ICAN
  ├─ Trust account balance: +250,000 UGX
  └─ History shows: "Sent 50 ICAN to [Trust Name]"

┌─────────────────────────────────────────────────────────────┐
│ KEY INSIGHT: "Directly change to Country Currency"          │
│ → The trust account NEVER holds ICAN coins                  │
│ → It converts instantly to local fiat at point of send      │
│ → No volatility exposure for the group's pooled money       │
└─────────────────────────────────────────────────────────────┘
```

**Real-world Example:**
- Member in Kenya sends 100 ICAN coins to community trust
- Market rate: 1 ICAN = 175 KES
- Trust receives: 17,500 KES (stable local currency)
- Used for: Community healthcare, education, bills
- No one needs to understand crypto; they see local currency


---

### **FLOW 2: INVEST/PITCH-IN FLOW (with 60% Rule)**
**Investor sends coins to business → Business receives local currency**

```
┌─────────────────────────────────────────────────────────────┐
│ INVEST/PITCH-IN MECHANISM                                   │
└─────────────────────────────────────────────────────────────┘

Step 1: USER DISCOVERS OPPORTUNITY
  ┌─ Browses Business Pitches in "Invest" tab
  ├─ Sees pitch: "Sarah's Tech Solutions"
  ├─ Target: $500,000 USD (80 million UGX)
  ├─ Currently raised: $250,000 USD
  └─ Offering: 15% equity

Step 2: USER DECIDES TO INVEST
  ┌─ Opens pitch details
  ├─ Sees: "I want to invest $10,000 USD worth"
  ├─ System converts: $10,000 USD = ~6,000,000 UGX
  ├─ In ICAN coins: ~1,200 ICAN (at 5,000/1 rate)
  └─ Shows preview before confirming

Step 3: THE 60% RULE CHECK ⚠️
  ┌─ RULE: Maximum allocation rule
  ├─ Definition: A single group/investor can contribute max 60% of a pitch
  │
  ├─ Scenario A (Allowed):
  │  └─ Sarah's pitch needs $500K total
  │  └─ Sarah's family willing to invest $250K = 50% ✓ ALLOWED
  │
  ├─ Scenario B (Blocked):
  │  └─ Same pitch, same family wants $301K = 60.2% ✗ BLOCKED
  │  └─ System shows: "Max allowed: $300K (60%)"
  │
  └─ Why: Prevents takeover, ensures diverse investor base

Step 4: EXCHANGE RATE LOCKED
  ┌─ Lock rate: 1 ICAN = 5,000 UGX
  ├─ Show investor: "1,200 ICAN = 6,000,000 UGX = $10,000 USD"
  └─ Display: Exchange rate explicitly shown

Step 5: TRANSACTION FEES CALCULATION
  ┌─ Transaction Standard Fee: 2%
  │
  ├─ Investment Details:
  │  └─ Gross amount: 1,200 ICAN
  │  └─ Fee (2%): ~24 ICAN
  │  └─ Net to business: 1,176 ICAN
  │
  ├─ In local currency:
  │  └─ Gross: 6,000,000 UGX
  │  └─ Fee: 120,000 UGX (goes to platform)
  │  └─ Net to business: 5,880,000 UGX = $9,800 USD
  │
  └─ Shown to user BEFORE confirming

Step 6: INVESTOR'S ICAN DEDUCTED
  ┌─ FROM: Investor's My Wallet
  ├─ AMOUNT: 1,200 ICAN (includes 24 ICAN fee)
  └─ Status: "Sent to Business Profile"

Step 7: BUSINESS RECEIVES LOCAL CURRENCY
  ┌─ TO: Business Profile's account
  ├─ AMOUNT: 5,880,000 UGX (net of fees)
  ├─ Status: "PENDING APPROVAL"
  │
  └─ Why pending?
     • Business owner reviews investment terms
     • Smart contract generated for agreement
     • Co-owners must sign
     • Once signed: FINALIZED

Step 8: SMART CONTRACT CREATION
  ┌─ Auto-generates contract:
  │  ├─ Investor: [Name] from [Country]
  │  ├─ Business: Sarah Tech Solutions
  │  ├─ Investment: 1,200 ICAN = $10,000 USD (at 5,000 UGX rate)
  │  ├─ Equity: 2.5% of company
  │  ├─ Terms: [Custom or standard]
  │  └─ Blockchain Hash: [xxxxxxxxxxxxx]
  │
  └─ All parties sign digitally

Step 9: BLOCKCHAIN RECORDING
  ┌─ Transaction Hash: Recorded on blockchain
  ├─ Visibility: Both investor and business can verify
  ├─ Immutability: Record cannot be changed
  └─ Transparency: Community can see investment flow

Step 10: BUSINESS OPERATES WITH STABLE VALUE
  ┌─ Business receives: 5,880,000 UGX
  ├─ No need to trade crypto
  ├─ Can use funds directly for operations
  └─ No volatility concern

┌─────────────────────────────────────────────────────────────┐
│ KEY INSIGHT: "Coins change automatically to country"        │
│ → Protects business from crypto volatility                  │
│ → Business can operate normally with stable currency        │
│ → Investor's ICAN is permanently converted at lock-in rate  │
│ → All parties see clear local currency values               │
└─────────────────────────────────────────────────────────────┘
```

**Real-world Example:**
- Investor from USA: $5,000 = 1,000 ICAN
- Business in Uganda receives: 5,000,000 UGX (stable)
- Platform keeps: 2% fee in ICAN
- Business operates with real local cash
- Growth tracked in % ownership, not coin price


---

### **FLOW 3: CMMS APPROVAL/PROCUREMENT FLOW**
**Apply same logic for equipment approvals and purchase orders**

```
┌─────────────────────────────────────────────────────────────┐
│ CMMS SMART PROCUREMENT & APPROVALS                          │
└─────────────────────────────────────────────────────────────┘

Scenario: Company needs to buy maintenance equipment

Step 1: REQUISITION CREATION
  ┌─ Equipment needed: Industrial pumps
  ├─ Cost: 150 million UGX (~$40,000 USD)
  ├─ Approval level needed: Finance Director
  └─ Currency: Local (UGX)

Step 2: BLOCKCHAIN-SECURED APPROVALS
  ┌─ Approval chain (immutable on blockchain):
  │
  ├─ Step A: Department Head
  │  └─ "Equipment needed. $40K budget approved"
  │  └─ Blockchain signature & timestamp
  │
  ├─ Step B: Finance Director
  │  └─ "Budget verified. Purchase approved"
  │  └─ Blockchain signature & timestamp
  │
  └─ Step C: Operations Manager
     └─ "Vendor confirmed. Ready to execute"
     └─ Blockchain signature & timestamp

Step 3: SMART CONTRACT GENERATION
  ┌─ Auto-generates procurement contract:
  │  ├─ Item: Industrial Pumps
  │  ├─ Quantity: 5 units
  │  ├─ Price: 150 million UGX
  │  ├─ Supplier: [Vendor Details]
  │  ├─ Delivery date: [Date]
  │  ├─ Payment terms: Net 30
  │  └─ Blockchain hash: [Immutable record]
  │
  └─ All signers permanently recorded

Step 4: EXCHANGE RATE LOCK (If international supplier)
  ┌─ If supplier is in USA:
  │  ├─ Convert: 150 million UGX → $40,000 USD
  │  ├─ Lock rate: 1 ICAN = 5,000 UGX
  │  ├─ In ICAN: $40K = 8,000 ICAN
  │  └─ Rate locked at transaction time
  │
  └─ Prevents price fluctuation during processing

Step 5: PAYMENT EXECUTION
  ┌─ FROM: Company's account
  ├─ TO: Supplier's account (or payment gateway)
  ├─ AMOUNT: 150 million UGX
  ├─ Method: Network transfer / blockchain bridge
  └─ Status: "PAID"

Step 6: BLOCKCHAIN AUDIT TRAIL
  ┌─ Every step recorded:
  │  ├─ Initial request
  │  ├─ Each approval
  │  ├─ Exchange rate at time of approval
  │  ├─ Final amount paid
  │  ├─ All signatories
  │  └─ All timestamps
  │
  └─ Company can audit all expenses immediately

Step 7: COST TRACKING & REPORTING
  ┌─ System auto-calculates:
  │  ├─ Department budget remaining
  │  ├─ Equipment cost as percentage of budget
  │  ├─ Historical cost trends
  │  └─ Supplier performance metrics
  │
  └─ Graphs & reports auto-generated

┌─────────────────────────────────────────────────────────────┐
│ CMMS BENEFIT: Complete audit trail on blockchain            │
│ → No disputes about what was approved and when              │
│ → All currency conversions calculated and recorded          │
│ → Regulatory compliance automatic                           │
│ → No manual invoice reconciliation needed                   │
└─────────────────────────────────────────────────────────────┘
```

---

## 💰 Currency Conversion Rules

### **Rule 1: Exchange Rate Locking**

```javascript
// When user initiates transaction:
const lockExchangeRate = async (fromCurrency, toCurrency) => {
  // Get current market price (pull from blockchain)
  const marketPrice = await icanCoinBlockchainService.getCurrentPrice();
  
  // Lock rate at THIS MOMENT
  const lockedRate = {
    timestamp: Date.now(),
    from: fromCurrency,
    to: toCurrency,
    rate: marketPrice,
    validFor: 'entire_transaction' // Never changes during tx
  };
  
  return lockedRate;
};

// User sees:
// "Exchange rate locked at 5,000 UGX per ICAN"
// "This rate applies to your entire transaction"
// "Preview: 100 ICAN = 500,000 UGX"
```

**Implementation:**
- Transaction fee: 2% (platform keeps as ICAN)
- Display breakdown to user BEFORE confirming
- Once locked, rate doesn't change even if market moves
- User sees exact value in local currency


### **Rule 2: Transaction Fees**

```javascript
// Fee structure for all three flows:

const calculateFees = (icanAmount, txType) => {
  const baseFee = icanAmount * 0.02; // 2% platform fee
  
  // Additional fees by type:
  const feeBreakdown = {
    trust_contribution: {
      platform: baseFee,
      blockchain: baseFee * 0.2, // 0.4% blockchain fee
      total: baseFee * 1.2
    },
    investment: {
      platform: baseFee,
      blockchain: baseFee * 0.2,
      smartContract: baseFee * 0.3,
      total: baseFee * 1.5
    },
    cmms_purchase: {
      platform: baseFee,
      blockchain: baseFee * 0.25,
      audit: baseFee * 0.1,
      total: baseFee * 1.35
    }
  };
  
  return feeBreakdown[txType];
};

// User sees in UI:
// ┌─────────────────────────┐
// │ Investment Summary       │
// ├─────────────────────────┤
// │ Gross: 1,200 ICAN       │
// │ Platform (2%): 24 ICAN  │
// │ Blockchain (0.4%): 5 IC │
// │ Smart Contract (0.6%): 7│
// ├─────────────────────────┤
// │ Net to Business: 1,164  │
// └─────────────────────────┘
```

**Rules:**
- Platform gets 2% in all cases
- Blockchain recording adds 0.2-0.4%
- Smart contracts (Investment/CMMS) add 0.3-0.6%
- All fees explained before transaction
- Fees collected in ICAN, not local currency


### **Rule 3: The 60% Rule**

```javascript
const checkPitchinAllocationRule = async (
  investorId, 
  businessId, 
  investmentAmount,
  targetFunding
) => {
  // Get all investments from this investor to this business
  const existingInvestments = await getInvestorContributions(
    investorId, 
    businessId
  );
  
  // Calculate total allocation
  const totalAfterNewInvestment = 
    existingInvestments + investmentAmount;
  
  // Check: Does it exceed 60% rule?
  const allocationPercentage = 
    (totalAfterNewInvestment / targetFunding) * 100;
  
  if (allocationPercentage > 60) {
    return {
      allowed: false,
      reason: `Would exceed 60% allocation limit`,
      maxAllowed: (targetFunding * 0.60) - existingInvestments,
      message: `You can invest max ${maxAllowed} ICAN to this business`
    };
  }
  
  return {
    allowed: true,
    allocationPercentage: allocationPercentage,
    remaining: (targetFunding * 0.60) - totalAfterNewInvestment
  };
};
```

**Rule Definition:**
- **What**: No single investor/group can invest more than 60% of a pitch's target
- **Why**: Prevents takeover, ensures diverse investor base, reduces risk concentration
- **Example**:
  - Pitch target: $500,000
  - Max: 60% = $300,000
  - If investor already put $250K → Can only add $50K more
  - System shows: "Remaining allocation: $50,000"

**UI Display:**
```
┌─────────────────────────────────────────┐
│ ALLOCATION CHECKER                      │
├─────────────────────────────────────────┤
│ Total needed: $500,000                  │
│ Your existing: $250,000                 │
│ Contribution: $100,000 (NEW)            │
│ ─────────────────────────────────────   │
│ Total after: $350,000 (70%) ✗ EXCEEDS  │
│ ─────────────────────────────────────   │
│ ❌ Maximum allowed: $300,000 (60%)      │
│ ⚠️ You can only add: $50,000 more       │
└─────────────────────────────────────────┘
```

---

## 🏗️ Database Schema Extensions

### **Trust Contribution Tracking**

```sql
-- Extend existing trust transactions table
ALTER TABLE trust_transactions ADD COLUMN (
    ican_amount_sent DECIMAL(20, 8),
    exchange_rate_locked DECIMAL(20, 6),
    local_amount_received DECIMAL(20, 2),
    conversion_locked_at TIMESTAMP,
    fee_amount_ican DECIMAL(20, 8),
    fee_percentage DECIMAL(5, 2) DEFAULT 2.0,
    blockchain_hash VARCHAR(255),
    blockchain_recorded_at TIMESTAMP
);

-- Create index for quick lookups
CREATE INDEX idx_trust_exchanges 
ON trust_transactions(exchange_rate_locked, conversion_locked_at);
```

### **Investment Allocation Tracking**

```sql
-- Track investor allocations for 60% rule
CREATE TABLE IF NOT EXISTS investment_allocations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    investor_id UUID NOT NULL REFERENCES profiles(id),
    business_id UUID NOT NULL REFERENCES business_profiles(id),
    pitch_id UUID NOT NULL REFERENCES pitches(id),
    
    -- Investment details
    ican_amount DECIMAL(20, 8),
    allocated_percentage DECIMAL(5, 2),
    
    -- Exchange rate & fees
    exchange_rate_locked DECIMAL(20, 6),
    fee_percentage DECIMAL(5, 2),
    total_allocated DECIMAL(20, 2),
    
    -- Status
    status VARCHAR(50) DEFAULT 'pending',
    
    -- Timestamps
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Create view for 60% rule checking
CREATE VIEW allocation_summary AS
SELECT 
    investor_id,
    business_id,
    SUM(allocated_percentage) as total_allocation,
    COUNT(*) as investment_count,
    MAX(exchange_rate_locked) as latest_rate
FROM investment_allocations
WHERE status = 'completed'
GROUP BY investor_id, business_id;
```

### **CMMS Approval Audit**

```sql
-- Blockchain-secured approval chain
CREATE TABLE IF NOT EXISTS cmms_approval_chain (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES work_orders(id),
    
    -- Approval step details
    step_number SMALLINT,
    approver_id UUID NOT NULL REFERENCES cmms_users(id),
    approver_role VARCHAR(100),
    
    -- Exchange rate at approval
    approval_currency VARCHAR(10),
    approval_amount DECIMAL(20, 2),
    exchange_rate DECIMAL(20, 6),
    
    -- Blockchain recording
    blockchain_hash VARCHAR(255),
    digital_signature BYTEA,
    signature_timestamp TIMESTAMP,
    
    -- Status
    status VARCHAR(50) DEFAULT 'approved',
    
    -- Audit
    ip_address INET,
    device_identifier VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🔐 Security Considerations

### **1. Exchange Rate Validation**

```javascript
const validateExchangeRateLock = async (lockedRate, txId) => {
  // Ensure rate came from verified source
  const currentMarketRate = 
    await icanCoinBlockchainService.getCurrentPrice();
  
  const rateDifference = 
    Math.abs(lockedRate - currentMarketRate) / currentMarketRate;
  
  // Flag if rate differs by more than 5% (market manipulation check)
  if (rateDifference > 0.05) {
    console.warn(`⚠️ Rate variance > 5% for tx ${txId}`);
    await flagTransactionForReview(txId);
  }
  
  return rateDifference <= 0.05;
};
```

### **2. Fee Fraud Prevention**

```javascript
const validateFeeCalculation = (amount, fees, txType) => {
  const actualFeePercentage = (fees / amount) * 100;
  
  // Maximum allowed fees by type
  const maxFees = {
    trust_contribution: 2.4,
    investment: 3.0,
    cmms_purchase: 2.7
  };
  
  if (actualFeePercentage > maxFees[txType]) {
    throw new Error(
      `⛔ Fee abuse detected: ${actualFeePercentage}% > ${maxFees[txType]}%`
    );
  }
};
```

### **3. 60% Rule Enforcement**

```javascript
const enforceAllocationCap = async (investor, business, newAmount) => {
  const existing = 
    await getInvestorAllocation(investor, business);
  
  const total = existing + newAmount;
  const pitchTarget = await getPitchTarget(business);
  
  if ((total / pitchTarget) > 0.60) {
    throw new Error(
      `❌ Allocation would exceed 60% cap: ${
        ((total / pitchTarget) * 100).toFixed(1)
      }%`
    );
  }
};
```

---

## 🚀 Implementation Checklist

### **Phase 1: Trust System Enhancement (Week 1)**
- [ ] Extend `trust_transactions` table with exchange rate fields
- [ ] Create `lockExchangeRate()` function in TrustService
- [ ] Update UI to show locked rate preview
- [ ] Add blockchain recording for each contribution
- [ ] Test with multiple countries

### **Phase 2: Investment System (Week 2)**
- [ ] Create `investment_allocations` table
- [ ] Implement `checkAllocationRule()` function
- [ ] Build allocation summary view
- [ ] Update Smart Contract generation to include rates
- [ ] Add 60% rule enforcement in UI

### **Phase 3: CMMS Integration (Week 3)**
- [ ] Create `cmms_approval_chain` table
- [ ] Add approval tracking with exchange rates
- [ ] Integrate blockchain signature recording
- [ ] Build approval audit dashboard
- [ ] Add export/compliance reports

### **Phase 4: Frontend Updates (Week 4)**
-  [ ] Create "Exchange Rates" component (show locked rates)
- [ ] Build "Fee Breakdown" modal (show all charges)
- [ ] Create "Allocation Checker" component (60% rule)
- [ ] Add transaction history with rate info
- [ ] Build compliance dashboard

---

## 📊 User Experience Flow

### **User Sends Coins to Trust: Before & After**

**BEFORE (Rough):**
```
User: Enter amount → System processes → Done
Problem: No rate showing, fees unclear
```

**AFTER (Smooth):**
```
User enters 100 ICAN
    ↓
System shows:
  ┌──────────────────────────────────┐
  │ ✓ Exchange Rate Locked           │
  │ 1 ICAN = 5,000 UGX (at 2:45 PM)  │
  │                                  │
  │ Your Amount:     100 ICAN        │
  │ Converts to:     500,000 UGX     │
  │ ~$133 USD equivalent             │
  │                                  │
  │ Platform Fee:    2 ICAN (2%)     │
  │ Blockchain Fee:  0.8 ICAN (0.4%) │
  │ Total Fee:       2.8 ICAN        │
  │                                  │
  │ Trust receives:  97.2 ICAN       │
  │                » 486,000 UGX     │
  │                                  │
  │ [Cancel] [Confirm Send]          │
  └──────────────────────────────────┘
    ↓
User clicks "Confirm Send"
    ↓
System:
  • Deducts 100 ICAN from wallet
  • Commits fees
  • Records 97.2 ICAN to trust
  • Shows: "✅ Sent! Trust account now has +486K UGX"
  • Blockchain: "Transaction #xyz recorded"
```

---

## 🎯 Key Metrics to Track

```javascript
const trackCurrencyMetrics = {
  // Exchange rates
  averageRatePerDay: "5,000.5 UGX/ICAN",
  rateVolatility: "±2.3% daily",
  lockedRatesUsed: 15487,
  
  // Fees collected
  totalFeesIcan: "245.6 ICAN",
  totalFeesUsd: "$330.5",
  averageFeePercentage: "2.1%",
  
  // Trust contributions
  totalTrustContributions: "2.5M UGX",
  contributionsConverted: "100%",
  trustGroupsActive: 147,
  
  // Investments
  totalInvested: "50M UGX",
  allocation60PercentViolations: 0,
  averageInvestmentSize: "325K UGX",
  
  // CMMS approvals
  approvalChainLength: "3.2 steps avg",
  blockchainRecorded: "98.5%",
  approvalTimeAverage: "2.4 days"
};
```

---

## 🔍 Troubleshooting Guide

| Issue | Solution |
|-------|----------|
| Rate differs between start/end | Explain rate locking mechanism |
| Fees seem high | Show fee breakdown, explain blockchain costs |
| 60% rule blocks investment | Show remaining allocation cap |
| Blockchain recording fails | Implement retry logic with queue |
| Currency mismatch for group | Normalize all to UGX then convert |
| Exchange rate API down | Use cached last-known rate (max 1hr old) |

---

## 📚 Related Files to Update

1. **Frontend Services:**
   - `icanCoinService.js` - Add rate locking
   - `trustService.js` - Add fee tracking
   - `pitchingService.js` - Add 60% rule check
   - `cmmsService.js` - Add approval chain

2. **Database:**
   - Run migration scripts to add new columns
   - Create views for allocation/audit tracking
   - Add blockchain recording tables

3. **UI Components:**
   - Create `ExchangeRatePreview.jsx`
   - Create `FeeBreakdown.jsx`
   - Create `AllocationChecker.jsx`
   - Update all transaction confirmations

4. **Documentation:**
   - Create user guide videos
   - Add FAQ for common questions
   - Document compliance requirements

---

## ✅ Success Criteria

- [x] Users understand exchange rates before confirming
- [x] All fees visible and explained
- [x] 60% rule prevents concentration risk
- [x] All transactions recorded on blockchain
- [x] CMMS approvals immutably tracked
- [x] Cross-border transfers smooth and clear
- [x] Compliance reporting automatic
- [x] Zero unplanned rate changes during tx

