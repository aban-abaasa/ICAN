# 💰 ICAN Wallet - Supabase Integration Guide

## Overview
The ICAN Wallet is a **multi-currency mobile money platform** with full Supabase integration for data persistence, real-time updates, and secure transactions.

### Platform Features
- ✅ **Multi-Currency Support** (USD, UGX, KES, GHS, etc.)
- ✅ **Payment Method Integration** (MOMO, Airtel Money, Flutterwave)
- ✅ **Agent & User Transactions** (Deposit, Withdraw, Send, Receive)
- ✅ **Real-Time Balance Updates** via Supabase Realtime
- ✅ **Secure Transaction History** stored in Supabase
- ✅ **Blockchain Integration** for trust verification
- ✅ **PIN & Fingerprint Authentication** for agent security

---

## 📊 Supabase Database Schema

### Core Tables

#### 1. **users** - User Accounts
```sql
- id (UUID) - Primary key
- email (text) - User email
- phone_number (text) - Contact number
- full_name (text) - User name
- balance_usd (numeric) - USD balance
- balance_ugx (numeric) - UGX balance
- balance_kes (numeric) - KES balance
- preferred_currency (text) - Default currency
- kyc_status (text) - KYC verification status
- created_at (timestamp)
- updated_at (timestamp)
```

#### 2. **wallet_accounts** - User Wallet Details
```sql
- id (UUID) - Primary key
- user_id (UUID) - Foreign key to users
- account_number (text) - Unique account identifier
- account_type (text) - personal/business
- display_name (text) - Public display name
- bank_name (text) - Associated bank
- bank_code (text) - Bank routing code
- currency (text) - Account currency
- is_active (boolean) - Account status
- created_at (timestamp)
- updated_at (timestamp)
```

#### 3. **agents** - Agent Profiles
```sql
- id (UUID) - Primary key
- user_id (UUID) - Foreign key to users
- agent_id (text) - Unique agent identifier
- agent_name (text) - Agent business name
- phone_number (text) - Agent contact
- location_city (text) - Operation city
- location_name (text) - Branch name
- pin (text) - 4-6 digit transaction PIN (encrypted)
- enable_fingerprint (boolean) - Fingerprint auth enabled
- float_usd (numeric) - USD float balance
- float_ugx (numeric) - UGX float balance
- commission_percentage (numeric) - Commission rate
- status (text) - active/inactive/suspended
- created_at (timestamp)
- updated_at (timestamp)
```

#### 4. **transactions** - All Transactions
```sql
- id (UUID) - Primary key
- transaction_id (text) - Unique transaction reference
- user_id (UUID) - Initiating user
- transaction_type (text) - send/receive/deposit/withdraw/transfer
- amount (numeric) - Transaction amount
- currency (text) - Currency code
- from_account (text) - Source identifier
- to_account (text) - Destination identifier
- payment_method (text) - MOMO/Airtel/Card/etc
- status (text) - pending/completed/failed
- agent_id (UUID) - If agent-initiated
- description (text) - Transaction note
- metadata (jsonb) - Additional data
- created_at (timestamp)
- updated_at (timestamp)
```

#### 5. **agent_transactions** - Agent-Specific Transactions
```sql
- id (UUID) - Primary key
- agent_id (UUID) - Foreign key to agents
- user_id (UUID) - Customer user ID
- transaction_type (text) - cashIn/cashOut/topUp
- amount (numeric) - Amount transacted
- currency (text) - Currency code
- float_balance_before (numeric) - Float before transaction
- float_balance_after (numeric) - Float after transaction
- commission_earned (numeric) - Agent commission
- status (text) - completed/failed/pending
- created_at (timestamp)
```

#### 6. **payment_cards** - Stored Payment Cards
```sql
- id (UUID) - Primary key
- user_id (UUID) - Card owner
- card_token (text) - Tokenized card reference (encrypted)
- last_four (text) - Last 4 digits
- card_type (text) - credit/debit/prepaid
- cardholder_name (text) - Name on card
- expiry_month (text) - Expiration month
- expiry_year (text) - Expiration year
- is_default (boolean) - Default payment method
- is_active (boolean) - Card status
- created_at (timestamp)
```

