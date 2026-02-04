# PIN Change with Phone Authentication - Setup Guide

## Overview
PIN change functionality with OTP verification requires:
1. **Backend API endpoints** - Added in `authRoutes.js`
2. **Database tables** - OTP codes and security logs
3. **Twilio integration** - For sending SMS
4. **Environment variables** - Configuration setup

## Step 1: Run Database Migrations

Execute the SQL file in your Supabase database:

1. Go to Supabase Dashboard → Your Project → SQL Editor
2. Create new query
3. Copy and paste the contents from `OTP_SECURITY_TABLES.sql`
4. Run the query

**What it creates:**
- `otp_codes` table - Stores OTP codes with expiry
- `security_logs` table - Audit trail of PIN changes
- `pin_hash` column in `user_accounts` table
- Row Level Security (RLS) policies

## Step 2: Configure Environment Variables

Add these to your `.env` file:

```env
# Twilio SMS Configuration
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890  # Your Twilio phone number

# Supabase Configuration (already set)
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Environment
NODE_ENV=production  # Change to development for SMS debugging
```

### Getting Twilio Credentials:

1. **Sign up for Twilio**: https://www.twilio.com/
2. **Get Account SID & Auth Token**: 
   - Go to Twilio Dashboard → Account section
   - Copy your Account SID and Auth Token
3. **Get a Twilio Phone Number**:
   - Go to Phone Numbers section
   - Buy a phone number (supports SMS)
4. **Enable SMS**: Ensure your account has SMS capability

## Step 3: Install Required Dependencies

The backend server needs these npm packages:

```bash
npm install twilio
npm install crypto  # Usually comes with Node.js
```

If you're using the frontend server, run:
```bash
cd frontend
npm install twilio
```

## Step 4: Update .env.example

Create/update `.env.example` with:

```env
# ===== Twilio Configuration =====
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=+1234567890

# ===== Supabase Configuration =====
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# ===== Environment =====
NODE_ENV=production
PORT=5000
```

## Step 5: Start the Backend Server

```bash
cd frontend
npm start  # Starts server with routes on port 5000
```

**Verify API is running:**
```bash
curl http://localhost:5000/health
```

Should return:
```json
{
  "status": "OK",
  "timestamp": "2026-01-20T...",
  "version": "1.0.0",
  "service": "ICAN Capital Engine API"
}
```

## API Endpoints

### 1. Send OTP
**POST** `/api/auth/send-otp`

Request:
```json
{
  "userId": "user-uuid-here",
  "phoneNumber": "+256701234567",
  "type": "pin_change"
}
```

Response (Success):
```json
{
  "success": true,
  "message": "OTP sent successfully",
  "maskedPhone": "256****67"
}
```

Response (Development Mode):
```json
{
  "success": true,
  "message": "OTP generated (DEV MODE - SMS disabled)",
  "otp": "123456",
  "maskedPhone": "256****67"
}
```

### 2. Verify OTP & Change PIN
**POST** `/api/auth/verify-otp-and-change-pin`

Request:
```json
{
  "userId": "user-uuid-here",
  "otp": "123456",
  "newPin": "1234"
}
```

Response (Success):
```json
{
  "success": true,
  "message": "PIN changed successfully"
}
```

### 3. Verify PIN (for transactions)
**POST** `/api/auth/verify-pin`

Request:
```json
{
  "userId": "user-uuid-here",
  "pin": "1234"
}
```

Response (Success):
```json
{
  "success": true,
  "message": "PIN verified successfully"
}
```

## Frontend Usage

The PIN change feature is accessible in the wallet settings:

1. Click **"✏️ Edit Account Information"**
2. Click **"🔐 Change PIN"** to expand the section
3. Enter:
   - Current PIN
   - New PIN (4-6 digits)
   - Confirm PIN
4. Click **"📱 Send OTP to Phone"**
5. Check SMS for 6-digit OTP
6. Enter OTP
7. Click **"✅ Verify & Change"**

## Development Mode (Testing without SMS)

To test without sending actual SMS messages:

1. Set `NODE_ENV=development` in `.env`
2. OTP will be returned in API response (not sent via SMS)
3. Use the returned OTP code for testing

**⚠️ IMPORTANT:** Remove this in production! Never expose OTP in responses in production.

## Database Schema

### otp_codes table
```sql
id (UUID)
user_id (UUID) - references auth.users
code (VARCHAR 6) - the OTP code
type (VARCHAR 50) - pin_change, email_verify, phone_verify
phone_number (VARCHAR 20)
email (VARCHAR 255)
expires_at (TIMESTAMP) - 5 minutes from creation
used (BOOLEAN) - false until verified
verified_at (TIMESTAMP)
created_at (TIMESTAMP)
updated_at (TIMESTAMP)
```

### security_logs table
```sql
id (UUID)
user_id (UUID) - references auth.users
action (VARCHAR 100) - pin_changed, pin_verification_failed, etc
ip_address (VARCHAR 45)
user_agent (TEXT)
details (JSONB) - additional context
timestamp (TIMESTAMP)
```

## Troubleshooting

### ❌ "Failed to send OTP: Failed to execute 'json' on 'Response'"

**Solution:** The backend server isn't running or API endpoint doesn't exist.

- Check: `npm start` is running on the frontend server
- Check: Port 5000 is accessible
- Test: `curl http://localhost:5000/health`

### ❌ "No valid OTP found"

**Causes:**
- OTP expired (5-minute window)
- Wrong OTP code
- OTP already used

**Solution:** Send new OTP

### ❌ "OTP has expired"

**Solution:** Request a new OTP (expires after 5 minutes)

### ❌ "Invalid PIN"

**Causes:**
- PIN doesn't match what was set
- Database PIN hash corruption

**Solution:** Try PIN change again or contact support

### ❌ Twilio SMS not sending

**Checklist:**
- ✅ Twilio account has SMS capability
- ✅ TWILIO_ACCOUNT_SID is correct
- ✅ TWILIO_AUTH_TOKEN is correct
- ✅ TWILIO_PHONE_NUMBER is correct (with country code)
- ✅ Recipient phone number has country code (+256, +254, etc)
- ✅ NODE_ENV is production (development skips SMS)

## Security Considerations

### PIN Storage
- PINs are hashed using SHA-256 + user ID as salt
- Never stored in plaintext
- Not transmitted over network (only verified server-side)

### OTP Security
- 6-digit codes are cryptographically random
- Expire after 5 minutes
- Marked as used after verification
- Never reusable

### Rate Limiting
- Implement rate limiting on OTP requests
- Prevent OTP brute force attacks
- Log failed attempts in security_logs

### HTTPS Required
- Always use HTTPS in production
- Never send PINs or OTPs over unencrypted connections

## Files Modified/Created

### New Files:
- `/frontend/server/routes/authRoutes.js` - Authentication API endpoints
- `/OTP_SECURITY_TABLES.sql` - Database migrations
- `PIN_CHANGE_SETUP_GUIDE.md` - This guide

### Modified Files:
- `/frontend/server/index.js` - Added auth routes
- `/frontend/src/components/ICANWallet.jsx` - PIN change UI

## Next Steps

1. ✅ Run SQL migration
2. ✅ Set environment variables
3. ✅ Install dependencies
4. ✅ Start backend server
5. ✅ Test in frontend
6. ✅ Monitor security_logs table
7. ✅ Set up automated OTP cleanup (expired codes)

## Support

For issues or questions:
1. Check error messages in browser console
2. Check backend server logs
3. Verify all environment variables are set
4. Check Twilio account status and SMS credits
5. Review security_logs table for failed attempts
