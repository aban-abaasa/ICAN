/**
 * StatusPage Component
 * Displays the WhatsApp-style status feed with simplified transparent header
 */

import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { StatusFeed } from './StatusFeed';
import { Plus, ArrowLeft } from 'lucide-react';
import { StatusUploader } from './status/StatusUploader';

export const StatusPage = ({ onGoBack }) => {
  const { user } = useAuth();
  const [showStatusUploader, setShowStatusUploader] = useState(false);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <p className="text-white">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Simplified Transparent Overlay Header */}
      <div className="sticky top-0 z-20 backdrop-blur-md bg-black/40">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <button
            onClick={onGoBack}
            className="p-2 rounded-lg hover:bg-white/10 text-white transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-2xl font-bold text-white">Status</h1>
          <button
            onClick={() => setShowStatusUploader(true)}
            className="p-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 transition-all shadow-lg"
            title="Add new status"
          >
            <Plus className="w-6 h-6" />
          </button>
        </div>
      </div>

      {/* Status Feed */}
      <StatusFeed />

      {/* Status Uploader Modal */}
      {showStatusUploader && (
        <StatusUploader
          onClose={() => setShowStatusUploader(false)}
          onStatusCreated={() => {
            setShowStatusUploader(false);
          }}
        />
      )}
    </div>
  );
};

export default StatusPage;
