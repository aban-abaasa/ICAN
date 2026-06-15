# 🚀 Integration Guide: Smooth Currency Conversion Implementation

## Overview
This guide shows how to integrate the enhanced Trust, Investment, and CMMS services into your existing application components.

---

## 📁 Files Created

### **Backend Services**
- ✅ `frontend/src/services/enhancedTrustService.js` - Trust with exchange rate locking
- ✅ `frontend/src/services/enhancedInvestmentService.js` - Investment with 60% rule
- ✅ `frontend/src/services/enhancedCmmsService.js` - CMMS with approval chain

### **Frontend Components**
- ✅ `frontend/src/components/UI/ExchangeRatePreview.jsx` - Shows locked rates
- ✅ `frontend/src/components/UI/FeeBreakdown.jsx` - Shows fee structure
- ✅ `frontend/src/components/UI/AllocationChecker.jsx` - Shows 60% rule enforcement

---

## 🔄 Integration Steps

### **Step 1: Update TrustSystem Component**

**File:** `frontend/src/components/TrustSystem.jsx`

Replace the contribution logic with enhanced service:

```jsx
import enhancedTrustService from '../services/enhancedTrustService';
import ExchangeRatePreview from './UI/ExchangeRatePreview';
import FeeBreakdown from './UI/FeeBreakdown';

export default function TrustSystem() {
  const [contributionAmount, setContributionAmount] = useState('');
  const [lockedRate, setLockedRate] = useState(null);

  const handleContribute = async () => {
    try {
      // Get country from user profile
      const userCountry = currentUser.country || 'UG';

      // Step 1: Lock exchange rate
      const rateLock = await enhancedTrustService.lockExchangeRate(
        'ICAN',
        'local',
        `tx_${Date.now()}`,
        'trust_contribution'
      );

      if (!rateLock.success) throw new Error('Rate lock failed');

      // Step 2: Record contribution
      const result = await enhancedTrustService.recordTrustContributionWithConversion({
        groupId: selectedGroup.id,
        fromUserId: currentUser.id,
        toUserId: selectedGroup.creator_id,
        icanAmount: parseFloat(contributionAmount),
        lockedRate: rateLock.lockedRate,
        countryCode: userCountry,
        exchangeRateLockId: rateLock.recordId
      });

      if (result.success) {
        setMessage({
          type: 'success',
          text: `✅ Contributed ${contributionAmount} ICAN (${result.breakdown.net_local.toLocaleString()} ${result.breakdown.currency_code})`
        });
      }
    } catch (error) {
      setMessage({ type: 'error', text: error.message });
    }
  };

  return (
    <div className="space-y-4">
      {/* Exchange Rate Preview */}
      <ExchangeRatePreview
        icanAmount={parseFloat(contributionAmount) || 0}
        countryCode={currentUser.country || 'UG'}
        txType="trust_contribution"
        onRateLocked={setLockedRate}
      />

      {/* Fee Breakdown */}
      <FeeBreakdown
        icanAmount={parseFloat(contributionAmount) || 0}
        txType="trust_contribution"
        lockedRate={lockedRate || 5000}
      />

      {/* Contribution Input */}
      <input
        type="number"
        value={contributionAmount}
        onChange={(e) => setContributionAmount(e.target.value)}
        placeholder="Enter ICAN amount"
        className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
      />

      <button
        onClick={handleContribute}
        disabled={!lockedRate || !contributionAmount}
        className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-600 px-4 py-2 rounded text-white font-semibold"
      >
        Confirm Contribution
      </button>
    </div>
  );
}
```

---

### **Step 2: Update Pitchin/Investment Component**

**File:** `frontend/src/components/Pitchin.jsx` or `frontend/src/components/InvestmentFlow.jsx`

