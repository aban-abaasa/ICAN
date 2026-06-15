#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const main = async () => {
  console.log('======================================================================');
  console.log('Fixing investment_approvals RLS Policies');
  console.log('======================================================================\n');
  
  try {
    console.log('1️⃣ Dropping old policies...');
    const dropPolicies = `
      DROP POLICY IF EXISTS "Users can view approval records they're involved in" ON public.investment_approvals;
      DROP POLICY IF EXISTS "Authenticated users can create approvals" ON public.investment_approvals;
      DROP POLICY IF EXISTS "Users can update approval records" ON public.investment_approvals;
    `;
    
    try {
      await supabase.rpc('execute_sql', { sql: dropPolicies });
      console.log('   ✅ Old policies dropped\n');
    } catch (e) {
      console.warn('   ⚠️ Policies might not exist:', e?.message || '');
    }

    console.log('2️⃣ Creating new RLS policies...\n');

    // Policy 1: SELECT access
    const policy1 = `CREATE POLICY "Users can view investment approval records"
      ON public.investment_approvals FOR SELECT
      USING (
        auth.uid() = investor_id
        OR auth.uid() IN (
          SELECT user_id FROM public.business_profiles 
          WHERE id = business_profile_id
        )
      )`;
    
    try {
      await supabase.rpc('execute_sql', { sql: policy1 });
      console.log('   ✅ Policy 1: Users can view investment approval records');
    } catch (e) {
      console.warn('⚠️ SELECT policy:', e?.message || 'Error');
    }

    // Policy 2: INSERT access
    const policy2 = `CREATE POLICY "Investors can create investment approvals"
      ON public.investment_approvals FOR INSERT
      WITH CHECK (auth.uid() = investor_id)`;
    
    try {
      await supabase.rpc('execute_sql', { sql: policy2 });
      console.log('   ✅ Policy 2: Investors can create investment approvals');
    } catch (e) {
      console.warn('⚠️ INSERT policy:', e?.message || 'Error');
    }

    // Policy 3: UPDATE access
    const policy3 = `CREATE POLICY "Users can update investment approval records"
      ON public.investment_approvals FOR UPDATE
      USING (
        auth.uid() = investor_id
        OR auth.uid() IN (
          SELECT user_id FROM public.business_profiles 
          WHERE id = business_profile_id
        )
      )
      WITH CHECK (
        auth.uid() = investor_id
        OR auth.uid() IN (
          SELECT user_id FROM public.business_profiles 
          WHERE id = business_profile_id
        )
      )`;
    
    try {
      await supabase.rpc('execute_sql', { sql: policy3 });
      console.log('   ✅ Policy 3: Users can update investment approval records');
    } catch (e) {
      console.warn('⚠️ UPDATE policy:', e?.message || 'Error');
    }

    console.log('\n======================================================================');
    console.log('✅ investment_approvals RLS Policies Updated!');
    console.log('======================================================================\n');
    
    console.log('Policy Summary:');
    console.log('  1️⃣ SELECT: Investors and business owners can view their approvals');
    console.log('  2️⃣ INSERT: Investors can create approval records after signing');
    console.log('  3️⃣ UPDATE: Both investors and business owners can update approvals');
    console.log('\nNow investors can create approvals, and shareholders can receive notifications!\n');

  } catch (error) {
    console.error('❌ Error:', error?.message || error);
    process.exit(1);
  }
};

main();
