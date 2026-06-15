# 💰 ICAN Wallet Functions - Complete Reference

## Overview
The wallet service provides three core functions for managing money:
1. **Send** - Transfer funds to another user/phone
2. **Receive** - Request payment from another user
3. **Top Up** - Add funds to wallet via payment methods

---

## 📤 SEND Function

### Purpose
Transfer money to another user's phone number or account.

### Usage
```javascript
import { walletService } from '../services/walletService';

const result = await walletService.send({
  amount: '500',
  currency: 'UGX',
  recipientPhone: '256701234567',
  description: 'Payment for services',
  paymentMethod: 'MOMO' // or 'Airtel', 'Vodafone'
});

if (result.success) {
  console.log('✅ Sent:', result.transactionId);
} else {
  console.error('❌ Error:', result.error);
}
```

### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | string/number | ✅ | Amount to send (must be > 0) |
| `currency` | string | ✅ | Currency code (USD, KES, UGX, etc) |
| `recipientPhone` | string | ✅ | Recipient's phone number |
| `description` | string | ❌ | Optional transfer description |
| `paymentMethod` | string | ❌ | MOMO, Airtel, Vodafone (default: MOMO) |

### Response
```javascript
{
  success: true,
  transactionId: "TXN-123456",
  amount: 500,
  currency: "UGX",
  status: "COMPLETED",
  activeKey: "PRIMARY",
  mode: "LIVE",
  message: "Transfer successful"
}
```

### Payment Methods
- **MOMO** - MTN Mobile Money (MTN)
- **Vodafone** - Vodafone Mobile Money (Vodafone)
- **Airtel** - Airtel Money (Airtel)

---

## 📥 RECEIVE Function

### Purpose
Generate a payment link/reference to request payment from another user.

### Usage
```javascript
import { walletService } from '../services/walletService';

const result = await walletService.receive({
  amount: '1000',
  currency: 'KES',
  description: 'Invoice payment',
  paymentMethod: 'MOMO'
});

if (result.success) {
  console.log('✅ Payment link:', result.paymentLink);
  console.log('📋 Share this:', result.paymentLink);
} else {
  console.error('❌ Error:', result.error);
}
```

### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | string/number | ✅ | Amount to receive (must be > 0) |
| `currency` | string | ✅ | Currency code (USD, KES, UGX, etc) |
| `senderPhone` | string | ❌ | Sender's phone (if known) |
| `description` | string | ❌ | Optional payment description |
| `paymentMethod` | string | ❌ | MOMO, Airtel, Vodafone (default: MOMO) |

### Response
```javascript
{
  success: true,
  amount: 1000,
  currency: "KES",
  paymentRef: "PAY-1704067200000-ABC123XYZ",
  paymentLink: "pay.ican.io/PAY-1704067200000-ABC123XYZ",
  description: "Invoice payment",
  message: "✅ Payment link ready! Share this with the sender: pay.ican.io/...",
  saved: true
}
```

### Features
- Auto-generates unique payment reference
- Creates shareable payment link
- Saves receive request to database
- Support for multiple payment methods

---

## 💳 TOP UP Function

### Purpose
Add funds to wallet using various payment methods (mobile money, cards, USSD, etc).

### Usage
```javascript
import { walletService } from '../services/walletService';

// Mobile Money Top-Up
const result = await walletService.topUp({
  amount: '50000',
  currency: 'UGX',
  paymentInput: '256701234567',
  paymentMethod: 'mtn'
});

// Card Top-Up
const cardResult = await walletService.topUp({
  amount: '100',
  currency: 'USD',
  paymentInput: '4532015112830366',
  paymentMethod: 'visa',
  paymentDetails: {
    email: 'user@ican.io',
    name: 'John Doe',
    phone: '256701234567'
  }
});

if (result.success) {
  console.log('✅ Top-up completed:', result.transactionId);
} else {
  console.error('❌ Error:', result.error);
}
```

### Parameters
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `amount` | string/number | ✅ | Amount to add (must be > 0) |
| `currency` | string | ✅ | Currency code (USD, KES, UGX, etc) |
| `paymentInput` | string | ✅ | Phone/Card number/USSD details |
| `paymentMethod` | string | ✅ | Detected payment method |
| `paymentDetails` | object | ❌ | Additional details (email, name, phone) |

### Response
```javascript
{
  success: true,
  transactionId: "TXN-789012",
  amount: 50000,
  currency: "UGX",
  status: "COMPLETED",
  activeKey: "PRIMARY",
  mode: "LIVE",
  message: "✅ Successfully added 50000 UGX to your ICAN Wallet"
}
```

### Supported Payment Methods
| Method | Type | Input | Example |
|--------|------|-------|---------|
| `mtn` | Mobile Money | Phone | 256701234567 |
| `vodafone` | Mobile Money | Phone | 256701234567 |
| `airtel` | Mobile Money | Phone | 256701234567 |
| `visa` | Card | Card Number | 4532015112830366 |
| `mastercard` | Card | Card Number | 5425233010103442 |
| `verve` | Card | Card Number | 5061180000000000 |
| `ussd` | USSD | Code | *123# |
| `bank` | Bank Transfer | Account | Details in paymentDetails |

---

## 🔧 Helper Functions

