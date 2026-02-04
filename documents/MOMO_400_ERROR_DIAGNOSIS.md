# 🧪 MOMO Backend 400 Error - Diagnosis Steps

## Current Error
```
POST http://localhost:5000/api/momo/request-payment 400 (Bad Request)
```

## What We've Done
1. ✅ Fixed Supabase connection (Invalid API key issue)
2. ✅ Backend server is running on port 5000
3. ✅ Added enhanced logging to backend request-payment endpoint
4. ✅ Added error response logging to frontend

## Next Steps to Diagnose

### Option 1: Run Backend Diagnostic Test
```bash
cd backend
node test-momo-endpoint.js
```

This will test 5 different payload scenarios:
- Valid Uganda number (07x format)
- Valid Uganda number (256 format)
- Valid Uganda number (+256 format)
- Missing phone number (should fail)
- Invalid amount (should fail)

### Option 2: Check Backend Logs
The backend needs to be restarted with the enhanced logging:

```bash
# Stop current backend (Ctrl+C if running in terminal)
# Then restart:
cd backend
npm start
```

Then try the MOMO top-up again. The backend console should show:
```
💰 Request Payment API Called:
   Amount: [number]
   Phone: [phone number]
   User: [userId]
   Raw Body: [full JSON payload]
   Formatted Phone: [formatted phone]
```

### Option 3: Check Frontend Browser Console
With the updated frontend code, the browser console should now show:
```
📋 Full Error Response: {
  success: false,
  error: "...",
  received: {...},
  formatted: "..."
}
```

This will tell us exactly what validation is failing.

---

## Likely Issues

Based on the code, the 400 error is most likely caused by:

1. **Missing phoneNumber**: Frontend not sending it
2. **Invalid phone format**: formatPhoneNumber creating invalid E.164
3. **Missing amount**: Frontend not sending it
4. **Invalid amount**: NaN or negative number

---

## What to Do

1. **Restart backend** with new logging
2. **Retry MOMO payment** in frontend
3. **Check backend console output** - it will show exactly what's wrong
4. **Check browser console** - it will show the error response details
5. **Report back** with the specific error message shown

This will help us pinpoint the exact validation failure.
