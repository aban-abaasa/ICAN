# Environment Variables for PIN Change Feature

## Copy this to your .env file

```env
# ========================================
# 🔐 PIN Change & OTP Configuration
# ========================================

# Twilio SMS Service
# Get these from: https://www.twilio.com/dashboard
TWILIO_ACCOUNT_SID=AC________________  # Your Twilio Account SID
TWILIO_AUTH_TOKEN=________________     # Your Twilio Auth Token  
TWILIO_PHONE_NUMBER=+1234567890       # Your Twilio Phone Number (with country code)

# ========================================
# 🗄️ Supabase Configuration
# ========================================

# Get these from: https://app.supabase.com
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# ========================================
# 🌍 Environment
# ========================================

# Set to 'development' for local testing (skips SMS, returns OTP in response)
# Set to 'production' for live (sends real SMS, doesn't expose OTP)
NODE_ENV=production

# Server port
PORT=5000

# ========================================
# 🔧 Application Configuration  
# ========================================

# Frontend URL (for CORS)
REACT_APP_BACKEND_URL=http://localhost:5000

# API Keys (if applicable)
API_SECRET_KEY=your_api_secret_key_here
```

## Step-by-Step Setup

### 1. Get Twilio Credentials

**Account SID & Auth Token:**
1. Go to https://www.twilio.com/console
2. Log in to your Twilio account
3. Look for "Account SID" and "Auth Token"
4. Copy both values

**Phone Number:**
1. In Twilio Dashboard, go to "Phone Numbers"
2. Click "Manage Numbers"
3. If you don't have a number, click "Buy a Number"
4. Search for a number with SMS capability
5. Format should be: +1234567890 (with country code and no spaces)

### 2. Get Supabase Keys

**Supabase URL & Service Role Key:**
1. Go to https://app.supabase.com
2. Select your project
3. Go to "Settings" → "API"
4. Copy "Project URL"
5. Copy "service_role" key (API Keys section)
   - ⚠️ **WARNING**: This key has admin access, keep it secret!

### 3. Create .env File

Location: `/frontend/.env` (in the frontend directory)

Copy the template above and fill in your actual values:

```env
TWILIO_ACCOUNT_SID=ACa1b2c3d4e5f6g7h8i9j0k1l
TWILIO_AUTH_TOKEN=9z8y7x6w5v4u3t2s1r0q9p8o7n6m
TWILIO_PHONE_NUMBER=+16234567890
SUPABASE_URL=https://abc123xyz789.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
NODE_ENV=production
PORT=5000
```

### 4. Verify Setup

Run this to verify your environment is loaded:

```bash
node -e "console.log(process.env.TWILIO_ACCOUNT_SID ? '✅ Twilio SID found' : '❌ Twilio SID missing')"
```

## Important Security Notes

⚠️ **NEVER commit .env file to Git!**

1. Make sure `.env` is in `.gitignore`:
   ```
   echo ".env" >> .gitignore
   ```

2. Never share these keys publicly

3. If compromised:
   - Regenerate Twilio tokens
   - Rotate Supabase keys
   - Update all deployments

## Testing Your Configuration

### Test Twilio Connection
```bash
npm install --save-dev dotenv
```

Create `test-twilio.js`:
```javascript
import dotenv from 'dotenv';
import twilio from 'twilio';

dotenv.config();

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

try {
  const account = await client.api.accounts.list({ limit: 1 });
  console.log('✅ Twilio connection successful');
  console.log('Account:', account[0].friendlyName);
} catch (error) {
  console.error('❌ Twilio connection failed:', error.message);
}
```

Run: `node test-twilio.js`

### Test Supabase Connection
Create `test-supabase.js`:
```javascript
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

try {
  const { data, error } = await supabase
    .from('users')
    .select('count', { count: 'exact', head: true });
  
  if (error) throw error;
  console.log('✅ Supabase connection successful');
} catch (error) {
  console.error('❌ Supabase connection failed:', error.message);
}
```

Run: `node test-supabase.js`

## Development vs Production

### Development Mode
```env
NODE_ENV=development
```

Features:
- OTP codes returned in API response (no SMS sent)
- Useful for local testing without SMS costs
- Shows masked phone number
- Logs to console

### Production Mode
```env
NODE_ENV=production
```

Features:
- Real SMS sent via Twilio
- OTP NOT returned in response
- No development debug info
- Secure error messages

## Common Issues

### ❌ "TWILIO_ACCOUNT_SID is not defined"
**Solution:** Make sure `.env` file exists and `npm start` is run from correct directory

### ❌ "Cannot find module 'twilio'"
**Solution:** Run `npm install twilio`

### ❌ "Invalid credentials"
**Solution:** Double-check your Twilio SID and Auth Token in Twilio dashboard

### ❌ "SMS not sending"
**Solution:**
- Verify phone number has SMS capability in Twilio
- Check SMS balance in Twilio account
- Verify recipient phone has country code (+256, +254)
- Check NODE_ENV is production

## .env.example (for Git)

Create `.env.example` (commit this to Git):

```env
# 🔐 PIN Change & OTP Configuration
TWILIO_ACCOUNT_SID=your_twilio_sid_here
TWILIO_AUTH_TOKEN=your_twilio_token_here
TWILIO_PHONE_NUMBER=+1234567890

# 🗄️ Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# 🌍 Environment
NODE_ENV=production
PORT=5000

# 🔧 Application Configuration
REACT_APP_BACKEND_URL=http://localhost:5000
```

## Next Steps

1. ✅ Create `.env` file with your values
2. ✅ Run `npm install twilio`
3. ✅ Run SQL migration in Supabase
4. ✅ Test with `npm start`
5. ✅ Verify with: `curl http://localhost:5000/health`
6. ✅ Test PIN change feature

🎉 Ready to go!

