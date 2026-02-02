/**
 * 📋 EXAMPLE: How to integrate CountryCheckMiddleware into App.jsx
 * 
 * This shows the recommended approach for your main App component
 */

import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import CountryCheckMiddleware from './components/auth/CountryCheckMiddleware';

// Pages
import LoginPage from './pages/LoginPage';
import SignUpPage from './pages/SignUpPage';
import DashboardPage from './pages/DashboardPage';
import BuyIcan from './components/ICAN/BuyIcan';
import SellIcan from './components/ICAN/SellIcan';
import IcanPortfolio from './components/ICAN/IcanPortfolio';

function App() {
  return (
    <AuthProvider>
      <CountryCheckMiddleware>
        <Router>
          <Routes>
            {/* Public Routes - Before Login */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />

            {/* Protected Routes - After Login (Country Check Applied) */}
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/buy-ican" element={<BuyIcan />} />
            <Route path="/sell-ican" element={<SellIcan />} />
            <Route path="/portfolio" element={<IcanPortfolio />} />

            {/* Default Route */}
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Router>
      </CountryCheckMiddleware>
    </AuthProvider>
  );
}

export default App;

/**
 * FLOW EXPLANATION:
 * 
 * 1. User visits app
 * 2. CountryCheckMiddleware loads
 * 3. AuthProvider checks authentication status
 * 4. If not logged in → Show login/signup (no country check)
 * 5. If logged in → CountryCheckMiddleware checks country
 *    - Has country? → Show dashboard/app normally
 *    - No country? → Show CountrySetup modal (mandatory!)
 * 6. User selects country → Modal closes → App loads
 * 
 * BEHAVIOR:
 * ✅ New users: Signup includes country selection
 * ✅ Existing users without country: Forced to set on login
 * ✅ Existing users with country: Normal app flow
 * ✅ All ICAN features require country (protected by check)
 */
