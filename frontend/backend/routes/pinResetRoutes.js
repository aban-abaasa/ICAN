import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import emailService from '../services/emailService.js';

const router = Router();

// Create service role client (backend only - has full access)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * 🔐 PIN RESET ENDPOINTS
 * Handles complete PIN reset & account unlock workflow
 */

// ============================================
// REQUEST PIN RESET
// ============================================
/**
 * POST /api/request-pin-reset
 * User requests PIN reset - creates unlock request & sends email
 */
router.post('/request-pin-reset', async (req, res) => {
  try {
    const { account_number, email } = req.body;

    if (!account_number || !email) {
      return res.status(400).json({
        success: false,
        message: 'Account number and email required'
      });
    }

    // Find user by account number
    const { data: users, error: userError } = await supabase
      .from('user_accounts')
      .select('id, full_name')
      .eq('account_number', account_number)
      .eq('email_address', email)
      .limit(1);

    if (userError || !users || users.length === 0) {
      console.log('User lookup failed:', { account_number, email });
      // Don't reveal if user exists or not (security best practice)
      return res.status(200).json({
        success: true,
        message: 'If account exists, reset link has been sent to your email'
      });
    }

    const user_id = users[0].id;
    const user_name = users[0].full_name;

    // Create unlock request with 32-byte token
    const unlock_token = crypto.randomBytes(32).toString('hex');
    const token_expiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours

    const { data: unlockRequest, error: createError } = await supabase
      .from('account_unlock_requests')
      .insert({
        user_id,
        request_type: 'pin_reset',
        unlock_token: unlock_token,
        token_expiry,
        status: 'pending',
        reason: 'User requested PIN reset via forgot PIN flow'
      })
      .select('id')
      .single();

    if (createError) {
      console.error('Error creating unlock request:', createError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create reset request'
      });
    }

    const request_id = unlockRequest.id;
    const resetLink = `${process.env.APP_URL || 'http://localhost:3000'}/reset-pin?request=${request_id}&token=${unlock_token}`;

    // Send PIN reset email
    const emailResult = await emailService.sendPinResetEmail(
      email,
      user_name,
      resetLink,
      request_id
    );

    if (!emailResult.success) {
      console.warn('Email sending warning:', emailResult);
      // Don't fail the request even if email has issues - request was created
    }

    console.log('✅ PIN reset request created:', {
      user_id,
      request_id,
      email
    });

    return res.status(200).json({
      success: true,
      message: 'Reset link sent to your email',
      request_id,
      unlock_token // Return for development/testing
    });
  } catch (err) {
    console.error('Error in request-pin-reset:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error processing request'
    });
  }
});

// ============================================
// RESET PIN WITH TOKEN
// ============================================
/**
 * POST /api/reset-pin-with-token
 * User submits new PIN with valid unlock token
 */
router.post('/reset-pin-with-token', async (req, res) => {
  try {
    const { request_id, unlock_token, new_pin_hash } = req.body;

    if (!request_id || !unlock_token || !new_pin_hash) {
      return res.status(400).json({
        success: false,
        message: 'Request ID, token, and new PIN required'
      });
    }

    // Get unlock request
    const { data: unlockRequests, error: getError } = await supabase
      .from('account_unlock_requests')
      .select('*')
      .eq('id', request_id)
      .single();

    if (getError || !unlockRequests) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired request'
      });
    }

    const request = unlockRequests;
    const now = new Date();
    const expiryDate = new Date(request.token_expiry);

    // Validate token
    if (request.unlock_token !== unlock_token) {
      console.warn('Invalid token:', { request_id, token_hash: unlock_token.substring(0, 10) });
      return res.status(400).json({
        success: false,
        message: 'Invalid token'
      });
    }

    if (expiryDate < now) {
      return res.status(400).json({
        success: false,
        message: 'Reset link has expired (valid for 24 hours)'
      });
    }

    // Update user's PIN and reset failed attempts
    const { error: updateError } = await supabase.rpc(
      'reset_pin_with_token',
      {
        p_request_id: request_id,
        p_unlock_token: unlock_token,
        p_new_pin_hash: new_pin_hash
      }
    );

    if (updateError) {
      console.error('Error resetting PIN:', updateError);
      return res.status(500).json({
        success: false,
        message: updateError.message || 'Failed to reset PIN'
      });
    }

    // Update request status to completed
    await supabase
      .from('account_unlock_requests')
      .update({
        status: 'completed',
        updated_at: new Date().toISOString()
      })
      .eq('id', request_id);

    // Send account unlocked email
    const { data: userData } = await supabase
      .from('user_accounts')
      .select('email_address, full_name')
      .eq('id', request.user_id)
      .single();

    if (userData) {
      await emailService.sendAccountUnlockedEmail(
        userData.email_address,
        userData.full_name
      );
    }

    console.log('✅ PIN reset successful:', {
      user_id: request.user_id,
      request_id
    });

    return res.status(200).json({
      success: true,
      message: '✅ PIN has been reset successfully! Your account is now unlocked.'
    });
  } catch (err) {
    console.error('Error in reset-pin-with-token:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error processing PIN reset'
    });
  }
});

