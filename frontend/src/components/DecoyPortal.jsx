import React, { useState } from 'react';

/**
 * Decoy dashboard — where a flagged IP gets rerouted (see the reputation
 * gate in backend/middleware/canweShield.js and frontend/api/_lib/canweShield.js).
 *
 * Hard rule: this component must NEVER import supabase, AuthContext, or any
 * service module that reaches a real API. Everything on this page is a
 * hardcoded literal. That's the entire point — an attacker who got this far
 * should be able to click around, "see" a wallet, "log in", and never once
 * touch real data, a real session, or a real backend call. No network
 * request originates from this file.
 */

const FAKE_TRANSACTIONS = [
  { id: 'TXN-88213', label: 'Wallet top-up', amount: '+ UGX 250,000', date: '2026-09-01' },
  { id: 'TXN-88190', label: 'Send to +256 7•• ••• 214', amount: '- UGX 40,000', date: '2026-08-29' },
  { id: 'TXN-88144', label: 'Dividend payout', amount: '+ UGX 118,500', date: '2026-08-24' },
];

const DecoyPortal = () => {
  const [view, setView] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleFakeLogin = (e) => {
    e.preventDefault();
    setView('dashboard');
  };

  if (view === 'login') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 px-4">
        <div className="max-w-md w-full bg-slate-900/80 border border-slate-700 rounded-2xl shadow-2xl p-8 backdrop-blur">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 flex items-center justify-center text-3xl">💎</div>
            <h1 className="text-xl font-bold text-white">IcanEra Admin Console</h1>
            <p className="text-sm text-slate-400 mt-1">Sign in to continue</p>
          </div>
          <form onSubmit={handleFakeLogin} className="space-y-4">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Admin email"
              className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-600 text-white placeholder-slate-500"
              autoComplete="off"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full px-4 py-3 rounded-lg bg-slate-800 border border-slate-600 text-white placeholder-slate-500"
              autoComplete="off"
            />
            <button
              type="submit"
              className="w-full py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 transition"
            >
              Sign In
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 text-white p-6">
      <div className="max-w-4xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <button
            onClick={() => setView('login')}
            className="text-sm text-slate-400 hover:text-white transition"
          >
            Sign out
          </button>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-5">
            <p className="text-slate-400 text-sm">Total Balance</p>
            <p className="text-2xl font-bold mt-1">UGX 4,820,500</p>
          </div>
          <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-5">
            <p className="text-slate-400 text-sm">Active Wallets</p>
            <p className="text-2xl font-bold mt-1">1,204</p>
          </div>
          <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-5">
            <p className="text-slate-400 text-sm">Pending Transfers</p>
            <p className="text-2xl font-bold mt-1">3</p>
          </div>
        </div>

        <div className="bg-slate-800/70 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700">
            <h2 className="font-semibold">Recent Transactions</h2>
          </div>
          <ul className="divide-y divide-slate-700">
            {FAKE_TRANSACTIONS.map((txn) => (
              <li key={txn.id} className="px-5 py-4 flex items-center justify-between text-sm">
                <div>
                  <p className="font-medium">{txn.label}</p>
                  <p className="text-slate-500">{txn.id} • {txn.date}</p>
                </div>
                <span className={txn.amount.startsWith('+') ? 'text-emerald-400' : 'text-red-400'}>
                  {txn.amount}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default DecoyPortal;
