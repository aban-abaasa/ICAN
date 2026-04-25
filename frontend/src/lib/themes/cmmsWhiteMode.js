/**
 * CMMS White Mode Theme Styles
 * Provides professional, modern styling for light/white theme
 */

export const whiteThemePalette = {
  company: {
    activeBg: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)',
    inactiveBg: '#f0f4f8',
    activeBgLight: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
    inactiveBgLight: '#f8fafc',
    border: '#e2e8f0',
    activeBorder: '#3b82f6',
    text: '#1e293b',
    activeText: '#1e40af',
    icon: '🏢',
    label: 'Company',
    description: 'Organization Profile'
  },
  departments: {
    activeBg: 'linear-gradient(135deg, #0369a1 0%, #0284c7 100%)',
    inactiveBg: '#f0f9fc',
    activeBgLight: 'linear-gradient(135deg, #ecf8ff 0%, #cffafe 100%)',
    inactiveBgLight: '#f8fafc',
    border: '#cffafe',
    activeBorder: '#0ea5e9',
    text: '#164e63',
    activeText: '#0369a1',
    icon: '🏭',
    label: 'Departments',
    description: 'Manage Departments'
  },
  users: {
    activeBg: 'linear-gradient(135deg, #5b21b6 0%, #7c3aed 100%)',
    inactiveBg: '#faf5ff',
    activeBgLight: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
    inactiveBgLight: '#f8fafc',
    border: '#e9d5ff',
    activeBorder: '#a855f7',
    text: '#2e1065',
    activeText: '#5b21b6',
    icon: '👥',
    label: 'Users & Roles',
    description: 'Team Management'
  },
  inventory: {
    activeBg: 'linear-gradient(135deg, #15803d 0%, #22c55e 100%)',
    inactiveBg: '#f0fdf4',
    activeBgLight: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
    inactiveBgLight: '#f8fafc',
    border: '#bbf7d0',
    activeBorder: '#22c55e',
    text: '#166534',
    activeText: '#15803d',
    icon: '📦',
    label: 'Inventory',
    description: 'Stock Management'
  },
  requisitions: {
    activeBg: 'linear-gradient(135deg, #d97706 0%, #f59e0b 100%)',
    inactiveBg: '#fffbeb',
    activeBgLight: 'linear-gradient(135deg, #fefce8 0%, #fef3c7 100%)',
    inactiveBgLight: '#f8fafc',
    border: '#fde68a',
    activeBorder: '#f59e0b',
    text: '#78350f',
    activeText: '#b45309',
    icon: '📋',
    label: 'Requisitions',
    description: 'Request Management'
  },
  approvals: {
    activeBg: 'linear-gradient(135deg, #c2410c 0%, #f97316 100%)',
    inactiveBg: '#fff7ed',
    activeBgLight: 'linear-gradient(135deg, #ffedd5 0%, #fed7aa 100%)',
    inactiveBgLight: '#f8fafc',
    border: '#fed7aa',
    activeBorder: '#f97316',
    text: '#431407',
    activeText: '#c2410c',
    icon: '✓',
    label: 'Approvals',
    description: 'Approval Queue'
  },
  reports: {
    activeBg: 'linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)',
    inactiveBg: '#f0fdfa',
    activeBgLight: 'linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%)',
    inactiveBgLight: '#f8fafc',
    border: '#99f6e4',
    activeBorder: '#14b8a6',
    text: '#134e4a',
    activeText: '#0d9488',
    icon: '📊',
    label: 'Reports',
    description: 'Analytics & Reports'
  }
};

/**
 * Get palette for white mode
 */
export const getWhiteModePalette = (tabId) => {
  return whiteThemePalette[tabId] || whiteThemePalette.company;
};

/**
 * CSS Classes for white mode navigation tabs
 */
