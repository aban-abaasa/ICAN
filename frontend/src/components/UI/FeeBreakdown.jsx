/**
 * 💰 Fee Breakdown Component
 * Shows detailed fee structure before transaction
 */

import React, { useMemo } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

export default function FeeBreakdown({
  icanAmount,
  txType = 'trust_contribution',
  localCurrency = 'UGX',
  lockedRate = 5000,
  exchangeRate,
  onExpand
}) {
  const [expanded, setExpanded] = React.useState(false);

  // Calculate fees based on type
  const feeStructure = useMemo(() => {
    const basePercent = 0.02; // 2%
    const baseFee = icanAmount * basePercent;

    const types = {
      trust_contribution: {
        name: 'Trust Contribution',
        platform: baseFee,
        platformPercent: 2.0,
        blockchain: baseFee * 0.2,
        blockchainPercent: 0.4,
        other: 0,
        otherPercent: 0,
        description: 'Money moves to community funds'
      },
      investment: {
        name: 'Investment/Pitch-in',
        platform: baseFee,
        platformPercent: 2.0,
        blockchain: baseFee * 0.2,
        blockchainPercent: 0.4,
        other: baseFee * 0.3,
        otherPercent: 0.6,
        otherLabel: 'Smart Contract',
        description: 'Includes automated agreement generation'
      },
      cmms_payment: {
        name: 'CMMS Payment',
        platform: baseFee,
        platformPercent: 2.0,
        blockchain: baseFee * 0.25,
        blockchainPercent: 0.5,
        other: baseFee * 0.1,
        otherPercent: 0.2,
        otherLabel: 'Audit Trail',
        description: 'Includes immutable approval recording'
      }
    };

    const structure = types[txType] || types.trust_contribution;
    const totalFee = structure.platform + structure.blockchain + structure.other;
    const totalPercent = structure.platformPercent + structure.blockchainPercent + structure.otherPercent;
    const netAmount = icanAmount - totalFee;
    const netLocal = netAmount * lockedRate;

    return {
      ...structure,
      totalFee,
      totalPercent: totalPercent.toFixed(1),
      netAmount,
      netLocal,
      inCurrency: netLocal
    };
  }, [icanAmount, txType, lockedRate]);

  const toggleExpanded = () => {
    setExpanded(!expanded);
    onExpand?.(!expanded);
  };

  return (
    <div className="space-y-3">
      {/* Fee Summary Card */}
      <button
        onClick={toggleExpanded}
        className="w-full bg-gradient-to-r from-amber-900/20 to-orange-900/20 hover:from-amber-900/30 hover:to-orange-900/30 rounded-lg p-4 border border-amber-500/20 hover:border-amber-500/40 transition text-left"
      >
        <div className="flex items-center justify-between">
          <div className="flex-1">
            <p className="text-amber-300 font-semibold text-sm flex items-center gap-2">
              💵 Fee Breakdown
              {feeStructure.totalPercent > 3 && (
                <span className="text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded">
                  Higher fees
                </span>
              )}
            </p>
            <p className="text-amber-200/60 text-xs mt-1">
              {feeStructure.totalFee.toFixed(2)} ICAN ({feeStructure.totalPercent}%)
            </p>
          </div>
          <ChevronDown
            className={`w-5 h-5 text-amber-400 transition transform ${
              expanded ? 'rotate-180' : ''
            }`}
          />
        </div>
      </button>

      {/* Detailed Breakdown */}
      {expanded && (
        <div className="bg-slate-800/40 rounded-lg p-4 border border-slate-700/30 space-y-3 animate-in fade-in-50 duration-200">
          {/* Description */}
          <p className="text-slate-400 text-xs">{feeStructure.description}</p>

          {/* Fee Items */}
          <div className="space-y-2">
            {/* Platform Fee */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🏢</span>
                <div>
                  <p className="text-slate-300 text-sm font-medium">Platform Fee</p>
                  <p className="text-slate-500 text-xs">Operation & maintenance</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-white font-semibold text-sm">
                  {feeStructure.platform.toFixed(3)} ICAN
                </p>
                <p className="text-slate-400 text-xs">{feeStructure.platformPercent}%</p>
              </div>
            </div>

            {/* Blockchain Fee */}
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="text-2xl">⛓️</span>
                <div>
                  <p className="text-slate-300 text-sm font-medium">Blockchain Recording</p>
                  <p className="text-slate-500 text-xs">Immutable verification</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-white font-semibold text-sm">
                  {feeStructure.blockchain.toFixed(3)} ICAN
                </p>
                <p className="text-slate-400 text-xs">{feeStructure.blockchainPercent}%</p>
              </div>
            </div>

            {/* Additional Fee (if applicable) */}
            {feeStructure.other > 0 && (
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">
                    {txType === 'investment' && '📜'}
                    {txType === 'cmms_payment' && '📋'}
                  </span>
                  <div>
                    <p className="text-slate-300 text-sm font-medium">
                      {feeStructure.otherLabel}
                    </p>
                    <p className="text-slate-500 text-xs">
                      {txType === 'investment' && 'Smart contract generation'}
                      {txType === 'cmms_payment' && 'Approval audit trail'}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-white font-semibold text-sm">
                    {feeStructure.other.toFixed(3)} ICAN
                  </p>
                  <p className="text-slate-400 text-xs">{feeStructure.otherPercent}%</p>
                </div>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-slate-700/30"></div>

          {/* Total Summary */}
          <div className="space-y-2 pt-2">
            {/* Gross Amount */}
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-sm">Gross Amount (ICAN):</span>
              <span className="text-white font-semibold">
                {icanAmount.toFixed(2)} ICAN
              </span>
            </div>

            {/* Total Fees */}
            <div className="flex justify-between items-center">
              <span className="text-slate-400 text-sm">Total Fees:</span>
              <span className="text-orange-300 font-semibold">
                -{feeStructure.totalFee.toFixed(3)} ICAN
              </span>
            </div>

            {/* Net Amount (ICAN) */}
            <div className="bg-emerald-900/20 border border-emerald-500/20 rounded-lg px-3 py-2 flex justify-between items-center">
              <span className="text-emerald-300 font-semibold text-sm">Net Amount (ICAN):</span>
              <span className="text-emerald-300 font-bold text-lg">
                {feeStructure.netAmount.toFixed(2)}
              </span>
            </div>

            {/* Net in Local Currency */}
            <div className="bg-blue-900/20 border border-blue-500/20 rounded-lg px-3 py-2 flex justify-between items-center">
              <span className="text-blue-300 font-semibold text-sm">
                Recipient Gets ({localCurrency}):
              </span>
              <span className="text-blue-300 font-bold text-lg">
                {feeStructure.netLocal.toLocaleString(undefined, {
                  maximumFractionDigits: 0
                })}
              </span>
            </div>
          </div>

          {/* Fee Explanation */}
          <div className="bg-slate-900/30 rounded-lg p-3 border border-slate-700/50 flex gap-2">
            <HelpCircle className="w-4 h-4 text-slate-400 flex-shrink-0 mt-0.5" />
            <p className="text-slate-400 text-xs">
              <span className="font-semibold text-slate-300">Why these fees?</span>
              {' '}
              Platform fees maintain servers and infrastructure. Blockchain fees verify
              transactions immutably. Smart contract fees automate agreements.
              {txType === 'cmms_payment' && ' Audit fees ensure compliance recording.'}
            </p>
          </div>

          {/* Fair Price Indicator */}
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <span>✓</span>
            <span>Competitive rates compared to payment processors (3-5%)</span>
          </div>
        </div>
      )}
    </div>
  );
}
