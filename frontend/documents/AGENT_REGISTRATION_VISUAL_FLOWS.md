# 🎨 Agent Registration - Visual Flows & Diagrams

## 📊 User Journey Map

```
┌─────────────────────────────────────────────────────────────────────┐
│                    AGENT REGISTRATION FLOW                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Non-Agent User                                                     │
│  │                                                                 │
│  ├─→ Opens ICAN Wallet                                             │
│  │   ├─→ App checks: isUserAgent() = false                        │
│  │   └─→ Loads with agent status = false                          │
│  │                                                                 │
│  ├─→ Clicks "🔒 Agent (Locked)" Tab                               │
│  │   ├─→ Tab disabled (grayed out)                                │
│  │   └─→ Shows locked screen                                      │
│  │                                                                 │
│  ├─→ Sees Benefits Display                                         │
│  │   ├─→ ✓ Cash-In: Convert cash to digital                      │
│  │   ├─→ ✓ Cash-Out: Earn 2.5% commission                        │
│  │   ├─→ ✓ Float Management: Refill liquidity                    │
│  │   └─→ ✓ Shift Settlement: Track earnings                      │
│  │                                                                 │
│  ├─→ Clicks "Apply to Become an Agent"                            │
│  │   ├─→ setShowAgentRegistration(true)                          │
│  │   └─→ Component re-renders                                     │
│  │                                                                 │
│  ├─→ Registration Form Appears                                     │
│  │   ├─→ Agent Name field                                         │
│  │   ├─→ Phone Number field                                       │
│  │   ├─→ City/Region field                                        │
│  │   ├─→ Location Name field (optional)                           │
│  │   ├─→ Benefits list                                            │
│  │   ├─→ Cancel button                                            │
│  │   └─→ Create Account button                                    │
│  │                                                                 │
│  ├─→ Fills Form & Submits                                          │
│  │   ├─→ Form: "Kampala Cash Exchange", "+256701234567"          │
│  │   ├─→        "Kampala", "Downtown Branch"                      │
│  │   └─→ Clicks "✨ Create Account"                               │
│  │                                                                 │
│  └─→ handleAgentRegistration() Executes                            │
│      ├─→ Validate form fields ✓                                   │
│      ├─→ Generate agent code: AGENT-KAM-4857 ✓                   │
│      ├─→ Get user from Supabase Auth ✓                            │
│      ├─→ Create agent record ✓                                    │
│      ├─→ Initialize USD float ✓                                   │
│      ├─→ Initialize UGX float ✓                                   │
│      ├─→ Show success message ✓                                   │
│      ├─→ Wait 2 seconds                                           │
│      ├─→ Reload agent status (isUserAgent) ✓                      │
│      ├─→ Close registration form                                  │
│      └─→ Show AgentDashboard ✓                                    │
│                                                                     │
│  Agent User (NEW)                                                   │
│  │                                                                 │
│  └─→ Now isAgent = true                                            │
│      ├─→ "🏪 Agent Terminal" tab enabled (purple)                │
│      ├─→ Full dashboard access                                    │
│      ├─→ Can process cash-in/out                                 │
│      ├─→ Can manage float balances                               │
│      ├─→ Can view settlement reports                             │
│      └─→ Can earn commissions                                    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 State Flow Diagram

```
    Initial State                    Registration State                 Agent State
    ═════════════════               ═════════════════════              ════════════
    
    isAgent: false                    isAgent: false                    isAgent: true
    showAgentRegistration: false      showAgentRegistration: true       showAgentRegistration: false
    agentCheckLoading: true           agentCheckLoading: false          agentCheckLoading: false
    registrationLoading: false        registrationLoading: true         registrationLoading: false
    registrationMessage: null         registrationMessage: loading      registrationMessage: success
                                     
                                      (User fills form)
                                           ↓
                                     registrationLoading: true
                                     
                                      (Form submitted)
                                           ↓
                                      (DB operations)
                                           ↓
                                      registrationMessage: success
                                           ↓
                                      (Wait 2 seconds)
                                           ↓
         ┌─────────────────────────────────────────────┐
         │  isUserAgent() refreshes agent status       │
         │  Returns: { isAgent: true, agentId: uuid }  │
         └─────────────────────────────────────────────┘
                           ↓
                    setIsAgent(true)
                           ↓
                  showAgentRegistration: false
                           ↓
            AgentDashboard component renders
                           ↓
                   Agent dashboard loads
