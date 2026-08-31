/**
 * Shared preview body for a generated financial report (tax return, balance
 * sheet, or income statement) — summary cards, AI insights, and compliance
 * checklist. Used by both AdvancedFinancialReports.jsx's preview modal and
 * MobileView.jsx's inline Reports modal so the two don't duplicate this JSX.
 */

import React from 'react';
import { Zap, CheckCircle, AlertTriangle } from 'lucide-react';

const ReportPreviewCard = ({ report }) => {
  if (!report) return null;

  const aiInsights =
    report.taxOptimization?.aiRecommendations ||
    report.healthAnalysis?.aiInsights ||
    report.profitabilityAnalysis?.aiInsights ||
    report.complianceAnalysis ||
    null;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {report.type === 'tax-return' && (
          <>
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <p className="text-sm text-green-600 font-semibold">Total Income</p>
              <p className="text-2xl font-bold text-green-800 mt-2">
                {report.currency} {report.incomeSection?.totalGrossIncome?.toLocaleString() || 0}
              </p>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-600 font-semibold">Deductions</p>
              <p className="text-2xl font-bold text-blue-800 mt-2">
                {report.currency} {report.deductionsSection?.totalDeductions?.toLocaleString() || 0}
              </p>
            </div>
            <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
              <p className="text-sm text-orange-600 font-semibold">Tax Liability</p>
              <p className="text-2xl font-bold text-orange-800 mt-2">
                {report.currency} {report.taxCalculation?.totalTaxLiability?.toLocaleString() || 0}
              </p>
            </div>
            <div className={`p-4 rounded-lg border-2 ${
              report.taxCalculation?.taxPayable > 0
                ? 'bg-red-50 border-red-200'
                : 'bg-green-50 border-green-200'
            }`}>
              <p className="text-sm font-semibold">{report.taxCalculation?.taxPayable > 0 ? 'Tax Payable' : 'Refund Due'}</p>
              <p className={`text-2xl font-bold mt-2 ${
                report.taxCalculation?.taxPayable > 0 ? 'text-red-800' : 'text-green-800'
              }`}>
                {report.currency} {Math.abs(report.taxCalculation?.taxPayable)?.toLocaleString() || 0}
              </p>
            </div>
          </>
        )}

        {report.type === 'balance-sheet' && (
          <>
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <p className="text-sm text-green-600 font-semibold">Total Assets</p>
              <p className="text-2xl font-bold text-green-800 mt-2">
                {report.currency} {report.assets?.totalAssets?.toLocaleString() || 0}
              </p>
            </div>
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <p className="text-sm text-red-600 font-semibold">Total Liabilities</p>
              <p className="text-2xl font-bold text-red-800 mt-2">
                {report.currency} {report.liabilities?.totalLiabilities?.toLocaleString() || 0}
              </p>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-600 font-semibold">Total Equity</p>
              <p className="text-2xl font-bold text-blue-800 mt-2">
                {report.currency} {report.equity?.totalEquity?.toLocaleString() || 0}
              </p>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
              <p className="text-sm text-purple-600 font-semibold">Debt-to-Equity</p>
              <p className="text-2xl font-bold text-purple-800 mt-2">
                {report.ratios?.debtToEquity?.toFixed(2) || 0}
              </p>
            </div>
          </>
        )}

        {report.type === 'income-statement' && (
          <>
            <div className="bg-green-50 p-4 rounded-lg border border-green-200">
              <p className="text-sm text-green-600 font-semibold">Revenue</p>
              <p className="text-2xl font-bold text-green-800 mt-2">
                {report.currency} {report.revenue?.totalRevenue?.toLocaleString() || 0}
              </p>
            </div>
            <div className="bg-red-50 p-4 rounded-lg border border-red-200">
              <p className="text-sm text-red-600 font-semibold">Operating Expenses</p>
              <p className="text-2xl font-bold text-red-800 mt-2">
                {report.currency} {report.operatingExpenses?.totalOperatingExpenses?.toLocaleString() || 0}
              </p>
            </div>
            <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
              <p className="text-sm text-blue-600 font-semibold">Net Income</p>
              <p className="text-2xl font-bold text-blue-800 mt-2">
                {report.currency} {report.netIncome?.amount?.toLocaleString() || 0}
              </p>
            </div>
            <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
              <p className="text-sm text-purple-600 font-semibold">Profit Margin</p>
              <p className="text-2xl font-bold text-purple-800 mt-2">
                {report.netIncome?.margin || '0%'}
              </p>
            </div>
          </>
        )}
      </div>

      {/* AI Insights Section */}
      {aiInsights && (
        <div className="bg-gradient-to-br from-yellow-50 to-orange-50 border-l-4 border-yellow-500 p-6 rounded-lg">
          <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-3">
            <Zap className="w-5 h-5 text-yellow-600" />
            AI-Powered Insights
          </h3>
          <p className="text-gray-700 whitespace-pre-wrap">{aiInsights}</p>
        </div>
      )}

      {/* Compliance Requirements */}
      {report.complianceChecklist && (
        <div className="bg-blue-50 border border-blue-200 p-6 rounded-lg">
          <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4">
            <CheckCircle className="w-5 h-5 text-blue-600" />
            Compliance Checklist
          </h3>
          <div className="space-y-2">
            {report.complianceChecklist.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input type="checkbox" className="w-4 h-4" readOnly />
                <span className="text-gray-700">{item.item}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legal disclaimer — these figures are AI-assisted estimates, not filed tax advice */}
      <div className="bg-gray-100 border border-gray-300 p-4 rounded-lg flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-gray-500 shrink-0 mt-0.5" />
        <div className="text-xs text-gray-600 space-y-1">
          <p>
            Informational estimate only — verify with a licensed tax professional or your local revenue authority before filing.
          </p>
          {report.dataSource && (
            <p>
              Tax rules source:{' '}
              <span className={`font-semibold ${report.dataSource === 'verified' ? 'text-green-700' : 'text-amber-700'}`}>
                {report.dataSource === 'verified' ? 'Hand-verified' : 'AI-generated estimate'}
              </span>
              {report.lastVerifiedAt && ` · last checked ${new Date(report.lastVerifiedAt).toLocaleDateString()}`}
              {report.dataSource !== 'verified' && ' · not independently confirmed'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ReportPreviewCard;
