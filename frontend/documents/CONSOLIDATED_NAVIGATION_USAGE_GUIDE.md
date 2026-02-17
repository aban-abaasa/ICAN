# ConsolidatedNavigation - Usage Guide

## Quick Start

### Basic Implementation

```jsx
import ConsolidatedNavigation from './components/ConsolidatedNavigation';

function MyApp() {
  const [activeTab, setActiveTab] = useState('dashboard');

  return (
    <>
      <ConsolidatedNavigation 
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onTrustClick={() => console.log('Open Trust')} 
        onShareClick={() => console.log('Open Share')}
        onWalletClick={() => console.log('Open Wallet')}
        profile={profile}
        onProfileClick={() => console.log('Open Profile')}
      />
      {/* Your content here */}
    </>
  );
}
```

## Component Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `activeTab` | string | ✅ Yes | Currently active tab ID |
| `onTabChange` | function | ✅ Yes | Callback when tab changes `(tabId) => void` |
| `onTrustClick` | function | ✅ Yes | Callback to open Trust modal `() => void` |
| `onShareClick` | function | ✅ Yes | Callback to open Share modal `() => void` |
| `onWalletClick` | function | ✅ Yes | Callback to open Wallet modal `() => void` |
| `profile` | object | ❌ No | User profile object with `avatar_url` and `full_name` |
| `onProfileClick` | function | ❌ No | Callback for profile click `() => void` |

## Tab IDs Reference

### Main Tabs
```javascript
'dashboard'    // Dashboard overview
'security'     // Security section
'readiness'    // Readiness assessment
'growth'       // Growth strategies
'trust'        // SACCO/Trust management
'share'        // Share/Pitch section
'wallet'       // Digital wallet
'settings'     // User settings
```

### Submenu Tab IDs
```javascript
// Dashboard submenus
'portfolio'     // Portfolio view
'analytics'     // Analytics view

// Security submenus
'security-privacy'   // Privacy settings
'security-verify'    // Verification

// Readiness submenus
'readiness-reports'  // Reports view

// Growth submenus
'growth-strategies'  // Growth strategies

// Trust submenus
'trust-explore'      // Explore trusts
'trust-create'       // Create trust
'trust-dashboard'    // Trust dashboard

// Share submenus
'share-pitches'      // My pitches
'share-invest'       // Investment opportunities
'share-grants'       // Grants section

// Wallet submenus
'wallet-send'        // Send money
'wallet-receive'     // Receive money
'wallet-transactions'// Transaction history
'wallet-currency'    // Currency exchange

// Settings submenus
'settings-profile'   // Profile settings
'settings-prefs'     // User preferences
```

## Styling & Customization

### Color Scheme
The component uses Tailwind CSS with these key classes:

```css
/* Active state */
.bg-blue-500 .text-white .shadow-lg .shadow-blue-500/50

/* Hover state */
.hover:bg-slate-700 .hover:text-white

/* Submenu active */
.bg-blue-500/30 .text-blue-200 .border-l-2 .border-blue-500
```

### Modifying Colors

To change the color scheme, update these Tailwind classes in `ConsolidatedNavigation.jsx`:

```jsx
// Active button
'bg-blue-500 text-white border-blue-400 shadow-lg shadow-blue-500/50'

// Hover button
'hover:bg-slate-700 hover:text-white hover:border-slate-500'

// Submenu active
'bg-blue-500/30 text-blue-200 border-l-2 border-blue-500'
```

## Behavior Details

### Desktop Behavior
- **Hover**: Dropdowns open on hover
- **Click**: Clicking a menu item with submenu toggles the dropdown
- **Navigation**: Clicking a submenu item navigates and closes the dropdown
- **Action Items**: Trust, Share, Wallet trigger callbacks instead of navigation

### Mobile Behavior
- **Hamburger Menu**: Toggle with menu icon
- **Accordion**: Dropdowns expand/collapse on tap
- **Navigation**: Tap submenu items to navigate
- **Auto-close**: Menu closes after selection

### Interactions
1. **Dropdown Open**: Hover (desktop) or click (mobile)
2. **Dropdown Close**: 
   - Click outside
   - Click a submenu item
   - Click the menu item again (toggle)
3. **Active Indicator**: Blue background with shadow glow
4. **Submenu Active**: Blue background with left border

## Advanced Usage

### Custom Icons
To use different icons, modify the navigation items array:

```jsx
const navigationItems = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: CustomDashboardIcon,  // Your custom icon
    submenu: [...]
  }
];
```

### Dynamic Menu Items
To add/remove menu items dynamically:

```jsx
const [menuItems, setMenuItems] = useState([...]);

useEffect(() => {
  // Add new items based on user permissions
  if (user.canAccess('reporting')) {
    // Add reporting menu
  }
}, [user]);
```

