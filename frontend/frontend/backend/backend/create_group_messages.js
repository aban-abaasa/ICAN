/**
 * Initialize group_messages table in Supabase
 * Run this with: node create_group_messages.js
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createGroupMessagesTable() {
  try {
    console.log('Creating group_messages table...');

    const sql = `
      -- Drop and recreate to ensure clean state
      DROP TABLE IF EXISTS public.group_messages CASCADE;

      CREATE TABLE public.group_messages (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        group_id UUID NOT NULL REFERENCES public.trust_groups(id) ON DELETE CASCADE,
        user_id UUID NOT NULL,
        user_email TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      -- Indexes
      CREATE INDEX idx_messages_group_id ON public.group_messages(group_id);
      CREATE INDEX idx_messages_user_id ON public.group_messages(user_id);
      CREATE INDEX idx_messages_created_at ON public.group_messages(created_at);

      -- Row Level Security
      ALTER TABLE public.group_messages ENABLE ROW LEVEL SECURITY;

      -- Drop existing policies if they exist
      DROP POLICY IF EXISTS "Group members can view messages" ON public.group_messages;
      DROP POLICY IF EXISTS "Users can send messages" ON public.group_messages;

      -- Messages: Group members can view messages
      CREATE POLICY "Group members can view messages" ON public.group_messages
        FOR SELECT USING (
          EXISTS (
            SELECT 1 FROM public.trust_group_members tgm
            WHERE tgm.group_id = public.group_messages.group_id
            AND tgm.user_id = auth.uid()
            AND tgm.is_active = true
          )
          OR
          EXISTS (
            SELECT 1 FROM public.trust_groups tg
            WHERE tg.id = public.group_messages.group_id
            AND tg.creator_id = auth.uid()
          )
        );

      -- Users can send messages if they're members or admins
      CREATE POLICY "Users can send messages" ON public.group_messages
        FOR INSERT WITH CHECK (
          auth.uid() = user_id
          AND (
            EXISTS (
              SELECT 1 FROM public.trust_group_members tgm
              WHERE tgm.group_id = public.group_messages.group_id
              AND tgm.user_id = auth.uid()
              AND tgm.is_active = true
            )
            OR
            EXISTS (
              SELECT 1 FROM public.trust_groups tg
              WHERE tg.id = public.group_messages.group_id
              AND tg.creator_id = auth.uid()
            )
          )
        );
    `;

    // Execute raw SQL using rpc or admin API
    const { error } = await supabase.rpc('exec_sql', { sql_string: sql });
    
    if (error) {
      console.error('Error creating table via RPC:', error);
      // If RPC doesn't work, we need to use admin API
      console.log('\nNote: RPC method not available. Please run the SQL directly in Supabase dashboard:');
      console.log('1. Go to SQL Editor in Supabase console');
      console.log('2. Create new query and paste the contents of: ICAN/backend/db/create_group_messages_table.sql');
      console.log('3. Execute the query');
      process.exit(1);
    }

    console.log('✅ group_messages table created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    console.log('\nFallback: Please run the SQL directly in Supabase dashboard:');
    console.log('1. Go to SQL Editor in Supabase console');
    console.log('2. Create new query and paste the contents of: ICAN/backend/db/create_group_messages_table.sql');
    console.log('3. Execute the query');
    process.exit(1);
  }
}

createGroupMessagesTable();
