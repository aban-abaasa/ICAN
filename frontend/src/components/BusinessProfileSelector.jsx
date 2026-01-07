import React, { useState } from 'react';
import { Building2, Users, Plus, X, Check, Edit2, Lock, Crown, UserCheck } from 'lucide-react';

const BusinessProfileSelector = ({ profiles, currentProfile, onSelectProfile, onCreateNew, onEdit, onDelete, currentUserId }) => {
  const [showForm, setShowForm] = useState(false);

  // Helper to check if user is the creator
  const isCreator = (profile) => profile.user_id === currentUserId;
  
  // Helper to check if user is the largest shareholder
  const isLargestShareholder = (profile, userEmail) => {
    const coOwners = profile.business_co_owners || profile.coOwners || [];
    if (coOwners.length === 0) return false;
    
    const maxShare = Math.max(...coOwners.map(co => co.ownership_share || co.ownershipShare || 0));
    const userOwner = coOwners.find(co => (co.owner_email || co.email) === userEmail);
    
    return userOwner && (userOwner.ownership_share || userOwner.ownershipShare) === maxShare;
  };
  
  // Helper to check if user can edit
  const canEdit = (profile) => {
    return isCreator(profile) || profile.isCoOwned === false;
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-700">
        {/* Header */}
        <div className="sticky top-0 bg-slate-900 border-b border-slate-700 p-6 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-white flex items-center gap-3">
            <Building2 className="w-6 h-6 text-blue-400" />
            Business Profiles
          </h2>
          <button
            onClick={onCreateNew}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition flex items-center gap-2 font-semibold"
          >
            <Plus className="w-5 h-5" />
            New Profile
          </button>
        </div>

        <div className="p-6">
          {profiles && profiles.length > 0 ? (
            <div className="space-y-4">
              {profiles.map((profile) => (
                <div
                  key={profile.id}
                  onClick={() => onSelectProfile(profile)}
                  className={`p-6 rounded-lg border-2 cursor-pointer transition ${
                    currentProfile?.id === profile.id
                      ? 'bg-blue-900/30 border-blue-500 shadow-lg shadow-blue-500/20'
                      : 'bg-slate-700/50 border-slate-600 hover:bg-slate-700 hover:border-slate-500'
                  }`}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-xl font-bold text-white">{profile.business_name || profile.businessName}</h3>
                        {currentProfile?.id === profile.id && (
                          <Check className="w-5 h-5 text-green-400" />
                        )}
                        {/* Show ownership status badge */}
                        {isCreator(profile) ? (
                          <span className="bg-yellow-600/30 text-yellow-400 px-2 py-0.5 rounded text-xs flex items-center gap-1">
                            <Crown className="w-3 h-3" /> Creator
                          </span>
                        ) : profile.isCoOwned && (
                          <span className="bg-purple-600/30 text-purple-400 px-2 py-0.5 rounded text-xs flex items-center gap-1">
                            <UserCheck className="w-3 h-3" /> Co-Owner
                          </span>
                        )}
                      </div>
                      <p className="text-slate-400 text-sm">{profile.business_type || profile.businessType}</p>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit?.(profile);
                      }}
                      className="text-blue-400 hover:text-blue-300 transition p-2"
                      title={isCreator(profile) ? "Edit profile" : "Request edit permission"}
                    >
                      {isCreator(profile) ? (
                        <Edit2 className="w-5 h-5" />
                      ) : (
                        <Lock className="w-5 h-5" />
                      )}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                    <div>
                      <p className="text-slate-400">Founded</p>
                      <p className="text-white font-semibold">{profile.founded_year || profile.foundedYear || 'N/A'}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Total Capital</p>
                      <p className="text-white font-semibold">${profile.total_capital || profile.totalCapital || 'N/A'}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-slate-400 text-sm mb-2 flex items-center gap-2">
                      <Users className="w-4 h-4" />
                      Co-Owners ({(profile.business_co_owners || profile.coOwners)?.length || 0})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(profile.business_co_owners || profile.coOwners)?.slice(0, 3).map((owner, idx) => (
                        <div key={idx} className="bg-slate-800 px-3 py-1 rounded-full text-xs">
                          <span className="text-slate-300">{owner.owner_name || owner.name}</span>
                          <span className="text-blue-400 ml-1 font-semibold">{owner.ownership_share || owner.ownershipShare}%</span>
                        </div>
                      ))}
                      {(profile.business_co_owners || profile.coOwners)?.length > 3 && (
                        <div className="bg-slate-800 px-3 py-1 rounded-full text-xs text-slate-400">
                          +{(profile.business_co_owners || profile.coOwners).length - 3} more
                        </div>
                      )}
                    </div>
                  </div>

                  {profile.website && (
                    <p className="text-blue-400 text-xs mt-3 truncate">🔗 {profile.website}</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Building2 className="w-16 h-16 text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400 text-lg mb-4">No business profiles yet</p>
              <button
                onClick={onCreateNew}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition flex items-center gap-2 font-semibold mx-auto"
              >
                <Plus className="w-5 h-5" />
                Create Your First Profile
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BusinessProfileSelector;
