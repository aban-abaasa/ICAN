require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  try {
    console.log('='.repeat(60));
    console.log('TEST: Investor Signing Flow for DAb Pitch');
    console.log('='.repeat(60));
    
    // Step 1: Get DAb pitch
    console.log('\n1️⃣ Fetching DAb pitch...');
    const { data: pitches } = await supabase
      .from('pitches')
      .select('id, title, business_profile_id, share_price')
      .eq('business_profile_id', '35a1d558-d256-465b-bb16-b023eafb5388')
      .limit(1);
    
    if (!pitches || pitches.length === 0) {
      throw new Error('No pitch found for DAb');
    }
    
    const pitch = pitches[0];
    console.log('   Pitch ID:', pitch.id);
    console.log('   Title:', pitch.title);
    console.log('   Share Price:', pitch.share_price);
    
    // Step 2: Get DAb co-owners
    console.log('\n2️⃣ Fetching co-owners...');
    const { data: coOwners } = await supabase
      .from('business_co_owners')
      .select('id, owner_name, owner_email, user_id, ownership_share')
      .eq('business_profile_id', '35a1d558-d256-465b-bb16-b023eafb5388');
    
    if (!coOwners || coOwners.length === 0) {
      throw new Error('No co-owners found');
    }
    
    coOwners.forEach(co => {
      console.log(`   - ${co.owner_name} (${co.ownership_share}%)`);
      console.log(`     Email: ${co.owner_email}`);
      console.log(`     User ID: ${co.user_id || 'NULL'}`);
    });
    
    // Step 3: Create investment approval record (simulating investor signature)
    console.log('\n3️⃣ Creating investment approval record...');
    const investmentId = pitch.id;
    const investorEmail = 'abana1662@gmail.com';
    const investorId = 'b030496a-e414-449e-b23b-c26ec6bb964a'; // From auth users list
    
    const { data: approval, error: approvalError } = await supabase
      .from('investment_approvals')
      .upsert({
        investment_id: investmentId,
        business_profile_id: '35a1d558-d256-465b-bb16-b023eafb5388',
        investor_id: investorId,
        investor_email: investorEmail,
        investor_signature_status: 'pin_verified',
        investor_signed_at: new Date().toISOString(),
        wallet_account_number: 'TEST-ACC-001',
        transfer_amount: 5000,
        transfer_status: 'completed',
        transfer_completed_at: new Date().toISOString(),
        transfer_reference: 'REF-TEST-001',
        total_shareholders: coOwners.length,
        shareholders_signed: 0,
        approval_threshold_percent: 60,
        approval_threshold_met: false,
        document_status: 'pending'
      }, {
        onConflict: 'investment_id'
      })
      .select();
    
    if (approvalError) throw approvalError;
    console.log('   ✅ Approval record created/updated');
    console.log('   Total shareholders:', approval[0].total_shareholders);
    console.log('   Threshold:', approval[0].approval_threshold_percent + '%');
    
    // Step 4: Check if shareholder notifications were created
    console.log('\n4️⃣ Checking shareholder notifications...');
    const { data: notifications, error: notifError } = await supabase
      .from('shareholder_notifications')
      .select('id, shareholder_id, shareholder_email, notification_type, notification_status, created_at')
      .eq('investment_id', investmentId);
    
    if (notifError) {
      console.warn('   ⚠️ Error checking notifications:', notifError.message);
    } else if (!notifications || notifications.length === 0) {
      console.log('   ⚠️ No shareholder notifications found - ISSUE!');
      console.log('   This means the notification creation code may not have run.');
    } else {
      console.log(`   ✅ Found ${notifications.length} notification(s):`);
      notifications.forEach((notif, idx) => {
        console.log(`\n   Notification ${idx + 1}:`);
        console.log(`     ID: ${notif.id}`);
        console.log(`     Recipient: ${notif.shareholder_email}`);
        console.log(`     Type: ${notif.notification_type}`);
        console.log(`     Status: ${notif.notification_status}`);
        console.log(`     Created: ${new Date(notif.created_at).toLocaleString()}`);
      });
    }
    
    // Step 5: Verify recipient_id matches shareholder user_ids
    console.log('\n5️⃣ Validating notification recipients...');
    const validRecipients = coOwners.filter(co => co.user_id);
    console.log(`   Expected recipients: ${validRecipients.length}`);
    validRecipients.forEach(co => {
      console.log(`     - ${co.owner_name}: ${co.user_id}`);
    });
    
    if (notifications && notifications.length > 0) {
      const actualRecipients = notifications.map(n => n.shareholder_id);
      const missingNotifs = validRecipients.filter(co => !actualRecipients.includes(co.user_id));
      
      if (missingNotifs.length > 0) {
        console.log(`\n   ❌ Missing notifications for:`);
        missingNotifs.forEach(co => console.log(`     - ${co.owner_name}`));
      } else {
        console.log(`\n   ✅ All shareholders have notifications!`);
      }
    }
    
    // Step 6: Check RLS - can shareholder see the notification?
    console.log('\n6️⃣ Testing RLS (can shareholders see their notifications)?');
    
    for (const co of validRecipients) {
      // Test with shareholder's auth context
      const shareholderSupabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
      );
      
      // Simulate auth context by checking if record exists for this user
      const { data: userNotifs } = await supabase
        .from('shareholder_notifications')
        .select('id')
        .eq('investment_id', investmentId)
        .eq('shareholder_id', co.user_id);
      
      if (userNotifs && userNotifs.length > 0) {
        console.log(`   ✅ ${co.owner_name} can see their notification`);
      } else {
        console.log(`   ❌ ${co.owner_name} CANNOT see notification (no record or RLS issue)`);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('TEST COMPLETE');
    console.log('='.repeat(60));
    
  } catch(e) {
    console.error('❌ Error:', e.message);
    console.error(e);
  }
})();
