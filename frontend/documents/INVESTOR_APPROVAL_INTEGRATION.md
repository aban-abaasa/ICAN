# 🔗 Investor Approval System Integration Guide

## Overview
Complete integration between ShareSigningFlow.jsx (frontend) and INVESTMENT_APPROVAL_SYSTEM.sql (backend) for investor signing and shareholder approval workflow.

---

## 📊 Data Flow Diagram

```
INVESTOR SIGNS
    ↓
1. Create investment_agreements (status='signing')
    ↓
2. Create investor signature in investment_signatures
    ↓
3. Create/Upsert investment_approvals record
    ↓
4. Auto-link approval to agreement (trigger)
    ↓
WAITING FOR SHAREHOLDER APPROVALS
    ↓
5. Each shareholder signs → investment_signatures
    ↓
6. Check 60% threshold → auto-seal agreement
    ↓
7. Update approval_threshold_met = true
```

---

## 🔑 Key Database Tables

### investment_agreements
**Purpose:** Core investment deal record
**Frontend Creates:** After investor submits investment

```javascript
INSERT INTO investment_agreements {
  pitch_id: pitch.id,
  investor_id: currentUser.id,
  business_profile_id: sellerBusinessProfile.id,
  investment_type: 'buy' | 'partner' | 'support',
  shares_amount: sharesAmount || 0,
  share_price: totalInvestment / sharesAmount,
  total_investment: totalInvestment,
  status: 'signing',  // investor just signed
  escrow_id: investmentId  // links to frontend investment ID
}
```

**Key Fields:**
- `status`: pending → signing → sealed → cancelled
- `escrow_id`: Links to frontend investment transaction ID
- `sealed_at`: Set when 60% approval reached

---

### investment_signatures
**Purpose:** Track all shareholder and investor signatures

**Frontend Creates (Investor):**
```javascript
INSERT INTO investment_signatures {
  agreement_id: agreementId,      // from agreement created above
  shareholder_id: currentUser.id, // the investor
  shareholder_email: currentUser.email,
  shareholder_name: currentUser.user_metadata.full_name,
  signature_status: 'signed',
  is_business_owner: false        // investor is not owner
}
```

**Shareholders Later Add:**
- Same structure but `is_business_owner` may be true
- `signature_status` updates from 'pending' → 'signed'

**Trigger Logic:**
- When signature_status = 'signed': Auto-link approval + check 60% threshold

---

### investment_approvals
**Purpose:** Track investor wallet transfer + approval progress

**Frontend Creates (Upsert):**
```javascript
INSERT/UPDATE investment_approvals {
  investment_id: investmentId,    // UNIQUE - for upsert
  agreement_id: agreementId,      // auto-linked by trigger
  business_profile_id: sellerProfile.id,
  investor_id: currentUser.id,
  investor_email: currentUser.email,
  
  // Signature tracking
  investor_signature_status: 'pin_verified',
  investor_signed_at: NOW(),
  
  // Wallet transfer
  wallet_account_number: 'AGENT-KAM-5560',
  transfer_amount: totalInvestment,
  transfer_status: 'completed',
  transfer_reference: transactionRef,
  
  // Approval progress
  total_shareholders: getActualShareholders().length,
  shareholders_signed: 0,              // starts at 0 (just investor)
  approval_threshold_percent: 60,
  approval_threshold_met: false,       // becomes true at 60%
  document_status: 'pending'           // becomes 'finalized' at 60%
}
```

**Updates by Triggers:**
- When each shareholder signs: `shareholders_signed++`
- When 60% reached: `approval_threshold_met = true`, `document_status = 'finalized'`

---

## ⚙️ Backend Functions for Frontend Integration

### 1. `link_approval_to_agreement(p_investment_id, p_agreement_id)`
**What:** Links the approval record to the agreement after investor signs
**When:** Called automatically by trigger, can also be called manually
**Returns:** success BOOLEAN, message TEXT

```sql
SELECT link_approval_to_agreement(
  p_investment_id => 'investor-txn-id',
  p_agreement_id => 'uuid-from-agreement'
);
```

