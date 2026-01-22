/**
 * 📧 EMAIL SERVICE - SendGrid Integration
 * 
 * Frontend service that calls backend API to send emails
 * Backend handles SendGrid integration securely
 */

class EmailService {
  constructor() {
    // Backend API endpoint - uses Vite environment variables
    this.apiBaseUrl = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
    this.apiUrl = `${this.apiBaseUrl}/email/send`;
  }

  /**
   * 🔐 SEND PIN RESET EMAIL
   * Sends unlock link to user's email via backend API
   */
  async sendPinResetEmail(userEmail, userName, resetLink, requestId) {
    try {
      const response = await fetch(`${this.apiBaseUrl}/email/send-pin-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: userEmail,
          userName,
          resetLink,
          requestId
        })
      });

      const data = await response.json();

      if (!data.success) {
        console.error('❌ PIN reset email failed:', data);
        return {
          success: false,
          message: data.message || 'Failed to send email'
        };
      }

      console.log('✅ PIN reset email sent to:', userEmail);
      return {
        success: true,
        message: 'Email sent successfully'
      };
    } catch (error) {
      console.error('❌ Error sending PIN reset email:', error);
      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * ✅ SEND ACCOUNT UNLOCKED EMAIL
   * Confirmation after account unlock
   */
  async sendAccountUnlockedEmail(userEmail, userName) {
    try {
      const response = await fetch(`${this.apiBaseUrl}/email/send-account-unlocked`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: userEmail,
          userName
        })
      });

      const data = await response.json();

      if (!data.success) {
        console.error('❌ Account unlocked email failed:', data);
        return { success: false };
      }

      console.log('✅ Account unlocked email sent to:', userEmail);
      return { success: true };
    } catch (error) {
      console.error('❌ Error sending account unlocked email:', error);
      return { success: false };
    }
  }

  /**
   * 📬 SEND UNLOCK REQUEST EMAIL
   * Notification when unlock request is submitted
   */
  async sendUnlockRequestSubmittedEmail(userEmail, userName, requestId) {
    try {
      const response = await fetch(`${this.apiBaseUrl}/email/send-unlock-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: userEmail,
          userName,
          requestId
        })
      });

      const data = await response.json();

      if (!data.success) {
        console.error('❌ Unlock request email failed:', data);
        return { success: false };
      }

      console.log('✅ Unlock request email sent to:', userEmail);
      return { success: true };
    } catch (error) {
      console.error('❌ Error sending unlock request email:', error);
      return { success: false };
    }
  }

  /**
   * 📄 SEND TRANSACTION RECEIPT EMAIL
   * Receipt and confirmation for transactions
   */
  async sendTransactionReceiptEmail(userEmail, userName, transactionData) {
    try {
      const response = await fetch(`${this.apiBaseUrl}/email/send-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: userEmail,
          userName,
          transactionData
        })
      });

      const data = await response.json();

      if (!data.success) {
        console.error('❌ Receipt email failed:', data);
        return { success: false };
      }

      console.log('✅ Receipt email sent to:', userEmail);
      return { success: true };
    } catch (error) {
      console.error('❌ Error sending receipt email:', error);
      return { success: false };
    }
  }

  /**
   * ✅ SEND ACCOUNT UNLOCK CONFIRMATION
   */
  async sendAccountUnlockedEmail(userEmail, userName) {
    const emailContent = `
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
              
              <p>If your PIN was reset, use your new PIN to log in.</p>
              
              <a href="https://app.ican.ug/login" class="button">LOG IN NOW</a>
              
              <h3>Questions?</h3>
              <p>Contact our support team:</p>
              <p>
                📧 Email: ${this.supportEmail}<br>
                📱 Phone: +256 700 123 456<br>
                💬 WhatsApp: +256 700 123 456
              </p>
              
              <div class="footer">
                <p>&copy; 2026 ICAN. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    return this.sendEmail({
      to: userEmail,
      subject: '✅ Your ICAN Account is Now Unlocked',
      htmlContent: emailContent,
      templateId: 'account_unlocked'
    });
  }

  /**
   * 📋 SEND UNLOCK REQUEST SUBMITTED CONFIRMATION
   */
  async sendUnlockRequestSubmittedEmail(userEmail, userName, requestId) {
    const emailContent = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
            .info { background: #cfe2ff; border-left: 4px solid #0d6efd; padding: 15px; margin: 15px 0; border-radius: 4px; }
            .timeline { background: white; border: 1px solid #ddd; padding: 15px; border-radius: 4px; margin: 15px 0; }
            .timeline-item { margin: 10px 0; padding-left: 20px; border-left: 3px solid #667eea; }
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
              <div class="timeline">
                <div class="timeline-item">
                  <strong>Request ID:</strong> ${requestId}
                </div>
                <div class="timeline-item">
                  <strong>Submitted:</strong> ${new Date().toLocaleString()}
                </div>
                <div class="timeline-item">
                  <strong>Status:</strong> ⏳ Pending Review
                </div>
              </div>
              
              <h3>What Happens Next?</h3>
              <ol>
                <li>Our support team reviews your request</li>
                <li>We verify your identity</li>
                <li>Your account is unlocked</li>
                <li>You receive a confirmation email</li>
                <li>You can log in again</li>
              </ol>
              
              <h3>Expected Timeline</h3>
              <ul>
                <li>⏱️ During business hours (8am-6pm EAT): 5-30 minutes</li>
                <li>🌙 After hours: within 2 hours next business day</li>
              </ul>
              
              <h3>Need Faster Help?</h3>
              <p>Contact support directly:</p>
              <p>
                📧 Email: ${this.supportEmail}<br>
                📱 Phone: +256 700 123 456<br>
                💬 WhatsApp: +256 700 123 456
              </p>
              
              <div class="footer">
                <p>Request ID: ${requestId}</p>
                <p>&copy; 2026 ICAN. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    return this.sendEmail({
      to: userEmail,
      subject: `📋 Your Unlock Request #${requestId} is Being Reviewed`,
      htmlContent: emailContent,
      templateId: 'unlock_request_submitted'
    });
  }

  /**
   * 🔧 SEND TRANSACTION RECEIPT
   */
  async sendTransactionReceiptEmail(userEmail, userName, transactionData) {
    const { 
      transactionType, 
      amount, 
      currency, 
      recipient, 
      timestamp, 
      transactionId,
      status 
    } = transactionData;

    const emailContent = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
            .receipt { background: white; border: 1px solid #ddd; padding: 20px; border-radius: 4px; margin: 15px 0; }
            .receipt-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee; }
            .receipt-row strong { flex: 1; }
            .receipt-total { font-size: 24px; font-weight: bold; color: #28a745; text-align: center; padding: 15px 0; }
            .status { padding: 10px; border-radius: 4px; text-align: center; font-weight: bold; }
            .status.success { background: #d4edda; color: #155724; }
            .footer { font-size: 12px; color: #666; margin-top: 20px; text-align: center; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>📄 TRANSACTION RECEIPT</h1>
            </div>
            <div class="content">
              <p>Hi <strong>${userName}</strong>,</p>
              
              <p>Your transaction has been completed. Here are the details:</p>
              
              <div class="receipt">
                <div class="receipt-row">
                  <strong>Transaction Type:</strong>
                  <span>${transactionType}</span>
                </div>
                <div class="receipt-row">
                  <strong>Amount:</strong>
                  <span>${currency} ${amount.toLocaleString()}</span>
                </div>
                ${recipient ? `
                <div class="receipt-row">
                  <strong>Recipient:</strong>
                  <span>${recipient}</span>
                </div>
                ` : ''}
                <div class="receipt-row">
                  <strong>Date & Time:</strong>
                  <span>${new Date(timestamp).toLocaleString()}</span>
                </div>
                <div class="receipt-row">
                  <strong>Transaction ID:</strong>
                  <span>${transactionId}</span>
                </div>
                
                <div class="status success">
                  ✅ ${status.toUpperCase()}
                </div>
              </div>
              
              <p>Your new account balance has been updated. You can view your full transaction history in the ICAN app.</p>
              
              <div class="footer">
                <p>&copy; 2026 ICAN. All rights reserved.</p>
              </div>
            </div>
          </div>
        </body>
      </html>
    `;

    return this.sendEmail({
      to: userEmail,
      subject: `📄 Transaction Receipt - ${transactionType} (${currency} ${amount})`,
      htmlContent: emailContent,
      templateId: 'transaction_receipt'
    });
  }

  /**
   * 🎯 CORE EMAIL SENDING FUNCTION
   */
  async sendEmail({ to, subject, htmlContent, templateId }) {
    try {
      if (!this.apiKey) {
        console.error('❌ SendGrid API key not configured');
        return {
          success: false,
          message: 'Email service not configured',
          error: 'SENDGRID_API_KEY_MISSING'
        };
      }

      const payload = {
        personalizations: [
          {
            to: [{ email: to }],
            subject: subject
          }
        ],
        from: {
          email: this.fromEmail,
          name: 'ICAN Support'
        },
        content: [
          {
            type: 'text/html',
            value: htmlContent
          }
        ],
        reply_to: {
          email: this.supportEmail
        }
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const error = await response.json();
        console.error('❌ SendGrid Error:', error);
        return {
          success: false,
          message: 'Failed to send email',
          error: error
        };
      }

      console.log('✅ Email sent successfully:', { to, subject, templateId });
      return {
        success: true,
        message: 'Email sent successfully',
        templateId: templateId
      };
    } catch (error) {
      console.error('❌ Email sending error:', error);
      return {
        success: false,
        message: error.message,
        error: error
      };
    }
  }

  /**
   * 🧪 TEST EMAIL FUNCTION
   */
  async sendTestEmail(testEmail) {
    return this.sendEmail({
      to: testEmail,
      subject: '🧪 ICAN Test Email',
      htmlContent: `
        <html>
          <body style="font-family: Arial; padding: 20px;">
            <h1>✅ Test Email Successful!</h1>
            <p>This is a test email from ICAN.</p>
            <p>SendGrid integration is working correctly.</p>
            <p>Sent at: ${new Date().toLocaleString()}</p>
          </body>
        </html>
      `,
      templateId: 'test_email'
    });
  }
}

export default new EmailService();
