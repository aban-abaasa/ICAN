/**
 * Enhanced Report Configuration System
 * Improved UI/UX with advanced filtering, AI insights, and professional templates
 */

import React, { useState, useCallback } from 'react';
import {
  Download,
  Settings,
  Eye,
  Filter,
  Zap,
  ChevronDown,
  Calendar,
  Globe,
  TrendingUp,
  AlertCircle,
  CheckCircle,
  Clock,
  Share2,
  Save,
  RotateCcw
} from 'lucide-react';

export const EnhancedReportConfiguration = ({
  reportTypes,
  onGenerateReport,
  onExportReport,
  isGenerating,
  generatedReport,
  transactions
}) => {
  // Configuration States
  const [reportTitle, setReportTitle] = useState('ICAN Financial Report');
  const [selectedReportType, setSelectedReportType] = useState('financial-summary');
  const [selectedCountry, setSelectedCountry] = useState('UG');
  const [dateRange, setDateRange] = useState('current-month');
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd] = useState('');
  const [exportFormat, setExportFormat] = useState('pdf');
  
  // Advanced Filtering
  const [includeCategories, setIncludeCategories] = useState([]);
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  
  // Display & Export Options
  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const [reportTemplate, setReportTemplate] = useState('professional');
  const [autoRefresh, setAutoRefresh] = useState(false);
  
  // Get unique categories from transactions
  const availableCategories = [...new Set(transactions?.map(t => t.category))].filter(Boolean);

  const reportTypesList = [
    { id: 'financial-summary', name: 'Financial Summary', icon: '📊', color: 'blue' },
    { id: 'income-analysis', name: 'Income Report', icon: '💰', color: 'green' },
    { id: 'expense-breakdown', name: 'Expense Analytics', icon: '💸', color: 'red' },
    { id: 'cash-flow', name: 'Cash Flow', icon: '🔄', color: 'purple' },
    { id: 'tithe-report', name: 'Tithe Report', icon: '⛪', color: 'amber' },
    { id: 'loan-analysis', name: 'Loan Portfolio', icon: '🏦', color: 'indigo' },
    { id: 'business-performance', name: 'Business Intel', icon: '📈', color: 'cyan' },
    { id: 'tax-preparation', name: 'Tax Statements', icon: '🧾', color: 'orange' },
    { id: 'wealth-journey', name: 'Wealth Journey', icon: '🚀', color: 'pink' },
    { id: 'investment-analysis', name: 'Investment', icon: '💼', color: 'violet' },
    { id: 'real-estate', name: 'Real Estate', icon: '🏠', color: 'emerald' },
    { id: 'custom', name: 'Custom Report', icon: '🔧', color: 'slate' }
  ];

  const countries = [
    { code: 'UG', name: 'Uganda', currency: 'UGX', flag: '🇺🇬' },
    { code: 'KE', name: 'Kenya', currency: 'KES', flag: '🇰🇪' },
    { code: 'TZ', name: 'Tanzania', currency: 'TZS', flag: '🇹🇿' },
    { code: 'RW', name: 'Rwanda', currency: 'RWF', flag: '🇷🇼' },
    { code: 'US', name: 'United States', currency: 'USD', flag: '🇺🇸' }
  ];

  const dateRanges = [
    { id: 'today', label: '📅 Today', value: 'today' },
    { id: 'this-week', label: '📆 This Week', value: 'this-week' },
    { id: 'current-month', label: '📊 This Month', value: 'current-month' },
    { id: 'last-month', label: '⏮️ Last Month', value: 'last-month' },
    { id: 'this-quarter', label: '📈 This Quarter', value: 'this-quarter' },
    { id: 'this-year', label: '📅 This Year', value: 'this-year' },
    { id: 'last-year', label: '📆 Last Year', value: 'last-year' },
    { id: 'all-time', label: '♾️ All Time', value: 'all-time' },
    { id: 'custom', label: '🔧 Custom Range', value: 'custom' }
  ];

  const exportFormats = [
    { id: 'pdf', label: 'PDF Document', icon: '📄', color: 'red' },
    { id: 'excel', label: 'Excel Spreadsheet', icon: '📊', color: 'green' },
    { id: 'csv', label: 'CSV Data', icon: '📋', color: 'gray' },
    { id: 'json', label: 'JSON Format', icon: '{}', color: 'yellow' },
    { id: 'html', label: 'Interactive HTML', icon: '🌐', color: 'blue' }
  ];

  const templates = [
    { id: 'professional', name: 'Professional', desc: 'Corporate format with detailed tables' },
    { id: 'simple', name: 'Simple', desc: 'Clean layout with key metrics only' },
    { id: 'detailed', name: 'Detailed', desc: 'In-depth analysis with charts and insights' },
    { id: 'executive', name: 'Executive', desc: 'Summary format for decision makers' },
    { id: 'minimal', name: 'Minimal', desc: 'Essential data only' }
  ];

  const currentReport = reportTypesList.find(r => r.id === selectedReportType);
  const selectedCountryData = countries.find(c => c.code === selectedCountry);

  // Handle category selection
  const toggleCategory = useCallback((category) => {
    setIncludeCategories(prev =>
      prev.includes(category)
        ? prev.filter(c => c !== category)
        : [...prev, category]
    );
  }, []);

  const handleGenerateReport = () => {
    const config = {
      reportType: selectedReportType,
      reportTitle,
      country: selectedCountry,
      dateRange,
      customDateStart: dateRange === 'custom' ? customDateStart : null,
      customDateEnd: dateRange === 'custom' ? customDateEnd : null,
      exportFormat,
      includeCategories,
      filters: {
        minAmount: minAmount ? parseFloat(minAmount) : null,
        maxAmount: maxAmount ? parseFloat(maxAmount) : null
      },
      template: reportTemplate,
      includeAI: true,
      includeCharts: true
    };
    onGenerateReport(config);
  };

  return (
    <div className="space-y-6 p-6 bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-800 flex items-center gap-2">
            <Zap className="w-8 h-8 text-yellow-500" />
            Report Configuration
          </h2>
          <p className="text-gray-600 text-sm mt-1">Customize and generate financial reports with AI insights</p>
        </div>
      </div>

      {/* Main Configuration Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Configuration */}
        <div className="lg:col-span-2 space-y-6">
          {/* Report Title */}
          <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm hover:shadow-md transition-all">
            <label className="block text-sm font-semibold text-gray-700 mb-3">📝 Report Title</label>
            <input
              type="text"
              value={reportTitle}
              onChange={(e) => setReportTitle(e.target.value)}
              placeholder="Enter report title"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
            />
            <p className="text-xs text-gray-500 mt-2">This title will appear on all generated documents</p>
          </div>

          {/* Report Type Selection - Enhanced Grid */}
          <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
            <label className="block text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Settings className="w-4 h-4" />
              Report Type
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {reportTypesList.map(type => (
                <button
                  key={type.id}
                  onClick={() => setSelectedReportType(type.id)}
                  className={`p-4 rounded-lg border-2 transition-all transform hover:scale-105 text-left ${
                    selectedReportType === type.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  <div className="text-2xl mb-2">{type.icon}</div>
                  <div className="text-sm font-semibold text-gray-800">{type.name}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Country & Date Range Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Country Selection */}
            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
              <label className="block text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4" />
                Country
              </label>
              <div className="space-y-2">
                {countries.map(country => (
                  <button
                    key={country.code}
                    onClick={() => setSelectedCountry(country.code)}
                    className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                      selectedCountry === country.code
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-gray-800">
                          {country.flag} {country.name}
                        </div>
                        <div className="text-xs text-gray-600">{country.currency}</div>
                      </div>
                      {selectedCountry === country.code && (
                        <CheckCircle className="w-5 h-5 text-blue-600" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range */}
            <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
              <label className="block text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Date Range
              </label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {dateRanges.map(range => (
                  <button
                    key={range.id}
                    onClick={() => setDateRange(range.value)}
                    className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                      dateRange === range.value
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-semibold text-gray-800">{range.label}</div>
                  </button>
                ))}
              </div>

              {/* Custom Date Range */}
              {dateRange === 'custom' && (
                <div className="mt-4 space-y-2 pt-4 border-t border-gray-200">
                  <input
                    type="date"
                    value={customDateStart}
                    onChange={(e) => setCustomDateStart(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="Start Date"
                  />
                  <input
                    type="date"
                    value={customDateEnd}
                    onChange={(e) => setCustomDateEnd(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="End Date"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Advanced Options Toggle */}
          <button
            onClick={() => setShowAdvancedOptions(!showAdvancedOptions)}
            className="w-full p-4 bg-gradient-to-r from-indigo-50 to-blue-50 border-2 border-indigo-200 rounded-xl font-semibold text-indigo-700 hover:from-indigo-100 hover:to-blue-100 transition-all flex items-center justify-between group"
          >
            <span className="flex items-center gap-2">
              <Filter className="w-5 h-5" />
              Advanced Filtering & Options
            </span>
            <ChevronDown className={`w-5 h-5 transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`} />
          </button>

          {/* Advanced Options */}
          {showAdvancedOptions && (
            <div className="bg-white rounded-xl p-6 border-2 border-indigo-200 shadow-sm space-y-4">
              {/* Amount Filters */}
              <div>
                <h4 className="font-semibold text-gray-800 mb-3">💰 Amount Filters</h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-medium text-gray-600">Minimum</label>
                    <input
                      type="number"
                      value={minAmount}
                      onChange={(e) => setMinAmount(e.target.value)}
                      placeholder="Min amount"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-gray-600">Maximum</label>
                    <input
                      type="number"
                      value={maxAmount}
                      onChange={(e) => setMaxAmount(e.target.value)}
                      placeholder="Max amount"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mt-1"
                    />
                  </div>
                </div>
              </div>

              {/* Category Filter */}
              {availableCategories.length > 0 && (
                <div>
                  <h4 className="font-semibold text-gray-800 mb-3">📂 Categories</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {availableCategories.map(category => (
                      <label key={category} className="flex items-center gap-2 cursor-pointer p-2 hover:bg-gray-50 rounded">
                        <input
                          type="checkbox"
                          checked={includeCategories.includes(category)}
                          onChange={() => toggleCategory(category)}
                          className="w-4 h-4 rounded"
                        />
                        <span className="text-sm text-gray-700 capitalize">{category}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Template Selection */}
              <div>
                <h4 className="font-semibold text-gray-800 mb-3">🎨 Report Template</h4>
                <div className="grid grid-cols-2 gap-2">
                  {templates.map(template => (
                    <button
                      key={template.id}
                      onClick={() => setReportTemplate(template.id)}
                      className={`p-3 rounded-lg border-2 transition-all text-left ${
                        reportTemplate === template.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                      }`}
                    >
                      <div className="font-semibold text-gray-800 text-sm">{template.name}</div>
                      <div className="text-xs text-gray-600">{template.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Export Format Selection */}
          <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
            <label className="block text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Download className="w-4 h-4" />
              Export Format
            </label>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {exportFormats.map(format => (
                <button
                  key={format.id}
                  onClick={() => setExportFormat(format.id)}
                  className={`p-4 rounded-lg border-2 transition-all text-center ${
                    exportFormat === format.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                  }`}
                >
                  <div className="text-2xl mb-2">{format.icon}</div>
                  <div className="text-xs font-semibold text-gray-800">{format.label}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Generate Button */}
          <button
            onClick={handleGenerateReport}
            disabled={isGenerating}
            className={`w-full py-4 px-6 rounded-xl font-bold text-white transition-all flex items-center justify-center gap-2 text-lg ${
              isGenerating
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 shadow-lg hover:shadow-xl'
            }`}
          >
            {isGenerating ? (
              <>
                <Clock className="w-6 h-6 animate-spin" />
                Generating Report...
              </>
            ) : (
              <>
                <Zap className="w-6 h-6" />
                Generate {currentReport?.name}
              </>
            )}
          </button>
        </div>

        {/* Right Column: Preview */}
        <div className="lg:col-span-1">
          {/* Report Summary Card */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-6 border-2 border-blue-200 sticky top-6 space-y-4">
            <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
              <Eye className="w-5 h-5" />
              Report Preview
            </h3>

            {/* Configuration Summary */}
            <div className="space-y-3 text-sm">
              <div className="bg-white p-3 rounded-lg">
                <p className="text-gray-600">📝 <span className="font-semibold">Title:</span></p>
                <p className="text-gray-800 font-semibold text-xs mt-1 truncate">{reportTitle}</p>
              </div>

              <div className="bg-white p-3 rounded-lg">
                <p className="text-gray-600">📊 <span className="font-semibold">Type:</span></p>
                <p className="text-gray-800 font-semibold mt-1">{currentReport?.icon} {currentReport?.name}</p>
              </div>

              <div className="bg-white p-3 rounded-lg">
                <p className="text-gray-600">🌍 <span className="font-semibold">Country:</span></p>
                <p className="text-gray-800 font-semibold mt-1">{selectedCountryData?.flag} {selectedCountryData?.name}</p>
              </div>

              <div className="bg-white p-3 rounded-lg">
                <p className="text-gray-600">📅 <span className="font-semibold">Period:</span></p>
                <p className="text-gray-800 font-semibold text-xs mt-1">
                  {dateRanges.find(r => r.value === dateRange)?.label}
                </p>
              </div>

              <div className="bg-white p-3 rounded-lg">
                <p className="text-gray-600">💾 <span className="font-semibold">Format:</span></p>
                <p className="text-gray-800 font-semibold mt-1">
                  {exportFormats.find(f => f.id === exportFormat)?.label}
                </p>
              </div>
            </div>

            {/* Estimated Metrics */}
            {generatedReport && (
              <div className="bg-white rounded-lg p-4 space-y-2 border-l-4 border-green-500">
                <h4 className="font-bold text-gray-800 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                  Key Metrics
                </h4>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Income:</span>
                    <span className="font-bold text-green-600">{selectedCountryData?.currency} 5,200,000</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Total Expenses:</span>
                    <span className="font-bold text-red-600">{selectedCountryData?.currency} 5,000</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t border-gray-200">
                    <span className="text-gray-600 font-semibold">Net Cash Flow:</span>
                    <span className="font-bold text-blue-600">{selectedCountryData?.currency} 5,195,000</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">Savings Rate:</span>
                    <span className="font-bold text-blue-600">99.9%</span>
                  </div>
                </div>
              </div>
            )}

            {/* AI Insights Badge */}
            <div className="bg-gradient-to-r from-yellow-100 to-orange-100 rounded-lg p-3 border border-yellow-300">
              <p className="text-xs font-semibold text-amber-900 flex items-center gap-2">
                <Zap className="w-4 h-4" />
                AI-Powered Analysis Included
              </p>
              <p className="text-xs text-amber-800 mt-1">Smart recommendations & tax optimization strategies</p>
            </div>

            {/* Action Buttons */}
            <div className="space-y-2 pt-4 border-t border-gray-200">
              <button className="w-full p-3 bg-white border-2 border-gray-300 rounded-lg font-semibold text-gray-700 hover:border-gray-400 transition-all flex items-center justify-center gap-2">
                <Save className="w-4 h-4" />
                Save as Template
              </button>
              <button className="w-full p-3 bg-white border-2 border-gray-300 rounded-lg font-semibold text-gray-700 hover:border-gray-400 transition-all flex items-center justify-center gap-2">
                <Share2 className="w-4 h-4" />
                Share Report
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnhancedReportConfiguration;