```jsx
import enhancedInvestmentService from '../services/enhancedInvestmentService';
import ExchangeRatePreview from './UI/ExchangeRatePreview';
import FeeBreakdown from './UI/FeeBreakdown';
import AllocationChecker from './UI/AllocationChecker';

export default function InvestmentFlow({ pitch, business }) {
  const [investmentAmount, setInvestmentAmount] = useState('');
  const [lockedRate, setLockedRate] = useState(null);
  const [allocationData, setAllocationData] = useState(null);

  const handleInvest = async () => {
    try {
      // Verify allocation is allowed
      if (!allocationData?.allowed) {
        throw new Error(allocationData?.message || 'Investment not allowed');
      }

      // Lock exchange rate
      const rateLock = await enhancedInvestmentService.lockExchangeRate(
        'ICAN',
        'local',
        `tx_${Date.now()}`,
        'investment'
      );

      // Record investment with allocation tracking
      const result = await enhancedInvestmentService.recordInvestmentWithAllocation({
        investorId: currentUser.id,
        businessId: business.id,
        pitchId: pitch.id,
        icanAmount: parseFloat(investmentAmount),
        lockedRate: rateLock.lockedRate,
        countryCode: currentUser.country,
        investmentType: 'equity',
        equityPercentage: calculateEquityPercentage(),
        exchangeRateLockId: rateLock.recordId,
        blockchainHashSignature: await generateSignature()
      });

      if (result.success) {
        console.log('✅ Investment recorded:', result);
        // Show smart contract for signing
        showSmartContract(result.smartContract);
      }
    } catch (error) {
      console.error('❌ Investment failed:', error.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Allocation Rule Check */}
      <AllocationChecker
        investorId={currentUser.id}
        businessId={business.id}
        pitchId={pitch.id}
        proposedAmountIcan={parseFloat(investmentAmount) || 0}
        targetFundingUsd={pitch.target_funding}
        onAllocationChange={setAllocationData}
        txType="investment"
      />

      {/* Exchange Rate */}
      <ExchangeRatePreview
        icanAmount={parseFloat(investmentAmount) || 0}
        countryCode={currentUser.country}
        txType="investment"
        onRateLocked={setLockedRate}
      />

      {/* Fees */}
      <FeeBreakdown
        icanAmount={parseFloat(investmentAmount) || 0}
        txType="investment"
        lockedRate={lockedRate || 5000}
      />

      {/* Investment Input */}
      <input
        type="number"
        value={investmentAmount}
        onChange={(e) => setInvestmentAmount(e.target.value)}
        placeholder="Enter ICAN to invest"
        className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
      />

      {/* Invest Button */}
      <button
        onClick={handleInvest}
        disabled={!lockedRate || !investmentAmount || !allocationData?.allowed}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-slate-600 px-4 py-2 rounded text-white font-semibold"
      >
        {allocationData?.allowed ? 'Proceed to Investment' : 'Investment Not Allowed'}
      </button>
    </div>
  );
}
```

---

### **Step 3: Update CMMS Requisition Component**

**File:** `frontend/src/components/CMMS/RequisitionFlow.jsx`

