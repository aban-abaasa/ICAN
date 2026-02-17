# CMMS Company Profile & Inventory Management - Detailed Specifications

## 1. COMPANY PROFILE STRUCTURE

### 1.1 Company Registration & Setup

**Company Profile Data Model:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "company_name": "ACME Manufacturing Ltd",
  "company_registration": "UG-REG-2024-12345",
  "location": "Kampala, Uganda",
  "industry": "Manufacturing",
  "phone": "+256-701-234-567",
  "email": "info@acmemanufacturing.ug",
  "website": "www.acmemanufacturing.ug",
  "created_at": "2026-01-01T08:00:00Z",
  "updated_at": "2026-01-08T10:30:00Z",
  "is_active": true,
  "created_by": "550e8400-e29b-41d4-a716-446655440001"
}
```

### 1.2 Supported Industries

| Industry | Description | Key Equipment Types |
|----------|-------------|-------------------|
| Manufacturing | Factory operations | Machines, Assembly lines, Conveyors |
| Healthcare | Hospitals & clinics | Medical equipment, HVAC, Elevators |
| Transportation | Fleet operations | Vehicles, Engines, Transmission systems |
| Building Management | Office/commercial buildings | Elevators, HVAC, Electrical systems |
| Industrial | Heavy industry | Pumps, Turbines, Compressors |
| Energy | Power generation | Generators, Transformers, Solar panels |
| Mining | Extraction operations | Excavators, Drill equipment, Crushers |

### 1.3 Company Hierarchy

```
Company (ACME Manufacturing)
├── Department 1: Production
│   ├── Facility 1: Main Factory
│   │   ├── Equipment 1: CNC Machine A
│   │   ├── Equipment 2: Hydraulic Press
│   │   └── Inventory Items
│   └── Facility 2: Assembly Plant
├── Department 2: Maintenance
│   ├── Equipment
│   └── Inventory (Spare Parts)
├── Department 3: Finance
│   └── Budget Tracking
└── Department 4: Logistics
    └── Supplier Management
```

---

## 2. INVENTORY MANAGEMENT SPECIFICATIONS

### 2.1 Inventory Item Categories

**Primary Categories:**

```sql
-- Manufacturing Spare Parts
MECHANICAL: 'Bearings, Belts, Gears, Shafts, Couplings'
HYDRAULIC: 'Pumps, Cylinders, Valves, Hoses, Filters'
ELECTRICAL: 'Motors, Transformers, Switches, Cables, Contactors'
PNEUMATIC: 'Actuators, Compressors, Regulators, Fittings'

-- Consumables
LUBRICANTS: 'Oil, Grease, Coolant, Hydraulic fluid'
FASTENERS: 'Bolts, Nuts, Screws, Washers, Rivets'
SEALS: 'O-rings, Gaskets, Packings'
FILTERS: 'Air, Oil, Coolant, Hydraulic filters'

-- Electronics
SENSORS: 'Temperature, Pressure, Proximity sensors'
CONTROL: 'PLC modules, Relays, VFDs'
WIRING: 'Cables, Connectors, Circuit breakers'

-- Safety
SAFETY_EQUIPMENT: 'PPE, Fire extinguishers, First aid'
CLEANING: 'Cleaning materials, Disinfectants'
```

### 2.2 Inventory Item Specification

**Complete Inventory Item Example:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440100",
  "company_id": "550e8400-e29b-41d4-a716-446655440000",
  "facility_id": "550e8400-e29b-41d4-a716-446655440010",
  "item_name": "SKF Deep Groove Ball Bearing 6205",
  "item_code": "BRG-SKF-6205-001",
  "description": "6205 2Z C3 Deep groove ball bearing for CNC machine spindle",
  "category": "MECHANICAL",
  "subcategory": "Bearings",
  "unit_of_measure": "Piece",
  "quantity": 15,
  "min_stock": 5,
  "max_stock": 50,
  "reorder_quantity": 20,
  "unit_cost": 45000.00,
  "total_value": 675000.00,
  "supplier_id": "550e8400-e29b-41d4-a716-446655440200",
  "supplier_name": "SKF Uganda Limited",
  "lead_time_days": 7,
  "last_restocked": "2026-01-05T14:30:00Z",
  "created_at": "2025-06-15T09:00:00Z",
  "updated_at": "2026-01-08T10:30:00Z",
  "status": "Active",
  "reorder_status": "Normal"
}
```

