import { createClient } from '@supabase/supabase-js';

// Singleton instance - only one client per app
let supabaseInstance = null;
let isInitializing = false;

// Initialize Supabase client with environment variables (lazy initialization)
const initializeSupabase = () => {
  // Return existing instance if already initialized
  if (supabaseInstance !== null) return supabaseInstance;
  
  // Prevent concurrent initialization attempts
  if (isInitializing) return null;
  isInitializing = true;

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  // Log for debugging (will show in browser console)
  console.log('🔍 Checking Supabase environment variables...');
  console.log('VITE_SUPABASE_URL:', supabaseUrl ? '✅ Set' : '❌ Missing');
  console.log('VITE_SUPABASE_ANON_KEY:', supabaseAnonKey ? '✅ Set' : '❌ Missing');

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error(
      '❌ Supabase initialization FAILED: Missing environment variables. Make sure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in Vercel dashboard or .env file.'
    );
    isInitializing = false;
    supabaseInstance = null;
    return null;
  }

  try {
    // Create a single Supabase client instance
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    });

    console.log('✅ Supabase client initialized successfully');

    // Add error handling for auth issues (non-blocking)
    supabaseInstance.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        console.log('User signed out');
      } else if (event === 'TOKEN_REFRESHED') {
        console.log('Token refreshed successfully');
      }
    });

    // Handle auth errors
    supabaseInstance.auth.onAuthStateChange((event, session) => {
      if (event === 'USER_UPDATED' && !session) {
        console.warn('Session lost - user may need to re-authenticate');
      }
    });
  } catch (error) {
    console.error('❌ Failed to initialize Supabase:', error);
    supabaseInstance = null;
  } finally {
    isInitializing = false;
  }

  return supabaseInstance;
};

// Lazy initialization getter function
export const getSupabaseClient = () => {
  return initializeSupabase();
};

// Export as both named and default export for compatibility
export const supabase = getSupabaseClient();
export default supabase;
