const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://xltczpqdjufpwftnggau.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsdGN6cHFkanVmcHdmdG5nZ2F1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwMjU0NTk5MCwiZXhwIjoxODA4Nzc5OTkwfQ.FKMpv0lVVL5WXP0mNXlGn1GnQSjkPMHVR_KkkUjZkV8'
);

async function debug() {
  // Get the most recent business profile
  console.log('📊 Fetching most recent business profile...\n');
  
  const { data: profiles, error: profileError } = await supabase
    .from('business_profiles')
    .select('id, business_name, user_id')
    .order('created_at', { ascending: false })
    .limit(1);

  if (profileError) {
    console.error('❌ Error fetching profiles:', profileError);
    return;
  }

  if (!profiles || profiles.length === 0) {
    console.error('❌ No profiles found');
    return;
  }

  const profile = profiles[0];
  console.log(`✅ Profile: ${profile.business_name} (${profile.id})`);
  console.log(`   Owner: ${profile.user_id}\n`);

  // Get co-owners with user details
  const { data: coOwners, error: coOwnersError } = await supabase
    .from('business_co_owners')
    .select(`
      id,
      owner_name,
      owner_email,
      user_id,
      ownership_share,
      role,
      status,
      created_at
    `)
    .eq('business_profile_id', profile.id)
    .order('created_at', { ascending: false });

  if (coOwnersError) {
    console.error('❌ Error fetching co-owners:', coOwnersError);
    return;
  }

  console.log(`📋 Found ${coOwners.length} co-owners:\n`);
  
  coOwners.forEach((owner, idx) => {
    const linked = owner.user_id ? '✅' : '❌';
    console.log(`${idx + 1}. ${linked} ${owner.owner_name} (${owner.owner_email})`);
    console.log(`   user_id: ${owner.user_id || 'NULL'}`);
    console.log(`   ownership: ${owner.ownership_share}%`);
    console.log(`   status: ${owner.status}`);
    console.log(`   created: ${new Date(owner.created_at).toLocaleString()}\n`);
  });

  // Now get auth users
  console.log('\n📧 Checking for matching auth users:\n');
  
  for (const owner of coOwners) {
    const { data: users, error: userError } = await supabase
      .from('profiles')
      .select('id, email')
      .eq('email', owner.owner_email);
    
    if (!userError && users && users.length > 0) {
      console.log(`✅ Found user for ${owner.owner_email}: ${users[0].id}`);
      if (!owner.user_id) {
        console.log(`   ⚠️  Need to link: ${owner.id} -> ${users[0].id}`);
      }
    } else {
      console.log(`❌ No user found for ${owner.owner_email}`);
    }
  }
}

debug().catch(console.error);
