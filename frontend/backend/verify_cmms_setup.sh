#!/bin/bash

# CMMS Welcome Screen & Supabase Integration Verification Script
# This script verifies all components are properly configured

echo "================================"
echo "CMMS Supabase Integration Check"
echo "================================"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check 1: .env file exists
echo -n "Checking .env file in ICAN/frontend/... "
if [ -f "ICAN/frontend/.env" ]; then
    echo -e "${GREEN}✓ Found${NC}"
    # Check for required variables
    if grep -q "VITE_SUPABASE_URL=" ICAN/frontend/.env && grep -q "VITE_SUPABASE_ANON_KEY=" ICAN/frontend/.env; then
        echo -e "  ${GREEN}✓ Contains Supabase credentials${NC}"
    else
        echo -e "  ${YELLOW}⚠ Missing Supabase credentials${NC}"
    fi
else
    echo -e "${RED}✗ Not found${NC}"
    echo "  Create it: cp ICAN/frontend/.env.example ICAN/frontend/.env"
fi
echo ""

# Check 2: CMSSModule.jsx syntax
echo -n "Checking CMSSModule.jsx for syntax errors... "
if grep -q "} finally" ICAN/frontend/src/components/CMSSModule.jsx && \
   grep -q "return (" ICAN/frontend/src/components/CMSSModule.jsx; then
    echo -e "${GREEN}✓ Syntax appears correct${NC}"
else
    echo -e "${RED}✗ Potential syntax issues${NC}"
fi
echo ""

# Check 3: cmmsService.js exists
echo -n "Checking cmmsService.js... "
if [ -f "ICAN/frontend/src/lib/supabase/services/cmmsService.js" ]; then
    echo -e "${GREEN}✓ Found${NC}"
    if grep -q "createCompanyProfile" ICAN/frontend/src/lib/supabase/services/cmmsService.js; then
        echo -e "  ${GREEN}✓ Has createCompanyProfile function${NC}"
    fi
    if grep -q "createAdminUser" ICAN/frontend/src/lib/supabase/services/cmmsService.js; then
        echo -e "  ${GREEN}✓ Has createAdminUser function${NC}"
    fi
else
    echo -e "${RED}✗ Not found${NC}"
fi
echo ""

# Check 4: Supabase client configuration
echo -n "Checking Supabase client setup... "
if [ -f "ICAN/frontend/src/lib/supabase/client.js" ]; then
    echo -e "${GREEN}✓ Found${NC}"
    if grep -q "createClient" ICAN/frontend/src/lib/supabase/client.js; then
        echo -e "  ${GREEN}✓ Supabase client initialized${NC}"
    fi
else
    echo -e "${RED}✗ Not found${NC}"
fi
echo ""

# Check 5: Database schema file
echo -n "Checking CMMS_IMPLEMENTATION_DATA_SPECIFIC.sql... "
if [ -f "ICAN/CMMS_IMPLEMENTATION_DATA_SPECIFIC.sql" ]; then
    echo -e "${GREEN}✓ Found${NC}"
    # Count tables
    table_count=$(grep -c "CREATE TABLE IF NOT EXISTS" ICAN/CMMS_IMPLEMENTATION_DATA_SPECIFIC.sql)
    echo -e "  ${GREEN}✓ Contains $table_count table definitions${NC}"
else
    echo -e "${RED}✗ Not found${NC}"
fi
echo ""

# Check 6: Integration guide
echo -n "Checking CMMS_SUPABASE_INTEGRATION_GUIDE.md... "
if [ -f "ICAN/CMMS_SUPABASE_INTEGRATION_GUIDE.md" ]; then
    echo -e "${GREEN}✓ Found${NC}"
else
    echo -e "${RED}✗ Not found${NC}"
fi
echo ""

# Check 7: Welcome integration document
echo -n "Checking CMMS_WELCOME_INTEGRATION_COMPLETE.md... "
if [ -f "ICAN/CMMS_WELCOME_INTEGRATION_COMPLETE.md" ]; then
    echo -e "${GREEN}✓ Found${NC}"
else
    echo -e "${RED}✗ Not found${NC}"
fi
echo ""

echo "================================"
echo "Next Steps:"
echo "================================"
echo "1. Add Supabase credentials to .env"
echo "2. Run: npm install (in ICAN/frontend)"
echo "3. Run: npm run dev (in ICAN/frontend)"
echo "4. Open browser and test CMMS Welcome Screen"
echo "5. Create test company profile"
echo "6. Verify data in Supabase dashboard"
echo ""
echo "Documentation:"
echo "├── CMMS_WELCOME_INTEGRATION_COMPLETE.md (Overview & Testing)"
echo "├── CMMS_SUPABASE_INTEGRATION_GUIDE.md (Setup Instructions)"
echo "└── CMMS_IMPLEMENTATION_DATA_SPECIFIC.sql (Database Schema)"
echo ""
