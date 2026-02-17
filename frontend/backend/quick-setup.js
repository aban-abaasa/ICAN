#!/usr/bin/env node

/**
 * QUICK SETUP GUIDE - Business Profile Members
 * 
 * Run this from the backend directory:
 * node quick-setup.js
 */

const fs = require('fs');
const path = require('path');

console.clear();
console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║          ICAN BUSINESS PROFILE MEMBERS - QUICK SETUP GUIDE               ║
╚═══════════════════════════════════════════════════════════════════════════╝

🎯 OBJECTIVE:
   Ensure all business shareholders/co-owners are properly registered
   so they receive notifications when investments are made.

📋 FILES CREATED:
   ✓ BUSINESS_PROFILE_MEMBERS_SETUP.sql     - Database schema
   ✓ BUSINESS_PROFILE_MEMBERS_SETUP.md      - Full documentation
   ✓ setup-business-members.ps1             - Windows setup script
   ✓ setup-business-members.sh              - Linux/Mac setup script
   ✓ setup-business-members.js              - Node.js setup script
   ✓ .env (updated)                         - Environment variables

═══════════════════════════════════════════════════════════════════════════

⚡ QUICKSTART (5 minutes):

1️⃣  SETUP SQL SCHEMA
    Option A (Easiest - Supabase Dashboard):
    • Go to https://supabase.com/dashboard
    • Click "SQL Editor"
    • Create new query
    • Copy entire contents of: BUSINESS_PROFILE_MEMBERS_SETUP.sql
    • Paste and click "Run"
    
    Option B (Via Node.js):
    $ npm run setup:business-members
    
    Option C (Manual - Open and copy statements one by one):
    • Open BUSINESS_PROFILE_MEMBERS_SETUP.sql
    • Execute in Supabase SQL Editor

2️⃣  UPDATE ENVIRONMENT
    Edit: .env
    ✓ These should already be set:
    
    ENABLE_BUSINESS_OWNER_NOTIFICATIONS=true
    ENABLE_SHAREHOLDER_NOTIFICATIONS=true
    SHAREHOLDER_SIGNATURE_DEADLINE_HOURS=24
    SHAREHOLDER_APPROVAL_THRESHOLD_PERCENT=60

3️⃣  MIGRATE EXISTING DATA
    If you have co-owners in business_co_owners table:
    
    $ npm run migrate:co-owners-to-members
    
    Or run this SQL in Supabase:
    SELECT migrate_co_owners_to_members();

═══════════════════════════════════════════════════════════════════════════

✅ VERIFICATION:

After setup, run these SQL queries in Supabase SQL Editor to verify:

1. Check table exists:
   SELECT COUNT(*) as member_count FROM business_profile_members;
   
2. View all members:
   SELECT user_name, role, ownership_share 
   FROM business_profile_members
   ORDER BY ownership_share DESC;
   
3. Test RLS policies:
   SELECT * FROM business_profile_members 
   WHERE user_id = auth.uid();

═══════════════════════════════════════════════════════════════════════════

📊 WHAT THIS ENABLES:

When an investor invests in a business:

BEFORE (❌):
   • Investment recorded
   • Money in escrow
   • But NO ONE is notified
   • Shareholders don't know to sign
   
AFTER (✅):
   • Investment recorded
   • Money in escrow
   • 📧 Business owner gets notification
   • 📧 ALL shareholders get notification
   • ✍️ Shareholders have 24 hours to sign
   • 📋 Documents distributed to all parties

═══════════════════════════════════════════════════════════════════════════

🔧 SYSTEM COMPONENTS:

┌─────────────────────────────────────────────────────────┐
│ When Investor Signs Investment                          │
├─────────────────────────────────────────────────────────┤
│ ↓                                                       │
│ 1. Investor PIN verified                               │
│ 2. Money transferred to escrow                         │
│ 3. Query: SELECT * FROM business_profile_members       │
│ 4. Send notifications to all members                   │
│ 5. Track signature requests (24hr deadline)            │
│ 6. When ≥60% sign → Investment finalized               │
│ 7. Send completion notification to all parties         │
└─────────────────────────────────────────────────────────┘

═══════════════════════════════════════════════════════════════════════════

🗄️  DATABASE SCHEMA:

business_profiles
      ↓
      1 ━━━━ N
      ↓
business_profile_members
   ├─ id
   ├─ business_profile_id (who they belong to)
   ├─ user_id (authenticated user)
   ├─ user_email
   ├─ user_name
   ├─ role (Owner, Co-Owner, Shareholder, etc.)
   ├─ ownership_share (0-100%)
   ├─ can_sign (receive signature requests?)
   ├─ can_receive_notifications (get alerts?)
   └─ status (active, inactive, pending)

═══════════════════════════════════════════════════════════════════════════

🚀 ADVANCED FEATURES:

Available SQL Functions:

1. migrate_co_owners_to_members()
   • Migrates existing co-owners from old table
   • Safe - won't duplicate if already migrated
   
   SELECT migrate_co_owners_to_members();

2. add_investment_shareholders_as_members(investment_id, business_profile_id)
   • Adds investor as shareholder after investment
   • Automatically called after investment signing
   
   SELECT add_investment_shareholders_as_members(
     'investment-uuid'::uuid,
     'business-uuid'::uuid
   );

3. get_shareholders_for_investment(business_profile_id)
   • Gets all signing members of a business
   • Used for shareholder notification
   
   SELECT * FROM get_shareholders_for_investment('business-uuid'::uuid);

═══════════════════════════════════════════════════════════════════════════

🐛 TROUBLESHOOTING:

Problem: "Members not receiving notifications"
Solution: Run verification queries above to check members exist

Problem: "Table doesn't exist"
Solution: Execute BUSINESS_PROFILE_MEMBERS_SETUP.sql again

Problem: "RLS error when querying"
Solution: Add user as member: 
   INSERT INTO business_profile_members (...)
   VALUES (business_id, user_id, email, name, ...);

Problem: "Co-owners not migrated"
Solution: SELECT migrate_co_owners_to_members();

═══════════════════════════════════════════════════════════════════════════

📚 DOCUMENTATION:

Full Guide: BUSINESS_PROFILE_MEMBERS_SETUP.md
This contains:
   • Detailed setup instructions
   • All environment variables
   • SQL function documentation
   • Notification flow diagrams
   • Best practices
   • FAQ & troubleshooting

═══════════════════════════════════════════════════════════════════════════

✨ YOU'RE ALL SET!

Next steps:
1. Complete setup using one of the methods above
2. Verify with SQL queries
3. Create a test investment to see notifications flow
4. Monitor console logs for any issues

Questions? Check BUSINESS_PROFILE_MEMBERS_SETUP.md

═══════════════════════════════════════════════════════════════════════════
`);

// Check if setup is already complete
const checkSetup = async () => {
  try {
    const envFile = path.join(__dirname, '.env');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf-8');
      if (content.includes('ENABLE_BUSINESS_OWNER_NOTIFICATIONS')) {
        console.log('\n✅ Environment file already configured!');
        console.log('\n   Next: Execute BUSINESS_PROFILE_MEMBERS_SETUP.sql in Supabase');
      }
    }
  } catch (e) {
    // Ignore
  }
};

checkSetup();
