import { Router } from 'express';
import sgMail from '@sendgrid/mail';

const router = Router();

// Initialize SendGrid with API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const fromEmail = process.env.SENDER_EMAIL || 'aronnykevin@gmail.com';
const supportEmail = process.env.SUPPORT_EMAIL || 'support@ican.ug';

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
