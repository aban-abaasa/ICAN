# 🚀 AGENT SYSTEM - QUICK START GUIDE

## What You Just Built

A complete **dual-currency agent terminal** system that allows agents to:
- 💰 **Cash-In**: Convert physical cash → digital wallet
- 💸 **Cash-Out**: Convert digital wallet → physical cash  
- ⬆️ **Float Management**: Refill digital liquidity via MOMO
- ✅ **Settlements**: End-of-shift reconciliation with audit trails

---

## 📁 FILES CREATED

```
1. AGENT_SYSTEM_SCHEMA.sql
   └─ Database schema (4 tables + RLS + indexes)

2. agentService.js  
   └─ Core business logic (Cash-In, Cash-Out, Top-Up, Settlement)

3. AgentDashboard.jsx
   └─ Beautiful UI component with 5 tabs

4. AGENT_OPERATIONS_SYSTEM.md
   └─ Full documentation with workflows

5. AGENT_SYSTEM_QUICK_START.md
   └─ This file
```

---

## ⚡ SETUP (5 Steps)

### Step 1: Create Database Tables

1. Open **Supabase Dashboard**
2. Go to **SQL Editor**
3. Click **New Query**
4. Copy & paste entire `AGENT_SYSTEM_SCHEMA.sql`
5. Click **Run**

✅ Tables created:
- `agents`
- `agent_floats`
- `agent_transactions`  
- `agent_settlements`

---

### Step 2: Register a Test Agent

Copy this into SQL Editor:

```sql
-- Create test agent
INSERT INTO public.agents (
  user_id,
  agent_name,
  agent_code,
  phone_number,
  location_city,
  status,
  withdrawal_commission_percentage
) VALUES (
  'YOUR_USER_ID_HERE', -- Get from profiles table
  'Test Agent - Kampala',
  'AGENT-TEST-001',
  '256701234567',
  'Kampala',
  'active',
  2.5
) RETURNING id;

-- Copy the returned agent_id for next step
```

**Get YOUR_USER_ID_HERE**:
```sql
SELECT id, email FROM public.profiles LIMIT 1;
```

---

### Step 3: Initialize Float Accounts

After getting agent_id from above:

```sql
-- Initialize USD float
INSERT INTO public.agent_floats (
  agent_id,
  currency,
  current_balance
) VALUES (
  'AGENT_ID_FROM_STEP2',
  'USD',
  5000.00
);

-- Initialize UGX float  
INSERT INTO public.agent_floats (
  agent_id,
  currency,
  current_balance
) VALUES (
  'AGENT_ID_FROM_STEP2',
  'UGX',
  2000000.00
);
```

✅ Agent now has:
- 5,000 USD available
- 2,000,000 UGX available

---

### Step 4: Add AgentDashboard to Router

Open your router file (e.g., `App.jsx` or `Router.jsx`):

```jsx
import AgentDashboard from '@/components/AgentDashboard';

// Add route
<Route path="/agent" element={<AgentDashboard />} />
```

---

### Step 5: Test the System

1. Navigate to `/agent`
2. You should see:
   - ✅ USD Float Card showing $5,000
   - ✅ UGX Float Card showing ₦2,000,000
   - ✅ 5 tabs: Dashboard, Cash-In, Cash-Out, Top-Up, Settlement

---

## 🧪 TESTING SCENARIOS

### Scenario 1: Cash-In 100 USD

1. Click **Cash-In** tab
2. Enter:
   - User Account ID: `ACC-001`
   - Currency: `USD`
   - Amount: `100`
3. Click **Complete Cash-In**

**Expected Result**:
```
✅ Success notification
✅ Agent USD float: 5000 → 4900
✅ User balance: +100 USD
✅ Transaction logged
```

---

### Scenario 2: Cash-Out with Commission

1. Click **Cash-Out** tab
2. Enter:
   - User Account ID: `ACC-001`
   - Currency: `USD`
   - Amount: `50`
3. Click **Complete Cash-Out**

**Expected Result**:
```
✅ Success notification
✅ Agent earned: 1.25 USD (2.5% commission)
✅ User balance: -50 USD
✅ Agent float: increased by 48.75 USD (net)
✅ Commission calculated automatically
```

---

### Scenario 3: Top-Up Float

1. Click **Top-Up** tab
2. Enter:
   - Currency: `USD`
   - Amount: `1000`
   - Phone: `256701234567`
3. Click **Send MOMO Request**

