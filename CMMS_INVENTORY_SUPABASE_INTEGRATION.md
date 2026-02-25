# CMMS Inventory - Supabase Integration Guide

## Overview
This guide shows how to integrate the **collapsible inventory system** with **Supabase** so that all inventory items are properly saved to the database and can be viewed by all team members.

---

## ✅ What's Changed

### 1. **Frontend - Collapsible Inventory Display** ✓
- Inventory items now show in **collapsed/compact view** by default
- Display shows: **Item Name | Category | Stock: X | Min: Y | Cost: Z | Assigned Person**
- Clicking on an item **expands** to show full details
- All team members can **see** inventory (permission: `canViewInventory: true` for all roles)
- Only **Storeman and Admin** can **edit/add/delete** (permission: `canEditInventory`)

### 2. **Backend - Supabase Tables** ✓
The database schema includes:
- `cmms_inventory_items` - Main inventory storage
- `cmms_department_staff` - Department member assignments
- `cmms_departments` - Department setup

---

## 📊 Frontend Component Updates

### A. InventoryManager Component
**File:** `frontend/src/components/CMSSModule.jsx` (lines ~2088+)

**Key Changes:**
```jsx
// 1. Allow ALL members to view inventory
const canViewInventory = true; // Previously: hasPermission('canViewInventory')

// 2. Only Storeman/Admin can edit
const canEditInventory = hasPermission('canEditInventory');

// 3. Add expandable state
const [expandedItems, setExpandedItems] = useState({});

// 4. Toggle expansion function
const toggleExpandItem = (itemId) => {
  setExpandedItems(prev => ({
    ...prev,
    [itemId]: !prev[itemId]
  }));
};
```

### B. UI Display
**Compact View (Default):**
```
motor
Spare Parts • Stock: 8 (Min: 2) • Cost: UGX 56,000,008 • 📦 Farm Agent  ▼
```

**Expanded View (On Click):**
```
Item Name:        motor
Category:         Spare Parts
Current Stock:    8 units ✓
Min Stock Level:  2 units
Unit Cost:        UGX 7,000,001
Total Value:      UGX 56,000,008
Assigned Storeman: 📦 Farm Agent
Created:          Feb 24, 2026
```

### C. Collapsible Implementation
```jsx
{cmmsData.inventory.map(item => (
  <div key={item.id} className="rounded-lg border {...}">
    {/* Compact Summary (Always Visible) */}
    <button onClick={() => toggleExpandItem(item.id)}>
      <div className="flex justify-between items-start">
        <div className="text-white font-semibold">{item.name}</div>
        <button>
          <span>{isExpanded ? '▲' : '▼'}</span>
        </button>
      </div>
      {/* Summary Line */}
      <div className="text-xs text-gray-300">
        Stock: {item.quantity} • Min: {item.minStock} • 
        Cost: UGX {totalValue.toLocaleString()}
      </div>
    </button>

    {/* Expanded Details (Shown When Clicked) */}
    {isExpanded && (
      <div className="mt-4 pt-4 border-t space-y-3">
        {/* Full item details grid */}
        {/* Edit/Delete buttons for authorized users */}
      </div>
    )}
  </div>
))}
```

---

## 🔐 Permission Model

### Viewing Inventory
| Role | Can View | Can Edit |
|------|----------|----------|
| Guest | ✅ Yes | ❌ No |
| Admin | ✅ Yes | ✅ Yes |
| Coordinator | ✅ Yes | ❌ No |
| Supervisor | ✅ Yes | ❌ No |
| Technician | ✅ Yes | ❌ No |
| Storeman | ✅ Yes | ✅ **Yes** |
| Finance | ✅ Yes | ❌ No |

### Key Points:
✅ **All members** can see inventory items and their details
✅ **Only Storeman & Admin** can add, edit, or delete items
✅ **View-Only Badge** appears for members who can't edit
✅ **Department Isolation**: Via RLS policies (only see own department inventory)

---

## 💾 Supabase Integration

### Step 1: Connect Supabase Client
**File:** `frontend/src/lib/supabase/client.js`
```javascript
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);
```

### Step 2: Create Inventory Service
**File:** `frontend/src/services/cmmsInventoryService.js`

```javascript
import { supabase } from '../lib/supabase/client';

// Get all inventory items for a department
export const getDepartmentInventory = async (departmentId) => {
  try {
    const { data, error } = await supabase
      .from('cmms_inventory_items')
      .select('*')
      .eq('department_id', departmentId)
      .eq('is_active', true)
      .order('item_name', { ascending: true });

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching inventory:', error);
    return { success: false, error: error.message };
  }
};

// Add new inventory item
export const addInventoryItem = async (departmentId, itemData) => {
  try {
    const { data, error } = await supabase
      .from('cmms_inventory_items')
      .insert([
        {
          department_id: departmentId,
          item_code: itemData.code || itemData.name.substring(0, 10).toUpperCase(),
          item_name: itemData.name,
          description: itemData.description || '',
          category: itemData.category,
          quantity_in_stock: itemData.quantity || 0,
          reorder_level: itemData.minStock || 0,
          unit_of_measure: itemData.unitOfMeasure || 'units',
          unit_price: itemData.cost || 0,
          supplier_name: itemData.supplierName || '',
          lead_time_days: itemData.leadTime || 0,
          storage_location: itemData.location || '',
          is_active: true
        }
      ])
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error adding inventory item:', error);
    return { success: false, error: error.message };
  }
};

// Update inventory quantity
export const updateInventoryQuantity = async (itemId, newQuantity) => {
  try {
    const { data, error } = await supabase
      .from('cmms_inventory_items')
      .update({
        quantity_in_stock: newQuantity,
        last_stock_check: new Date().toISOString()
      })
      .eq('id', itemId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error updating inventory:', error);
    return { success: false, error: error.message };
  }
};

// Delete inventory item
export const deleteInventoryItem = async (itemId) => {
  try {
    const { error } = await supabase
      .from('cmms_inventory_items')
      .update({ is_active: false })
      .eq('id', itemId);

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    return { success: false, error: error.message };
  }
};
```

