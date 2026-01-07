/**
 * StatusCarousel Component
 * Displays user statuses and active status feed in the header
 */

import React, { useState, useEffect } from 'react';
import { useAuth } from '../../context/AuthContext';
import { getActiveStatuses, recordStatusView } from '../../services/statusService';
import { ChevronLeft, ChevronRight, Eye, X } from 'lucide-react';

export const StatusCarousel = ({ onStatusClick = null }) => {
  const { user } = useAuth();
  const [statuses, setStatuses] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [viewedStatuses, setViewedStatuses] = useState(new Set());

  useEffect(() => {
    loadStatuses();
    const interval = setInterval(loadStatuses, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, [user?.id]);

  const loadStatuses = async () => {
    try {
      if (!user?.id) return;
      const activeStatuses = await getActiveStatuses();
      console.log('StatusCarousel - Loaded statuses:', activeStatuses?.length || 0, activeStatuses);
      setStatuses(activeStatuses || []);
      setLoading(false);
    } catch (error) {
      console.error('Failed to load statuses:', error);
      setLoading(false);
    }
  };

  const handleViewStatus = async (status) => {
    if (!viewedStatuses.has(status.id)) {
      await recordStatusView(status.id, user?.id);
      setViewedStatuses(prev => new Set([...prev, status.id]));
    }
    onStatusClick?.(status);
  };

  const handlePrevious = () => {
    setCurrentIndex(prev => (prev === 0 ? statuses.length - 1 : prev - 1));
  };

  const handleNext = () => {
    setCurrentIndex(prev => (prev === statuses.length - 1 ? 0 : prev + 1));
  };

  if (loading || statuses.length === 0) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-gray-400 text-sm">
        <Eye className="w-4 h-4" />
        <span>No active statuses</span>
      </div>
    );
  }

  const currentStatus = statuses[currentIndex];
  const hasMultiple = statuses.length > 1;

  if (!currentStatus) {
    return (
      <div className="flex items-center gap-2 px-2 py-2 text-gray-400 text-xs whitespace-nowrap">
        <Eye className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">No statuses</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-shrink">
      {/* Status Display */}
      <div className="flex items-center gap-2 px-2 py-1.5 bg-white bg-opacity-10 border border-white border-opacity-20 rounded-lg hover:bg-opacity-20 transition-all cursor-pointer group min-w-0" onClick={() => handleViewStatus(currentStatus)}>
        {/* Status Thumbnail */}
        <div className="relative w-8 h-8 rounded-full overflow-hidden flex-shrink-0">
          {currentStatus.thumbnail_url ? (
            <img
              src={currentStatus.thumbnail_url}
              alt="Status"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xs font-bold">
              {currentStatus.created_by?.charAt(0) || 'S'}
            </div>
          )}
          {/* Viewing indicator */}
          <div className="absolute inset-0 ring-1.5 ring-green-400 rounded-full group-hover:ring-green-300 transition-all"></div>
        </div>

        {/* Status Info - Hide on mobile, show on sm+ */}
        <div className="hidden sm:flex flex-1 min-w-0 flex-col">
          <div className="text-xs font-medium text-white truncate">
            {currentStatus.created_by?.substring(0, 10) || 'Status'}
          </div>
          <div className="text-xs text-gray-400">
            {currentStatus.view_count || 0}
          </div>
        </div>

        {/* View Icon */}
        <Eye className="w-3.5 h-3.5 text-gray-400 group-hover:text-white transition-colors flex-shrink-0" />
      </div>

      {/* Navigation Controls - Compact */}
      {hasMultiple && (
        <div className="flex items-center gap-1">
          <button
            onClick={handlePrevious}
            className="p-1.5 hover:bg-white hover:bg-opacity-10 rounded-lg transition-colors text-gray-400 hover:text-white"
            title="Previous status"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          {/* Status Counter */}
          <div className="px-2 py-1 text-xs text-gray-400 bg-white bg-opacity-5 rounded">
            {currentIndex + 1}/{statuses.length}
          </div>

          <button
            onClick={handleNext}
            className="p-1.5 hover:bg-white hover:bg-opacity-10 rounded-lg transition-colors text-gray-400 hover:text-white"
            title="Next status"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default StatusCarousel;
