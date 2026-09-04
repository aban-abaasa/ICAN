/**
 * Verify a Supabase access token by calling GoTrue's /auth/v1/user directly
 * (same fetch-based pattern as supabaseRequest() in api/report-automation.js,
 * to avoid pulling @supabase/supabase-js into the api/ functions bundle).
 */
export const verifySupabaseUser = async (accessToken) => {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !accessToken) return null;

  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: anonKey,
      },
    });
    if (!res.ok) return null;
    const user = await res.json();
    return user?.id ? user : null;
  } catch (error) {
    console.error('Error verifying Supabase user:', error);
    return null;
  }
};