```jsx
import enhancedCmmsService from '../services/enhancedCmmsService';
import ExchangeRatePreview from './UI/ExchangeRatePreview';
import FeeBreakdown from './UI/FeeBreakdown';

export default function RequisitionFlow({ company }) {
  const [requisition, setRequisition] = useState({
    description: '',
    quantity: 1,
    estimatedCost: 0,
    currency: 'UGX'
  });

  const handleCreateRequisition = async () => {
    try {
      // Create approval chain
      const chainResult = await enhancedCmmsService.createApprovalChain({
        requisitionId: `REQ_${Date.now()}`,
        workOrderId: requisition.workOrderId,
        itemDescription: requisition.description,
        quantity: requisition.quantity,
        estimatedCost: requisition.estimatedCost,
        currency: requisition.currency,
        companyId: company.id,
        approvalRequirements: ['manager', 'finance', 'operations'],
        initiatorId: currentUser.id
      });

      if (chainResult.success) {
        console.log('✅ Requisition created:', chainResult.chainId);
        // Route to approval page
        navigateTo(`/cmms/approvals/${chainResult.chainId}`);
      }
    } catch (error) {
      console.error('❌ Requisition creation failed:', error);
    }
  };

  const handleApproveStep = async (chainId, status, comment) => {
    try {
      const result = await enhancedCmmsService.recordApprovalStep({
        approvalChainId: chainId,
        approverId: currentUser.id,
        approverRole: currentUser.cmmsRole,
        status: status, // 'approved', 'rejected'
        comment: comment,
        exchangeRateAtApproval: 5000, // Get current rate
        approvalAmount: requisition.estimatedCost,
        currency: requisition.currency,
        blockchainSignature: await signWithBlockchain(),
        ipAddress: getUserIp(),
        deviceId: getDeviceId()
      });

      if (result.success) {
        console.log('✅ Approval recorded:', result.step.blockchain_hash);
        setMessage(`✓ ${status === 'approved' ? 'Approved' : 'Rejected'} and recorded on blockchain`);
      }
    } catch (error) {
      console.error('❌ Approval failed:', error);
    }
  };

  return (
    <div className="space-y-4">
      {/* Requisition Form */}
      <div className="space-y-3">
        <input
          value={requisition.description}
          onChange={(e) => setRequisition({ ...requisition, description: e.target.value })}
          placeholder="Item description"
          className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
        />

        <input
          type="number"
          value={requisition.estimatedCost}
          onChange={(e) => setRequisition({ ...requisition, estimatedCost: parseFloat(e.target.value) })}
          placeholder="Estimated cost"
          className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded text-white"
        />
      </div>

      {/* Exchange Rate & Fees */}
      <ExchangeRatePreview
        icanAmount={0}
        countryCode="UG"
        txType="cmms_payment"
      />

      <FeeBreakdown
        icanAmount={requisition.estimatedCost / 5000}
        txType="cmms_payment"
      />

      <button
        onClick={handleCreateRequisition}
        className="w-full bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-white font-semibold"
      >
        Create Requisition
      </button>

      {/* Approval Chain Display */}
      {requisition.chainId && (
        <div className="bg-slate-800/40 border border-slate-700/30 rounded-lg p-4">
          <h3 className="font-semibold text-white mb-3">Approval Chain</h3>
          {requisition.approvalSteps?.map((step, idx) => (
            <div key={idx} className="mb-3 pb-3 border-b border-slate-700/30">
              <div className="flex items-center justify-between">
                <span className="text-slate-300">{step.required_role}</span>
                <span className={`px-2 py-1 rounded text-xs font-semibold ${
                  step.status === 'approved' ? 'bg-emerald-500/20 text-emerald-300' :
                  step.status === 'rejected' ? 'bg-red-500/20 text-red-300' :
                  'bg-yellow-500/20 text-yellow-300'
                }`}>
                  {step.status}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">Hash: {step.blockchain_hash?.slice(0, 16)}...</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

---

## 📊 Database Migrations

Run these SQL migrations to add required tables:

### **1. Exchange Rate Locks Table**

```sql
CREATE TABLE IF NOT EXISTS exchange_rate_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tx_id VARCHAR(255) UNIQUE,
  tx_type VARCHAR(50), -- 'trust_contribution', 'investment', 'cmms_payment'
  from_currency VARCHAR(10),
  to_currency VARCHAR(10),
  locked_rate DECIMAL(20, 6),
  locked_at TIMESTAMP,
  locked_by VARCHAR(255),
  status VARCHAR(50) DEFAULT 'active',
  valid_duration_minutes INTEGER DEFAULT 30,
  expires_at TIMESTAMP,
  is_blockchain_verified BOOLEAN DEFAULT false,
  blockchain_source VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_exchange_rate_locks_tx_id ON exchange_rate_locks(tx_id);
CREATE INDEX idx_exchange_rate_locks_expires ON exchange_rate_locks(expires_at);
```

### **2. Investment Allocations Table**

```sql
CREATE TABLE IF NOT EXISTS investment_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id UUID NOT NULL REFERENCES profiles(id),
  business_id UUID NOT NULL REFERENCES business_profiles(id),
  pitch_id UUID NOT NULL REFERENCES pitches(id),
  ican_amount DECIMAL(20, 8),
  allocated_percentage DECIMAL(5, 2),
  exchange_rate_locked DECIMAL(20, 6),
  fee_percentage DECIMAL(5, 2),
  total_allocated DECIMAL(20, 2),
  total_allocated_usd DECIMAL(20, 2),
  status VARCHAR(50) DEFAULT 'pending_approval', -- 'pending_approval', 'completed', 'rejected'
  investment_type VARCHAR(50), -- 'equity', 'debt', 'support'
  equity_percentage DECIMAL(5, 2),
  smart_contract_id UUID,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_investment_allocations_investor ON investment_allocations(investor_id, business_id);
