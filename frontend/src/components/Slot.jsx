/**
 * Slot Component
 * Admin dashboard for group creators to manage their TRUST groups
 * Features: Review applications, manage members, view voting, statistics
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  ArrowLeft,
  Settings,
  Users,
  Clock,
  CheckCircle,
  TrendingUp,
  AlertCircle,
  Loader
} from 'lucide-react';
import AdminApplicationPanel from './AdminApplicationPanel';
import {
  getUserTrustGroups,
  getGroupVotingStats
} from '../services/trustService';

const Slot = ({ onClose }) => {
  const { user } = useAuth();
  const [myGroups, setMyGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [stats, setStats] = useState({});
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    loadMyGroups();
  }, [user?.id]);

  const loadMyGroups = async () => {
    if (!user?.id) return;
    
    setLoading(true);
    try {
      const groups = await getUserTrustGroups(user.id);
      // Filter to only groups where user is the creator (admin)
      const createdGroups = (groups || []).filter(g => g.creator_id === user.id);
      setMyGroups(createdGroups);

      // Load stats for each group
      const statsMap = {};
      for (const group of createdGroups) {
        const groupStats = await getGroupVotingStats(group.id);
        statsMap[group.id] = groupStats;
      }
      setStats(statsMap);
    } catch (error) {
      console.error('Error loading groups:', error);
      setMessage({ type: 'error', text: 'Failed to load groups' });
    } finally {
      setLoading(false);
    }
  };

  // If a group is selected, show admin panel
  if (selectedGroup) {
    return (
      <AdminApplicationPanel
        groupId={selectedGroup.id}
        onClose={() => setSelectedGroup(null)}
      />
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
        <div className="text-center py-12">
          <Loader className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
          <p className="text-gray-400">Loading your groups...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={onClose}
          className="p-2 hover:bg-white/10 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-6 h-6 text-white" />
        </button>
        <div>
          <h1 className="text-3xl font-bold text-white">Admin Dashboard</h1>
          <p className="text-gray-400">Manage your TRUST groups and applications</p>
        </div>
      </div>

      {/* Message */}
      {message.text && (
        <div
          className={`mb-6 p-4 rounded-lg ${
            message.type === 'success'
              ? 'bg-emerald-500/20 text-emerald-400'
              : 'bg-red-500/20 text-red-400'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Info Card */}
      <div className="mb-8 bg-blue-500/20 border border-blue-400/30 p-4 rounded-lg">
        <div className="flex items-start gap-3">
          <Settings className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-blue-300">
            <strong className="text-blue-200">Admin Features:</strong> Review membership applications, 
            manage group settings, monitor member voting, and control group status.
          </div>
        </div>
      </div>

      {/* Groups List */}
      <div className="max-w-5xl mx-auto">
        {myGroups.length === 0 ? (
          <div className="text-center py-12 bg-slate-800/50 border border-slate-700 rounded-lg">
            <Users className="w-12 h-12 text-gray-500 mx-auto mb-4" />
            <p className="text-gray-400 mb-4">You haven't created any groups yet</p>
            <p className="text-sm text-gray-500">Create a group in TRUST System to start managing applications</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {myGroups.map((group) => {
              const groupStats = stats[group.id];

              return (
                <div
                  key={group.id}
                  className="bg-slate-800/50 border border-slate-700 rounded-lg p-6 hover:border-blue-400 transition-all cursor-pointer"
                  onClick={() => setSelectedGroup(group)}
                >
                  {/* Group Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-white">{group.name}</h3>
                      <p className="text-sm text-gray-400">{group.description}</p>
                    </div>
                    <div className="p-2 bg-blue-500/20 rounded-lg">
                      <Settings className="w-5 h-5 text-blue-400" />
                    </div>
                  </div>

                  {/* Group Info */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="bg-slate-700/50 rounded p-3">
                      <div className="text-xs text-gray-400">Members</div>
                      <div className="text-lg font-bold text-white">
                        {group.member_count || 0}/{group.max_members}
                      </div>
                    </div>
                    <div className="bg-slate-700/50 rounded p-3">
                      <div className="text-xs text-gray-400">Monthly</div>
                      <div className="text-lg font-bold text-white">${group.monthly_contribution}</div>
                    </div>
                  </div>

                  {/* Application Stats */}
                  {groupStats && (
                    <div className="grid grid-cols-4 gap-2 mb-4">
                      {groupStats.pending > 0 && (
                        <div className="bg-yellow-500/20 rounded p-2 text-center">
                          <div className="text-xs text-yellow-400">Pending</div>
                          <div className="text-lg font-bold text-yellow-300">
                            {groupStats.pending}
                          </div>
                        </div>
                      )}
                      {groupStats.voting > 0 && (
                        <div className="bg-purple-500/20 rounded p-2 text-center">
                          <div className="text-xs text-purple-400">Voting</div>
                          <div className="text-lg font-bold text-purple-300">
                            {groupStats.voting}
                          </div>
                        </div>
                      )}
                      {groupStats.approved > 0 && (
                        <div className="bg-green-500/20 rounded p-2 text-center">
                          <div className="text-xs text-green-400">Approved</div>
                          <div className="text-lg font-bold text-green-300">
                            {groupStats.approved}
                          </div>
                        </div>
                      )}
                      {groupStats.rejected > 0 && (
                        <div className="bg-red-500/20 rounded p-2 text-center">
                          <div className="text-xs text-red-400">Rejected</div>
                          <div className="text-lg font-bold text-red-300">
                            {groupStats.rejected}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Status */}
                  <div className="flex items-center justify-between pt-4 border-t border-slate-700">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-green-500" />
                      <span className="text-sm text-gray-300 capitalize">{group.status}</span>
                    </div>
                    <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors">
                      Manage
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Slot;
