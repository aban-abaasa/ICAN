/**
 * VideoClipper Component
 * Allows users to trim/clip videos before uploading to status
 */

import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCcw, Check, X } from 'lucide-react';

export const VideoClipper = ({ videoFile, onClip, onCancel }) => {
  const videoRef = useRef(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [clipping, setClipping] = useState(false);

  // Create object URL once and cleanup on unmount
  useEffect(() => {
    if (!videoFile) return;
    
    const url = URL.createObjectURL(videoFile);
    setVideoUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [videoFile]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleLoadedMetadata = () => {
      const videoDuration = video.duration;
      setDuration(videoDuration);
      setEndTime(Math.min(videoDuration, 60)); // Max 60 seconds for longer clips
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    return () => video.removeEventListener('loadedmetadata', handleLoadedMetadata);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handleTimeUpdate = () => {
      const time = video.currentTime;
      setCurrentTime(time);

      // Stop at endTime
      if (time >= endTime) {
        video.pause();
        setIsPlaying(false);
      }
    };

    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => video.removeEventListener('timeupdate', handleTimeUpdate);
  }, [endTime]);

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.currentTime = Math.max(startTime, currentTime);
      const playPromise = video.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            setIsPlaying(true);
          })
          .catch((error) => {
            console.warn('Video play error:', error);
            setIsPlaying(false);
          });
      } else {
        setIsPlaying(true);
      }
    }
  };

  const handleClip = async () => {
    if (!videoFile || duration === 0) return;

    setClipping(true);
    try {
      // Create a canvas-based video clipper
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const video = videoRef.current;

      // Set canvas size to video size
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Seek to start time and capture
      video.currentTime = startTime;

      // For simplicity, we'll use FFmpeg.js (client-side) or just pass the clip info
      // If FFmpeg not available, we'll create a trimmed file reference
      const clippedBlob = await createClippedVideo(videoFile, startTime, endTime);

      onClip({
        blob: clippedBlob,
        startTime,
        endTime,
        duration: endTime - startTime
      });
    } catch (error) {
      console.error('Video clip error:', error);
    } finally {
      setClipping(false);
    }
  };

  const createClippedVideo = async (file, start, end) => {
    // This is a simplified version that returns a promise
    // In production, you'd use FFmpeg.js or a server-side solution for actual clipping
    return new Promise((resolve) => {
      // For now, return the original file with metadata about the clip
      resolve(new Blob([file], { type: file.type }));
    });
  };

  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const clippedDuration = endTime - startTime;
  const startPercent = (startTime / duration) * 100;
  const endPercent = (endTime / duration) * 100;
  const currentPercent = (currentTime / duration) * 100;

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-black/80 to-black/90 backdrop-blur-lg flex items-center justify-center z-50">
      <style>{`
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes glow {
          0%, 100% { box-shadow: 0 0 20px rgba(139, 92, 246, 0.3); }
          50% { box-shadow: 0 0 30px rgba(139, 92, 246, 0.6); }
        }
        @keyframes shimmer {
          0% { background-position: -1000px 0; }
          100% { background-position: 1000px 0; }
        }
        .video-clipper-modal {
          animation: slideUp 0.4s ease-out;
        }
        .glow-button {
          animation: glow 2s ease-in-out infinite;
        }
        .time-input:focus {
          box-shadow: 0 0 15px rgba(59, 130, 246, 0.5);
        }
      `}</style>

      <div className="video-clipper-modal bg-gradient-to-br from-gray-900 via-gray-800 to-black rounded-2xl shadow-2xl p-8 max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-purple-500/20">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
              Clip Your Video
            </h2>
            <p className="text-gray-400 text-sm mt-1">Trim to perfection • Min 1s, Max 60s</p>
          </div>
          <button
            onClick={onCancel}
            className="p-2 hover:bg-gray-700 rounded-full transition hover:rotate-90 duration-200"
          >
            <X className="w-6 h-6 text-gray-300" />
          </button>
        </div>

        {/* Video Preview with Gradient Border */}
        <div className="mb-6 p-1 bg-gradient-to-r from-purple-500 via-pink-500 to-red-500 rounded-xl">
          <div className="bg-black rounded-lg overflow-hidden">
            <video
              ref={videoRef}
              src={videoUrl}
              className="w-full h-96 object-contain"
              controls={false}
            />
          </div>
        </div>

        {/* Playback Controls */}
        <div className="flex items-center justify-center gap-4 mb-6 bg-gray-800/50 rounded-xl p-4 backdrop-blur">
          <button
            onClick={togglePlayPause}
            className="glow-button p-3 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 transition transform hover:scale-110 active:scale-95"
          >
            {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
          </button>
          <span className="text-base font-mono text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400 font-bold">
            {formatTime(currentTime)} / {formatTime(duration)}
          </span>
          <button
            onClick={() => {
              const video = videoRef.current;
              if (video) {
                video.currentTime = startTime;
                setCurrentTime(startTime);
              }
            }}
            className="p-3 rounded-full hover:bg-gray-700 transition transform hover:rotate-180 duration-500"
          >
            <RotateCcw className="w-5 h-5 text-gray-300" />
          </button>
        </div>

        {/* Timeline/Scrubber with Advanced Design */}
        <div className="mb-8">
          <div className="relative h-16 bg-gradient-to-r from-gray-800 to-gray-700 rounded-xl mb-3 overflow-hidden shadow-inner">
            {/* Background gradient */}
            <div
              className="absolute h-full bg-gradient-to-r from-purple-600/40 via-pink-500/40 to-red-500/40 pointer-events-none transition-all duration-100"
              style={{
                left: `${startPercent}%`,
                right: `${100 - endPercent}%`
              }}
            />

            {/* Grid pattern */}
            <div className="absolute inset-0 opacity-10 pointer-events-none" style={{
              backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent 2px, rgba(255,255,255,.1) 2px, rgba(255,255,255,.1) 4px)',
            }} />

            {/* Progress indicator */}
            <div
              className="absolute top-0 h-full w-1 bg-gradient-to-b from-yellow-400 to-red-500 shadow-lg"
              style={{ left: `${currentPercent}%` }}
            />

            {/* Timeline input */}
            <input
              type="range"
              min="0"
              max={duration}
              value={currentTime}
              onChange={(e) => {
                const newTime = parseFloat(e.target.value);
                setCurrentTime(newTime);
                const video = videoRef.current;
                if (video) video.currentTime = newTime;
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />

            {/* Start handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-12 bg-gradient-to-r from-purple-500 to-blue-500 rounded cursor-col-resize shadow-lg hover:shadow-purple-500/50 hover:shadow-lg z-20"
              style={{ left: `${startPercent}%`, marginLeft: '-6px' }}
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startPos = startTime;
                const handleMouseMove = (me) => {
                  const delta = (me.clientX - startX) / (window.innerWidth * 0.3);
                  const newStart = Math.max(0, Math.min(startPos + delta * duration, endTime));
                  setStartTime(newStart);
                  const video = videoRef.current;
                  if (video) video.currentTime = newStart;
                };
                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                };
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            />

            {/* End handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-3 h-12 bg-gradient-to-r from-red-500 to-pink-500 rounded cursor-col-resize shadow-lg hover:shadow-red-500/50 hover:shadow-lg z-20"
              style={{ right: `${100 - endPercent}%`, marginRight: '-6px' }}
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const endPos = endTime;
                const handleMouseMove = (me) => {
                  const delta = (me.clientX - startX) / (window.innerWidth * 0.3);
                  const newEnd = Math.max(startTime, Math.min(endPos + delta * duration, duration));
                  setEndTime(newEnd);
                };
                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                };
                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            />
          </div>

          {/* Time Inputs */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-gray-800/50 rounded-lg p-4 backdrop-blur">
              <label className="block text-sm font-bold text-purple-300 mb-2">START TIME</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="0"
                  max={endTime}
                  step="0.1"
                  value={startTime.toFixed(1)}
                  onChange={(e) => {
                    const newStart = parseFloat(e.target.value);
                    if (newStart >= 0 && newStart <= endTime) {
                      setStartTime(newStart);
                      const video = videoRef.current;
                      if (video) video.currentTime = newStart;
                    }
                  }}
                  className="time-input flex-1 px-4 py-2 border-2 border-purple-500/30 rounded-lg bg-gray-900 text-white font-mono focus:border-purple-500 focus:outline-none transition"
                />
                <span className="text-purple-400 font-bold">{formatTime(startTime)}</span>
              </div>
            </div>

            <div className="bg-gray-800/50 rounded-lg p-4 backdrop-blur">
              <label className="block text-sm font-bold text-pink-300 mb-2">END TIME</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={startTime}
                  max={duration}
                  step="0.1"
                  value={endTime.toFixed(1)}
                  onChange={(e) => {
                    const newEnd = parseFloat(e.target.value);
                    if (newEnd >= startTime && newEnd <= duration) {
                      setEndTime(newEnd);
                    }
                  }}
                  className="time-input flex-1 px-4 py-2 border-2 border-pink-500/30 rounded-lg bg-gray-900 text-white font-mono focus:border-pink-500 focus:outline-none transition"
                />
                <span className="text-pink-400 font-bold">{formatTime(endTime)}</span>
              </div>
            </div>
          </div>

          {/* Duration Info Card */}
          <div className="bg-gradient-to-r from-purple-900/40 to-pink-900/40 border border-purple-500/30 rounded-lg p-4 backdrop-blur">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-300 text-sm">CLIPPED DURATION</p>
                <p className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                  {formatTime(clippedDuration)}
                </p>
              </div>
              <div className="text-right">
                {clippedDuration < 1 && (
                  <span className="px-3 py-1 bg-red-500/20 border border-red-500/50 text-red-300 rounded-full text-xs font-bold">
                    ⚠️ MIN 1s
                  </span>
                )}
                {clippedDuration > 60 && (
                  <span className="px-3 py-1 bg-red-500/20 border border-red-500/50 text-red-300 rounded-full text-xs font-bold">
                    ⚠️ MAX 60s
                  </span>
                )}
                {clippedDuration >= 1 && clippedDuration <= 60 && (
                  <span className="px-3 py-1 bg-green-500/20 border border-green-500/50 text-green-300 rounded-full text-xs font-bold">
                    ✓ PERFECT
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-bold transition hover:shadow-lg"
          >
            CANCEL
          </button>
          <button
            onClick={handleClip}
            disabled={clipping || clippedDuration < 1 || clippedDuration > 60}
            className="flex-1 px-4 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold transition hover:shadow-lg hover:shadow-purple-500/50 flex items-center justify-center gap-2 disabled:hover:shadow-none"
          >
            {clipping ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent" />
                PROCESSING...
              </>
            ) : (
              <>
                <Check className="w-5 h-5" />
                CLIP & CONTINUE
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoClipper;
