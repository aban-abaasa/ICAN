const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://xltczpqdjufpwftnggau.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsdGN6cHFkanVmcHdmdG5nZ2F1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwMjU0NTk5MCwiZXhwIjoxODA4Nzc5OTkwfQ.FKMpv0lVVL5WXP0mNXlGn1GnQSjkPMHVR_KkkUjZkV8'
);

async function checkCoOwners() {
  try {
    console.log('🔍 Checking business profiles and their co-owners...\n');

    // Get all business profiles
    const { data: profiles, error: profileError } = await supabase
      .from('business_profiles')
      .select('id, business_name, user_id, created_at')
      .order('created_at', { ascending: false });

    if (profileError) throw profileError;

    console.log(`📊 Found ${profiles.length} business profiles:\n`);

    for (const profile of profiles) {
      console.log(`📦 "${profile.business_name}" (${profile.id})`);
      
      // Get co-owners for this profile
      const { data: coOwners, error: coError } = await supabase
        .from('business_co_owners')
        .select('id, owner_name, owner_email, user_id, ownership_share, status')
        .eq('business_profile_id', profile.id)
        .order('created_at');

      if (coError) {
        console.log(`   ❌ Error loading co-owners: ${coError.message}`);
        continue;
      }

      if (!coOwners || coOwners.length === 0) {
        console.log(`   ⚠️  NO CO-OWNERS`);
      } else {
        console.log(`   📋 ${coOwners.length} co-owners:`);
        coOwners.forEach(owner => {
          const linked = owner.user_id ? '✅' : '❌';
          console.log(`      ${linked} ${owner.owner_name} (${owner.owner_email}) - ${owner.ownership_share}% - ${owner.status}`);
        });
      }
      console.log();
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

checkCoOwners();
