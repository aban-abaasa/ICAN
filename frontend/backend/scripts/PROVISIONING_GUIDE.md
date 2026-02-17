# 🚀 MTN MOMO Sandbox Provisioning

This script **automatically generates** your API User ID (UUID) and API Key from the MTN MOMO sandbox environment.

## 📋 What It Does

The provisioning script performs these steps automatically:

1. **Creates an API User** in MTN MOMO sandbox → Returns a UUID
2. **Generates an API Key** for that user → Returns the secret key
3. **Tests the credentials** → Verifies they work
4. **Displays the credentials** → Ready to copy to your SQL and .env files

## 🚀 How to Run

### Prerequisites
```bash
cd backend
npm install axios uuid dotenv
```

### Run the provisioning script

```bash
node scripts/provisionSandbox.js
```

### Expected Output

```
======================================================================
🚀 MTN MOMO SANDBOX PROVISIONING
======================================================================
📍 Environment: sandbox
🔑 Subscription Key: 967f8537...

📝 Step 1: Creating API User...
✅ API User Created Successfully!
   📌 API User ID (UUID): 550e8400-e29b-41d4-a716-446655440000
   📌 Reference ID: a1b2c3d4-e5f6-7890-abcd-ef1234567890

🔐 Step 2: Creating API Key for API User...
✅ API Key Generated Successfully!
   🔑 API Key: your-generated-api-key-here

🧪 Step 3: Testing credentials...
✅ Credentials Test Passed!
   🎫 Access Token: eyJhbGciOiJIUzI1NiIs...
   ⏱️  Expires In: 3600 seconds

======================================================================
🎉 PROVISIONING COMPLETE!
======================================================================

📋 Your Generated Credentials:
----------------------------------------------------------------------
Primary Subscription Key: 967f8537fec84cc6829b0ee5650dc355
API User ID (UUID):       550e8400-e29b-41d4-a716-446655440000
API Key:                  your-generated-api-key-here
----------------------------------------------------------------------
```

## 📝 Next Steps

### 1. Update SQL File

Copy the generated credentials and update `setup_mtn_momo_configuration.sql`:

```sql
INSERT INTO public.mtn_momo_config (
    subscription_key,
    api_user_id,           -- Use the UUID from provisioning
    api_secret_key,        -- Use the API Key from provisioning
    environment,
    base_url,
    is_active,
    is_primary
) VALUES (
    '967f8537fec84cc6829b0ee5650dc355',
    '550e8400-e29b-41d4-a716-446655440000',    -- Generated UUID
    'your-generated-api-key-here',              -- Generated API Key
    'sandbox',
    'https://sandbox.momodeveloper.mtn.com',
    true,
    true
) ON CONFLICT (subscription_key) DO NOTHING;
```

### 2. Update .env File

```env
MOMO_SUBSCRIPTION_KEY=967f8537fec84cc6829b0ee5650dc355
MOMO_API_USER=550e8400-e29b-41d4-a716-446655440000
MOMO_API_KEY=your-generated-api-key-here
MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com
MOMO_ENVIRONMENT=sandbox
```

### 3. Run SQL Migration

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Navigate to **SQL Editor**
3. Run the updated `setup_mtn_momo_configuration.sql`

### 4. Test the Integration

```bash
# In another terminal, test the endpoints
curl -X POST http://localhost:3000/api/momo/request-payment \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 1000,
    "phoneNumber": "256701234567",
    "currency": "UGX"
  }'
```

## 🔄 What Each API Call Does

### 1. Create API User
```
POST /v1_0/apiuser
```
- Creates a unique user ID (UUID) in MTN MOMO
- Returns: `{ apiUserId: "550e8400-e29b-41d4-a716-446655440000" }`

### 2. Create API Key
```
POST /v1_0/apiuser/{apiUserId}/apikey
```
- Generates an API key for the created user
- Returns: `{ apiKey: "your-generated-api-key-here" }`

### 3. Test Credentials
```
POST /collection/token/
Headers: Authorization: Basic {apiUserId}:{apiKey}
```
- Verifies the credentials work
- Returns an access token if successful

## 🛠️ Troubleshooting

### Script fails with "Subscription Key not found"
```bash
# Make sure .env file has MOMO_SUBSCRIPTION_KEY
echo "MOMO_SUBSCRIPTION_KEY=967f8537fec84cc6829b0ee5650dc355" >> ../.env
```

### Test fails but credentials were created
- This is normal! API propagation takes ~2-5 seconds
- Try again in a moment: `node scripts/provisionSandbox.js`

### "Connection timeout" error
- Check internet connection
- Verify MTN MOMO sandbox is accessible: https://sandbox.momodeveloper.mtn.com
- Try again with different timing

### "400 Bad Request"
- Ensure subscription key is correct
- Check that the provisioning is running in sandbox mode

## 📚 Generated Credentials Explained

| Credential | Purpose | Length | Example |
|------------|---------|--------|---------|
| **Subscription Key** | API authentication header | 32 chars | `967f8537fec84cc6829b0ee5650dc355` |
| **API User ID (UUID)** | Unique user identifier | 36 chars | `550e8400-e29b-41d4-a716-446655440000` |
| **API Key** | Secret key for Basic Auth | Variable | `your-generated-api-key-here` |

## 🔐 Security Notes

- ✅ API User ID and Key are automatically generated by MTN
- ✅ Never commit credentials to Git
- ✅ Keep `.env` file in `.gitignore`
- ✅ Store credentials securely in Supabase encrypted columns
- ✅ Rotate credentials periodically in production

## 📞 Support

If the provisioning script fails:

1. Check error message carefully
2. Verify subscription key is correct
3. Ensure internet connection is stable
4. Wait a few seconds and try again
5. Check MTN MOMO sandbox status

## 🎯 What's Next?

After provisioning succeeds:

1. ✅ Run `setup_mtn_momo_configuration.sql` in Supabase
2. ✅ Update `.env` with generated credentials
3. ✅ Restart backend server
4. ✅ Test endpoints with real phone numbers
5. ✅ Monitor transaction logs in Supabase

---

**Status**: ✅ Sandbox provisioning automated  
**Created**: 2024-01-19  
**Next**: Run provisioning script to generate your credentials
