import React from 'react';
import { 
  Bell,
  Shield,
  Globe,
  TrendingUp,
  FileText,
  Heart,
  Calculator,
  Settings
} from 'lucide-react';

export const ExtensionPage = () => {
  const extensionMenuItems = [
    {
      id: 'notifications',
      label: 'Notifications',
      icon: Bell,
      path: '/notifications'
    },
    {
      id: 'security',
      label: 'Security',
      icon: Shield,
      path: '/security'
    },
    {
      id: 'readiness',
      label: 'Readiness',
      icon: Globe,
      path: '/readiness'
    },
    {
      id: 'growth',
      label: 'Growth',
      icon: TrendingUp,
      path: '/growth'
    },
    {
      id: 'reports',
      label: 'Reports',
      icon: FileText,
      path: '/reports'
    },
    {
      id: 'tithe',
      label: 'Tithe',
      icon: Heart,
      path: '/tithe'
    },
    {
      id: 'loan-calculator',
      label: 'Loan Calculator',
      icon: Calculator,
      path: '/loan-calculator'
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      path: '/settings'
    }
  ];

  return (
    <div className="min-h-screen bg-white p-4 md:p-8">
      <div className="max-w-md mx-auto space-y-4">
        {extensionMenuItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => {
                // Navigate to the item path
                window.location.hash = item.path;
              }}
              className="w-full flex items-center gap-4 p-4 rounded-lg hover:bg-slate-100 transition-all text-left group"
            >
              <Icon className="w-6 h-6 text-slate-600 group-hover:text-slate-900 transition-colors" />
              <span className="text-lg font-medium text-slate-900 group-hover:font-semibold transition-all">
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
