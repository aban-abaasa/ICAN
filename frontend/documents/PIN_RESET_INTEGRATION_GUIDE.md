# 🔐 PIN RESET & ACCOUNT UNLOCK - INTEGRATION GUIDE

## Overview
Complete PIN reset and account unlock system with 3 recovery methods:
1. ✅ Self-service PIN reset (24-hour email link)
2. ✅ Admin unlock approval (request-based)
3. ✅ Direct admin unlock (emergency override)

---

## 📁 Files Created

### Frontend Components
```
frontend/src/components/PinResetFlow.jsx          (750+ lines)
frontend/src/services/emailService.js              (400+ lines) ✅ Already created
```

### Backend Routes
```
backend/routes/pinResetRoutes.js                   (400+ lines)
```

### Database
```
PIN_RECOVERY_AND_ACCOUNT_UNLOCK.sql               ✅ Already created
```

---

## 🔧 Backend Integration Steps

### Step 1: Import Routes in Main Server File

In your `backend/server.js` or `backend/app.js`:

```javascript
import pinResetRoutes from './routes/pinResetRoutes.js';

// Middleware
app.use(express.json());

// API Routes
app.use('/api', pinResetRoutes);
```

### Step 2: Environment Variables

Add to your `.env` file:

```env
# SendGrid (Add your API key from https://app.sendgrid.com/settings/api_keys)
SENDGRID_API_KEY=your_sendgrid_api_key_here

# Email Configuration
REACT_APP_FROM_EMAIL=your-verified-sender@example.com
REACT_APP_SUPPORT_EMAIL=support@ican.ug
SENDER_EMAIL=your-verified-sender@example.com
SENDER_NAME=ICAN Support

# App URLs
APP_URL=http://localhost:3000
FRONTEND_URL=http://localhost:3000

# Supabase (already configured)
SUPABASE_URL=your_url
SUPABASE_SERVICE_ROLE_KEY=your_key
```

### Step 3: Database Setup

Run the SQL script in Supabase:

```sql
-- Execute entire PIN_RECOVERY_AND_ACCOUNT_UNLOCK.sql
-- This creates:
--   - account_unlock_requests table
--   - request_account_unlock() function
--   - reset_pin_with_token() function
--   - admin_unlock_account() function
--   - get_unlock_request_status() function
```

### Step 4: Admin Authentication

The routes expect middleware to set `req.user`:

```javascript
// Add to your authentication middleware (before pinResetRoutes)
app.use((req, res, next) => {
  // Your auth logic here
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    // Verify token and set req.user
    req.user = { id: verified_user_id, role: 'admin' }; // or 'user'
  }
  next();
});
```

---

## 🎨 Frontend Integration Steps

### Step 1: Add PinResetFlow to Login Page

In your login component (e.g., `frontend/src/pages/Login.jsx`):

```javascript
import { useState } from 'react';
import PinResetFlow from '../components/PinResetFlow';

export default function LoginPage() {
  const [showPinReset, setShowPinReset] = useState(false);

  return (
    <div className="login-container">
      {/* Your existing login form */}
      <form onSubmit={handleLogin}>
        {/* Login fields */}
      </form>

      {/* Forgot PIN Link */}
      <button
        type="button"
        onClick={() => setShowPinReset(true)}
        className="text-sm text-purple-400 hover:text-purple-300 mt-4"
      >
        🔐 Forgot your PIN?
      </button>

      {/* PIN Reset Modal */}
      {showPinReset && (
        <PinResetFlow
          onSuccess={() => {
            setShowPinReset(false);
            window.location.href = '/login'; // Redirect to login
          }}
          onCancel={() => setShowPinReset(false)}
        />
      )}
    </div>
  );
}
```

### Step 2: Create PIN Reset Landing Page

Create `frontend/src/pages/PinResetPage.jsx`:

