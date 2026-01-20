# 💰 Wallet Functions - Quick Reference Card

## 🎯 Three Functions

### 1️⃣ SEND
```
walletService.send({
  amount: '500',           ← Amount to send
  currency: 'UGX',         ← Currency code
  recipientPhone: '256701234567',  ← Recipient
  description: 'Payment',  ← Optional note
  paymentMethod: 'MOMO'    ← MOMO/Airtel/Vodafone
})

Returns:
{
  success: true,
  transactionId: "TXN-123",
  amount: 500,
  currency: "UGX",
  status: "COMPLETED"
}
```

### 2️⃣ RECEIVE
```
walletService.receive({
  amount: '1000',          ← Amount to receive
  currency: 'KES',         ← Currency code
  description: 'Invoice',  ← Optional description
  paymentMethod: 'MOMO'    ← Default: MOMO
})

Returns:
{
  success: true,
  paymentLink: "pay.ican.io/PAY-123...",
  paymentRef: "PAY-123...",
  amount: 1000,
  currency: "KES"
}
```

### 3️⃣ TOP UP
```
walletService.topUp({
  amount: '50000',         ← Amount to add
  currency: 'UGX',         ← Currency code
  paymentInput: '256701234567',  ← Phone/Card
  paymentMethod: 'mtn',    ← mtn/vodafone/airtel/visa/...
  paymentDetails: {        ← Optional details
    email: 'user@ican.io',
    name: 'John Doe'
  }
})

Returns:
{
  success: true,
  transactionId: "TXN-456",
  amount: 50000,
  currency: "UGX",
  status: "COMPLETED"
}
```

---

## 🛠️ Setup (One Time)

```javascript
import { walletService } from '../services/walletService';

// In your app startup
useEffect(() => {
  if (currentUser) {
    walletService.initialize(currentUser);
  }
}, [currentUser]);
```

---

## 📱 Payment Methods

### Mobile Money
| Code | Provider | Region |
|------|----------|--------|
| `mtn` | MTN MOMO | East/West Africa |
| `vodafone` | Vodafone Money | East/West Africa |
| `airtel` | Airtel Money | East/West Africa |

### Cards
| Code | Type | Provider |
|------|------|----------|
| `visa` | Visa | Flutterwave |
| `mastercard` | MasterCard | Flutterwave |
| `verve` | Verve | Flutterwave |

### Alternative
| Code | Type | Provider |
|------|------|----------|
| `ussd` | USSD Code | Flutterwave |
| `bank` | Bank Transfer | Flutterwave |

---

## 💱 Currencies

```
USD  - United States Dollar
KES  - Kenyan Shilling  
UGX  - Ugandan Shilling
GBP  - British Pound
EUR  - Euro
```

---

## ✅ Validation

```javascript
// Check phone format
walletService.validatePhone('256701234567');  // ✅ true
walletService.validatePhone('123');           // ❌ false

// Check amount
walletService.validateAmount(500);            // ✅ true
walletService.validateAmount(0);              // ❌ false
walletService.validateAmount(-100);           // ❌ false
```

---

## 🔍 Helper Functions

```javascript
// Get balance
const balance = await walletService.getBalance('UGX');

// Get transaction history
const txs = await walletService.getTransactionHistory({
  currency: 'UGX',
  type: 'send',
  limit: 10
});

// Get specific transaction
const tx = await walletService.getTransaction('TXN-123');

// Format for display
const formatted = walletService.formatTransaction(tx);
```

---

## 🎨 Component Usage

```jsx
import WalletFunctions from '../components/WalletFunctions';

<WalletFunctions
  currentUser={user}
  selectedCurrency="UGX"
  onTransactionComplete={(result) => {
    console.log('Done:', result);
    // Refresh balance, show notification
  }}
/>
```

---

## ⚠️ Error Handling

```javascript
const result = await walletService.send({...});

if (!result.success) {
  // ❌ Handle error
  switch(result.statusCode) {
    case 'SEND_ERROR':
      console.error('Send failed:', result.error);
      break;
    case 'NETWORK_ERROR':
      console.error('Network problem:', result.error);
      break;
    default:
      console.error('Unknown error:', result.error);
  }
} else {
  // ✅ Success
  console.log('Transaction ID:', result.transactionId);
}
```

---

## 🚀 Common Patterns

