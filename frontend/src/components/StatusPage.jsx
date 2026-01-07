/**
 * StatusPage Component
 * Displays the WhatsApp-style status feed
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { StatusFeed } from './StatusFeed';
import { ArrowLeft } from 'lucide-react';

export const StatusPage = ({ onGoBack }) => {
  const { user } = useAuth();

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <p className="text-white">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Back Button */}
      <div className="sticky top-0 z-20 bg-gradient-to-r from-purple-600 to-blue-600 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <button
            onClick={onGoBack}
            className="flex items-center gap-2 text-white hover:bg-white/10 px-3 py-2 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back
          </button>
        </div>
      </div>

      {/* Status Feed */}
      <StatusFeed />
    </div>
  );
};

export default StatusPage;
