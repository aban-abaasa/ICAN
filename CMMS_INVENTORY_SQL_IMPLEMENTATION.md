# CMMS Implementation - Company Profile & Inventory SQL Examples

## 1. COMPANY PROFILE SETUP - PRACTICAL EXAMPLES

### 1.1 Create Company Profile

```sql
-- Insert Company Profile
INSERT INTO companies (
    id, company_name, company_registration, location, industry,
    phone, email, website, is_active, created_by
) VALUES (
    '550e8400-e29b-41d4-a716-446655440000',
    'ACME Manufacturing Ltd',
    'UG-REG-2024-12345',
    'Kampala, Uganda',
    'Manufacturing',
    '+256-701-234-567',
    'info@acmemanufacturing.ug',
    'www.acmemanufacturing.ug',
    true,
    '550e8400-e29b-41d4-a716-446655440001'
);

-- Create company's departments
INSERT INTO departments (id, company_id, department_name, description, budget, budget_year, is_active) VALUES
('550e8400-e29b-41d4-a716-446655440005', '550e8400-e29b-41d4-a716-446655440000', 'Production', 'Main manufacturing operations', 500000000, 2026, true),
('550e8400-e29b-41d4-a716-446655440006', '550e8400-e29b-41d4-a716-446655440000', 'Maintenance', 'Equipment maintenance & repairs', 150000000, 2026, true),
('550e8400-e29b-41d4-a716-446655440007', '550e8400-e29b-41d4-a716-446655440000', 'Finance', 'Financial management', 50000000, 2026, true),
('550e8400-e29b-41d4-a716-446655440008', '550e8400-e29b-41d4-a716-446655440000', 'Logistics', 'Supply chain & inventory', 80000000, 2026, true);

-- Create facilities
INSERT INTO facilities (id, company_id, facility_name, location_address, facility_type, total_area_sqft, is_active) VALUES
('550e8400-e29b-41d4-a716-446655440010', '550e8400-e29b-41d4-a716-446655440000', 'Main Factory', 'Plot 100, Industrial Area, Kampala', 'Manufacturing', 50000, true),
('550e8400-e29b-41d4-a716-446655440011', '550e8400-e29b-41d4-a716-446655440000', 'Assembly Plant', 'Plot 101, Industrial Area, Kampala', 'Assembly', 25000, true),
('550e8400-e29b-41d4-a716-446655440012', '550e8400-e29b-41d4-a716-446655440000', 'Central Warehouse', 'Plot 50, Logistics Park, Kampala', 'Storage', 10000, true);
```

### 1.2 Verify Company Setup

```sql
-- Check company details
SELECT * FROM companies WHERE company_registration = 'UG-REG-2024-12345';

-- Check all departments
SELECT d.id, d.department_name, d.budget, d.budget_year, d.is_active
FROM departments d
WHERE d.company_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY d.department_name;

-- Check all facilities
SELECT f.id, f.facility_name, f.facility_type, f.total_area_sqft
FROM facilities f
WHERE f.company_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY f.facility_name;
```

---

## 2. INVENTORY ITEM CREATION - SPECIFIC EXAMPLES

### 2.1 Add Suppliers

```sql
-- Insert Suppliers
INSERT INTO suppliers (id, company_id, supplier_name, contact_person, email, phone, address, city, country, payment_terms, rating, is_active) VALUES

-- Primary bearing supplier
('550e8400-e29b-41d4-a716-446655440200', '550e8400-e29b-41d4-a716-446655440000', 'SKF Uganda Limited', 'Samuel Okello', 'sales@skf-uganda.ug', '+256-701-555-666', 'Plot 45 Industrial Area', 'Kampala', 'Uganda', 'Net 30', 4.8, true),

-- Hydraulic supplier
('550e8400-e29b-41d4-a716-446655440201', '550e8400-e29b-41d4-a716-446655440000', 'Bosch Rexroth Uganda', 'Peter Ssekamate', 'technical@rexroth-ug.com', '+256-702-666-777', 'Plot 200 Ntinda', 'Kampala', 'Uganda', 'Net 45', 4.7, true),

-- Electrical supplier
('550e8400-e29b-41d4-a716-446655440202', '550e8400-e29b-41d4-a716-446655440000', 'Schneider Electric Uganda', 'Fatima Hassan', 'sales@schneider-ug.com', '+256-703-777-888', 'Plot 15 Kololo', 'Kampala', 'Uganda', 'Net 30', 4.5, true),

-- Fasteners supplier
('550e8400-e29b-41d4-a716-446655440203', '550e8400-e29b-41d4-a716-446655440000', 'KMS Industrial Supplies', 'David Mwangi', 'orders@kmsindustrial.ug', '+256-704-888-999', 'Plot 78 Mukono', 'Mukono', 'Uganda', 'Net 15', 4.3, true),

-- Lubricants supplier
('550e8400-e29b-41d4-a716-446655440204', '550e8400-e29b-41d4-a716-446655440000', 'Shell Lubricants Uganda', 'Rachel Njeri', 'industrial@shell-ug.com', '+256-705-999-000', 'Plot 500 Port Bell', 'Jinja', 'Uganda', 'Net 60', 4.6, true);
```

