import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, Check, X, Scissors, ChevronDown, ChevronRight } from 'lucide-react';

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
  const [showSegmentPicker, setShowSegmentPicker] = useState(false);
  const [startMinInput, setStartMinInput] = useState('0');
  const [startSecInput, setStartSecInput] = useState('00');
  const [endMinInput, setEndMinInput] = useState('0');
  const [endSecInput, setEndSecInput] = useState('00');
  const [manualError, setManualError] = useState('');

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const toTimeParts = (seconds) => {
    const safeSeconds = Math.max(0, Math.floor(seconds || 0));
    return {
      minutes: String(Math.floor(safeSeconds / 60)),
      seconds: String(safeSeconds % 60).padStart(2, '0')
    };
  };

  const syncTimeInputs = (nextStart, nextEnd) => {
    const startParts = toTimeParts(nextStart);
    const endParts = toTimeParts(nextEnd);
    setStartMinInput(startParts.minutes);
    setStartSecInput(startParts.seconds);
    setEndMinInput(endParts.minutes);
    setEndSecInput(endParts.seconds);
  };

  const sanitizeNumberInput = (value, maxLength = 3) =>
    value.replace(/\D/g, '').slice(0, maxLength);

  const parseInputToSeconds = (minutesInput, secondsInput) => {
    const minutes = Number.parseInt(minutesInput, 10) || 0;
    const seconds = Number.parseInt(secondsInput, 10) || 0;
    return Math.max(0, (minutes * 60) + seconds);
  };

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
      syncTimeInputs(0, dur);
      
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

  useEffect(() => {
    if (!duration) return;
    syncTimeInputs(startTime, endTime);
  }, [startTime, endTime, duration]);

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

  const setRange = (nextStart, nextEnd, { clearSegmentSelection = false } = {}) => {
    if (!duration) return;
    const boundedStart = clamp(nextStart, 0, Math.max(duration - 1, 0));
    const boundedEnd = clamp(nextEnd, boundedStart + 1, duration);

    setStartTime(boundedStart);
    setEndTime(boundedEnd);
    setCurrentTime(boundedStart);
    setManualError('');

    const video = videoRef.current;
    if (video) {
      video.currentTime = boundedStart;
    }

    if (clearSegmentSelection) {
      setSegments((prev) => prev.map((seg) => ({ ...seg, selected: false })));
    }
  };

  const toggleSegment = (index) => {
    const newSegments = [...segments];
    newSegments[index].selected = !newSegments[index].selected;
    setSegments(newSegments);

    const selected = newSegments.filter(s => s.selected);
    if (selected.length > 0) {
      setRange(
        Math.min(...selected.map(s => s.start)),
        Math.max(...selected.map(s => s.end))
      );
    } else {
      setRange(0, duration);
    }
  };

  const selectAll = () => {
    setSegments(segments.map(s => ({ ...s, selected: true })));
    setRange(0, duration);
  };

  const clearAll = () => {
    setSegments(segments.map(s => ({ ...s, selected: false })));
    setRange(0, duration);
  };

  const applyManualRange = () => {
    if (!duration) return;
    const rawStart = parseInputToSeconds(startMinInput, startSecInput);
    const rawEnd = parseInputToSeconds(endMinInput, endSecInput);

    if (rawEnd <= rawStart) {
      setManualError('End time must be greater than start time.');
      return;
    }

    setRange(rawStart, rawEnd, { clearSegmentSelection: true });
  };

  const handleClip = async () => {
    try {
      if (!duration) return;
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

  const selectedCount = segments.filter((s) => s.selected).length;
  const canSubmit = duration > 0 && endTime > startTime;

  return (
    <div className="fixed inset-0 bg-black z-[9999] flex flex-col overscroll-none">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-pink-600 px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-2">
          <Scissors className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
          <h3 className="text-base sm:text-lg font-bold text-white">Trim</h3>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition active:scale-95"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Full Screen Video */}
      <div className="flex-1 bg-black relative min-h-0">
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
          type="button"
          onClick={togglePlayPause}
          className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-purple-600/85 hover:bg-purple-600 backdrop-blur-sm text-white flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-2xl"
        >
          {isPlaying ? <Pause className="w-7 h-7 sm:w-8 sm:h-8" /> : <Play className="w-7 h-7 sm:w-8 sm:h-8 ml-0.5" />}
        </button>

        {/* Time Display */}
        <div className="absolute top-3 left-1/2 transform -translate-x-1/2 bg-black/65 backdrop-blur-md px-3 py-1.5 rounded-full text-white text-xs sm:text-sm font-bold">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
      </div>

      {/* Controls Panel */}
      <div className="bg-gradient-to-br from-slate-900 to-black border-t border-purple-500/30 max-h-[48vh] overflow-y-auto">
        <div className="px-3 sm:px-4 py-3 space-y-3">
          <div className="bg-slate-800/70 rounded-xl border border-slate-700/70 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-purple-200">Range</span>
              <button
                type="button"
                onClick={applyManualRange}
                disabled={!duration}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold transition-all active:scale-95"
              >
                Apply
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-300">Start</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={startMinInput}
                    onChange={(e) => {
                      setStartMinInput(sanitizeNumberInput(e.target.value, 4));
                      setManualError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyManualRange();
                    }}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-600 bg-slate-900/80 px-2 py-2 text-sm font-semibold text-white text-center focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <span className="text-slate-400 font-bold">:</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={startSecInput}
                    onChange={(e) => {
                      setStartSecInput(sanitizeNumberInput(e.target.value, 3));
                      setManualError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyManualRange();
                    }}
                    placeholder="00"
                    className="w-full rounded-lg border border-slate-600 bg-slate-900/80 px-2 py-2 text-sm font-semibold text-white text-center focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-slate-300">End</label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={endMinInput}
                    onChange={(e) => {
                      setEndMinInput(sanitizeNumberInput(e.target.value, 4));
                      setManualError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyManualRange();
                    }}
                    placeholder="0"
                    className="w-full rounded-lg border border-slate-600 bg-slate-900/80 px-2 py-2 text-sm font-semibold text-white text-center focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                  <span className="text-slate-400 font-bold">:</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={endSecInput}
                    onChange={(e) => {
                      setEndSecInput(sanitizeNumberInput(e.target.value, 3));
                      setManualError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') applyManualRange();
                    }}
                    placeholder="00"
                    className="w-full rounded-lg border border-slate-600 bg-slate-900/80 px-2 py-2 text-sm font-semibold text-white text-center focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
            </div>
            {manualError && (
              <p className="text-[11px] font-semibold text-rose-300">{manualError}</p>
            )}
          </div>

          <div className="bg-slate-800/60 rounded-lg px-3 py-2">
            <div className="text-sm font-bold text-white">
              Selected: {' '}
              {formatTime(startTime)} - {formatTime(endTime)} ({formatTime(endTime - startTime)})
            </div>
            {selectedCount > 0 && (
              <div className="text-[11px] text-slate-400 mt-0.5">
                {selectedCount} segment{selectedCount === 1 ? '' : 's'}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-700/70 bg-slate-900/50 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowSegmentPicker((prev) => !prev)}
              className="w-full px-3 py-2.5 flex items-center justify-between text-left hover:bg-slate-800/60 transition-colors"
            >
              <span className="text-sm font-semibold text-slate-100">Segments (optional)</span>
              <span className="flex items-center gap-1 text-xs text-slate-300">
                {showSegmentPicker ? 'Hide' : 'Show'}
                {showSegmentPicker ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </span>
            </button>

            {showSegmentPicker && (
              <div className="px-3 pb-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-400">Tap blocks to trim quickly</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAll}
                      className="px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold transition-all active:scale-95"
                    >
                      All
                    </button>
                    <button
                      type="button"
                      onClick={clearAll}
                      className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold transition-all active:scale-95"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {segments.map((seg, idx) => (
                    <button
                      type="button"
                      key={idx}
                      onClick={() => toggleSegment(idx)}
                      className={`flex-shrink-0 min-w-[70px] px-3 py-2 rounded-lg font-bold text-xs sm:text-sm transition-all ${
                        seg.selected
                          ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/40'
                          : 'bg-slate-800/60 text-slate-300 hover:bg-slate-700 hover:text-white'
                      }`}
                    >
                      {formatTime(seg.start)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="sticky bottom-0 px-3 sm:px-4 pt-2 pb-[calc(4.5rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-black via-slate-900/95 to-slate-900/70 backdrop-blur-sm border-t border-slate-700/60">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              aria-label="Cancel trim"
              title="Cancel"
              className="w-8 h-8 rounded-lg bg-slate-700 hover:bg-slate-600 text-white transition-all flex items-center justify-center active:scale-95"
            >
              <X className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleClip}
              disabled={!canSubmit}
              aria-label="Done trimming"
              title="Done"
              className="w-8 h-8 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-all flex items-center justify-center shadow-lg shadow-purple-500/30 active:scale-95"
            >
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoClipper;
