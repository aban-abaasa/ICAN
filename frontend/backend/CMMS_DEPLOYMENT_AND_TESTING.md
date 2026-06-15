# CMMS Department Inventory & Requisitions - Deployment & Testing Guide

## Pre-Deployment Checklist

### Database Preparation
- [ ] Backup current database
- [ ] Have SQL script ready: `CMMS_DEPARTMENT_INVENTORY_REQUISITIONS.sql`
- [ ] Test script in development environment first
- [ ] Verify Supabase SQL Editor is accessible
- [ ] Have admin credentials ready

### Team Preparation
- [ ] Notify users of maintenance window
- [ ] Document current inventory process
- [ ] Identify department heads for each department
- [ ] Get list of staff assignments per department
- [ ] Document budget allocations per department

---

## Step 1: Deploy SQL Schema

### 1.1 In Supabase SQL Editor

```bash
1. Go to Supabase Dashboard
2. Select your project
3. Click "SQL Editor"
4. Click "New Query"
5. Name it: "CMMS_DEPARTMENT_INVENTORY_REQUISITIONS_DEPLOYMENT"
6. Copy entire content of CMMS_DEPARTMENT_INVENTORY_REQUISITIONS.sql
7. Paste into editor
8. Click "Run"
9. Wait for completion (should take 1-2 minutes)
```

### 1.2 Verify Deployment Success

```sql
-- Run these verification queries in new SQL windows:

-- Check all tables created
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
  AND (table_name LIKE 'cmms_department%'
       OR table_name LIKE 'cmms_inventory%'
       OR table_name LIKE 'cmms_requisition%')
ORDER BY table_name;

-- Expected result: 6-7 tables
-- - cmms_departments
-- - cmms_department_staff
-- - cmms_inventory_items
-- - cmms_requisitions
-- - cmms_requisition_items
-- - cmms_requisition_approvals

-- Check views created
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public'
  AND table_type = 'VIEW'
  AND table_name LIKE 'v_%'
ORDER BY table_name;

-- Expected views:
-- - v_department_inventory
-- - v_department_staff
-- - v_requisition_summary

-- Check functions created
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public'
  AND routine_name LIKE '%requisition%' 
  OR routine_name LIKE '%inventory%'
  OR routine_name LIKE '%department%'
ORDER BY routine_name;

-- Check RLS is enabled
SELECT tablename 
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE 'cmms_%'
ORDER BY tablename;

-- Then check each has RLS:
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND tablename LIKE 'cmms_department%'
   OR tablename LIKE 'cmms_inventory%'
   OR tablename LIKE 'cmms_requisition%';

-- Expected: All should have rowsecurity = true
```

---

## Step 2: Initial Data Setup

### 2.1 Create Company Departments

```sql
-- Get your company ID first
SELECT id, company_name FROM cmms_company_profiles LIMIT 1;

-- Then insert departments (replace company-uuid with your actual company ID)
INSERT INTO cmms_departments (
  cmms_company_id,
  department_name,
  department_code,
  description,
  annual_budget,
  created_by
) VALUES 
  ('COMPANY-UUID-HERE', 'Maintenance', 'MAINT-001', 'Maintenance and repairs', 50000, NULL),
  ('COMPANY-UUID-HERE', 'Operations', 'OPS-001', 'Day-to-day operations', 30000, NULL),
  ('COMPANY-UUID-HERE', 'Engineering', 'ENG-001', 'Engineering and planning', 40000, NULL),
  ('COMPANY-UUID-HERE', 'Quality', 'QA-001', 'Quality assurance', 25000, NULL);

-- Verify insertion
SELECT id, department_name, department_code, annual_budget 
FROM cmms_departments 
WHERE cmms_company_id = 'COMPANY-UUID-HERE';
```

### 2.2 Get User IDs

```sql
-- After departments created, get user IDs to assign
SELECT id, email, full_name, department 
FROM cmms_users 
WHERE cmms_company_id = 'COMPANY-UUID-HERE';

-- Note down the UUIDs for department heads and staff
```

### 2.3 Assign Staff to Departments

