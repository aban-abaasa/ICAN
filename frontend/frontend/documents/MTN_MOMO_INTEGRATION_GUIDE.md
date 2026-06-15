# 📱 MTN MOMO Integration Guide

## Overview

This document explains the complete MTN MOMO integration for the ICAN platform. MOMO (Mobile Money) allows users to:
- 💰 **Receive Money**: Charge customers' phone balances (Collections)
- 📤 **Send Money**: Pay out to customer phones (Disbursements)

---

## Architecture

### How MTN MOMO Works

```
┌─────────────┐         ┌──────────────┐         ┌──────────────┐
│   ICAN      │         │  ICAN Server │         │  MTN MOMO    │
│  Wallet     │────────▶│  Backend API │────────▶│   API        │
│   (FE)      │         │              │         │              │
└─────────────┘         └──────────────┘         └──────────────┘
                               │
                               │ Save transaction
                               ▼
                        ┌──────────────┐
                        │  Supabase DB │
                        │  (Postgres)  │
                        └──────────────┘
```

### Transaction Types

#### 1. **Collections** (Receive Money)
- Charges money FROM customer's phone
- Customer authorizes the payment via USSD
- Example: "Charge 5000 UGX from 256701234567"

```
User Phone (Customer) ──────→ MOMO ──────→ ICAN Account
(balance reduced)            (API)        (balance increased)
```

#### 2. **Disbursements** (Send Money)
- Sends money TO customer's phone
- Funds transferred directly to their MOMO account
- Example: "Send 5000 UGX to 256701234567"

```
ICAN Account ──────→ MOMO ──────→ User Phone (Customer)
(balance reduced)    (API)       (balance increased)
```

---

## API Endpoints

### 1. Request Payment (Collections)

**Endpoint:** `POST /api/momo/request-payment`

**Purpose:** Charge a customer's phone balance

**Request Body:**
```json
{
  "amount": 5000,
  "phoneNumber": "256701234567",
  "currency": "UGX",
  "description": "Top-up wallet",
  "userId": "user-uuid"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Collection request sent successfully",
  "transactionId": "uuid",
  "referenceId": "REC-1705607842123",
  "amount": 5000,
  "currency": "UGX",
  "phoneNumber": "256701234567",
  "status": "pending",
  "timestamp": "2024-01-19T10:30:42.123Z"
}
```

**What Happens Next:**
1. Customer receives USSD prompt: "ICAN requests 5000 UGX. Reply 1 for Yes, 2 for No"
2. Customer confirms (or denies)
3. Webhook updates transaction status
4. User wallet balance updated

---

### 2. Send Payment (Disbursements)

**Endpoint:** `POST /api/momo/send-payment`

**Purpose:** Send money to a customer's phone

**Request Body:**
```json
{
  "amount": 5000,
  "phoneNumber": "256701234567",
  "currency": "UGX",
  "description": "Payout for completed task",
  "userId": "user-uuid"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Payment sent successfully",
  "transactionId": "uuid",
  "referenceId": "PAY-1705607842123",
  "amount": 5000,
  "currency": "UGX",
  "phoneNumber": "256701234567",
  "status": "completed",
  "timestamp": "2024-01-19T10:30:42.123Z"
}
```

**What Happens Next:**
1. Money is immediately sent to customer phone
2. Customer receives SMS confirmation
3. Transaction status is "completed"
4. Funds available in customer's MOMO account

---

### 3. Check Transaction Status

**Endpoint:** `GET /api/momo/transaction-status/:referenceId`

**Query Parameters:**
- `type` (optional): 'collection' or 'disbursement' (default: 'collection')

**Example:**
```
GET /api/momo/transaction-status/REC-1705607842123?type=collection
```

**Response:**
```json
{
  "success": true,
  "status": "SUCCESSFUL",
  "data": {
    "referenceId": "REC-1705607842123",
    "amount": 5000,
    "currency": "UGX",
    "status": "SUCCESSFUL"
  }
}
```

---

## Implementation in Frontend (ICANWallet.jsx)

### Current Implementation

The wallet already has the foundation:

```javascript
// In momoService.js
async processTopUp(params) {
  const { amount, currency, phoneNumber, description } = params;
  
  // Calls backend API
  const result = await fetch('/api/momo/request-payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount,
      phoneNumber,
      currency,
      description,
      userId: currentUser.id
    })
  });
  
  return result.json();
}
```

