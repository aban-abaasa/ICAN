const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  'https://xltczpqdjufpwftnggau.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhsdGN6cHFkanVmcHdmdG5nZ2F1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcwMjU0NTk5MCwiZXhwIjoxODA4Nzc5OTkwfQ.FKMpv0lVVL5WXP0mNXlGn1GnQSjkPMHVR_KkkUjZkV8'
);

async function executeLinkingSQL() {
  try {
    console.log('🔗 EXECUTING LINK_CO_OWNERS_TO_USERS.sql\n');

    // STEP 1: Check which co-owners are missing user_id
    console.log('📋 STEP 1: Checking co-owners without user_id...\n');
    
    const { data: beforeList, error: beforeError } = await supabase
      .from('business_co_owners')
      .select('id, owner_name, owner_email, user_id, status')
      .eq('status', 'active')
      .is('user_id', null)
      .order('created_at', { ascending: false });

    if (beforeError) throw beforeError;

    console.log(`❌ NOT LINKED (${beforeList.length}):\n`);
    if (beforeList.length === 0) {
      console.log('   ✅ All co-owners are already linked!');
    } else {
      beforeList.forEach(row => {
        console.log(`   ${row.id.substring(0, 8)}... | ${row.owner_name.padEnd(20)} | ${row.owner_email}`);
      });
    }

    // STEP 2: Link co-owners to auth users by email match
    console.log('\n\n🔗 STEP 2: Linking co-owners to auth users by email...\n');

    let linked = 0;
    let failed = 0;

    for (const coOwner of beforeList) {
      // Find matching profile by email
      const { data: matchingProfile, error: matchError } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', coOwner.owner_email)
        .single();

      if (matchError || !matchingProfile) {
        console.log(`   ❌ ${coOwner.owner_email} - NO MATCHING AUTH USER`);
        failed++;
        continue;
      }

      // Update the co-owner with user_id
      const { error: updateError } = await supabase
        .from('business_co_owners')
        .update({ user_id: matchingProfile.id })
        .eq('id', coOwner.id);

      if (updateError) {
        console.log(`   ❌ ${coOwner.owner_email} - UPDATE FAILED: ${updateError.message}`);
        failed++;
        continue;
      }

      console.log(`   ✅ ${coOwner.owner_email} → ${matchingProfile.id.substring(0, 8)}...`);
      linked++;
    }

    // STEP 3: Verify the links were created
    console.log('\n\n✅ STEP 3: Verifying links were created...\n');

    const { data: allCoOwners, error: verifyError } = await supabase
      .from('business_co_owners')
      .select(`
        id,
        owner_name,
        owner_email,
        user_id,
        status,
        profiles!user_id(email)
      `)
      .eq('status', 'active')
      .order('created_at', { ascending: false });

    if (verifyError) throw verifyError;

    console.log(`ACTIVE CO-OWNERS (${allCoOwners.length} total):\n`);
    console.log('ID'.padEnd(10) + 'NAME'.padEnd(25) + 'EMAIL'.padEnd(30) + 'LINKED'.padEnd(10));
    console.log('-'.repeat(75));

    allCoOwners.forEach(row => {
      const linkedStatus = row.user_id ? '✅ YES' : '❌ NO';
      console.log(
        row.id.substring(0, 8).padEnd(10) +
        row.owner_name.substring(0, 23).padEnd(25) +
        row.owner_email.substring(0, 28).padEnd(30) +
        linkedStatus.padEnd(10)
      );
    });

    // FINAL SUMMARY
    console.log('\n\n📊 FINAL SUMMARY:\n');
    console.log(`   ✅ Linked: ${linked}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log(`   📋 Total co-owners: ${allCoOwners.length}`);
    const linkedCount = allCoOwners.filter(o => o.user_id).length;
    console.log(`   ✅ Fully linked: ${linkedCount}/${allCoOwners.length}`);

    if (failed === 0 && linkedCount === allCoOwners.length) {
      console.log(`\n✅ SUCCESS! All co-owners are now linked to auth users.`);
      console.log(`   They will now receive shareholder notifications.`);
      console.log(`   Try signing an investment again!`);
    } else if (failed > 0) {
      console.log(`\n⚠️  ${failed} co-owners could not be linked.`);
      console.log(`   These need auth accounts with matching email addresses.`);
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    if (err.details) console.error('   Details:', err.details);
  }
}

executeLinkingSQL();
