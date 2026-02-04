import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function createProfileTable() {
  try {
    console.log('Creating ican_user_profiles table...');
    
    // First, try to insert a test user profile to see the actual error
    const testResult = await supabase
      .from('ican_user_profiles')
      .select('*')
      .limit(1);
    
    if (testResult.error?.code === 'PGRST116') {
      console.log('Table does not exist. Manual creation required.');
      console.log('\n📋 STEPS TO FIX:');
      console.log('1. Go to: https://supabase.com/dashboard/project/hswxazpxcgtqbxeqcxxw/sql/new');
      console.log('2. Copy the SQL from CREATE_PROFILES_TABLE.sql');
      console.log('3. Paste and run in the SQL Editor\n');
      return false;
    }
    
    console.log('✅ Table exists or error code different:', testResult.error?.code);
    return true;
  } catch (error) {
    console.error('Error:', error.message);
  }
}

createProfileTable();
