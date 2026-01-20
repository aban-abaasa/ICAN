/**
 * 🔐 Authentication Routes
 * Handles OTP verification and PIN changes with phone authentication
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';
import crypto from 'crypto';

const router = express.Router();

// Initialize Supabase with service role key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// Initialize Twilio client for SMS
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '+1234567890';

/**
 * POST /api/auth/send-otp
 * Send OTP code to user's phone
 */
router.post('/send-otp', async (req, res) => {
  try {
    const { userId, phoneNumber, type } = req.body;

    // Validate input
    if (!userId || !phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'userId and phoneNumber are required'
      });
    }

    // Verify user exists
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('id, phone_number')
      .eq('id', userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    // Verify phone number matches
    if (user.phone_number !== phoneNumber) {
      return res.status(400).json({
        success: false,
        error: 'Phone number does not match account'
      });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Store OTP in database
    const { error: otpError } = await supabase
      .from('otp_codes')
      .insert([{
        user_id: userId,
        code: otp,
        type: type || 'pin_change',
        expires_at: expiresAt.toISOString(),
        phone_number: phoneNumber,
        used: false
      }]);

    if (otpError) {
      console.error('❌ Failed to store OTP:', otpError);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate OTP'
      });
    }

    // Send SMS via Twilio
    try {
      await twilioClient.messages.create({
        body: `Your ICAN Wallet PIN change code is: ${otp}\n\nThis code expires in 5 minutes. Never share this code.`,
        from: TWILIO_PHONE_NUMBER,
        to: phoneNumber
      });

      console.log(`✅ OTP sent to ${phoneNumber} for user ${userId}`);

      return res.status(200).json({
        success: true,
        message: 'OTP sent successfully',
        maskedPhone: phoneNumber.replace(/(\d{3})\d+(\d{2})/, '$1****$2')
      });

    } catch (smsError) {
      console.error('❌ Failed to send SMS:', smsError);

      // In development, return OTP for testing (REMOVE IN PRODUCTION)
      if (process.env.NODE_ENV === 'development') {
        return res.status(200).json({
          success: true,
          message: 'OTP generated (DEV MODE - SMS disabled)',
          otp: otp, // ⚠️ ONLY FOR DEVELOPMENT
          maskedPhone: phoneNumber.replace(/(\d{3})\d+(\d{2})/, '$1****$2')
        });
      }

      return res.status(500).json({
        success: false,
        error: 'Failed to send OTP via SMS'
      });
    }

  } catch (error) {
    console.error('❌ Error in /send-otp:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * POST /api/auth/verify-otp-and-change-pin
 * Verify OTP and change user's PIN
 */
router.post('/verify-otp-and-change-pin', async (req, res) => {
  try {
    const { userId, otp, newPin } = req.body;

    // Validate input
    if (!userId || !otp || !newPin) {
      return res.status(400).json({
        success: false,
        error: 'userId, otp, and newPin are required'
      });
    }

    // Validate PIN format
    if (newPin.length < 4 || newPin.length > 6 || !/^\d+$/.test(newPin)) {
      return res.status(400).json({
        success: false,
        error: 'PIN must be 4-6 digits'
      });
    }

    // Get user account
    const { data: userAccount, error: accountError } = await supabase
      .from('user_accounts')
      .select('id, user_id')
      .eq('user_id', userId)
      .single();

    if (accountError || !userAccount) {
      return res.status(404).json({
        success: false,
        error: 'User account not found'
      });
    }

    // Verify OTP
    const { data: otpRecord, error: otpError } = await supabase
      .from('otp_codes')
      .select('id, code, expires_at, used')
      .eq('user_id', userId)
      .eq('type', 'pin_change')
      .eq('used', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (otpError || !otpRecord) {
      return res.status(400).json({
        success: false,
        error: 'No valid OTP found'
      });
    }

    // Check OTP expiry
    const expiryTime = new Date(otpRecord.expires_at);
    if (new Date() > expiryTime) {
      // Mark as expired
      await supabase
        .from('otp_codes')
        .update({ used: true })
        .eq('id', otpRecord.id);

      return res.status(400).json({
        success: false,
        error: 'OTP has expired'
      });
    }

    // Verify OTP code
    if (otpRecord.code !== otp) {
      return res.status(400).json({
        success: false,
        error: 'Invalid OTP code'
      });
    }

    // Hash new PIN using SHA-256
    const hashedPin = crypto
      .createHash('sha256')
      .update(newPin + userId) // Add userId as salt
      .digest('hex');

    // Update PIN in database
    const { error: updateError } = await supabase
      .from('user_accounts')
      .update({
        pin_hash: hashedPin,
        updated_at: new Date().toISOString()
      })
      .eq('id', userAccount.id);

    if (updateError) {
      console.error('❌ Failed to update PIN:', updateError);
      return res.status(500).json({
        success: false,
        error: 'Failed to update PIN'
      });
    }

    // Mark OTP as used
    await supabase
      .from('otp_codes')
      .update({ used: true })
      .eq('id', otpRecord.id);

    // Log security event
    await supabase
      .from('security_logs')
      .insert([{
        user_id: userId,
        action: 'pin_changed',
        ip_address: req.ip || 'unknown',
        user_agent: req.get('user-agent'),
        timestamp: new Date().toISOString()
      }]).catch(err => console.error('Failed to log security event:', err));

    console.log(`✅ PIN changed successfully for user ${userId}`);

    return res.status(200).json({
      success: true,
      message: 'PIN changed successfully'
    });

  } catch (error) {
    console.error('❌ Error in /verify-otp-and-change-pin:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

/**
 * POST /api/auth/verify-pin
 * Verify user's PIN for transactions
 */
router.post('/verify-pin', async (req, res) => {
  try {
    const { userId, pin } = req.body;

    if (!userId || !pin) {
      return res.status(400).json({
        success: false,
        error: 'userId and pin are required'
      });
    }

    // Get user's PIN hash
    const { data: userAccount, error: accountError } = await supabase
      .from('user_accounts')
      .select('pin_hash')
      .eq('user_id', userId)
      .single();

    if (accountError || !userAccount) {
      return res.status(404).json({
        success: false,
        error: 'User account not found'
      });
    }

    // Hash provided PIN
    const hashedPin = crypto
      .createHash('sha256')
      .update(pin + userId)
      .digest('hex');

    // Compare
    const isValid = hashedPin === userAccount.pin_hash;

    if (!isValid) {
      // Log failed attempt
      await supabase
        .from('security_logs')
        .insert([{
          user_id: userId,
          action: 'pin_verification_failed',
          ip_address: req.ip || 'unknown',
          user_agent: req.get('user-agent'),
          timestamp: new Date().toISOString()
        }]).catch(err => console.error('Failed to log security event:', err));

      return res.status(401).json({
        success: false,
        error: 'Invalid PIN'
      });
    }

    return res.status(200).json({
      success: true,
      message: 'PIN verified successfully'
    });

  } catch (error) {
    console.error('❌ Error in /verify-pin:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
});

export default router;
