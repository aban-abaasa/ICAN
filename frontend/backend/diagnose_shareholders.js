const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://xltczpqdjufpwftnggau.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsdGN6cHFkanVmcHdmdG5nZ2F1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwMjU0NTk5MCwiZXhwIjoxODA4Nzc5OTkwfQ.FKMpv0lVVL5WXP0mNXlGn1GnQSjkPMHVR_KkkUjZkV8'
);

async function diagnose() {
  try {
    console.log('🔍 DIAGNOSING SHAREHOLDER SETUP...\n');

    // Step 1: Get the most recent business profile
    const { data: profiles, error: profileError } = await supabase
      .from('business_profiles')
      .select('id, business_name, user_id')
      .order('created_at', { ascending: false })
      .limit(1);

    if (profileError || !profiles || profiles.length === 0) {
      throw new Error('No business profile found');
    }

    const profile = profiles[0];
    console.log(`📦 Business Profile: "${profile.business_name}"`);
    console.log(`   ID: ${profile.id}\n`);

    // Step 2: Get all co-owners for this profile
    const { data: coOwners, error: coOwnersError } = await supabase
      .from('business_co_owners')
      .select('id, owner_name, owner_email, user_id, ownership_share, status')
      .eq('business_profile_id', profile.id)
      .order('created_at');

    if (coOwnersError) throw coOwnersError;

    console.log(`📋 CO-OWNERS (${coOwners.length} total):\n`);
    
    if (coOwners.length === 0) {
      console.log('   ❌ NO CO-OWNERS FOUND - Add some first!');
      return;
    }

    for (const owner of coOwners) {
      const linked = owner.user_id ? '✅' : '❌';
      console.log(`${linked} ${owner.owner_name} (${owner.owner_email})`);
      console.log(`   user_id: ${owner.user_id || 'NULL'}`);
      console.log(`   ownership: ${owner.ownership_share}%`);
      console.log(`   status: ${owner.status}\n`);
    }

    // Step 3: Get all auth users
    const { data: users, error: usersError } = await supabase
      .from('profiles')
      .select('id, email')
      .order('created_at', { ascending: false });

    if (usersError) throw usersError;

    console.log(`\n👥 AUTH USERS (${users.length} total):\n`);
    users.slice(0, 10).forEach((u, i) => {
      console.log(`${i + 1}. ${u.email} (${u.id})`);
    });
    if (users.length > 10) {
      console.log(`   ... and ${users.length - 10} more`);
    }

    // Step 4: Check for matches
    console.log('\n\n🔗 MATCHING CO-OWNERS TO AUTH USERS:\n');
    
    let matched = 0;
    let unmatched = 0;

    for (const owner of coOwners) {
      const matchingUser = users.find(u => u.email === owner.owner_email);
      
      if (matchingUser) {
        console.log(`✅ ${owner.owner_email}`);
        console.log(`   → Found auth user: ${matchingUser.id}`);
        if (!owner.user_id) {
          console.log(`   ⚠️  Need to link: UPDATE business_co_owners SET user_id='${matchingUser.id}' WHERE id='${owner.id}'`);
        }
        matched++;
      } else {
        console.log(`❌ ${owner.owner_email} - NO MATCHING AUTH USER`);
        unmatched++;
      }
    }

    console.log(`\n📊 SUMMARY:`);
    console.log(`   ✅ Can be linked: ${matched}`);
    console.log(`   ❌ Cannot be linked: ${unmatched}`);
    
    if (unmatched > 0) {
      console.log(`\n⚠️  ACTION REQUIRED:`);
      console.log(`   Run: node setup_test_co_owners_real.js`);
      console.log(`   This will replace test co-owners with real auth users from your system`);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

diagnose();