### 2. `record_investor_investment(...)`
**What:** Single function to record complete investor investment
**When:** Can be called after PIN verification (alternative flow)
**Saves:** Agreement + Signature + Links approval (all-in-one)

```sql
SELECT * FROM record_investor_investment(
  p_investment_id    => investmentId,
  p_agreement_id     => gen_random_uuid(),
  p_investor_id      => investor.id,
  p_business_profile_id => business.id,
  p_pitch_id         => pitch.id,
  p_investment_type  => 'buy',
  p_shares_amount    => 100,
  p_share_price      => 10,
  p_total_investment => 1000
);
```

### 3. `check_approval_threshold(agreement_uuid)`
**What:** Returns TRUE if 60% shareholders have signed
**When:** Called by auto-seal trigger & frontend approval check
**Use Case:** UI can use to show real-time approval status

```sql
SELECT check_approval_threshold(agreement_id) AS threshold_met;
```

### 4. `count_signed_signatures(agreement_uuid)`
**What:** Returns count of signed shareholder signatures
**Returns:** INTEGER

### 5. `get_total_shareholders(business_id)`
**What:** Returns total active shareholders for business
**Returns:** INTEGER (from business_co_owners active = true)

---

## 📱 Frontend Integration Points

### ShareSigningFlow.jsx → Backend Flow

#### Line 1336-1364: Create Investment Agreement
```jsx
const { data: agreementData } = await supabase
  .from('investment_agreements')
  .insert([{
    pitch_id: pitch.id,
    investor_id: currentUser?.id,
    business_profile_id: sellerBusinessProfile?.id,
    investment_type: investmentType || 'buy',
    shares_amount: sharesAmount || 0,
    share_price: sharesAmount > 0 ? totalInvestment / sharesAmount : 0,
    total_investment: totalInvestment,
    status: 'signing',
    escrow_id: investmentId,        // ← Links frontend transaction
    device_id: 'web_platform',
    device_location: 'in_app',
    investor_pin_hash: maskedPin
  }])
  .select()
  .single();

const agreementId = agreementData?.id;
```

#### Line 1366-1390: Record Investor Signature
```jsx
const investorSig = {
  agreement_id: agreementId,      // ← From above
  shareholder_id: currentUser?.id,
  shareholder_email: currentUser?.email,
  shareholder_name: currentUser?.user_metadata?.full_name,
  signature_pin_hash: maskedPin,
  is_business_owner: false,
  signature_status: 'signed'      // ← Investor has signed
};

const { data: sigData } = await supabase
  .from('investment_signatures')
  .insert([investorSig])
  .select();

// TRIGGER FIRES HERE:
// - auto_link_approval_to_agreement() links approval.agreement_id
// - auto_seal_agreement_on_signature() checks threshold (if 60% already met)
```

#### Line 1392-1422: Create Approval Record
```jsx
const { data: approvalData } = await supabase
  .from('investment_approvals')
  .upsert([{
    investment_id: investmentId,    // ← UNIQUE for upsert
    agreement_id: agreementId,      // ← Just created above
    business_profile_id: sellerProfile.id,
    investor_id: currentUser?.id,
    investor_email: currentUser?.email,
    
    investor_signature_status: 'pin_verified',
    investor_signed_at: new Date().toISOString(),
    
    wallet_account_number: 'AGENT-KAM-5560',
    transfer_amount: totalInvestment,
    transfer_status: 'completed',
    transfer_reference: transactionRef,
    
    total_shareholders: getActualShareholders().length,  // e.g., 12
    shareholders_signed: 0,                              // starts at 0
    approval_threshold_percent: 60,
    approval_threshold_met: false,                       // not yet
    document_status: 'pending'
  }], 
  { onConflict: 'investment_id' })    // ← Can update if exists
  .select();
```

---

## 🔄 Shareholder Approval Flow

### Line 287-375: `checkShareholderApprovalStatus()`
Runs to show approval progress in UI