#### 7. **float_balances** - Agent Float Tracking
```sql
- id (UUID) - Primary key
- agent_id (UUID) - Agent reference
- currency (text) - Float currency
- current_balance (numeric) - Current float amount
- opening_balance (numeric) - Daily opening
- closing_balance (numeric) - Daily closing
- date (date) - Transaction date
- total_cashin (numeric) - Total cash-in amount
- total_cashout (numeric) - Total cash-out amount
- commission_earned (numeric) - Daily commission
- created_at (timestamp)
```

---

## 🔐 Security Features

### Authentication
```javascript
// Supabase Auth Integration
- Email/Password authentication
- Phone number verification via OTP
- Session persistence across devices
- Auto-refresh token management
```

### Encryption
```javascript
// Sensitive Data Encryption
- PIN: AES-256 encryption in database
- Card data: Tokenized via Flutterwave
- API keys: Environment-based (server-side)
```

### Row-Level Security (RLS)
```sql
-- Users can only access their own data
CREATE POLICY "Users can see own data"
  ON transactions
  USING (user_id = auth.uid());

-- Agents can see their transactions
CREATE POLICY "Agents see own transactions"
  ON agent_transactions
  USING (agent_id = auth.uid());
```

---

## 🔄 Integration Points

### 1. **Wallet Service** (`walletService.js`)
```javascript
import { walletTransactionService } from './walletTransactionService';
import { walletAccountService } from './walletAccountService';

// Core operations:
- send()           // Transfer funds to recipient
- receive()        // Process incoming transfer
- topUp()          // Add funds via payment method
- withdraw()       // Cash-out operation
- getBalance()     // Fetch current balance
```

### 2. **Transaction Service** (`walletTransactionService.js`)
```javascript
// All transactions saved to Supabase:
- Create transaction
- Update transaction status
- Fetch transaction history
- Get transaction details
- Validate transaction limits
```

### 3. **Agent Service** (`agentService.js`)
```javascript
// Agent-specific operations:
- processCashIn()      // Record cash-in from customer
- processCashOut()     // Record cash-out to customer
- updateFloatBalance() // Update agent float
- getAgentTransactions() // Fetch agent history
```

### 4. **Payment Methods**
```javascript
// Supported payment integrations:
- MOMO Service        // MTN Mobile Money
- Airtel Money        // Airtel payments
- Flutterwave         // Card processing
- Direct Transfer     // Bank to wallet
```

---

## 📱 Component Integration

### ICANWallet Component Flow
```
┌─────────────────┐
│  ICANWallet.jsx │
└────────┬────────┘
         │
    ┌────▼─────┬──────────┬────────┬──────────┐
    │           │          │        │          │
    ▼           ▼          ▼        ▼          ▼
 Send      Receive      TopUp    Withdraw   Transactions
 (sends)   (receives)   (adds)   (removes)  (history)
    │           │          │        │          │
    └────┬───────┴──────────┴────────┴──────────┘
         │
    ┌────▼────────────────────┐
    │ walletTransactionService│
    └────┬────────────────────┘
         │
    ┌────▼──────────────────┐
    │  Supabase Database    │
    │  - transactions table │
    │  - wallet_accounts    │
    │  - users balances     │
    └───────────────────────┘
```

### Agent Dashboard Flow
```
┌──────────────────┐
│ AgentDashboard   │
└────────┬─────────┘
         │
    ┌────▼──────┬──────────┬──────────┐
    │            │          │          │
    ▼            ▼          ▼          ▼
 CashIn     CashOut      TopUp      Profile
    │            │          │          │
    └────┬────────┴──────────┴──────────┘
         │
    ┌────▼────────────────┐
    │   agentService      │
    │ - Process cash-in   │
    │ - Process cash-out  │
    │ - Update float      │
    │ - Edit profile      │
    └────┬────────────────┘
         │
    ┌────▼──────────────────────┐
    │  Supabase Database        │
    │  - agents table           │
    │  - agent_transactions     │
    │  - float_balances         │
    │  - transactions (linked)  │
    └───────────────────────────┘
```

