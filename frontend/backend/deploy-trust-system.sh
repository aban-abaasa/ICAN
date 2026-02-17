#!/bin/bash
# QUICK FIX: Deploy Trust System Tables
# Error: relation "public.trust_transactions" does not exist
#
# Run this script to deploy the trust system to your Supabase database

echo "======================================"
echo "TRUST SYSTEM DEPLOYMENT"
echo "======================================"
echo ""
echo "This script will create the missing trust_transactions table"
echo "and all related trust system tables in your Supabase database."
echo ""
echo "Prerequisites:"
echo "  1. Have PostgreSQL client (psql) installed"
echo "  2. Know your Supabase database password"
echo "  3. Update DATABASE_URL if different from below"
echo ""

# Configuration
DB_HOST="hswxazpxcgtqbxeqcxxw.supabase.co"
DB_USER="postgres"
DB_NAME="postgres"
SQL_FILE="backend/db/DEPLOY_TRUST_SYSTEM.sql"

echo "Database Host: $DB_HOST"
echo "Database User: $DB_USER"
echo "SQL Script: $SQL_FILE"
echo ""

# Check if SQL file exists
if [ ! -f "$SQL_FILE" ]; then
    echo "❌ ERROR: SQL file not found: $SQL_FILE"
    echo "Make sure you're running this from the project root directory"
    exit 1
fi

echo "✓ SQL file found"
echo ""
echo "Proceed? (y/n)"
read -r response

if [ "$response" != "y" ]; then
    echo "Deployment cancelled."
    exit 0
fi

echo ""
echo "Deploying..."
echo ""

# Run the SQL script
psql -h "$DB_HOST" \
     -U "$DB_USER" \
     -d "$DB_NAME" \
     -f "$SQL_FILE"

RESULT=$?

echo ""
echo "======================================"
if [ $RESULT -eq 0 ]; then
    echo "✓ DEPLOYMENT SUCCESSFUL"
    echo ""
    echo "Next steps:"
    echo "  1. Refresh your browser (Ctrl+F5 to clear cache)"
    echo "  2. Navigate to Trust Management / SACCOHub"
    echo "  3. Check browser console for errors"
    echo ""
    echo "Verify in Supabase:"
    echo "  1. Go to https://app.supabase.com"
    echo "  2. Select your project"
    echo "  3. Database > Tables"
    echo "  4. Verify tables exist:"
    echo "     - trust_groups"
    echo "     - trust_group_members"
    echo "     - trust_transactions     ← THIS WAS MISSING"
    echo "     - trust_cycles"
    echo "     - trust_disputes"
else
    echo "❌ DEPLOYMENT FAILED"
    echo ""
    echo "Troubleshooting:"
    echo "  1. Check your database password is correct"
    echo "  2. Ensure you have permission to create tables"
    echo "  3. Try deploying via Supabase SQL Editor instead:"
    echo "     - Copy file: backend/db/DEPLOY_TRUST_SYSTEM.sql"
    echo "     - Paste in: https://app.supabase.com/project/YOUR-PROJECT/sql/new"
    echo "     - Click Run"
fi
echo "======================================"

exit $RESULT