```

---

## 🔄 Form Validation Flow

```
┌─────────────────────────────────────────────────────────────────┐
│          FORM SUBMISSION & VALIDATION LOGIC                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  User clicks "✨ Create Account"                               │
│                                                                 │
│  handleAgentRegistration(e) called                             │
│  ├─→ e.preventDefault()                                        │
│  ├─→ setRegistrationLoading(true)  // Disable button          │
│  └─→ setRegistrationMessage(null)  // Clear previous messages │
│                                                                 │
│  TRY:                                                          │
│  ├─→ Check: agentName filled? ──┬─→ NO ──→ Show error        │
│  │                              └─→ YES ──→ Continue           │
│  │                                                              │
│  ├─→ Check: phoneNumber filled? ─┬─→ NO ──→ Show error        │
│  │                               └─→ YES ──→ Continue          │
│  │                                                              │
│  ├─→ Check: locationCity filled? ─┬─→ NO ──→ Show error       │
│  │                                 └─→ YES ──→ Continue        │
│  │                                                              │
│  ├─→ All fields valid? ──────┬─→ NO ──→ Return (exit)         │
│  │                           └─→ YES ──→ Generate code         │
│  │                                                              │
│  ├─→ Generate agentCode                                        │
│  │   Format: "AGENT-{CITY_CODE}-{TIMESTAMP}"                  │
│  │   Example: "AGENT-KAM-4857"                                │
│  │                                                              │
│  ├─→ Get user from Auth ────┬─→ NOT FOUND ──→ Show error      │
│  │                          └─→ FOUND ─────→ Continue          │
│  │                                                              │
│  ├─→ Insert into agents table                                 │
│  │   ├─→ Success ──→ Continue                                 │
│  │   └─→ Error ───→ Throw error                              │
│  │                                                              │
│  ├─→ Insert USD float account                                 │
│  │   ├─→ Success ──→ Continue                                 │
│  │   └─→ Error ───→ Throw error                              │
│  │                                                              │
│  ├─→ Insert UGX float account                                 │
│  │   ├─→ Success ──→ Continue                                 │
│  │   └─→ Error ───→ Throw error                              │
│  │                                                              │
│  ├─→ SUCCESS! Set success message                             │
│  │   "✅ Agent account created! Agent Code: AGENT-KAM-4857"   │
│  │                                                              │
│  ├─→ Reset form fields                                        │
│  │   agentName: ""                                            │
│  │   phoneNumber: ""                                          │
│  │   locationCity: ""                                         │
│  │   locationName: ""                                         │
│  │                                                              │
│  ├─→ Wait 2 seconds                                           │
│  │                                                              │
│  ├─→ Close registration form                                  │
│  │   setShowAgentRegistration(false)                          │
│  │                                                              │
│  ├─→ Reload agent status                                      │
│  │   agentStatus = await agentService.isUserAgent()          │
│  │                                                              │
│  └─→ Update isAgent state                                     │
│      setIsAgent(agentStatus.isAgent)  // Set to true          │
│                                                                 │
│  CATCH (any error):                                            │
│  ├─→ Log error: "❌ Agent registration failed: {error}"        │
│  ├─→ Set error message                                        │
│  │   "Registration failed: {error.message}"                   │
│  │                                                              │
│  FINALLY:                                                      │
│  └─→ setRegistrationLoading(false)  // Enable button          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🗂️ Component Rendering Logic