```sql
-- Assign department heads
INSERT INTO cmms_department_staff (
  department_id,
  cmms_user_id,
  cmms_company_id,
  is_primary_department,
  assigned_by,
  is_active
) VALUES 
  -- Maintenance: John (coordinator)
  ('MAINT-DEPT-UUID', 'JOHN-USER-UUID', 'COMPANY-UUID-HERE', TRUE, NULL, TRUE),
  -- Operations: Sarah (coordinator)
  ('OPS-DEPT-UUID', 'SARAH-USER-UUID', 'COMPANY-UUID-HERE', TRUE, NULL, TRUE),
  -- Engineering: Mike (coordinator)
  ('ENG-DEPT-UUID', 'MIKE-USER-UUID', 'COMPANY-UUID-HERE', TRUE, NULL, TRUE);

-- Add more staff to departments
INSERT INTO cmms_department_staff (
  department_id,
  cmms_user_id,
  cmms_company_id,
  is_primary_department,
  is_active
) VALUES 
  ('MAINT-DEPT-UUID', 'TECH1-UUID', 'COMPANY-UUID-HERE', FALSE, TRUE),
  ('MAINT-DEPT-UUID', 'TECH2-UUID', 'COMPANY-UUID-HERE', FALSE, TRUE),
  ('OPS-DEPT-UUID', 'STAFF1-UUID', 'COMPANY-UUID-HERE', FALSE, TRUE);

-- Verify assignments
SELECT 
  cd.department_name,
  cu.full_name,
  cu.email,
  cds.is_primary_department
FROM cmms_department_staff cds
JOIN cmms_departments cd ON cds.department_id = cd.id
JOIN cmms_users cu ON cds.cmms_user_id = cu.id;
```

### 2.4 Add Sample Inventory

```sql
-- Add inventory items to Maintenance department
INSERT INTO cmms_inventory_items (
  department_id,
  cmms_company_id,
  item_code,
  item_name,
  description,
  category,
  quantity_in_stock,
  unit_of_measure,
  unit_price,
  reorder_level,
  reorder_quantity,
  supplier_name,
  lead_time_days,
  storage_location,
  bin_number,
  is_active
) VALUES 
  ('MAINT-DEPT-UUID', 'COMPANY-UUID-HERE', 'PUMP-001', 'Hydraulic Pump', 'Industrial pump for equipment', 'spare_parts', 5, 'pcs', 450.00, 3, 10, 'Premier Supplies', 5, 'Bin A', 'A-15', TRUE),
  ('MAINT-DEPT-UUID', 'COMPANY-UUID-HERE', 'SEAL-001', 'Seals Kit', 'O-ring and seal replacement kit', 'spare_parts', 0, 'pcs', 75.50, 2, 5, 'Premier Supplies', 2, 'Bin A', 'A-16', TRUE),
  ('MAINT-DEPT-UUID', 'COMPANY-UUID-HERE', 'BELT-001', 'Drive Belt', 'Replacement drive belt', 'spare_parts', 10, 'pcs', 125.00, 5, 15, 'Premium Parts Inc', 3, 'Bin B', 'B-10', TRUE),
  ('MAINT-DEPT-UUID', 'COMPANY-UUID-HERE', 'OIL-001', 'Lubricating Oil', 'ISO 46 Hydraulic oil', 'consumables', 200, 'liters', 12.50, 50, 200, 'Oil Distributors LLC', 2, 'Storage Tank', 'T-01', TRUE);

-- Verify inventory
SELECT 
  item_code,
  item_name,
  quantity_in_stock,
  reorder_level,
  CASE 
    WHEN quantity_in_stock <= reorder_level THEN 'REORDER_NEEDED'
    WHEN quantity_in_stock = 0 THEN 'OUT_OF_STOCK'
    ELSE 'IN_STOCK'
  END as stock_status
FROM cmms_inventory_items
WHERE department_id = 'MAINT-DEPT-UUID';
```

---

## Step 3: Testing

### Test 1: View Testing

#### Test 1.1: Department Staff View
```sql
SELECT * FROM v_department_staff 
WHERE department_name = 'Maintenance';

-- Expected: Shows all staff in that dept with their roles
```

#### Test 1.2: Department Inventory View
```sql
SELECT 
  item_name,
  quantity_in_stock,
  stock_status,
  stock_value,
  department_name
FROM v_department_inventory
WHERE department_name = 'Maintenance';

-- Expected: Shows inventory items with calculated stock_value and status
```

#### Test 1.3: Requisition Summary View
```sql
SELECT * FROM v_requisition_summary LIMIT 1;

-- Expected: Empty initially (no requisitions yet)
-- Schema should show all columns ready
```

### Test 2: Function Testing

#### Test 2.1: Generate Requisition Number
```sql
SELECT public.generate_requisition_number('COMPANY-UUID-HERE') as next_req_number;

-- Expected: REQ-2026-00001 (or next sequential number)
-- Run multiple times to verify increment
```

#### Test 2.2: Submit Requisition (Via RPC)

