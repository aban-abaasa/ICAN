import React from 'react';

const SkeletonPitchCard = () => {
  return (
    <div className="group bg-slate-800 backdrop-blur border-0 md:border border-slate-700 rounded-none md:rounded-none overflow-hidden flex flex-col h-full w-full animate-pulse">
      {/* Video Skeleton */}
      <div className="relative bg-gradient-to-r from-slate-800 via-slate-700 to-slate-800 aspect-video w-full flex-shrink-0 flex items-center justify-center overflow-hidden">
        {/* Shimmer effect */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer"></div>
      </div>
      
      {/* Info Section Skeleton */}
      <div className="flex-1 p-4 space-y-3">
        {/* Title Skeleton */}
        <div className="space-y-2">
          <div className="h-4 bg-gradient-to-r from-slate-700 to-slate-800 rounded w-3/4"></div>
          <div className="h-3 bg-gradient-to-r from-slate-700 to-slate-800 rounded w-1/2"></div>
        </div>
        
        {/* Creator Name Skeleton */}
        <div className="h-3 bg-gradient-to-r from-slate-700 to-slate-800 rounded w-2/3"></div>
        
        {/* Funding Info Skeleton */}
        <div className="grid grid-cols-3 gap-2 pt-2">
          <div className="h-10 bg-gradient-to-r from-slate-700 to-slate-800 rounded"></div>
          <div className="h-10 bg-gradient-to-r from-slate-700 to-slate-800 rounded"></div>
          <div className="h-10 bg-gradient-to-r from-slate-700 to-slate-800 rounded"></div>
        </div>
        
        {/* Button Skeleton */}
        <div className="h-10 bg-gradient-to-r from-slate-700 to-slate-800 rounded mt-4"></div>
      </div>

      {/* Shimmer Animation CSS */}
      <style>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        
        .animate-shimmer {
          animation: shimmer 2s infinite;
        }
      `}</style>
    </div>
  );
};

export default SkeletonPitchCard;
