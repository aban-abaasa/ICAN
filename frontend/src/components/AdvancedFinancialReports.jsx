/**
 * Advanced Financial Reports Component
 * UI for generating Tax Returns, Balance Sheets, Income Statements
 * with country-specific compliance and AI-powered analysis
 */

import React, { useState, useEffect } from 'react';
import {
  Download,
  FileText,
  TrendingUp,
  DollarSign,
  AlertCircle,
  CheckCircle,
  Loader,
  Globe,
  Zap,
  BarChart3,
  PieChart
} from 'lucide-react';
import {
  generateTaxReturn,
  generateBalanceSheet,
  generateIncomeStatement,
  buildFinancialDataFromTransactions,
  runAutomatedReportingCycle,
  runTransactionArchivingCycle,
  generateCountryComplianceReport,
  getSupportedCountries,
  getSavedReports,
  exportReport
} from '../services/advancedReportService';

const AdvancedFinancialReports = ({ userId, transactions, userProfile }) => {
  const [activeTab, setActiveTab] = useState('generate');
  const [selectedReportType, setSelectedReportType] = useState('tax-return');
  const [selectedCountry, setSelectedCountry] = useState('UG');
  const [supportedCountries, setSupportedCountries] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedReport, setGeneratedReport] = useState(null);
  const [savedReports, setSavedReports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [automationSummary, setAutomationSummary] = useState(null);

  // Initialize countries list
  useEffect(() => {
    setSupportedCountries(getSupportedCountries());
    loadSavedReports();
  }, [userId]);

  useEffect(() => {
    const runAutomation = async () => {
      if (!userId || !Array.isArray(transactions) || transactions.length === 0) return;

      try {
        const periodicResult = await runAutomatedReportingCycle({
          userId,
          transactions,
          countryCode: selectedCountry,
          periods: ['weekly', 'monthly']
        });

        const archiveResult = await runTransactionArchivingCycle({
          userId,
          transactions,
          countryCode: selectedCountry,
          lookbackDays: 45
        });

        const generatedPeriodicCount = periodicResult.filter((item) => item.status === 'generated').length;
        const generatedArchiveCount = archiveResult.filter((item) => item.status === 'archived').length;
        const skippedCount = (periodicResult.length - generatedPeriodicCount) + (archiveResult.length - generatedArchiveCount);

        setAutomationSummary({
          generatedCount: generatedPeriodicCount + generatedArchiveCount,
          generatedPeriodicCount,
          generatedArchiveCount,
          skippedCount
        });

        if (generatedPeriodicCount > 0 || generatedArchiveCount > 0) {
          loadSavedReports();
        }
      } catch (error) {
        console.error('Automated report cycle failed:', error);
      }
    };

    runAutomation();
  }, [userId, transactions, selectedCountry]);

  const loadSavedReports = async () => {
    if (userId) {
      setLoading(true);
      const reports = await getSavedReports(userId);
      setSavedReports(reports || []);
      setLoading(false);
    }
  };

  const handleGenerateReport = async () => {
    setIsGenerating(true);
    try {
      const financialData = buildFinancialDataFromTransactions(transactions, {
        reportPeriod: selectedReportType === 'income-statement' ? 'Monthly' : 'Annual'
      });
      let report;

      switch (selectedReportType) {
        case 'tax-return':
          report = await generateTaxReturn(financialData, selectedCountry, userId);
          break;
        case 'balance-sheet':
          report = await generateBalanceSheet(financialData, selectedCountry, userId);
          break;
        case 'income-statement':
          report = await generateIncomeStatement(financialData, selectedCountry, userId);
          break;
        default:
          report = await generateTaxReturn(financialData, selectedCountry, userId);
      }

      setGeneratedReport(report);
      setShowPreview(true);
      loadSavedReports();
    } catch (error) {
      console.error('Error generating report:', error);
      alert('Error generating report: ' + error.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleExportReport = (format) => {
    if (generatedReport) {
      exportReport(generatedReport, format);
    }
  };

  // Report type descriptions
  const reportTypeInfo = {
    'tax-return': {
      title: '🧾 Tax Return',
      description: 'Professional tax return with country-specific compliance',
      icon: FileText,
      color: 'from-blue-500 to-blue-600'
    },
    'balance-sheet': {
      title: '📊 Balance Sheet',
      description: 'Assets, liabilities, and equity statement',
      icon: BarChart3,
      color: 'from-green-500 to-green-600'
    },
    'income-statement': {
      title: '📈 Income Statement',
      description: 'Revenue, expenses, and profitability analysis',
      icon: TrendingUp,
      color: 'from-purple-500 to-purple-600'
    }
  };

  const currentReportType = reportTypeInfo[selectedReportType];
  const ReportIcon = currentReportType?.icon || FileText;

  return (
    <div className="space-y-6 p-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-800 mb-2 flex items-center justify-center gap-3">
          <Zap className="w-8 h-8 text-yellow-500" />
          Professional Financial Reports
        </h1>
        <p className="text-gray-600">Generate tax returns, balance sheets, and income statements with AI-powered country compliance</p>
        {automationSummary && (
          <p className="text-sm text-blue-700 mt-2">
            Automated cycle: {automationSummary.generatedCount} new report(s) ({automationSummary.generatedPeriodicCount || 0} weekly/monthly, {automationSummary.generatedArchiveCount || 0} daily archives), {automationSummary.skippedCount} already up to date.
          </p>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-gray-300 mb-6">
        <button
          onClick={() => setActiveTab('generate')}
          className={`px-6 py-2 font-semibold transition-all ${
            activeTab === 'generate'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          🔨 Generate Report
        </button>
        <button
          onClick={() => setActiveTab('saved')}
          className={`px-6 py-2 font-semibold transition-all ${
            activeTab === 'saved'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-600 hover:text-gray-800'
          }`}
        >
          💾 Saved Reports ({savedReports.length})
        </button>
      </div>

      {/* Generate Tab */}
      {activeTab === 'generate' && (
        <div className="space-y-6">
          {/* Report Type Selection */}
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-4">📋 Select Report Type</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {Object.entries(reportTypeInfo).map(([key, info]) => (
                <div
                  key={key}
                  onClick={() => setSelectedReportType(key)}
                  className={`p-6 rounded-xl cursor-pointer transition-all transform hover:scale-105 ${
                    selectedReportType === key
                      ? `bg-gradient-to-br ${info.color} text-white shadow-lg`
                      : 'bg-white border-2 border-gray-200 text-gray-800 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-3 mb-2">
                    <ReportIcon className="w-6 h-6" />
                    <h3 className="font-bold">{info.title}</h3>
                  </div>
                  <p className="text-sm opacity-90">{info.description}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Country Selection */}
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-4">🌍 Select Country</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {supportedCountries.map(country => (
                <div
                  key={country.code}
                  onClick={() => setSelectedCountry(country.code)}
                  className={`p-4 rounded-lg cursor-pointer transition-all border-2 ${
                    selectedCountry === country.code
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-gray-800 flex items-center gap-2">
                        <Globe className="w-4 h-4" />
                        {country.name}
                      </h3>
                      <p className="text-xs text-gray-600 mt-1">{country.regulatoryBody}</p>
                    </div>
                    <span className="text-sm font-bold text-gray-500">{country.currency}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerateReport}
            disabled={isGenerating}
            className={`w-full py-4 px-6 rounded-lg font-bold text-white transition-all flex items-center justify-center gap-2 ${
              isGenerating
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-lg'
            }`}
          >
            {isGenerating ? (
              <>
                <Loader className="w-5 h-5 animate-spin" />
                Generating Report...
              </>
            ) : (
              <>
                <Zap className="w-5 h-5" />
                Generate {currentReportType?.title}
              </>
            )}
          </button>
        </div>
      )}

      {/* Saved Reports Tab */}
      {activeTab === 'saved' && (
        <div className="space-y-4">
          {loading ? (
            <div className="text-center py-8">
              <Loader className="w-8 h-8 animate-spin mx-auto text-blue-600" />
            </div>
          ) : savedReports.length === 0 ? (
            <div className="text-center py-8 text-gray-600">
              <FileText className="w-12 h-12 mx-auto text-gray-400 mb-2" />
              <p>No saved reports yet. Generate your first report to get started!</p>
            </div>
          ) : (
            savedReports.map(report => (
              <div key={report.id} className="bg-white rounded-lg p-4 border border-gray-200 hover:shadow-lg transition-shadow">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <h3 className="font-bold text-gray-800 capitalize">{report.report_type.replace('-', ' ')}</h3>
                    <p className="text-sm text-gray-600">{report.country} • {new Date(report.created_at).toLocaleDateString()}</p>
                    {Array.isArray(report.tags) && report.tags.includes('daily-archive') && (
                      <p className="text-xs text-purple-700 mt-1">Daily transaction archive • found in Reports only</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => alert(`Preview: ${JSON.stringify(report.data, null, 2)}`)}
                      className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-all"
                    >
                      👁️ View
                    </button>
                    <button
                      onClick={() => exportReport(report.data, 'pdf')}
                      className="px-4 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 transition-all flex items-center gap-1"
                    >
                      <Download className="w-4 h-4" />
                      PDF
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Report Preview Modal */}
      {showPreview && generatedReport && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto my-8">
            {/* Modal Header */}
            <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-700 text-white p-6 flex justify-between items-center">
              <h2 className="text-2xl font-bold flex items-center gap-2">
                {generatedReport.type === 'tax-return' && '🧾'}
                {generatedReport.type === 'balance-sheet' && '📊'}
                {generatedReport.type === 'income-statement' && '📈'}
                {generatedReport.country}
              </h2>
              <button onClick={() => setShowPreview(false)} className="text-2xl hover:opacity-80">✕</button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {generatedReport.type === 'tax-return' && (
                  <>
                    <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                      <p className="text-sm text-green-600 font-semibold">Total Income</p>
                      <p className="text-2xl font-bold text-green-800 mt-2">
                        {generatedReport.currency} {generatedReport.incomeSection?.totalGrossIncome?.toLocaleString() || 0}
                      </p>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                      <p className="text-sm text-blue-600 font-semibold">Deductions</p>
                      <p className="text-2xl font-bold text-blue-800 mt-2">
                        {generatedReport.currency} {generatedReport.deductionsSection?.totalDeductions?.toLocaleString() || 0}
                      </p>
                    </div>
                    <div className="bg-orange-50 p-4 rounded-lg border border-orange-200">
                      <p className="text-sm text-orange-600 font-semibold">Tax Liability</p>
                      <p className="text-2xl font-bold text-orange-800 mt-2">
                        {generatedReport.currency} {generatedReport.taxCalculation?.totalTaxLiability?.toLocaleString() || 0}
                      </p>
                    </div>
                    <div className={`p-4 rounded-lg border-2 ${
                      generatedReport.taxCalculation?.taxPayable > 0
                        ? 'bg-red-50 border-red-200'
                        : 'bg-green-50 border-green-200'
                    }`}>
                      <p className="text-sm font-semibold">{generatedReport.taxCalculation?.taxPayable > 0 ? 'Tax Payable' : 'Refund Due'}</p>
                      <p className={`text-2xl font-bold mt-2 ${
                        generatedReport.taxCalculation?.taxPayable > 0 ? 'text-red-800' : 'text-green-800'
                      }`}>
                        {generatedReport.currency} {Math.abs(generatedReport.taxCalculation?.taxPayable)?.toLocaleString() || 0}
                      </p>
                    </div>
                  </>
                )}

                {generatedReport.type === 'balance-sheet' && (
                  <>
                    <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                      <p className="text-sm text-green-600 font-semibold">Total Assets</p>
                      <p className="text-2xl font-bold text-green-800 mt-2">
                        {generatedReport.currency} {generatedReport.assets?.totalAssets?.toLocaleString() || 0}
                      </p>
                    </div>
                    <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                      <p className="text-sm text-red-600 font-semibold">Total Liabilities</p>
                      <p className="text-2xl font-bold text-red-800 mt-2">
                        {generatedReport.currency} {generatedReport.liabilities?.totalLiabilities?.toLocaleString() || 0}
                      </p>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                      <p className="text-sm text-blue-600 font-semibold">Total Equity</p>
                      <p className="text-2xl font-bold text-blue-800 mt-2">
                        {generatedReport.currency} {generatedReport.equity?.totalEquity?.toLocaleString() || 0}
                      </p>
                    </div>
                    <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                      <p className="text-sm text-purple-600 font-semibold">Debt-to-Equity</p>
                      <p className="text-2xl font-bold text-purple-800 mt-2">
                        {generatedReport.ratios?.debtToEquity?.toFixed(2) || 0}
                      </p>
                    </div>
                  </>
                )}

                {generatedReport.type === 'income-statement' && (
                  <>
                    <div className="bg-green-50 p-4 rounded-lg border border-green-200">
                      <p className="text-sm text-green-600 font-semibold">Revenue</p>
                      <p className="text-2xl font-bold text-green-800 mt-2">
                        {generatedReport.currency} {generatedReport.revenue?.totalRevenue?.toLocaleString() || 0}
                      </p>
                    </div>
                    <div className="bg-red-50 p-4 rounded-lg border border-red-200">
                      <p className="text-sm text-red-600 font-semibold">Operating Expenses</p>
                      <p className="text-2xl font-bold text-red-800 mt-2">
                        {generatedReport.currency} {generatedReport.operatingExpenses?.totalOperatingExpenses?.toLocaleString() || 0}
                      </p>
                    </div>
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-200">
                      <p className="text-sm text-blue-600 font-semibold">Net Income</p>
                      <p className="text-2xl font-bold text-blue-800 mt-2">
                        {generatedReport.currency} {generatedReport.netIncome?.amount?.toLocaleString() || 0}
                      </p>
                    </div>
                    <div className="bg-purple-50 p-4 rounded-lg border border-purple-200">
                      <p className="text-sm text-purple-600 font-semibold">Profit Margin</p>
                      <p className="text-2xl font-bold text-purple-800 mt-2">
                        {generatedReport.netIncome?.margin || '0%'}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* AI Insights Section */}
              {generatedReport.taxOptimization?.aiRecommendations && (
                <div className="bg-gradient-to-br from-yellow-50 to-orange-50 border-l-4 border-yellow-500 p-6 rounded-lg">
                  <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-3">
                    <Zap className="w-5 h-5 text-yellow-600" />
                    AI-Powered Optimization Strategy
                  </h3>
                  <p className="text-gray-700">{generatedReport.taxOptimization.aiRecommendations}</p>
                </div>
              )}

              {/* Compliance Requirements */}
              {generatedReport.complianceRequirements && (
                <div className="bg-blue-50 border border-blue-200 p-6 rounded-lg">
                  <h3 className="font-bold text-gray-800 flex items-center gap-2 mb-4">
                    <CheckCircle className="w-5 h-5 text-blue-600" />
                    Compliance Checklist
                  </h3>
                  <div className="space-y-2">
                    {generatedReport.complianceChecklist?.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <input type="checkbox" className="w-4 h-4" />
                        <span className="text-gray-700">{item.item}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Export Section */}
              <div className="bg-gray-50 p-6 rounded-lg">
                <h3 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                  <Download className="w-5 h-5" />
                  Export Report
                </h3>
                <div className="flex gap-3 flex-wrap">
                  <button
                    onClick={() => handleExportReport('pdf')}
                    className="px-6 py-3 bg-red-500 text-white rounded-lg hover:bg-red-600 transition-all font-semibold flex items-center gap-2"
                  >
                    📄 Export as PDF
                  </button>
                  <button
                    onClick={() => handleExportReport('excel')}
                    className="px-6 py-3 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-all font-semibold flex items-center gap-2"
                  >
                    📊 Export as Excel
                  </button>
                  <button
                    onClick={() => handleExportReport('json')}
                    className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all font-semibold flex items-center gap-2"
                  >
                    🔧 Export as JSON
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdvancedFinancialReports;