### Conditional Rendering
To show different menu items based on conditions:

```jsx
{navigationItems
  .filter(item => {
    // Hide settings for guest users
    if (item.id === 'settings' && !user.authenticated) {
      return false;
    }
    return true;
  })
  .map(item => (...))}
```

## Performance Optimization

### Memoization
Wrap the component with React.memo for optimization:

```jsx
export const ConsolidatedNavigation = React.memo(({ 
  activeTab, 
  onTabChange,
  // ... other props
}) => {
  // Component code
});
```

### Callback Optimization
Use useCallback for callbacks to prevent unnecessary re-renders:

```jsx
const handleTabChange = useCallback((tabId) => {
  setActiveTab(tabId);
}, []);

const handleTrustClick = useCallback(() => {
  setShowTrust(true);
}, []);
```

## Accessibility

### Keyboard Navigation
The component supports:
- Tab key: Navigate through menu items
- Enter/Space: Activate menu items
- Escape: Close dropdowns (can be added)
- Arrow keys: Navigate menu items (can be added)

### Screen Readers
- Semantic HTML structure
- ARIA labels can be added
- Active state indicators
- Clear button text

### Mobile Touch
- Large touch targets (44x44px minimum)
- Touch-friendly spacing
- Responsive breakpoints

## Troubleshooting

### Issue: Dropdowns not appearing
**Solution**: Check that `activeTab` state is properly managed in parent component

### Issue: Mobile menu not working
**Solution**: Verify Tailwind CSS is properly configured with responsive breakpoints

### Issue: Icons not showing
**Solution**: Ensure lucide-react is installed and imported correctly

### Issue: Colors not applying
**Solution**: Check that Tailwind CSS is processing all files correctly

## Integration Examples

### With React Router
```jsx
import { useNavigate } from 'react-router-dom';

function App() {
  const navigate = useNavigate();

  return (
    <ConsolidatedNavigation 
      activeTab={activeTab}
      onTabChange={(id) => navigate(`/${id}`)}
      // ... other props
    />
  );
}
```

### With Redux
```jsx
import { useDispatch, useSelector } from 'react-redux';

function App() {
  const dispatch = useDispatch();
  const activeTab = useSelector(state => state.app.activeTab);

  return (
    <ConsolidatedNavigation 
      activeTab={activeTab}
      onTabChange={(id) => dispatch(setActiveTab(id))}
      // ... other props
    />
  );
}
```

### With Context API
```jsx
import { useContext } from 'react';
import { AppContext } from './AppContext';

function App() {
  const { activeTab, setActiveTab } = useContext(AppContext);

  return (
    <ConsolidatedNavigation 
      activeTab={activeTab}
      onTabChange={setActiveTab}
      // ... other props
    />
  );
}
```

## Testing

### Jest Unit Tests
```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import ConsolidatedNavigation from './ConsolidatedNavigation';

test('renders all navigation items', () => {
  render(
    <ConsolidatedNavigation 
      activeTab="dashboard"
      onTabChange={jest.fn()}
      onTrustClick={jest.fn()}
      onShareClick={jest.fn()}
      onWalletClick={jest.fn()}
    />
  );
  
  expect(screen.getByText('Dashboard')).toBeInTheDocument();
  expect(screen.getByText('Security')).toBeInTheDocument();
});

test('calls onTabChange when tab is clicked', () => {
  const onTabChange = jest.fn();
  render(
    <ConsolidatedNavigation 
      activeTab="dashboard"
      onTabChange={onTabChange}
      onTrustClick={jest.fn()}
      onShareClick={jest.fn()}
      onWalletClick={jest.fn()}
    />
  );
  
  fireEvent.click(screen.getByText('Security'));
  expect(onTabChange).toHaveBeenCalledWith('security');
});
```

## File Structure

```
frontend/src/components/
├── ConsolidatedNavigation.jsx    ← New unified navigation
├── ICAN_Capital_Engine.jsx       ← Updated to use new nav
├── MainNavigation.jsx            ← No longer used (can delete)
└── ... other components
```

## Migration Checklist

If upgrading from old navigation:

- [ ] Import ConsolidatedNavigation in main component
- [ ] Remove MainNavigation import
- [ ] Remove old inline tab navigation code
- [ ] Update tab change handlers
- [ ] Test all menu items
- [ ] Test all dropdown menus
- [ ] Test mobile responsiveness
- [ ] Verify active tab highlighting
- [ ] Test Trust/Share/Wallet modals
- [ ] Test profile access
- [ ] Cross-browser testing
- [ ] Mobile device testing

## Support & Questions

For issues or questions about the ConsolidatedNavigation component:

1. Check the troubleshooting section above
2. Review the example integrations
3. Verify all required props are passed
4. Check browser console for errors
5. Test in different browsers/devices