### 2.3 Stock Level Management

**Stock Status Calculation:**

```
┌─────────────────────────────────────────┐
│ Current Qty: 15                         │
├─────────────────────────────────────────┤
│ MAX STOCK: 50  ████████░░░░░░░░░░░░░░ │
│ IDEAL: 25      ░░░░░░░░░░░░░░░░░░░░░░ │
│ CURRENT: 15    ████████░░░░░░░░░░░░░░ │
│ MIN STOCK: 5   ░░░░░░░░░░░░░░░░░░░░░░ │
│ REORDER: 20    ░░░░░░░░░░░░░░░░░░░░░░ │
└─────────────────────────────────────────┘

Status Rules:
├─ OVERSTOCKED: Qty > MAX_STOCK (50) → Review storage
├─ ADEQUATE: MIN_STOCK < Qty ≤ MAX_STOCK (5-50) → Normal operations
├─ LOW_STOCK: Qty ≤ MIN_STOCK (5) ⚠️ → Alert technicians
├─ CRITICAL: Qty < (MIN_STOCK/2) (< 2.5) ⚠️⚠️ → Emergency order
└─ OUT_OF_STOCK: Qty = 0 ⛔ → Work stoppage risk
```

### 2.4 Inventory Valuation Methods

**FIFO (First-In-First-Out):**
```
Purchase 1: 10 units @ 40,000 UGX = 400,000 UGX
Purchase 2: 15 units @ 45,000 UGX = 675,000 UGX
Purchase 3: 20 units @ 48,000 UGX = 960,000 UGX
Total: 45 units = 2,035,000 UGX

Issue 20 units: Cost = 400,000 + (10 × 45,000) = 850,000 UGX
Remaining: 25 units = 1,185,000 UGX
```

**Weighted Average:**
```
Average Cost = Total Value / Total Quantity
             = 2,035,000 / 45
             = 45,222.22 UGX per unit

Issue 20 units: Cost = 20 × 45,222.22 = 904,444.44 UGX
```

---

## 3. INVENTORY TRANSACTION TYPES

### 3.1 Transaction Categories

**IN (Stock Receipt):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440300",
  "inventory_item_id": "550e8400-e29b-41d4-a716-446655440100",
  "transaction_type": "IN",
  "quantity": 20,
  "notes": "Stock received from supplier SKF Uganda",
  "reference_id": "PO-2026-0015",
  "reference_type": "PurchaseOrder",
  "performed_by": "550e8400-e29b-41d4-a716-446655440201",
  "performed_by_name": "John Storeman",
  "transaction_date": "2026-01-08T10:30:00Z",
  "blockchain_hash": "0x7a3c5f9...",
  "is_verified": true,
  "cost": 900000.00,
  "supplier": "SKF Uganda Limited",
  "invoice_number": "INV-SKF-2026-001"
}
```

**OUT (Stock Issue):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440301",
  "inventory_item_id": "550e8400-e29b-41d4-a716-446655440100",
  "transaction_type": "OUT",
  "quantity": 2,
  "notes": "Bearing replacement for CNC Machine A spindle maintenance",
  "reference_id": "WO-2026-0042",
  "reference_type": "WorkOrder",
  "performed_by": "550e8400-e29b-41d4-a716-446655440202",
  "performed_by_name": "Jane Technician",
  "transaction_date": "2026-01-08T11:15:00Z",
  "blockchain_hash": "0x9c3f7e2...",
  "is_verified": true,
  "authorized_by": "550e8400-e29b-41d4-a716-446655440203",
  "work_order_number": "WO-2026-0042"
}
```

