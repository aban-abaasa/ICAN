import React from 'react';
import ShareholderPendingSignatures from '../components/ShareholderPendingSignatures';

export default function ShareholderDashboard() {
  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <ShareholderPendingSignatures />
    </div>
  );
}
