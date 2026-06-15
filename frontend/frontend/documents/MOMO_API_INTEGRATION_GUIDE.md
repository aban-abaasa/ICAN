# 📱 MOMO API Integration Guide

## 🔑 MOMO API Credentials

### Primary Key
`967f8537fec84cc6829b0ee5650dc355`

### Secondary Key (Failover)
`51384ad5e0f6477385b26a15ca156737`

Both keys are used for Mobile Money transactions via the ICAN Wallet with automatic failover support.

## 🛠️ Setup Instructions

### 1. Environment Configuration

Add to your `.env` file:

```env
# Mobile Money (MOMO) API Configuration
VITE_MOMO_API_KEY=967f8537fec84cc6829b0ee5650dc355
VITE_MOMO_PRIMARY_KEY=967f8537fec84cc6829b0ee5650dc355
VITE_MOMO_SECONDARY_KEY=51384ad5e0f6477385b26a15ca156737
VITE_MOMO_API_URL=https://api.momo.provider.com
VITE_MOMO_TIMEOUT=30000
```

### 2. File Structure

- **Service**: `frontend/src/services/momoService.js` - Core API integration with failover
- **Component**: `frontend/src/components/ICANWallet.jsx` - Wallet UI with MOMO integration
- **Environment**: `frontend/.env.example` - Environment variable template

## 🚀 Features

### 💾 Dual Key Support with Automatic Failover
- **Primary Key**: Used for all transactions by default
- **Secondary Key**: Automatically activated if primary key fails
- **Key Rotation**: Seamlessly switches between keys without user intervention
- **Fallback Logic**: Ensures transactions complete even if one key is temporarily unavailable

### Top-Up Wallet
Users can add funds to their ICAN Wallet via Mobile Money:
1. Click **Top Up** button
2. Select **Mobile Money** as payment method
3. Enter amount in chosen currency
4. Enter phone number
5. Click **Top Up**
6. System uses **Primary Key** first, then **Secondary Key** if needed
7. Returns transaction ID with active key indicator

### Send Money
Send funds from wallet to recipients:
1. Click **Send** button
2. Enter recipient details and amount
3. Confirm transaction (uses primary or secondary key)

### Receive Money
Generate payment links for incoming payments:
1. Click **Receive** button
2. Enter amount to receive
3. Share generated payment link with sender

## 📋 API Endpoints

The `momoService` provides these methods:

### `processTopUp(params)`
Process wallet top-up via mobile money with automatic failover
- **Parameters**: `amount`, `currency`, `phoneNumber`, `description`
- **Returns**: Transaction result with ID, status, and active key info
- **Failover**: Automatically tries secondary key on primary failure

### `processTransfer(params)`
Send money to another user with failover support
- **Parameters**: `amount`, `currency`, `recipientPhone`, `description`
- **Returns**: Transfer confirmation with key used
- **Failover**: Retries with secondary key if primary fails

### `checkTransactionStatus(transactionId)`
Check status of any transaction
- **Parameters**: `transactionId`
- **Returns**: Current status

### `getAccountBalance(accountId)`
Retrieve account balance
- **Parameters**: `accountId`
- **Returns**: Balance and currency

### `createPaymentLink(params)`
Generate payment link for receiving
- **Parameters**: `amount`, `currency`, `description`
- **Returns**: Payment URL and QR code

### `rotateToSecondaryKey()`
Manually switch to secondary key (for advanced use)
- **Returns**: `true` if rotation successful, `false` otherwise

### `resetToPrimaryKey()`
Reset to primary key after failover
- Automatically called after successful transactions

### `getCurrentKey()`
Get currently active key identifier
- **Returns**: `'PRIMARY'` or `'SECONDARY'`

## 🔐 Security

- API keys stored in environment variables
- Never hardcode keys in source code
- All requests use HTTPS
- Phone numbers formatted and validated
- Unique reference IDs for each transaction
- Automatic key rotation without user awareness
- Secure failover mechanism

## 📞 Phone Number Formats Supported

- `+256701234567` (Standard international)
- `0701234567` (Uganda domestic)
- `256701234567` (International without +)
- `701234567` (Short format)

All formats are automatically normalized to international format.

## ✅ Transaction Flow with Failover

### Top-Up via Mobile Money

```
User Input
    ↓
Validation
    ↓
Format Phone Number
    ↓
Create MOMO Payload with PRIMARY KEY
    ↓
Try Primary Key Request
    ├─ SUCCESS → Return Transaction ID (PRIMARY)
    │
    └─ FAILURE → Rotate to SECONDARY KEY
        ├─ Create MOMO Payload with SECONDARY KEY
        │
        ├─ Try Secondary Key Request
        │   ├─ SUCCESS → Return Transaction ID (SECONDARY - Failover)
        │   │
        │   └─ FAILURE → Reset to Primary, Return Error
        │
        └─ Reset to Primary Key
            ↓
Display Result to User (with Key Used)
```

## 🧪 Testing

### Manual Test Steps

1. **Start the application**
   ```bash
   cd frontend
   npm run dev
   ```

2. **Navigate to ICAN Wallet**
   - Find the wallet component