### 2.2 Create Mechanical Inventory Items

```sql
-- BEARINGS CATEGORY
INSERT INTO inventory_items (
    id, company_id, facility_id, item_name, item_code, description,
    category, unit_of_measure, quantity, min_stock, max_stock, reorder_quantity,
    unit_cost, supplier_id, is_active
) VALUES

-- Bearing 1: Deep groove ball bearing
('550e8400-e29b-41d4-a716-446655440100', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'SKF Deep Groove Ball Bearing 6205', 'BRG-SKF-6205-001',
'6205 2Z C3 Deep groove ball bearing for CNC machine spindle',
'MECHANICAL', 'Piece', 15, 5, 50, 20, 45000, '550e8400-e29b-41d4-a716-446655440200', true),

-- Bearing 2: Angular contact bearing
('550e8400-e29b-41d4-a716-446655440101', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'SKF Angular Contact Bearing 7206', 'BRG-SKF-7206-001',
'7206 BECBM Angular contact bearing for high precision spindles',
'MECHANICAL', 'Piece', 8, 4, 30, 15, 52000, '550e8400-e29b-41d4-a716-446655440200', true),

-- Bearing 3: Tapered roller bearing
('550e8400-e29b-41d4-a716-446655440102', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'SKF Tapered Roller Bearing 30205', 'BRG-SKF-30205-001',
'30205 J2 Tapered roller bearing for heavy machinery',
'MECHANICAL', 'Piece', 12, 5, 40, 18, 38000, '550e8400-e29b-41d4-a716-446655440200', true);

-- GEARS & TRANSMISSION
INSERT INTO inventory_items (
    id, company_id, facility_id, item_name, item_code, description,
    category, unit_of_measure, quantity, min_stock, max_stock, reorder_quantity,
    unit_cost, supplier_id, is_active
) VALUES

('550e8400-e29b-41d4-a716-446655440110', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'Spur Gear Module 2.5 DIN 6', 'GR-SPR-M25-001',
'Module 2.5 spur gear for industrial gearbox, 48 teeth',
'MECHANICAL', 'Piece', 6, 2, 15, 8, 125000, '550e8400-e29b-41d4-a716-446655440200', true),

('550e8400-e29b-41d4-a716-446655440111', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'Timing Belt HTD 3M 450', 'BLT-HTD-3M450-001',
'HTD 3M timing belt, 450mm length, synchronous drive',
'MECHANICAL', 'Piece', 10, 3, 25, 12, 85000, '550e8400-e29b-41d4-a716-446655440200', true);

-- MECHANICAL SEALS
INSERT INTO inventory_items (
    id, company_id, facility_id, item_name, item_code, description,
    category, unit_of_measure, quantity, min_stock, max_stock, reorder_quantity,
    unit_cost, supplier_id, is_active
) VALUES

('550e8400-e29b-41d4-a716-446655440120', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'Oil Seal FKM 35x72x10', 'SEL-OIL-35x72-001',
'FKM oil seal for hydraulic cylinders, 35x72x10mm',
'MECHANICAL', 'Piece', 20, 8, 60, 25, 8000, '550e8400-e29b-41d4-a716-446655440200', true),

('550e8400-e29b-41d4-a716-446655440121', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'O-Ring NBR 70 DIN3771', 'OR-NBR70-001',
'Nitrile O-ring assorted sizes for hydraulic systems',
'MECHANICAL', 'Box', 5, 2, 12, 6, 45000, '550e8400-e29b-41d4-a716-446655440200', true);
```

