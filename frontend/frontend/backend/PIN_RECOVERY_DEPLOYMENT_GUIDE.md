/**
 * 🔐 PIN RECOVERY & ACCOUNT UNLOCK - DEPLOYMENT GUIDE
 * 
 * This file describes how to deploy the PIN recovery system for personal accounts
 */

// ============================================================
// STEP 1: Deploy Backend Database Functions
// ============================================================
// Location: backend/PIN_RECOVERY_AND_ACCOUNT_UNLOCK.sql
// 
// Run this SQL file in Supabase > SQL Editor
// This creates:
// - account_unlock_requests table
// - request_account_unlock() function
// - reset_pin_with_token() function
// - admin_unlock_account() function
// - verify_unlock_token() function

// ============================================================
// STEP 2: Frontend Components Deployed
// ============================================================
// 
// ✅ PINRecoveryModal.jsx [NEW]
//    - Handles PIN reset request via email
//    - Prompts for new PIN with keypad UI
//    - Uses existing backend functions
//    - Location: frontend/src/components/PINRecoveryModal.jsx
//
// ✅ UnifiedApprovalModal.jsx [UPDATED]
//    - Added userEmail prop
//    - Detects "Account locked" error
//    - Shows "Reset PIN - Unlock Account" button
//    - Opens PINRecoveryModal when clicked
//
// ✅ ICANWallet.jsx [UPDATED]
//    - Captures user.email in state
//    - Passes userEmail to UnifiedApprovalModal
//    - Properly extracts attempts remaining from error message

// ============================================================
// STEP 3: Features Now Available
// ============================================================
// 
// For Personal Accounts (using existing trigger/functions):
// ✅ Account locked after 3 failed PIN attempts
// ✅ "Account Locked" error displays in approval modal
// ✅ "Reset PIN - Unlock Account" button appears
// ✅ Click button → PINRecoveryModal opens
// ✅ Enter email → Unlock token sent (simulated in frontend)
// ✅ User enters new PIN in keypad UI
// ✅ PIN reset via backend function "reset_pin_with_token"
// ✅ Account unlocked, attempts reset
// ✅ User can try transaction again

// ============================================================
// STEP 4: Testing the Flow
// ============================================================
// 
// 1. Test account lock:
//    - Try entering wrong PIN 3 times
//    - See: "❌ Invalid PIN. Attempts remaining: 0"
//    - Followed by: "🔒 Account locked. Too many failed PIN attempts."
//
// 2. Test recovery:
//    - Click "Reset PIN - Unlock Account" button
//    - Confirm email: user@example.com
//    - In modal: Enter new PIN (e.g., 1234)
//    - Confirm PIN
//    - See: "✅ PIN Reset Successful!"
//
// 3. Test unlock:
//    - Try sending money again
//    - Enter new PIN (1234)
//    - Transaction should proceed

// ============================================================
// STEP 5: Email Integration (Optional)
// ============================================================
// 
// Currently: Token is returned to frontend (skip email)
// 
// To add Email:
// - Use SendGrid / Mailgun / Supabase Mailbox
// - Update request_account_unlock() to send email
// - Email template: "Your PIN reset link: [unlock_token]"
// - User clicks link → Pre-fills unlock token in modal

// ============================================================
// BACKEND FUNCTIONS SUMMARY
// ============================================================
//
// 1. request_account_unlock(p_user_id, p_request_type, p_reason)
//    Input: user_id, 'pin_reset' or 'account_unlock', optional reason
//    Output: request_id, unlock_token, message
//    Purpose: Create unlock request with token
//
// 2. reset_pin_with_token(p_request_id, p_unlock_token, p_new_pin_hash)
//    Input: request_id, unlock_token, hashed PIN
//    Output: success boolean, message
//    Purpose: Verify token & reset PIN in user_accounts
//
// 3. admin_unlock_account(p_user_id, p_admin_id, p_reason)
//    Input: user_id to unlock, admin_id, reason
//    Output: success boolean, message
//    Purpose: Admin force-unlock (resets failed_pin_attempts)

// ============================================================
// RLS & PERMISSIONS
// ============================================================
//
// account_unlock_requests table:
// - RLS enabled: true
// - SELECT: Authenticated users can view their own requests
// - INSERT: Authenticated users can create requests
// - UPDATE: Service role only (backend operations)
//
// Functions:
// - request_account_unlock: SECURITY DEFINER (accessible by authenticated users)
// - reset_pin_with_token: SECURITY DEFINER (accessible by authenticated users)
// - admin_unlock_account: SECURITY DEFINER (admin operations)

// ============================================================
// SECURITY NOTES
// ============================================================
//
// ✅ PIN is hashed using same method as original PIN
// ✅ Unlock token is 64-character hex (256-bit entropy)
// ✅ Token expires after 24 hours
// ✅ Request status tracked: pending → completed
// ✅ Users can only reset their own PIN
// ✅ Service role protects backend operations

// ============================================================
// NEXT STEPS
// ============================================================
//
// 1. Run PIN_RECOVERY_AND_ACCOUNT_UNLOCK.sql in Supabase
// 2. Reload frontend to use new components
// 3. Test account lock → PIN recovery flow
// 4. (Optional) Add email integration via SendGrid
// 5. (Optional) Add admin dashboard for unlock requests