### Step 3: Connect InventoryManager to Supabase
Update the `InventoryManager` component in `CMSSModule.jsx`:

```javascript
// Add at top of InventoryManager
import { getDepartmentInventory, addInventoryItem, deleteInventoryItem } from '../services/cmmsInventoryService';

// Add useEffect to load inventory from Supabase
useEffect(() => {
  loadInventory();
}, [userDepartmentId]);

const loadInventory = async () => {
  if (!userDepartmentId) return;
  const result = await getDepartmentInventory(userDepartmentId);
  if (result.success) {
    setCmmsData(prev => ({
      ...prev,
      inventory: result.data.map(item => ({
        id: item.id,
        name: item.item_name,
        category: item.category,
        quantity: item.quantity_in_stock,
        minStock: item.reorder_level,
        cost: item.unit_price,
        storeman: item.supplier_name,
        createdAt: item.created_at,
        lastRestocked: item.last_stock_check
      }))
    }));
  }
};

// Update handleAddItem to save to Supabase
const handleAddItem = async () => {
  if (!canEditInventory) {
    alert('🔒 You do not have permission to add inventory items.');
    return;
  }
  
  if (newItem.name && newItem.quantity >= 0) {
    const result = await addInventoryItem(userDepartmentId, newItem);
    
    if (result.success) {
      // Reload inventory from database
      await loadInventory();
      // Clear form
      setNewItem({ name: '', category: 'Spare Parts', quantity: 0, minStock: 0, cost: 0, storeman: '' });
      alert('✅ Inventory item saved successfully!');
    } else {
      alert('❌ Error saving item: ' + result.error);
    }
  }
};

// Update handleDeleteItem to save to Supabase
const handleDeleteItem = async (itemId) => {
  if (!canEditInventory) {
    alert('🔒 You do not have permission to delete inventory items.');
    return;
  }
  
  if (window.confirm('Are you sure you want to delete this item?')) {
    const result = await deleteInventoryItem(itemId);
    
    if (result.success) {
      await loadInventory();
      alert('✅ Item deleted successfully!');
    } else {
      alert('❌ Error deleting item: ' + result.error);
    }
  }
};
```

---

## 🚀 Deployment Steps

### A. Update Supabase SQL (Already Done)
The database schema is ready with:
- ✅ `cmms_inventory_items` table
- ✅ RLS policies for department isolation
- ✅ Proper indexes on department_id, company_id

Run this if not already done:
```bash
# Navigate to Supabase Dashboard > SQL Editor
# Paste: backend/CMMS_DEPARTMENT_INVENTORY_REQUISITIONS.sql
# Click "Execute"
```

### B. Update Frontend Service
Create or update: `frontend/src/services/cmmsInventoryService.js`
Use the code provided in **Step 2** above.

### C. Update InventoryManager Component
Update: `frontend/src/components/CMSSModule.jsx`
Add the useEffect and handler functions from **Step 3** above.

### D. Test in Browser
1. Login as **Storeman** → Can see AND edit inventory ✅
2. Login as **Technician** → Can see BUT NOT edit ✅
3. Add new item as Storeman → Should save to database ✅
4. Refresh page → Item should still exist ✅
5. Login as different role → Should see the same items ✅

---

## 🔧 Troubleshooting

### Problem: Items don't save after page refresh
**Solution:** Check Supabase connection and ensure `cmms_inventory_items` table exists
```sql
SELECT COUNT(*) FROM cmms_inventory_items;
```

### Problem: Getting "permission denied" when adding items
**Solution:** Ensure user has `canEditInventory: true` and is assigned as Storeman role
```javascript
console.log('User role:', userRole);
console.log('Can edit inventory:', canEditInventory);
```

### Problem: Other departments can see my inventory
**Solution:** Verify RLS policies are enabled:
```sql
-- Check if RLS is enabled
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname = 'cmms_inventory_items';
```

---

## 📋 Collapsible Feature Checklist

- [x] **Compact View (Default)**
  - Item Name in bold
  - Category, Stock, Min Stock, Cost in one line
  - Assigned storeman if available
  - ▼ Expand arrow on right

- [x] **Expanded View**
  - Full item details in grid
  - Edit/Delete buttons for authorized users
  - ▲ Collapse arrow to hide details

- [x] **Permissions**
  - All members can see
  - Only Storeman/Admin can edit
  - View-only badge for non-editors

- [x] **Supabase Integration**
  - Save to `cmms_inventory_items` table
  - Load on component mount
  - Reload after add/delete operations

---

## 📞 Support

For issues with the collapsible inventory system:
1. Check browser console for errors
2. Verify Supabase connection
3. Ensure RLS policies are correct
4. Check user role and permissions
5. Review SQL schema in Supabase dashboard

