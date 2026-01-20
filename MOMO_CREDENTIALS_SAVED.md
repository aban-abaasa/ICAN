# MOMO Credentials Summary

## Database Retrieved Credentials

**From mtn_momo_config table:**

```
API_USER:  550e8400-e29b-41d4-a716-446655440000
API_KEY:   0c83153ce97f40c68622c16a2d69d69e
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
MOMO_API_KEY_DB=0c83153ce97f40c68622c16a2d69d69e
MOMO_BASIC_AUTH_DB=NTUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll
MOMO_AUTH_HEADER_DB=Basic NTUwZTg0MDAtZTI5Yi00MWQ0LWE3MTYtNDQ2NjU1NDQwMDAwOjBjODMxNTNjZTk3ZjQwYzY4NjIyYzE2YTJkNjlkNjll
```

### Frontend (.env)
```env
MOMO_API_USER_DB=550e8400-e29b-41d4-a716-446655440000
MOMO_API_KEY_DB=0c83153ce97f40c68622c16a2d69d69e
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
     -H "Ocp-Apim-Subscription-Key: 8b59afc46b7a43b0a32856e709af1de3"
   ```

## Status

✅ Credentials retrieved from database
✅ Base64 encoded for Basic Auth
✅ Saved to backend .env
✅ Saved to frontend .env
✅ Ready for MTN MOMO API integration
