import React from 'react';
import { Rocket, Clock, Target } from 'lucide-react';

/**
 * Prosperity Architect / schedule optimizer.
 * Extracted from MobileView.jsx's standalone "Growth" detail panel so it can
 * be shared between that legacy panel and the new Profile "Growth" tab.
 */
export default function GrowthPanel({ optimizeSchedule, isLoading, scheduleData }) {
  return (
    <div className="space-y-4">
      <div className="bg-slate-900/50 border border-purple-500/30 rounded-lg p-4">
        <div className="flex items-center gap-3 mb-4">
          <Rocket className="w-6 h-6 text-purple-400" />
          <h2 className="text-lg font-semibold text-white">Prosperity Architect</h2>
        </div>

        <div className="mb-4">
          <p className="text-gray-300 mb-4 text-sm">
            Optimize your schedule for maximum value creation while maintaining spiritual and physical alignment.
          </p>

          <button
            onClick={optimizeSchedule}
            disabled={isLoading}
            className="w-full py-3 bg-purple-500 hover:bg-purple-600 disabled:bg-gray-600 text-white rounded-lg transition-colors font-medium"
          >
            {isLoading ? 'Optimizing Schedule...' : 'Optimize Daily Schedule'}
          </button>
        </div>

        {scheduleData && (
          <div className="space-y-4">
            <div className="bg-purple-500/20 border border-purple-500/30 rounded-lg p-4">
              <h3 className="text-purple-400 font-semibold mb-2">Optimization Score</h3>
              <div className="text-2xl font-bold text-white">{Math.round(scheduleData.optimizationScore)}%</div>
            </div>

            <div className="space-y-3">
              <h3 className="text-white font-semibold text-sm">Schedule Recommendations</h3>
              {scheduleData.recommendations.map((rec, index) => (
                <div key={index} className="flex items-start gap-3 p-3 bg-white/5 rounded-lg">
                  <Clock className="w-5 h-5 text-purple-400 mt-0.5 flex-shrink-0" />
                  <span className="text-white text-sm">{rec}</span>
                </div>
              ))}
            </div>

            <div className="space-y-3">
              <h3 className="text-white font-semibold text-sm">Next Actions</h3>
              {scheduleData.nextActions.map((action, index) => (
                <div key={index} className="flex items-center gap-3 p-3 bg-blue-500/20 border border-blue-500/30 rounded-lg">
                  <Target className="w-5 h-5 text-blue-400" />
                  <span className="text-white text-sm">{action}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