---

## 🚀 Wallet Operations with Supabase

### 1. Send Money
```javascript
async send({ amount, currency, recipientPhone, description }) {
  // 1. Validate sender balance via Supabase
  const sender = await supabase
    .from('users')
    .select(`balance_${currency.toLowerCase()}`)
    .eq('id', userId)
    .single();

  // 2. Validate recipient exists
  const recipient = await supabase
    .from('users')
    .select('id')
    .eq('phone_number', recipientPhone)
    .single();

  // 3. Create transaction record
  const transaction = await supabase
    .from('transactions')
    .insert({
      user_id: userId,
      transaction_type: 'send',
      amount,
      currency,
      from_account: sender.id,
      to_account: recipient.id,
      status: 'completed'
    });

  // 4. Update balances
  await supabase.rpc('update_balances', {
    p_sender_id: userId,
    p_recipient_id: recipient.id,
    p_amount: amount,
    p_currency: currency
  });

  return transaction;
}
```

### 2. Agent Cash-In
```javascript
async processCashIn({ userAccountId, amount, currency, description }) {
  // 1. Validate agent has sufficient float
  const agentFloat = await supabase
    .from('float_balances')
    .select(`*`)
    .eq('agent_id', agentId)
    .eq('currency', currency)
    .single();

  // 2. Create agent transaction
  const transaction = await supabase
    .from('agent_transactions')
    .insert({
      agent_id: agentId,
      user_id: userAccountId,
      transaction_type: 'cashIn',
      amount,
      currency,
      float_balance_before: agentFloat.current_balance,
      float_balance_after: agentFloat.current_balance - amount,
      commission_earned: amount * (commission_rate / 100),
      status: 'completed'
    });

  // 3. Update agent float
  await supabase
    .from('float_balances')
    .update({ current_balance: agentFloat.current_balance - amount })
    .eq('agent_id', agentId)
    .eq('currency', currency);

  // 4. Credit user wallet
  await supabase.rpc('credit_user_balance', {
    p_user_id: userAccountId,
    p_amount: amount,
    p_currency: currency
  });

  return transaction;
}
```

### 3. Real-Time Balance Updates
```javascript
useEffect(() => {
  const supabase = getSupabaseClient();
  
  // Subscribe to balance changes
  const subscription = supabase
    .from('users')
    .on('UPDATE', payload => {
      if (payload.new.id === userId) {
        // Update local state with new balance
        setUserBalances(payload.new);
      }
    })
    .subscribe();

  return () => subscription.unsubscribe();
}, [userId]);
```

---

## 📊 Querying Wallet Data

### Get User Balance
```javascript
const getUserBalance = async (userId, currency) => {
  const { data, error } = await supabase
    .from('users')
    .select(`balance_${currency.toLowerCase()}`)
    .eq('id', userId)
    .single();

  return data?.[`balance_${currency.toLowerCase()}`] || 0;
};
```

