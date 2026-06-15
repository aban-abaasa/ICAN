require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

(async () => {
  try {
    const businessProfileId = '35a1d558-d256-465b-bb16-b023eafb5388';
    
    // Co-owners to add for DAb
    const coOwners = [
      {
        business_profile_id: businessProfileId,
        owner_name: 'Gantaelon',
        owner_email: 'gantaelon@gmail.com',
        owner_phone: null,
        ownership_share: 50,
        role: 'Shareholder',
        status: 'active',
        verification_status: 'verified',
        user_id: '4c25b54b-d6e7-4fd2-b784-66021c41a5d4'  // gantaelon's auth ID
      },
      {
        business_profile_id: businessProfileId,
        owner_name: 'Abana Baasa',
        owner_email: 'abanabaasa2@gmail.com',
        owner_phone: null,
        ownership_share: 50,
        role: 'Shareholder',
        status: 'active',
        verification_status: 'pending',
        user_id: '01ce59a6-592f-4aea-a00d-3e2abcc30b5a'  // abanabaasa2's auth ID
      }
    ];

    // Insert co-owners
    const { data: inserted, error } = await supabase
      .from('business_co_owners')
      .insert(coOwners)
      .select();

    if (error) throw error;

    console.log('✅ Successfully added co-owners for DAb:');
    inserted.forEach(owner => {
      console.log(`  - ${owner.owner_name} (${owner.ownership_share}%)`);
    });
    
    // Verify by fetching them back
    const { data: verify } = await supabase
      .from('business_co_owners')
      .select('*')
      .eq('business_profile_id', businessProfileId);
    
    console.log('\n✅ Verified - Now have', verify.length, 'co-owners in database');
    verify.forEach(v => {
      console.log(`  - ${v.owner_name}: user_id=${v.user_id}`);
    });

  } catch(e) {
    console.error('Error:', e.message);
  }
})();
