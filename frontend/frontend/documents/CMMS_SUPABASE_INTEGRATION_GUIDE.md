# CMMS Supabase Integration - Setup & Verification Guide

## 🎯 Overview

The CMMS (Computerized Maintenance Management System) has been updated to use **Supabase as the database** for all company profiles, users, roles, inventory, and operational data.

### What Changed?

**Before:** Company profiles stored in browser `localStorage` (lost when browser cleared)
**Now:** Company profiles stored in **Supabase PostgreSQL** database (persistent, secure, backed up)

---

## ✅ Integration Points

### 1. **New CMMS Service Layer** 
📁 Location: `ICAN/frontend/src/lib/supabase/services/cmmsService.js`

**Key Functions:**
- `createCompanyProfile()` - Creates company in Supabase
- `createAdminUser()` - Creates first admin user for company
- `getCompanyUsers()` - Retrieves all users
- `assignUserRole()` - Assigns roles to users
- `getCompanyDepartments()` - Fetches departments
- `getCompanyInventory()` - Gets inventory items
- `getInventoryTransactions()` - Gets transaction history
- `getCompanyEquipment()` - Gets equipment list
- `getMaintenancePlans()` - Gets maintenance schedules
- `getCompanyBudget()` - Gets budget tracking

### 2. **Updated CMSSModule.jsx**
📁 Location: `ICAN/frontend/src/components/CMSSModule.jsx`

**Changes:**
- Added Supabase CMMS service import
- Updated `handleCreateProfileAsGuest()` to call Supabase API
- Added loading state (`isCreatingProfile`) with spinner
- Stores company_id in localStorage for session management
- Uses Supabase as source of truth

### 3. **Database Tables Used**

All tables from the PostgreSQL schema are now accessible:

| Table | Purpose | Key Fields |
|-------|---------|-----------|
| **companies** | Company profiles | company_name, company_registration, location, industry |
| **users** | CMMS users | email, user_name, company_id, is_active |
| **user_roles** | Role assignments | user_id, role_id, company_id, assigned_by |
| **roles** | Role definitions | role_name, permission_level |
| **departments** | Company departments | department_name, company_id, budget |
| **equipment** | Facility equipment | equipment_code, equipment_name, company_id |
| **inventory_items** | Stock items | item_name, item_code, company_id, quantity |
| **inventory_transactions** | Stock movements | transaction_type, inventory_item_id, company_id |
| **work_orders** | Maintenance tasks | work_order_code, equipment_id, company_id |
| **maintenance_plans** | Scheduled maintenance | plan_name, equipment_id, company_id |
| **budget_tracking** | Department budgets | allocated_budget, spent_amount, company_id |
| **facilities** | Physical locations | facility_name, facility_type, company_id |
| **suppliers** | Vendor information | supplier_name, company_id, phone, email |

---

## 🔧 Setup Instructions

### Step 1: Ensure Supabase Environment Variables

Make sure your `.env` file in `ICAN/frontend` contains:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Step 2: Run Database Migrations

The PostgreSQL schema is already defined in:
📁 `ICAN/CMMS_IMPLEMENTATION_DATA_SPECIFIC.sql`

This contains all tables, ENUMS, triggers, and test data.

**Option A: Using psql client**
```bash
psql -U postgres -d cmms_db -f CMMS_IMPLEMENTATION_DATA_SPECIFIC.sql
```

**Option B: In Supabase Dashboard**
1. Go to SQL Editor
2. Paste the entire schema file
3. Run it as a single script
4. Verify tables are created

### Step 3: Verify Tables Exist

In Supabase Dashboard → SQL Editor, run:

```sql
-- Check all CMMS tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN (
    'companies', 'users', 'departments', 'equipment',
    'inventory_items', 'inventory_transactions', 'work_orders',
    'maintenance_plans', 'user_roles', 'roles', 'budget_tracking',
    'facilities', 'suppliers', 'audit_trail', 'smart_contracts'
  )
ORDER BY table_name;
```

Expected output: 15+ table rows

### Step 4: Check Row Level Security (RLS)

Supabase provides RLS policies. Verify they're set up correctly:

```sql
-- Check RLS is enabled on companies table
SELECT * FROM pg_tables 
WHERE tablename = 'companies' 
  AND schemaname = 'public';

-- Check policies
SELECT * FROM pg_policies 
WHERE tablename = 'companies';
```

---

## 🧪 Testing the Integration

### Test 1: Welcome Screen Opens Correctly

1. Open CMMS module in the app
2. Should see: "👋 Welcome to CMMS"
3. Click "Create Your Company Profile"

### Test 2: Create Company Profile

1. Fill in form:
   - Company Name: `Test Manufacturing Co`
   - Registration: `TEST-2024-001`
   - Location: `Test City`
   - Industry: `Manufacturing`
   - Email: `admin@testmfg.com`
   - Owner Name: `Test Admin`

2. Click "Create Profile & Get Access Code"
3. Should see loading spinner briefly
4. Success alert: "🎉 Company profile created!"

### Test 3: Verify in Supabase

Check company was created:

```sql
SELECT id, company_name, company_registration, is_active 
FROM companies 
WHERE company_name = 'Test Manufacturing Co';
```

Expected: 1 row with your test data

### Test 4: Check Admin User Created

