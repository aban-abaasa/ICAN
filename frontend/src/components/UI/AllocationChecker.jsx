/**
 * 📊 Allocation Checker Component
 * Enforces 60% maximum allocation rule for diverse investments
 */

import React, { useState, useEffect } from 'react';
import { AlertTriangle, CheckCircle, Lock, TrendingUp } from 'lucide-react';
import enhancedInvestmentService from '../../services/enhancedInvestmentService';

export default function AllocationChecker({
  investorId,
  businessId,
  pitchId,
  proposedAmountIcan,
  targetFundingUsd,
  onAllocationChange,
  txType = 'investment'
}) {
  const [allocationData, setAllocationData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const checkAllocation = async () => {
      try {
        setLoading(true);
        setError(null);

        const result = await enhancedInvestmentService.checkAllocationCap(
          investorId,
          businessId,
          pitchId,
          proposedAmountIcan
        );

        setAllocationData(result);
        onAllocationChange?.(result);
      } catch (err) {
        console.error('❌ Allocation check failed:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (investorId && businessId && pitchId && proposedAmountIcan > 0) {
      checkAllocation();
    }
  }, [investorId, businessId, pitchId, proposedAmountIcan, onAllocationChange]);

  if (loading) {
    return (
      <div className="bg-slate-900/40 rounded-lg p-4 border border-slate-700/50 animate-pulse">
        <div className="space-y-2">
          <div className="h-4 bg-slate-700/30 rounded w-3/4"></div>
          <div className="h-3 bg-slate-700/20 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 rounded-lg p-4 border border-red-500/30 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-red-300 font-semibold text-sm">Allocation Check Error</p>
          <p className="text-red-200 text-xs">{error}</p>
        </div>
      </div>
    );
  }

  if (!allocationData) return null;

  const { allowed, details, message } = allocationData;
  const allocation = parseFloat(details.allocationPercentage);
  const isNearCap = allocation > 50;
  const isAtCap = allocation >= 60;

  // Progress bar segments
  const segments = [];
  const segmentSize = 20; // Each segment = 20%
  for (let i = 0; i < 5; i++) {
    const start = i * segmentSize;
    const end = (i + 1) * segmentSize;
    let color = 'bg-emerald-500'; // 0-20% (safe)
    if (i === 1) color = 'bg-emerald-400'; // 20-40% (safe)
    if (i === 2) color = 'bg-yellow-500'; // 40-60% (caution)
    if (i >= 3) color = 'bg-red-500'; // 60%+ (danger)

    if (allocation < end) {
      segments.push({
        color,
        filled: i === 0 || allocation > start,
        percentage: i === 0 || allocation > start ? Math.min(segmentSize, allocation - start) : 0
      });
      break;
    } else {
      segments.push({
        color,
        filled: true,
        percentage: segmentSize
      });
    }
  }

  return (
    <div className="space-y-4">
      {/* Allocation Status */}
      <div
        className={`rounded-lg p-4 border transition ${
          allowed
            ? 'bg-emerald-900/20 border-emerald-500/30'
            : 'bg-red-900/20 border-red-500/30'
        }`}
      >
        <div className="flex items-start gap-3">
          {allowed ? (
            <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
          ) : (
            <Lock className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
          )}
          <div className="flex-1">
            <p
              className={`font-semibold text-sm ${
                allowed ? 'text-emerald-300' : 'text-red-300'
              }`}
            >
              {allowed ? '✓ Investment Allowed' : '✗ Investment Blocked'}
            </p>
            <p
              className={`text-xs mt-1 ${allowed ? 'text-emerald-200/70' : 'text-red-200/70'}`}
            >
              {message}
            </p>
          </div>
        </div>
      </div>

      {/* Allocation Visualization */}
      <div className="bg-slate-800/40 rounded-lg p-4 border border-slate-700/30 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-slate-300 font-semibold text-sm">Allocation Rule: 60% Max</span>
          <span className={`text-sm font-bold ${
            isAtCap ? 'text-red-300' : isNearCap ? 'text-yellow-300' : 'text-emerald-300'
          }`}>
            {allocation.toFixed(1)}% / 100%
          </span>
        </div>

        {/* Progress Bar with Segments */}
        <div className="space-y-2">
          {/* 60% Cap Line */}
          <div className="text-xs text-slate-400 flex justify-between">
            <span>0%</span>
            <span className="text-red-400 font-semibold">60% CAP ⚠️</span>
            <span>100%</span>
          </div>

          {/* Main progress bar */}
          <div className="h-3 bg-slate-700/40 rounded-full overflow-hidden border border-slate-600/40">
            <div
              className={`h-full transition-all duration-300 ${
                allocation < 40 ? 'bg-emerald-500' :
                allocation < 60 ? 'bg-yellow-500' :
                'bg-red-500'
              }`}
              style={{ width: `${Math.min(allocation, 100)}%` }}
            ></div>
          </div>

          {/* 60% marker line */}
          <div className="relative h-1">
            <div className="absolute h-full w-1 bg-red-500 rounded" style={{ left: '60%' }}></div>
          </div>
        </div>

        {/* Detailed Breakdown */}
        <div className="space-y-2 pt-2">
          <div className="grid grid-cols-2 gap-2">
            {/* Existing */}
            <div className="bg-slate-900/30 rounded-lg p-3">
              <p className="text-slate-400 text-xs">Your Current</p>
              <p className="text-white font-bold text-sm mt-1">
                {details.existingAllocation.toFixed(0)} ICAN
              </p>
              <p className="text-slate-300 text-xs mt-0.5">
                {((details.existingAllocation / details.targetFunding) * 100).toFixed(1)}% of target
              </p>
            </div>

            {/* New */}
            <div className="bg-slate-900/30 rounded-lg p-3">
              <p className="text-slate-400 text-xs">You're Adding</p>
              <p className="text-blue-300 font-bold text-sm mt-1">
                {proposedAmountIcan.toFixed(0)} ICAN
              </p>
              <p className="text-slate-300 text-xs mt-0.5">
                {((proposedAmountIcan / details.targetFunding) * 100).toFixed(1)}% of target
              </p>
            </div>
          </div>

          {/* Total After */}
          <div className={`rounded-lg p-3 border ${
            isAtCap
              ? 'bg-red-900/20 border-red-500/20'
              : isNearCap
              ? 'bg-yellow-900/20 border-yellow-500/20'
              : 'bg-emerald-900/20 border-emerald-500/20'
          }`}>
            <p className="text-slate-400 text-xs">Total After This Investment</p>
            <div className="flex items-baseline gap-2 mt-1">
              <p className={`font-bold text-lg ${
                isAtCap ? 'text-red-300' :
                isNearCap ? 'text-yellow-300' :
                'text-emerald-300'
              }`}>
                {details.totalAllocation.toFixed(0)} ICAN
              </p>
              <p className={`text-sm ${
                isAtCap ? 'text-red-300' :
                isNearCap ? 'text-yellow-300' :
                'text-emerald-300'
              }`}>
                ({allocation.toFixed(1)}% of business)
              </p>
            </div>
          </div>
        </div>

        {/* Remaining Allowance */}
        {allowed && (
          <div className="bg-emerald-900/10 border border-emerald-500/20 rounded-lg p-3 flex gap-2">
            <TrendingUp className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-emerald-300 text-xs font-semibold">Still Room to Invest</p>
              <p className="text-emerald-200/70 text-xs mt-0.5">
                You can add up to {details.remainingAllocation.toFixed(0)} more ICAN to this business
              </p>
            </div>
          </div>
        )}

        {/* Warning if Near Cap */}
        {!allowed && (
          <div className="bg-red-900/20 border border-red-500/20 rounded-lg p-3 flex gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-300 text-xs font-semibold">Allocation Limit Exceeded</p>
              <p className="text-red-200/70 text-xs mt-0.5">
                The 60% rule prevents any single investor from controlling too much of a business.
                This ensures diverse ownership and reduces concentration risk.
              </p>
              <p className="text-red-200 text-xs font-semibold mt-2">
                💡 Reduce your investment to {Math.max(0, details.remainingAllocation).toFixed(0)} ICAN or less
              </p>
            </div>
          </div>
        )}

        {/* Info about Rule */}
        <div className="bg-slate-900/40 rounded-lg p-3 border border-slate-700/20 text-xs text-slate-400">
          <p className="font-semibold text-slate-300 mb-1">📋 The 60% Rule</p>
          <ul className="space-y-1 text-slate-400 ml-4">
            <li>• Prevents any single investor from dominating a business</li>
            <li>• Ensures diverse investor base</li>
            <li>• Reduces concentration risk</li>
            <li>• Applies to all investments in same business</li>
          </ul>
        </div>
      </div>

      {/* Transaction Status */}
      <div className={`flex items-center gap-2 text-sm font-semibold ${
        allowed ? 'text-emerald-300' : 'text-red-300'
      }`}>
        <div className={`w-2 h-2 rounded-full ${allowed ? 'bg-emerald-400' : 'bg-red-400'}`}></div>
        {allowed ? (
          <span>✓ Ready to proceed with investment</span>
        ) : (
          <span>✗ Cannot proceed - exceeds allocation limit</span>
        )}
      </div>
    </div>
  );
}
