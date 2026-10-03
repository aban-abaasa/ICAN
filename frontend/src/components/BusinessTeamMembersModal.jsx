import React, { useState, useEffect } from 'react';
import { X, Search, Loader, CheckCircle2, Trash2, Users, UserPlus, Lock, Building2 } from 'lucide-react';
import {
  searchICANUsers, getBusinessTeamMembers, addBusinessTeamMember, removeBusinessTeamMember,
  getCmmsStaffForBusiness, assignCmmsStaffAsHelper
} from '../services/pitchingService';

// Lets a business owner assign an existing ICAN account as a helper who enters
// data on behalf of this business (no equity/ownership involved — that's
// handled separately by the shareholder/co-owner flow). Whatever a helper records
// is permanent: the database refuses to delete it (MANUAL_TRANSACTION_HELPERS.sql),
// and only the owner can archive it.
const BusinessTeamMembersModal = ({ profile, onClose, title = 'Team Members', includeCmms = false }) => {
  const [members, setMembers] = useState([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState([]);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [cmmsStaff, setCmmsStaff] = useState([]);
  const [cmmsCompanies, setCmmsCompanies] = useState([]);
  const [cmmsLoading, setCmmsLoading] = useState(includeCmms);
  const [cmmsError, setCmmsError] = useState('');
  const [assigningEmail, setAssigningEmail] = useState('');

  useEffect(() => {
    loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.id]);

  // CMMS people who work for this business — one tap to make them a helper.
  useEffect(() => {
    if (!includeCmms) return;
    let cancelled = false;
    (async () => {
      setCmmsLoading(true);
      const { staff, companies, error: loadError } = await getCmmsStaffForBusiness(profile.id);
      if (cancelled) return;
      setCmmsStaff(staff);
      setCmmsCompanies(companies);
      setCmmsError(loadError || '');
      setCmmsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [includeCmms, profile.id]);

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

  const handleAssignCmms = async (person) => {
    setAssigningEmail(person.email);
    setError('');
    const result = await assignCmmsStaffAsHelper(profile.id, person);
    setAssigningEmail('');
    if (result.success) {
      loadMembers();
    } else {
      setError(result.error || 'Failed to assign helper');
    }
  };

  const handleRemove = async (member) => {
    if (!window.confirm(`Remove ${member.member_name} from ${profile.business_name}? Entries they already recorded stay in the books and still can't be deleted.`)) return;
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
            <h3 className="text-xl font-bold text-white">{title}</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-slate-400 text-sm mb-4">
          Assign an existing IcanEra account to enter data on behalf of{' '}
          <span className="text-white font-semibold">{profile.business_name}</span>. This does not grant
          ownership or equity.
        </p>
        <p className="text-amber-300/90 text-xs mb-4 flex items-start gap-1.5">
          <Lock className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>
            Everything a helper records is permanent. It can't be deleted — not by the helper, not by you —
            only archived by you to save space. It keeps counting toward your share value.
          </span>
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
              <p className="text-orange-300 text-sm">No IcanEra account found matching "{query}"</p>
              <p className="text-slate-400 text-xs mt-1">They must sign up for IcanEra first.</p>
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        {/* Assign from CMMS */}
        {includeCmms && (
          <div className="mt-4 pt-4 border-t border-slate-700">
            <p className="text-slate-400 text-xs font-semibold mb-1 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-purple-400" /> ASSIGN FROM CMMS
            </p>
            <p className="text-slate-500 text-xs mb-3">
              {cmmsCompanies.length > 0
                ? `Staff of ${cmmsCompanies.join(', ')}. Tap Assign to let them enter data on behalf of the company.`
                : 'People from the CMMS company linked to this business.'}
            </p>
            {cmmsLoading ? (
              <p className="text-slate-500 text-sm flex items-center gap-2"><Loader className="w-4 h-4 animate-spin" /> Loading CMMS staff…</p>
            ) : cmmsError ? (
              <p className="text-red-400 text-xs">Couldn't load CMMS staff: {cmmsError}</p>
            ) : cmmsStaff.length === 0 ? (
              <p className="text-slate-500 text-sm">
                No CMMS staff found. Link this business's CMMS company under Link Data Sources first.
              </p>
            ) : (
              <div className="space-y-2">
                {cmmsStaff.map((person) => {
                  const already = members.some((m) => (m.member_email || '').trim().toLowerCase() === person.email);
                  const busy = assigningEmail === person.email;
                  return (
                    <div key={person.email} className="flex items-center justify-between gap-2 bg-slate-800/50 rounded-lg px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-white text-sm font-medium truncate">{person.name}</p>
                        <p className="text-slate-500 text-xs truncate">
                          {[person.jobTitle, person.department].filter(Boolean).join(' · ') || person.email}
                        </p>
                      </div>
                      {already ? (
                        <span className="text-green-400 text-xs font-semibold flex items-center gap-1 shrink-0">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Helper
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAssignCmms(person)}
                          disabled={busy || !!assigningEmail}
                          className="shrink-0 text-xs font-semibold px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white disabled:opacity-50 flex items-center gap-1.5"
                        >
                          {busy ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                          Assign
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Current members */}
        <div className="mt-5 pt-4 border-t border-slate-700">
          <p className="text-slate-400 text-xs font-semibold mb-3">CAN ENTER DATA ON BEHALF OF THE COMPANY</p>
          {loadingMembers ? (
            <p className="text-slate-500 text-sm">Loading...</p>
          ) : members.length === 0 ? (
            <p className="text-slate-500 text-sm">No helpers yet. Search above to assign one.</p>
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
                    title="Remove helper"
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