3. **Test Top-Up via Mobile Money**
   - Click "Top Up" button
   - Select "Mobile Money"
   - See both keys displayed:
     - 🚀 Primary Key: `967f8537fec84cc6829b0ee5650dc355`
     - 📌 Secondary (Failover): `51384ad5e0f6477385b26a15ca156737`
   - Enter amount: `50000`
   - Enter phone: `0701234567`
   - Click "Top Up"
   - Observe transaction processing
   - Verify success message with:
     - Transaction ID
     - Active Key Used (PRIMARY or SECONDARY)

4. **Simulate Primary Key Failure (Advanced)**
   - Modify environment to use invalid primary key
   - Attempt transaction
   - Observe automatic failover to secondary key
   - See "SECONDARY (Failover)" in result

5. **Test Send & Receive**
   - Send: Similar flow with failover support
   - Receive: Creates payment link (no key-specific status)

## 🔄 Transaction Status

Possible statuses:
- `PENDING` - Transaction in progress
- `COMPLETED` - Successfully processed (PRIMARY or SECONDARY)
- `FAILED` - Both keys exhausted
- `CANCELLED` - User cancelled
- `EXPIRED` - Time limit exceeded

## 📊 Supported Currencies

- **UGX** - Uganda Shilling
- **KES** - Kenyan Shilling
- **USD** - US Dollar
- **GBP** - British Pound
- **EUR** - Euro

## 🛡️ Error Handling

The service handles:
- Network timeouts (30 seconds default)
- Invalid phone numbers
- Missing required fields
- API connection failures with first key → automatic retry with second key
- Malformed responses
- Exhausted failover attempts

All errors are logged and user-friendly messages are displayed.

## 📝 Logging

Enable detailed logging by checking browser console:

**Successful transaction (Primary):**
- `🚀 Processing MOMO Top-Up with PRIMARY Key: ...`
- Result shows: `PRIMARY`

**Failover to Secondary:**
- `⚠️ Primary key failed, retrying with Secondary Key...`
- `🔄 Rotating to Secondary MOMO Key: 51384ad5e0f6477385b26a15ca156737`
- Result shows: `SECONDARY (Failover)`

**Complete failure:**
- `❌ MOMO Top-Up failed: [error message]`
- `↩️ Resetting to Primary MOMO Key`

## 🔗 API Connection Test

To test API connection health:
```javascript
import momoService from './services/momoService';

// Test connection
momoService.testConnection().then(result => {
  console.log(result); // { status: 'SUCCESS', connected: true, ... }
});
```

## 📖 Example Usage

### Basic Top-Up (with automatic failover)
```javascript
const result = await momoService.processTopUp({
  amount: '50000',
  currency: 'UGX',
  phoneNumber: '0701234567',
  description: 'Wallet top-up'
});

console.log(result);
// {
//   success: true,
//   transactionId: 'ICAN-1673456789-abc123def',
//   amount: '50000',
//   currency: 'UGX',
//   status: 'COMPLETED',
//   activeKey: 'PRIMARY' or 'SECONDARY (Failover)',
//   timestamp: '2024-01-13T...',
//   message: 'Successfully added 50000 UGX to your ICAN Wallet via MOMO (PRIMARY)'
// }
```

### Check Current Active Key
```javascript
const activeKey = momoService.getCurrentKey(); // Returns 'PRIMARY' or 'SECONDARY'
console.log(`Currently using: ${activeKey} key`);
```

### Manual Key Management
```javascript
// Switch to secondary key (if needed)
const rotated = momoService.rotateToSecondaryKey();
console.log(`Rotation successful: ${rotated}`);

// Reset back to primary after maintenance
momoService.resetToPrimaryKey();
```

## 🐛 Troubleshooting

### "Unable to connect to MOMO API"
- Check internet connection
- Verify API URL is correct
- Ensure both API keys are valid in .env
- Check if Secondary Key auto-failover activated

### "Invalid phone number format"
- Use supported format (see above)
- Ensure 10-12 digits
- No special characters except +

### "Request timeout"
- Check network connection
- Verify API server is responding
- Try again after 30 seconds
- System will automatically try secondary key

### "Transaction shows different key each time"
- Normal behavior - system retries with secondary if primary fails
- Check logs to see which key was ultimately used
- No action needed - system handles transparently

### Both keys exhausted
- Contact MOMO provider to verify keys are still valid
- Check API endpoint URL is correct
- Verify internet connectivity
- Check for temporary API maintenance

## 📊 Key Monitoring

To monitor key usage:
```javascript
// In browser console
import momoService from './services/momoService';
console.log(`Active Key: ${momoService.getCurrentKey()}`);
console.log(`Primary: 967f8537fec84cc6829b0ee5650dc355`);
console.log(`Secondary: 51384ad5e0f6477385b26a15ca156737`);
```

## 📞 Support

For issues with:
- **Wallet UI**: Check ICANWallet.jsx component
- **MOMO Integration**: Check momoService.js
- **Environment**: Verify .env configuration
- **API Keys**: Contact MOMO provider
- **Failover Logic**: Review rotation attempts in console logs

---

**Last Updated**: January 13, 2026  
**Primary Key**: `967f8537fec84cc6829b0ee5650dc355`  
**Secondary Key**: `51384ad5e0f6477385b26a15ca156737`  
**Status**: ✅ Active with Automatic Failover