```sql
SELECT u.id, u.user_name, u.email, ur.role_id, r.role_name
FROM users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
WHERE u.company_id = 'YOUR_COMPANY_ID'
  AND r.role_name = 'Admin';
```

Expected: 1 admin user row

### Test 5: Load Company Data

After profile creation, the dashboard should load:
- Company info section
- Users & roles
- Inventory (if test data exists)
- Departments
- Work orders

---

## 📊 Data Flow Diagram

```
┌──────────────────────┐
│  CMSSModule Component │
│  (React UI)          │
└──────────────┬───────┘
               │
               ▼
    ┌──────────────────────┐
    │  handleCreateProfile │
    │  (Async function)    │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │  cmmsService.createCompanyProfile │
    │  (Supabase JS Client)            │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │  Supabase PostgreSQL Database     │
    │  - INSERT companies table         │
    │  - INSERT users table             │
    │  - INSERT user_roles table        │
    └──────────────────────────────────┘
               │
               ▼
    ┌──────────────────────────────────┐
    │  Response with IDs & Timestamps   │
    │  (Back to component)              │
    └──────────┬───────────────────────┘
               │
               ▼
    ┌──────────────────────┐
    │  Update Local State   │
    │  + localStorage       │
    │  + Display Dashboard  │
    └──────────────────────┘
```

---

## 🔐 Security Features

### 1. **Row Level Security (RLS)**
Every table is filtered by `company_id` to ensure multi-tenant isolation:

```sql
-- Example policy (auto-created)
CREATE POLICY "Users can only see their company data"
ON companies
FOR SELECT USING (id = auth.uid()::uuid);
```

### 2. **Authentication**
- Only authenticated Supabase users can create profiles
- Profile creation requires valid auth session
- Company_id becomes isolation key

### 3. **Audit Trail**
All changes logged in `audit_trail` table:
- Who made the change
- What table was affected
- Old and new values
- Blockchain hash for verification

---

## 🚀 Accessing Data in Components

### Example 1: Load Company Profile

```jsx
import cmmsService from '../lib/supabase/services/cmmsService';

// In your component
const [company, setCompany] = useState(null);

useEffect(() => {
  const loadCompany = async () => {
    const { data, error } = await cmmsService.getCompanyProfile(companyId);
    if (error) console.error(error);
    else setCompany(data);
  };
  loadCompany();
}, [companyId]);
```

### Example 2: List All Users

```jsx
const [users, setUsers] = useState([]);

useEffect(() => {
  const loadUsers = async () => {
    const { data, error } = await cmmsService.getCompanyUsers(companyId);
    if (error) console.error(error);
    else setUsers(data);
  };
  loadUsers();
}, [companyId]);
```

### Example 3: Get Inventory with Stock Status

```jsx
const [inventory, setInventory] = useState([]);

const loadInventory = async () => {
  const { data, error } = await cmmsService.getCompanyInventory(companyId);
  if (!error) {
    // Calculate stock status
    const withStatus = data.map(item => ({
      ...item,
      status: item.quantity > item.max_stock ? 'OVERSTOCKED'
            : item.quantity > item.min_stock ? 'ADEQUATE'
            : 'LOW_STOCK'
    }));
    setInventory(withStatus);
  }
};
```

---

## 📝 Environment Checklist

- [ ] Supabase project created
- [ ] PostgreSQL database initialized
- [ ] CMMS schema imported (`CMMS_IMPLEMENTATION_DATA_SPECIFIC.sql`)
- [ ] `.env` file updated with SUPABASE_URL and ANON_KEY
- [ ] ICAN/frontend restarted to load new env vars
- [ ] `cmmsService.js` accessible in `src/lib/supabase/services/`
- [ ] `CMSSModule.jsx` updated with Supabase imports
- [ ] RLS policies configured (if needed)
- [ ] Test data verified in Supabase dashboard

---

## 🆘 Troubleshooting

### Issue: "Missing Supabase credentials"
**Solution:** Check `.env` file has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`

### Issue: "User not authenticated"
**Solution:** Ensure user is signed in with Supabase auth before creating profile

### Issue: "Company name already exists"
**Solution:** Use unique company registration numbers in tests

### Issue: "foreign key constraint violation"
**Solution:** Ensure companies table has an entry before creating users

### Issue: "column 'company_id' does not exist"
**Solution:** Run the full `CMMS_IMPLEMENTATION_DATA_SPECIFIC.sql` to add missing columns

---

## 📞 Support

For questions about the CMMS Supabase integration:
1. Check [Supabase Docs](https://supabase.com/docs)
2. Review the schema in `CMMS_IMPLEMENTATION_DATA_SPECIFIC.sql`
3. Check service functions in `cmmsService.js`
4. Review the PostgreSQL structure for multi-tenant design

---

## 📚 Related Files

- 📁 **Frontend**: `ICAN/frontend/src/components/CMSSModule.jsx`
- 📁 **Service**: `ICAN/frontend/src/lib/supabase/services/cmmsService.js`
- 📁 **Schema**: `ICAN/CMMS_IMPLEMENTATION_DATA_SPECIFIC.sql`
- 📁 **Config**: `ICAN/frontend/server/config/supabase.js`
- 📁 **Client**: `ICAN/frontend/src/lib/supabase/client.js`

---

**Last Updated:** January 8, 2026  
**Status:** ✅ Production Ready