```
┌──────────────────────────────────────────────────────────────────────┐
│           CONDITIONAL RENDERING: Agent Tab Content                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  isAgent ? (agent dashboard) : (                                    │
│                                                                      │
│    showAgentRegistration ? (                                        │
│      // Registration Form Screen                                   │
│      <div className="glass-card p-8">                              │
│        ├─→ Title: "🏪 Create Agent Account"                        │
│        ├─→ Subtitle: "Fill in your details..."                     │
│        ├─→ Message Area (if registrationMessage)                   │
│        ├─→ Form:                                                   │
│        │   ├─→ Agent Name input field                              │
│        │   ├─→ Phone Number input field                            │
│        │   ├─→ City/Region input field                             │
│        │   ├─→ Location Name input field                           │
│        │   ├─→ Benefits list display                               │
│        │   ├─→ Cancel button                                       │
│        │   └─→ Create Account button (loading state)               │
│        └─→ All inputs with proper styling/validation               │
│      </div>                                                         │
│                                                                      │
│    ) : (                                                            │
│      // Locked Screen                                              │
│      <div className="glass-card p-8">                              │
│        ├─→ Icon: AlertCircle (yellow)                              │
│        ├─→ Title: "🔒 Agent Access Locked"                        │
│        ├─→ Description paragraph                                   │
│        ├─→ Benefits list:                                          │
│        │   ├─→ Cash-In benefits                                    │
│        │   ├─→ Cash-Out (2.5% commission)                         │
│        │   ├─→ Float Management                                    │
│        │   └─→ Settlement reports                                  │
│        ├─→ "Apply to Become an Agent" button                       │
│        │   └─→ onClick: setShowAgentRegistration(true)             │
│        └─→ Helper text: "Already have an agent account?"           │
│      </div>                                                         │
│    )                                                                │
│  )                                                                  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 🎨 UI Component Hierarchy

```
ICANWallet
├── Tabs Navigation
│   ├── Wallet Tab (active for all)
│   ├── Send Tab (active for all)
│   ├── Receive Tab (active for all)
│   └── Agent Tab (conditional)
│       ├── For Agents: "🏪 Agent Terminal" (purple, enabled)
│       │   └── Shows AgentDashboard
│       │
│       └── For Non-Agents: "🔒 Agent (Locked)" (gray, disabled)
│           └── Conditional content:
│               ├── If showAgentRegistration = true
│               │   └── Registration Form Component
│               │       ├── Message Area (errors/success)
│               │       ├── Form Group 1: Agent Name
│               │       ├── Form Group 2: Phone Number
│               │       ├── Form Group 3: City/Region
│               │       ├── Form Group 4: Location Name
│               │       ├── Benefits Box
│               │       └── Button Group (Cancel/Create)
│               │
│               └── If showAgentRegistration = false
│                   └── Locked Screen Component
│                       ├── Alert Icon
│                       ├── Title & Description
│                       ├── Benefits Display Box
│                       ├── Apply Button
│                       └── Helper Text
```

---

## 📈 Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                      DATA FLOW: Agent Registration                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  User Input                                                         │
│  ├─→ agentName: "Kampala Cash Exchange"                            │
│  ├─→ phoneNumber: "+256701234567"                                  │
│  ├─→ locationCity: "Kampala"                                       │
│  └─→ locationName: "Downtown Branch"                               │
│                                                                     │
│              (Form Submission)                                     │
│                    ↓                                                │
│                                                                     │
│  handleAgentRegistration()                                          │
│  ├─→ Validates input                                               │
│  ├─→ Generates agentCode: "AGENT-KAM-4857"                        │
│  ├─→ Gets user: { id: "user-uuid" }                               │
│  └─→ Prepares data for database                                    │
│                                                                     │
│              (Database Operations)                                 │
│                    ↓                                                │
│                                                                     │
│  Supabase.agents.insert()                                          │
│  ├─→ INSERT into agents table                                      │
│  │   {                                                              │
│  │     user_id: "user-uuid",                                       │
│  │     agent_name: "Kampala Cash Exchange",                        │
│  │     agent_code: "AGENT-KAM-4857",                              │
│  │     phone_number: "+256701234567",                              │
│  │     location_city: "Kampala",                                   │
│  │     location_name: "Downtown Branch",                           │
│  │     status: "active",                                           │
│  │     withdrawal_commission_percentage: 2.5                       │
│  │   }                                                              │
│  │   Returns: agent { id: "agent-uuid", ... }                      │
│  │                                                                  │
│  └─→ Returns newAgent data                                         │
│                                                                     │
│  Supabase.agent_floats.insert() [USD]                              │
│  ├─→ INSERT into agent_floats                                      │
│  │   {                                                              │
│  │     agent_id: "agent-uuid",                                     │
│  │     currency: "USD",                                            │
│  │     current_balance: 0                                          │
│  │   }                                                              │
│  └─→ Created ✓                                                     │
│                                                                     │
│  Supabase.agent_floats.insert() [UGX]                              │
│  ├─→ INSERT into agent_floats                                      │
│  │   {                                                              │
│  │     agent_id: "agent-uuid",                                     │
│  │     currency: "UGX",                                            │
│  │     current_balance: 0                                          │
│  │   }                                                              │
│  └─→ Created ✓                                                     │
│                                                                     │
│              (Response to UI)                                      │
│                    ↓                                                │
│                                                                     │
│  Success Message                                                    │
│  "✅ Agent account created! Agent Code: AGENT-KAM-4857"           │
│                                                                     │
│              (Status Reload)                                       │
│                    ↓                                                │
│                                                                     │
│  agentService.isUserAgent()                                        │
│  ├─→ Queries agents table for user                                │
│  ├─→ Returns: { isAgent: true, agentId: "agent-uuid" }           │
│  └─→ Updates ICANWallet state                                     │
│                                                                     │
│              (UI Update)                                           │
│                    ↓                                                │
│                                                                     │
│  setIsAgent(true)                                                   │
│  ├─→ Agent tab becomes enabled                                    │
│  ├─→ "🏪 Agent Terminal" shows (purple)                           │
│  ├─→ AgentDashboard component renders                             │
│  └─→ User can process transactions                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Error Handling Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                    ERROR HANDLING FLOWCHART                         │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  handleAgentRegistration() TRY block                               │
│           ↓                                                        │
│  Any error thrown?                                                 │
│  ├─→ YES                                                          │
│  │   └─→ CATCH block executes                                     │
│  │       ├─→ Log: console.error(error)                            │
│  │       ├─→ Parse error message                                  │
│  │       ├─→ setRegistrationMessage({                             │
│  │       │     type: 'error',                                     │
│  │       │     text: `Registration failed: ${error.message}`     │
│  │       │   })                                                   │
│  │       └─→ User sees error in red box                          │
│  │           └─→ User can retry after filling form again         │
│  │                                                                 │
│  └─→ NO                                                           │
│      └─→ Success flow continues                                   │
│                                                                     │
│  Error Types & Messages:                                           │
│  ├─→ Validation Error                                             │
│  │   └─→ "Please fill in all required fields"                     │
│  │                                                                 │
│  ├─→ Auth Error (not logged in)                                   │
│  │   └─→ "You must be logged in to create an agent account"       │
│  │                                                                 │
│  ├─→ Database Error (agent insert fails)                          │
│  │   └─→ "Registration failed: {database error}"                  │
│  │                                                                 │
│  ├─→ Float Init Error (USD/UGX creation fails)                    │
│  │   └─→ "Registration failed: Failed to initialize float..."    │
│  │                                                                 │
│  └─→ Network Error                                                │
│      └─→ "Registration failed: {network error}"                   │
│                                                                     │
│  Error Message Display                                             │
│  ├─→ Position: Top of form                                        │
│  ├─→ Style: Red background, red border, red text                 │
│  ├─→ Content: Error message                                       │
│  ├─→ Close: User can try again or click Cancel                   │
│  └─→ Auto-close: No, persists until successful retry             │
│                                                                     │
│  Recovery Actions                                                  │
│  ├─→ User reviews error message                                   │
│  ├─→ User corrects form (if validation error)                    │
│  ├─→ User clicks "✨ Create Account" again                       │
│  ├─→ System retries registration                                  │
│  └─→ If still fails, different error message                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔐 Security & Validation Flow

```
┌──────────────────────────────────────────────────────────────┐
│         SECURITY & VALIDATION CHECKS                         │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Input Validation (Client-Side)                             │
│  ├─→ Agent Name                                             │
│  │   ├─→ Check: Required (not empty)                        │
│  │   ├─→ No length limit (allow flexibility)                │
│  │   └─→ No format restriction (any text allowed)           │
│  │                                                           │
│  ├─→ Phone Number                                           │
│  │   ├─→ Check: Required (not empty)                        │
│  │   ├─→ Type: "tel" input for mobile keyboards             │
│  │   └─→ Format: No strict validation (allow +256...)       │
│  │                                                           │
│  ├─→ City/Region                                            │
│  │   ├─→ Check: Required (not empty)                        │
│  │   └─→ Format: Free text (no validation)                  │
│  │                                                           │
│  └─→ Location Name                                          │
│      ├─→ Check: Optional (can be empty)                     │
│      └─→ Format: Free text (no validation)                  │
│                                                              │
│  Authentication Check                                       │
│  ├─→ Get current user from Supabase Auth                    │
│  ├─→ Check: User exists                                     │
│  ├─→ Check: User ID is valid UUID                           │
│  └─→ Fail if: Not authenticated or user null               │
│                                                              │
│  Authorization Check (Database)                             │
│  ├─→ Create agent with user_id from auth                    │
│  ├─→ RLS Policy: agents.user_id = auth.uid()               │
│  ├─→ User can only create agent for themselves              │
│  └─→ Database enforces: User can't create agents for others │
│                                                              │
│  Data Sanitization                                          │
│  ├─→ Agent Name: No sanitization (accept as-is)             │
│  ├─→ Phone Number: No sanitization (accept as-is)           │
│  ├─→ City: No sanitization (accept as-is)                   │
│  └─→ Location: No sanitization (accept as-is)               │
│                                                              │
│  Error Message Security                                     │
│  ├─→ Hide Supabase internal errors from users               │
│  ├─→ Show: Generic "Registration failed" message            │
│  ├─→ Log: Full errors server-side for debugging             │
│  └─→ Never expose: Database structure, table names, etc.    │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 📱 Responsive Design Breakpoints

