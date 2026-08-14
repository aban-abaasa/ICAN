import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';

// Keep QR attendance separate from the ICAN application bundle. A scanned
// code renders only the small verification/check-in page and never mounts the
// dashboard, wallet, landing page, or CMMS workspace.
const isAttendanceQrPath = window.location.pathname === '/staff-attendance';
const isVisitorQrPath = window.location.pathname === '/visitor-check-in';
const App = React.lazy(() => import('./App'));
const PublicStaffAttendanceCheckIn = React.lazy(() => import('./components/PublicStaffAttendanceCheckIn'));
const PublicVisitorCheckIn = React.lazy(() => import('./components/PublicVisitorCheckIn'));
const Loading = () => <div className="min-h-screen bg-slate-950" />;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider>
      <Suspense fallback={<Loading />}>
        {isAttendanceQrPath ? <PublicStaffAttendanceCheckIn /> : isVisitorQrPath ? <PublicVisitorCheckIn /> : <AuthProvider><App /></AuthProvider>}
      </Suspense>
    </ThemeProvider>
  </React.StrictMode>,
);

// Register Service Worker for PWA functionality
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => {
        console.log('[PWA] Service Worker registered:', registration);
      })
      .catch(error => {
        console.warn('[PWA] Service Worker registration failed:', error);
      });
  });
}
