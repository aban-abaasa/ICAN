# CMMS Supabase Service API Reference

## 🔗 Import

```javascript
import cmmsService from '../lib/supabase/services/cmmsService';
```

---

## 📋 API Methods

### Company Profile Operations

#### `createCompanyProfile(companyData)`

Creates a new company profile in the database.

**Parameters:**
```javascript
{
  companyName: string,           // Required: "ACME Manufacturing"
  companyRegistration: string,   // Optional: "UG-REG-2024-12345"
  location: string,              // Optional: "Kampala, Uganda"
  industry: string,              // Optional: "Manufacturing"
  phone: string,                 // Optional: "+256-701-234-567"
  email: string,                 // Optional: "info@acme.ug"
  website: string                // Optional: "www.acme.ug"
}
```

**Returns:**
```javascript
{
  data: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    company_name: "ACME Manufacturing",
    company_registration: "UG-REG-2024-12345",
    location: "Kampala, Uganda",
    industry: "Manufacturing",
    phone: "+256-701-234-567",
    email: "info@acme.ug",
    is_active: true,
    created_by: "user-uuid",
    created_at: "2026-01-08T10:30:00.000Z",
    updated_at: "2026-01-08T10:30:00.000Z"
  },
  error: null | Error
}
```

**Example:**
```javascript
const { data: company, error } = await cmmsService.createCompanyProfile({
  companyName: 'ACME Manufacturing Ltd',
  companyRegistration: 'UG-REG-2024-12345',
  location: 'Kampala, Uganda',
  industry: 'Manufacturing',
  phone: '+256-701-234-567',
  email: 'info@acmemanufacturing.ug'
});

if (error) {
  console.error('Failed to create company:', error);
} else {
  console.log('Company created with ID:', company.id);
}
```

---

#### `getCompanyProfile(companyId)`

Retrieves a single company profile by ID.

**Parameters:**
```javascript
companyId: string  // UUID of the company
```

**Returns:**
```javascript
{
  data: { /* Company object */ },
  error: null | Error
}
```

**Example:**
```javascript
const { data: company, error } = await cmmsService.getCompanyProfile(
  '550e8400-e29b-41d4-a716-446655440000'
);
```

---

#### `updateCompanyProfile(companyId, updates)`

Updates an existing company profile.

**Parameters:**
```javascript
companyId: string  // UUID of the company
updates: {
  companyName: string,
  location: string,
  phone: string,
  email: string,
  industry: string,
  website: string
}
```

**Returns:**
```javascript
{
  data: { /* Updated company object */ },
  error: null | Error
}
```

**Example:**
```javascript
const { data, error } = await cmmsService.updateCompanyProfile(
  '550e8400-e29b-41d4-a716-446655440000',
  {
    companyName: 'ACME Manufacturing - Kampala Branch',
    phone: '+256-702-999-888'
  }
);
```

---

### User Management

#### `createAdminUser(companyId, userData)`

Creates the first admin user for a company.

**Parameters:**
```javascript
companyId: string  // UUID of the company
userData: {
  email: string,         // Required: "admin@acme.ug"
  name: string,          // Required: "John Administrator"
  phone: string          // Optional: "+256-701-111-111"
}
```

**Returns:**
```javascript
{
  data: {
    id: "550e8400-e29b-41d4-a716-446655440001",
    company_id: "550e8400-e29b-41d4-a716-446655440000",
    email: "admin@acme.ug",
    user_name: "John Administrator",
    phone: "+256-701-111-111",
    is_active: true,
    created_at: "2026-01-08T10:30:00.000Z"
  },
  error: null | Error
}
```

**Example:**
```javascript
const { data: adminUser, error } = await cmmsService.createAdminUser(
  '550e8400-e29b-41d4-a716-446655440000',
  {
    email: 'admin@acme.ug',
    name: 'John Administrator',
    phone: '+256-701-111-111'
  }
);

// Admin role is automatically assigned (role_id = 1)
```

