# CMMS Department-Based Inventory & Smart Requisitions Guide

## Overview

This comprehensive guide implements a **department-level inventory and requisition management system** with:

✅ **Department Separation** - Each department manages its own inventory
✅ **Staff Assignment** - Coordinators manage their department's personnel
✅ **Smart Requisitions** - Tracks price, quantity, and delivery time
✅ **Approval Workflow** - Multi-level approvals (Department Head → Finance)
✅ **Budget Control** - Tracks budget usage and alerts for over-spending
✅ **Role-Based Access** - RLS policies ensure data isolation by department

---

## System Architecture

### 1. **Departments**
- Each company can have multiple departments (e.g., Maintenance, Engineering, Operations)
- Department heads manage their team and budget
- Each department has its own inventory and requisitions

### 2. **Department Staff**
- Users are assigned to departments with roles
- Each coordinator can see only their department's staff
- Support for multiple department assignments

### 3. **Inventory Management**
- Per-department inventory tracking
- Automatic low-stock alerts when stock ≤ reorder level
- Links to suppliers with lead times
- Storage location tracking (bin numbers)

### 4. **Smart Requisitions**
- Full requisition lifecycle tracking
- Line items with quantity, unit price, and calculations
- Automatic cost estimation and budget checking
- Multi-level approval workflow
- Expected vs. actual delivery tracking

---

## Database Tables

### Table: `cmms_departments`
Stores department information and budget tracking.

```sql
Columns:
- id: UUID (Primary Key)
- cmms_company_id: UUID (Foreign Key to companies)
- department_name: VARCHAR (e.g., "Maintenance", "Operations")
- department_code: VARCHAR (e.g., "MAINT-001") - Unique per company
- description: TEXT
- department_head_id: UUID (Reference to department manager)
- annual_budget: NUMERIC (Total annual budget)
- budget_used: NUMERIC (Tracks spending)
- status: VARCHAR ('active', 'inactive', 'archived')
```

### Table: `cmms_department_staff`
Links users to departments with role assignments.

```sql
Columns:
- id: UUID (Primary Key)
- department_id: UUID (Foreign Key)
- cmms_user_id: UUID (Foreign Key to users)
- is_primary_department: BOOLEAN (User's main dept)
- assigned_by: UUID (Who assigned them)
- is_active: BOOLEAN
```

### Table: `cmms_inventory_items`
Department-level inventory with stock tracking.

```sql
Columns:
- id: UUID (Primary Key)
- department_id: UUID (Foreign Key)
- item_code: VARCHAR (Unique per department)
- item_name: VARCHAR
- category: VARCHAR (spare_parts, tools, consumables, equipment)
- quantity_in_stock: NUMERIC
- reorder_level: NUMERIC (Auto-alert when stock ≤ this)
- reorder_quantity: NUMERIC (How much to order)
- unit_price: NUMERIC (For stock valuation)
- supplier_name: VARCHAR
- lead_time_days: INTEGER (Days to receive from supplier)
- storage_location: VARCHAR
- bin_number: VARCHAR
```

### Table: `cmms_requisitions`
Main requisition tracking with approval workflow.

```sql
Columns:
- id: UUID (Primary Key)
- requisition_number: VARCHAR (Auto-generated: REQ-2026-00001)
- department_id: UUID (Foreign Key)
- requested_by: UUID (User who created requisition)
- requested_by_name, email, role: VARCHAR (For audit trail)
- purpose: VARCHAR (maintenance, repair, preventive, consumable_replenishment, emergency)
- justification: TEXT (Why is this needed?)
- urgency_level: VARCHAR (urgent, normal, low)
- required_by_date: DATE (When items are needed)
- preferred_delivery_date: DATE (Ideal delivery date)

STATUS FLOW:
- pending_department_head → dept_head_approved/rejected
- → pending_finance → finance_approved/rejected
- → approved → ordered → delivered → closed

BUDGET TRACKING:
- total_estimated_cost: NUMERIC (Auto-calculated from items)
- budget_available: NUMERIC
- budget_sufficient: BOOLEAN (Auto-checked)
- cost_over_threshold: BOOLEAN (Flags if > 20% of budget)

APPROVAL CHAIN:
- dept_head_approved_by, dept_head_approved_at, dept_head_decision_notes
- finance_approved_by, finance_approved_at, finance_decision_notes

ORDERING & DELIVERY:
- po_number: VARCHAR (Purchase Order reference)
- order_placed_date: TIMESTAMPTZ
- expected_delivery_date: TIMESTAMPTZ
- actual_delivery_date: TIMESTAMPTZ
- delivery_notes: TEXT
```