### Send with Error Handling
```javascript
try {
  if (!walletService.validatePhone(phone)) {
    alert('Invalid phone');
    return;
  }

  const result = await walletService.send({
    amount,
    currency: 'UGX',
    recipientPhone: phone,
    paymentMethod: 'MOMO'
  });

  if (result.success) {
    alert(`✅ Sent ${result.amount}`);
  } else {
    alert(`❌ ${result.error}`);
  }
} catch (error) {
  alert(`❌ Error: ${error.message}`);
}
```

### Receive & Share
```javascript
const result = await walletService.receive({
  amount: '1000',
  currency: 'KES'
});

if (result.success) {
  // Copy to clipboard
  navigator.clipboard.writeText(result.paymentLink);
  
  // Share with user
  alert(`Payment link: ${result.paymentLink}`);
}
```

### Top Up Options
```javascript
// Mobile Money
await walletService.topUp({
  amount: '50000',
  currency: 'UGX',
  paymentInput: phone,
  paymentMethod: 'mtn'
});

// Card
await walletService.topUp({
  amount: '100',
  currency: 'USD',
  paymentInput: cardNumber,
  paymentMethod: 'visa',
  paymentDetails: { email: 'user@ican.io' }
});

// USSD
await walletService.topUp({
  amount: '10000',
  currency: 'KES',
  paymentInput: '*123#',
  paymentMethod: 'ussd'
});
```

---

## 📊 Response Status

### Success ✅
```json
{
  "success": true,
  "transactionId": "TXN-...",
  "status": "COMPLETED"
}
```

### Error ❌
```json
{
  "success": false,
  "error": "Invalid phone number",
  "statusCode": "SEND_ERROR"
}
```

---

## 🔐 Security Notes

✅ Always authenticate user first  
✅ Validate inputs before sending  
✅ Use HTTPS only  
✅ Never log sensitive data  
✅ Handle errors gracefully  
✅ Implement rate limiting  
✅ Audit trail on all transactions  

---

## 📁 File Locations

```
frontend/src/services/walletService.js
frontend/src/components/WalletFunctions.jsx

Root/:
- WALLET_FUNCTIONS_GUIDE.md
- WALLET_CODE_EXAMPLES.js
- WALLET_IMPLEMENTATION_STATUS.md
- WALLET_COMPLETE_SUMMARY.md
- WALLET_IMPLEMENTATION_CHECKLIST.md
- WALLET_QUICK_REFERENCE.md (this file)
```

---

## 🎓 Learning Path

1. **Start Here**: WALLET_QUICK_REFERENCE.md (this file)
2. **API Details**: WALLET_FUNCTIONS_GUIDE.md
3. **Examples**: WALLET_CODE_EXAMPLES.js
4. **Component**: WalletFunctions.jsx
5. **Service Code**: walletService.js

---

## 💡 Tips & Tricks

✅ Test with mock mode first  
✅ Use payment method detection  
✅ Copy payment links to clipboard  
✅ Show loading states during transaction  
✅ Refresh balance after transaction  
✅ Keep transaction IDs for reference  
✅ Implement transaction history view  
✅ Use formatted transactions for display  

---

## 🆘 Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| "User not authenticated" | Call initialize(user) first |
| "Invalid phone" | Use format 256701234567 |
| "Amount error" | Use positive number |
| "Network error" | Check internet |
| "Method unsupported" | Check supported methods |

---

## 📞 Resources

- **Full API**: WALLET_FUNCTIONS_GUIDE.md
- **Code Examples**: WALLET_CODE_EXAMPLES.js
- **React Component**: WalletFunctions.jsx
- **Implementation**: WALLET_IMPLEMENTATION_STATUS.md
- **Checklist**: WALLET_IMPLEMENTATION_CHECKLIST.md

---

## ✨ What's Included

✅ Send function (transfer money)  
✅ Receive function (payment links)  
✅ Top Up function (add funds)  
✅ Multiple payment methods  
✅ Multi-currency support  
✅ Error handling  
✅ Input validation  
✅ Transaction tracking  
✅ React component  
✅ Code examples  
✅ Complete documentation  

---

## 🎯 Status

**READY TO USE** ✅

- Version: 1.0.0
- Updated: January 20, 2024
- Production Ready: YES

---

**Start using today! 🚀**

```javascript
import { walletService } from '../services/walletService';

// Initialize
await walletService.initialize(currentUser);

// Use
const result = await walletService.send({...});
```
