require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  try {
    const investmentId = '077e9c93-3895-4148-883b-f1dc586adaf9';
    const businessProfileId = '35a1d558-d256-465b-bb16-b023eafb5388';
    
    console.log('='.repeat(60));
    console.log('MANUAL TRIGGER: Create Shareholder Notifications');
    console.log('='.repeat(60));
    
    // Step 1: Get co-owners
    console.log('\n1️⃣ Fetching co-owners...');
    const { data: coOwners, error: coError } = await supabase
      .from('business_co_owners')
      .select('id, owner_name, owner_email, user_id, ownership_share, status')
      .eq('business_profile_id', businessProfileId);
    
    if (coError) throw coError;
    
    console.log(`   Found ${coOwners.length} co-owners`);
    coOwners.forEach(co => {
      console.log(`   - ${co.owner_name} (${co.ownership_share}%) - user_id: ${co.user_id || 'NULL'}`);
    });
    
    // Step 2: Filter active co-owners
    const activeCoOwners = coOwners.filter(owner => !owner.status || owner.status === 'active');
    console.log(`\n2️⃣ Active co-owners: ${activeCoOwners.length}`);
    
    // Step 3: Create notifications
    console.log('\n3️⃣ Creating shareholder notifications...');
    
    let successCount = 0;
    let failCount = 0;
    
    for (const owner of activeCoOwners) {
      // Check if owner has user_id
      if (!owner.user_id) {
        console.log(`   ⚠️ SKIP ${owner.owner_name}: No user_id set`);
        failCount++;
        continue;
      }
      
      // Create notification for this shareholder
      const { data: notifInsert, error: notifError } = await supabase
        .from('shareholder_notifications')
        .insert({
          investment_id: investmentId,
          shareholder_id: owner.user_id,  // Use user_id (auth.uid)
          shareholder_email: owner.owner_email,
          shareholder_name: owner.owner_name,
          notification_type: 'pin_request',
          notification_status: 'sent',
          pin_entry_required: true,
          pin_verified: false,
          approval_percent: 0,
          notification_message: 'Investment signature received. Please enter your PIN to verify your approval.',
          notification_sent_at: new Date().toISOString()
        })
        .select();
      
      if (notifError) {
        console.log(`   ❌ FAILED to notify ${owner.owner_name}: ${notifError.message}`);
        failCount++;
      } else if (notifInsert && notifInsert[0]) {
        console.log(`   ✅ Notified: ${owner.owner_name}`);
        console.log(`      → Notification ID: ${notifInsert[0].id}`);
        console.log(`      → Shareholder ID: ${owner.user_id}`);
        successCount++;
      }
    }
    
    console.log(`\n✅ Notifications created: ${successCount}/${activeCoOwners.length}`);
    
    // Step 4: Verify notifications were created
    console.log('\n4️⃣ Verifying notifications...');
    const { data: notifications } = await supabase
      .from('shareholder_notifications')
      .select('id, shareholder_id, shareholder_email, notification_status, created_at')
      .eq('investment_id', investmentId);
    
    if (!notifications || notifications.length === 0) {
      console.log('   ❌ No notifications found in database!');
    } else {
      console.log(`   ✅ Found ${notifications.length} notification(s) in database:`);
      notifications.forEach(notif => {
        console.log(`      - ${notif.shareholder_email}: ${notif.notification_status}`);
      });
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('COMPLETE');
    console.log('='.repeat(60));
    
  } catch(e) {
    console.error('❌ Error:', e.message);
    console.error(e);
  }
})();