**ADJUSTMENT (Stock Correction):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440302",
  "inventory_item_id": "550e8400-e29b-41d4-a716-446655440100",
  "transaction_type": "ADJUSTMENT",
  "quantity": -1,
  "notes": "Physical count discrepancy - 1 unit damaged during handling",
  "reference_id": "AUDIT-2026-001",
  "reference_type": "InventoryAudit",
  "performed_by": "550e8400-e29b-41d4-a716-446655440204",
  "performed_by_name": "Mike Audit Manager",
  "transaction_date": "2026-01-08T14:00:00Z",
  "blockchain_hash": "0x5a2c8f1...",
  "is_verified": true,
  "reason": "Physical damage discovered during stock check",
  "approved_by": "550e8400-e29b-41d4-a716-446655440205"
}
```

**LOSS (Stock Loss/Damage):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440303",
  "inventory_item_id": "550e8400-e29b-41d4-a716-446655440100",
  "transaction_type": "LOSS",
  "quantity": 3,
  "notes": "Fire damage in storage room - 3 bearings completely destroyed",
  "reference_id": "INC-2026-0089",
  "reference_type": "Incident",
  "performed_by": "550e8400-e29b-41d4-a716-446655440206",
  "performed_by_name": "Safety Officer",
  "transaction_date": "2026-01-08T15:45:00Z",
  "blockchain_hash": "0x4b1d9f3...",
  "is_verified": true,
  "loss_type": "Damage",
  "estimated_value_lost": 135000.00,
  "insurance_claim": "INS-2026-0056"
}
```

---

## 4. SUPPLIER MANAGEMENT

### 4.1 Supplier Profile

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440200",
  "company_id": "550e8400-e29b-41d4-a716-446655440000",
  "supplier_name": "SKF Uganda Limited",
  "supplier_type": "Bearing Manufacturer & Distributor",
  "contact_person": "Mr. Samuel Okello",
  "email": "sales@skf-uganda.ug",
  "phone": "+256-701-555-666",
  "address": "Plot 45 Industrial Area, Kampala",
  "city": "Kampala",
  "country": "Uganda",
  "payment_terms": "Net 30 days",
  "payment_method": ["Bank Transfer", "Mobile Money", "Cash"],
  "rating": 4.8,
  "total_orders": 42,
  "on_time_delivery_rate": 97.6,
  "quality_rating": 4.9,
  "price_competitiveness": 4.5,
  "communication_rating": 4.7,
  "credit_limit": 50000000.00,
  "current_credit_used": 12500000.00,
  "available_credit": 37500000.00,
  "average_lead_time_days": 5,
  "created_at": "2024-06-15T09:00:00Z",
  "updated_at": "2026-01-08T10:30:00Z",
  "is_active": true,
  "last_order_date": "2026-01-05T10:00:00Z"
}
```

### 4.2 Supplier Categories

**Supplier can supply for multiple categories:**

```json
{
  "supplier_id": "550e8400-e29b-41d4-a716-446655440200",
  "supplier_name": "SKF Uganda Limited",
  "service_categories": [
    "MECHANICAL - Bearings",
    "MECHANICAL - Seals",
    "LUBRICANTS - Industrial oil",
    "FASTENERS - Specialized bolts",
    "SERVICE - Technical support"
  ]
}
```

---

## 5. INVENTORY COSTING & VALUATION

### 5.1 Inventory Valuation Report

```
═══════════════════════════════════════════════════════════════
ACME MANUFACTURING - INVENTORY VALUATION REPORT
Date: January 8, 2026
═══════════════════════════════════════════════════════════════

CATEGORY BREAKDOWN:
───────────────────────────────────────────────────────────────
Category          | Items | Total Qty | Total Value   | % of Total
───────────────────────────────────────────────────────────────
MECHANICAL        | 24    | 1,850     | 127,500,000   | 45.2%
HYDRAULIC         | 18    | 320       | 96,000,000    | 34.0%
ELECTRICAL        | 15    | 2,100     | 42,000,000    | 14.9%
PNEUMATIC         | 8     | 450       | 13,500,000    | 4.8%
FASTENERS         | 12    | 5,200     | 2,600,000     | 0.9%
LUBRICANTS        | 6     | 850       | 1,275,000     | 0.5%
SEALS             | 5     | 300       | 900,000       | 0.3%
───────────────────────────────────────────────────────────────
TOTAL             | 88    | 11,070    | 281,775,000   | 100.0%
═══════════════════════════════════════════════════════════════

