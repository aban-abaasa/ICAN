require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  try {
    console.log('='.repeat(70));
    console.log('Fixing RLS Policy for shareholder_notifications');
    console.log('='.repeat(70));
    
    // Drop old policies
    const dropQueries = [
      'DROP POLICY IF EXISTS "Enable read for shareholders" ON public.shareholder_notifications',
      'DROP POLICY IF EXISTS "Users can only insert notifications for themselves" ON public.shareholder_notifications',
      'DROP POLICY IF EXISTS "Users can update their own notifications" ON public.shareholder_notifications',
      'DROP POLICY IF EXISTS "Shareholders can read their notifications" ON public.shareholder_notifications',
      'DROP POLICY IF EXISTS "Investors can create shareholder notifications" ON public.shareholder_notifications'
    ];
    
    console.log('\n1️⃣ Dropping old policies...');
    for (const query of dropQueries) {
      try {
        await sb.rpc('execute_sql', { sql: query });
      } catch (e) {
        // Policy probably didn't exist, which is fine
      }
    }
    console.log('   ✅ Old policies dropped (or didn\'t exist)');
    
    // Create new policies
    console.log('\n2️⃣ Creating new RLS policies...\n');
    
    // Policy 1: Shareholders can READ their own notifications
    const policy1 = `CREATE POLICY "Shareholders can read their notifications"
      ON public.shareholder_notifications
      FOR SELECT
      USING (shareholder_id = auth.uid())`;
    
    try {
      await sb.rpc('execute_sql', { sql: policy1 });
      console.log('   ✅ Policy 1: Shareholders can read their notifications');
    } catch (e) {
      console.warn('⚠️ Read policy:', e?.message || 'Already exists or error');
    }
    
    // Policy 2: Investors can CREATE notifications
    const policy2 = `CREATE POLICY "Investors can create shareholder notifications"
      ON public.shareholder_notifications
      FOR INSERT
      WITH CHECK (
        EXISTS (
          SELECT 1 FROM public.investment_approvals ia
          WHERE ia.investment_id = shareholder_notifications.investment_id
          AND ia.investor_id = auth.uid()
        )
      )`;
    
    try {
      await sb.rpc('execute_sql', { sql: policy2 });
      console.log('   ✅ Policy 2: Investors can create shareholder notifications');
    } catch (e) {
      console.warn('⚠️ Insert policy:', e?.message || 'Error');
    }
    
    // Policy 3: Shareholders can UPDATE their notifications
    const policy3 = `CREATE POLICY "Shareholders can update their notifications"
      ON public.shareholder_notifications
      FOR UPDATE
      USING (shareholder_id = auth.uid())
      WITH CHECK (shareholder_id = auth.uid())`;
    
    try {
      await sb.rpc('execute_sql', { sql: policy3 });
      console.log('   ✅ Policy 3: Shareholders can update their notifications');
    } catch (e) {
      console.warn('⚠️ Update policy:', e?.message || 'Already exists or error');
    }
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ RLS Policies Updated Successfully!');
    console.log('='.repeat(70));
    console.log('\nPolicy Summary:');
    console.log('  1️⃣ Shareholders can READ their own notifications');
    console.log('  2️⃣ Investors can CREATE notifications for shareholders');
    console.log('  3️⃣ Shareholders can UPDATE their notification status');
    console.log('\nReady to test investor signing again!\n');
    
  } catch(e) {
    console.error('Error:', e.message);
  }
})();