### 2.3 Create Hydraulic Inventory Items

```sql
INSERT INTO inventory_items (
    id, company_id, facility_id, item_name, item_code, description,
    category, unit_of_measure, quantity, min_stock, max_stock, reorder_quantity,
    unit_cost, supplier_id, is_active
) VALUES

-- Hydraulic Pumps
('550e8400-e29b-41d4-a716-446655440130', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'Bosch Rexroth Axial Piston Pump A4VSO125', 'PMP-REXROTH-A4VSO125',
'A4VSO125 variable displacement pump, swashplate design',
'HYDRAULIC', 'Unit', 2, 1, 4, 2, 2500000, '550e8400-e29b-41d4-a716-446655440201', true),

-- Hydraulic Cylinders
('550e8400-e29b-41d4-a716-446655440131', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'Bosch Rexroth Double-Acting Cylinder CG5', 'CYL-REXROTH-CG5-63x40',
'Double-acting hydraulic cylinder, bore 63mm, rod 40mm',
'HYDRAULIC', 'Unit', 4, 2, 8, 3, 350000, '550e8400-e29b-41d4-a716-446655440201', true),

-- Hydraulic Valves
('550e8400-e29b-41d4-a716-446655440132', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'Hydraulic Directional Control Valve 4/3', 'VLV-DIR-4/3-10L',
'4/3 spool valve, NG10, cavity mount, 10L/min',
'HYDRAULIC', 'Unit', 3, 1, 6, 3, 580000, '550e8400-e29b-41d4-a716-446655440201', true),

-- Hydraulic Hoses
('550e8400-e29b-41d4-a716-446655440133', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'Hydraulic Hose EN 853 1SN 1/2"', 'HSE-HYD-EN853-1/2',
'High pressure hose 1/2" SAE, reinforced rubber',
'HYDRAULIC', 'Meter', 50, 20, 150, 80, 12000, '550e8400-e29b-41d4-a716-446655440201', true),

-- Hydraulic Filters
('550e8400-e29b-41d4-a716-446655440134', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'Bosch Rexroth Hydraulic Filter Element', 'FLT-HYD-10MICRON-001',
'10 micron hydraulic filter element, 300cc flow',
'HYDRAULIC', 'Unit', 15, 5, 40, 20, 95000, '550e8400-e29b-41d4-a716-446655440201', true);
```

### 2.4 Create Electrical Inventory Items

```sql
INSERT INTO inventory_items (
    id, company_id, facility_id, item_name, item_code, description,
    category, unit_of_measure, quantity, min_stock, max_stock, reorder_quantity,
    unit_cost, supplier_id, is_active
) VALUES

-- Electric Motors
('550e8400-e29b-41d4-a716-446655440140', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'Siemens Electric Motor 1LA7 11kW', 'MTR-SIEMENS-1LA7-11KW',
'Three-phase asynchronous motor, 11kW, 1500 rpm',
'ELECTRICAL', 'Unit', 2, 1, 4, 2, 450000, '550e8400-e29b-41d4-a716-446655440202', true),

-- Variable Frequency Drives
('550e8400-e29b-41d4-a716-446655440141', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'Schneider Electric ATV320 VFD 7.5kW', 'VFD-SCHNEIDER-ATV320-7.5K',
'Variable frequency drive, 7.5kW, 3-phase input',
'ELECTRICAL', 'Unit', 3, 1, 5, 2, 520000, '550e8400-e29b-41d4-a716-446655440202', true),

-- Control Transformers
('550e8400-e29b-41d4-a716-446655440142', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'Control Transformer 10kVA', 'TRF-CTRL-10KVA-001',
'Dry-type control transformer, 380V/24V, 10kVA',
'ELECTRICAL', 'Unit', 2, 1, 3, 1, 320000, '550e8400-e29b-41d4-a716-446655440202', true),

-- Power Cables
('550e8400-e29b-41d4-a716-446655440143', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440010',
'Power Cable NYM 3x2.5mm2', 'CBL-NYM-3x2.5-001',
'Flexible power cable, 3x2.5mm2, copper conductor',
'ELECTRICAL', 'Meter', 200, 50, 500, 150, 2500, '550e8400-e29b-41d4-a716-446655440202', true);
```