### How Wallet Uses MOMO

1. **Payment Method Detection**
```javascript
const detected = paymentMethodDetector.detectMethod(phoneInput);
// Example: "256701234567" → { 
//   method: 'mtn',
//   name: 'MTN MOMO',
//   icon: '📱'
// }
```

2. **Route to Appropriate Service**
```javascript
if (method === 'mtn' || method === 'vodafone') {
  // MTN/Vodafone → MOMO Service
  result = await momoService.processTopUp({
    amount: topupForm.amount,
    currency: selectedCurrency,
    phoneNumber: topupForm.paymentInput,
    description: `ICAN Wallet Top-Up via MTN MOMO`
  });
}
```

3. **Handle Response**
```javascript
if (result.success) {
  // Transaction created
  setMessage({ 
    type: 'success', 
    text: '✓ Top-up initiated! Confirm on your phone.' 
  });
  
  // Save to transaction history
  await walletTransactionService.saveTransaction(result);
} else {
  // Show error
  setMessage({ type: 'error', text: result.error });
}
```

---

## Database Schema

### wallet_transactions Table

```sql
CREATE TABLE wallet_transactions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL,           -- Which user
    type VARCHAR(50),                -- 'collection', 'disbursement', etc.
    provider VARCHAR(50),            -- 'mtn_momo', 'airtel', 'card', etc.
    amount DECIMAL(15,2),            -- Transaction amount
    currency VARCHAR(10),            -- 'UGX', 'KES', 'USD', etc.
    reference_id VARCHAR(255),       -- MOMO reference (REC-xxx, PAY-xxx)
    transaction_id VARCHAR(255),     -- Our internal UUID
    phone_number VARCHAR(20),        -- Customer phone (256701234567)
    status VARCHAR(50),              -- 'pending', 'completed', 'failed'
    description TEXT,                -- 'Top-up wallet', 'Payout', etc.
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ         -- When actually completed
);
```

---

## Phone Number Formatting

MTN MOMO requires **E.164 format** (international format).

### Valid Formats by Country:

| Country | Code | Example |
|---------|------|---------|
| Uganda | 256 | 256701234567 |
| Kenya | 254 | 254701234567 |
| Tanzania | 255 | 255701234567 |
| Ghana | 233 | 233501234567 |
| Nigeria | 234 | 234701234567 |

### Formatting Helper:

```javascript
// Converts common formats to E.164
const formatted = MTNMomoService.formatPhoneNumber('0701234567', '256');
// Result: '256701234567'

// Validation
const isValid = MTNMomoService.validatePhoneNumber('256701234567');
// Result: true
```

---

## Error Handling

### Common Errors & Solutions

#### 1. "Authentication Failed"
```
Error: Failed to get collection access token
```
**Solution:**
- Verify MOMO_SUBSCRIPTION_KEY in .env
- Verify MOMO_API_USER in .env
- Verify MOMO_API_KEY in .env
- Check credentials at momodeveloper.mtn.com

#### 2. "Invalid Phone Number"
```
Error: Invalid phone number format
```
**Solution:**
- Use E.164 format: 256701234567
- Don't use: +256701234567, 070123456, 0701234567

#### 3. "Transaction Timeout"
```
Error: Request timeout after 30s
```
**Solution:**
- Network issue or MOMO API slow
- Retry after 30 seconds
- Check transaction status: `/api/momo/transaction-status/:ref`

#### 4. "Insufficient Balance"
```
Error: Customer has insufficient balance
```
**Solution:**
- Customer needs to top-up their MOMO account first
- For disbursements, ICAN account needs sufficient balance

---

## Testing Checklist

### Sandbox Testing (Development)

```
ENVIRONMENT: sandbox
BASE_URL: https://sandbox.momodeveloper.mtn.com
API_USER: Use sandbox credentials from MTN
```

#### Test 1: Request Payment (Collections)
- [ ] Enter amount: 1000
- [ ] Enter phone: 256701001001 (sandbox test number)
- [ ] Click Submit
- [ ] Check: Transaction created with status "pending"
- [ ] Check: Can verify status via API