---

#### `getCompanyUsers(companyId)`

Retrieves all users for a company.

**Parameters:**
```javascript
companyId: string  // UUID of the company
```

**Returns:**
```javascript
{
  data: [
    {
      id: "user-uuid-1",
      company_id: "company-uuid",
      email: "admin@acme.ug",
      user_name: "John Administrator",
      phone: "+256-701-111-111",
      is_active: true,
      created_at: "2026-01-08T10:30:00.000Z"
    },
    // ... more users
  ],
  error: null | Error
}
```

**Example:**
```javascript
const { data: users, error } = await cmmsService.getCompanyUsers(
  '550e8400-e29b-41d4-a716-446655440000'
);

if (!error) {
  users.forEach(user => {
    console.log(`${user.user_name} (${user.email})`);
  });
}
```

---

### Role Management

#### `assignUserRole(companyId, userId, roleId, departmentId)`

Assigns a role to a user within a company.

**Parameters:**
```javascript
companyId: string,      // UUID of the company
userId: string,         // UUID of the user
roleId: number,         // Role ID (see table below)
departmentId: string    // Optional: UUID of department
```

**Role IDs:**
| ID | Role | Permission Level |
|----|------|-----------------|
| 1 | Admin | 7 |
| 2 | Department_Coordinator | 5 |
| 3 | Supervisor | 4 |
| 4 | Finance_Officer | 4 |
| 5 | Technician | 2 |
| 6 | Storeman | 2 |
| 7 | Service_Provider | 1 |
| 8 | Guest | 0 |

**Returns:**
```javascript
{
  data: {
    id: "role-assignment-uuid",
    company_id: "company-uuid",
    user_id: "user-uuid",
    role_id: 2,
    assigned_by: "admin-user-uuid",
    assigned_at: "2026-01-08T10:30:00.000Z",
    is_active: true
  },
  error: null | Error
}
```

**Example:**
```javascript
// Assign Coordinator role to a user
const { data, error } = await cmmsService.assignUserRole(
  '550e8400-e29b-41d4-a716-446655440000',  // companyId
  '550e8400-e29b-41d4-a716-446655440003',  // userId
  2,                                        // roleId (Coordinator)
  '550e8400-e29b-41d4-a716-446655440100'   // departmentId
);
```

---

#### `getUserRoles(companyId)`

Retrieves all role assignments for a company with user and role details.

**Parameters:**
```javascript
companyId: string  // UUID of the company
```

**Returns:**
```javascript
{
  data: [
    {
      id: "assignment-uuid",
      company_id: "company-uuid",
      user_id: "user-uuid",
      role_id: 1,
      assigned_by: "admin-uuid",
      assigned_at: "2026-01-08T10:30:00.000Z",
      is_active: true,
      users: {
        id: "user-uuid",
        user_name: "John Administrator",
        email: "admin@acme.ug"
      },
      roles: {
        role_name: "Admin",
        permission_level: 7
      }
    },
    // ... more role assignments
  ],
  error: null | Error
}
```

**Example:**
```javascript
const { data: roleAssignments, error } = await cmmsService.getUserRoles(
  '550e8400-e29b-41d4-a716-446655440000'
);

if (!error) {
  roleAssignments.forEach(assignment => {
    console.log(
      `${assignment.users.user_name} has role: ${assignment.roles.role_name}`
    );
  });
}
```

---

### Department Operations

#### `createDepartment(companyId, deptData)`

Creates a new department in a company.

**Parameters:**
```javascript
companyId: string  // UUID of the company
deptData: {
  departmentName: string,    // Required: "Maintenance & Operations"
  description: string,       // Optional: "Equipment maintenance, repairs, and technical support"
  headId: string,           // Optional: UUID of department head (user)
  budget: number            // Optional: Budget amount in currency units
}
```

