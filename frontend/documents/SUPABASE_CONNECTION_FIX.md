# ⚠️  SUPABASE CONNECTION ISSUE - DIAGNOSIS

## Current Status
- **Error**: Invalid API key  
- **Root Cause**: Backend cannot authenticate with Supabase
- **Reason**: Either:
  1. Supabase keys are incorrect
  2. Supabase project doesn't exist
  3. Keys have been regenerated without updating .env

---

## 🔧 How to Fix

### Step 1: Go to Your Supabase Dashboard
```
https://app.supabase.com/projects
```

### Step 2: Find Project ID
Your project ID: **hswxazpxcgtqbxeqcxxw**

Click on this project to open it.

### Step 3: Get the Correct Keys
1. Go to **Settings → API**
2. You'll see:
   - **Project URL**: Should be `https://hswxazpxcgtqbxeqcxxw.supabase.co`
   - **Anon Key**: Public key (starts with `eyJhbGc...`)
   - **Service Role Key**: Secret key (also starts with `eyJhbGc...`)

### Step 4: Copy-Paste the Service Role Key
1. Find **"Service Role Key"** section
2. Click the copy icon next to it
3. Paste it here in the format below

---

## 📝 Update Backend .env

Replace the `SUPABASE_SERVICE_ROLE_KEY` value in:
```
backend/.env
```

Current (possibly wrong):
```dotenv
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzd3hhenB4Y2d0cWJ4ZXFjeHh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MjE0MTU3MCwiZXhwIjoyMDY3NzE3NTcwfQ.K6VV7_0QJ0RpKXJ5mR5tZ5X9QF7W3K6L8M9N0O1P2Q
```

Replace with the one from Supabase dashboard.

---

## ✅ Verification

After updating, run:
```bash
cd backend
node test-supabase.js
```

Should show:
```
✅ Successfully connected to Supabase
✅ Table "mtn_momo_config" exists
✅ Table "mtn_momo_logs" exists
✅ Table "mtn_momo_tokens" exists

✅ All tests passed!
```

---

## ℹ️ Important Notes

- **Anon Key** (public): Can be used in browser
- **Service Role Key** (secret): Should NEVER be exposed to client/browser
- These keys are different and have different permissions
- Always use Service Role Key in backend `.env`
- Always use Anon Key in frontend `.env` with `VITE_` prefix

---

## 🆘 If Still Having Issues

1. Check Supabase project actually exists (not deleted)
2. Verify you're in correct organization/project
3. Try regenerating the keys in Supabase dashboard
4. Check if there are any usage limits or billing issues
