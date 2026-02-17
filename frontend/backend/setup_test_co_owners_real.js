const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://xltczpqdjufpwftnggau.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsdGN6cHFkanVmcHdmdG5nZ2F1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwMjU0NTk5MCwiZXhwIjoxODA4Nzc5OTkwfQ.FKMpv0lVVL5WXP0mNXlGn1GnQSjkPMHVR_KkkUjZkV8'
);

async function setupTestCoOwners() {
  try {
    console.log('🔧 Setting up test co-owners with real auth accounts...\n');

    // Step 1: Get the most recent business profile
    console.log('📦 Finding business profile...');
    const { data: profiles, error: profileError } = await supabase
      .from('business_profiles')
      .select('id, business_name')
      .order('created_at', { ascending: false })
      .limit(1);

    if (profileError || !profiles || profiles.length === 0) {
      throw new Error('No business profile found');
    }

    const profileId = profiles[0].id;
    console.log(`✅ Profile: ${profiles[0].business_name}\n`);

    // Step 2: Get existing auth users (real emails with accounts)
    console.log('📧 Fetching existing auth users...');
    const { data: profiles_table, error: profilesError } = await supabase
      .from('profiles')
      .select('id, email')
      .order('created_at', { ascending: false })
      .limit(10);

    if (profilesError || !profiles_table) {
      throw new Error('Could not fetch auth users');
    }

    console.log(`✅ Found ${profiles_table.length} auth users:\n`);
    profiles_table.forEach((p, i) => {
      console.log(`${i + 1}. ${p.email} (${p.id})`);
    });

    if (profiles_table.length < 3) {
      throw new Error('Need at least 3 users with auth accounts. Create more accounts first.');
    }

    // Step 3: Delete existing co-owners for this profile
    console.log('\n🗑️  Removing old test co-owners...');
    const { error: deleteError } = await supabase
      .from('business_co_owners')
      .delete()
      .eq('business_profile_id', profileId);

    if (deleteError) throw deleteError;
    console.log('✅ Old co-owners deleted\n');

    // Step 4: Create co-owners with real auth users
    console.log('➕ Adding 3 new co-owners from existing auth users...\n');

    const coOwnersData = profiles_table.slice(0, 3).map((profile, idx) => ({
      business_profile_id: profileId,
      user_id: profile.id, // Link directly to the auth user
      owner_name: profile.email.split('@')[0].replace('.', ' ').toUpperCase(),
      owner_email: profile.email,
      owner_phone: `+256${700000000 + idx}`,
      ownership_share: idx === 2 ? 34 : 33,
      role: idx === 0 ? 'Shareholder' : idx === 1 ? 'Co-Owner' : 'Shareholder',
      status: 'active',
      verification_status: 'verified'
    }));

    const { data: created, error: insertError } = await supabase
      .from('business_co_owners')
      .insert(coOwnersData)
      .select();

    if (insertError) throw insertError;

    console.log(`✅ ${created.length} co-owners created:\n`);
    created.forEach((owner, idx) => {
      console.log(`${idx + 1}. ${owner.owner_name} (${owner.owner_email})`);
      console.log(`   user_id: ${owner.user_id}`);
      console.log(`   ownership: ${owner.ownership_share}%`);
      console.log(`   role: ${owner.role}\n`);
    });

    console.log('✅ Setup complete! Co-owners are now ready for shareholder notifications.');

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

setupTestCoOwners();