#### Test 2: Send Payment (Disbursements)
- [ ] Enter amount: 500
- [ ] Enter phone: 256701001001
- [ ] Click Submit
- [ ] Check: Transaction created with status "completed"
- [ ] Check: No confirmation needed (instant)

#### Test 3: Transaction History
- [ ] View recent transactions
- [ ] Check amounts, dates, status
- [ ] Verify currency conversion

#### Test 4: Error Scenarios
- [ ] Invalid phone number → Error message
- [ ] Negative amount → Error message
- [ ] Empty fields → Error message
- [ ] Network timeout → Retry option

---

## Production Deployment

### 1. Update Environment Variables

```bash
# Change from sandbox to production
MOMO_ENVIRONMENT=production
MOMO_BASE_URL=https://api.momodeveloper.mtn.com

# Use production credentials from MTN
MOMO_SUBSCRIPTION_KEY=prod_key_here
MOMO_API_USER=prod_user_here
MOMO_API_KEY=prod_key_here
```

### 2. Database Migration

```bash
# Run the migration to create wallet_transactions table
psql -d your_database -f backend/db/create_wallet_transactions_table.sql
```

### 3. Webhook Setup

Configure MTN to send webhooks to:
```
https://your-domain.com/api/momo/webhook
```

### 4. Testing with Real Transactions

- Start with small amounts (100 UGX, etc.)
- Test with real customer numbers
- Monitor logs: `console.log` outputs

### 5. Go Live Checklist

- [ ] All credentials updated to production
- [ ] Webhook endpoint configured
- [ ] Database migration completed
- [ ] Error logging implemented
- [ ] Transaction monitoring set up
- [ ] Customer support trained
- [ ] Rate limiting configured

---

## Monitoring & Logs

### Backend Logs to Check:

```javascript
// Successful collection request
🚀 MTN MOMO Service initialized
💰 RECEIVE MONEY (Collections): Amount: 5000, Phone: 256701234567
📤 Sending collection request (ID: uuid)...
✅ Collection request sent successfully
```

```javascript
// Webhook received
📨 MOMO Webhook Received: {
  referenceId: 'REC-1705607842123',
  status: 'SUCCESSFUL',
  amount: 5000
}
```

### Key Metrics to Track:

1. **Success Rate**: % of transactions that complete
2. **Average Response Time**: How long requests take
3. **Error Rate**: % of failed transactions
4. **Daily Volume**: Total amount processed

---

## Security Considerations

### 1. API Keys
- ✅ Stored in environment variables
- ✅ Never logged or exposed
- ✅ Rotated regularly

### 2. Phone Numbers
- ✅ Validated before sending
- ✅ Stored in database (encrypted)
- ✅ Never sent to frontend in plain text

### 3. Transactions
- ✅ Row-level security (RLS) on database
- ✅ Users can only see their transactions
- ✅ All amounts verified server-side

### 4. Webhooks
- ⚠️ TODO: Implement webhook signature verification
- ⚠️ TODO: Add HMAC validation of incoming webhooks

---

## Cost Structure

### MTN MOMO Charges (Approximate)

| Service | Fee |
|---------|-----|
| Collections | 0.99% - 1.5% |
| Disbursements | 1% - 2% |
| Minimum fee | 100 UGX |

**Example:** Collect 10,000 UGX
- Fee: 10,000 × 1.25% = 125 UGX
- ICAN receives: 9,875 UGX

---

## Support & Documentation

### MTN MOMO Resources:

1. **Developer Portal**: https://momodeveloper.mtn.com
2. **API Documentation**: https://momodeveloper.mtn.com/api-documentation
3. **Sandbox Testing**: https://momodeveloper.mtn.com/sandbox
4. **Support**: developer@mtn.com

### ICAN Team:

- Backend Lead: Review MOMO integration
- QA: Test all transaction flows
- DevOps: Configure production credentials
- Support: Train customer service team

---

## Next Steps

1. ✅ Get MTN MOMO credentials from momodeveloper.mtn.com
2. ✅ Configure .env with credentials
3. ✅ Test in sandbox mode
4. ✅ Run database migration
5. ✅ Test all transaction types
6. ✅ Set up webhook handling
7. ✅ Deploy to production
8. ✅ Monitor transactions daily

---

**Status**: ✅ Ready for Integration

**Last Updated**: January 19, 2026
