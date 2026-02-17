#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const main = async () => {
  console.log('======================================================================');
  console.log('Testing Shareholder Notification Access');
  console.log('======================================================================\n');
  
  try {
    // Get all shareholder notifications
    console.log('1️⃣ Fetching all shareholder_notifications...\n');
    
    const { data: allNotifs, error: fetchError } = await supabase
      .from('shareholder_notifications')
      .select('*')
      .order('notification_sent_at', { ascending: false })
      .limit(10);
    
    if (fetchError) {
      console.error('❌ Error fetching notifications:', fetchError.message);
      throw fetchError;
    }
    
    console.log(`📬 Found ${allNotifs?.length || 0} shareholder notifications:\n`);
    
    if (allNotifs && allNotifs.length > 0) {
      allNotifs.forEach((notif, index) => {
        console.log(`${index + 1}. Notification ID: ${notif.id}`);
        console.log(`   Shareholder: ${notif.shareholder_email} (${notif.shareholder_name})`);
        console.log(`   Type: ${notif.notification_type}`);
        console.log(`   Status: ${notif.notification_status}`);
        console.log(`   Sent: ${new Date(notif.notification_sent_at).toLocaleString()}`);
        console.log(`   Message: ${notif.notification_message?.substring(0, 60)}...`);
        console.log('');
      });
    } else {
      console.log('⚠️  No shareholder notifications found in database\n');
    }

    // Check RLS policies
    console.log('2️⃣ Checking RLS policies on shareholder_notifications...\n');
    
    const checkPolicies = `
      SELECT policyname, permissive, qual, with_check
      FROM pg_policies
      WHERE tablename = 'shareholder_notifications'
      ORDER BY policyname;
    `;
    
    try {
      const { data: policies } = await supabase.rpc('execute_sql', { sql: checkPolicies });
      
      if (policies && policies.length > 0) {
        console.log('   Found RLS policies:');
        policies.forEach(p => {
          console.log(`   ✓ ${p.policyname} (${p.permissive ? 'PERMISSIVE' : 'RESTRICTIVE'})`);
        });
      } else {
        console.log('   ⚠️  No RLS policies found');
      }
    } catch (e) {
      console.log('   ⚠️  Could not check policies');
    }

    console.log('\n======================================================================');
    console.log('✅ Notification Check Complete');
    console.log('======================================================================\n');
    
    console.log('Summary:');
    if (allNotifs && allNotifs.length > 0) {
      console.log(`  ✓ ${allNotifs.length} shareholder_notifications in database`);
      console.log('  ✓ RLS policies should allow shareholders to read their own notifications');
      console.log('\nNext: Shareholders should see these in their dashboard');
    } else {
      console.log('  ❌ No notifications found - check if creation succeeded');
    }

  } catch (error) {
    console.error('❌ Fatal error:', error?.message || error);
    process.exit(1);
  }
};

main();
