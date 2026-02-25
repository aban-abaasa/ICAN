# CMMS Department Inventory & Requisitions - Quick Reference Guide

## System Overview Diagram

```
COMPANY
├── DEPARTMENT 1 (Maintenance)
│   ├── STAFF (Coordinator, Technician, Storeman)
│   ├── INVENTORY ITEMS
│   │   ├── Hydraulic Pumps (Stock: 5, Reorder at: 3)
│   │   ├── Seals Kits (Stock: 0 - URGENT)
│   │   └── Belts (Stock: 10)
│   └── REQUISITIONS
│       ├── REQ-2026-00001 (Pending - Department Head)
│       ├── REQ-2026-00002 (Pending - Finance)
│       └── REQ-2026-00003 (Approved - Ready to Order)
│
├── DEPARTMENT 2 (Operations)
│   ├── STAFF
│   ├── INVENTORY ITEMS
│   └── REQUISITIONS
│
└── DEPARTMENT 3 (Engineering)
    ├── STAFF
    ├── INVENTORY ITEMS
    └── REQUISITIONS
```

---

## Key Workflows

### Workflow 1: Submit Requisition (Technician → Department Head → Finance)

```
1. TECHNICIAN submits requisition
   ├─ Select: Department
   ├─ Select: Purpose (maintenance/repair/preventive/emergency)
   ├─ Enter: Justified reason
   ├─ Select: Urgency level (low/normal/urgent)
   ├─ Add: Line items with qty & unit price
   └─ Click: Submit

2. SYSTEM automatically:
   ├─ Generates: Requisition number (REQ-YYYY-#####)
   ├─ Calculates: Total cost
   ├─ Checks: Budget available
   ├─ Flags: If cost > 20% of dept budget
   └─ Status: pending_department_head

3. DEPARTMENT HEAD receives notification
   ├─ Reviews: Justification, items, cost
   ├─ Decision: Approve or Reject
   └─ Status: Changes to pending_finance (if approved)

4. FINANCE OFFICER reviews (if required)
   ├─ Checks: Budget allocation
   ├─ Reviews: Supplier & lead times
   ├─ Decision: Approve or Reject
   └─ Status: Changes to approved (if approved)

5. Once APPROVED:
   ├─ Admin places order with supplier
   ├─ Updates: PO number, expected delivery
   ├─ Status: ordered

6. Items RECEIVED:
   ├─ Storeman records delivery
   ├─ SYSTEM updates: Inventory stock
   ├─ SYSTEM updates: Budget used
   └─ Status: delivered

7. REQUISITION CLOSED after final checks
```

### Workflow 2: Check Inventory Status (Coordinator → Inventory View)

```
1. Coordinator logs in
2. Navigates to: Department → Inventory
3. VIEW shows automatically:
   ├─ IN_STOCK: Green (normal stock levels)
   ├─ REORDER_NEEDED: Yellow (stock ≤ reorder level)
   └─ OUT_OF_STOCK: Red (stock = 0)
4. Creates new requisition for items to reorder
```

### Workflow 3: Assign Staff to Department

```
1. Admin navigates to: Department → Staff Management
2. Selects: Add New Staff
3. Searches: Existing CMMS users
4. Assigns:
   ├─ User to Department
   ├─ Primary Department (main assignment)
   └─ Role/Permissions
5. Staff can now:
   ├─ See department inventory
   ├─ Submit requisitions
   └─ Access department data
```

---

## Role-Based Actions Matrix

| Role | View Inv | Edit Inv | Submit Req | Approve Req | Finance | Receive |
|------|----------|----------|-----------|-------------|---------|---------|
| Admin | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Coordinator | ✅ | ❌ | ✅ | ✅ Dept | ❌ | ❌ |
| Technician | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Storeman | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |
| Finance Officer | ✅ | ❌ | ❌ | ✅ Finance | ✅ | ❌ |
| Supervisor | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |

---

## Database Tables Reference

### Quick Lookup: What Each Table Stores

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| `cmms_departments` | Department info & budget | name, code, budget, head |
| `cmms_department_staff` | Who works in which dept | user_id, dept_id, role |
| `cmms_inventory_items` | Stock tracking per dept | item_code, qty, reorder_level |
| `cmms_requisitions` | Requisition master record | status, total_cost, approvals |
| `cmms_requisition_items` | Line items per requisition | qty, unit_price, line_total |
| `cmms_requisition_approvals` | Approval audit trail | decision, comment, timestamp |

---

## Important Fields to Understand

### Requisition Status Flow
```
pending_department_head
    ↓ (Approved)
pending_finance
    ↓ (Approved)
approved ← (Ready to order)
    ↓
ordered ← (PO placed)
    ↓
delivered ← (Items received)
    ↓
closed ← (Final. No changes possible)

Note: At any step, can change to "rejected" (ends process)
```

### Budget Checking Logic
```javascript
// When requisition submitted:
IF (total_cost > budget_available) {
  budget_sufficient = FALSE  // Flag warning
}

IF (total_cost > annual_budget * 0.20) {
  cost_over_threshold = TRUE  // Requires extra review
}

// Example:
// Annual budget: $50,000
// Already used: $30,000
// Available: $20,000
// New requisition: $2,000
// Result: Sufficient (under available), but over 20% threshold
```