### Table: `cmms_requisition_items`
Line items for each requisition.

```sql
Columns:
- id: UUID (Primary Key)
- requisition_id: UUID (Foreign Key)
- inventory_item_id: UUID (Reference to existing inventory)
- item_name: VARCHAR
- requested_quantity: NUMERIC
- unit_of_measure: VARCHAR (pcs, liters, kg, meters)
- unit_price: NUMERIC
- line_total: NUMERIC (Auto-calculated: quantity × price)
- preferred_supplier: VARCHAR
- lead_time_days: INTEGER
- expected_delivery_date: DATE
- status: VARCHAR (pending, ordered, partial_received, received, cancelled)
- quantity_received: NUMERIC (Actual qty received)
```

### Table: `cmms_requisition_approvals`
Audit trail for all approval decisions.

```sql
Columns:
- id: UUID (Primary Key)
- requisition_id: UUID (Foreign Key)
- approval_level: VARCHAR (department_head, finance, admin)
- approved_by: UUID (User who approved)
- decision: VARCHAR (approved, rejected, pending_revision)
- decision_comment: TEXT
- decided_at: TIMESTAMPTZ
```

---

## Key Functions

### 1. **Submit Requisition**
```sql
FUNCTION: submit_requisition(
  p_department_id UUID,
  p_purpose VARCHAR,
  p_justification TEXT,
  p_urgency_level VARCHAR DEFAULT 'normal',
  p_required_by_date DATE DEFAULT NULL,
  p_items JSONB DEFAULT '[]'
) RETURNS UUID
```

**What it does:**
- Creates new requisition with auto-generated number
- Validates user is in department
- Checks department budget
- Adds line items from JSONB array
- Auto-calculates total cost
- Checks if cost exceeds 20% of budget (flags for review)
- Returns requisition ID

**Example usage:**
```javascript
// JavaScript/Frontend
const items = [
  {
    item_id: "inv-001",
    item_name: "Hydraulic Pump",
    item_code: "PUMP-001",
    quantity: 2,
    unit_price: 450.00,
    lead_time_days: 5
  },
  {
    item_id: "inv-002",
    item_name: "Seals Kit",
    item_code: "SEAL-KIT",
    quantity: 1,
    unit_price: 75.50,
    lead_time_days: 2
  }
];

const reqId = await submitRequisition(
  departmentId,
  "emergency",
  "Pump failure - urgent replacement needed",
  "urgent",
  new Date('2026-02-28'),
  JSON.stringify(items)
);
```

### 2. **Approve Requisition**
```sql
FUNCTION: approve_requisition(
  p_requisition_id UUID,
  p_decision VARCHAR,
  p_comment TEXT DEFAULT NULL
) RETURNS VOID
```

**What it does:**
- Validates current status
- Records approval with timestamp
- Moves to next approval stage
- Adds decision comment to audit trail

**Status progression:**
- `approved` → Moves to Finance if needed, or to `approved` state
- `rejected` → Sets to `rejected` state (stops process)

### 3. **Calculate Requisition Total**
```sql
FUNCTION: calculate_requisition_total(p_requisition_id UUID) 
RETURNS NUMERIC
```

**What it does:**
- Sums all line items (quantity × unit_price)
- Returns total estimated cost

### 4. **Receive Requisition Items**
```sql
FUNCTION: receive_requisition_items(
  p_requisition_id UUID,
  p_delivery_notes TEXT DEFAULT NULL
) RETURNS VOID
```

**What it does:**
- Updates requisition status to `delivered`
- Updates inventory: adds received quantities to stock
- Updates inventory item's last_stock_check timestamp
- Sets received date and receiver info
- Updates line item status to `received`

---

## Views for Easy Access

### 1. **v_department_inventory**
Shows all inventory items with stock status.

```sql
SELECT 
  id, item_code, item_name, quantity_in_stock, 
  generic, stock_status, stock_value, reorder_level, unit_price
FROM v_department_inventory
WHERE department_name = 'Maintenance'
```