// ============================================
// REQUEST ADMIN UNLOCK
// ============================================
/**
 * POST /api/request-admin-unlock
 * User submits request for admin to unlock their account
 */
router.post('/request-admin-unlock', async (req, res) => {
  try {
    const { user_id, reason, email } = req.body;

    if (!user_id || !reason) {
      return res.status(400).json({
        success: false,
        message: 'User ID and reason required'
      });
    }

    // Create unlock request
    const { data: unlockRequest, error: createError } = await supabase
      .from('account_unlock_requests')
      .insert({
        user_id,
        request_type: 'admin_unlock',
        status: 'pending',
        reason,
        created_at: new Date().toISOString()
      })
      .select('id')
      .single();

    if (createError) {
      console.error('Error creating unlock request:', createError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create unlock request'
      });
    }

    // Send confirmation email
    if (email) {
      const { data: userData } = await supabase
        .from('user_accounts')
        .select('full_name')
        .eq('id', user_id)
        .single();

      if (userData) {
        await emailService.sendUnlockRequestSubmittedEmail(
          email,
          userData.full_name,
          unlockRequest.id
        );
      }
    }

    console.log('✅ Admin unlock request created:', {
      user_id,
      request_id: unlockRequest.id,
      reason
    });

    return res.status(200).json({
      success: true,
      message: '✅ Unlock request submitted. Our support team will review and approve within 5 minutes.',
      request_id: unlockRequest.id
    });
  } catch (err) {
    console.error('Error in request-admin-unlock:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error processing request'
    });
  }
});

// ============================================
// CHECK REQUEST STATUS
// ============================================
/**
 * GET /api/unlock-request-status/:request_id
 * Check status of unlock request
 */