STOCK STATUS:
───────────────────────────────────────────────────────────────
Status            | Count | % of Items | Action Required
───────────────────────────────────────────────────────────────
OVERSTOCKED      | 5     | 5.7%       | Review & reduce
ADEQUATE         | 68    | 77.3%      | Continue monitoring
LOW_STOCK        | 12    | 13.6%      | Place orders soon ⚠️
CRITICAL         | 2     | 2.3%       | Emergency order ⛔
OUT_OF_STOCK     | 1     | 1.1%       | Procurement priority
═══════════════════════════════════════════════════════════════
```

### 5.2 Inventory Holding Costs

**Calculation Model:**

```
Annual Holding Cost = (Average Inventory Value × Holding Cost Rate)

Holding Cost Rate Components:
├─ Storage Cost: 5% (warehouse rent, utilities)
├─ Handling Cost: 3% (labor, equipment for storage)
├─ Insurance Cost: 1% (inventory insurance)
├─ Obsolescence: 2% (items becoming outdated)
├─ Shrinkage: 0.5% (theft, damage, loss)
└─ Cost of Capital: 8% (interest on money invested)
  ───────────────
  Total Rate: 19.5%

Example:
Average Inventory Value = 281,775,000 UGX
Holding Cost Rate = 19.5%
Annual Holding Cost = 281,775,000 × 0.195 = 54,946,125 UGX per year
```

---

## 6. INVENTORY APPROVAL WORKFLOW

### 6.1 Stock Issue Approval Process

```
┌─────────────────────────────────────────────────────┐
│ 1. TECHNICIAN REQUESTS STOCK                        │
├─────────────────────────────────────────────────────┤
│ • Creates work order WO-2026-0042                   │
│ • Specifies bearing (BRG-SKF-6205-001)             │
│ • Quantity needed: 2 units                          │
│ • Reason: CNC Machine A spindle maintenance        │
└──────────────┬────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│ 2. SUPERVISOR APPROVES REQUEST                      │
├─────────────────────────────────────────────────────┤
│ Status: ✓ Approved                                  │
│ Supervisor: Jane Supervisor                         │
│ Notes: "Spindle replacement necessary"              │
│ Timestamp: 2026-01-08 10:45:00 UTC                 │
└──────────────┬────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│ 3. STOREMAN VERIFIES AVAILABILITY                   │
├─────────────────────────────────────────────────────┤
│ Current Stock: 15 units ✓ (> min 5)                │
│ Check Status: ADEQUATE                              │
│ Can fulfill: YES                                    │
│ Location: Bin A-15, Shelf 3                        │
└──────────────┬────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│ 4. STOREMAN ISSUES STOCK                            │
├─────────────────────────────────────────────────────┤
│ Issued: 2 units                                     │
│ New Stock: 13 units                                 │
│ Issued By: John Storeman                            │
│ Timestamp: 2026-01-08 11:15:00 UTC                 │
│ Blockchain Hash: 0x9c3f7e2...                       │
│ Verified: ✓ True                                    │
└──────────────┬────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│ 5. TECHNICIAN RECEIVES & USES STOCK                 │
├─────────────────────────────────────────────────────┤
│ Received By: Jane Technician                        │
│ Date: 2026-01-08 11:20:00 UTC                      │
│ Installation Completed: 2026-01-08 14:30:00 UTC    │
│ Unused Units Returned: 0                            │
└─────────────────────────────────────────────────────┘
```

---

## 7. REORDER POINT & ECONOMIC ORDER QUANTITY

### 7.1 Reorder Point Calculation

```
Reorder Point (ROP) = (Average Daily Usage × Lead Time) + Safety Stock

Example - Bearing BRG-SKF-6205-001:
├─ Average Daily Usage: 0.5 units/day
├─ Supplier Lead Time: 7 days
├─ Safety Stock: 3 units (covers variations)
└─ ROP = (0.5 × 7) + 3 = 6.5 units

SYSTEM ALERT RULES:
├─ When Stock = 7 units: Place order (ROP reached)
├─ When Stock = 5 units: Urgent order (MIN_STOCK)
└─ When Stock = 2.5 units: Critical (emergency order)
```

### 7.2 Economic Order Quantity (EOQ)

```
EOQ = √(2 × D × S / H)

Where:
D = Annual Demand
S = Cost per Order (procurement, shipping, handling)
H = Annual Holding Cost per Unit