```javascript
import { useSearchParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import PinResetFlow from '../components/PinResetFlow';

export default function PinResetPage() {
  const [searchParams] = useSearchParams();
  const [step, setStep] = useState('request'); // or 'reset-pin'
  const requestId = searchParams.get('request');
  const token = searchParams.get('token');

  useEffect(() => {
    // If user has token, they came from email link
    if (requestId && token) {
      setStep('reset-pin');
    }
  }, [requestId, token]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-black flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">🔐 ICAN Wallet</h1>
          <p className="text-gray-400">Secure PIN Recovery</p>
        </div>

        {/* Component */}
        <PinResetFlow
          onSuccess={() => {
            setTimeout(() => window.location.href = '/login', 2000);
          }}
          onCancel={() => window.location.href = '/login'}
        />
      </div>
    </div>
  );
}
```

### Step 3: Add Route in Router Config

In your `frontend/src/App.jsx` or routing config:

```javascript
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import PinResetPage from './pages/PinResetPage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/reset-pin" element={<PinResetPage />} />
        {/* Other routes */}
      </Routes>
    </BrowserRouter>
  );
}
```

### Step 4: Show Account Locked Status

In your dashboard/main app, check for locked accounts:

```javascript
import { useEffect, useState } from 'react';

export default function Dashboard() {
  const [accountStatus, setAccountStatus] = useState(null);

  useEffect(() => {
    // Check if account is locked
    const checkStatus = async () => {
      const response = await fetch('/api/user/account-status', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      if (data.locked) {
        setAccountStatus('locked');
      }
    };
    checkStatus();
  }, []);

  if (accountStatus === 'locked') {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-6">
        <h2 className="text-red-400 font-bold">🔒 Account Locked</h2>
        <p className="text-red-300 text-sm mt-2">
          Your account is locked due to too many failed PIN attempts.
        </p>
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => navigate('/reset-pin')}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg"
          >
            Reset PIN
          </button>
          <button
            onClick={() => navigate('/request-unlock')}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
          >
            Request Unlock
          </button>
        </div>
      </div>
    );
  }

  return <div>{/* Your dashboard */}</div>;
}
```

---

## 📧 Email Flow

### Email 1: PIN Reset Request
**Sent**: When user clicks "Send Reset Link"
**To**: User's registered email
**Contains**: 
- 24-hour countdown timer
- "RESET PIN NOW" button (links to PIN reset page)
- Support contact info
- Request ID for tracking

### Email 2: Account Unlocked
**Sent**: When PIN is successfully reset
**To**: User's registered email
**Contains**:
- ✅ Confirmation message
- Instructions to log in with new PIN
- Support info

### Email 3: Unlock Request Received
**Sent**: When user requests admin unlock
**To**: User's registered email
**Contains**:
- Request ID for tracking
- Expected timeline (5 minutes - 30 minutes)
- Support contact

### Email 4: Account Unlocked (Admin)
**Sent**: When admin approves unlock request
**To**: User's registered email
**Contains**:
- ✅ Account has been unlocked
- Can now use old PIN again
- Contact support if issues

---

## 🔄 Complete User Flow

### Self-Service PIN Reset (24-hour link)
```
1. User at login page
   ↓
2. Clicks "🔐 Forgot PIN?" link
   ↓
3. PinResetFlow opens - Step 1: REQUEST
   ↓
4. Enters: Account Number + Email
   ↓
5. Backend: Creates unlock request + generates token
   ↓
6. Backend: Sends PIN reset email with link
   ↓
7. User sees: "Check your email" confirmation
   ↓
8. User clicks email link (valid 24 hours)
   ↓
9. Redirects to: /reset-pin?request=XXX&token=YYY
   ↓
10. PinResetFlow opens - Step 2: RESET PIN
    ↓
11. User enters new 4-digit PIN twice
    ↓
12. Backend: Validates token + updates PIN + resets counter
    ↓
13. Backend: Sends "Account Unlocked" email
    ↓
14. User sees: ✅ Success message
    ↓
15. Redirects to login after 3 seconds
    ↓
16. User logs in with new PIN ✅
```