**Status values:**
- `REORDER_NEEDED`: Stock ≤ reorder level
- `OUT_OF_STOCK`: Stock = 0
- `IN_STOCK`: Normal stock level

### 2. **v_department_staff**
Shows all staff in a department with roles.

```sql
SELECT 
  email, full_name, job_title, role_name, is_primary_department
FROM v_department_staff
WHERE department_name = 'Maintenance'
AND is_active = TRUE
```

### 3. **v_requisition_summary**
Shows all requisitions with status and cost tracking.

```sql
SELECT 
  requisition_number, department_name, status_display, 
  total_estimated_cost, budget_sufficient, urgency_level,
  required_by_date, line_items_count
FROM v_requisition_summary
WHERE status NOT IN ('closed', 'rejected')
ORDER BY urgency_level DESC, required_by_date ASC
```

---

## Role-Based Access Control (RBAC)

### Permissions Setup

**Admin:**
- ✅ Create departments
- ✅ Assign staff to departments
- ✅ View all requisitions
- ✅ Approve requisitions at any level
- ✅ Manage inventory

**Department Coordinator (Level 5):**
- ✅ View department staff
- ✅ Submit requisitions
- ✅ Approve requisitions (as department head)
- ✅ View department inventory
- ✅ Cannot edit inventory (only view)

**Technician (Level 2):**
- ✅ Submit requisitions
- ✅ View department inventory
- ✅ Cannot approve requisitions

**Storeman (Level 2):**
- ✅ View inventory
- ✅ Edit inventory (add/remove items)
- ✅ Receive delivered items
- ✅ Cannot submit requisitions

**Finance Officer (Level 4):**
- ✅ Approve requisitions (finance level)
- ✅ View all requisitions and costs
- ✅ Budget tracking

---

## Row-Level Security (RLS)

All department, inventory, and requisition tables have RLS enabled:

### Policy: `departments_select_policy`
Users can only see departments in their company:
```sql
cmms_company_id IN (
  SELECT cmms_company_id FROM cmms_users WHERE id = auth.uid()
)
```

### Policy: `inventory_select_policy`
Users can see inventory from departments in their company.

### Policy: `inventory_insert_update_policy`
Only users with `can_edit_inventory` permission or `storeman` role can edit.

### Policy: `requisitions_select_policy`
Users can only see requisitions from their company.

---

## Implementation Steps

### Step 1: Deploy Database Schema
```bash
# In Supabase SQL Editor:
1. Copy entire content of CMMS_DEPARTMENT_INVENTORY_REQUISITIONS.sql
2. Paste into SQL Editor
3. Click "Run"
4. Verify: All tables created successfully
```

### Step 2: Set Up Departments
```sql
-- Create departments in each company
INSERT INTO cmms_departments (
  cmms_company_id, 
  department_name, 
  department_code, 
  annual_budget,
  created_by
) VALUES 
  ('company-uuid', 'Maintenance', 'MAINT-001', 50000, 'user-uuid'),
  ('company-uuid', 'Operations', 'OPS-001', 30000, 'user-uuid'),
  ('company-uuid', 'Engineering', 'ENG-001', 40000, 'user-uuid');
```

### Step 3: Assign Staff to Departments
```sql
-- Assign users to departments
INSERT INTO cmms_department_staff (
  department_id,
  cmms_user_id,
  cmms_company_id,
  is_primary_department,
  assigned_by
) VALUES
  ('dept-uuid', 'user-uuid', 'company-uuid', TRUE, 'admin-user-uuid');
```

### Step 4: Set Up Inventory Items
```sql
-- Add inventory items to departments
INSERT INTO cmms_inventory_items (
  department_id,
  cmms_company_id,
  item_code,
  item_name,
  category,
  unit_price,
  reorder_level,
  reorder_quantity,
  supplier_name,
  lead_time_days
) VALUES 
  ('dept-uuid', 'company-uuid', 'P001', 'Hydraulic Pump', 'spare_parts', 
   450.00, 5, 10, 'Supplier Inc', 5);
```

### Step 5: Update Frontend Components
Use the provided JavaScript functions in your frontend:
- `submitRequisition()`
- `approveRequisition()`
- `receiveRequisitionItems()`
- `getRequisitionSummary()`

