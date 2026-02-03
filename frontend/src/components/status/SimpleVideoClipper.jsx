import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCcw, Check, X, Scissors } from 'lucide-react';

export const VideoClipper = ({ videoFile, onClip, onCancel }) => {
  const videoRef = useRef(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [segments, setSegments] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!videoFile) return;
    
    try {
      const url = URL.createObjectURL(new Blob([videoFile], { type: videoFile.type || 'video/mp4' }));
      setVideoUrl(url);
      setIsLoading(false);
      
      return () => URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error creating video URL:', error);
      setIsLoading(false);
    }
  }, [videoFile]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    const handleLoadedMetadata = () => {
      const dur = video.duration;
      if (isNaN(dur) || dur === 0) return;
      
      setDuration(dur);
      setEndTime(dur);
      
      // Create 10-second segments
      const segs = [];
      const segmentDuration = 10;
      for (let i = 0; i < dur; i += segmentDuration) {
        segs.push({
          start: i,
          end: Math.min(i + segmentDuration, dur),
          selected: false
        });
      }
      setSegments(segs);
    };

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime);
      if (video.currentTime >= endTime) {
        video.pause();
        setIsPlaying(false);
      }
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [endTime, videoUrl]);

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    
    if (isPlaying) {
      video.pause();
    } else {
      if (currentTime >= endTime) video.currentTime = startTime;
      video.play().catch(err => console.error('Play error:', err));
    }
    setIsPlaying(!isPlaying);
  };

  const toggleSegment = (index) => {
    const newSegments = [...segments];
    newSegments[index].selected = !newSegments[index].selected;
    setSegments(newSegments);

    const selected = newSegments.filter(s => s.selected);
    if (selected.length > 0) {
      setStartTime(Math.min(...selected.map(s => s.start)));
      setEndTime(Math.max(...selected.map(s => s.end)));
    }
  };

  const selectAll = () => {
    setSegments(segments.map(s => ({ ...s, selected: true })));
    setStartTime(0);
    setEndTime(duration);
  };

  const clearAll = () => {
    setSegments(segments.map(s => ({ ...s, selected: false })));
  };

  const handleClip = async () => {
    try {
      const selectedDuration = endTime - startTime;
      const start = Math.floor(videoFile.size * (startTime / duration));
      const end = Math.floor(videoFile.size * (endTime / duration));
      const clippedBlob = videoFile.slice(start, end, videoFile.type);
      
      onClip({
        blob: clippedBlob,
        start: startTime,
        end: endTime,
        duration: selectedDuration
      });
    } catch (error) {
      console.error('Clip error:', error);
      onClip({ blob: videoFile, start: 0, end: duration, duration });
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-black z-[9999] flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2">
          <Scissors className="w-5 h-5 text-white" />
          <h3 className="text-lg font-bold text-white">Trim</h3>
        </div>
        <button
          onClick={onCancel}
          className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Full Screen Video */}
      <div className="flex-1 bg-black relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-white text-lg">Loading...</div>
          </div>
        ) : (
          <video
            ref={videoRef}
            src={videoUrl}
            className="w-full h-full object-contain"
            playsInline
            preload="metadata"
          >
            <source src={videoUrl} type={videoFile?.type || 'video/mp4'} />
          </video>
        )}

        {/* Play Button Overlay */}
        <button
          onClick={togglePlayPause}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-purple-600/80 hover:bg-purple-600 backdrop-blur-sm text-white flex items-center justify-center transition-all hover:scale-110 active:scale-95 shadow-2xl"
        >
          {isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
        </button>

        {/* Time Display */}
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full text-white text-sm font-bold">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>

      {/* Controls Panel */}
      <div className="bg-gradient-to-br from-slate-900 to-black border-t border-purple-500/30">
        {/* Segment Tabs */}
        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-purple-300">Segments</span>
            <div className="flex gap-2">
              <button
                onClick={selectAll}
                className="px-3 py-1 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-all"
              >
                All
              </button>
              <button
                onClick={clearAll}
                className="px-3 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold transition-all"
              >
                Clear
              </button>
            </div>
          </div>

          {/* Segment Grid - Simple Tabs */}
          <div className="grid grid-cols-3 gap-2 mb-3">
            {segments.map((seg, idx) => (
              <button
                key={idx}
                onClick={() => toggleSegment(idx)}
                className={`px-3 py-2 rounded-lg font-bold text-sm transition-all ${
                  seg.selected
                    ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/50 scale-105'
                    : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {formatTime(seg.start)}
              </button>
            ))}
          </div>

          {/* Selection Info */}
          <div className="bg-slate-800/50 rounded-lg px-4 py-2 mb-3">
            <div className="text-xs text-slate-400">Selected:</div>
            <div className="text-sm font-bold text-white">
              {formatTime(startTime)} - {formatTime(endTime)} ({formatTime(endTime - startTime)})
            </div>
          </div>

          {/* Action Buttons - With bottom padding to avoid tab bar */}
          <div className="grid grid-cols-2 gap-3 pb-20">
            <button
              onClick={onCancel}
              className="py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold text-sm transition-all flex items-center justify-center gap-2"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button
              onClick={handleClip}
              className="py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-bold text-sm transition-all flex items-center justify-center gap-2 shadow-lg shadow-purple-500/50"
            >
              <Check className="w-4 h-4" />
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoClipper;
