-- =====================================================
-- TEST: 60% SHAREHOLDER APPROVAL THRESHOLD
-- =====================================================

-- For the DAB business profile:

-- Step 1: Check how many shareholders (co-owners) exist
SELECT 
  COUNT(*) as total_shareholders,
  ROUND(COUNT(*) * 0.6) as required_approvals_60_percent
FROM business_co_owners
WHERE business_profile_id = (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
)
AND status = 'active';

-- Expected: Should show something like:
-- total_shareholders | required_approvals_60_percent
-- 2                  | 1
-- 3                  | 2
-- etc.

-- =====================================================

-- Step 2: Check current approval status
SELECT 
  ia.id as agreement_id,
  ia.status as agreement_status,
  ia.escrow_id,
  COUNT(sn.id) as total_shareholders_notified,
  COUNT(CASE WHEN sn.read_at IS NOT NULL THEN 1 END) as approved_count,
  ROUND(100.0 * COUNT(CASE WHEN sn.read_at IS NOT NULL THEN 1 END) / 
        NULLIF(COUNT(sn.id), 0)) as approval_percentage
FROM investment_agreements ia
LEFT JOIN shareholder_notifications sn ON sn.business_profile_id = ia.business_profile_id
WHERE ia.business_profile_id = (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
)
GROUP BY ia.id, ia.status, ia.escrow_id
ORDER BY ia.created_at DESC
LIMIT 5;

-- Expected output shows:
-- agreement_id | agreement_status | approved_count | approval_percentage
-- [uuid]       | pending          | 0              | 0
-- [uuid]       | pending          | 1              | 50 (if 2 shareholders)
-- [uuid]       | sealed           | 1              | 50 (auto-sealed when threshold reached)

-- =====================================================

-- Step 3: Check investment_approvals table
SELECT 
  ia.id,
  ia.agreement_id,
  ia.approval_status,
  ia.approved_by,
  ia.approval_date,
  created_at
FROM investment_approvals ia
WHERE ia.agreement_id IN (
  SELECT id FROM investment_agreements 
  WHERE business_profile_id = (
    SELECT id FROM business_profiles WHERE business_name = 'DAB'
  )
)
ORDER BY created_at DESC
LIMIT 10;

-- This shows individual shareholder approvals recorded

-- =====================================================

-- Step 4: Test - Simulate 60% approval reached
-- Check if the auto-seal logic is working

-- Get an agreement that's still pending
SELECT 
  id,
  status,
  escrow_id,
  created_at
FROM investment_agreements
WHERE business_profile_id = (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
)
AND status = 'pending'
ORDER BY created_at DESC
LIMIT 1;

-- Expected: If 60% approved, status should be 'sealed' (not 'pending')

-- =====================================================

-- WHAT SHOULD HAPPEN:
-- 1. Investor creates investment
-- 2. System creates shareholder_notifications for ALL co-owners
-- 3. Each shareholder approves (marks read_at)
-- 4. When approval_percentage >= 60%, agreement AUTOMATICALLY seals
-- 5. Funds transfer is initiated

-- =====================================================

-- TO TEST MANUALLY:

-- Scenario 1: 2 Shareholders (60% = 1.2 ≈ 2 people needed)
-- ✅ If 1 approves → 50% (not sealed) → Still shows pending
-- ✅ If 2 approve → 100% (sealed)  → Auto-seals, funds transfer

-- Scenario 2: 3 Shareholders (60% = 1.8 ≈ 2 people needed)  
-- ✅ If 1 approves → 33% (not sealed)
-- ✅ If 2 approve → 67% (sealed)  → Auto-seals, funds transfer
-- ✅ If 3 approve → 100% (sealed)

-- =====================================================

-- TO CHECK IF AUTO-SEAL IS WORKING:

-- 1. See how many shareholders approved
-- 2. Calculate if >= 60%
-- 3. Check if agreement.status changed to 'sealed'
-- 4. Check if funds transfer was initiated

SELECT 
  'APPROVAL STATUS CHECK' as check_name,
  ia.business_profile_id,
  ia.id as agreement_id,
  ia.status,
  COUNT(sn.id) as total_notify,
  COUNT(CASE WHEN sn.read_at IS NOT NULL THEN 1 END) as approved,
  ROUND(100.0 * COUNT(CASE WHEN sn.read_at IS NOT NULL THEN 1 END) / 
        NULLIF(COUNT(sn.id), 0)) as pct,
  CASE 
    WHEN ROUND(100.0 * COUNT(CASE WHEN sn.read_at IS NOT NULL THEN 1 END) / 
         NULLIF(COUNT(sn.id), 0)) >= 60 
    THEN '✅ 60% REACHED - Should be SEALED'
    ELSE '⏳ Below 60% - Still pending'
  END as status_check
FROM investment_agreements ia
LEFT JOIN shareholder_notifications sn ON sn.business_profile_id = ia.business_profile_id
WHERE ia.business_profile_id = (
  SELECT id FROM business_profiles WHERE business_name = 'DAB'
)
GROUP BY ia.id, ia.status, ia.business_profile_id
ORDER BY ia.created_at DESC;