**Returns:**
```javascript
{
  data: {
    id: "dept-uuid",
    company_id: "company-uuid",
    department_name: "Maintenance & Operations",
    description: "Equipment maintenance...",
    head_id: "user-uuid",
    budget: 150000000,
    budget_year: 2026,
    is_active: true,
    created_at: "2026-01-08T10:30:00.000Z"
  },
  error: null | Error
}
```

**Example:**
```javascript
const { data: dept, error } = await cmmsService.createDepartment(
  '550e8400-e29b-41d4-a716-446655440000',
  {
    departmentName: 'Maintenance & Operations',
    description: 'Equipment maintenance, repairs, and technical support',
    headId: '550e8400-e29b-41d4-a716-446655440011',
    budget: 150000000
  }
);
```

---

#### `getCompanyDepartments(companyId)`

Retrieves all departments for a company.

**Parameters:**
```javascript
companyId: string  // UUID of the company
```

**Returns:**
```javascript
{
  data: [
    {
      id: "dept-uuid-1",
      company_id: "company-uuid",
      department_name: "Production",
      budget: 500000000,
      budget_year: 2026,
      is_active: true
    },
    // ... more departments
  ],
  error: null | Error
}
```

**Example:**
```javascript
const { data: departments, error } = await cmmsService.getCompanyDepartments(
  '550e8400-e29b-41d4-a716-446655440000'
);

const totalBudget = departments.reduce((sum, dept) => sum + dept.budget, 0);
console.log(`Total company budget: ${totalBudget}`);
```

---

### Inventory Operations

#### `getCompanyInventory(companyId)`

Retrieves all inventory items for a company.

**Parameters:**
```javascript
companyId: string  // UUID of the company
```

**Returns:**
```javascript
{
  data: [
    {
      id: "item-uuid",
      company_id: "company-uuid",
      item_name: "SKF Deep Groove Ball Bearing 6205",
      item_code: "BRG-SKF-6205-001",
      category: "MECHANICAL",
      unit_of_measure: "Piece",
      quantity: 15,
      min_stock: 5,
      max_stock: 50,
      unit_cost: 45000,
      is_active: true
    },
    // ... more items
  ],
  error: null | Error
}
```

**Example:**
```javascript
const { data: items, error } = await cmmsService.getCompanyInventory(
  '550e8400-e29b-41d4-a716-446655440000'
);

// Find low stock items
const lowStockItems = items.filter(item => item.quantity <= item.min_stock);
console.log(`${lowStockItems.length} items are low on stock`);
```

---

#### `getInventoryTransactions(companyId, limit)`

Retrieves inventory transactions with item details.

**Parameters:**
```javascript
companyId: string,  // UUID of the company
limit: number       // Default: 50 (max records to fetch)
```

**Returns:**
```javascript
{
  data: [
    {
      id: "trans-uuid",
      company_id: "company-uuid",
      inventory_item_id: "item-uuid",
      transaction_type: "IN",  // IN, OUT, ADJUSTMENT, LOSS, RETURN
      quantity: 20,
      notes: "Stock received from SKF Uganda",
      reference_id: "PO-2026-0015",
      transaction_date: "2026-01-05T10:30:00.000Z",
      is_verified: true,
      inventory_item: {
        item_name: "SKF Deep Groove Ball Bearing",
        item_code: "BRG-SKF-6205-001"
      }
    },
    // ... more transactions
  ],
  error: null | Error
}
```

**Example:**
```javascript
const { data: transactions, error } = await cmmsService.getInventoryTransactions(
  '550e8400-e29b-41d4-a716-446655440000',
  100  // Get last 100 transactions
);

// Calculate total received today
const today = new Date().toISOString().split('T')[0];
const received = transactions
  .filter(t => t.transaction_type === 'IN' && t.transaction_date.startsWith(today))
  .reduce((sum, t) => sum + t.quantity, 0);

console.log(`Received ${received} items today`);
```

---

### Equipment Operations

#### `getCompanyEquipment(companyId)`

Retrieves all equipment for a company.