### Stock Status Alerts
```javascript
CASE
  WHEN qty_in_stock > reorder_level
    THEN "IN_STOCK"
  WHEN qty_in_stock <= reorder_level
    THEN "REORDER_NEEDED" ← Create requisition!
  WHEN qty_in_stock = 0
    THEN "OUT_OF_STOCK" ← URGENT!
END
```

---

## Common SQL Queries for Reports

### Active Requisitions by Department
```sql
SELECT 
  requisition_number, 
  department_name, 
  requested_by_name,
  status_display,
  total_estimated_cost,
  required_by_date
FROM v_requisition_summary
WHERE status NOT IN ('closed', 'rejected')
ORDER BY urgency_level DESC, required_by_date ASC;
```

### Department Budget Status
```sql
SELECT 
  department_name,
  annual_budget,
  budget_used,
  (annual_budget - budget_used) AS available,
  ROUND(((budget_used / annual_budget) * 100)::numeric, 2) AS percent_used
FROM cmms_departments
WHERE status = 'active'
ORDER BY percent_used DESC;
```

### Inventory Reorder Alert
```sql
SELECT 
  item_name,
  quantity_in_stock,
  reorder_level,
  reorder_quantity,
  supplier_name,
  lead_time_days
FROM v_department_inventory
WHERE stock_status IN ('REORDER_NEEDED', 'OUT_OF_STOCK')
ORDER BY quantity_in_stock ASC;
```

### Pending Approvals
```sql
SELECT 
  requisition_number,
  requested_by_name,
  department_name,
  total_estimated_cost,
  CASE 
    WHEN status = 'pending_department_head' THEN 'Waiting for: Department Head'
    WHEN status = 'pending_finance' THEN 'Waiting for: Finance'
  END as waiting_for
FROM v_requisition_summary
WHERE status LIKE 'pending_%';
```

### Stock Value by Department
```sql
SELECT 
  department_name,
  COUNT(*) as item_count,
  SUM(quantity_in_stock * unit_price) as total_value,
  AVG(unit_price) as avg_item_price
FROM v_department_inventory
GROUP BY department_name
ORDER BY total_value DESC;
```

---

## Frontend Components Checklist

### Essential Components to Build

- [ ] **Department Selector** - Dropdown to pick dept
- [ ] **Inventory Dashboard** - Shows stock status summary
- [ ] **Reorder Alerts** - Red/yellow warnings for low stock
- [ ] **Requisition Form** - Submit new requisition
- [ ] **Requisition List** - View pending/approved/ordered
- [ ] **Approval Workflow** - Approve/reject pending
- [ ] **Receive Items** - Record delivery
- [ ] **Budget Overview** - Show spending vs budget
- [ ] **Department Staff** - Manage team members
- [ ] **Reports** - Charts and analytics

---

## Integration Checklist

### Before Going Live

- [ ] All tables created in Supabase
- [ ] RLS policies enabled and tested
- [ ] Functions created and tested
- [ ] Views created and queryable
- [ ] Frontend components built
- [ ] Approval workflow tested end-to-end
- [ ] Budget calculations verified
- [ ] Permissions tested for each role
- [ ] Test data created
- [ ] Documentation reviewed by team
- [ ] User training completed
- [ ] Monitor for issues week 1

---

## Quick Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| "User not in department" | User not assigned | Go to Admin → Assign to Dept |
| Inventory not updating | Items not received properly | Check status = 'received' |
| Budget wrong | Hasn't recalculated | Re-submit to trigger calc |
| Can't submit requisition | Missing required fields | Check purpose, justification, items |
| Approvals not showing | RLS blocking access | Check user's role permissions |
| Slow queries | Missing indexes | Indexes created in schema |

---

## Key Contacts & Support

- **Database Issues**: Check Supabase SQL Editor errors
- **Function Errors**: Review error message in browser console
- **Permission Issues**: Verify user roles in `cmms_user_roles`
- **Budget Questions**: Check `cmms_departments.budget_used`
- **Approval Stuck**: Look for entry in `cmms_requisition_approvals` table

---

## Next Steps

1. ✅ Deploy SQL schema (CMMS_DEPARTMENT_INVENTORY_REQUISITIONS.sql)
2. ✅ Create initial departments
3. ✅ Assign staff to departments
4. ✅ Add initial inventory items
5. ✅ Optionally run sample requisition
6. ✅ Build frontend components
7. ✅ Test each workflow
8. ✅ Deploy to production

---

## Features at a Glance

✨ **Department Separation** - Each dept isolated
✨ **Smart Inventory** - Auto alerts on low stock
✨ **Multi-Level Approvals** - Dept head → Finance
✨ **Budget Control** - Track spending per dept
✨ **Audit Trail** - All approvals recorded
✨ **Role-Based** - Permissions by role
✨ **Mobile Friendly** - Works on all devices
✨ **Real-Time Updates** - See changes immediately

---

Generated: February 2026
Version: 1.0
