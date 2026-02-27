/**
 * RequisitionForm Component
 * Handles creation of new maintenance requisitions
 * Used by: Technicians, Supervisors, Coordinators
 */

import React, { useState, useRef } from 'react';
import { Plus, ChevronDown } from 'lucide-react';

const RequisitionForm = ({ 
  onSubmit, 
  isSubmitting = false,
  companyId,
  userId,
  userRole 
}) => {
  const [newRequisition, setNewRequisition] = useState({
    title: '',
    description: '',
    equipmentId: '',
    estimatedCost: 0,
    priority: 'normal',
    estimatedDays: 1,
    requiredByDate: '',
    items: []
  });

  const [selectedEquipment, setSelectedEquipment] = useState('');
  const [itemQuantity, setItemQuantity] = useState(1);
  const [itemCost, setItemCost] = useState(0);

  const handleAddItem = () => {
    if (!selectedEquipment || itemQuantity <= 0 || itemCost <= 0) {
      alert('⚠️ Please select equipment, set quantity and cost');
      return;
    }

    const newItem = {
      id: Date.now(),
      equipment: selectedEquipment,
      quantity: itemQuantity,
      costPerUnit: itemCost,
      totalCost: itemQuantity * itemCost
    };

    const updatedItems = [...newRequisition.items, newItem];
    const totalCost = updatedItems.reduce((sum, item) => sum + item.totalCost, 0);

    setNewRequisition(prev => ({
      ...prev,
      items: updatedItems,
      estimatedCost: totalCost
    }));

    setSelectedEquipment('');
    setItemQuantity(1);
    setItemCost(0);
  };

  const handleRemoveItem = (itemId) => {
    const updatedItems = newRequisition.items.filter(item => item.id !== itemId);
    const totalCost = updatedItems.reduce((sum, item) => sum + item.totalCost, 0);

    setNewRequisition(prev => ({
      ...prev,
      items: updatedItems,
      estimatedCost: totalCost
    }));
  };

  const handleSubmit = async () => {
    if (!newRequisition.title || !newRequisition.description) {
      alert('⚠️ Please fill in the Title and Description fields');
      return;
    }

    if (newRequisition.items.length === 0) {
      alert('⚠️ Please add at least one item to service or purchase');
      return;
    }

    if (newRequisition.estimatedCost <= 0) {
      alert('⚠️ Total cost must be greater than 0');
      return;
    }

    await onSubmit({
      ...newRequisition,
      companyId,
      userId,
      userRole
    });

    // Reset form
    setNewRequisition({
      title: '',
      description: '',
      equipmentId: '',
      estimatedCost: 0,
      priority: 'normal',
      estimatedDays: 1,
      requiredByDate: '',
      items: []
    });
    setSelectedEquipment('');
    setItemQuantity(1);
    setItemCost(0);
  };

  return (
    <div className="glass-card p-6 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 border border-blue-500/20">
      <h3 className="text-xl font-bold text-white mb-2 flex items-center gap-2">
        <Plus className="w-6 h-6 text-blue-400" />
        Create Maintenance Requisition
      </h3>
      <p className="text-gray-400 text-sm mb-4">Submit a new maintenance request for approval</p>

      <div className="grid md:grid-cols-2 gap-4 mb-4">
        {/* Title */}
        <div>
          <label className="text-xs font-semibold text-gray-300 uppercase">Requisition Title *</label>
          <input
            type="text"
            placeholder="e.g., Emergency AC Repair, Pump Replacement"
            value={newRequisition.title}
            onChange={(e) => setNewRequisition({...newRequisition, title: e.target.value})}
            className="w-full px-3 py-2 mt-1 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 focus:bg-opacity-20 transition-all"
          />
        </div>

        {/* Priority */}
        <div>
          <label className="text-xs font-semibold text-gray-300 uppercase">Priority Level</label>
          <select
            value={newRequisition.priority}
            onChange={(e) => setNewRequisition({...newRequisition, priority: e.target.value})}
            className="w-full px-3 py-2 mt-1 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white focus:border-blue-400 transition-all"
          >
            <option value="low">🟢 Low - Routine maintenance</option>
            <option value="normal">🟡 Normal - Standard request</option>
            <option value="urgent">🔴 Urgent - ASAP needed</option>
            <option value="emergency">🚨 Emergency - Critical issue</option>
          </select>
        </div>

        {/* Description */}
        <div className="md:col-span-2">
          <label className="text-xs font-semibold text-gray-300 uppercase">Work Description *</label>
          <textarea
            placeholder="Detailed description of work needed, equipment affected, expected outcome..."
            value={newRequisition.description}
            onChange={(e) => setNewRequisition({...newRequisition, description: e.target.value})}
            className="w-full px-3 py-2 mt-1 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 focus:bg-opacity-20 transition-all min-h-24"
          />
        </div>

        {/* Items Section */}
        <div className="md:col-span-2">
          <label className="text-xs font-semibold text-gray-300 uppercase mb-3 block">🔧 Equipment/Items to Service or Purchase</label>

          <div className="grid md:grid-cols-4 gap-2 mb-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Equipment/Item *</label>
              <input
                type="text"
                placeholder="e.g., AC Compressor, Oil, Bearings"
                value={selectedEquipment}
                onChange={(e) => setSelectedEquipment(e.target.value)}
                className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 transition-all text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Qty *</label>
              <input
                type="number"
                placeholder="1"
                min="1"
                value={itemQuantity}
                onChange={(e) => setItemQuantity(parseInt(e.target.value) || 1)}
                className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 transition-all text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Cost/Unit (UGX) *</label>
              <input
                type="number"
                placeholder="0"
                min="0"
                value={itemCost}
                onChange={(e) => setItemCost(parseFloat(e.target.value) || 0)}
                className="w-full px-3 py-2 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white placeholder-gray-400 focus:border-blue-400 transition-all text-sm"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={handleAddItem}
                className="w-full px-3 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-lg font-bold hover:from-green-600 hover:to-green-700 transition-all text-sm"
              >
                ➕ Add Item
              </button>
            </div>
          </div>

          {/* Items List */}
          {newRequisition.items.length > 0 && (
            <div className="mb-3 p-3 bg-white bg-opacity-5 border border-white border-opacity-10 rounded-lg">
              <h4 className="text-xs font-semibold text-gray-300 uppercase mb-2">📋 Items to Service/Purchase ({newRequisition.items.length}):</h4>
              <div className="space-y-2">
                {newRequisition.items.map((item) => (
                  <div key={item.id} className="flex justify-between items-center p-2 bg-white bg-opacity-5 rounded border border-white border-opacity-10">
                    <div className="flex-1">
                      <span className="text-white font-medium">{item.equipment}</span>
                      <span className="text-gray-400 text-xs ml-2">× {item.quantity} @ UGX {item.costPerUnit.toLocaleString()} each</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400 font-bold">UGX {item.totalCost.toLocaleString()}</span>
                      <button
                        onClick={() => handleRemoveItem(item.id)}
                        className="px-2 py-1 text-xs bg-red-500/20 border border-red-400 text-red-300 rounded hover:bg-red-500/40 transition-all"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Estimated Cost */}
        <div>
          <label className="text-xs font-semibold text-gray-300 uppercase">Estimated Cost (UGX) - Auto Calculated</label>
          <div className="mt-1">
            <input
              type="number"
              placeholder="0"
              value={newRequisition.estimatedCost}
              disabled
              className="w-full px-3 py-2 bg-white bg-opacity-5 border border-white border-opacity-20 rounded-lg text-amber-300 placeholder-gray-400 transition-all cursor-not-allowed"
            />
            {newRequisition.estimatedCost > 0 && (
              <div className="mt-2 p-3 bg-amber-500/20 border border-amber-400 rounded text-amber-300 text-sm font-semibold">
                💰 Total: UGX {newRequisition.estimatedCost.toLocaleString()}
              </div>
            )}
          </div>
        </div>

        {/* Required By Date */}
        <div>
          <label className="text-xs font-semibold text-gray-300 uppercase">Required By Date</label>
          <input
            type="date"
            value={newRequisition.requiredByDate}
            onChange={(e) => setNewRequisition({...newRequisition, requiredByDate: e.target.value})}
            className="w-full px-3 py-2 mt-1 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg text-white focus:border-blue-400 transition-all"
          />
        </div>
      </div>

      {/* Cost Summary */}
      <div className="mb-4 p-4 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-400/50 rounded-lg">
        <div className="flex justify-between items-center mb-2">
          <span className="text-gray-300 font-semibold">📋 Requisition Summary:</span>
          <span className="text-xs text-gray-400">Before you submit</span>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-400">Title:</span>
            <span className="text-white font-semibold">{newRequisition.title || '(Not set)'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Priority:</span>
            <span className="text-white font-semibold capitalize">{newRequisition.priority}</span>
          </div>

          {newRequisition.items.length > 0 && (
            <div className="border-t border-white/20 pt-2 mt-2">
              <span className="text-gray-300 font-semibold block mb-1">📦 Items: ({newRequisition.items.length})</span>
              <div className="space-y-1 ml-2">
                {newRequisition.items.map((item) => (
                  <div key={item.id} className="text-gray-300 text-xs">
                    • {item.equipment} × {item.quantity} = UGX {item.totalCost.toLocaleString()}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-between pt-2 border-t border-white/20">
            <span className="text-amber-300 font-bold">💰 Total Cost Requested:</span>
            <span className="text-amber-300 font-bold text-lg">UGX {newRequisition.estimatedCost.toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Submit Button */}
      <button
        onClick={handleSubmit}
        disabled={isSubmitting}
        className="w-full px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-bold hover:from-blue-600 hover:to-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {isSubmitting ? '⏳ Submitting...' : '📝 Submit Requisition for Approval'}
      </button>
    </div>
  );
};

export default RequisitionForm;
