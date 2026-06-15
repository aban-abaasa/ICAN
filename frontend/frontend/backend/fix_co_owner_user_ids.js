const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://xltczpqdjufpwftnggau.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsdGN6cHFkanVmcHdmdG5nZ2F1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwMjU0NTk5MCwiZXhwIjogIjE4MDg3Nzk5OTAifQ.FKMpv0lVVL5WXP0mNXlGn1GnQSjkPMHVR_KkkUjZkV8'
);

async function fixCoOwners() {
  try {
    console.log('🔧 Fixing co-owner user_id links...\n');

    // Step 1: Get all co-owners with NULL user_id
    const { data: coOwners, error: getError } = await supabase
      .from('business_co_owners')
      .select('id, owner_email, owner_name')
      .is('user_id', null);

    if (getError) {
      throw getError;
    }

    console.log(`📋 Found ${coOwners.length} co-owners without user_id link\n`);

    let linked = 0;
    let notFound = 0;

    // Step 2: For each co-owner, find matching profile
    for (const coOwner of coOwners) {
      const { data: profiles, error: profileError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', coOwner.owner_email)
        .single();

      if (profileError) {
        console.log(`❌ No profile found for ${coOwner.owner_email} (${coOwner.owner_name})`);
        notFound++;
        continue;
      }

      // Step 3: Update co-owner with user_id
      const { error: updateError } = await supabase
        .from('business_co_owners')
        .update({ user_id: profiles.id })
        .eq('id', coOwner.id);

      if (updateError) {
        console.log(`❌ Failed to link ${coOwner.owner_email}: ${updateError.message}`);
        continue;
      }

      console.log(`✅ Linked ${coOwner.owner_email} -> ${profiles.id}`);
      linked++;
    }

    console.log(`\n📊 Results:`);
    console.log(`   ✅ Linked: ${linked}`);
    console.log(`   ❌ Not Found: ${notFound}`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  }
}

fixCoOwners();
