import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/index.css';
import { AuthProvider } from '../src/context/AuthContext';
import OnChainPanel from '../src/components/OnChainPanel';

// Test harness for blockchain/e2e/chain-e2e.mjs. Not imported by the app and not part of the production build.
createRoot(document.getElementById('root')).render(
  <AuthProvider>
    <OnChainPanel />
  </AuthProvider>,
);
