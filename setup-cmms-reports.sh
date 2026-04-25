#!/bin/bash

# CMMS Reports Setup and Testing Script
# Run this script to set up and test the CMMS Reports implementation

echo "=========================================="
echo "CMMS Reports Implementation Setup"
echo "=========================================="
echo ""

# Step 1: Install NPM packages
echo "[1/4] Installing required NPM packages..."
npm install docx jspdf jszip

if [ $? -ne 0 ]; then
  echo "❌ Failed to install packages. Please check npm and try again."
  exit 1
fi
echo "✅ Packages installed successfully"
echo ""

# Step 2: Verify files exist
echo "[2/4] Verifying implementation files..."
files=(
  "backend/FIX_CMMS_REPORTS_RLS_POLICIES.sql"
  "frontend/src/lib/supabase/services/cmmsService.js"
  "frontend/src/lib/utils/reportExport.js"
  "frontend/src/components/CMMS/CMSSReportsView.jsx"
  "CMMS_REPORTS_IMPLEMENTATION_GUIDE.md"
)

all_exist=true
for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✅ $file"
  else
    echo "  ❌ Missing: $file"
    all_exist=false
  fi
done
echo ""

if [ "$all_exist" = false ]; then
  echo "❌ Some files are missing. Please check the file structure."
  exit 1
fi
echo "✅ All implementation files found"
echo ""

# Step 3: Deployment instructions
echo "[3/4] Deployment Instructions"
echo "=============================="
echo ""
echo "📋 SQL Deployment:"
echo "  1. Go to Supabase Dashboard"
echo "  2. Navigate to SQL Editor"
echo "  3. Create a new query"
echo "  4. Copy contents of: backend/FIX_CMMS_REPORTS_RLS_POLICIES.sql"
echo "  5. Execute the query"
echo ""
echo "💻 Frontend Deployment:"
echo "  1. Update your component routing to include CMSSReportsView"
echo "  2. Pass the required props: companyId, userRole, userDepartmentId"
echo "  3. Test with different user roles to verify access control"
echo ""

# Step 4: Testing checklist
echo "[4/4] Testing Checklist"
echo "======================"
echo ""
echo "Before deploying to production, verify:"
echo ""
echo "🔐 Access Control:"
echo "  [ ] Admin can see all reports"
echo "  [ ] Finance can see all reports"
echo "  [ ] Coordinator can see department reports"
echo "  [ ] Supervisor can see department reports"
echo "  [ ] Members can see only their own reports"
echo ""
echo "📊 Filtering:"
echo "  [ ] Status filter works (open, in_review, resolved, closed)"
echo "  [ ] Category filter works"
echo "  [ ] Department filter works (admin/finance only)"
echo "  [ ] Sorting works (created_at, severity, title)"
echo ""
echo "💾 Export:"
echo "  [ ] PDF export downloads correctly"
echo "  [ ] Word (.docx) export downloads correctly"
echo "  [ ] Text (.txt) export downloads correctly"
echo "  [ ] Export includes all report details"
echo ""
echo "📱 UI/UX:"
echo "  [ ] Reports load without errors"
echo "  [ ] Filters respond quickly"
echo "  [ ] Export buttons show loading state"
echo "  [ ] Sorting updates report order immediately"
echo ""

echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "Next Steps:"
echo "1. Deploy SQL schema to Supabase"
echo "2. Add CMSSReportsView component to your routing"
echo "3. Run through testing checklist"
echo "4. Deploy to staging environment"
echo "5. Run final acceptance tests"
echo "6. Deploy to production"
echo ""
echo "For more information, see: CMMS_REPORTS_IMPLEMENTATION_GUIDE.md"
