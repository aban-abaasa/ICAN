import { Router } from 'express';
import sgMail from '@sendgrid/mail';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const router = Router();

// Initialize SendGrid with API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const fromEmail = process.env.SENDER_EMAIL || 'aronnykevin@gmail.com';
const supportEmail = process.env.SUPPORT_EMAIL || 'support@ican.ug';
const appUrl = process.env.APP_URL || 'http://localhost:5173';

// Service-role client for the self-service PIN reset route below — needed to
// verify the caller's session and to write pin_reset_tokens rows regardless
// of RLS (that table has no client-facing policies at all, see
// backend/PIN_RESET_EMAIL_SELFSERVICE.sql).
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminSupabase =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : null;

/**
 * 📧 EMAIL ROUTES - Backend SendGrid Integration
 * Handles all email sending operations securely
 */

// ============================================
// SEND PIN RESET EMAIL
// ============================================
router.post('/send-pin-reset', async (req, res) => {
  try {
    const { to, userName, resetLink, requestId } = req.body;

    if (!to || !userName || !resetLink) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
            .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px 15px; margin: 15px 0; border-radius: 4px; }
            .footer { font-size: 12px; color: #666; margin-top: 20px; text-align: center; }
            .code { background: #f0f0f0; padding: 10px; border-radius: 4px; font-family: monospace; word-break: break-all; margin: 10px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🔐 PIN RESET REQUEST</h1>
            </div>
            <div class="content">
              <p>Hi <strong>${userName}</strong>,</p>
              
              <p>We received a request to reset your ICAN transaction PIN. If you didn't make this request, please ignore this email.</p>
              
              <h3>Reset Your PIN</h3>
              <p>Click the button below to create a new PIN:</p>
              <a href="${resetLink}" class="button">RESET PIN NOW</a>
              
              <p><strong>Or copy this link:</strong></p>
              <div class="code">${resetLink}</div>
              
              <div class="warning">
                ⚠️ <strong>Important:</strong> This link expires in 24 hours.
              </div>
              
              <h3>What's Next?</h3>
              <ol>
                <li>Click the button above or copy the link</li>
                <li>Enter your new 4-digit PIN</li>
                <li>Your account will be unlocked automatically</li>
                <li>Log in with your new PIN</li>
              </ol>
              
              <h3>Didn't Request This?</h3>
              <p>If you didn't ask to reset your PIN, your account might be at risk. Contact us immediately:</p>
              <p>
                📧 Email: ${supportEmail}<br>
                📱 Phone: +256 700 123 456
              </p>
              
              <div class="footer">
                <p>Request ID: ${requestId}</p>
                <p>This is an automated message. Do not reply to this email.</p>
                <p>&copy; 2026 ICAN. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const msg = {
      to,
      from: fromEmail,
      subject: '🔐 Reset Your ICAN PIN - 24 Hours Valid',
      html: htmlContent
    };

    await sgMail.send(msg);

    console.log('✅ PIN reset email sent to:', to);
    return res.status(200).json({
      success: true,
      message: 'Email sent successfully'
    });
  } catch (error) {
    console.error('❌ Error sending PIN reset email:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================
// SELF-SERVICE PIN RESET — request an emailed link
// ============================================
// Mirrors the sign-in page's Forgot Password flow, as an alternative to the
// dev-reviewed request in PIN_RECOVERY_AND_ACCOUNT_UNLOCK.sql /
// PINRecoveryModal.jsx (that flow is unchanged and still works).
//
// The raw reset token is generated here and embedded only in the emailed
// link — it is deliberately never included in this endpoint's JSON
// response, so the calling browser tab can't skip the email step and redeem
// it directly (that was exactly the bypass PIN_RECOVERY_AND_ACCOUNT_UNLOCK.sql
// removed from the old reset_pin_with_token design). Only its SHA-256 hash
// is stored, via redeem_pin_reset_token() in
// backend/PIN_RESET_EMAIL_SELFSERVICE.sql.
router.post('/request-pin-reset', async (req, res) => {
  try {
    if (!adminSupabase) {
      return res.status(500).json({
        success: false,
        message: 'Server is missing Supabase configuration.'
      });
    }

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Missing authorization token.'
      });
    }

    const accessToken = authHeader.replace('Bearer ', '').trim();
    const { data: tokenUserData, error: tokenUserError } = await adminSupabase.auth.getUser(accessToken);
    const currentUser = tokenUserData?.user;

    if (tokenUserError || !currentUser) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session.'
      });
    }

    const accountType = req.body?.accountType === 'business' ? 'business' : 'personal';

    const { data: account } = await adminSupabase
      .from('user_accounts')
      .select('account_holder_name, email')
      .eq('user_id', currentUser.id)
      .eq('account_type', accountType)
      .maybeSingle();

    if (!account) {
      return res.status(404).json({
        success: false,
        message: `No ${accountType} account found for this user.`
      });
    }

    const recipientEmail = account.email || currentUser.email;
    if (!recipientEmail) {
      return res.status(400).json({
        success: false,
        message: 'No email on file for this account.'
      });
    }

    // Cooldown: don't send another email if a live token was already issued
    // for this account type in the last couple of minutes.
    const { data: recent } = await adminSupabase
      .from('pin_reset_tokens')
      .select('id, created_at')
      .eq('user_id', currentUser.id)
      .eq('account_type', accountType)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent && Date.now() - new Date(recent.created_at).getTime() < 2 * 60 * 1000) {
      return res.status(200).json({
        success: true,
        message: 'A reset link was already sent — check your email.'
      });
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { data: inserted, error: insertError } = await adminSupabase
      .from('pin_reset_tokens')
      .insert([{ user_id: currentUser.id, token_hash: tokenHash, expires_at: expiresAt, account_type: accountType }])
      .select('id')
      .single();

    if (insertError) {
      console.error('❌ Error creating pin reset token:', insertError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create reset link.'
      });
    }

    const resetLink = `${appUrl}/reset-pin?token=${rawToken}`;
    const userName = account.account_holder_name || currentUser.email;
    const accountLabel = accountType === 'business' ? 'Business' : 'Personal';

    const msg = {
      to: recipientEmail,
      from: fromEmail,
      subject: `🔐 Reset Your ICAN ${accountLabel} Wallet PIN`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                <h1>🔐 PIN Reset</h1>
              </div>
              <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px;">
                <p>Hi ${userName},</p>
                <p>Click below to set a new PIN for your ICAN ${accountLabel} Wallet.</p>
                <a href="${resetLink}" style="display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0;">Reset My PIN</a>
                <p style="font-size: 12px; word-break: break-all;">${resetLink}</p>
                <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px 15px; margin: 15px 0; border-radius: 4px;">
                  ⚠️ This link expires in 30 minutes and can only be used once. If you didn't request this, ignore this email — your PIN stays unchanged.
                </div>
                <p style="font-size: 12px; color: #666;">Support: ${supportEmail}</p>
              </div>
            </div>
          </body>
        </html>
      `
    };

    await sgMail.send(msg);
    console.log('✅ Self-service PIN reset email sent to:', recipientEmail, 'account type:', accountType, 'token row:', inserted.id);

    return res.status(200).json({
      success: true,
      message: 'Reset link sent — check your email.'
    });
  } catch (error) {
    console.error('❌ Error requesting PIN reset:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to send reset link.'
    });
  }
});

// ============================================
// SIGNUP EMAIL OTP — verify email before first-time PIN creation
// ============================================
// Sends a 6-digit code (not a link — account creation is a multi-field
// in-page form, so redirecting away would lose entered data) to the email
// the user typed in the "Create Account" form. Only its SHA-256 hash is
// stored; verification happens client-side via the
// verify_account_creation_otp() RPC in
// backend/SIGNUP_EMAIL_OTP_VERIFICATION.sql once the user types the code
// back into the form.
router.post('/request-account-otp', async (req, res) => {
  try {
    if (!adminSupabase) {
      return res.status(500).json({
        success: false,
        message: 'Server is missing Supabase configuration.'
      });
    }

    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Missing authorization token.'
      });
    }

    const accessToken = authHeader.replace('Bearer ', '').trim();
    const { data: tokenUserData, error: tokenUserError } = await adminSupabase.auth.getUser(accessToken);
    const currentUser = tokenUserData?.user;

    if (tokenUserError || !currentUser) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session.'
      });
    }

    const email = (req.body?.email || '').trim().toLowerCase();
    const accountType = req.body?.accountType === 'business' ? 'business' : 'personal';

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Enter a valid email address.'
      });
    }

    // Cooldown: don't spam a fresh code if one is still live for this
    // user + account type.
    const { data: recent } = await adminSupabase
      .from('account_creation_otps')
      .select('id, created_at')
      .eq('user_id', currentUser.id)
      .eq('account_type', accountType)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recent && Date.now() - new Date(recent.created_at).getTime() < 60 * 1000) {
      return res.status(200).json({
        success: true,
        message: 'A code was already sent — check your email.'
      });
    }

    const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insertError } = await adminSupabase
      .from('account_creation_otps')
      .insert([{ user_id: currentUser.id, email, account_type: accountType, code_hash: codeHash, expires_at: expiresAt }]);

    if (insertError) {
      console.error('❌ Error creating account OTP:', insertError);
      return res.status(500).json({
        success: false,
        message: 'Failed to send verification code.'
      });
    }

    const accountLabel = accountType === 'business' ? 'Business' : 'Personal';

    const msg = {
      to: email,
      from: fromEmail,
      subject: `🔐 Your ICAN ${accountLabel} Account Verification Code`,
      html: `
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center;">
                <h1>🔐 Verify Your Email</h1>
              </div>
              <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px;">
                <p>Enter this code to continue setting up your ICAN ${accountLabel} Wallet:</p>
                <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; color: #667eea; margin: 20px 0;">${code}</p>
                <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 10px 15px; margin: 15px 0; border-radius: 4px;">
                  ⚠️ This code expires in 10 minutes. If you didn't request this, ignore this email.
                </div>
                <p style="font-size: 12px; color: #666;">Support: ${supportEmail}</p>
              </div>
            </div>
          </body>
        </html>
      `
    };

    await sgMail.send(msg);
    console.log('✅ Account creation OTP sent to:', email, 'account type:', accountType);

    return res.status(200).json({
      success: true,
      message: 'Verification code sent — check your email.'
    });
  } catch (error) {
    console.error('❌ Error requesting account OTP:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to send verification code.'
    });
  }
});

// ============================================
// SEND ACCOUNT UNLOCKED EMAIL
// ============================================
router.post('/send-account-unlocked', async (req, res) => {
  try {
    const { to, userName } = req.body;

    if (!to || !userName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
            .success { background: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 15px 0; border-radius: 4px; color: #155724; }
            .button { display: inline-block; background: #28a745; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
            .footer { font-size: 12px; color: #666; margin-top: 20px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>✅ ACCOUNT UNLOCKED</h1>
            </div>
            <div class="content">
              <p>Hi <strong>${userName}</strong>,</p>
              
              <div class="success">
                <strong>Great news!</strong> Your ICAN account has been unlocked and is ready to use.
              </div>
              
              <h3>What You Can Do Now:</h3>
              <ul>
                <li>✅ Log in to your account</li>
                <li>✅ Send and receive money</li>
                <li>✅ Withdraw and deposit</li>
                <li>✅ All other transactions</li>
              </ul>
              
              <h3>Questions?</h3>
              <p>Contact our support team:</p>
              <p>
                📧 Email: ${supportEmail}<br>
                📱 Phone: +256 700 123 456
              </p>
              
              <div class="footer">
                <p>&copy; 2026 ICAN. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const msg = {
      to,
      from: fromEmail,
      subject: '✅ Your ICAN Account is Now Unlocked',
      html: htmlContent
    };

    await sgMail.send(msg);

    console.log('✅ Account unlocked email sent to:', to);
    return res.status(200).json({
      success: true,
      message: 'Email sent successfully'
    });
  } catch (error) {
    console.error('❌ Error sending account unlocked email:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================
// SEND UNLOCK REQUEST EMAIL
// ============================================
router.post('/send-unlock-request', async (req, res) => {
  try {
    const { to, userName, requestId } = req.body;

    if (!to || !userName) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    const htmlContent = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
            .info { background: #cfe2ff; border-left: 4px solid #0d6efd; padding: 15px; margin: 15px 0; border-radius: 4px; }
            .footer { font-size: 12px; color: #666; margin-top: 20px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📋 REQUEST RECEIVED</h1>
            </div>
            <div class="content">
              <p>Hi <strong>${userName}</strong>,</p>
              
              <div class="info">
                <strong>⏳ Your unlock request is being processed</strong><br>
                We typically respond within 30 minutes during business hours.
              </div>
              
              <h3>Your Request Details</h3>
              <p><strong>Request ID:</strong> ${requestId}</p>
              <p><strong>Status:</strong> ⏳ Pending Review</p>
              
              <h3>What Happens Next?</h3>
              <ol>
                <li>Our support team reviews your request</li>
                <li>We verify your identity</li>
                <li>Your account is unlocked</li>
                <li>You receive a confirmation email</li>
              </ol>
              
              <div class="footer">
                <p>&copy; 2026 ICAN. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    const msg = {
      to,
      from: fromEmail,
      subject: `📋 Your Unlock Request #${requestId} is Being Reviewed`,
      html: htmlContent
    };

    await sgMail.send(msg);

    console.log('✅ Unlock request email sent to:', to);
    return res.status(200).json({
      success: true,
      message: 'Email sent successfully'
    });
  } catch (error) {
    console.error('❌ Error sending unlock request email:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================
// TEST EMAIL
// ============================================
router.post('/send-test', async (req, res) => {
  try {
    const { to } = req.body;

    if (!to) {
      return res.status(400).json({
        success: false,
        message: 'Email address required'
      });
    }

    const msg = {
      to,
      from: fromEmail,
      subject: '🧪 ICAN Test Email',
      html: `
        <html>
          <body style="font-family: Arial; padding: 20px;">
            <h1>✅ Test Email Successful!</h1>
            <p>This is a test email from ICAN.</p>
            <p>SendGrid integration is working correctly.</p>
            <p>Sent at: ${new Date().toLocaleString()}</p>
          </body>
        </html>
      `
    };

    await sgMail.send(msg);

    console.log('✅ Test email sent to:', to);
    return res.status(200).json({
      success: true,
      message: 'Test email sent successfully'
    });
  } catch (error) {
    console.error('❌ Error sending test email:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

export default router;