Example - Bearing BRG-SKF-6205-001:
├─ Annual Demand: 180 units (0.5/day × 365 days)
├─ Cost per Order: 125,000 UGX (paperwork, inspection)
├─ Unit Holding Cost: 8,775 UGX (45,000 × 19.5% holding rate)
├─ Holding Cost per Unit: 8,775 UGX
└─ EOQ = √(2 × 180 × 125,000 / 8,775) = 71.4 units ≈ 72 units

ORDERING STRATEGY:
├─ Order Quantity: 72 units (economic batch)
├─ Reorder Point: 7 units
├─ Maximum Stock: 79 units (ROP + EOQ)
└─ Cost Savings vs. smaller orders: ~35%
```

---

## 8. INVENTORY AUDIT & CYCLE COUNTING

### 8.1 Physical Inventory Audit

```
═══════════════════════════════════════════════════════════════
PHYSICAL INVENTORY AUDIT CHECKLIST - Jan 8, 2026
Location: Main Factory Storage Room
Auditor: Mike Audit Manager
═══════════════════════════════════════════════════════════════

Item Code: BRG-SKF-6205-001
Item Name: SKF Deep Groove Ball Bearing 6205
───────────────────────────────────────────────────────────────
System Record: 15 units
Physical Count: 14 units
Discrepancy: -1 unit (LOSS)
───────────────────────────────────────────────────────────────
Reason for Discrepancy:
✓ Damaged unit found during handling inspection
  Location: Bin A-15, Shelf 3
  Condition: Rust damage from water leak
  Approval: Finance approves write-off

Action:
1. Adjust inventory: -1 unit (LOSS transaction)
2. Cost impact: 45,000 UGX
3. Insurance claim: INS-2026-0089
4. Root cause: Improve storage roof sealing

Approved By: Finance Officer
Timestamp: 2026-01-08 14:30:00 UTC
Blockchain: ✓ Recorded & Verified
═══════════════════════════════════════════════════════════════
```

### 8.2 Cycle Counting Schedule

```
INVENTORY CYCLE COUNT ROTATION
─────────────────────────────────────────────────

CATEGORY A ITEMS (High Value): Monthly
├─ Bearings (MECHANICAL)
├─ Hydraulic Valves
└─ Electronics

CATEGORY B ITEMS (Medium Value): Quarterly
├─ Fasteners
├─ Seals
└─ Standard Motors

CATEGORY C ITEMS (Low Value): Annually
├─ Lubricants
├─ Consumables
└─ Safety Equipment

Physical Count: Annual comprehensive count
Schedule: Last week of December each year
```

---

## 9. LOW STOCK ALERTS & NOTIFICATIONS

### 9.1 Alert Rules

```
STOCK STATUS ALERT MATRIX
─────────────────────────────────────────────────────────────

Status            | Quantity      | Alert Level | Action
─────────────────────────────────────────────────────────────
OVERSTOCKED      | Qty > MAX      | ℹ️  Info    | Review usage
ADEQUATE         | MIN < Qty ≤MAX | ✓  OK       | Continue
LOW_STOCK        | Qty ≤ MIN      | ⚠️  Warning | Order within 48h
CRITICAL         | Qty < MIN/2    | 🔴 Alert   | Order within 4h
OUT_OF_STOCK     | Qty = 0        | ⛔ Critical | Immediate action

Example - Bearing (MIN=5):
├─ Adequate: 15 units ✓
├─ Low Stock: 5 units ⚠️
├─ Critical: 2 units 🔴
└─ Out: 0 units ⛔
```

### 9.2 Notification Recipients

```
LOW_STOCK ALERT (Qty ≤ 5):
├─ Storeman: "Place order for BRG-SKF-6205-001"
├─ Supervisor: "Stock alert - Review requisition"
└─ Finance: "Upcoming expenditure - Bearing purchase"

CRITICAL STOCK ALERT (Qty < 2.5):
├─ Storeman: "URGENT: Emergency order required"
├─ Supervisor: "CRITICAL: Stock shortage risk"
├─ Finance: "CRITICAL: Expedited purchase approval"
└─ Technicians: "ALERT: Use alternative if available"

