const express = require('express');
const { createClient } = require('@supabase/supabase-js');

const router = express.Router();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  SUPABASE_SERVICE_ROLE_KEY;

const adminSupabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

const authSupabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

/**
 * POST /api/account/delete
 * Deletes currently authenticated user after password verification.
 */
router.post('/delete', async (req, res) => {
  try {
    if (!adminSupabase) {
      return res.status(500).json({
        success: false,
        message: 'Server is missing Supabase configuration.',
      });
    }

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Missing authorization token.',
      });
    }

    const accessToken = authHeader.replace('Bearer ', '').trim();
    const password = (req.body?.password || '').trim();

    const { data: tokenUserData, error: tokenUserError } = await adminSupabase.auth.getUser(accessToken);
    const currentUser = tokenUserData?.user;

    if (tokenUserError || !currentUser) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session.',
      });
    }

    if (!currentUser.email) {
      return res.status(400).json({
        success: false,
        message: 'User email is missing. Cannot verify password.',
      });
    }

    const providers = currentUser.app_metadata?.providers || [];
    const hasEmailPasswordProvider = providers.includes('email') || providers.length === 0;

    if (hasEmailPasswordProvider) {
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Password is required for this account.',
        });
      }

      const authClient = authSupabase || adminSupabase;
      const { data: reauthData, error: reauthError } = await authClient.auth.signInWithPassword({
        email: currentUser.email,
        password,
      });

      if (reauthError || !reauthData?.user || reauthData.user.id !== currentUser.id) {
        const authMessage = reauthError?.message || 'Password verification failed.';
        return res.status(401).json({
          success: false,
          message: `Password verification failed: ${authMessage}`,
        });
      }
    } else {
      // OAuth/social account: keep explicit confirmation in UI but skip password auth grant.
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Please enter your confirmation credential to continue.',
        });
      }
    }

    // Best-effort cleanup of the profile row.
    await adminSupabase.from('profiles').delete().eq('id', currentUser.id);

    const { error: deleteError } = await adminSupabase.auth.admin.deleteUser(currentUser.id);
    if (deleteError) {
      console.error('Delete user error:', deleteError);
      return res.status(500).json({
        success: false,
        message: deleteError.message || 'Failed to delete account.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Your account has been deleted.',
    });
  } catch (error) {
    console.error('Account delete route error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error while deleting account.',
    });
  }
});

module.exports = router;
