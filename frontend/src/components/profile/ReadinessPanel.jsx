import React from 'react';
import { Globe, CheckCircle, AlertTriangle } from 'lucide-react';

/**
 * Global Navigator / regulatory-gap compliance checklist.
 * Extracted from MobileView.jsx's standalone "Readiness" detail panel so it
 * can be shared between that legacy panel and the new Profile "Readiness" tab.
 */
export default function ReadinessPanel({
  mode,
  setMode,
  operatingCountry,
  setOperatingCountry,
  performComplianceCheck,
  isLoading,
  complianceData,
}) {
  return (
    <div className="space-y-4">
      <div className="bg-slate-900/50 border border-green-500/30 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-4">
          <Globe className="w-6 h-6 text-green-400" />
          <h2 className="text-lg font-semibold text-white">Global Navigator</h2>
        </div>

        <div className="mb-4">
          <div className="flex flex-col gap-4 mb-4">
            <div>
              <label className="block text-white font-medium mb-2">Operating Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full px-4 py-2 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-green-400"
              >
                <option value="SE">SE - Salaried Employee</option>
                <option value="BO">BO - Business Owner</option>
              </select>
            </div>

            <div>
              <label className="block text-white font-medium mb-2">Country</label>
              <select
                value={operatingCountry}
                onChange={(e) => setOperatingCountry(e.target.value)}
                className="w-full px-4 py-2 bg-slate-800/50 border border-slate-600/50 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-green-400"
              >
                <option value="Uganda">Uganda</option>
                <option value="Kenya">Kenya</option>
                <option value="Tanzania">Tanzania</option>
                <option value="Rwanda">Rwanda</option>
              </select>
            </div>
          </div>

          <button
            onClick={performComplianceCheck}
            disabled={isLoading}
            className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-600 text-white rounded-lg transition-colors font-medium"
          >
            {isLoading ? 'Checking Compliance...' : 'Perform Regulatory Gap Analysis'}
          </button>
        </div>

        {complianceData && (
          <div className="space-y-4">
            <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-4">
              <h3 className="text-green-400 font-semibold mb-2">Compliance Status</h3>
              <div className="text-2xl font-bold text-white">
                {Math.round(complianceData.compliancePercentage)}% Complete
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="text-white font-semibold text-sm">Compliance Checklist</h3>
              {complianceData.checklist.map((item, index) => (
                <div
                  key={index}
                  className={`flex items-center gap-3 p-3 rounded-lg text-sm ${
                    item.status === 'completed'
                      ? 'bg-green-500/20 border border-green-500/30'
                      : item.status === 'pending'
                        ? 'bg-yellow-500/20 border border-yellow-500/30'
                        : 'bg-red-500/20 border border-red-500/30'
                  }`}
                >
                  {item.status === 'completed' ? (
                    <CheckCircle className="w-5 h-5 text-green-400" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 text-yellow-400" />
                  )}
                  <div className="flex-1">
                    <span className="text-white font-medium">{item.item}</span>
                    {item.required && <span className="text-red-400 ml-2">*Required</span>}
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded ${
                      item.status === 'completed'
                        ? 'bg-green-600 text-white'
                        : item.status === 'pending'
                          ? 'bg-yellow-600 text-white'
                          : 'bg-red-600 text-white'
                    }`}
                  >
                    {item.status.replace(/-/g, ' ')}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