```javascript
// Gets latest agreement for this pitch
const agreements = await supabase
  .from('investment_agreements')
  .select('id, status')
  .eq('pitch_id', pitchId)
  .order('created_at', { ascending: false });

const latestAgreement = agreements[0];

// Gets signed shareholders
const signatures = await supabase
  .from('investment_signatures')
  .select('*')
  .eq('agreement_id', latestAgreement.id)
  .eq('signature_status', 'signed');

const approvedCount = signatures.length;
const totalShareholders = coOwners.length;  // from business_co_owners
const percentageApproved = (approvedCount / totalShareholders) * 100;
const hasReachedThreshold = approvedCount >= Math.ceil(totalShareholders * 0.6);

// Returns to UI
return {
  approvedCount: approvedCount,
  totalRequired: Math.ceil(totalShareholders * 0.6),
  percentageApproved: percentageApproved,
  hasReachedThreshold: hasReachedThreshold
};
```

### Auto-Seal Trigger (Backend)
When 60% threshold reached:

```sql
-- 1. Agreement status changes
UPDATE investment_agreements
SET status = 'sealed', sealed_at = CURRENT_TIMESTAMP
WHERE id = agreement_id AND status = 'signing';

-- 2. Approval record updates
UPDATE investment_approvals
SET 
  approval_threshold_met = true,
  shareholders_signed = 7,           // e.g., 7 of 12
  total_shareholders = 12,
  auto_sealed_at = CURRENT_TIMESTAMP,
  document_status = 'finalized'
WHERE agreement_id = agreement_id;
```

---

## ✅ Verification Checklist

### Frontend Creation Flow
- [ ] `investment_agreements` created with `escrow_id = investmentId`
- [ ] `investment_signatures` created for investor with `agreement_id`
- [ ] `investment_approvals` uperted with `investment_id` UNIQUE
- [ ] Trigger auto-links `approval.agreement_id`

### Shareholder Signing Flow
- [ ] Other shareholders can create `investment_signatures` records
- [ ] Each signature updates `investment_approvals.shareholders_signed`
- [ ] At 60%: `approval_threshold_met = true` and `status = 'sealed'`

### View: approval progress in real-time
```javascript
// Query the view
const { data } = await supabase
  .from('agreement_approval_progress')
  .select('*')
  .eq('agreement_id', latestAgreement.id)
  .single();

// data contains:
// - signatures_signed: 7
// - total_shareholders: 12
// - approval_percentage: 58.3
// - threshold_met: false
```

---

## 🐛 Troubleshooting

### Issue: `agreement_id` not auto-linked in approval
**Check:** Did trigger `trigger_auto_link_approval_on_investor_signature` fire?
**Fix:** Manually call:
```sql
SELECT link_approval_to_agreement(investment_id, agreement_id);
```

### Issue: Approval not auto-sealing at 60%
**Check:** Is `investment_co_owners.is_active = true` for all shareholders?
**Fix:** Verify shareholder count calculation:
```sql
SELECT get_total_shareholders(business_profile_id);
```

### Issue: Investor signature not being recorded
**Check:** Is `investment_signatures` INSERT RLS enabled?
**Fix:** Verify RLS policies:
```sql
SELECT * FROM information_schema.table_privileges 
WHERE table_name = 'investment_signatures';
```

---

## 📝 Summary

| Component | Created By | Linked By | Purpose |
|-----------|-----------|-----------|---------|
| investment_agreements | Frontend (investor) | escrow_id | Core deal |
| investment_signatures (investor) | Frontend (investor) | agreement_id | Investor approval |
| investment_approvals | Frontend (investor) | investment_id (UNIQUE) | Wallet transfer |
| investment_signatures (shareholders) | Later (shareholders) | agreement_id | Shareholder approvals |
| approval auto-link | Trigger | on insert signature | Link approval ↔ agreement |
| auto-seal | Trigger | on 60% threshold | Finalize deal |

**Key Insight:** The trigger system automatically handles approval linking and threshold checking so frontend doesn't need custom logic.