router.get('/unlock-request-status/:request_id', async (req, res) => {
  try {
    const { request_id } = req.params;

    const { data: request, error } = await supabase
      .from('account_unlock_requests')
      .select('*')
      .eq('id', request_id)
      .single();

    if (error || !request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    const now = new Date();
    const createdAt = new Date(request.created_at);
    const minutesAgo = Math.floor((now - createdAt) / 60000);

    let status_message = '';
    if (request.status === 'pending') {
      status_message = `⏳ Pending review (submitted ${minutesAgo} minutes ago)`;
    } else if (request.status === 'approved') {
      status_message = '✅ Approved - Your account is now unlocked';
    } else if (request.status === 'rejected') {
      status_message = '❌ Request was rejected. Contact support.';
    } else if (request.status === 'completed') {
      status_message = '✅ Completed - Your PIN has been reset';
    }

    return res.status(200).json({
      success: true,
      request_type: request.request_type,
      status: request.status,
      status_message,
      minutes_ago: minutesAgo
    });
  } catch (err) {
    console.error('Error in unlock-request-status:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// ============================================
// ADMIN: GET PENDING UNLOCKS
// ============================================
/**
 * GET /api/admin/pending-unlocks
 * Admin dashboard - list pending unlock requests
 * Requires admin authentication
 */
router.get('/admin/pending-unlocks', async (req, res) => {
  try {
    // Verify admin authorization (implement your auth check)
    const adminId = req.user?.id; // Assume middleware sets req.user

    // Get pending requests with user details
    const { data: requests, error } = await supabase
      .from('account_unlock_requests')
      .select(`
        *,
        user_accounts:user_id(id, full_name, account_number, email_address)
      `)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching pending unlocks:', error);
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch requests'
      });
    }

    return res.status(200).json({
      success: true,
      data: requests,
      count: requests.length
    });
  } catch (err) {
    console.error('Error in admin/pending-unlocks:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
});

// ============================================
// ADMIN: APPROVE/REJECT UNLOCK
// ============================================
/**
 * POST /api/admin/approve-unlock
 * Admin approves or rejects an unlock request
 */
router.post('/admin/approve-unlock', async (req, res) => {
  try {
    const { request_id, action, admin_notes } = req.body; // action: 'approve' or 'reject'
    const adminId = req.user?.id; // Assume middleware sets req.user

    if (!request_id || !action) {
      return res.status(400).json({
        success: false,
        message: 'Request ID and action required'
      });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action must be approve or reject'
      });
    }

    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // Get request
    const { data: request } = await supabase
      .from('account_unlock_requests')
      .select('*')
      .eq('id', request_id)
      .single();

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    // Update request status
    const { error: updateError } = await supabase
      .from('account_unlock_requests')
      .update({
        status: newStatus,
        admin_id: adminId,
        admin_notes,
        updated_at: new Date().toISOString()
      })
      .eq('id', request_id);

    if (updateError) {
      throw updateError;
    }

    // If approved, reset failed attempts
    if (action === 'approve') {
      await supabase.rpc('admin_unlock_account', {
        p_user_id: request.user_id,
        p_admin_id: adminId,
        p_reason: `Admin approval: ${admin_notes || 'N/A'}`
      });
    }

    // Send email to user
    const { data: userData } = await supabase
      .from('user_accounts')
      .select('email_address, full_name')
      .eq('id', request.user_id)
      .single();

    if (userData) {
      if (action === 'approve') {
        await emailService.sendAccountUnlockedEmail(
          userData.email_address,
          userData.full_name
        );
      }
    }

    console.log(`✅ Admin ${action}d unlock request:`, {
      request_id,
      user_id: request.user_id,
      admin_id: adminId
    });

    return res.status(200).json({
      success: true,
      message: `Request has been ${newStatus}`
    });
  } catch (err) {
    console.error('Error in admin/approve-unlock:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error processing approval'
    });
  }
});

// ============================================
// QUICK UNLOCK WITH PIN VERIFICATION
// ============================================
/**
 * POST /api/admin/quick-unlock
 * Fast unlock - verify PIN and unlock account immediately
 * Agent enters PIN to prove identity, account unlocks instantly
 */
router.post('/admin/quick-unlock', async (req, res) => {
  try {
    const { user_id, pin_hash } = req.body;

    if (!user_id || !pin_hash) {
      return res.status(400).json({
        success: false,
        message: 'User ID and PIN required'
      });
    }

    // Get user account and verify PIN
    const { data: userAccount, error: userError } = await supabase
      .from('user_accounts')
      .select('id, pin_hash, failed_pin_attempts')
      .eq('id', user_id)
      .single();

    if (userError || !userAccount) {
      return res.status(404).json({
        success: false,
        message: 'User account not found'
      });
    }

    // Verify PIN
    if (userAccount.pin_hash !== pin_hash) {
      console.warn('Invalid PIN for quick unlock:', { user_id });
      return res.status(401).json({
        success: false,
        message: 'Invalid PIN. Please try again.'
      });
    }

    // PIN is correct - unlock account by resetting failed attempts
    const { error: updateError } = await supabase
      .from('user_accounts')
      .update({
        failed_pin_attempts: 0,
        account_locked: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', user_id);

    if (updateError) {
      console.error('Error unlocking account:', updateError);
      return res.status(500).json({
        success: false,
        message: 'Failed to unlock account'
      });
    }

    // Log unlock action
    console.log('✅ Quick unlock successful:', {
      user_id,
      timestamp: new Date().toISOString()
    });

    return res.status(200).json({
      success: true,
      message: '✅ Account unlocked successfully! You can now proceed with transactions.'
    });
  } catch (err) {
    console.error('Error in quick-unlock:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error processing unlock'
    });
  }
});

export default router;
