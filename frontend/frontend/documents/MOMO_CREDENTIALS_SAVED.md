# MOMO Credentials Summary

## Database Retrieved Credentials

**From mtn_momo_config table:**

```
API_USER:  550e8400-e29b-41d4-a716-446655440000
API_KEY:   YOUR_API_SECRET_HERE
```

## Base64 Encoded (for Basic Authentication)

```
NTUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll
```

## Authorization Header

```
Authorization: Basic NTUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll
```

## Environment Variables Added

### Backend (.env)
```env
MOMO_API_USER_DB=550e8400-e29b-41d4-a716-446655440000
MOMO_API_KEY_DB=YOUR_API_SECRET_HERE
MOMO_BASIC_AUTH_DB=NTUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll
MOMO_AUTH_HEADER_DB=Basic NTUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll
```

### Frontend (.env)
```env
MOMO_API_USER_DB=550e8400-e29b-41d4-a716-446655440000
MOMO_API_KEY_DB=YOUR_API_SECRET_HERE
MOMO_BASIC_AUTH_DB=NTUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll
MOMO_AUTH_HEADER_DB=Basic NTUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll
```

## How to Use

1. **Backend (Node.js):**
   ```javascript
   const authHeader = process.env.MOMO_AUTH_HEADER_DB;
   // Or use the raw credentials:
   const apiUser = process.env.MOMO_API_USER_DB;
   const apiKey = process.env.MOMO_API_KEY_DB;
   ```

2. **Frontend (React/Vue):**
   ```javascript
   const authHeader = import.meta.env.VITE_MOMO_AUTH_HEADER_DB;
   // Make API call with:
   // headers: { 'Authorization': authHeader, ... }
   ```

3. **cURL Test:**
   ```bash
   curl -X POST https://sandbox.momodeveloper.mtn.com/collection/token/ \
     -H "Authorization: Basic NTUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll" \
     -H "Ocp-Apim-Subscription-Key: YOUR_SUBSCRIPTION_KEY_HERE"
   ```

## Status

âœ… Credentials retrieved from database
âœ… Base64 encoded for Basic Auth
âœ… Saved to backend .env
âœ… Saved to frontend .env
âœ… Ready for MTN MOMO API integration
