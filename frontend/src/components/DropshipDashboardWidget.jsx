import React, { useEffect, useState } from 'react';
import { getAllAccessibleBusinessProfiles } from '../services/pitchingService';
import { createBusinessProfileFromCategory } from '../services/businessManagementService';
import DropshipResellerDashboard from './DropshipResellerDashboard';

// Standalone "Dropship" section for the main dashboard (not the wallet):
// finds the user's Dropshipping business profile (creating one on the spot
// if they don't have one yet) and renders the reseller dashboard inline.
// Self-contained: just needs the signed-in user's id/email.
const DropshipDashboardWidget = ({ userId, userEmail }) => {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const loadProfiles = async () => {
    if (!userId) { setLoading(false); return; }
    setLoading(true);
    const all = await getAllAccessibleBusinessProfiles(userId, userEmail);
    setProfiles((all || []).filter((p) => String(p.business_type || '').toLowerCase().includes('dropship')));
    setLoading(false);
  };

  useEffect(() => { loadProfiles(); }, [userId, userEmail]);

  const activeId = selectedId || profiles[0]?.id || null;

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    setCreateError(null);
    const result = await createBusinessProfileFromCategory({
      businessName: newName.trim(),
      categoryKey: 'dropshipping',
      businessType: 'Dropshipping / Reseller',
      sourceApp: 'ican',
    });
    setCreating(false);
    if (!result.success) {
      setCreateError(result.error || 'Could not create your dropshipping business.');
      return;
    }
    setNewName('');
    setSelectedId(result.data);
    loadProfiles();
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-700/50 bg-slate-900/40 p-4">
        <div className="h-4 w-24 bg-slate-800 rounded animate-pulse" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-cyan-500/20 bg-slate-900/40 p-3">
      <div className="flex items-center gap-2 mb-3 px-1">
        <span className="text-lg">🛍️</span>
        <p className="text-sm font-semibold text-white">Dropship</p>
      </div>

      {profiles.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-400 px-1">Resell any store's products at your own price. Free to start.</p>
          <div className="flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Your dropshipping business name"
              className="flex-1 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500"
            />
            <button
              onClick={handleCreate}
              disabled={!newName.trim() || creating}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-600 to-teal-600 text-white text-sm font-semibold disabled:opacity-40 whitespace-nowrap"
            >
              {creating ? 'Creating…' : 'Start'}
            </button>
          </div>
          {createError && <p className="text-xs text-red-400 px-1">{createError}</p>}
        </div>
      ) : (
        <>
          {profiles.length > 1 && (
            <select
              value={activeId || ''}
              onChange={(e) => setSelectedId(e.target.value)}
              className="mb-3 bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.business_name}</option>)}
            </select>
          )}
          <DropshipResellerDashboard businessProfileId={activeId} />
        </>
      )}
    </div>
  );
};

export default DropshipDashboardWidget;
