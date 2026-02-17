import { createClient } from '@supabase/supabase-js';

// Supabase configuration for ICAN Backend
// Shared database with FARM-AGENT for unified data access and blockchain integration

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase credentials: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
}

// Create Supabase client with service role key for backend operations
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export default supabase;