### 2.5 Create Consumables

```sql
INSERT INTO inventory_items (
    id, company_id, facility_id, item_name, item_code, description,
    category, unit_of_measure, quantity, min_stock, max_stock, reorder_quantity,
    unit_cost, supplier_id, is_active
) VALUES

-- Lubricants
('550e8400-e29b-41d4-a716-446655440150', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440012',
'Shell Tellus S2 MA 68 Hydraulic Oil', 'LUB-SHELL-ISO68-001',
'ISO VG 68 hydraulic oil, industrial grade',
'LUBRICANTS', 'Liter', 200, 50, 500, 200, 8500, '550e8400-e29b-41d4-a716-446655440204', true),

('550e8400-e29b-41d4-a716-446655440151', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440012',
'Shell Tellus S2 MA 22 Machine Oil', 'LUB-SHELL-ISO22-001',
'ISO VG 22 spindle oil for precision machines',
'LUBRICANTS', 'Liter', 100, 25, 250, 100, 6500, '550e8400-e29b-41d4-a716-446655440204', true),

('550e8400-e29b-41d4-a716-446655440152', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440012',
'Shell Gadus S3 V460 Grease', 'LUB-SHELL-GREASE-001',
'NLGI 2 multipurpose bearing grease',
'LUBRICANTS', 'Kg', 50, 10, 100, 40, 18000, '550e8400-e29b-41d4-a716-446655440204', true),

-- Fasteners
('550e8400-e29b-41d4-a716-446655440160', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440012',
'Stainless Steel Bolt M8x50', 'FST-BOLT-M8x50-SS',
'M8x50 stainless steel socket head cap bolt, DIN 912',
'FASTENERS', 'Box(50pcs)', 20, 5, 50, 20, 12000, '550e8400-e29b-41d4-a716-446655440203', true),

('550e8400-e29b-41d4-a716-446655440161', '550e8400-e29b-41d4-a716-446655440000', '550e8400-e29b-41d4-a716-446655440012',
'High Tensile Nut M8', 'FST-NUT-M8-HT',
'M8 high tensile hex nut, grade 8.8',
'FASTENERS', 'Box(50pcs)', 25, 8, 60, 25, 8500, '550e8400-e29b-41d4-a716-446655440203', true);
```

---

## 3. INVENTORY TRANSACTIONS - PRACTICAL EXAMPLES

### 3.1 Stock Receipt (IN Transaction)

```sql
-- Purchase Order Received
INSERT INTO inventory_transactions (
    id, inventory_item_id, transaction_type, quantity, notes,
    reference_id, reference_type, performed_by, blockchain_hash, is_verified
) VALUES
('550e8400-e29b-41d4-a716-446655440300',
'550e8400-e29b-41d4-a716-446655440100',
'IN',
20,
'Stock received from supplier SKF Uganda - PO-2026-0015',
'PO-2026-0015',
'PurchaseOrder',
'550e8400-e29b-41d4-a716-446655440201',  -- Storeman
'0x7a3c5f9d2b1e4c8f9a0b3c2d1e0f4a5b',
true);

-- Update inventory quantity
UPDATE inventory_items
SET quantity = quantity + 20,
    last_restocked = CURRENT_TIMESTAMP
WHERE id = '550e8400-e29b-41d4-a716-446655440100';
```

### 3.2 Stock Issue (OUT Transaction)

```sql
-- Issue stock for work order
INSERT INTO inventory_transactions (
    id, inventory_item_id, transaction_type, quantity, notes,
    reference_id, reference_type, performed_by, blockchain_hash, is_verified
) VALUES
('550e8400-e29b-41d4-a716-446655440301',
'550e8400-e29b-41d4-a716-446655440100',
'OUT',
2,
'Bearing replacement for CNC Machine A spindle - WO-2026-0042',
'WO-2026-0042',
'WorkOrder',
'550e8400-e29b-41d4-a716-446655440202',  -- Storeman
'0x9c3f7e2b1a0d5c8f9a2b1c0e3f4a5b6c',
true);

-- Update inventory quantity
UPDATE inventory_items
SET quantity = quantity - 2
WHERE id = '550e8400-e29b-41d4-a716-446655440100';
```

