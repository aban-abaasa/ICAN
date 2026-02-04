# 🚀 Complete MTN MOMO Setup Workflow

## Step 1️⃣: Generate Credentials

Run the provisioning script to generate your API User ID and API Key:

```bash
cd backend
node scripts/provisionSandbox.js
```

**Expected Output:**
```
======================================================================
🚀 MTN MOMO SANDBOX PROVISIONING
======================================================================

📝 Step 1: Creating API User...
✅ API User Created Successfully!
   📌 API User ID (UUID): 550e8400-e29b-41d4-a716-446655440000

🔐 Step 2: Creating API Key for API User...
✅ API Key Generated Successfully!
   🔑 API Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

🧪 Step 3: Testing credentials...
✅ Credentials Test Passed!

======================================================================
🎉 PROVISIONING COMPLETE!
======================================================================

📋 Your Generated Credentials:
----------------------------------------------------------------------
Primary Subscription Key: 967f8537fec84cc6829b0ee5650dc355
API User ID (UUID):       550e8400-e29b-41d4-a716-446655440000
API Key:                  eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
----------------------------------------------------------------------
```

## Step 2️⃣: Copy the Generated Credentials

From the output above, note down:
- ✅ API User ID (UUID) - e.g., `550e8400-e29b-41d4-a716-446655440000`
- ✅ API Key - e.g., `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`

## Step 3️⃣: Update the SQL File

Open `backend/db/setup_mtn_momo_configuration.sql` and replace:

```sql
-- BEFORE (with placeholder):
'REPLACE_WITH_GENERATED_API_USER_UUID',

-- AFTER (with your generated UUID):
'550e8400-e29b-41d4-a716-446655440000',
```

**Example with real values:**
```sql
INSERT INTO public.mtn_momo_config (
    name,
    description,
    subscription_key,
    api_user_id,
    api_secret_key,
    environment,
    base_url,
    is_active,
    is_primary
) VALUES (
    'MTN MOMO Primary',
    'Primary MTN MOMO Collection Widget credential set',
    '967f8537fec84cc6829b0ee5650dc355',      -- Your subscription key
    '550e8400-e29b-41d4-a716-446655440000',  -- Your generated API User ID
    '51384ad5e0f6477385b26a15ca156737',      -- Your API key
    'sandbox',
    'https://sandbox.momodeveloper.mtn.com',
    true,
    true
) ON CONFLICT (subscription_key) DO NOTHING;
```

## Step 4️⃣: Run SQL Migration in Supabase

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **SQL Editor**
4. Click **New Query**
5. Copy entire content from `backend/db/setup_mtn_momo_configuration.sql`
6. Click **Execute**

**Expected Result:**
```
✅ Success
- mtn_momo_config table created
- mtn_momo_logs table created
- mtn_momo_tokens table created
- RLS policies created
- Configuration inserted
- Functions created
- Views created
```

## Step 5️⃣: Verify Configuration

In Supabase SQL Editor, run:

```sql
SELECT id, name, subscription_key, api_user_id, api_secret_key, environment, is_primary
FROM public.mtn_momo_config 
WHERE is_primary = true;
```

**Expected Output:**
```
id                                  name                       subscription_key         api_user_id                          is_primary
12345678-1234-1234-1234-123456789012 MTN MOMO Primary          967f8537fec84cc68...   550e8400-e29b-41d4-a716-446655440000 true
```

✅ If you see a row, configuration is successful!

## Step 6️⃣: Update .env File

Update `backend/.env`:

```env
# MTN MOMO Configuration
MOMO_SUBSCRIPTION_KEY=967f8537fec84cc6829b0ee5650dc355
MOMO_API_USER=550e8400-e29b-41d4-a716-446655440000
MOMO_API_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com
MOMO_ENVIRONMENT=sandbox
```

## Step 7️⃣: Test the Integration

Restart backend server:

```bash
cd backend
npm start
```

Test collection endpoint:

```bash
curl -X POST http://localhost:3000/api/momo/request-payment \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "phoneNumber": "256701234567",
    "currency": "UGX"
  }'
```

Expected response:
```json
{
  "success": true,
  "transactionId": "uuid-here",
  "referenceId": "REC-1234567890",
  "status": "pending",
  "message": "Collection request sent - Awaiting customer confirmation"
}
```

## ✅ Completion Checklist

- [ ] Run `node backend/scripts/provisionSandbox.js`
- [ ] Copy generated API User ID (UUID)
- [ ] Update SQL file with real UUID
- [ ] Run SQL migration in Supabase
- [ ] Verify configuration in Supabase
- [ ] Update .env file
- [ ] Restart backend
- [ ] Test API endpoints
- [ ] Monitor logs in Supabase

---

## 🆘 Troubleshooting

### Script returns "No rows returned"
- **Cause**: Placeholder UUID still in SQL
- **Fix**: Replace `REPLACE_WITH_GENERATED_API_USER_UUID` with real UUID from Step 1

### "policy already exists" error
- **Cause**: SQL run multiple times
- **Fix**: This is normal, SQL now drops policies first before creating

### "Connection refused" when testing
- **Cause**: Backend not running
- **Fix**: Run `npm start` in backend folder

### API test fails with "Invalid credentials"
- **Cause**: .env not updated
- **Fix**: Update .env with values from Step 1 and restart backend

---

**Status**: Ready for testing  
**Next**: Run Step 1 provisioning script  
**Time**: ~5 minutes total