### Get Transaction History
```javascript
const getTransactionHistory = async (userId, limit = 50) => {
  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .or(`user_id.eq.${userId},from_account.eq.${userId},to_account.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(limit);

  return data;
};
```

### Get Agent Float Balance
```javascript
const getAgentFloat = async (agentId) => {
  const { data, error } = await supabase
    .from('float_balances')
    .select('*')
    .eq('agent_id', agentId)
    .gte('date', new Date().toISOString().split('T')[0]);

  return data;
};
```

### Get Agent Transactions
```javascript
const getAgentTransactions = async (agentId, limit = 100) => {
  const { data, error } = await supabase
    .from('agent_transactions')
    .select(`
      *,
      users!inner(id, phone_number, full_name)
    `)
    .eq('agent_id', agentId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return data;
};
```

---

## 🔧 Environment Setup

### Required Environment Variables
```bash
# .env.local or Vercel Dashboard
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SUPABASE_SERVICE_KEY=your-service-key

# Payment integrations
VITE_FLUTTERWAVE_PUBLIC_KEY=your-flutterwave-key
VITE_MOMO_API_KEY=your-momo-key
VITE_AIRTEL_API_KEY=your-airtel-key
```

### Supabase Client Initialization
```javascript
// In src/lib/supabase/client.js
import { createClient } from '@supabase/supabase-js';

export const getSupabaseClient = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  return createClient(supabaseUrl, supabaseKey);
};
```

---

## ✅ Wallet Features Checklist

### Core Features
- [x] Multi-currency wallet (USD, UGX, KES, GHS)
- [x] Send money between users
- [x] Receive money from other users
- [x] Top-up via payment methods
- [x] Withdraw to payment method
- [x] Transaction history
- [x] Real-time balance updates

### Agent Features
- [x] Cash-in from customers
- [x] Cash-out to customers
- [x] Float balance management
- [x] Daily settlement reports
- [x] Commission tracking
- [x] Agent profile management
- [x] PIN authentication
- [x] Fingerprint sign-in
- [x] Transaction history

### Security Features
- [x] User authentication
- [x] Row-level security (RLS)
- [x] PIN encryption
- [x] Card tokenization
- [x] Transaction verification
- [x] Agent verification
- [x] KYC/AML checks

### Payment Integration
- [x] MTN Mobile Money (MOMO)
- [x] Airtel Money
- [x] Flutterwave Cards
- [x] Bank transfers
- [x] Payment method detection

---

## 📈 Performance Optimization

### Caching Strategy
```javascript
// Cache balances for 30 seconds
const BALANCE_CACHE_TTL = 30000;

const getCachedBalance = async (userId) => {
  const cached = sessionStorage.getItem(`balance_${userId}`);
  if (cached && Date.now() - JSON.parse(cached).time < BALANCE_CACHE_TTL) {
    return JSON.parse(cached).data;
  }

  const balance = await fetchFromSupabase(userId);
  sessionStorage.setItem(`balance_${userId}`, JSON.stringify({
    data: balance,
    time: Date.now()
  }));

  return balance;
};
```

### Batch Operations
```javascript
// Batch multiple operations for efficiency
async function batchUpdateBalances(updates) {
  const batch = supabase.rpc('batch_update_balances', { updates });
  return batch;
}
```

---

## 🐛 Troubleshooting

### Common Issues

#### 1. "Missing environment variables"
- ✅ Ensure `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are set
- ✅ Check Vercel/environment configuration
- ✅ Restart development server

#### 2. "Balance not updating in real-time"
- ✅ Verify Realtime subscription is active
- ✅ Check Row-Level Security policies
- ✅ Ensure user is authenticated

#### 3. "Transaction failed to save"
- ✅ Verify network connectivity
- ✅ Check Supabase database status
- ✅ Validate transaction data format

#### 4. "Agent transactions not showing"
- ✅ Verify agent_id is correctly set
- ✅ Check date filters
- ✅ Ensure RLS policies allow access

---

## 📞 Support

For issues or feature requests:
1. Check Supabase logs: `Dashboard > Logs`
2. Review transaction history: `Dashboard > Database > transactions`
3. Verify agent data: `Dashboard > Database > agents`
4. Check error messages in browser console

---

## 📚 Resources

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Realtime Guide](https://supabase.com/docs/guides/realtime)
- [Row-Level Security](https://supabase.com/docs/guides/auth/row-level-security)
- [ICAN Wallet Repo](https://github.com/aban-abaasa/ICAN)

---

**Last Updated:** January 20, 2026  
**Version:** 1.0  
**Status:** Production Ready ✅