### 3.3 Stock Adjustment (ADJUSTMENT Transaction)

```sql
-- Adjust inventory due to damage
INSERT INTO inventory_transactions (
    id, inventory_item_id, transaction_type, quantity, notes,
    reference_id, reference_type, performed_by, blockchain_hash, is_verified
) VALUES
('550e8400-e29b-41d4-a716-446655440302',
'550e8400-e29b-41d4-a716-446655440100',
'ADJUSTMENT',
-1,
'Physical count discrepancy - 1 unit damaged during handling in warehouse',
'AUDIT-2026-001',
'InventoryAudit',
'550e8400-e29b-41d4-a716-446655440204',  -- Audit Manager
'0x5a2c8f1b3e0d9c4f1a5b2c3d0e1f4a5b',
true);

-- Update inventory quantity
UPDATE inventory_items
SET quantity = quantity - 1
WHERE id = '550e8400-e29b-41d4-a716-446655440100';
```

---

## 4. INVENTORY MANAGEMENT QUERIES

### 4.1 Current Stock Status

```sql
-- Get current stock status for all items
SELECT
    i.item_code,
    i.item_name,
    i.category,
    i.quantity AS current_qty,
    i.min_stock,
    i.max_stock,
    i.unit_cost,
    (i.quantity * i.unit_cost) AS total_value,
    CASE
        WHEN i.quantity > i.max_stock THEN 'OVERSTOCKED'
        WHEN i.quantity > i.min_stock THEN 'ADEQUATE'
        WHEN i.quantity <= i.min_stock AND i.quantity > (i.min_stock / 2) THEN 'LOW_STOCK'
        WHEN i.quantity <= (i.min_stock / 2) AND i.quantity > 0 THEN 'CRITICAL'
        ELSE 'OUT_OF_STOCK'
    END AS status
FROM inventory_items i
WHERE i.company_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY i.category, i.item_name;
```

### 4.2 Low Stock Alert Query

```sql
-- Alert for items below minimum stock
SELECT
    i.item_code,
    i.item_name,
    i.quantity,
    i.min_stock,
    i.reorder_quantity,
    s.supplier_name,
    s.email,
    i.unit_cost * i.reorder_quantity AS reorder_cost
FROM inventory_items i
JOIN suppliers s ON i.supplier_id = s.id
WHERE i.company_id = '550e8400-e29b-41d4-a716-446655440000'
    AND i.quantity <= i.min_stock
    AND i.is_active = true
ORDER BY i.quantity ASC;
```

### 4.3 Inventory Valuation Report

```sql
-- Complete inventory valuation by category
SELECT
    i.category,
    COUNT(*) AS item_count,
    SUM(i.quantity) AS total_qty,
    SUM(i.quantity * i.unit_cost) AS total_value,
    ROUND(SUM(i.quantity * i.unit_cost) / 
          (SELECT SUM(quantity * unit_cost) FROM inventory_items 
           WHERE company_id = '550e8400-e29b-41d4-a716-446655440000') * 100, 2) AS pct_of_total
FROM inventory_items i
WHERE i.company_id = '550e8400-e29b-41d4-a716-446655440000'
    AND i.is_active = true
GROUP BY i.category
ORDER BY total_value DESC;
```

### 4.4 Transaction Audit Trail

```sql
-- Complete transaction history for an item
SELECT
    it.transaction_date,
    it.transaction_type,
    it.quantity,
    CASE
        WHEN it.transaction_type = 'IN' THEN 'Stock Received'
        WHEN it.transaction_type = 'OUT' THEN 'Stock Issued'
        WHEN it.transaction_type = 'ADJUSTMENT' THEN 'Adjustment'
        WHEN it.transaction_type = 'LOSS' THEN 'Loss/Damage'
    END AS transaction_description,
    it.reference_type,
    it.reference_id,
    it.notes,
    u.user_name AS performed_by,
    it.blockchain_hash,
    it.is_verified
FROM inventory_transactions it
JOIN users u ON it.performed_by = u.id
WHERE it.inventory_item_id = '550e8400-e29b-41d4-a716-446655440100'
ORDER BY it.transaction_date DESC;
```

### 4.5 Stock Movement Analysis

