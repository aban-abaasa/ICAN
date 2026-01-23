import React, { useState } from 'react';
import { 
  TrendingUp, 
  Wallet, 
  Users, 
  Activity, 
  Send, 
  Plus,
  Eye,
  BarChart3,
  Shield,
  Globe,
  Menu,
  X,
  ChevronDown,
  Home,
  Lock,
  Target,
  Heart,
  Settings,
  DollarSign,
  Banknote,
  Search,
  Bell,
  LogOut,
  Edit2,
  Upload,
  MoreVertical,
  Calendar,
  TrendingDown,
  PieChart,
  LineChart
} from 'lucide-react';

const DashboardPreview = ({ isMobile = false }) => {
  const [expandedMenu, setExpandedMenu] = useState(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navigationItems = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'readiness', label: 'Readiness', icon: Globe },
    { id: 'growth', label: 'Growth', icon: TrendingUp },
    { id: 'trust', label: 'Trust', icon: Banknote },
    { id: 'share', label: 'Share', icon: Send },
    { id: 'wallet', label: 'Wallet', icon: DollarSign },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  // Mobile View
  if (isMobile) {
    return (
      <div className="w-full h-screen bg-gradient-to-br from-slate-900 to-slate-800 text-white overflow-hidden flex flex-col">
        {/* Mobile Header */}
        <div className="bg-gradient-to-r from-purple-900/40 to-blue-900/40 border-b border-purple-500/20 px-4 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg"></div>
            <span className="font-bold text-sm">ICAN</span>
          </div>
          <button className="p-2 hover:bg-purple-500/20 rounded-lg transition">
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* Mobile Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Profile Card */}
          <div className="bg-gradient-to-br from-purple-900/30 to-purple-800/20 border border-purple-500/30 rounded-lg p-4">
            <div className="flex items-center space-x-3 mb-4">
              <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full"></div>
              <div>
                <p className="text-sm font-semibold">Welcome</p>
                <p className="text-xs text-gray-400">User Profile</p>
              </div>
            </div>
            <div className="h-0.5 bg-purple-500/20 my-3"></div>
            <p className="text-xs text-gray-400">Total Balance</p>
            <p className="text-lg font-bold text-purple-300">$24,580</p>
          </div>

          {/* Quick Stats - 2 columns */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/30 rounded-lg p-3">
              <p className="text-xs text-gray-400">Transactions</p>
              <p className="text-lg font-bold text-blue-300">147</p>
              <p className="text-xs text-green-400">↑ 12%</p>
            </div>
            <div className="bg-gradient-to-br from-pink-500/10 to-pink-600/5 border border-pink-500/30 rounded-lg p-3">
              <p className="text-xs text-gray-400">Groups</p>
              <p className="text-lg font-bold text-pink-300">8</p>
              <p className="text-xs text-green-400">3 active</p>
            </div>
          </div>

          {/* Navigation Menu */}
          <div className="space-y-2">
            <p className="text-xs text-gray-400 font-semibold px-2">MAIN MENU</p>
            {navigationItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className="w-full flex items-center space-x-3 px-3 py-2.5 rounded-lg hover:bg-purple-500/20 transition text-sm"
                >
                  <Icon className="w-4 h-4 text-purple-400" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Quick Actions */}
          <div className="space-y-2 border-t border-purple-500/20 pt-3">
            <p className="text-xs text-gray-400 font-semibold px-2">ACTIONS</p>
            <button className="w-full bg-gradient-to-r from-purple-500/20 to-purple-600/10 border border-purple-500/30 rounded-lg py-2 flex items-center justify-center space-x-2 hover:border-purple-500/50 transition text-sm">
              <Send className="w-4 h-4" />
              <span>Send Money</span>
            </button>
            <button className="w-full bg-gradient-to-r from-pink-500/20 to-pink-600/10 border border-pink-500/30 rounded-lg py-2 flex items-center justify-center space-x-2 hover:border-pink-500/50 transition text-sm">
              <Plus className="w-4 h-4" />
              <span>Add Funds</span>
            </button>
          </div>
        </div>

        {/* Mobile Bottom Navigation */}
        <div className="border-t border-purple-500/20 bg-gradient-to-r from-purple-900/40 to-blue-900/40 px-4 py-3 grid grid-cols-3 gap-2">
          <button className="flex flex-col items-center space-y-1 py-2 px-2 hover:bg-purple-500/20 rounded-lg transition">
            <BarChart3 className="w-5 h-5 text-purple-400" />
            <span className="text-xs">Dashboard</span>
          </button>
          <button className="flex flex-col items-center space-y-1 py-2 px-2 hover:bg-purple-500/20 rounded-lg transition">
            <Wallet className="w-5 h-5 text-purple-400" />
            <span className="text-xs">Wallet</span>
          </button>
          <button className="flex flex-col items-center space-y-1 py-2 px-2 hover:bg-purple-500/20 rounded-lg transition">
            <Settings className="w-5 h-5 text-purple-400" />
            <span className="text-xs">Settings</span>
          </button>
        </div>
      </div>
    );
  }

  // Desktop View
  return (
    <div className="w-full bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl border border-purple-500/20 overflow-hidden flex h-[600px]">
      {/* Sidebar */}
      <div className="w-56 bg-gradient-to-b from-slate-800/50 to-slate-900/50 border-r border-purple-500/20 overflow-y-auto flex flex-col">
        {/* Logo */}
        <div className="flex items-center space-x-2 px-6 py-6 border-b border-purple-500/20">
          <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-lg"></div>
          <span className="font-bold">ICAN</span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-2">
          <p className="text-xs text-gray-400 font-semibold px-2 mb-4">MAIN MENU</p>
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition ${
                  item.id === 'dashboard'
                    ? 'bg-gradient-to-r from-purple-500/30 to-purple-600/20 border border-purple-500/50 text-white'
                    : 'hover:bg-purple-500/10 text-gray-300 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span className="text-sm font-medium">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom Section */}
        <div className="p-4 border-t border-purple-500/20 space-y-2">
          <button className="w-full flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-purple-500/10 transition text-sm text-gray-300">
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
          <button className="w-full flex items-center space-x-2 px-3 py-2 rounded-lg hover:bg-red-500/10 transition text-sm text-gray-300">
            <LogOut className="w-4 h-4" />
            <span>Logout</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto flex flex-col">
        {/* Top Header */}
        <div className="bg-gradient-to-r from-purple-900/40 to-blue-900/40 border-b border-purple-500/20 px-8 py-4 flex justify-between items-center">
          <div>
            <p className="text-sm text-gray-400">Welcome back</p>
            <h1 className="text-2xl font-bold">Your Dashboard</h1>
          </div>
          <div className="flex items-center space-x-4">
            <button className="p-2 hover:bg-purple-500/20 rounded-lg transition">
              <Search className="w-5 h-5 text-gray-400" />
            </button>
            <button className="p-2 hover:bg-purple-500/20 rounded-lg transition relative">
              <Bell className="w-5 h-5 text-gray-400" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
            </button>
            <div className="flex items-center space-x-3 pl-4 border-l border-purple-500/20">
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full"></div>
            </div>
          </div>
        </div>

        {/* Dashboard Content */}
        <div className="flex-1 px-8 py-6 space-y-6 overflow-y-auto">
          {/* Key Metrics Grid */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/30 rounded-lg p-5 hover:border-purple-500/50 transition">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-400">Total Balance</span>
                <Wallet className="w-4 h-4 text-purple-400" />
              </div>
              <p className="text-2xl font-bold text-purple-300 mb-1">$24,580</p>
              <p className="text-xs text-green-400">↑ 12.5% this month</p>
            </div>

            <div className="bg-gradient-to-br from-pink-500/10 to-pink-600/5 border border-pink-500/30 rounded-lg p-5 hover:border-pink-500/50 transition">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-400">Transactions</span>
                <Activity className="w-4 h-4 text-pink-400" />
              </div>
              <p className="text-2xl font-bold text-pink-300 mb-1">147</p>
              <p className="text-xs text-green-400">23 this week</p>
            </div>

            <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 border border-blue-500/30 rounded-lg p-5 hover:border-blue-500/50 transition">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-400">Groups</span>
                <Users className="w-4 h-4 text-blue-400" />
              </div>
              <p className="text-2xl font-bold text-blue-300 mb-1">8</p>
              <p className="text-xs text-green-400">3 active</p>
            </div>

            <div className="bg-gradient-to-br from-green-500/10 to-green-600/5 border border-green-500/30 rounded-lg p-5 hover:border-green-500/50 transition">
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm text-gray-400">Portfolio</span>
                <TrendingUp className="w-4 h-4 text-green-400" />
              </div>
              <p className="text-2xl font-bold text-green-300 mb-1">+$3,240</p>
              <p className="text-xs text-green-400">ROI 8.7%</p>
            </div>
          </div>

          {/* Charts Section */}
          <div className="grid grid-cols-3 gap-4">
            {/* Activity Chart */}
            <div className="col-span-2 bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-purple-500/20 rounded-lg p-5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold">Activity Overview</h3>
                <MoreVertical className="w-4 h-4 text-gray-400 cursor-pointer" />
              </div>
              <div className="h-32 flex items-end justify-around">
                {[40, 60, 45, 70, 55, 80, 65, 75].map((height, i) => (
                  <div
                    key={i}
                    className="w-3 bg-gradient-to-t from-purple-500 to-pink-500 rounded-sm opacity-80 hover:opacity-100 transition"
                    style={{ height: `${height}%` }}
                  ></div>
                ))}
              </div>
            </div>

            {/* Portfolio Distribution */}
            <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-purple-500/20 rounded-lg p-5">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-semibold">Distribution</h3>
                <PieChart className="w-4 h-4 text-gray-400" />
              </div>
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Stocks</span>
                    <span className="text-purple-300">45%</span>
                  </div>
                  <div className="h-2 bg-purple-500/20 rounded-full overflow-hidden">
                    <div className="h-full w-[45%] bg-gradient-to-r from-purple-500 to-purple-400"></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Bonds</span>
                    <span className="text-pink-300">30%</span>
                  </div>
                  <div className="h-2 bg-pink-500/20 rounded-full overflow-hidden">
                    <div className="h-full w-[30%] bg-gradient-to-r from-pink-500 to-pink-400"></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span>Crypto</span>
                    <span className="text-blue-300">25%</span>
                  </div>
                  <div className="h-2 bg-blue-500/20 rounded-full overflow-hidden">
                    <div className="h-full w-[25%] bg-gradient-to-r from-blue-500 to-blue-400"></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Recent Transactions */}
          <div className="bg-gradient-to-br from-slate-800/50 to-slate-900/50 border border-purple-500/20 rounded-lg p-5">
            <h3 className="font-semibold mb-4">Recent Transactions</h3>
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between p-3 bg-purple-500/10 rounded-lg border border-purple-500/20 hover:border-purple-500/40 transition">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-gradient-to-br from-purple-500/40 to-pink-500/40 rounded-full flex items-center justify-center">
                      {i === 1 && <Send className="w-4 h-4 text-purple-300" />}
                      {i === 2 && <TrendingUp className="w-4 h-4 text-green-300" />}
                      {i === 3 && <Plus className="w-4 h-4 text-blue-300" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium">{['Sent to John', 'Dividend Received', 'Deposit'][i-1]}</p>
                      <p className="text-xs text-gray-400">Today at {['2:30 PM', '1:45 PM', '11:20 AM'][i-1]}</p>
                    </div>
                  </div>
                  <p className={`text-sm font-semibold ${i === 2 ? 'text-green-300' : i === 1 ? 'text-red-300' : 'text-blue-300'}`}>
                    {i === 1 ? '-$250' : i === 2 ? '+$1,250' : '+$5,000'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPreview;
