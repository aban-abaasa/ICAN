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
      // Create blob URL with proper type
      const url = URL.createObjectURL(new Blob([videoFile], { type: videoFile.type || 'video/mp4' }));
      setVideoUrl(url);
      setIsLoading(false);
      
      return () => {
        URL.revokeObjectURL(url);
      };
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
      if (isNaN(dur) || dur === 0) {
        console.warn('Invalid video duration');
        return;
      }
      
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
      
      // Auto-pause at end time
      if (video.currentTime >= endTime) {
        video.pause();
        setIsPlaying(false);
      }
    };

    const handleError = (e) => {
      console.error('Video error:', e);
      console.error('Video error details:', video.error);
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('error', handleError);

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('error', handleError);
    };
  }, [endTime, videoUrl]);

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    
    if (isPlaying) {
      video.pause();
    } else {
      if (currentTime >= endTime) {
        video.currentTime = startTime;
      }
      video.play().catch(err => console.error('Play error:', err));
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (time) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  const toggleSegment = (index) => {
    const newSegments = [...segments];
    newSegments[index].selected = !newSegments[index].selected;
    setSegments(newSegments);

    // Update start/end times based on selected segments
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
      // For now, just slice the blob at byte level (approximation)
      const selectedDuration = endTime - startTime;
      const ratio = selectedDuration / duration;
      
      // Simple blob slicing (not perfect but works for demonstration)
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
      alert('Error clipping video. Using full video instead.');
      onClip({ blob: videoFile, start: 0, end: duration, duration });
    }
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 bg-black/90 backdrop-blur-sm flex items-center justify-center z-[9999] p-2">
      <div className="bg-gradient-to-br from-slate-900 to-black rounded-2xl shadow-2xl w-full max-w-2xl border border-purple-500/30 max-h-[95vh] overflow-y-auto">
        
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-900/95 to-pink-900/95 backdrop-blur-md border-b border-purple-500/30 px-4 py-3 rounded-t-2xl flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <Scissors className="w-5 h-5 text-purple-300" />
            <h3 className="text-lg font-bold text-white">Trim</h3>
          </div>
          <button onClick={onCancel} className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Video Preview */}
        <div className="p-4">
          <div className="relative bg-black rounded-lg overflow-hidden aspect-video">
            {isLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-white">Loading...</div>
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
          </div>

          {/* Playback Controls */}
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={togglePlayPause}
              disabled={isLoading || duration === 0}
              className="w-12 h-12 rounded-full bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white flex items-center justify-center transition"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
            </button>
            
            <div className="flex-1">
              <input
                type="range"
                min={0}
                max={duration || 100}
                step={0.1}
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                disabled={duration === 0}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${(currentTime/(duration||1))*100}%, #334155 ${(currentTime/(duration||1))*100}%, #334155 100%)`
                }}
              />
              <div className="flex justify-between text-xs text-slate-400 mt-1">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          </div>

          {/* Segments */}
          {segments.length > 0 && (
            <div className="mt-6">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-white">Segments</h4>
                <div className="flex gap-2">
                  <button onClick={selectAll} className="px-3 py-1 text-xs bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition">
                    All
                  </button>
                  <button onClick={clearAll} className="px-3 py-1 text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition">
                    Clear
                  </button>
                </div>
              </div>
            
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                {segments.map((seg, idx) => (
                  <button
                    key={idx}
                    onClick={() => toggleSegment(idx)}
                    className={`p-2 rounded-lg border-2 transition text-xs font-medium ${
                      seg.selected
                        ? 'bg-purple-600 border-purple-500 text-white'
                        : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    {formatTime(seg.start)}
                  </button>
                ))}
              </div>

              <div className="mt-3 text-sm text-slate-400">
                Selected: {formatTime(startTime)} - {formatTime(endTime)} ({formatTime(endTime - startTime)})
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-6 flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white font-semibold rounded-lg transition"
            >
              Cancel
            </button>
            <button
              onClick={handleClip}
              disabled={isLoading || duration === 0}
              className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 text-white font-semibold rounded-lg transition flex items-center justify-center gap-2"
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
