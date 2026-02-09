const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://xltczpqdjufpwftnggau.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsdGN6cHFkanVmcHdmdG5nZ2F1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwMjU0NTk5MCwiZXhwIjoxODA4Nzc5OTkwfQ.FKMpv0lVVL5WXP0mNXlGn1GnQSjkPMHVR_KkkUjZkV8'
);

async function debug() {
  // Get business profile with co-owners
  const { data, error } = await supabase
    .from('business_profiles')
    .select(`
      id,
      business_name,
      business_co_owners(*)
    `)
    .limit(1)
    .single();

  if (error) {
    console.error('❌ Error:', error);
    return;
  }

  console.log('📊 Business Profile:', data.business_name);
  console.log('📋 Co-owners count:', data.business_co_owners?.length || 0);
  
  if (data.business_co_owners?.length > 0) {
    console.log('\n🔍 Co-owner columns:');
    console.log(JSON.stringify(Object.keys(data.business_co_owners[0]), null, 2));
    
    console.log('\n📋 All Co-owners:');
    data.business_co_owners.forEach(owner => {
      console.log(`  - ${owner.owner_name} (${owner.owner_email}): ${owner.ownership_share}%`);
    });
  }
}

debug().catch(console.error);
