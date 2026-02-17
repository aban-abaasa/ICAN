const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://xltczpqdjufpwftnggau.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsdGN6cHFkanVmcHdmdG5nZ2F1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwMjU0NTk5MCwiZXhwIjoxODA4Nzc5OTkwfQ.FKMpv0lVVL5WXP0mNXlGn1GnQSjkPMHVR_KkkUjZkV8'
);

async function linkCoOwners() {
  try {
    console.log('🔗 LINKING CO-OWNERS TO AUTH USERS BY EMAIL...\n');

    // Step 1: Check which co-owners are missing user_id
    console.log('📋 Step 1: Checking co-owners without user_id...\n');
    const { data: before, error: beforeError } = await supabase
      .from('business_co_owners')
      .select('id, owner_name, owner_email, user_id, status')
      .eq('status', 'active')
      .is('user_id', null);

    if (beforeError) throw beforeError;

    console.log(`Found ${before.length} co-owners without user_id:\n`);
    before.forEach(owner => {
      console.log(`   ❌ ${owner.owner_name} (${owner.owner_email})`);
    });

    if (before.length === 0) {
      console.log('   ✅ All co-owners already linked!');
      return;
    }

    // Step 2: For each unlinked co-owner, find matching auth user and link
    console.log('\n🔗 Step 2: Linking co-owners to auth users...\n');

    let linked = 0;
    let notFound = 0;

    for (const coOwner of before) {
      // Find matching user
      const { data: users, error: userError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', coOwner.owner_email)
        .single();

      if (userError || !users) {
        console.log(`   ❌ ${coOwner.owner_email} - No matching auth user found`);
        notFound++;
        continue;
      }

      // Update co-owner with user_id
      const { error: updateError } = await supabase
        .from('business_co_owners')
        .update({ user_id: users.id })
        .eq('id', coOwner.id);

      if (updateError) {
        console.log(`   ❌ ${coOwner.owner_email} - Failed to link: ${updateError.message}`);
        notFound++;
        continue;
      }

      console.log(`   ✅ ${coOwner.owner_name} (${coOwner.owner_email}) linked to ${users.id}`);
      linked++;
    }

    // Step 3: Verify the links were created
    console.log('\n✅ Step 3: Verifying links...\n');

    const { data: after, error: afterError } = await supabase
      .from('business_co_owners')
      .select('id, owner_name, owner_email, user_id, status')
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (afterError) throw afterError;

    console.log(`📊 Co-owners status after linking:\n`);
    after.forEach(owner => {
      const status = owner.user_id ? '✅ LINKED' : '❌ NOT LINKED';
      console.log(`   ${status} - ${owner.owner_name} (${owner.owner_email})`);
      if (owner.user_id) {
        console.log(`      user_id: ${owner.user_id}`);
      }
    });

    // Final summary
    console.log(`\n📊 SUMMARY:`);
    console.log(`   ✅ Successfully linked: ${linked}`);
    console.log(`   ❌ Could not link: ${notFound}`);
    console.log(`   📋 Total co-owners: ${after.length}`);
    console.log(`   ✅ Fully linked: ${after.filter(o => o.user_id).length}`);

    if (notFound === 0) {
      console.log(`\n✅ All co-owners are now linked to auth users!`);
      console.log(`   They will now receive shareholder notifications.`);
    } else {
      console.log(`\n⚠️  ${notFound} co-owners could not be linked.`);
      console.log(`   These co-owners need auth accounts with matching emails.`);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

linkCoOwners();