```javascript
// JavaScript test in browser console

const { data, error } = await supabase
  .rpc('submit_requisition', {
    p_department_id: 'MAINT-DEPT-UUID',
    p_purpose: 'maintenance',
    p_justification: 'Regular pump maintenance - quarterly schedule',
    p_urgency_level: 'normal',
    p_required_by_date: '2026-03-07',
    p_items: [
      {
        inventory_item_id: 'PUMP-001-UUID',
        item_code: 'PUMP-001',
        item_name: 'Hydraulic Pump',
        requested_quantity: 2,
        unit_of_measure: 'pcs',
        unit_price: 450.00,
        lead_time_days: 5
      }
    ]
  });

if (error) {
  console.error('Error:', error);
} else {
  console.log('Requisition created:', data);
  // Should return UUID of new requisition
}
```

#### Test 2.3: Verify Requisition Created
```sql
SELECT 
  requisition_number,
  status,
  total_estimated_cost,
  budget_sufficient
FROM cmms_requisitions
ORDER BY created_at DESC
LIMIT 1;

-- Expected: 
-- - requisition_number: REQ-2026-00001
-- - status: pending_department_head
-- - total_estimated_cost: 900.00
-- - budget_sufficient: TRUE (9000 < 50000 available)
```

#### Test 2.4: Check Budget Calculation
```sql
SELECT 
  cr.requisition_number,
  cr.total_estimated_cost,
  cr.budget_available,
  cr.budget_sufficient,
  cr.cost_over_threshold
FROM cmms_requisitions cr
WHERE cr.id = 'REQUISITION-UUID-HERE';

-- Expected:
-- - total_estimated_cost: 900.00
-- - budget_sufficient: TRUE
-- - cost_over_threshold: FALSE (900 < 10000 which is 20% of budget)
```

### Test 3: Approval Workflow

#### Test 3.1: Approve Requisition
```javascript
// Department head approves

const { error } = await supabase
  .rpc('approve_requisition', {
    p_requisition_id: 'REQUISITION-UUID-HERE',
    p_decision: 'approved',
    p_comment: 'Approved for order. Standard maintenance items.'
  });

if (error) {
  console.error('Error:', error);
} else {
  console.log('Requisition approved');
}
```

#### Test 3.2: Verify Approval Recorded
```sql
SELECT 
  cr.requisition_number,
  cr.status,
  cr.dept_head_approved_at,
  curr.decision,
  curr.decision_comment
FROM cmms_requisitions cr
LEFT JOIN cmms_requisition_approvals curr ON cr.id = curr.requisition_id
WHERE cr.id = 'REQUISITION-UUID-HERE';

-- Expected:
-- - status: pending_finance (if multiple levels)
-- - dept_head_approved_at: Timestamp of approval
-- - Approval record exists
```

### Test 4: Inventory Update After Delivery

#### Test 4.1: Record Item Delivery
```javascript
// Storeman receives items

const { error } = await supabase
  .rpc('receive_requisition_items', {
    p_requisition_id: 'REQUISITION-UUID-HERE',
    p_delivery_notes: 'Received 2x Hydraulic Pump. All items inspected and in good condition.'
  });

if (error) {
  console.error('Error:', error);
} else {
  console.log('Items received');
}
```

#### Test 4.2: Verify Inventory Updated
```sql
SELECT 
  item_name,
  quantity_in_stock,
  last_stock_check
FROM cmms_inventory_items
WHERE item_code = 'PUMP-001';

-- Expected:
-- - quantity_in_stock: 7 (was 5, added 2)
-- - last_stock_check: Recent timestamp
```

#### Test 4.3: Verify Requisition Closed
```sql
SELECT 
  requisition_number,
  status,
  actual_delivery_date
FROM cmms_requisitions
WHERE id = 'REQUISITION-UUID-HERE';

-- Expected:
-- - status: delivered
-- - actual_delivery_date: Recent timestamp
```

### Test 5: RLS (Row Level Security) Testing

#### Test 5.1: User Can Only See Their Company Data
```javascript
// Login as John (Maintenance dept)
// Try to access inventory

const { data, error } = await supabase
  .from('cmms_inventory_items')
  .select('*');

// Expected: Only sees Maintenance inventory
// Should NOT see Operations or Engineering inventory
```

#### Test 5.2: Role-Based Access Control
```sql
-- As storeman user, try to create requisition
SELECT * FROM cmms_requisitions 
WHERE requested_by = 'STOREMAN-USER-ID';

-- Expected: Should only see requisitions they created
-- Cannot see others' requisitions unless in same dept
```

---

## Test Data Scenarios