export const whiteModeTabs = `
  /* Navigation Container */
  .cmms-nav-container {
    background: #ffffff;
    border-bottom: 2px solid #e2e8f0;
    box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  }

  /* Tab Button Base */
  .cmms-tab-button {
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    font-weight: 600;
    font-size: 0.875rem;
    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    border: 2px solid transparent;
    cursor: pointer;
    white-space: nowrap;
    position: relative;
  }

  /* Tab Button Inactive */
  .cmms-tab-button--inactive {
    background-color: #f8fafc;
    color: #64748b;
    border-color: #e2e8f0;
  }

  .cmms-tab-button--inactive:hover {
    background-color: #f1f5f9;
    border-color: #cbd5e1;
    color: #475569;
  }

  /* Tab Button Active */
  .cmms-tab-button--active {
    color: white;
    border-color: transparent;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  /* Icon Styling */
  .cmms-tab-icon {
    font-size: 1.25rem;
    display: inline-block;
    margin-right: 0.5rem;
  }

  /* Menu Dropdown */
  .cmms-menu-dropdown {
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 0.5rem;
    box-shadow: 0 12px 32px rgba(15, 23, 42, 0.15);
    min-width: 280px;
    z-index: 30;
  }

  .cmms-menu-header {
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #e2e8f0;
    background: #f8fafc;
    font-size: 0.75rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #64748b;
  }

  .cmms-menu-item {
    padding: 0.875rem 1rem;
    border-bottom: 1px solid #f1f5f9;
    cursor: pointer;
    transition: background-color 0.2s;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .cmms-menu-item:hover {
    background-color: #f8fafc;
  }

  .cmms-menu-item--active {
    background-color: #eff6ff;
    border-left: 3px solid #3b82f6;
    padding-left: calc(1rem - 3px);
  }

  /* Content Container */
  .cmms-content-container {
    background: white;
    border-radius: 0.75rem;
    padding: 1.5rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }

  /* Section Headers */
  .cmms-section-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #e2e8f0;
  }

  .cmms-section-title {
    font-size: 1.5rem;
    font-weight: 700;
    color: #0f172a;
  }

  .cmms-section-subtitle {
    font-size: 0.875rem;
    color: #64748b;
    margin-top: 0.25rem;
  }

  /* Cards and Items */
  .cmms-card {
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 0.5rem;
    padding: 1rem;
    transition: all 0.3s;
  }

  .cmms-card:hover {
    border-color: #cbd5e1;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  }

  /* Buttons */
  .cmms-btn-primary {
    background: linear-gradient(135deg, #1e40af, #2563eb);
    color: white;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    border: none;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
  }

  .cmms-btn-primary:hover {
    box-shadow: 0 4px 12px rgba(37, 99, 235, 0.4);
    transform: translateY(-1px);
  }

  .cmms-btn-secondary {
    background: #f1f5f9;
    color: #1e293b;
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    border: 1px solid #e2e8f0;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
  }

  .cmms-btn-secondary:hover {
    background: #e2e8f0;
    border-color: #cbd5e1;
  }

  /* Status Badges */
  .cmms-badge {
    padding: 0.25rem 0.75rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    display: inline-block;
  }

  .cmms-badge--active {
    background-color: #dcfce7;
    color: #15803d;
  }

  .cmms-badge--inactive {
    background-color: #fee2e2;
    color: #dc2626;
  }

  .cmms-badge--pending {
    background-color: #fef3c7;
    color: #92400e;
  }

  /* Form Elements */
  .cmms-input {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid #e2e8f0;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    transition: all 0.3s;
  }

  .cmms-input:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
  }

  .cmms-input::placeholder {
    color: #94a3b8;
  }

  /* Table Styling */
  .cmms-table {
    width: 100%;
    border-collapse: collapse;
  }

  .cmms-table thead {
    background-color: #f8fafc;
    border-bottom: 2px solid #e2e8f0;
  }

  .cmms-table th {
    padding: 1rem;
    text-align: left;
    font-weight: 600;
    font-size: 0.875rem;
    color: #475569;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .cmms-table td {
    padding: 1rem;
    border-bottom: 1px solid #e2e8f0;
    font-size: 0.875rem;
  }

  .cmms-table tbody tr:hover {
    background-color: #f8fafc;
  }

  /* Empty State */
  .cmms-empty-state {
    text-align: center;
    padding: 2rem;
    color: #64748b;
  }

  .cmms-empty-state-icon {
    font-size: 3rem;
    margin-bottom: 1rem;
    opacity: 0.5;
  }

  .cmms-empty-state-text {
    font-size: 1rem;
    color: #0f172a;
    margin-bottom: 0.5rem;
  }

  .cmms-empty-state-subtext {
    font-size: 0.875rem;
    color: #64748b;
  }

  /* Loading State */
  .cmms-loader {
    display: inline-block;
    width: 1.5rem;
    height: 1.5rem;
    border: 3px solid #e2e8f0;
    border-top-color: #3b82f6;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  /* Alert Messages */
  .cmms-alert {
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    display: flex;
    gap: 0.75rem;
  }

  .cmms-alert--success {
    background-color: #dcfce7;
    color: #166534;
    border-left: 4px solid #22c55e;
  }

  .cmms-alert--error {
    background-color: #fee2e2;
    color: #991b1b;
    border-left: 4px solid #ef4444;
  }

  .cmms-alert--warning {
    background-color: #fef3c7;
    color: #78350f;
    border-left: 4px solid #f59e0b;
  }

  .cmms-alert--info {
    background-color: #dbeafe;
    color: #0c4a6e;
    border-left: 4px solid #3b82f6;
  }
`;

/**
 * Tailwind classes for white mode components
 */
export const whiteModeClasses = {
  navContainer: 'bg-white border-b-2 border-slate-200 shadow-sm',
  tabButton: 'px-4 py-2.5 rounded-lg font-semibold text-sm transition-all duration-300 whitespace-nowrap border-2 border-transparent',
  tabButtonInactive: 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:border-slate-300',
  tabButtonActive: 'text-white border-transparent shadow-lg',
  
  contentContainer: 'bg-white rounded-lg p-6 shadow-sm border border-slate-200',
  sectionHeader: 'flex items-center gap-3 mb-6 pb-4 border-b-2 border-slate-200',
  sectionTitle: 'text-2xl font-bold text-slate-900',
  sectionSubtitle: 'text-sm text-slate-600',

  card: 'bg-white border border-slate-200 rounded-lg p-4 hover:border-slate-300 hover:shadow-md transition-all',
  
  btnPrimary: 'px-4 py-2 bg-gradient-to-br from-blue-700 to-blue-500 text-white rounded-lg font-semibold shadow-md hover:shadow-lg transition-all hover:-translate-y-0.5',
  btnSecondary: 'px-4 py-2 bg-slate-100 text-slate-900 border border-slate-300 rounded-lg font-semibold hover:bg-slate-200 transition-all',
  
  badge: 'inline-block px-3 py-1 rounded text-xs font-bold uppercase',
  
  input: 'w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100 transition-all',
  
  table: 'w-full border-collapse',
  tableHeader: 'bg-slate-50 border-b-2 border-slate-200',
  tableRow: 'border-b border-slate-200 hover:bg-slate-50 transition-colors'
};

export default {
  whiteThemePalette,
  getWhiteModePalette,
  whiteModeTabs,
  whiteModeClasses
};
