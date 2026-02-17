# 🎨 AGENT SYSTEM - VISUAL REFERENCE GUIDE

## 📱 USER INTERFACE FLOWS

### Flow 1: Non-Agent User Journey

```
┌──────────────────────────────────┐
│  User Opens ICANWallet           │
└────────────┬─────────────────────┘
             │
             ▼
    ┌────────────────────┐
    │ System checks DB:  │
    │ agents table where │
    │ user_id = auth.uid()
    │                    │
    │ Result: NULL       │ (not an agent)
    └────────────┬───────┘
             │
             ▼
    ┌────────────────────┐
    │ setIsAgent = false │
    │ showLockedTab()    │
    └────────────┬───────┘
             │
             ▼
    ┌──────────────────────────────────┐
    │ Tab Bar Shows:                   │
    │ Overview | Transactions | ...    │
    │ 🔒 Agent (Locked) | Cards | ... │
    └────────────┬─────────────────────┘
             │
             ▼
    ┌──────────────────────────────────┐
    │ User Clicks Agent Tab            │
    └────────────┬─────────────────────┘
             │
             ▼
    ┌──────────────────────────────────────────┐
    │  LOCKED SCREEN DISPLAYS:                 │
    │  ┌────────────────────────────────────┐  │
    │  │  🔒 Agent Access Locked           │  │
    │  ├────────────────────────────────────┤  │
    │  │  You don't have an agent account. │  │
    │  │                                    │  │
    │  │  Benefits of being an agent:       │  │
    │  │  ✓ Cash-In transactions            │  │
    │  │  ✓ Earn 2.5% on cash-outs         │  │
    │  │  ✓ Manage dual floats (USD/UGX)   │  │
    │  │  ✓ Daily settlement reports       │  │
    │  │                                    │  │
    │  │  [Apply to Become an Agent]       │  │
    │  │                                    │  │
    │  └────────────────────────────────────┘  │
    └──────────────────────────────────────────┘
             │
             ▼
    ┌──────────────────────────────────┐
    │ User Clicks "Apply"              │
    │ → Redirects to agent application │
    └──────────────────────────────────┘
```

---

### Flow 2: Agent User Journey

```
┌──────────────────────────────────┐
│  Agent Opens ICANWallet          │
└────────────┬─────────────────────┘
             │
             ▼
    ┌────────────────────────┐
    │ System checks DB:      │
    │ agents table where     │
    │ user_id = auth.uid()   │
    │ AND status = 'active'  │
    │                        │
    │ Result: Found! ✓       │
    └────────────┬───────────┘
             │
             ▼
    ┌────────────────────┐
    │ setIsAgent = true  │
    │ setAgentId = uuid  │
    └────────────┬───────┘
             │
             ▼
    ┌──────────────────────────────────┐
    │ Tab Bar Shows:                   │
    │ Overview | Transactions | ...    │
    │ 🏪 Agent Terminal | Cards | ...  │
    └────────────┬─────────────────────┘
             │
             ▼
    ┌──────────────────────────────────┐
    │ Agent Clicks Agent Terminal Tab  │
    └────────────┬─────────────────────┘
             │
             ▼
    ┌──────────────────────────────────────┐
    │ AGENT DASHBOARD LOADS:               │
    ├──────────────────────────────────────┤
    │                                      │
    │  USD Float: $5,000                   │
    │  UGX Float: ₦2,000,000               │
    │                                      │
    │  [📊] [💰] [💸] [⬆️] [✅]             │
    │  Dashboard | Cash-In | Cash-Out     │
    │  Top-Up    | Settlement             │
    │                                      │
    │  Recent Transactions:                │
    │  • CASH-OUT $100 | Commission: $2.50│
    │  • CASH-IN $500 | Deposit: $500     │
    │  • TOP-UP $1000 | Float refill      │
    │                                      │
    └──────────────────────────────────────┘
             │
             ▼
    ┌──────────────────────────────────┐
    │ Agent can now:                   │
    │ ✅ Process cash-in transactions  │
    │ ✅ Process cash-out & earn $      │
    │ ✅ Refill float                  │
    │ ✅ Submit shift settlement       │
    │ ✅ View transaction history      │
    └──────────────────────────────────┘
```

---

## 🎯 COMPONENT STRUCTURE

```
ICANWallet (Parent)
├── State Management
│   ├── isAgent: boolean
│   ├── agentCheckLoading: boolean
│   └── activeTab: string
│
├── useEffect (On Mount)
│   ├── walletService.initialize()
│   └── agentService.isUserAgent()
│       └── Updates isAgent state
│
├── Tab Navigation
│   ├── Overview
│   ├── Transactions
│   ├── Deposit
│   ├── Withdraw
│   ├── [Agent Tab - CONDITIONAL]
│   │   ├── IF isAgent = true
│   │   │   └── Tab enabled (clickable)
│   │   ├── IF isAgent = false
│   │   │   └── Tab disabled (locked)
│   │   └── IF agentCheckLoading = true
│   │       └── Loading spinner
│   ├── Cards
│   └── Settings
│
└── Tab Content
    ├── Overview Tab
    ├── Transactions Tab
    ├── Deposit Tab
    ├── Withdraw Tab
    ├── [Agent Tab Content - CONDITIONAL]
    │   ├── IF agentCheckLoading = true
    │   │   └── Spinner with "Checking..."
    │   ├── IF isAgent = true
    │   │   └── <AgentDashboard />
    │   │       ├── Dashboard tab
    │   │       ├── Cash-In form
    │   │       ├── Cash-Out form
    │   │       ├── Top-Up form
    │   │       └── Settlement view
    │   └── IF isAgent = false
    │       └── Locked screen
    │           ├── Alert icon
    │           ├── Locked message
    │           ├── Benefits list
    │           └── Apply button
    ├── Cards Tab
    └── Settings Tab
```