```
Mobile (<640px)          Tablet (640px-1024px)    Desktop (>1024px)
═════════════════        ═════════════════════    ═════════════════

Form width: 100%         Form width: 90%          Form width: 28rem
Padding: 1rem           Padding: 2rem            Padding: 2rem
Font: Small             Font: Medium             Font: Medium

┌────────────────┐      ┌──────────────────┐     ┌──────────────────┐
│ Agent Name     │      │ Agent Name       │     │   Agent Name     │
│ ┌────────────┐ │      │ ┌──────────────┐ │     │ ┌──────────────┐ │
│ │ _________  │ │      │ │ ___________  │ │     │ │ ___________  │ │
│ └────────────┘ │      │ └──────────────┘ │     │ └──────────────┘ │
│                │      │                  │     │                  │
│ Phone Number   │      │ Phone Number     │     │ Phone Number     │
│ ┌────────────┐ │      │ ┌──────────────┐ │     │ ┌──────────────┐ │
│ │ _________  │ │      │ │ ___________  │ │     │ │ ___________  │ │
│ └────────────┘ │      │ └──────────────┘ │     │ └──────────────┘ │
│                │      │                  │     │                  │
│ [Button stack] │      │  [Buttons side]  │     │  [Buttons side]  │
│ ┌────────────┐ │      │ ┌──────────┐ ┐  │     │ ┌──────────┐ ┐   │
│ │   Cancel   │ │      │ │ Cancel   │ │  │     │ │ Cancel   │ │   │
│ └────────────┘ │      │ │ Create   │ │  │     │ │ Create   │ │   │
│ ┌────────────┐ │      │ └──────────┘ ┘  │     │ └──────────┘ ┘   │
│ │   Create   │ │      │                  │     │                  │
│ └────────────┘ │      │                  │     │                  │
└────────────────┘      └──────────────────┘     └──────────────────┘
```

---

## ✅ Summary of Diagrams

These visualizations show:
1. **User Journey** - Complete step-by-step flow from app open to agent dashboard
2. **State Flow** - How React state changes during registration
3. **Form Validation** - Validation logic and error handling
4. **Component Hierarchy** - UI component structure and nesting
5. **Data Flow** - Data movement through application layers
6. **Error Handling** - Error detection and recovery
7. **Security Checks** - Validation and authorization
8. **Responsive Design** - Layout on different screen sizes

All diagrams represent the complete agent registration feature! 🎉
