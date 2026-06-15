# CMMS Database Schema & Blockchain Integration Guide

## Overview
This document describes the comprehensive database schema for the Computerized Maintenance Management System (CMMS) with integrated blockchain functionality for immutable audit trails, smart contracts, and service provider verification.

---

## Table of Contents
1. [Schema Architecture](#schema-architecture)
2. [Core Entities](#core-entities)
3. [Blockchain Integration](#blockchain-integration)
4. [Smart Contracts](#smart-contracts)
5. [Digital Signatures](#digital-signatures)
6. [Audit Trail & Compliance](#audit-trail--compliance)
7. [Data Relationships](#data-relationships)
8. [Implementation Notes](#implementation-notes)

---

## Schema Architecture

The CMMS schema is organized into 15 major table categories:

```
┌─ Organization Layer ────────┐
│ • Companies                 │
│ • Departments              │
│ • Facilities               │
└─────────────────────────────┘
         ↓
┌─ User & Access Control ─────┐
│ • Users                     │
│ • Roles                    │
│ • User_Roles (mapping)     │
└─────────────────────────────┘
         ↓
┌─ Asset Management ──────────┐
│ • Equipment                 │
│ • Inventory_Items           │
│ • Suppliers                │
└─────────────────────────────┘
         ↓
┌─ Work Management ───────────┐
│ • Work_Orders              │
│ • Requisitions             │
│ • Maintenance_Plans        │
└─────────────────────────────┘
         ↓
┌─ Approval & Workflow ───────┐
│ • Approval_Workflows        │
│ • Service_Providers        │
└─────────────────────────────┘
         ↓
┌─ Financial Tracking ────────┐
│ • Work_Order_Costs         │
│ • Budget_Tracking          │
└─────────────────────────────┘
         ↓
┌─ Blockchain & Audit ────────┐
│ • Blockchain_Transactions   │
│ • Audit_Trail              │
│ • Smart_Contracts          │
│ • Digital_Signatures       │
└─────────────────────────────┘
```

---

## Core Entities

### 1. Organization Tables

#### Companies
Represents the main organization using the CMMS.

**Fields:**
- `id` (UUID): Primary key
- `company_name` (VARCHAR): Official company name
- `company_registration` (VARCHAR): Unique registration number
- `location` (VARCHAR): Physical location
- `industry` (VARCHAR): Industry type (Manufacturing, Healthcare, etc.)
- `phone`, `email`, `website`: Contact information
- `created_by` (FK): User who created the company profile
- `is_active` (BOOLEAN): Soft delete flag

#### Departments
Organizational divisions within a company.

**Fields:**
- `id` (UUID): Primary key
- `company_id` (FK): Parent company
- `department_name` (VARCHAR): Department identifier
- `head_id` (FK): Department head user
- `budget` (DECIMAL): Annual department budget
- `budget_year` (INT): Budget fiscal year

#### Facilities
Physical locations or facilities managed by the company.

**Fields:**
- `id` (UUID): Primary key
- `company_id` (FK): Parent company
- `facility_name`, `location_address`
- `facility_type` (VARCHAR): Type of facility
- `total_area_sqft` (DECIMAL): Facility size

### 2. User & Role Management

#### Users
System users with authentication credentials.

**Key Fields:**
- `id` (UUID): Primary key
- `email` (VARCHAR UNIQUE): Email identifier
- `user_name` (VARCHAR): Display name
- `password_hash` (VARCHAR): Encrypted password
- `company_id` (FK): Associated company
- `last_login` (TIMESTAMP): Last activity timestamp

#### Roles
Predefined role templates with permission levels.

**Predefined Roles:**
1. **Admin (Level 7)**: Full system access
2. **Department_Coordinator (Level 5)**: Manage departments, approve requisitions
3. **Supervisor (Level 4)**: Supervise technicians, approve work
4. **Finance_Officer (Level 4)**: Financial approvals and budgets
5. **Technician (Level 2)**: Execute maintenance, create requisitions
6. **Storeman (Level 2)**: Inventory management
7. **Service_Provider (Level 1)**: External services, limited access
8. **Guest (Level 0)**: View-only access

#### User_Roles
Many-to-many mapping of users to roles with department-level assignment.

**Fields:**
- `user_id` (FK): User reference
- `role_id` (FK): Role reference
- `assigned_for_department_id` (FK): Department-specific role assignment
- `assigned_by` (FK): User who made the assignment
- `assigned_at` (TIMESTAMP): Assignment date

### 3. Equipment & Assets

#### Equipment
Physical equipment and machinery managed by the system.

**Fields:**
- `id` (UUID): Primary key
- `company_id` (FK): Owner company
- `facility_id` (FK): Location facility
- `equipment_code` (VARCHAR): Unique equipment identifier
- `equipment_name`, `equipment_type`
- `manufacturer`, `model_number`, `serial_number`
- `purchase_date`, `purchase_cost`
- `warranty_expiry` (DATE)
- `critical` (BOOLEAN): Critical asset flag
- `is_operational` (BOOLEAN): Current operational status

### 4. Inventory Management

#### Inventory_Items
Spare parts and supplies inventory.

**Fields:**
- `id` (UUID): Primary key
- `item_code` (VARCHAR): Unique item code
- `item_name`, `category`
- `quantity` (INT): Current stock level
- `min_stock`, `max_stock`, `reorder_quantity`
- `unit_cost` (DECIMAL): Cost per unit
- `supplier_id` (FK): Associated supplier
- `last_restocked` (TIMESTAMP)

#### Inventory_Transactions
Audit trail for all inventory movements.

**Transaction Types:**
- `IN`: Stock received
- `OUT`: Stock issued
- `ADJUSTMENT`: Inventory adjustment
- `LOSS`: Stock loss/damage

**Blockchain Integration:**
- `blockchain_hash` (VARCHAR): Hash of blockchain transaction
- `is_verified` (BOOLEAN): Blockchain verification status

#### Suppliers
Vendor information for sourcing parts.

**Fields:**
- `supplier_name`, `contact_person`
- `email`, `phone`, `address`
- `payment_terms`, `rating`
- `is_active` (BOOLEAN)

### 5. Work Orders & Requisitions

#### Work_Orders
Records of actual maintenance work performed.

**Status Flow:**
```
Draft → Scheduled → In_Progress → Completed
                    ↓
                  Cancelled
```

**Work Types:**
- `Preventive`: Scheduled maintenance
- `Corrective`: Reactive repairs
- `Inspection`: Equipment inspection
- `Emergency`: Urgent repairs

**Fields:**
- `wo_number` (VARCHAR UNIQUE): Sequential work order number
- `equipment_id` (FK): Related equipment
- `assigned_to` (FK): Technician assignment
- `estimated_cost`, `actual_cost`
- `estimated_duration_hours`, `actual_duration_hours`
- `priority` (ENUM): Low/Medium/High/Emergency
- `blockchain_hash` (VARCHAR): Blockchain verification
- `is_verified` (BOOLEAN)

#### Requisitions
Formal requests for maintenance work requiring approval.

**Status Workflow:**
```
Draft
  ↓
Pending_Supervisor → Supervisor_Approved/Rejected
  ↓
Pending_Coordinator → Coordinator_Approved/Rejected
  ↓
Pending_Finance → Finance_Approved/Rejected
  ↓
In_Progress → Completed/Cancelled
```

**Fields:**
- `req_number` (VARCHAR UNIQUE): Sequential requisition number
- `equipment_id` (FK): Related equipment
- `created_by` (FK): Requester
- `assigned_technician` (FK): Assigned technician
- `estimated_cost`, `estimated_days`
- `priority` (ENUM): Low/Medium/High/Emergency
- `blockchain_hash` (VARCHAR)
- `is_verified` (BOOLEAN)

### 6. Approval Workflow

#### Approval_Workflows
Multi-stage approval process for requisitions.

**Approval Stages:**
1. **Supervisor**: Department supervisor approval
2. **Coordinator**: Department coordinator review
3. **Finance**: Financial approval based on budget
4. **Management**: Executive approval (if needed)

**Approval Status:**
- `Pending`: Awaiting review
- `Approved`: Approved by stage
- `Rejected`: Rejected with notes
- `Forwarded`: Passed to next stage

**Fields:**
- `requisition_id` (FK): Parent requisition
- `approver_id` (FK): User performing approval
- `approval_stage` (ENUM): Current stage
- `approval_order` (INT): Sequence number
- `notes` (TEXT): Approval notes/rejection reasons
- `blockchain_hash` (VARCHAR)
- `is_verified` (BOOLEAN)

### 7. Maintenance Plans

#### Maintenance_Plans
Preventive maintenance schedules for equipment.

**Maintenance Types:**
- `Preventive`: Scheduled regular maintenance
- `Predictive`: Based on equipment condition
- `Corrective`: Reactive maintenance
- `Run_to_Failure`: No scheduled maintenance

**Frequency Options:**
- Daily, Weekly, Monthly, Quarterly, Annually, As_Needed

**Fields:**
- `equipment_id` (FK): Target equipment
- `plan_name`, `description`
- `last_performed` (DATE): Last maintenance date
- `next_due_date` (DATE): Next scheduled date
- `estimated_duration_hours`, `estimated_cost`

### 8. Service Providers

#### Service_Providers
External contractors and service providers.

**Fields:**
- `provider_name`, `contact_person`
- `email`, `phone`, `address`
- `service_categories` (JSON): Array of service types
- `license_number`, `insurance_provider`, `insurance_expiry`
- `rating` (DECIMAL 3,2): Performance rating
- `hourly_rate` (DECIMAL)
- `blockchain_verified` (BOOLEAN): Blockchain verification status
- `blockchain_hash` (VARCHAR): Verification hash

---

## Blockchain Integration

The CMMS implements blockchain technology for:
1. **Immutable Audit Trails**: Every action is recorded on blockchain
2. **Smart Contracts**: Automated execution of maintenance agreements
3. **Service Provider Verification**: Decentralized verification of credentials
4. **Cost Transparency**: Transparent financial transactions
5. **Compliance & Auditing**: Regulatory compliance records

### Blockchain_Transactions Table

Records all blockchain transactions with immutable proof.

**Transaction Types:**
- `Requisition`: Maintenance requisition creation/approval
- `WorkOrder`: Work order execution
- `Approval`: Approval workflow steps
- `Inventory`: Inventory movement transactions
- `Cost`: Financial transactions
- `ServiceProvider`: Provider registration/verification

**Fields:**
- `transaction_hash` (VARCHAR UNIQUE): Blockchain hash
- `transaction_type` (ENUM): Type of transaction
- `related_entity_id` (UUID): Original entity reference
- `related_entity_type` (VARCHAR): Entity class
- `transaction_data` (JSON): Complete transaction details
- `timestamp` (TIMESTAMP): Transaction time
- `block_number` (INT): Blockchain block reference
- `is_confirmed` (BOOLEAN): Blockchain confirmation status
- `confirmation_timestamp` (TIMESTAMP): When confirmed

**Example Blockchain Data Structure:**
```json
{
  "transaction_hash": "0x7a3c5f9...",
  "transaction_type": "Requisition",
  "related_entity_id": "550e8400-e29b-41d4-a716-446655440000",
  "related_entity_type": "requisitions",
  "transaction_data": {
    "req_number": "REQ-2026-001",
    "title": "Replace hydraulic pump",
    "equipment_id": "550e8400-e29b-41d4-a716-446655440001",
    "created_by": "user@company.com",
    "estimated_cost": 50000,
    "status": "finance-approved",
    "blockchain_proof": {
      "algorithm": "SHA-256",
      "previous_hash": "0x2b5c8a1...",
      "nonce": 12345
    }
  },
  "timestamp": "2026-01-08T10:30:45Z",
  "block_number": 42857,
  "is_confirmed": true,
  "confirmation_timestamp": "2026-01-08T10:35:12Z"
}
```

---

## Smart Contracts

### Smart_Contracts Table

Represents digital contracts on blockchain for service agreements and work orders.

**Contract Types:**
- `Service_Agreement`: Long-term service provider agreement
- `Work_Order_Contract`: Single work order contract
- `Maintenance_Plan`: Preventive maintenance agreement
- `Equipment_Warranty`: Equipment warranty contract
- `SLA`: Service Level Agreement

**Status Lifecycle:**
```
Draft → Signed → Active → Completed
           ↓
        Cancelled
```

**Fields:**
- `contract_address` (VARCHAR): Blockchain contract address
- `work_order_id` (FK): Related work order
- `service_provider_id` (FK): Service provider
- `contract_terms` (JSON): Contract details
- `amount` (DECIMAL): Contract amount
- `blockchain_hash` (VARCHAR)
- `is_verified` (BOOLEAN)

**Example Smart Contract Data:**
```json
{
  "contract_type": "Service_Agreement",
  "contract_name": "ACME Services - 2026 Maintenance Contract",
  "contract_address": "0x742d35Cc6634C0532925a3b844Bc1e4b4f334555",
  "service_provider_id": "550e8400-e29b-41d4-a716-446655440002",
  "contract_terms": {
    "description": "Annual maintenance contract for hydraulic systems",
    "start_date": "2026-01-01",
    "end_date": "2026-12-31",
    "service_hours": "24/7 emergency support",
    "response_time_hours": 4,
    "cost_per_visit": 5000,
    "monthly_retainer": 50000,
    "penalties": {
      "late_response": "1000 per hour",
      "service_failure": "10% of retainer"
    }
  },
  "amount": 650000,
  "blockchain_hash": "0x9c3f7e2...",
  "is_verified": true
}
```

---

## Digital Signatures

### Digital_Signatures Table

Manages cryptographic signatures for document verification.

**Verification Status:**
- `Pending`: Signature pending verification
- `Verified`: Signature verified on blockchain
- `Revoked`: Signature invalidated

**Fields:**
- `document_id` (UUID): Document being signed
- `document_type` (VARCHAR): Type of document
- `signer_id` (FK): User who signed
- `signature_hash` (VARCHAR UNIQUE): Cryptographic signature
- `signature_timestamp` (TIMESTAMP)
- `blockchain_hash` (VARCHAR): Blockchain proof

**Signature Process:**
```
1. Document created
2. Generate document hash (SHA-256)
3. Sign with user's private key
4. Store signature on blockchain
5. Emit blockchain verification event
6. Update signature status to "Verified"
```

---

## Audit Trail & Compliance

### Audit_Trail Table

Comprehensive logging of all system actions for compliance and investigation.

**Actions Tracked:**
- `CREATE`: Entity creation
- `UPDATE`: Entity modification
- `DELETE`: Entity deletion
- `APPROVE`: Approval action
- `REJECT`: Rejection action
- `COMPLETE`: Completion action

**Fields:**
- `entity_type` (VARCHAR): Type of entity modified
- `entity_id` (UUID): ID of entity
- `action` (ENUM): Action performed
- `old_values` (JSON): Previous values
- `new_values` (JSON): Updated values
- `performed_by` (FK): User who performed action
- `performed_at` (TIMESTAMP): Action timestamp
- `ip_address` (VARCHAR): Source IP address
- `user_agent` (TEXT): Browser/client information
- `blockchain_hash` (VARCHAR): Blockchain record

**Example Audit Entry:**
```json
{
  "entity_type": "requisitions",
  "entity_id": "550e8400-e29b-41d4-a716-446655440000",
  "action": "UPDATE",
  "old_values": {
    "status": "pending-coordinator",
    "assigned_technician": null
  },
  "new_values": {
    "status": "finance-approved",
    "assigned_technician": "John Smith"
  },
  "performed_by": "550e8400-e29b-41d4-a716-446655440005",
  "performed_at": "2026-01-08T10:30:45Z",
  "ip_address": "192.168.1.100",
  "blockchain_hash": "0x5a2c8f1..."
}
```

---

## Data Relationships

### Key Foreign Key Relationships:

```
companies (1) ─────┬──── (N) users
                   ├──── (N) departments
                   ├──── (N) facilities
                   ├──── (N) equipment
                   ├──── (N) suppliers
                   ├──── (N) service_providers
                   ├──── (N) work_orders
                   ├──── (N) requisitions
                   └──── (N) smart_contracts

departments (1) ──┬──── (N) users (head)
                  └──── (N) budget_tracking

facilities (1) ───┬──── (N) equipment
                  ├──── (N) inventory_items
                  └──── (N) maintenance_plans

users (1) ────────┬──── (N) user_roles
                  ├──── (N) work_orders (assigned)
                  ├──── (N) requisitions (created)
                  ├──── (N) approval_workflows
                  ├──── (N) work_order_costs
                  ├──── (N) inventory_transactions
                  ├──── (N) audit_trail
                  └──── (N) notifications

equipment (1) ────┬──── (N) work_orders
                  ├──── (N) requisitions
                  ├──── (N) maintenance_plans
                  └──── (N) maintenance_history

inventory_items (1) ─┬──── (N) inventory_transactions
                     └──── (N) requisition_items

requisitions (1) ──┬──── (N) approval_workflows
                   ├──── (N) blockchain_transactions
                   └──── (N) audit_trail

work_orders (1) ───┬──── (N) work_order_costs
                   ├──── (N) smart_contracts
                   ├──── (N) blockchain_transactions
                   └──── (N) audit_trail

service_providers (1) ─┬──── (N) suppliers
                       ├──── (N) smart_contracts
                       └──── (N) digital_signatures
```

---

## Implementation Notes

### 1. Data Integrity

**Constraints Enforced:**
- PRIMARY KEY: Unique identification
- FOREIGN KEY: Referential integrity with CASCADE delete
- UNIQUE: Prevents duplicate critical identifiers
- CHECK: Business rule validation

### 2. Performance Optimization

**Indexes Created For:**
- Frequent WHERE clauses (status, company_id, created_at)
- Foreign key relationships
- Composite indexes for common query patterns
- Blockchain hash lookups

**Example Query Optimization:**
```sql
-- Without index: Full table scan
SELECT * FROM requisitions WHERE status = 'finance-approved';

-- With index: Fast lookup
CREATE INDEX idx_requisition_status ON requisitions(status);
```

### 3. Blockchain Integration Points

**Automatic Blockchain Recording:**
1. **Requisition Creation**: Entire requisition stored on blockchain
2. **Approval Actions**: Each approval step recorded immutably
3. **Work Order Completion**: Final work order details on blockchain
4. **Inventory Movement**: All stock transactions on blockchain
5. **Cost Recording**: Financial transactions on blockchain
6. **Service Provider Registration**: Provider credentials on blockchain

### 4. Soft Deletes

**Deleted Records Preserved Via:**
- `is_active` BOOLEAN field instead of hard delete
- Allows historical analysis and audit trails
- Maintains referential integrity

**Soft Delete Pattern:**
```sql
-- Deactivate instead of delete
UPDATE companies SET is_active = false WHERE id = '...';

-- Query active records only
SELECT * FROM companies WHERE is_active = true;
```

### 5. JSON Fields for Flexibility

**JSON Fields Used For:**
- Service provider service_categories
- Smart contract terms
- Blockchain transaction_data
- Audit trail old_values/new_values
- Report configurations

**Benefits:**
- Schema evolution without migrations
- Complex nested data structures
- Easy serialization/deserialization

### 6. Timestamps for Auditing

**Every Table Includes:**
- `created_at`: Record creation time
- `updated_at`: Last modification time
- Optional: `deleted_at` for soft deletes

### 7. UUID vs INT Primary Keys

**Advantages of UUID:**
- Globally unique across systems
- No central sequence generation needed
- Better for distributed systems
- Blockchain-friendly

---

## Sample Queries

### Find All Pending Approvals for Supervisor
```sql
SELECT r.*, aw.approval_stage, aw.approver_id
FROM requisitions r
JOIN approval_workflows aw ON r.id = aw.requisition_id
WHERE aw.approval_stage = 'Supervisor' 
  AND aw.approval_status = 'Pending'
  AND aw.approver_id = '<user_id>'
ORDER BY r.created_at DESC;
```

### Blockchain Verification History
```sql
SELECT bt.transaction_hash, bt.transaction_type, bt.timestamp,
       bt.block_number, bt.is_confirmed
FROM blockchain_transactions bt
WHERE bt.related_entity_id = '<requisition_id>'
ORDER BY bt.timestamp DESC;
```

### Inventory Stock Analysis with Blockchain Audit
```sql
SELECT i.item_name, i.quantity, i.min_stock, i.max_stock,
       COUNT(it.id) as transaction_count,
       SUM(CASE WHEN it.transaction_type = 'IN' THEN it.quantity ELSE 0 END) as total_in,
       SUM(CASE WHEN it.transaction_type = 'OUT' THEN it.quantity ELSE 0 END) as total_out
FROM inventory_items i
LEFT JOIN inventory_transactions it ON i.id = it.inventory_item_id
WHERE i.company_id = '<company_id>'
  AND (it.blockchain_hash IS NOT NULL OR it.blockchain_hash IS NULL)
GROUP BY i.id
HAVING i.quantity <= i.min_stock;
```

### Service Provider Compliance Check
```sql
SELECT sp.provider_name, sp.rating, sp.blockchain_verified,
       COUNT(sc.id) as active_contracts,
       SUM(sc.amount) as total_contract_value
FROM service_providers sp
LEFT JOIN smart_contracts sc ON sp.id = sc.service_provider_id
WHERE sp.company_id = '<company_id>'
  AND sp.is_active = true
  AND sp.insurance_expiry > CURDATE()
GROUP BY sp.id
ORDER BY sp.rating DESC;
```

---

## Security Considerations

1. **Password Storage**: Always use bcrypt or Argon2 for password hashing
2. **SQL Injection Prevention**: Use parameterized queries/prepared statements
3. **Blockchain Security**: Implement private key management for signatures
4. **Access Control**: Enforce role-based access control at DB level
5. **Encryption**: Encrypt sensitive data in transit and at rest
6. **Audit Logging**: Log all data access and modifications

---

## Future Enhancements

1. **Machine Learning**: Predictive maintenance based on equipment data
2. **IoT Integration**: Real-time equipment monitoring and alerting
3. **Mobile App**: On-site technician mobile application
4. **Advanced Analytics**: Dashboards and KPI tracking
5. **API Gateway**: RESTful APIs for third-party integration
6. **Blockchain Scaling**: Implement Layer 2 solutions for cost reduction

---

## Conclusion

This CMMS database schema provides a comprehensive, scalable, and secure platform for maintenance management with integrated blockchain technology for immutable audit trails, smart contracts, and compliance tracking. The modular design allows for easy extension and customization based on specific organizational needs.

Last Updated: January 8, 2026
