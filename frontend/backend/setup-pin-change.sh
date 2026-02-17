#!/bin/bash
# PIN Change Feature - Quick Setup Script
# Run this to set up the PIN change feature

echo "🚀 ICAN PIN Change Feature Setup"
echo "=================================="
echo ""

# Step 1: Install dependencies
echo "📦 Step 1: Installing Twilio dependency..."
cd frontend
npm install twilio
echo "✅ Twilio installed"
echo ""

# Step 2: Check .env file
echo "🔑 Step 2: Environment Variables"
echo "Make sure your .env file has:"
echo ""
echo "TWILIO_ACCOUNT_SID=your_sid"
echo "TWILIO_AUTH_TOKEN=your_token"
echo "TWILIO_PHONE_NUMBER=+1234567890"
echo "SUPABASE_URL=your_url"
echo "SUPABASE_SERVICE_ROLE_KEY=your_key"
echo "NODE_ENV=production"
echo ""
echo "⚠️  Update these values in .env before proceeding!"
echo ""

# Step 3: Remind about SQL migration
echo "🗄️  Step 3: Database Migration"
echo "Run this in Supabase SQL Editor:"
echo "  1. Go to Supabase Dashboard"
echo "  2. Navigate to SQL Editor"
echo "  3. Create new query"
echo "  4. Copy contents from: OTP_SECURITY_TABLES.sql"
echo "  5. Execute the query"
echo ""

# Step 4: Start server
echo "🎯 Step 4: Starting Backend Server"
echo "Run: npm start"
echo ""

# Step 5: Verify
echo "✅ Step 5: Verification"
echo "Test with: curl http://localhost:5000/health"
echo ""

echo "📋 For detailed setup guide, see: PIN_CHANGE_SETUP_GUIDE.md"
echo "📋 For deployment checklist, see: DEPLOYMENT_CHECKLIST.md"
echo ""
echo "🎉 Setup ready! Follow the steps above to complete."