### Scenario 1: Normal Requisition Flow
```
1. Technician submits: Need 2 pumps for maintenance
2. Dept Head approves: ✓ Approved
3. Finance approves: ✓ Budget OK
4. Admin orders: PO placed with supplier
5. Items received: Stock updated
6. Requisition closed: ✓ Complete
```

### Scenario 2: Budget Alert
```
1. Technician submits: $15,000 requisition
2. Dept Head sees: Cost > 20% of budget
3. Marked: cost_over_threshold = TRUE
4. Extra review needed: May be sent to admin
5. Approved if justified
```

### Scenario 3: Stock Alert
```
1. Seals inventory at 0 (OUT_OF_STOCK)
2. System shows: REORDER_NEEDED status
3. Auto-requisition created to reorder
4. Once received: Stock updated
5. Status changes to IN_STOCK
```

---

## Performance Testing

### Query Performance

```sql
-- Test 1: List requisitions (should be < 100ms)
SELECT * FROM v_requisition_summary 
WHERE cmms_company_id = 'COMPANY-UUID-HERE'
LIMIT 100;

-- Test 2: Inventory by department (should be < 50ms)
SELECT * FROM v_department_inventory 
WHERE department_name = 'Maintenance'
LIMIT 100;

-- Test 3: Staff by department (should be < 50ms)
SELECT * FROM v_department_staff 
WHERE department_name = 'Maintenance';
```

### Load Testing

```sql
-- Insert 100 requisitions to test performance
-- Create test data script to load test requisitions
-- Monitor query times as data grows
```

---

## Rollback Plan (If Issues)

If deployment fails, use this rollback:

```sql
-- Stop any running transactions
-- Disconnect all users

-- Drop all new tables (if needed)
DROP TABLE IF EXISTS public.cmms_requisition_approvals CASCADE;
DROP TABLE IF EXISTS public.cmms_requisition_items CASCADE;
DROP TABLE IF EXISTS public.cmms_requisitions CASCADE;
DROP TABLE IF EXISTS public.cmms_inventory_items CASCADE;
DROP TABLE IF EXISTS public.cmms_department_staff CASCADE;
DROP TABLE IF EXISTS public.cmms_departments CASCADE;

-- Drop all new views
DROP VIEW IF EXISTS public.v_requisition_summary CASCADE;
DROP VIEW IF EXISTS public.v_department_staff CASCADE;
DROP VIEW IF EXISTS public.v_department_inventory CASCADE;

-- Drop all new functions
DROP FUNCTION IF EXISTS public.submit_requisition CASCADE;
DROP FUNCTION IF EXISTS public.approve_requisition CASCADE;
DROP FUNCTION IF EXISTS public.close_requisition CASCADE;
DROP FUNCTION IF EXISTS public.receive_requisition_items CASCADE;
DROP FUNCTION IF EXISTS public.generate_requisition_number CASCADE;
DROP FUNCTION IF EXISTS public.calculate_requisition_total CASCADE;

-- Restore from backup if data was lost
-- psql -U postgres -h localhost database_name < backup_file.sql
```

---

## Post-Deployment Tasks

- [ ] Train admin staff on department setup
- [ ] Train coordinators on requisition approval
- [ ] Train technicians on submitting requisitions
- [ ] Train storemen on receiving items
- [ ] Set up initial 3-4 departments
- [ ] Create test requisition workflow
- [ ] Monitor system for 2 weeks
- [ ] Document any issues found
- [ ] Get team feedback
- [ ] Plan improvements for v1.1

---

## Support Contacts

**During Deployment:**
- Database Admin: Handle SQL execution
- System Owner: Approve changes

**After Deployment:**
- IT Help Desk: Handle user access issues
- Finance Department: Oversee budget tracking
- Operations: Monitor system usage

---

## Success Criteria

✅ All tables created and seeded
✅ Views return data correctly
✅ Functions execute without errors
✅ RLS policies working (data isolation)
✅ Full requisition workflow tested
✅ Budget calculations accurate
✅ Inventory updates correctly
✅ Role-based access verified
✅ No performance issues
✅ Users can log in and access their data
✅ Team trained and ready to use

---

## Common Issues During Testing

### Issue: "Function does not exist"
**Solution:** Re-run deployment script, functions may not have been created

### Issue: "Permission denied" errors
**Solution:** Check RLS policies - may need to adjust for test users

### Issue: "Requisition number not auto-incrementing"
**Solution:** Check `generate_requisition_number()` function - may need company ID

### Issue: Budget not calculating
**Solution:** Manually run `calculate_requisition_total()` for that requisition

### Issue: Inventory not updating after receive
**Solution:** Check `inventory_item_id` is set in requisition items

---

Generated: February 2026
Version: 1.0
Ready for Production Deployment
