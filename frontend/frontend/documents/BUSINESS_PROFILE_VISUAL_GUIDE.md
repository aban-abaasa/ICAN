# Business Profile Section - Visual Features Guide

## 🎯 Quick Navigation

### Collapsed State (Default)
```
┌─────────────────────────────────────────────────────────┐
│  [🏢]  Business Name                            ✓       │
│         Business Type                                   │
│         Company description preview (2 lines...)        │
│         [✓ Verified] [Category] [% Equity]              │
│         💰 $X.XM seeking  👥 N co-owners                │
│         ▶ View Details                                  │
└─────────────────────────────────────────────────────────┘
```

### Expanded State (Interactive)
```
┌─────────────────────────────────────────────────────────┐
│  [🏢]✓ Business Name                                    │
│        Business Type                                    │
│        Full company description (no line limit)         │
│        [✓ Verified] [Category] [% Equity]               │
│        ▼ Hide Details                                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  FUNDING PROGRESS                            85%        │
│  ████████████████░                                      │
│                                                         │
│  ┌──────────────────┬──────────────────┐               │
│  │ Seeking          │ Raised           │               │
│  │ $5.0M           │ $4.2M            │               │
│  └──────────────────┴──────────────────┘               │
│  ┌──────────────────┬──────────────────┐               │
│  │ Status           │ Views            │               │
│  │ 🟢 Active        │ 1,245            │               │
│  └──────────────────┴──────────────────┘               │
│                                                         │
│  📅 Founded 2020        📍 City, Country                │
│                                                         │
│  👥 Co-Owners (3)                                       │
│  ├─ John Doe (CEO) ......................... 50%       │
│  ├─ Jane Smith (COO) ....................... 30%       │
│  └─ Bob Wilson (CTO) ....................... 20%       │
│                                                         │
│  ┌──────────┬──────────┬──────────┐                   │
│  │💰 Invest │📤 Share  │ℹ️ More  │                   │
│  └──────────┴──────────┴──────────┘                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 🎨 Color Coding

| Element | Color | Meaning |
|---------|-------|---------|
| Seeking | Pink (text-pink-400) | Amount needed |
| Raised | Blue (text-blue-400) | Amount funded |
| Status | Emerald/Yellow | Company state |
| Views | Purple (text-purple-400) | Engagement metric |
| Badges | Multi-color | Status indicators |
| Borders | Purple/Pink | Primary section |

## 📱 Responsive Layouts

### Desktop Layout (lg+)
- **Icon Position**: Left side, fixed width
- **Info Layout**: Horizontal flex (icon + content side-by-side)
- **Grid**: 4-column for stats
- **Width**: Full container width

### Tablet Layout (md)
- **Icon Position**: Left side, slightly reduced
- **Info Layout**: Horizontal flex with adjusted spacing
- **Grid**: 2-column for stats
- **Width**: Responsive with padding

### Mobile Layout (sm)
- **Icon Position**: Top
- **Info Layout**: Vertical stack
- **Grid**: 2-column for stats
- **Width**: Full width minus padding

## ✨ Interactive States

### Hover Effects
```
Normal State:
  ↓ Mouse Enter ↓
Hover State (Collapsed):
  - Border becomes brighter (border-purple-500/60)
  - Background slightly more opaque
  - Icon shows shadow effect

Hover State (Expanded):
  - Title text turns purple-300
  - Individual stat boxes have colored top border on hover
```

### Click Effects
```
Before Click: border-purple-500/30
During Click: scale-95 (buttons) 
After Click: 
  - Cards expand with animation
  - Details fade in smoothly
  - Background changes to gradient
  - Ring effect appears around card
```

### Animations
```
Fade In (0.3s ease-out):
  - Expanded details appear smoothly
  - Opacity: 0 → 1
  - Transform: translateY(-10px) → translateY(0)

Progress Bar Fill:
  - Smooth width transition (duration-500)
  - Animated from 0 to calculated percentage
```

## 🔑 Key Features Highlighted

### 1. **Verification Badge**
- Position: Top-right corner of icon
- States: ✓ Verified (emerald) or ⏳ Pending (yellow)
- Size: w-6 h-6 with border

### 2. **Status Badges** (3 types)
- **Verification**: ✓ Verified / ⏳ Pending
- **Category**: Business type/category
- **Equity**: Percentage offering

### 3. **Funding Progress**
- Shows percentage funded
- Visual bar with gradient
- Real-time calculation
- Capped at 100%

### 4. **Co-Owners Display**
- Shows first 4 owners with details
- Displays ownership percentage
- +N more indicator if more than 4
- Expandable section

### 5. **Action Buttons**
- Primary: "Invest Now" (gradient pink-purple)
- Secondary: "Share Profile" (subtle)
- Tertiary: "More Info" (blue)
- All with hover/click effects

## 🎯 User Interaction Flow

```
1. User sees Business Profile Card (Collapsed)
   ↓
2. User hovers over card (Visual feedback)
   ↓
3. User clicks on card area
   ↓
4. Card expands with smooth animation
   ↓
5. User sees detailed information
   ↓
6. User can:
   - Click "Invest Now" → Investment flow
   - Click "Share Profile" → Share options
   - Click "More Info" → Additional details
   - Click card again → Collapse back
```

## 🚀 Performance Metrics

| Aspect | Value |
|--------|-------|
| Animation Duration | 300ms (fade-in) |
| Progress Bar Animation | 500ms |
| Transition Easing | ease-out |
| Hover Response | Instant |
| Mobile First | ✓ Yes |
| Keyboard Accessible | ✓ Yes |
| Touch Friendly | ✓ Yes |

## 🎪 Mobile vs Desktop Comparison

### Mobile
```
Compact view
Vertical stacking
Touch-friendly buttons (larger)
2-column stats grid
Limited text preview
Space optimized
```

### Desktop
```
Spacious layout
Horizontal arrangement where possible
4-column stats grid
Full text preview
Hover effects
Maximum information visible
```

## 🔄 Data Flow

```
selectedPitchForPlay (Selected Pitch)
    ↓
    ├─ business_profiles
    │   ├─ business_name
    │   ├─ business_type
    │   ├─ description
    │   ├─ founded_year
    │   ├─ business_address
    │   ├─ verification_status
    │   └─ business_co_owners[]
    │       ├─ owner_name
    │       ├─ role
    │       └─ ownership_share
    │
    ├─ category
    ├─ equity_offering
    ├─ target_funding
    ├─ raised_amount
    ├─ status
    └─ views_count

expandedBusinessProfile (Toggle State)
    ↓
    ├─ false → Show collapsed view
    └─ true → Show expanded details
```

## 📊 Information Priority

### Always Visible
1. Company Name (prominent)
2. Business Type (subtitle)
3. Verification Status

### Visible on Collapse
4. Description Preview (2 lines)
5. Category Badge
6. Equity Offering

### Visible on Expanded
7. Full Description
8. Funding Progress
9. Financial Details (Seeking/Raised)
10. Company Status & Views
11. Founded Year & Location
12. Co-Owners List
13. Action Buttons

## 🎯 Accessibility Features

- **Keyboard**: Tab through, Enter to expand/collapse
- **Screen Reader**: role="button", proper labels
- **Color**: Not sole indicator (uses icons too)
- **Contrast**: WCAG AA compliant colors
- **Focus**: Visible focus indicators
- **Touch**: 44px minimum touch targets