```sql
-- Monthly stock movement analysis
SELECT
    DATE_TRUNC('month', it.transaction_date) AS month,
    i.item_code,
    i.item_name,
    SUM(CASE WHEN it.transaction_type = 'IN' THEN it.quantity ELSE 0 END) AS qty_received,
    SUM(CASE WHEN it.transaction_type = 'OUT' THEN it.quantity ELSE 0 END) AS qty_issued,
    SUM(CASE WHEN it.transaction_type = 'ADJUSTMENT' OR it.transaction_type = 'LOSS' 
             THEN it.quantity ELSE 0 END) AS qty_adjusted,
    COUNT(*) AS total_transactions
FROM inventory_transactions it
JOIN inventory_items i ON it.inventory_item_id = i.id
WHERE i.company_id = '550e8400-e29b-41d4-a716-446655440000'
GROUP BY DATE_TRUNC('month', it.transaction_date), i.item_code, i.item_name
ORDER BY month DESC, i.item_code;
```

---

## 5. REORDER POINT & EOQ CALCULATIONS

### 5.1 Calculate Reorder Point

```sql
-- Function to calculate reorder point
CREATE OR REPLACE FUNCTION calculate_reorder_point(
    p_avg_daily_usage NUMERIC,
    p_lead_time_days INT,
    p_safety_stock INT
) RETURNS NUMERIC AS $$
BEGIN
    RETURN (p_avg_daily_usage * p_lead_time_days) + p_safety_stock;
END;
$$ LANGUAGE plpgsql;

-- Example: Calculate ROP for bearing
SELECT
    item_code,
    item_name,
    0.5 AS avg_daily_usage,  -- units/day
    7 AS lead_time_days,
    3 AS safety_stock,
    calculate_reorder_point(0.5, 7, 3) AS reorder_point
FROM inventory_items
WHERE id = '550e8400-e29b-41d4-a716-446655440100';
```

### 5.2 Calculate Economic Order Quantity

```sql
-- Function to calculate EOQ
CREATE OR REPLACE FUNCTION calculate_eoq(
    p_annual_demand NUMERIC,
    p_order_cost NUMERIC,
    p_holding_cost NUMERIC
) RETURNS NUMERIC AS $$
BEGIN
    RETURN SQRT((2 * p_annual_demand * p_order_cost) / p_holding_cost);
END;
$$ LANGUAGE plpgsql;

-- Example: Calculate EOQ for bearing
SELECT
    item_code,
    item_name,
    180 AS annual_demand,  -- 0.5 units/day * 365 days
    125000 AS order_cost,  -- UGX per order
    8775 AS holding_cost_per_unit,  -- UGX per unit per year
    ROUND(calculate_eoq(180, 125000, 8775)::NUMERIC, 0) AS eoq
FROM inventory_items
WHERE id = '550e8400-e29b-41d4-a716-446655440100';
```

---

## 6. BLOCKCHAIN VERIFICATION

### 6.1 Verify Transaction on Blockchain

```sql
-- Check blockchain verification status
SELECT
    it.id,
    it.transaction_type,
    it.quantity,
    it.transaction_date,
    it.blockchain_hash,
    it.is_verified,
    bt.transaction_hash AS blockchain_tx_hash,
    bt.block_number,
    bt.is_confirmed,
    bt.confirmation_timestamp
FROM inventory_transactions it
LEFT JOIN blockchain_transactions bt ON it.blockchain_hash = bt.transaction_hash
WHERE it.inventory_item_id = '550e8400-e29b-41d4-a716-446655440100'
ORDER BY it.transaction_date DESC;
```

### 6.2 Audit Trail Completeness

```sql
-- Verify all transactions are blockchain recorded
SELECT
    COUNT(*) AS total_transactions,
    SUM(CASE WHEN is_verified = true THEN 1 ELSE 0 END) AS verified_transactions,
    SUM(CASE WHEN is_verified = false THEN 1 ELSE 0 END) AS unverified_transactions,
    ROUND(SUM(CASE WHEN is_verified = true THEN 1 ELSE 0 END)::NUMERIC / COUNT(*) * 100, 2) AS verification_rate
FROM inventory_transactions
WHERE inventory_item_id = '550e8400-e29b-41d4-a716-446655440100';
```

---

This practical guide provides specific, ready-to-use SQL examples for managing CMMS company profiles and inventory with complete blockchain tracking.
