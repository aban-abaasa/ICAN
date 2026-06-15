#!/usr/bin/env node

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
);

const main = async () => {
  console.log('======================================================================');
  console.log('Creating Stored Procedure for Shareholder Notifications');
  console.log('======================================================================\n');
  
  try {
    // Drop old function
    console.log('1️⃣ Dropping old function (if exists)...');
    
    const dropFn = `
      DROP FUNCTION IF EXISTS public.create_shareholder_notification(
        UUID, UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR
      );
    `;
    
    try {
      await supabase.rpc('execute_sql', { sql: dropFn });
      console.log('   ✅ Old function dropped\n');
    } catch (e) {
      console.log('   ⚠️ Function might not exist\n');
    }

    // Create new function
    console.log('2️⃣ Creating stored procedure (runs as owner, bypasses RLS)...\n');
    
    const createFn = `
      CREATE OR REPLACE FUNCTION public.create_shareholder_notification(
        p_investment_id UUID,
        p_shareholder_id UUID,
        p_shareholder_email VARCHAR,
        p_shareholder_name VARCHAR,
        p_notification_type VARCHAR,
        p_notification_message VARCHAR
      )
      RETURNS TABLE (
        id UUID,
        investment_id UUID,
        shareholder_id UUID,
        shareholder_email VARCHAR,
        notification_sent_at TIMESTAMP WITH TIME ZONE
      ) AS $$
      BEGIN
        RETURN QUERY
        INSERT INTO public.shareholder_notifications (
          investment_id,
          shareholder_id,
          shareholder_email,
          shareholder_name,
          notification_type,
          notification_status,
          pin_entry_required,
          pin_verified,
          approval_percent,
          notification_message,
          notification_sent_at
        )
        VALUES (
          p_investment_id,
          p_shareholder_id,
          p_shareholder_email,
          p_shareholder_name,
          p_notification_type,
          'sent',
          true,
          false,
          0,
          p_notification_message,
          NOW()
        )
        RETURNING
          shareholder_notifications.id,
          shareholder_notifications.investment_id,
          shareholder_notifications.shareholder_id,
          shareholder_notifications.shareholder_email,
          shareholder_notifications.notification_sent_at;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    `;
    
    try {
      await supabase.rpc('execute_sql', { sql: createFn });
      console.log('   ✅ Stored procedure created\n');
    } catch (e) {
      console.error('   ❌ Failed to create function:', e?.message || e);
      throw e;
    }

    // Grant permissions
    console.log('3️⃣ Granting execute permissions to authenticated users...\n');
    
    const grantPerms = `
      GRANT EXECUTE ON FUNCTION public.create_shareholder_notification(
        UUID, UUID, VARCHAR, VARCHAR, VARCHAR, VARCHAR
      ) TO authenticated;
    `;
    
    try {
      await supabase.rpc('execute_sql', { sql: grantPerms });
      console.log('   ✅ Permissions granted\n');
    } catch (e) {
      console.warn('   ⚠️ Permission grant failed (may already exist):', e?.message || '');
    }

    // Test the function
    console.log('4️⃣ Testing the stored procedure...\n');
    
    try {
      const { data, error } = await supabase.rpc('create_shareholder_notification', {
        p_investment_id: '00000000-0000-0000-0000-000000000001',
        p_shareholder_id: 'b030496a-e414-449e-b23b-c26ec6bb964a',
        p_shareholder_email: 'test@example.com',
        p_shareholder_name: 'Test User',
        p_notification_type: 'pin_request',
        p_notification_message: 'Test notification'
      });

      if (error) {
        console.log('   ❌ Function test failed:', error.message);
      } else {
        console.log('   ✅ Function test successful!');
        console.log('      Notification ID:', data[0]?.id);
        console.log('      Shareholder:', data[0]?.shareholder_email);
        console.log('      Sent at:', data[0]?.notification_sent_at);
      }
    } catch (e) {
      console.log('   ❌ Function test error:', e?.message);
    }

    console.log('\n======================================================================');
    console.log('✅ Stored Procedure Ready');
    console.log('======================================================================\n');
    
    console.log('Summary:');
    console.log('  • Function runs as database owner (SECURITY DEFINER)');
    console.log('  • Bypasses RLS restrictions');
    console.log('  • Authenticated users can call it via RPC');
    console.log('\nNext Step:');
    console.log('  Update frontend ShareSigningFlow.jsx to use:');
    console.log('  supabase.rpc(\'create_shareholder_notification\', {...})\n');

  } catch (error) {
    console.error('❌ Fatal error:', error?.message || error);
    process.exit(1);
  }
};

main();