### Initialize Service
```javascript
await walletService.initialize(currentUser);
```

### Get Current Balance
```javascript
const balance = await walletService.getBalance('UGX');
console.log('Balance:', balance);
```

### Get Transaction History
```javascript
const transactions = await walletService.getTransactionHistory({
  currency: 'UGX',
  type: 'send',
  limit: 20,
  offset: 0
});
```

### Get Transaction Details
```javascript
const transaction = await walletService.getTransaction('TXN-123456');
```

### Validate Phone Number
```javascript
const isValid = walletService.validatePhone('256701234567');
```

### Validate Amount
```javascript
const isValid = walletService.validateAmount(500, 1, 1000000);
```

### Format Transaction for Display
```javascript
const formatted = walletService.formatTransaction(transaction);
console.log(formatted);
// {
//   id: "1",
//   type: "send",
//   amount: 500,
//   currency: "UGX",
//   date: "1/23/2024",
//   time: "2:30:45 PM",
//   status: "COMPLETED",
//   icon: "📤",
//   direction: "Sent",
//   ...
// }
```

---

## 📝 Complete Example

```javascript
import { walletService } from '../services/walletService';

export const WalletDemo = () => {
  const handleSend = async () => {
    const result = await walletService.send({
      amount: '500',
      currency: 'UGX',
      recipientPhone: '256701234567',
      description: 'Payment for services',
      paymentMethod: 'MOMO'
    });

    if (result.success) {
      alert(`✅ Sent ${result.amount} ${result.currency}`);
    } else {
      alert(`❌ Error: ${result.error}`);
    }
  };

  const handleReceive = async () => {
    const result = await walletService.receive({
      amount: '1000',
      currency: 'KES',
      description: 'Invoice payment'
    });

    if (result.success) {
      navigator.clipboard.writeText(result.paymentLink);
      alert(`✅ Payment link copied: ${result.paymentLink}`);
    } else {
      alert(`❌ Error: ${result.error}`);
    }
  };

  const handleTopUp = async () => {
    const result = await walletService.topUp({
      amount: '50000',
      currency: 'UGX',
      paymentInput: '256701234567',
      paymentMethod: 'mtn',
      paymentDetails: {
        email: 'user@ican.io',
        name: 'John Doe'
      }
    });

    if (result.success) {
      alert(`✅ Added ${result.amount} ${result.currency}`);
    } else {
      alert(`❌ Error: ${result.error}`);
    }
  };

  return (
    <div>
      <button onClick={handleSend}>💰 Send Money</button>
      <button onClick={handleReceive}>📥 Receive Payment</button>
      <button onClick={handleTopUp}>💳 Top Up Wallet</button>
    </div>
  );
};
```

---

## ⚠️ Error Handling

### Common Errors
```javascript
// Missing required fields
{
  success: false,
  error: "Missing required fields: amount, currency, recipientPhone",
  statusCode: "SEND_ERROR"
}

// Invalid amount
{
  success: false,
  error: "Amount must be greater than 0",
  statusCode: "TOPUP_ERROR"
}

// Unsupported payment method
{
  success: false,
  error: "Unsupported payment method: xyz",
  statusCode: "SEND_ERROR"
}

// Network error
{
  success: false,
  error: "Network request failed",
  statusCode: "SEND_ERROR"
}
```

### Error Handling Best Practices
```javascript
try {
  const result = await walletService.send({...});
  
  if (!result.success) {
    // Handle specific error
    if (result.statusCode === 'SEND_ERROR') {
      console.error('Send failed:', result.error);
    }
    return;
  }

  // Process success
  console.log('Transaction ID:', result.transactionId);
} catch (error) {
  console.error('Unexpected error:', error);
}
```

---

## 🔐 Security Notes

1. **Phone Number Validation** - Always use `validatePhone()` before sending
2. **Amount Validation** - Always use `validateAmount()` before processing
3. **User Authentication** - Ensure user is authenticated before any transaction
4. **Transaction Limits** - Implement maximum transaction limits per user
5. **Rate Limiting** - Limit number of transactions per time period
6. **Encryption** - Use HTTPS for all transactions
7. **Audit Trail** - All transactions are logged to Supabase

---

## 🚀 Quick Start

```javascript
// 1. Import service
import { walletService } from '../services/walletService';

// 2. Initialize (once at app startup)
await walletService.initialize(currentUser);

// 3. Use functions
await walletService.send({...});
await walletService.receive({...});
await walletService.topUp({...});
```

---

## 📊 Transaction Types

| Type | Function | Example |
|------|----------|---------|
| `send` | Transfer out | Send 500 UGX to 256701234567 |
| `receive` | Receive in | Request 1000 KES payment link |
| `topup` | Add funds | Top up wallet via MOMO |

---

## 💡 Tips

✅ **DO:**
- Validate all inputs before calling functions
- Handle errors appropriately
- Show user-friendly messages
- Save transaction references
- Support multiple currencies
- Use payment method detection

❌ **DON'T:**
- Hardcode phone numbers
- Skip validation
- Ignore error responses
- Process negative amounts
- Process without user confirmation
- Store sensitive payment data

---

**Status**: ✅ Ready to use  
**Version**: 1.0.0  
**Last Updated**: January 2024