CREATE INDEX idx_investment_allocations_60pct ON investment_allocations(business_id, allocated_percentage) WHERE status = 'completed';
```

### **3. CMMS Approval Chain Tables**

```sql
CREATE TABLE IF NOT EXISTS cmms_approval_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requisition_id BIGINT UNIQUE,
  work_order_id UUID REFERENCES work_orders(id),
  company_id UUID REFERENCES cmms_companies(id),
  item_description TEXT,
  quantity INTEGER,
  estimated_cost DECIMAL(20, 2),
  currency VARCHAR(10),
  required_approvals TEXT[], -- array of roles
  current_step SMALLINT DEFAULT 1,
  total_steps SMALLINT,
  status VARCHAR(50) DEFAULT 'pending_approvals',
  initiated_by UUID,
  initiated_at TIMESTAMP,
  approved_at TIMESTAMP,
  completed_at TIMESTAMP,
  total_approval_time_minutes INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cmms_approval_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  approval_chain_id UUID NOT NULL REFERENCES cmms_approval_chains(id),
  step_number SMALLINT,
  required_role VARCHAR(100),
  approver_id UUID NOT NULL REFERENCES cmms_users(id),
  approver_role VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending', -- 'approved', 'rejected', 'pending_revision'
  comment TEXT,
  approval_currency VARCHAR(10),
  approval_amount DECIMAL(20, 2),
  exchange_rate_at_approval DECIMAL(20, 6),
  amount_usd DECIMAL(20, 2),
  blockchain_signature BYTEA,
  blockchain_hash VARCHAR(255) UNIQUE,
  ip_address INET,
  device_identifier VARCHAR(255),
  approved_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 🧪 Testing Checklist

- [ ] Exchange rate locks when user initiates transaction
- [ ] Rates don't change during 30-minute window
- [ ] Fees calculated correctly for all tx types
- [ ] Trust contributions show local currency to members
- [ ] 60% rule prevents over-allocation
- [ ] Smart contracts auto-generate on investment
- [ ] CMMS approvals recorded on blockchain
- [ ] Audit trail shows all exchange rates
- [ ] Users see breakdown before confirming
- [ ] Mobile-responsive UI

---

## 🐛 Common Issues & Fixes

| Issue | Solution |
|-------|----------|
| Rate lock fails | Check blockchain service connectivity |
| 60% calculation off | Verify all completed allocations are counted |
| Smart contract missing | Ensure generator is called after investment |
| Blockchain hash conflicts | Use unique tx_id for each transaction |
| UI not showing fees | Verify FeeBreakdown component imported |

---

## 📈 Monitoring

Add these metrics to your dashboard:

```javascript
const metricsToTrack = {
  // Rates
  averageRateLocked: 'Track locked rates vs market',
  rateShift: 'Monitor if locked rates differ > 5%',
  
  // Fees
  totalFeeCollected: 'Platform revenue',
  averageFeePercentage: 'Should be ~2.1-2.4%',
  
  // Allocations
  violationAttempts: 'Users exceeding 60%',
  averageAllocationPercentage: 'Diversity metric',
  
  // Approvals
  averageApprovalTime: 'Workflow efficiency',
  blockchainSuccessRate: 'Recording reliability'
};
```

---

## ✅ Deployment Checklist

- [ ] All migrations run successfully
- [ ] Services deployed and tested
- [ ] UI components displaying correctly
- [ ] Blockchain integration working
- [ ] Database backups in place
- [ ] Error logging enabled
- [ ] User documentation updated
- [ ] Team trained on new workflows

