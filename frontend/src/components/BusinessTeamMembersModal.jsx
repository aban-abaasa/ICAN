import React, { useState, useEffect } from 'react';
import { X, Search, Loader, CheckCircle2, Trash2, Users, UserPlus } from 'lucide-react';
import { searchICANUsers, getBusinessTeamMembers, addBusinessTeamMember, removeBusinessTeamMember } from '../services/pitchingService';

// Lets a business owner grant an existing ICAN account access to record
// transactions for this business (no equity/ownership involved — that's
// handled separately by the shareholder/co-owner flow).
const BusinessTeamMembersModal = ({ profile, onClose }) => {
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  const loadMembers = async () => {
    setLoadingMembers(true);
    const data = await getBusinessTeamMembers(profile.id);
    setMembers(data);
    setLoadingMembers(false);
  };

  const handleSearch = async (value) => {
    setQuery(value);
    setError('');
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    const found = await searchICANUsers(value.trim());
    // Don't show people who already have access
    setResults(found.filter(u => !members.some(m => m.user_id === u.id)));
    setSearching(false);
  };

  const handleAdd = async (user) => {
    setAdding(true);
    setError('');
    const result = await addBusinessTeamMember(profile.id, user);
    setAdding(false);
    if (result.success) {
      setQuery('');
      setResults([]);
      loadMembers();
    } else {
      setError(result.error || 'Failed to add team member');
    }
  };

  const handleRemove = async (member) => {
    if (!window.confirm(`Remove ${member.member_name} from ${profile.business_name}?`)) return;
    const result = await removeBusinessTeamMember(member.id);
    if (result.success) {
      setMembers(prev => prev.filter(m => m.id !== member.id));
    } else {
      alert(`Failed to remove: ${result.error}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-lg w-full p-6 shadow-2xl max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-blue-400" />
            <h3 className="text-xl font-bold text-white">Team Members</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-slate-400 text-sm mb-4">
          Give an existing ICAN account access to record transactions for{' '}
          <span className="text-white font-semibold">{profile.business_name}</span>. This does not grant
          ownership or equity.
        </p>

        {/* Search & add */}
        <div className="relative mb-2">
          <div className="flex items-center gap-2 bg-slate-800 rounded px-3 py-2 border border-slate-600 focus-within:border-blue-500">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
              onBlur={() => setTimeout(() => setResults([]), 300)}
              placeholder="Search by name or email..."
              className="flex-1 bg-transparent text-white outline-none placeholder-slate-400"
              autoComplete="off"
              disabled={adding}
            />
            {searching && <Loader className="w-4 h-4 text-blue-400 animate-spin" />}
          </div>

          {results.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-blue-500 rounded shadow-lg z-20 max-h-48 overflow-y-auto">
              {results.map(user => (
                <button
                  key={user.id || user.email}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleAdd(user)}
                  disabled={adding}
                  className="w-full text-left px-3 py-2 hover:bg-blue-600/30 text-white border-b border-slate-700 last:border-b-0 transition flex items-center justify-between disabled:opacity-50"
                >
                  <div>
                    <p className="font-medium">{user.name}</p>
                    <p className="text-xs text-slate-400">{user.email}</p>
                  </div>
                  <UserPlus className="w-4 h-4 text-green-400 flex-shrink-0" />
                </button>
              ))}
            </div>
          )}

          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-orange-500 rounded shadow-lg z-20 p-3">
              <p className="text-orange-300 text-sm">No ICAN account found matching "{query}"</p>
              <p className="text-slate-400 text-xs mt-1">They must sign up for ICAN first.</p>
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        {/* Current members */}
        <div className="mt-5 pt-4 border-t border-slate-700">
          <p className="text-slate-400 text-xs font-semibold mb-3">HAS TRANSACTION ACCESS</p>
          {loadingMembers ? (
            <p className="text-slate-500 text-sm">Loading...</p>
          ) : members.length === 0 ? (
            <p className="text-slate-500 text-sm">No team members yet. Search above to add one.</p>
          ) : (
            <div className="space-y-2">
              {members.map(member => (
                <div key={member.id} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
                    <div>
                      <p className="text-white text-sm font-medium">{member.member_name}</p>
                      <p className="text-slate-500 text-xs">{member.member_email}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemove(member)}
                    className="text-red-400 hover:text-red-300 transition"
                    title="Remove access"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BusinessTeamMembersModal;
