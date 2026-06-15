#!/bin/bash

# =====================================================
# ICAN BUSINESS PROFILE MEMBERS SETUP SCRIPT
# =====================================================
# Sets up the business profile members table and
# configures environment variables for shareholder notifications

echo "🔧 ICAN Business Profile Members Setup"
echo "======================================="
echo ""

# Color codes
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Check environment
echo -e "${BLUE}Step 1: Checking environment variables...${NC}"

if [ -z "$SUPABASE_URL" ]; then
    echo "⚠️  SUPABASE_URL not set. Using default..."
    export SUPABASE_URL="https://hswxazpxcgtqbxeqcxxw.supabase.co"
fi

if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
    echo "⚠️  SUPABASE_SERVICE_ROLE_KEY not set. Using default..."
    export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzd3hhenB4Y2d0cWJ4ZXFjeHh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjE0MTU3MCwiZXhwIjoyMDY3NzE3NTcwfQ.ljWN-RgMNI5vd9ueq2Ybs4b2a9e_i_tu51uRehrltWw"
fi

echo -e "${GREEN}✓ Environment variables set${NC}"
echo ""

# Step 2: Check Node.js
echo -e "${BLUE}Step 2: Checking Node.js installation...${NC}"

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install Node.js 16+${NC}"
    exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}✓ Node.js ${NODE_VERSION} found${NC}"
echo ""

# Step 3: Check .env file
echo -e "${BLUE}Step 3: Setting up environment file...${NC}"

if [ ! -f ".env" ]; then
    echo "Creating .env file..."
    cp .env.example .env 2>/dev/null || echo "No .env.example found, creating minimal .env"
    
    cat >> .env << EOF
# ICAN Capital Engine - Environment Variables
SUPABASE_URL=$SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY=$SUPABASE_SERVICE_ROLE_KEY

# Notifications
ENABLE_BUSINESS_OWNER_NOTIFICATIONS=true
ENABLE_SHAREHOLDER_NOTIFICATIONS=true
NOTIFICATION_TIMEOUT_MS=5000

# Shareholder Settings
SHAREHOLDER_SIGNATURE_DEADLINE_HOURS=24
SHAREHOLDER_APPROVAL_THRESHOLD_PERCENT=60

# Features
ALLOW_TEST_NOTIFICATIONS=true
LOG_NOTIFICATIONS=true
EOF
    
    echo -e "${GREEN}✓ .env file created${NC}"
else
    echo -e "${GREEN}✓ .env file exists${NC}"
    
    # Update .env with notification settings
    if ! grep -q "ENABLE_BUSINESS_OWNER_NOTIFICATIONS" .env; then
        echo "Adding notification settings to .env..."
        echo "" >> .env
        echo "# Notifications" >> .env
        echo "ENABLE_BUSINESS_OWNER_NOTIFICATIONS=true" >> .env
        echo "ENABLE_SHAREHOLDER_NOTIFICATIONS=true" >> .env
        echo "NOTIFICATION_TIMEOUT_MS=5000" >> .env
        echo "SHAREHOLDER_SIGNATURE_DEADLINE_HOURS=24" >> .env
        echo "SHAREHOLDER_APPROVAL_THRESHOLD_PERCENT=60" >> .env
        echo "ALLOW_TEST_NOTIFICATIONS=true" >> .env
        echo "LOG_NOTIFICATIONS=true" >> .env
    fi
fi

echo ""

# Step 4: Display Summary
echo -e "${BLUE}Step 4: Configuration Summary${NC}"
echo "======================================="
echo -e "Supabase URL: ${YELLOW}${SUPABASE_URL:0:30}...${NC}"
echo -e "Node.js: ${YELLOW}${NODE_VERSION}${NC}"
echo -e "Business Owner Notifications: ${YELLOW}ENABLED${NC}"
echo -e "Shareholder Notifications: ${YELLOW}ENABLED${NC}"
echo -e "Signature Deadline: ${YELLOW}24 hours${NC}"
echo -e "Approval Threshold: ${YELLOW}60%${NC}"
echo ""

# Step 5: Next steps
echo -e "${GREEN}✓ Setup Complete!${NC}"
echo ""
echo -e "${BLUE}Next Steps:${NC}"
echo "1. Apply SQL schema: psql < BUSINESS_PROFILE_MEMBERS_SETUP.sql"
echo "   Or run: npm run db:setup"
echo ""
echo "2. Migrate existing co-owners:"
echo "   npm run migrate:co-owners"
echo ""
echo "3. Verify setup:"
echo "   npm run verify:members"
echo ""
echo "4. Test notifications:"
echo "   npm run test:notifications"
echo ""

echo -e "${YELLOW}Documentation: See BUSINESS_PROFILE_MEMBERS_SETUP.md${NC}"
