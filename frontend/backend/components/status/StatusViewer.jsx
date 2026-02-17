/**
 * StatusViewer Component
 * Full-screen WhatsApp-style status viewer with auto-progression
 * Shows statuses one at a time, auto-advances to next after duration
 */

import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, X, Eye, Heart } from 'lucide-react';

export const StatusViewer = ({ 
  statuses = [], 
  initialIndex = 0, 
  onClose = null,
  duration = 5000 // 5 seconds per status
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);

  const currentStatus = statuses[currentIndex];

  // Auto-progress to next status
  useEffect(() => {
    if (isPaused || !statuses.length) return;

    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          // Move to next status
          setCurrentIndex((idx) => {
            const nextIdx = idx + 1;
            if (nextIdx >= statuses.length) {
              onClose?.();
              return idx;
            }
            setProgress(0);
            return nextIdx;
          });
          return 0;
        }
        return prev + (100 / (duration / 10));
      });
    }, 10);

    return () => clearInterval(interval);
  }, [isPaused, statuses.length, duration, onClose]);

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setProgress(0);
    }
  };

  const handleNext = () => {
    if (currentIndex < statuses.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setProgress(0);
    } else {
      onClose?.();
    }
  };

  if (!statuses.length) return null;

  return (
    <div
      className="fixed inset-0 bg-black z-50 flex flex-col"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Top bar with progress indicators */}
      <div className="p-4 space-y-2">
        <div className="flex gap-1">
          {statuses.map((_, idx) => (
            <div
              key={idx}
              className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden"
            >
              <div
                className="h-full bg-white transition-all"
                style={{
                  width: idx === currentIndex ? `${progress}%` : idx < currentIndex ? '100%' : '0%'
                }}
              />
            </div>
          ))}
        </div>

        {/* User info */}
        <div className="flex items-center justify-between text-white">
          <div className="text-sm font-medium">{currentStatus?.user?.email}</div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-white/10 rounded-full transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center relative">
        {/* Media */}
        {currentStatus?.media_type === 'image' ? (
          <img
            src={currentStatus.media_url}
            alt="Status"
            className="w-full h-full object-contain"
          />
        ) : (
          <video
            src={currentStatus?.media_url}
            autoPlay
            className="w-full h-full object-contain"
          />
        )}

        {/* Caption */}
        {currentStatus?.caption && (
          <div className="absolute bottom-20 left-4 right-4 bg-black/40 backdrop-blur-sm rounded-lg p-4 text-white text-center max-w-xs mx-auto">
            <p className="text-sm">{currentStatus.caption}</p>
          </div>
        )}

        {/* Navigation buttons */}
        {currentIndex > 0 && (
          <button
            onClick={handlePrevious}
            className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}

        {currentIndex < statuses.length - 1 && (
          <button
            onClick={handleNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-white/20 hover:bg-white/30 rounded-full text-white transition-colors"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        )}
      </div>

      {/* Bottom info */}
      <div className="p-4 bg-black/40 backdrop-blur-sm border-t border-white/10">
        <div className="flex items-center justify-between text-white text-sm">
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <Eye className="w-4 h-4" />
              <span>{currentStatus?.view_count || 0} views</span>
            </div>
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4" />
              <span>{currentStatus?.reaction_count || 0}</span>
            </div>
          </div>
          <span>
            {currentIndex + 1} / {statuses.length}
          </span>
        </div>
      </div>
    </div>
  );
};

export default StatusViewer;