**Parameters:**
```javascript
companyId: string  // UUID of the company
```

**Returns:**
```javascript
{
  data: [
    {
      id: "equip-uuid",
      company_id: "company-uuid",
      equipment_code: "CNC-MAIN-001",
      equipment_name: "CNC Machining Center",
      equipment_type: "Precision Machining",
      manufacturer: "FANUC",
      model_number: "FANUC 0i-MF",
      serial_number: "FANUC-2023-001456",
      purchase_date: "2023-06-15",
      purchase_cost: 45000000,
      warranty_expiry: "2025-06-15",
      critical: true,
      is_operational: true
    },
    // ... more equipment
  ],
  error: null | Error
}
```

**Example:**
```javascript
const { data: equipment, error } = await cmmsService.getCompanyEquipment(
  '550e8400-e29b-41d4-a716-446655440000'
);

// Find critical equipment that needs maintenance
const criticalEquipment = equipment.filter(e => e.critical && e.is_operational);
console.log(`${criticalEquipment.length} critical equipment items require maintenance`);
```

---

### Maintenance Planning

#### `getMaintenancePlans(companyId)`

Retrieves maintenance plans with equipment details.

**Parameters:**
```javascript
companyId: string  // UUID of the company
```

**Returns:**
```javascript
{
  data: [
    {
      id: "plan-uuid",
      company_id: "company-uuid",
      equipment_id: "equip-uuid",
      plan_name: "CNC Machine Preventive Maintenance",
      description: "Monthly inspection, lubrication, and calibration",
      maintenance_type: "Preventive",  // Preventive, Corrective, Predictive, Emergency
      frequency: "Monthly",
      last_performed: "2026-01-05",
      next_due_date: "2026-02-05",
      estimated_duration_hours: 4,
      estimated_cost: 150000,
      is_active: true,
      equipment: {
        equipment_name: "CNC Machining Center",
        equipment_code: "CNC-MAIN-001"
      }
    },
    // ... more plans
  ],
  error: null | Error
}
```

**Example:**
```javascript
const { data: plans, error } = await cmmsService.getMaintenancePlans(
  '550e8400-e29b-41d4-a716-446655440000'
);

// Find overdue maintenance
const today = new Date();
const overdue = plans.filter(p => 
  new Date(p.next_due_date) < today && p.is_active
);

console.log(`⚠️  ${overdue.length} maintenance plans are overdue!`);
overdue.forEach(p => {
  console.log(`  - ${p.equipment.equipment_name}: Due ${p.next_due_date}`);
});
```

---

### Budget Tracking

#### `getCompanyBudget(companyId)`

Retrieves budget tracking data for current year.

**Parameters:**
```javascript
companyId: string  // UUID of the company
```

**Returns:**
```javascript
{
  data: [
    {
      id: "budget-uuid",
      company_id: "company-uuid",
      department_id: "dept-uuid",
      budget_year: 2026,
      allocated_budget: 150000000,
      spent_amount: 12500000,
      committed_amount: 35000000,
      created_at: "2026-01-08T10:30:00.000Z",
      departments: {
        department_name: "Maintenance & Operations"
      }
    },
    // ... more budget records
  ],
  error: null | Error
}
```

**Example:**
```javascript
const { data: budgets, error } = await cmmsService.getCompanyBudget(
  '550e8400-e29b-41d4-a716-446655440000'
);

// Calculate budget utilization
budgets.forEach(b => {
  const utilized = b.spent_amount + b.committed_amount;
  const percentage = (utilized / b.allocated_budget) * 100;
  console.log(
    `${b.departments.department_name}: ${percentage.toFixed(1)}% utilized`
  );
});
```

---

### Work Orders

#### `getCompanyWorkOrders(companyId)`

Retrieves all work orders with equipment information.

**Parameters:**
```javascript
companyId: string  // UUID of the company
```

