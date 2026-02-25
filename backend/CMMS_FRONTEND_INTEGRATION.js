// ============================================================
// CMMS DEPARTMENT INVENTORY & REQUISITIONS
// Frontend Integration Guide & Example Code
// ============================================================

/**
 * This file provides example code for integrating the 
 * department inventory and requisition system into your frontend.
 * 
 * Use these as templates and adapt to your framework.
 */

// ============================================================
// 1) SUPABASE CLIENT SETUP
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.REACT_APP_SUPABASE_URL,
  process.env.REACT_APP_SUPABASE_ANON_KEY
);

// ============================================================
// 2) DEPARTMENT MANAGEMENT FUNCTIONS
// ============================================================

/**
 * Create a new department
 */
export const createDepartment = async (companyId, departmentData) => {
  try {
    const { data, error } = await supabase
      .from('cmms_departments')
      .insert([
        {
          cmms_company_id: companyId,
          department_name: departmentData.name,
          department_code: departmentData.code,
          description: departmentData.description,
          annual_budget: departmentData.budget,
          created_by: null, // Will be set by RLS policy
        }
      ])
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error creating department:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get all departments for a company
 */
export const getDepartments = async (companyId) => {
  try {
    const { data, error } = await supabase
      .from('cmms_departments')
      .select('*')
      .eq('cmms_company_id', companyId)
      .eq('status', 'active');

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching departments:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Assign user to department
 */
export const assignUserToDepartment = async (departmentId, userId, isPrimary = false) => {
  try {
    const { data, error } = await supabase
      .from('cmms_department_staff')
      .insert([
        {
          department_id: departmentId,
          cmms_user_id: userId,
          is_primary_department: isPrimary,
          is_active: true,
        }
      ])
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error assigning user to department:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get department staff
 */
export const getDepartmentStaff = async (departmentId) => {
  try {
    const { data, error } = await supabase
      .from('v_department_staff')
      .select('*')
      .eq('department_id', departmentId)
      .eq('is_active', true);

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching department staff:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================
// 3) INVENTORY MANAGEMENT FUNCTIONS
// ============================================================

/**
 * Create inventory item in department
 */
export const createInventoryItem = async (departmentId, itemData) => {
  try {
    const { data, error } = await supabase
      .from('cmms_inventory_items')
      .insert([
        {
          department_id: departmentId,
          item_code: itemData.code,
          item_name: itemData.name,
          description: itemData.description,
          category: itemData.category, // spare_parts, tools, consumables, equipment
          quantity_in_stock: itemData.quantity || 0,
          unit_of_measure: itemData.unit,
          unit_price: itemData.price,
          reorder_level: itemData.reorderLevel,
          reorder_quantity: itemData.reorderQuantity,
          supplier_name: itemData.supplierName,
          lead_time_days: itemData.leadTimeDays,
          storage_location: itemData.location,
          bin_number: itemData.binNumber,
        }
      ])
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error creating inventory item:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get inventory for department with status
 */
export const getDepartmentInventory = async (departmentId) => {
  try {
    const { data, error } = await supabase
      .from('v_department_inventory')
      .select('*')
      .eq('department_id', departmentId)
      .eq('is_active', true);

    if (error) throw error;
    
    // Group by status
    const inventory = {
      inStock: data.filter(item => item.stock_status === 'IN_STOCK'),
      reorderNeeded: data.filter(item => item.stock_status === 'REORDER_NEEDED'),
      outOfStock: data.filter(item => item.stock_status === 'OUT_OF_STOCK'),
      all: data,
      totalStockValue: data.reduce((sum, item) => sum + (item.stock_value || 0), 0)
    };

    return { success: true, data: inventory };
  } catch (error) {
    console.error('Error fetching inventory:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Update inventory item quantity
 */
export const updateInventoryQuantity = async (itemId, newQuantity) => {
  try {
    const { data, error } = await supabase
      .from('cmms_inventory_items')
      .update({
        quantity_in_stock: newQuantity,
        last_stock_check: new Date().toISOString(),
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

// ============================================================
// 4) REQUISITION MANAGEMENT FUNCTIONS
// ============================================================

/**
 * Submit a new requisition
 * This calls the database function submit_requisition()
 */
export const submitRequisition = async (
  departmentId,
  purpose,
  justification,
  urgencyLevel = 'normal',
  requiredByDate = null,
  items = []
) => {
  try {
    // Call the RPC function
    const { data, error } = await supabase
      .rpc('submit_requisition', {
        p_department_id: departmentId,
        p_purpose: purpose,
        p_justification: justification,
        p_urgency_level: urgencyLevel,
        p_required_by_date: requiredByDate,
        p_items: items, // JSONB array
      });

    if (error) throw error;
    return { success: true, requisitionId: data };
  } catch (error) {
    console.error('Error submitting requisition:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Example usage of submitRequisition
 */
export const exampleSubmitRequisition = async () => {
  const items = [
    {
      inventory_item_id: "item-001-uuid",
      item_code: "PUMP-001",
      item_name: "Hydraulic Pump",
      item_description: "Industrial hydraulic pump",
      category: "spare_parts",
      requested_quantity: 2,
      unit_of_measure: "pcs",
      unit_price: 450.00,
      lead_time_days: 5
    },
    {
      inventory_item_id: "item-002-uuid",
      item_code: "SEAL-KIT",
      item_name: "Seals Kit",
      item_description: "O-ring and seal replacement kit",
      category: "spare_parts",
      requested_quantity: 1,
      unit_of_measure: "pcs",
      unit_price: 75.50,
      lead_time_days: 2
    }
  ];

  return await submitRequisition(
    "department-uuid", // departmentId
    "maintenance",     // purpose
    "Production line #2 pump failed pressure test. Needs immediate replacement. Ordered seals preventively.",
    "urgent",
    new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
    items
  );
};

/**
 * Get requisition summary
 */
export const getRequisitionSummary = async (filters = {}) => {
  try {
    let query = supabase
      .from('v_requisition_summary')
      .select('*');

    if (filters.departmentId) {
      query = query.eq('department_id', filters.departmentId);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.companyId) {
      query = query.eq('cmms_company_id', filters.companyId);
    }

    // Order by urgency and required date
    query = query
      .order('urgency_level', { ascending: false })
      .order('required_by_date', { ascending: true });

    const { data, error } = await query;

    if (error) throw error;
    return { success: true, data };
  } catch (error) {
    console.error('Error fetching requisition summary:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get full requisition details with line items
 */
export const getRequisitionDetails = async (requisitionId) => {
  try {
    // Get main requisition
    const { data: requisition, error: reqError } = await supabase
      .from('cmms_requisitions')
      .select('*')
      .eq('id', requisitionId)
      .single();

    if (reqError) throw reqError;

    // Get line items
    const { data: items, error: itemsError } = await supabase
      .from('cmms_requisition_items')
      .select('*')
      .eq('requisition_id', requisitionId);

    if (itemsError) throw itemsError;

    // Get approval history
    const { data: approvals, error: approvalsError } = await supabase
      .from('cmms_requisition_approvals')
      .select('*')
      .eq('requisition_id', requisitionId)
      .order('decided_at', { ascending: true });

    if (approvalsError) throw approvalsError;

    return {
      success: true,
      data: {
        requisition,
        items,
        approvals,
      }
    };
  } catch (error) {
    console.error('Error fetching requisition details:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Approve a requisition
 * This calls the database function approve_requisition()
 */
export const approveRequisition = async (
  requisitionId,
  decision, // 'approved' or 'rejected'
  comment = null
) => {
  try {
    const { error } = await supabase
      .rpc('approve_requisition', {
        p_requisition_id: requisitionId,
        p_decision: decision,
        p_comment: comment,
      });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error approving requisition:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Mark requisition as ordered
 */
export const markRequisitionOrdered = async (requisitionId, poNumber) => {
  try {
    const { data, error } = await supabase
      .from('cmms_requisitions')
      .update({
        status: 'ordered',
        order_placed_date: new Date().toISOString(),
        po_number: poNumber,
      })
      .eq('id', requisitionId)
      .select();

    if (error) throw error;
    return { success: true, data: data[0] };
  } catch (error) {
    console.error('Error marking requisition as ordered:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Receive requisition items
 * This calls the database function receive_requisition_items()
 */
export const receiveRequisitionItems = async (requisitionId, deliveryNotes = null) => {
  try {
    const { error } = await supabase
      .rpc('receive_requisition_items', {
        p_requisition_id: requisitionId,
        p_delivery_notes: deliveryNotes,
      });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error receiving requisition items:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Close requisition
 * This calls the database function close_requisition()
 */
export const closeRequisition = async (requisitionId, finalNotes = null) => {
  try {
    const { error } = await supabase
      .rpc('close_requisition', {
        p_requisition_id: requisitionId,
        p_final_notes: finalNotes,
      });

    if (error) throw error;
    return { success: true };
  } catch (error) {
    console.error('Error closing requisition:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================
// 5) REPORT FUNCTIONS
// ============================================================

/**
 * Get department budget summary
 */
export const getDepartmentBudgetSummary = async (departmentId) => {
  try {
    const { data: department, error: deptError } = await supabase
      .from('cmms_departments')
      .select('annual_budget, budget_used')
      .eq('id', departmentId)
      .single();

    if (deptError) throw deptError;

    const budgetAvailable = department.annual_budget - (department.budget_used || 0);
    const budgetPercentage = ((department.budget_used || 0) / department.annual_budget) * 100;

    return {
      success: true,
      data: {
        annual_budget: department.annual_budget,
        budget_used: department.budget_used,
        budget_available: budgetAvailable,
        budget_percentage: budgetPercentage,
      }
    };
  } catch (error) {
    console.error('Error fetching budget summary:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Get requisition statistics for department
 */
export const getRequisitionStats = async (departmentId) => {
  try {
    const { data, error } = await supabase
      .from('v_requisition_summary')
      .select('*')
      .eq('department_id', departmentId);

    if (error) throw error;

    const stats = {
      total: data.length,
      pending: data.filter(r => r.status.includes('pending')).length,
      approved: data.filter(r => r.status === 'approved').length,
      ordered: data.filter(r => r.status === 'ordered').length,
      delivered: data.filter(r => r.status === 'delivered').length,
      rejected: data.filter(r => r.status.includes('rejected')).length,
      urgent: data.filter(r => r.urgency_level === 'urgent').length,
      total_cost: data.reduce((sum, r) => sum + (r.total_estimated_cost || 0), 0),
    };

    return { success: true, data: stats };
  } catch (error) {
    console.error('Error fetching requisition stats:', error);
    return { success: false, error: error.message };
  }
};

// ============================================================
// 6) REACT COMPONENT EXAMPLES
// ============================================================

/**
 * Example: Department Selector Component
 */
export const DepartmentSelector = ({ companyId, onSelect }) => {
  const [departments, setDepartments] = React.useState([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const fetchDepartments = async () => {
      const result = await getDepartments(companyId);
      if (result.success) {
        setDepartments(result.data);
      }
      setLoading(false);
    };

    fetchDepartments();
  }, [companyId]);

  return (
    <div className="department-selector">
      <label>Select Department:</label>
      {loading ? (
        <p>Loading departments...</p>
      ) : (
        <select onChange={(e) => onSelect(e.target.value)}>
          <option value="">-- Choose Department --</option>
          {departments.map(dept => (
            <option key={dept.id} value={dept.id}>
              {dept.department_name} (Budget: ${dept.annual_budget})
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

/**
 * Example: Inventory Status Component
 */
export const InventoryStatus = ({ departmentId }) => {
  const [inventory, setInventory] = React.useState(null);

  React.useEffect(() => {
    const fetchInventory = async () => {
      const result = await getDepartmentInventory(departmentId);
      if (result.success) {
        setInventory(result.data);
      }
    };

    if (departmentId) {
      fetchInventory();
    }
  }, [departmentId]);

  if (!inventory) return <p>Loading...</p>;

  return (
    <div className="inventory-status">
      <h3>Inventory Status</h3>
      <div className="stats">
        <div className="stat">
          <span>In Stock:</span>
          <strong>{inventory.inStock.length}</strong>
        </div>
        <div className="stat">
          <span>Reorder Needed:</span>
          <strong className="warning">{inventory.reorderNeeded.length}</strong>
        </div>
        <div className="stat">
          <span>Out of Stock:</span>
          <strong className="error">{inventory.outOfStock.length}</strong>
        </div>
        <div className="stat">
          <span>Total Value:</span>
          <strong>${inventory.totalStockValue.toFixed(2)}</strong>
        </div>
      </div>

      <h4>Items Needing Reorder:</h4>
      <ul>
        {inventory.reorderNeeded.map(item => (
          <li key={item.id}>
            {item.item_name} - Stock: {item.quantity_in_stock}/{item.reorder_level}
          </li>
        ))}
      </ul>
    </div>
  );
};

/**
 * Example: Requisition Form Component
 */
export const Requisitionform = ({ departmentId }) => {
  const [purpose, setPurpose] = React.useState('');
  const [justification, setJustification] = React.useState('');
  const [urgency, setUrgency] = React.useState('normal');
  const [items, setItems] = React.useState([]);
  const [loading, setLoading] = React.useState(false);

  const handleAddItem = (item) => {
    setItems([...items, item]);
  };

  const handleSubmit = async () => {
    setLoading(true);
    const result = await submitRequisition(
      departmentId,
      purpose,
      justification,
      urgency,
      null,
      items
    );

    if (result.success) {
      alert(`Requisition submitted: ${result.requisitionId}`);
      // Reset form
      setPurpose('');
      setJustification('');
      setUrgency('normal');
      setItems([]);
    } else {
      alert(`Error: ${result.error}`);
    }
    setLoading(false);
  };

  return (
    <div className="requisition-form">
      <h3>Submit Requisition</h3>
      
      <div className="form-group">
        <label>Purpose:</label>
        <select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
          <option value="">-- Select Purpose --</option>
          <option value="maintenance">Maintenance</option>
          <option value="repair">Repair</option>
          <option value="preventive">Preventive</option>
          <option value="consumable_replenishment">Replenishment</option>
          <option value="emergency">Emergency</option>
        </select>
      </div>

      <div className="form-group">
        <label>Justification:</label>
        <textarea 
          value={justification} 
          onChange={(e) => setJustification(e.target.value)}
          placeholder="Explain why these items are needed..."
        />
      </div>

      <div className="form-group">
        <label>Urgency:</label>
        <select value={urgency} onChange={(e) => setUrgency(e.target.value)}>
          <option value="low">Low</option>
          <option value="normal">Normal</option>
          <option value="urgent">Urgent</option>
        </select>
      </div>

      <div className="form-group">
        <h4>Items ({items.length})</h4>
        {items.map((item, idx) => (
          <div key={idx} className="item-row">
            {item.item_name} - {item.requested_quantity} x ${item.unit_price}
          </div>
        ))}
        <button onClick={() => {/* Open item selector */}}>+ Add Item</button>
      </div>

      <button 
        onClick={handleSubmit} 
        disabled={loading || !purpose || items.length === 0}
      >
        {loading ? 'Submitting...' : 'Submit Requisition'}
      </button>
    </div>
  );
};

/**
 * Example: Requisition Approval Component
 */
export const RequisitionApproval = ({ requisitionId }) => {
  const [req, setReq] = React.useState(null);
  const [comment, setComment] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const fetchDetails = async () => {
      const result = await getRequisitionDetails(requisitionId);
      if (result.success) {
        setReq(result.data);
      }
    };

    if (requisitionId) {
      fetchDetails();
    }
  }, [requisitionId]);

  const handleApprove = async () => {
    setLoading(true);
    const result = await approveRequisition(requisitionId, 'approved', comment);
    if (result.success) {
      alert('Requisition approved!');
      // Refresh or navigate
    } else {
      alert(`Error: ${result.error}`);
    }
    setLoading(false);
  };

  const handleReject = async () => {
    setLoading(true);
    const result = await approveRequisition(requisitionId, 'rejected', comment);
    if (result.success) {
      alert('Requisition rejected.');
    } else {
      alert(`Error: ${result.error}`);
    }
    setLoading(false);
  };

  if (!req) return <p>Loading...</p>;

  return (
    <div className="requisition-approval">
      <h3>Requisition: {req.requisition.requisition_number}</h3>
      
      <div className="details">
        <p><strong>Requested By:</strong> {req.requisition.requested_by_name}</p>
        <p><strong>Purpose:</strong> {req.requisition.purpose}</p>
        <p><strong>Justification:</strong> {req.requisition.justification}</p>
        <p><strong>Urgency:</strong> <span className={`urgency-${req.requisition.urgency_level}`}>
          {req.requisition.urgency_level}
        </span></p>
        <p><strong>Total Cost:</strong> ${req.requisition.total_estimated_cost}</p>
        <p><strong>Budget Available:</strong> ${req.requisition.budget_available}</p>
      </div>

      <h4>Items:</h4>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Quantity</th>
            <th>Unit Price</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {req.items.map(item => (
            <tr key={item.id}>
              <td>{item.item_name}</td>
              <td>{item.requested_quantity} {item.unit_of_measure}</td>
              <td>${item.unit_price}</td>
              <td>${item.line_total}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="form-group">
        <label>Approval Comment:</label>
        <textarea 
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Add your approval/rejection comment..."
        />
      </div>

      <div className="buttons">
        <button 
          onClick={handleApprove}
          disabled={loading}
          className="btn-approve"
        >
          {loading ? 'Processing...' : 'Approve'}
        </button>
        <button 
          onClick={handleReject}
          disabled={loading}
          className="btn-reject"
        >
          {loading ? 'Processing...' : 'Reject'}
        </button>
      </div>
    </div>
  );
};

// ============================================================
// EXPORT ALL FUNCTIONS
// ============================================================

export default {
  // Department functions
  createDepartment,
  getDepartments,
  assignUserToDepartment,
  getDepartmentStaff,

  // Inventory functions
  createInventoryItem,
  getDepartmentInventory,
  updateInventoryQuantity,

  // Requisition functions
  submitRequisition,
  exampleSubmitRequisition,
  getRequisitionSummary,
  getRequisitionDetails,
  approveRequisition,
  markRequisitionOrdered,
  receiveRequisitionItems,
  closeRequisition,

  // Report functions
  getDepartmentBudgetSummary,
  getRequisitionStats,

  // Components
  DepartmentSelector,
  InventoryStatus,
  RequisitionForm: Requisitionform,
  RequisitionApproval,
};