OUT_OF_STOCK ALERT (Qty = 0):
├─ All users: "CRITICAL: Item unavailable"
├─ Finance: "Work stoppage risk - approve expedited purchase"
└─ Management: "Supply chain disruption alert"
```

---

## 10. INTEGRATION WITH WORK ORDERS

### 10.1 Inventory-Work Order Link

```
WORK ORDER → INVENTORY REQUISITION FLOW
─────────────────────────────────────────────────────

Work Order: WO-2026-0042
├─ Title: Replace CNC Machine A spindle bearing
├─ Equipment: CNC-MAIN-001
├─ Priority: High
├─ Assigned To: Jane Technician
│
├─ REQUIRED INVENTORY ITEMS:
│  ├─ Item 1: BRG-SKF-6205-001 (qty: 2) ✓ Available
│  ├─ Item 2: LUBR-ISO-100 (qty: 0.5L) ✓ Available
│  └─ Item 3: FASTENER-M8 (qty: 4) ✓ Available
│
├─ ESTIMATED COST: 100,000 UGX
├─ ACTUAL COST: 95,500 UGX (cost variance tracking)
│
└─ BLOCKCHAIN RECORD:
   └─ Transaction Hash: 0x9c3f7e2...
```

---

## 11. COST TRACKING & FINANCIAL REPORTING

### 11.1 Inventory Cost Breakdown

```
MONTHLY INVENTORY FINANCIAL SUMMARY - January 2026
═════════════════════════════════════════════════════

BEGINNING INVENTORY: 287,500,000 UGX
+ Purchases        : + 42,500,000 UGX
+ Adjustments      : +  1,200,000 UGX
- Issues           : - 28,750,000 UGX (cost of issued items)
- Losses           : -  1,500,000 UGX (write-offs)
─────────────────────────────────────────
ENDING INVENTORY   : 281,775,000 UGX

COST OF GOODS ISSUED: 28,750,000 UGX
├─ Allocated to Work Orders
├─ Maintenance requisitions
└─ Equipment repairs

INVENTORY TURNOVER RATE:
= Annual Cost of Issues / Average Inventory Value
= 345,000,000 / 281,775,000
= 1.22x per year
```

---

## 12. AUDIT TRAIL & COMPLIANCE

### 12.1 Complete Transaction Audit Trail

```
TRANSACTION AUDIT LOG - BRG-SKF-6205-001
═════════════════════════════════════════════════════════════

Transaction 1: PURCHASE (IN)
├─ Date: 2026-01-05 10:00:00
├─ Quantity: 20 units
├─ Cost: 900,000 UGX
├─ Supplier: SKF Uganda Limited
├─ PO Number: PO-2026-0015
├─ Received By: John Storeman
├─ Approved By: Finance Officer
├─ Blockchain: 0x7a3c5f9... ✓
└─ Status: Verified & Recorded

Transaction 2: ISSUE (OUT)
├─ Date: 2026-01-08 11:15:00
├─ Quantity: 2 units
├─ Cost: 90,000 UGX (FIFO valuation)
├─ Work Order: WO-2026-0042
├─ Issued To: Jane Technician
├─ Approved By: Supervisor
├─ Blockchain: 0x9c3f7e2... ✓
└─ Status: Verified & Recorded

Transaction 3: LOSS (ADJUSTMENT)
├─ Date: 2026-01-08 14:30:00
├─ Quantity: -1 unit
├─ Cost: 45,000 UGX
├─ Reason: Water damage from roof leak
├─ Documented By: Audit Manager
├─ Approved By: Finance Officer
├─ Insurance Claim: INS-2026-0089
├─ Blockchain: 0x4b1d9f3... ✓
└─ Status: Verified & Recorded

FINAL STATUS:
├─ Beginning: 15 units
├─ Received: +20 units
├─ Issued: -2 units
├─ Lost: -1 unit
├─ Ending: 32 units ✓
└─ All transactions blockchain verified
```

---

This comprehensive specification document provides:
✅ Company profile structure and setup
✅ Specific inventory categories & items
✅ Complete transaction types with examples
✅ Supplier management details
✅ Costing & valuation methods
✅ Approval workflows
✅ Reorder calculations
✅ Audit trail requirements
✅ Financial reporting
✅ Integration with work orders
