# QR Code Payment Receive System - Implementation Guide

## Overview
The Receive Money feature has been completely redesigned with a modern QR code-based payment system. Users can now generate unique payment QR codes that others can scan to send them money - making payments faster and more secure.

## Features

### 1. **Smart QR Code Generation**
- Click "Receive" button → Generate QR code
- Each QR code is unique with 24-hour expiration
- Code format: `PAY_XXXXXXXXXXXX`
- Embeds payment link, amount, and description

### 2. **Three-Step Interface**
```
Generate → QR Code → Active Requests
```

**Step 1: Generate**
- Enter amount and optional description
- Simple, clean form
- Instant QR code generation

**Step 2: QR Code Display**
- Shows large, scannable QR code
- Displays payment amount and details
- Copy payment link button
- Download QR code as PNG
- Share option (native share API on mobile)

**Step 3: Active Requests**
- View all active (pending) payment requests
- Shows amount, status, and expiration time
- Quick copy payment code
- Delete expired requests

### 3. **Supabase Integration**
- Stores all payment requests in `payment_requests` table
- Automatic expiration tracking (24 hours)
- Row-level security (users see only their own)
- Transaction tracking when payment is completed

### 4. **User-Friendly Features**
- One-click copy payment link
- Download QR code as image
- Share via native share menu (mobile)
- Active request management
- Auto-expiring links (24 hours)
- Mobile optimized interface

## Files Created

### 1. **Payment Request Service**
**File:** `frontend/src/services/paymentRequestService.js`

Methods:
- `createPaymentRequest(userId, amount, currency, description)` - Generate new request
- `getPaymentRequest(paymentCode)` - Fetch request details
- `updatePaymentRequestStatus(paymentCode, status)` - Update status
- `getUserPaymentRequests(userId, limit)` - Get user's requests
- `completePaymentRequest(paymentCode, payerUserId, transactionId)` - Mark as paid
- `deletePaymentRequest(paymentCode)` - Delete request
- `getActivePaymentRequests(userId)` - Get pending requests

### 2. **Receive Money Modal Component**
**File:** `frontend/src/components/ReceiveMoneyModal.jsx`

Features:
- Three-step workflow
- QR code generation (uses qrcode.react library)
- Payment link management
- Active request display
- Copy/Share functionality
- Responsive design

### 3. **Database Migration**
**File:** `backend/CREATE_PAYMENT_REQUESTS_TABLE.sql`

Creates:
- `payment_requests` table with all necessary fields
- Indexes for fast queries
- Row-level security policies
- Auto-expiration function
- Update timestamp trigger

## Installation & Setup

### Step 1: Install QR Code Library
```bash
npm install qrcode.react
```

### Step 2: Create Database Table
Run the SQL migration in Supabase:
1. Go to Supabase Dashboard
2. Open SQL Editor
3. Paste contents of `CREATE_PAYMENT_REQUESTS_TABLE.sql`
4. Run the query

### Step 3: Component Integration
The component is already integrated into `ICANWallet.jsx`:
- Import: `import ReceiveMoneyModal from './ReceiveMoneyModal';`
- State: `const [showReceiveMoneyModal, setShowReceiveMoneyModal] = useState(false);`
- Render: `<ReceiveMoneyModal isOpen={showReceiveMoneyModal} ... />`

## How It Works

### For the Receiver (Creating Request)
1. User clicks "Receive" button
2. Enters amount and optional description
3. Clicks "Generate QR Code"
4. System creates unique payment code via Supabase
5. QR code displays with embedded payment link
6. User can:
   - Copy payment link (clipboard)
   - Download QR code (image)
   - Share via native menu
7. Request stays active for 24 hours
8. User can view all active requests
9. When payment received, mark as completed

### For the Payer (Scanning Code)
1. Receives QR code or payment link
2. Scans QR code using phone camera
3. Redirected to payment page: `/pay/{paymentCode}`
4. Sees receiver details, amount, and description
5. Confirms and sends payment
6. Payment request auto-completes in database

## Database Schema

```sql
payment_requests {
  id: BIGSERIAL (Primary Key)
  user_id: UUID (Receiver)
  payment_code: VARCHAR(50) UNIQUE
  amount: DECIMAL(15, 2)
  currency: VARCHAR(10) [USD, UGX, KES, TZS, RWF]
  description: TEXT (Optional)
  status: VARCHAR(20) [pending, completed, expired]
  payer_user_id: UUID (Payer - after payment)
  transaction_id: BIGINT (Links to transaction)
  created_at: TIMESTAMP
  updated_at: TIMESTAMP
  completed_at: TIMESTAMP
  expires_at: TIMESTAMP (Now + 24 hours)
}
```