**Returns:**
```javascript
{
  data: [
    {
      id: "wo-uuid",
      company_id: "company-uuid",
      equipment_id: "equip-uuid",
      work_order_code: "WO-2026-0042",
      description: "Spindle bearing replacement",
      priority: "MEDIUM",  // LOW, MEDIUM, HIGH, CRITICAL
      status: "OPEN",      // OPEN, IN_PROGRESS, ON_HOLD, COMPLETED, CANCELLED
      estimated_hours: 4,
      actual_hours: null,
      estimated_cost: 250000,
      actual_cost: null,
      equipment: {
        equipment_name: "CNC Machining Center",
        equipment_code: "CNC-MAIN-001"
      }
    },
    // ... more work orders
  ],
  error: null | Error
}
```

**Example:**
```javascript
const { data: workOrders, error } = await cmmsService.getCompanyWorkOrders(
  '550e8400-e29b-41d4-a716-446655440000'
);

// Find critical work orders
const critical = workOrders.filter(wo => 
  wo.priority === 'CRITICAL' && wo.status === 'OPEN'
);

console.log(`🚨 ${critical.length} critical work orders need attention!`);
```

---

## 🔄 Error Handling

All methods return an object with `{ data, error }`:

```javascript
const { data, error } = await cmmsService.getCompanyUsers(companyId);

if (error) {
  // Handle error
  console.error('Failed to fetch users:', error.message);
  // Show user-friendly error message
} else {
  // Use data
  console.log(`Found ${data.length} users`);
  data.forEach(user => console.log(user.user_name));
}
```

---

## 🎯 Complete Workflow Example

```javascript
import cmmsService from '../lib/supabase/services/cmmsService';

async function setupNewCompany() {
  try {
    // Step 1: Create company profile
    const { data: company, error: companyError } = 
      await cmmsService.createCompanyProfile({
        companyName: 'ACME Manufacturing Ltd',
        companyRegistration: 'UG-REG-2024-12345',
        location: 'Kampala, Uganda',
        industry: 'Manufacturing',
        phone: '+256-701-234-567',
        email: 'info@acmemanufacturing.ug'
      });

    if (companyError) throw companyError;
    const companyId = company.id;
    console.log('✅ Company created:', companyId);

    // Step 2: Create admin user
    const { data: adminUser, error: adminError } = 
      await cmmsService.createAdminUser(companyId, {
        email: 'admin@acme.ug',
        name: 'John Administrator',
        phone: '+256-701-111-111'
      });

    if (adminError) throw adminError;
    console.log('✅ Admin user created:', adminUser.id);

    // Step 3: Create departments
    const departments = [
      { departmentName: 'Production', budget: 500000000 },
      { departmentName: 'Maintenance', budget: 150000000 },
      { departmentName: 'Finance', budget: 50000000 }
    ];

    for (const dept of departments) {
      const { data: deptData, error: deptError } = 
        await cmmsService.createDepartment(companyId, {
          ...dept,
          description: `${dept.departmentName} department`
        });
      
      if (!deptError) {
        console.log(`✅ Created ${dept.departmentName} department`);
      }
    }

    // Step 4: Load company data
    const { data: users } = await cmmsService.getCompanyUsers(companyId);
    const { data: depts } = await cmmsService.getCompanyDepartments(companyId);
    const { data: inventory } = await cmmsService.getCompanyInventory(companyId);

    console.log(`✅ Setup complete!`);
    console.log(`   - Company: ${company.company_name}`);
    console.log(`   - Users: ${users.length}`);
    console.log(`   - Departments: ${depts.length}`);
    console.log(`   - Inventory Items: ${inventory.length}`);

  } catch (error) {
    console.error('❌ Setup failed:', error);
  }
}

// Run setup
setupNewCompany();
```

---

## 📞 Need Help?

- Check parameter types carefully
- Ensure all UUIDs are valid
- Verify user is authenticated before operations
- Check browser console for detailed error messages
- Review Supabase dashboard for data verification

**Last Updated:** January 8, 2026
