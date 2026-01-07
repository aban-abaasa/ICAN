import React from 'react';
import { Building2, Edit2, Users, DollarSign, Globe, MapPin, Calendar } from 'lucide-react';

const BusinessProfileCard = ({ profile, onEdit, onSelect }) => {
  if (!profile) return null;

  const coOwnersCount = profile.business_co_owners?.length || 0;

  return (
    <div className="bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 rounded-xl p-5 hover:border-blue-500 transition cursor-pointer group" onClick={onSelect}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="bg-gradient-to-br from-blue-500 to-cyan-500 p-3 rounded-lg">
            <Building2 className="w-6 h-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-white font-bold text-lg group-hover:text-blue-400 transition">{profile.business_name}</h3>
            <p className="text-slate-400 text-sm">{profile.business_type}</p>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit?.();
          }}
          className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg transition"
        >
          <Edit2 className="w-4 h-4" />
        </button>
      </div>

      {profile.description && (
        <p className="text-slate-300 text-sm mb-4 line-clamp-2">{profile.description}</p>
      )}

      <div className="grid grid-cols-2 gap-3 mb-4">
        {profile.founded_year && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Calendar className="w-4 h-4 text-blue-400" />
            <span>Founded {profile.founded_year}</span>
          </div>
        )}
        
        {coOwnersCount > 0 && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <Users className="w-4 h-4 text-blue-400" />
            <span>{coOwnersCount} co-owner{coOwnersCount !== 1 ? 's' : ''}</span>
          </div>
        )}

        {profile.total_capital && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <DollarSign className="w-4 h-4 text-green-400" />
            <span>${(profile.total_capital || 0).toLocaleString()}</span>
          </div>
        )}

        {profile.business_address && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <MapPin className="w-4 h-4 text-red-400" />
            <span className="truncate">{profile.business_address}</span>
          </div>
        )}
      </div>

      {profile.website && (
        <div className="flex items-center gap-2 text-blue-400 text-sm mb-4">
          <Globe className="w-4 h-4" />
          <a 
            href={profile.website} 
            target="_blank" 
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="hover:underline truncate"
          >
            {profile.website}
          </a>
        </div>
      )}

      {profile.business_co_owners && profile.business_co_owners.length > 0 && (
        <div className="pt-4 border-t border-slate-700">
          <p className="text-slate-400 text-xs font-semibold mb-2">CO-OWNERS</p>
          <div className="space-y-2">
            {profile.business_co_owners.slice(0, 3).map((owner, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm">
                <div>
                  <p className="text-white font-medium">{owner.owner_name}</p>
                  <p className="text-slate-500 text-xs">{owner.role}</p>
                </div>
                <span className="text-blue-400 font-semibold">{owner.ownership_share}%</span>
              </div>
            ))}
            {profile.business_co_owners.length > 3 && (
              <p className="text-slate-500 text-xs mt-2">+{profile.business_co_owners.length - 3} more</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        <div className="flex-1 h-1 bg-slate-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-cyan-500"
            style={{
              width: profile.verification_status === 'verified' ? '100%' : '60%'
            }}
          ></div>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded ${
          profile.verification_status === 'verified'
            ? 'bg-green-900/50 text-green-300'
            : 'bg-yellow-900/50 text-yellow-300'
        }`}>
          {profile.verification_status === 'verified' ? '✓ Verified' : '⏳ Pending'}
        </span>
      </div>
    </div>
  );
};

export default BusinessProfileCard;