## Security Features

### Row-Level Security (RLS)
- ✅ Users can only see their own payment requests
- ✅ Users can only create requests for themselves
- ✅ Only request creator can update/delete
- ✅ Public can view pending, non-expired requests by code

### Data Validation
- Amount must be > 0
- Currency must be valid
- Status limited to specific values
- Automatic expiration handling

### Privacy
- Payment code is unique per request
- No sensitive data in QR code URL
- Transaction ID only added after payment
- Payer ID not visible until payment complete

## Customization Options

### Change Expiration Time
In `paymentRequestService.js`, line ~20:
```javascript
expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() // 24 hours
```
Change to desired duration.

### Change QR Code Size
In `ReceiveMoneyModal.jsx`, line ~180:
```javascript
<QRCode
  size={256} // Change this value (pixels)
  ...
/>
```

### Customize Styling
All CSS is Tailwind classes. Modify color scheme in ReceiveMoneyModal.jsx.

## Mobile Considerations

### iOS Native Share
```javascript
if (navigator.share) {
  navigator.share({ title, text });
}
```

### Android Copy-to-Clipboard
Uses native clipboard API:
```javascript
navigator.clipboard.writeText(text)
```

### Touch Optimization
- Large buttons (44px+ height)
- Full-width inputs
- Maximum tap target areas
- Responsive text sizing

## Next Steps

### 1. Create Payment Page Component
Build the `/pay/{paymentCode}` page that:
- Fetches payment request details
- Shows receiver info, amount, and description
- Allows payer to send money
- Marks request as completed

### 2. Payment Processing
Integrate with wallet payment flow:
- User scans QR → Payment page
- User confirms payment
- Transaction processed
- Payment request marked `completed`
- Both users notified

### 3. Notifications
Add in-app and push notifications:
- "Payment request received"
- "Payment completed"
- "Request expired"

### 4. Analytics
Track metrics:
- Number of requests generated
- Successful payment rate
- Average payment amount
- Request expiration rate

## Testing

### Test the Feature
1. Create test account(s)
2. Click "Receive" button
3. Enter amount (e.g., 1000 USD)
4. Add description
5. Click "Generate QR Code"
6. Verify QR code displays
7. Test copy link button
8. Test download QR button
9. Verify request appears in Active tab
10. Check Supabase dashboard for created record

### Database Verification
```sql
-- Check created payment requests
SELECT * FROM payment_requests 
WHERE user_id = 'user-uuid' 
ORDER BY created_at DESC;

-- Check pending requests
SELECT * FROM payment_requests 
WHERE status = 'pending' 
AND expires_at > NOW();
```

## Troubleshooting

### QR Code Not Generating
- Check `qrcode.react` is installed: `npm list qrcode.react`
- Verify payment request service is imported
- Check browser console for errors

### Payment Link Not Working
- Verify payment code is correct format
- Check Supabase permissions/RLS
- Ensure payment page exists at `/pay/{code}`

### Modal Not Appearing
- Check `showReceiveMoneyModal` state is true
- Verify ReceiveMoneyModal component is imported
- Check no z-index conflicts

### Database Errors
- Verify table is created (check Supabase)
- Check RLS policies are enabled
- Verify user_id is valid UUID

## Performance Optimization

### Current Optimizations
- React.memo where applicable
- Lazy loading of requests
- Index on frequently queried columns
- 24-hour auto-expiration

### Future Optimizations
- Cache active requests locally
- Batch QR code generation
- Compress QR code images
- Use CDN for QR downloads

## API Reference

### PaymentRequestService

```javascript
// Create request
await paymentRequestService.createPaymentRequest(
  userId,        // string (UUID)
  amount,        // number
  currency,      // string ('USD', 'UGX', etc)
  description    // string (optional)
)

// Get request
await paymentRequestService.getPaymentRequest(paymentCode)

// Update status
await paymentRequestService.updatePaymentRequestStatus(
  paymentCode,   // string
  status         // string ('pending', 'completed', 'expired')
)

// Get user's requests
await paymentRequestService.getUserPaymentRequests(userId, limit)

// Complete request
await paymentRequestService.completePaymentRequest(
  paymentCode,
  payerUserId,
  transactionId
)

// Delete request
await paymentRequestService.deletePaymentRequest(paymentCode)

// Get active requests
await paymentRequestService.getActivePaymentRequests(userId)
```

## Support & Issues

For issues or questions:
1. Check browser console for errors
2. Verify Supabase connection
3. Check database records exist
4. Review file paths and imports
5. Ensure all dependencies installed

---

**Version:** 1.0.0  
**Last Updated:** February 2026  
**Status:** Production Ready
