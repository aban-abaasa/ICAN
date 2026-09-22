import React, { useEffect, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
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
      <div className="bg-slate-900 border border-slate-800 rounded-lg shadow-sm p-4">
        <div className="h-4 w-24 bg-slate-800 rounded animate-pulse" />
      </div>
    );
  }

  return (
    // Classic teal -- trade & commerce, distinct from CMMS's indigo, the
    // share-trend card's burgundy, and the ledger's navy. Same flat
    // dark-panel system as the rest of the dashboard's stat cards.
    //
    // Every section here is its OWN independent bordered container --
    // header, storefront/tab picker, and (inside DropshipResellerDashboard)
    // the storefront card / tabs / listing rows -- siblings stacked with
    // spacing, not nested inside one shared outer box. That's what let the
    // "My listings" row overflow before: everything crammed inside a
    // single wrapper instead of standing on its own.
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-slate-800 bg-slate-900 shadow-sm">
        <ShoppingBag className="w-4 h-4 text-teal-400" />
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Dropship</p>
      </div>

      {profiles.length === 0 ? (
        <div className="rounded-lg border border-slate-800 bg-slate-900 shadow-sm p-4 space-y-3">
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
                    className="px-4 py-2 rounded-md bg-teal-700 hover:bg-teal-600 active:scale-95 text-white text-sm font-semibold disabled:opacity-40 whitespace-nowrap transition"
                  >
                    {creating ? 'Creating…' : 'Start'}
                  </button>
                </div>
                {createError && <p className="text-xs text-red-400 px-1">{createError}</p>}
              </div>
            ) : (
              <button
                onClick={() => setShowStartForm(true)}
                className="w-full text-xs text-teal-400 hover:text-teal-300 font-medium px-1 py-1 text-left"
              >
                Want to resell these products yourself? Start a free dropshipping business →
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {profiles.length > 1 && (
            <select
              value={activeId || ''}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white shadow-sm"
            >
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.business_name}</option>)}
            </select>
          )}
          <DropshipResellerDashboard businessProfileId={activeId} />
        </div>
      )}
    </div>
  );
};

export default DropshipDashboardWidget;
