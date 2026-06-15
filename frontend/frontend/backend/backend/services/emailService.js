import sgMail from '@sendgrid/mail';

// Initialize SendGrid with API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const fromEmail = process.env.SENDER_EMAIL || 'aronnykevin@gmail.com';
const supportEmail = process.env.SUPPORT_EMAIL || 'support@ican.ug';
const appUrl = process.env.APP_URL || 'http://localhost:3000';

/**
 * Email Service - Wraps SendGrid API calls
 * Used by PIN reset routes and other backend operations
 */

const emailService = {
  /**
   * Send PIN reset email with 24-hour recovery link
   */
  async sendPinResetEmail(to, userName, resetLink, requestId) {
    try {
      const msg = {
        to,
        from: fromEmail,
        subject: '🔐 PIN Reset Request - ICAN Wallet',
        html: `
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
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>🔐 PIN RESET REQUEST</h1>
                </div>
                <div class="content">
                  <p>Hi ${userName},</p>
                  <p>We received a request to reset your PIN for your ICAN Wallet account. Click the link below to create a new PIN:</p>
                  <a href="${resetLink}" class="button">Reset Your PIN</a>
                  <p><strong>This link expires in 24 hours.</strong></p>
                  <div class="warning">
                    <strong>⚠️ Security Notice:</strong> If you didn't request this, please ignore this email. Your account is still secure.
                  </div>
                  <p>Request ID: ${requestId}</p>
                  <div class="footer">
                    <p>&copy; 2026 ICAN Wallet. All rights reserved.</p>
                    <p>For support: ${supportEmail}</p>
                  </div>
                </div>
              </div>
            </body>
          </html>
        `
      };

      await sgMail.send(msg);
      return { success: true, message: 'PIN reset email sent' };
    } catch (error) {
      console.error('Error sending PIN reset email:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send account unlocked confirmation email
   */
  async sendAccountUnlockedEmail(to, userName) {
    try {
      const msg = {
        to,
        from: fromEmail,
        subject: '✅ Account Unlocked - ICAN Wallet',
        html: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
                .success-box { background: #d4edda; border-left: 4px solid #28a745; padding: 15px; margin: 20px 0; border-radius: 4px; }
                .footer { font-size: 12px; color: #666; margin-top: 20px; text-align: center; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>✅ ACCOUNT UNLOCKED</h1>
                </div>
                <div class="content">
                  <p>Hi ${userName},</p>
                  <div class="success-box">
                    <h2 style="margin: 0; color: #28a745;">Your account has been unlocked successfully!</h2>
                  </div>
                  <p>You can now proceed with transactions on your ICAN Wallet account.</p>
                  <p>If you have any questions or concerns, please contact our support team at ${supportEmail}.</p>
                  <div class="footer">
                    <p>&copy; 2026 ICAN Wallet. All rights reserved.</p>
                  </div>
                </div>
              </div>
            </body>
          </html>
        `
      };

      await sgMail.send(msg);
      return { success: true, message: 'Account unlocked email sent' };
    } catch (error) {
      console.error('Error sending account unlocked email:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Send unlock request submission confirmation
   */
  async sendUnlockRequestSubmittedEmail(to, userName, requestId) {
    try {
      const msg = {
        to,
        from: fromEmail,
        subject: '📋 Unlock Request Received - ICAN Wallet',
        html: `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
                .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
                .info-box { background: #d1ecf1; border-left: 4px solid #17a2b8; padding: 15px; margin: 20px 0; border-radius: 4px; }
                .footer { font-size: 12px; color: #666; margin-top: 20px; text-align: center; }
              </style>
            </head>
            <body>
              <div class="container">
                <div class="header">
                  <h1>📋 UNLOCK REQUEST RECEIVED</h1>
                </div>
                <div class="content">
                  <p>Hi ${userName},</p>
                  <div class="info-box">
                    <h2 style="margin: 0; color: #17a2b8;">Your unlock request has been received!</h2>
                  </div>
                  <p>Our support team will review your request and respond within 5 minutes. Request ID: <strong>${requestId}</strong></p>
                  <p>You will receive an email notification once your account has been unlocked.</p>
                  <p>If you have any questions, please contact our support team at ${supportEmail}.</p>
                  <div class="footer">
                    <p>&copy; 2026 ICAN Wallet. All rights reserved.</p>
                  </div>
                </div>
              </div>
            </body>
          </html>
        `
      };

      await sgMail.send(msg);
      return { success: true, message: 'Unlock request confirmation email sent' };
    } catch (error) {
      console.error('Error sending unlock request email:', error);
      return { success: false, error: error.message };
    }
  }
};

export default emailService;