**Expected Result**:
```
✅ "MOMO Request Sent" notification
✅ Agent receives SMS notification
✅ Transaction status: "pending"
✅ After MOMO confirmation: float credited
```

---

### Scenario 4: Settlement

1. Complete several transactions
2. Click **Settlement** tab
3. Review USD and UGX balances
4. Click **Submit Shift Settlement**

**Expected Result**:
```
✅ Settlement recorded
✅ All transactions logged
✅ Commissions calculated
✅ Variance tracking active
```

---

## 🔒 SECURITY FEATURES IMPLEMENTED

| Feature | Benefit |
|---|---|
| **RLS Policies** | Agents only see their own data |
| **Liquidity Guard** | Can't over-sell float |
| **Dual-Ledger** | USD/UGX completely separate |
| **ID Verification** | Every transaction verified |
| **Audit Trail** | All transactions logged |
| **Commission Auto-calc** | No manual math errors |
| **Settlement Reports** | Shift reconciliation |

---

## 📊 DATABASE RELATIONSHIPS

```
AGENT (user_id)
  ├── AGENT_FLOATS (USD & UGX separate)
  │   └── current_balance
  │   └── total_deposited
  │   └── total_withdrawn
  │
  ├── AGENT_TRANSACTIONS (detailed log)
  │   ├── cash_in
  │   ├── cash_out
  │   ├── float_topup
  │   └── adjustment
  │
  └── AGENT_SETTLEMENTS (shift reports)
      ├── opening_balance
      ├── cash_in_total
      ├── cash_out_total
      ├── variance
      └── status
```

---

## 💰 COMMISSION BREAKDOWN

**When Agent Does Cash-Out $100:**

```
User withdraws: $100
Agent commission: 2.5% = $2.50 ✓ Agent earns this
Platform fee: 1.25% = $1.25
Total cost to user: $103.75
```

**Across shift (Example)**:
- 20 cash-out transactions × $2.50 = **$50 earned**
- Plus: Cash-in rewards (future feature)
- Plus: FX margin on conversions (future feature)

---

## 🐛 TROUBLESHOOTING

### Agent can't see their dashboard?
- Check: User has agent profile in database
- Check: Agent status = 'active'
- Check: Float accounts initialized for USD & UGX

### Transactions failing?
- Check: User account ID exists
- Check: Agent has sufficient float
- Check: Currency is USD or UGX (not typos)

### Balances not updating?
- Refresh page (may need to clear cache)
- Check browser console for errors
- Verify RLS policies in Supabase

---

## 🚀 NEXT FEATURES

- [ ] Agents dashboard (view all agents, approval process)
- [ ] Advanced reporting (daily/weekly/monthly)
- [ ] Multi-agent coordination
- [ ] Currency conversion rates
- [ ] Batch settlements
- [ ] Mobile app for agents
- [ ] Receipt printing
- [ ] KYC verification for agents

---

## 📞 SUPPORT

**Common Questions**:

**Q: Can agents handle both USD and UGX simultaneously?**  
A: Yes! Each currency has separate float and is tracked independently.

**Q: What happens if agent runs out of float?**  
A: They can't process cash-ins. They must top-up first via MOMO.

**Q: How are commissions paid out?**  
A: Tracked in settlement reports. Can be paid daily, weekly, or monthly.

**Q: Can transactions be reversed?**  
A: Only by admin. Agents cannot modify completed transactions.

**Q: What if there's a variance in shift settlement?**  
A: System flags it. Admin reviews and reconciles with physical cash count.

---

## ✅ DEPLOYMENT CHECKLIST

Before going live:

- [ ] SQL schema created in production database
- [ ] Test agents registered with realistic floats
- [ ] All 5 tabs tested (Cash-In, Cash-Out, Top-Up, Settlement, Dashboard)
- [ ] MOMO integration verified (real API credentials)
- [ ] RLS policies tested (agents can't see others' data)
- [ ] Admin can view all settlements
- [ ] Commission rates configured correctly
- [ ] Alerts set up for low float amounts
- [ ] Backup procedures documented
- [ ] Staff trained on system

---

## 🎉 YOU NOW HAVE

✅ Complete agent terminal system  
✅ Dual-currency support (USD & UGX)  
✅ Real-time balance tracking  
✅ Automatic commission calculation  
✅ Shift settlement reporting  
✅ Full audit trail  
✅ Security & RLS policies  
✅ Beautiful dashboard UI  

**Ready to onboard agents and start real transactions!** 🚀
