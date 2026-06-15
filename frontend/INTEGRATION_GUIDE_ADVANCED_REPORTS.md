/**
 * Integration Guide: How to Add Advanced Financial Reports to ICAN Capital Engine
 * 
 * This file shows how to integrate the new AdvancedFinancialReports component
 * with your existing ICAN_Capital_Engine component
 */

// ============================================
// STEP 1: Import the Component
// ============================================

import AdvancedFinancialReports from './AdvancedFinancialReports';

// ============================================
// STEP 2: Add State to ICAN_Capital_Engine
// ============================================

// Inside your ICAN_Capital_Engine component, add:

const [showAdvancedReports, setShowAdvancedReports] = useState(false);

// ============================================
// STEP 3: Add Button to UI
// ============================================

// In your navigation/menu section, add this button:

<button
  onClick={() => setShowAdvancedReports(true)}
  className="group relative w-14 h-14 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-full shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-110 flex items-center justify-center cursor-pointer"
  title="Advanced Financial Reports"
>
  <div className="absolute inset-0 bg-gradient-to-r from-indigo-400 to-purple-500 rounded-full blur opacity-70 group-hover:opacity-100 transition-opacity"></div>
  <span className="relative text-white text-xl">🧾</span>
  
  {/* Tooltip */}
  <div className="absolute bottom-16 right-0 bg-gray-900 text-white text-xs py-2 px-3 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
    Professional Reports: Tax Returns, Balance Sheets, Income Statements
    <div className="absolute top-full right-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
  </div>
</button>

// ============================================
// STEP 4: Add Modal Component
// ============================================

// Add this to the end of your render, before closing tags:

{showAdvancedReports && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-y-auto">
      {/* Close Button */}
      <div className="sticky top-0 bg-gradient-to-r from-indigo-600 to-purple-700 text-white p-4 flex justify-between items-center z-10">
        <h2 className="text-2xl font-bold">Professional Financial Reports System</h2>
        <button
          onClick={() => setShowAdvancedReports(false)}
          className="text-2xl hover:opacity-80 transition-opacity"
        >
          ✕
        </button>
      </div>
      
      {/* Component */}
      <AdvancedFinancialReports
        userId={user?.id}
        transactions={transactions}
        userProfile={user}
      />
    </div>
  </div>
)}

// ============================================
// STEP 5: Full Integration Code Example
// ============================================

const IntegratedICANCapitalEngine = () => {
  // ... existing state ...
  const [showAdvancedReports, setShowAdvancedReports] = useState(false);

  return (
    <div className="space-y-6">
      {/* Existing UI */}
      
      {/* Add Advanced Reports Button to Navigation */}
      <div className="flex gap-4 flex-wrap">
        {/* ... existing buttons ... */}
        
        <button
          onClick={() => setShowAdvancedReports(true)}
          className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-purple-600 text-white rounded-lg hover:shadow-lg transition-all font-semibold flex items-center gap-2"
        >
          🧾 Professional Reports
        </button>
      </div>

      {/* Advanced Reports Modal */}
      {showAdvancedReports && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full my-8">
            <div className="sticky top-0 bg-gradient-to-r from-indigo-600 to-purple-700 text-white p-6 flex justify-between items-center">
              <div>
                <h2 className="text-3xl font-bold">🧾 Professional Financial Reports</h2>
                <p className="text-indigo-100 mt-1">Tax Returns • Balance Sheets • Income Statements with AI Analysis</p>
              </div>
              <button
                onClick={() => setShowAdvancedReports(false)}
                className="text-3xl hover:opacity-80 transition-opacity"
              >
                ✕
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-150px)]">
              <AdvancedFinancialReports
                userId={user?.id}
                transactions={transactions}
                userProfile={user}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================
// STEP 6: Add Menu Item (Optional)
// ============================================

// If you have a sidebar/menu, add this:

const menuItems = [
  // ... existing items ...
  {
    label: 'Professional Reports',
    icon: FileText,
    onClick: () => setShowAdvancedReports(true),
    color: 'from-indigo-500 to-purple-600',
    description: 'Tax Returns, Balance Sheets, Income Statements'
  }
];

// ============================================
// STEP 7: Add to Quick Actions
// ============================================

// In your quick actions section:

<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  {/* ... existing quick actions ... */}
  
  <div
    onClick={() => setShowAdvancedReports(true)}
    className="bg-gradient-to-br from-indigo-500 to-purple-600 p-6 rounded-xl cursor-pointer hover:shadow-lg transition-all text-white"
  >
    <div className="text-4xl mb-2">🧾</div>
    <h3 className="font-bold text-lg mb-1">Professional Reports</h3>
    <p className="text-sm opacity-90">Generate tax returns, balance sheets, income statements with AI analysis</p>
  </div>
</div>

// ============================================
// STEP 8: Keyboard Shortcut (Optional)
// ============================================

// Add keyboard shortcut support:

useEffect(() => {
  const handleKeyPress = (e) => {
    // Ctrl/Cmd + Shift + R to open reports
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'R') {
      setShowAdvancedReports(true);
    }
  };

  window.addEventListener('keydown', handleKeyPress);
  return () => window.removeEventListener('keydown', handleKeyPress);
}, []);