---

## Usage Examples

### Example 1: Technician Submits Requisition
```javascript
// Technician in Maintenance dept needs 2 hydraulic pumps
const requisition = await submitRequisition(
  maintenanceDeptId,
  "maintenance",
  "Pump replacement for production line #2 - failed pressure test",
  "urgent",
  new Date('2026-02-27'), // Needed by
  JSON.stringify([
    {
      inventory_item_id: "pump-001",
      item_code: "P001",
      item_name: "Hydraulic Pump",
      requested_quantity: 2,
      unit_of_measure: "pcs",
      unit_price: 450.00,
      lead_time_days: 5
    }
  ])
);

// Result: Requisition created with ID, goes to dept_head for approval
```

### Example 2: Department Head Approves
```javascript
// Department Coordinator (head) approves requisition
await approveRequisition(
  requisitionId,
  "approved",
  "Approved. Critical equipment. Proceed with order."
);

// Result: Moves to Finance for budget approval
```

### Example 3: Finance Approves & Orders
```javascript
// Finance officer approves
await approveRequisition(
  requisitionId,
  "approved",
  "Budget approved. Cost 900.00 within dept allocation."
);

// Then mark as ordered
UPDATE cmms_requisitions
SET status = 'ordered', order_placed_date = NOW(), po_number = 'PO-2026-001'
WHERE id = requisitionId;
```

### Example 4: Receive Items
```javascript
// Storeman receives items
await receiveRequisitionItems(
  requisitionId,
  "Received 2x Hydraulic Pump. All items in good condition. Stored in Bin A-15."
);

// Result: 
// - Inventory stock updated (+2 pumps)
// - Requisition marked as delivered
// - Line items marked as received
```

---

## Smart Features Explained

### 1. **Auto-Numbering**
- Format: `REQ-YYYY-#####`
- Example: `REQ-2026-00001`
- Incremental per company per year
- Prevents duplicate numbers

### 2. **Budget Checking**
```javascript
// Automatic checks on submission:
- if (totalCost > budgetAvailable) budgetSufficient = FALSE
- if (totalCost > budgetAnnual * 0.2) costOverThreshold = TRUE
// Flags for admin approval
```

### 3. **Stock Status Alerts**
```sql
-- Automatic status in inventory view:
CASE 
  WHEN quantity_in_stock <= reorder_level THEN 'REORDER_NEEDED'
  WHEN quantity_in_stock = 0 THEN 'OUT_OF_STOCK'
  ELSE 'IN_STOCK'
END
```

### 4. **Expected Delivery Calculation**
```javascript
// Auto-calculated from lead times:
expected_delivery_date = TODAY + lead_time_days
// Helps track delays
```

### 5. **Department Budget Tracking**
- Annual budget set per department
- Budget used tracked on each requisition
- Available budget = Annual - Used
- Alerts when approaching limits

---

## Troubleshooting

### Issue: "User is not part of this department"
**Solution:** Add user to department via `cmms_department_staff` table

### Issue: "Requisition cannot be approved in current status"
**Solution:** Check requisition status - may already be approved or rejected

### Issue: Inventory stock not updating after delivery
**Solution:** Ensure `inventory_item_id` is set in requisition items

### Issue: Budget calculation wrong
**Solution:** Run `calculate_requisition_total()` to recalculate

---

## Best Practices

1. **Always set required_by_date** - Helps prioritize requisitions
2. **Add detailed justification** - Helps approvers make faster decisions
3. **Use correct urgency_level** - Impacts approval speed (urgent can by-pass some checks)
4. **Link to work orders** - Connect requisitions to specific maintenance jobs
5. **Review inventory regularly** - Update stock after physical counts
6. **Set realistic lead times** - Update supplier lead_time_days regularly

---

## Next Steps

1. ✅ Run SQL deployment script
2. ✅ Create departments for your company
3. ✅ Assign staff to departments
4. ✅ Set up initial inventory items
5. ✅ Configure roles and permissions
6. ✅ Test requisition workflow with sample data
7. ✅ Train staff on new system
8. ✅ Go live with production data

---

## Support

For issues or questions:
- Check the Troubleshooting section above
- Review the SQL schema documentation
- Check RLS policies if data is missing
- Verify user roles and permissions