---

## 🔄 STATE TRANSITIONS

```
┌─────────────────────────────────────┐
│ Initial State (Page Load)           │
├─────────────────────────────────────┤
│ isAgent: false (default)            │
│ agentCheckLoading: true             │
│ activeTab: 'overview'               │
└────────────────┬────────────────────┘
                 │
                 ▼
    ┌─────────────────────────────────┐
    │ Checking Agent Status...        │
    │ Query: agents WHERE user_id = ? │
    │ (Database request in progress)  │
    └────────────────┬────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼                 ▼
    ✅ IS AGENT      ❌ NOT AGENT
    │                 │
    ├─ isAgent=true   ├─ isAgent=false
    ├─ agentId=uuid   ├─ agentId=null
    └─ loading=false  └─ loading=false
        │                 │
        ▼                 ▼
    Agent Tab         Agent Tab
    ENABLED ✅         LOCKED 🔒
    (Clickable)       (Disabled)
```

---

## 💾 DATABASE QUERY

```sql
-- SAFE QUERY (maybeSingle)
SELECT id, agent_code, status 
FROM agents 
WHERE user_id = $1
LIMIT 1;

Result Types:
┌──────────────────────────────────┐
│ IF agent found:                  │
│ {                                │
│   id: "uuid-123",                │
│   agent_code: "AGENT-UGX-001",   │
│   status: "active"               │
│ }                                │
└──────────────────────────────────┘

┌──────────────────────────────────┐
│ IF no agent found:               │
│ null                             │
│ (No error thrown!)               │
└──────────────────────────────────┘

✅ Result: { isAgent: true/false }
❌ No 406 errors
❌ No 403 errors
❌ No exceptions
```

---

## 📊 TAB VISIBILITY LOGIC

```
┌─────────────────────────────────────────┐
│ Agent Tab Button Rendering              │
├─────────────────────────────────────────┤
│                                         │
│ IF agentCheckLoading = true             │
│   → Show nothing (waiting)              │
│   → Loading spinner in tab content      │
│                                         │
│ IF agentCheckLoading = false            │
│   AND isAgent = true                    │
│     → Show: 🏪 Agent Terminal           │
│     → Enabled (green highlight)         │
│     → Clickable                         │
│                                         │
│ IF agentCheckLoading = false            │
│   AND isAgent = false                   │
│     → Show: 🔒 Agent (Locked)           │
│     → Disabled (grayed out)             │
│     → Not clickable                     │
│     → Tooltip: "Create agent account"   │
│                                         │
└─────────────────────────────────────────┘
```

---

## 🎨 UI ELEMENTS

### Non-Agent Locked Tab Button

```
┌─────────────────────────────────────┐
│ 🔒 Agent (Locked)                   │ ← Grayed out
└─────────────────────────────────────┘
    ↓ Click disabled (event ignored)
```

### Agent Active Tab Button

```
┌─────────────────────────────────────┐
│ 🏪 Agent Terminal                   │ ← Highlighted
├─────────────────────────────────────┤
│ Click → Navigates to agent tab      │
└─────────────────────────────────────┘
```

### Locked Agent Screen

```
┌────────────────────────────────────────────┐
│                                            │
│           🔒 Alert Icon (Yellow)          │
│                                            │
│      Agent Access Locked                   │
│                                            │
│  You don't currently have an agent account │
│                                            │
│  Benefits:                                 │
│  ✓ Earn 2.5% on cash withdrawals           │
│  ✓ Manage USD and UGX floats separately    │
│  ✓ Track transactions with real-time logs  │
│  ✓ Generate daily shift settlements        │
│                                            │
│  ┌─────────────────────────────────────┐  │
│  │ Apply to Become an Agent            │  │
│  └─────────────────────────────────────┘  │
│                                            │
│  Already have an account?                  │
│  Make sure you're logged in correctly.     │
│                                            │
└────────────────────────────────────────────┘
```

---

## ✅ SUCCESS INDICATORS

```
✅ Page loads without errors
✅ Agent status checked automatically
✅ No database errors in console
✅ Tab visibility correct for user type
✅ Locked screen shows for non-agents
✅ Agent terminal loads for agents
✅ All forms functional
✅ Transactions process
✅ Settlements generate
✅ No privilege escalation possible
```

---

## 🚨 ERROR RESOLUTION

```
BEFORE:
❌ 406 Not Acceptable
❌ 400 Bad Request
❌ 403 Forbidden
⚠️ User is not an agent

AFTER:
✅ Check queries use maybeSingle()
✅ Null handled gracefully
✅ Error state handled in UI
✅ User sees helpful message
✅ No technical errors exposed
```

---

## 🎯 KEY TAKEAWAYS

1. **Dynamic Detection**: System automatically detects agent status
2. **Graceful Fallback**: Non-agents see friendly locked interface
3. **Full Access**: Agents get complete agent terminal
4. **Error-Free**: No more database errors
5. **Professional**: Clean, modern UI
6. **Secure**: RLS policies still active
7. **Role-Based**: Clear feature separation

---

**Your agent system is now fully integrated, dynamic, and production-ready!** 🚀