// ============================================
// STEP 9: Add to Dashboard
// ============================================

// Show report summary on dashboard:

const ReportsSummary = () => {
  const [savedReports, setSavedReports] = useState([]);

  useEffect(() => {
    const loadReports = async () => {
      const reports = await getSavedReports(user?.id);
      setSavedReports(reports || []);
    };
    loadReports();
  }, [user?.id]);

  return (
    <div className="bg-white rounded-lg p-6 shadow-md">
      <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
        📊 Recent Reports ({savedReports.length})
      </h3>
      
      {savedReports.length === 0 ? (
        <p className="text-gray-600">
          No reports yet.{' '}
          <button
            onClick={() => setShowAdvancedReports(true)}
            className="text-blue-600 hover:underline font-semibold"
          >
            Generate your first report
          </button>
        </p>
      ) : (
        <div className="space-y-2">
          {savedReports.slice(0, 5).map(report => (
            <div key={report.id} className="flex justify-between items-center p-3 bg-gray-50 rounded">
              <div>
                <p className="font-semibold capitalize">{report.report_type.replace('-', ' ')}</p>
                <p className="text-sm text-gray-600">{report.country}</p>
              </div>
              <button
                onClick={() => exportReport(report.data, 'pdf')}
                className="px-3 py-1 bg-blue-500 text-white rounded text-sm hover:bg-blue-600"
              >
                Download
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================
// STEP 10: Complete Integration Checklist
// ============================================

/*
Setup Checklist:

☐ 1. Run SQL migration in Supabase
   - Go to Supabase Dashboard
   - Open SQL Editor
   - Paste CREATE_ADVANCED_FINANCIAL_REPORTS_SCHEMA.sql
   - Execute

☐ 2. Set environment variables
   - Add REACT_APP_OPENAI_API_KEY to .env.local
   - Get key from https://platform.openai.com/api-keys

☐ 3. Install package.json dependencies
   - Already included (lucide-react, etc.)
   - No new packages needed

☐ 4. Import component
   - import AdvancedFinancialReports from './components/AdvancedFinancialReports'

☐ 5. Add state
   - const [showAdvancedReports, setShowAdvancedReports] = useState(false)

☐ 6. Add button/menu item
   - Add click handler to setShowAdvancedReports(true)

☐ 7. Add modal component
   - Render conditionally when showAdvancedReports is true

☐ 8. Test report generation
   - Click button
   - Select report type and country
   - Click Generate
   - Verify report appears
   - Test export options

☐ 9. Test saving to Supabase
   - Generate a report
   - Check Supabase financial_reports table
   - Verify data saved

☐ 10. Deploy
   - Commit changes to git
   - Deploy to production
   - Announce feature to users
*/

// ============================================
// USAGE TIPS
// ============================================

/*
🎯 Best Practices:

1. Place Reports Button in Main Navigation
   - Most visible location
   - Easy access for users
   - Consider adding keyboard shortcut

2. Add Dashboard Widget
   - Show recent reports on dashboard
   - Quick links to re-generate
   - Statistics on report usage

3. Help Text
   - Add tooltips for features
   - Link to PDF guide
   - Show video tutorial

4. Performance
   - Reports generate in background
   - Show progress indicator
   - Cache results for quick access

5. Mobile Optimization
   - Full-screen modal on mobile
   - Touch-friendly export buttons
   - Responsive data tables

6. User Feedback
   - Success notification after generation
   - Error messages if something fails
   - Loading spinner during generation

7. Analytics
   - Track report generation events
   - Monitor feature usage
   - Identify popular reports

8. Maintenance
   - Monitor OpenAI API costs
   - Check database growth
   - Archive old reports
*/

export default IntegratedICANCapitalEngine;