### Admin Unlock Approval
```
1. Account locked (3 failed PIN attempts)
   ↓
2. User sees: "🔒 Account Locked - Request Unlock"
   ↓
3. User submits unlock request with reason
   ↓
4. Backend: Creates unlock request
   ↓
5. Backend: Sends "Unlock Request Submitted" email
   ↓
6. Admin sees notification in admin dashboard
   ↓
7. Admin reviews request + clicks "Approve"
   ↓
8. Backend: Resets failed_pin_attempts to 0
   ↓
9. Backend: Sends "Account Unlocked" email to user
   ↓
10. User can now log in again ✅
```

### Direct Admin Unlock (Emergency)
```
1. Admin navigates to admin panel
   ↓
2. Finds locked account
   ↓
3. Clicks "Force Unlock" button
   ↓
4. Backend: Immediately resets failed_pin_attempts
   ↓
5. User can log in immediately ✅
```

---

## 🧪 Testing Checklist

### Frontend Testing
- [ ] "Forgot PIN?" button appears on login
- [ ] PinResetFlow opens with request form
- [ ] Form validates account number & email
- [ ] Form submits and shows "Check your email"
- [ ] Can resend email from confirmation screen
- [ ] Email link redirects to PIN reset page
- [ ] PIN reset form validates 4 digits
- [ ] PIN reset form validates matching PINs
- [ ] Success message appears after reset
- [ ] Dashboard shows locked account message
- [ ] Can request unlock from dashboard

### Backend Testing
```bash
# Test 1: Request PIN Reset
curl -X POST http://localhost:4000/api/request-pin-reset \
  -H "Content-Type: application/json" \
  -d '{
    "account_number": "ICAN-8071026101388866",
    "email": "user@example.com"
  }'

# Test 2: Reset PIN with Token
curl -X POST http://localhost:4000/api/reset-pin-with-token \
  -H "Content-Type: application/json" \
  -d '{
    "request_id": "REQUEST_ID_FROM_ABOVE",
    "unlock_token": "TOKEN_FROM_ABOVE",
    "new_pin_hash": "MjM0NQ=="
  }'

# Test 3: Request Admin Unlock
curl -X POST http://localhost:4000/api/request-admin-unlock \
  -H "Content-Type: application/json" \
  -d '{
    "user_id": "USER_UUID",
    "reason": "Forgot PIN",
    "email": "user@example.com"
  }'

# Test 4: Check Request Status
curl http://localhost:4000/api/unlock-request-status/REQUEST_ID_HERE

# Test 5: Admin List Pending
curl http://localhost:4000/api/admin/pending-unlocks \
  -H "Authorization: Bearer ADMIN_TOKEN"

# Test 6: Admin Approve
curl -X POST http://localhost:4000/api/admin/approve-unlock \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ADMIN_TOKEN" \
  -d '{
    "request_id": "REQUEST_ID",
    "action": "approve",
    "admin_notes": "Verified identity"
  }'
```

### Email Testing
```javascript
// Test SendGrid connection
const emailService = require('./services/emailService');

await emailService.sendTestEmail('your@email.com');
// Should receive test email within 1-2 minutes
```

---

## 🔒 Security Notes

### Current Implementation
- ✅ 24-hour token expiry
- ✅ Random 32-byte tokens (cryptographically secure)
- ✅ Failed PIN attempts counter
- ✅ Audit trail (who/when unlocked)
- ✅ Email verification (ownership)

### Recommendations for Enhancement
- 🔲 Implement bcrypt/argon2 for PIN hashing (currently using btoa)
- 🔲 Add 2FA to PIN reset flow (SMS/authenticator)
- 🔲 Rate limit unlock requests (max 3 per hour)
- 🔲 Add CAPTCHA to prevent brute force
- 🔲 Log all unlock activities to audit system
- 🔲 Implement geolocation checks

---

## 📱 Mobile Optimization

PinResetFlow component is already mobile-responsive:
- ✅ Responsive grid (p-4 to p-8)
- ✅ Touch-friendly buttons
- ✅ Large PIN input (text-2xl)
- ✅ Clear visual hierarchy
- ✅ Color coding (red=error, blue=info, green=success)

---

## 🆘 Support Integration

