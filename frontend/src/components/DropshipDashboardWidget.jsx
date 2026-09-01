import React, { useEffect, useState } from 'react';
import { getAllAccessibleBusinessProfiles } from '../services/pitchingService';
import { createBusinessProfileFromCategory } from '../services/businessManagementService';
import DropshipResellerDashboard from './DropshipResellerDashboard';
import DropshipBrowse from './DropshipBrowse';

// Standalone "Dropship" section for the main dashboard (not the wallet).
// A user with no Dropshipping business profile is just a shopper here --
// they get the cross-reseller product browse (DropshipBrowse) plus a small
// "become a reseller" CTA underneath, not a hard gate behind creating a
// business first. A user who already has one gets their own reseller
// dashboard, same as before.
const DropshipDashboardWidget = ({ userId, userEmail }) => {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  const [showStartForm, setShowStartForm] = useState(false);

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
        <div className="space-y-3">
          <DropshipBrowse />

          <div className="border-t border-slate-800 pt-3">
            {showStartForm ? (
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
              <button
                onClick={() => setShowStartForm(true)}
                className="w-full text-xs text-cyan-400 hover:text-cyan-300 font-medium px-1 py-1 text-left"
              >
                Want to resell these products yourself? Start a free dropshipping business →
              </button>
            )}
          </div>
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