Add support contact to locked account message:

```javascript
<div className="mt-4 text-center">
  <p className="text-gray-400 text-sm mb-2">Still having issues?</p>
  <a
    href="mailto:support@ican.ug"
    className="text-purple-400 hover:text-purple-300"
  >
    📧 Contact Support
  </a>
  <span className="text-gray-600 mx-2">•</span>
  <button
    onClick={() => setShowSupportChat(true)}
    className="text-purple-400 hover:text-purple-300"
  >
    💬 Live Chat
  </button>
</div>
```

---

## 📊 Admin Dashboard

Create `frontend/src/pages/AdminUnlocks.jsx`:

```javascript
import { useEffect, useState } from 'react';
import { Clock, CheckCircle, XCircle, Mail } from 'lucide-react';

export default function AdminUnlocksPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadPendingRequests();
  }, []);

  const loadPendingRequests = async () => {
    const response = await fetch('/api/admin/pending-unlocks', {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const data = await response.json();
    if (data.success) {
      setRequests(data.data);
    }
    setLoading(false);
  };

  const handleApprove = async (requestId) => {
    const response = await fetch('/api/admin/approve-unlock', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({
        request_id: requestId,
        action: 'approve',
        admin_notes: 'Auto-approved'
      })
    });
    const data = await response.json();
    if (data.success) {
      loadPendingRequests(); // Refresh
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-6">🔐 Unlock Requests</h1>
      
      <div className="space-y-4">
        {requests.map(req => (
          <div key={req.id} className="bg-slate-800 border border-purple-500/30 rounded-lg p-4">
            <div className="flex justify-between items-start mb-3">
              <div>
                <h3 className="text-white font-semibold">
                  {req.user_accounts.full_name}
                </h3>
                <p className="text-sm text-gray-400">
                  {req.user_accounts.account_number}
                </p>
              </div>
              <span className="text-xs px-2 py-1 bg-yellow-500/20 text-yellow-300 rounded">
                <Clock className="w-3 h-3 inline mr-1" />
                Pending
              </span>
            </div>

            <p className="text-sm text-gray-300 mb-4">
              Reason: {req.reason}
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => handleApprove(req.id)}
                className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-all flex items-center justify-center gap-2"
              >
                <CheckCircle className="w-4 h-4" />
                Approve
              </button>
              <button
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all flex items-center justify-center gap-2"
              >
                <XCircle className="w-4 h-4" />
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 🚀 Deployment Checklist

- [ ] Database script executed in Supabase
- [ ] Backend routes imported in main server
- [ ] Environment variables configured
- [ ] Frontend components created
- [ ] Routes added to router config
- [ ] SendGrid API key working
- [ ] Email templates tested
- [ ] Admin authentication working
- [ ] "Forgot PIN?" button on login
- [ ] PIN reset page created
- [ ] Locked account message showing
- [ ] All API endpoints tested
- [ ] Email sending verified
- [ ] Admin dashboard created
- [ ] Mobile responsiveness verified

---

## 📞 Support

**Common Issues:**

1. **"Email not sending"**
   - Check SendGrid API key in .env
   - Verify sender email is verified in SendGrid
   - Check server logs for error messages

2. **"Reset link expired"**
   - Links valid 24 hours - user needs to request new one
   - Check server time is synced correctly

3. **"Token mismatch"**
   - Token must match exactly (case-sensitive)
   - Don't modify URL parameters

4. **"Request not found"**
   - Request ID may be invalid or already used
   - Check database directly for request_id

---

## ✅ Success Criteria

- ✅ Users can reset PIN via email link
- ✅ Email link works for 24 hours
- ✅ PIN successfully updated in database
- ✅ Account unlocks automatically
- ✅ User can log in with new PIN
- ✅ Admin can view pending requests
- ✅ Admin can approve/reject requests
- ✅ All emails sent with correct formatting
- ✅ Audit trail recorded
- ✅ No security vulnerabilities

---

**Status**: 🟢 Ready for Implementation
**Last Updated**: Today
**Integration Time**: 2-3 hours
