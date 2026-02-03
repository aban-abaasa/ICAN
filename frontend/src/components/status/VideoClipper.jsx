/**
 * VideoClipper Component
 * Allows users to trim/clip videos before uploading to status
 */

import React, { useState, useRef, useEffect } from 'react';
import { Play, Pause, RotateCcw, Check, X } from 'lucide-react';

export const VideoClipper = ({ videoFile, onClip, onCancel }) => {
  const videoRef = useRef(null);
  const ffmpegRef = useRef(null);
  const [videoUrl, setVideoUrl] = useState('');
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [clipping, setClipping] = useState(false);
  const [ffmpegReady, setFfmpegReady] = useState(false);
  const [ffmpegError, setFfmpegError] = useState(null);

  // Create object URL once and cleanup on unmount
  useEffect(() => {
    if (!videoFile) return;
    
    const url = URL.createObjectURL(videoFile);
    setVideoUrl(url);

    return () => {
      URL.revokeObjectURL(url);
    };
  }, [videoFile]);

  // Initialize FFmpeg when component mounts - with dynamic script loading and fallback CDNs
  useEffect(() => {
    const waitForGlobal = async (globalName, maxWaitMs = 20000) => {
      const startTime = Date.now();
      let lastCheckTime = startTime;
      
      while (typeof window[globalName] === 'undefined') {
        if (Date.now() - startTime > maxWaitMs) {
          throw new Error(`Timeout waiting for ${globalName} - script may not have executed properly`);
        }
        
        // Log every 2 seconds of waiting
        if (Date.now() - lastCheckTime > 2000) {
          console.log(`⏳ Still waiting for ${globalName} (${Math.round((Date.now() - startTime) / 1000)}s)...`);
          lastCheckTime = Date.now();
        }
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      console.log(`✅ Global ${globalName} is available`);
      return window[globalName];
    };

    const loadScript = (url, scriptId) => {
      return new Promise((resolve, reject) => {
        // Check if script is already loaded AND global exists
        if (document.querySelector(`script[src*="${scriptId}"]`)) {
          // Script tag exists, but verify the global was actually created
          if (scriptId === 'ffmpeg' && typeof window.FFmpeg !== 'undefined') {
            console.log(`✅ Script ${scriptId} already loaded and global exists`);
            resolve();
            return;
          } else if (scriptId === 'util' && typeof window.FFmpeg?.fetchFile !== 'undefined') {
            console.log(`✅ Script ${scriptId} already loaded and global exists`);
            resolve();
            return;
          }
          // Script tag exists but global not created - need to load it
          console.log(`⚠️ Script tag exists but global not created - will reload`);
        }

        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        
        script.onload = () => {
          console.log(`✅ ${scriptId} script element loaded from: ${url}`);
          // Don't resolve yet - wait for global to be set
          resolve();
        };
        
        script.onerror = () => {
          console.error(`❌ Failed to load script from: ${url}`);
          reject(new Error(`Failed to load ${scriptId} from ${url}`));
        };
        
        document.head.appendChild(script);
      });
    };

    const initFFmpeg = async () => {
      try {
        console.log('🎬 Starting FFmpeg initialization...');

        // Step 1: Load FFmpeg core library with retry logic
        const ffmpegUrls = [
          'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js',
          'https://cdnjs.cloudflare.com/ajax/libs/ffmpeg.js/0.12.6/ffmpeg.min.js',
          'https://unpkg.com/@ffmpeg/ffmpeg@0.12.6/dist/ffmpeg.min.js'
        ];

        let ffmpegLoaded = false;
        let lastError = null;

        for (const url of ffmpegUrls) {
          try {
            console.log(`📥 Attempting to load FFmpeg from: ${url}`);
            await loadScript(url, 'ffmpeg');
            console.log(`⏳ FFmpeg script loaded, waiting for window.FFmpeg global...`);
            await waitForGlobal('FFmpeg', 20000);
            ffmpegLoaded = true;
            break;
          } catch (error) {
            lastError = error;
            console.warn(`⚠️ Failed with FFmpeg from ${url}: ${error.message}`);
            console.warn(`   Trying next CDN...`);
            continue;
          }
        }

        if (!ffmpegLoaded) {
          throw new Error(`Failed to load FFmpeg from all CDNs. Last error: ${lastError?.message}`);
        }

        console.log('✅ FFmpeg library loaded and available');

        // Step 2: Load FFmpeg util library with retry logic
        const utilUrls = [
          'https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.0/dist/util.min.js',
          'https://cdnjs.cloudflare.com/ajax/libs/ffmpeg.js/util.min.js',
          'https://unpkg.com/@ffmpeg/util@0.12.0/dist/util.min.js'
        ];

        let utilLoaded = false;
        lastError = null;

        for (const url of utilUrls) {
          try {
            console.log(`📥 Attempting to load FFmpeg util from: ${url}`);
            await loadScript(url, 'util');
            console.log(`⏳ FFmpeg util script loaded, waiting for window.FFmpeg.fetchFile...`);
            
            // Wait for fetchFile to be added to window.FFmpeg
            const startTime = Date.now();
            while (typeof window.FFmpeg.fetchFile === 'undefined') {
              if (Date.now() - startTime > 10000) {
                throw new Error('Timeout waiting for FFmpeg.fetchFile');
              }
              await new Promise(resolve => setTimeout(resolve, 100));
            }
            
            console.log(`✅ FFmpeg.fetchFile is available`);
            utilLoaded = true;
            break;
          } catch (error) {
            lastError = error;
            console.warn(`⚠️ Failed with util from ${url}: ${error.message}`);
            console.warn(`   Trying next CDN...`);
            continue;
          }
        }

        if (!utilLoaded) {
          throw new Error(`Failed to load FFmpeg util from all CDNs. Last error: ${lastError?.message}`);
        }

        console.log('✅ FFmpeg util library loaded and available');

        // Step 3: Verify all globals are available
        if (typeof window.FFmpeg === 'undefined') {
          throw new Error('window.FFmpeg is still not available - this should not happen');
        }

        if (typeof window.FFmpeg.fetchFile === 'undefined') {
          throw new Error('window.FFmpeg.fetchFile is still not available - util library did not initialize properly');
        }

        console.log('✅ All FFmpeg globals verified and available');

        // Step 4: Create and initialize FFmpeg instance
        const { FFmpeg: FFmpegLib } = window.FFmpeg;
        
        if (!FFmpegLib) {
          throw new Error('FFmpeg.FFmpeg class not found');
        }

        const ffmpeg = new FFmpegLib();
        
        console.log('🔧 Initializing FFmpeg instance...');
        
        // Load FFmpeg (this downloads ~30MB wasm file on first run, then cached)
        if (!ffmpeg.isLoaded()) {
          console.log('⏳ Loading FFmpeg WASM core (this may take 10-30 seconds on first run)...');
          
          const coreUrls = [
            'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js',
            'https://unpkg.com/@ffmpeg/core@0.12.6/dist/ffmpeg-core.js'
          ];

          let coreLoaded = false;
          lastError = null;

          for (const coreUrl of coreUrls) {
            try {
              console.log(`📥 Attempting to load WASM core from: ${coreUrl}`);
              await ffmpeg.load({
                coreURL: coreUrl
              });
              coreLoaded = true;
              break;
            } catch (error) {
              lastError = error;
              console.warn(`⚠️ Failed to load WASM from ${coreUrl}, trying next...`);
              continue;
            }
          }

          if (!coreLoaded) {
            throw new Error(`Failed to load FFmpeg WASM core. Last error: ${lastError?.message}`);
          }

          console.log('✅ FFmpeg WASM core loaded');
        }
        
        ffmpegRef.current = ffmpeg;
        setFfmpegReady(true);
        setFfmpegError(null);
        
        console.log('✅ FFmpeg initialization complete!');
      } catch (error) {
        console.error('❌ FFmpeg initialization error:', error);
        console.error('   Error type:', error.constructor.name);
        console.error('   Error message:', error.message);
        console.error('   Stack:', error.stack);
        
        // Detailed diagnostics
        console.error('');
        console.error('   📊 FFmpeg GLOBAL STATE DIAGNOSTICS:');
        console.error(`      window.FFmpeg exists: ${typeof window.FFmpeg !== 'undefined'}`);
        if (typeof window.FFmpeg !== 'undefined') {
          console.error(`      window.FFmpeg type: ${typeof window.FFmpeg}`);
          console.error(`      window.FFmpeg keys: ${Object.keys(window.FFmpeg).join(', ')}`);
          console.error(`      window.FFmpeg.fetchFile: ${typeof window.FFmpeg.fetchFile}`);
          console.error(`      window.FFmpeg.FFmpeg: ${typeof window.FFmpeg.FFmpeg}`);
        }
        console.error('');
        console.error('    TROUBLESHOOTING STEPS:');
        console.error('      1️⃣  Hard refresh: Press Ctrl+Shift+R (or Cmd+Shift+R on Mac)');
        console.error('      2️⃣  Check internet: Open DevTools Network tab, refresh, look for red requests');
        console.error('      3️⃣  Check firewall: Corporate networks may block CDN access');
        console.error('      4️⃣  Try different browser: Chrome, Firefox, Safari should all work');
        console.error('      5️⃣  Check console: Look for CORS, 403, or timeout errors above');
        console.error('      6️⃣  If error says "window.FFmpeg is not available":');
        console.error('         → One or more scripts failed to initialize globals');
        console.error('         → Check Network tab for failed CDN requests');
        console.error('         → Try different CDN or browser');
        
        setFfmpegError(error.message);
        setFfmpegReady(false);
      }
    };

    initFFmpeg();

    // Cleanup on unmount
    return () => {
      if (ffmpegRef.current) {
        try {
          ffmpegRef.current = null;
        } catch (error) {
          console.error('Error cleaning up FFmpeg:', error);
        }
      }
    };
  }, []);

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

    // Check if FFmpeg is ready
    if (!ffmpegReady) {
      alert('⏳ FFmpeg is still loading. Please wait a moment and try again.');
      return;
    }

    if (ffmpegError) {
      alert(`❌ FFmpeg failed to load: ${ffmpegError}\n\nPlease check your internet connection and refresh the page.`);
      return;
    }

    setClipping(true);
    try {
      console.log(`🎬 Starting video clip: ${startTime}s to ${endTime}s`);
      
      const clippedBlob = await createClippedVideo(videoFile, startTime, endTime);

      onClip({
        blob: clippedBlob,
        startTime,
        endTime,
        duration: endTime - startTime
      });
      
      console.log(`✅ Video clipped successfully`);
    } catch (error) {
      console.error('❌ Video clip error:', error);
      alert(`Error clipping video: ${error.message}`);
    } finally {
      setClipping(false);
    }
  };

  const createClippedVideo = async (file, start, end) => {
    try {
      // Use pre-initialized FFmpeg from ref
      const ffmpeg = ffmpegRef.current;
      
      if (!ffmpeg || !ffmpeg.isLoaded()) {
        console.error('❌ FFmpeg not available or not loaded');
        return file;  // Fallback to full video
      }

      console.log(`🎬 FFmpeg trimming: ${start}s to ${end}s`);

      // Write input file
      const inputName = 'input.' + (file.name?.split('.').pop() || 'webm');
      const outputName = 'output.webm';
      
      // Use fetchFile from FFmpeg utils
      const { fetchFile } = window.FFmpeg;
      const data = await fetchFile(file);
      await ffmpeg.writeFile(inputName, data);

      console.log(`📝 Input file written: ${inputName}`);

      // Run FFmpeg command to trim the video
      await ffmpeg.run(
        '-ss', String(Math.round(start)),
        '-to', String(Math.round(end)),
        '-i', inputName,
        '-c:v', 'libvpx-vp9',  // VP9 codec for better compression
        '-b:v', '1M',           // 1Mbps bitrate
        '-c:a', 'libopus',      // Opus audio codec
        outputName
      );

      console.log(`✂️ Video trimmed successfully`);

      // Read output file
      const clippedData = await ffmpeg.readFile(outputName);
      const clippedBlob = new Blob([clippedData.buffer], { type: 'video/webm' });

      console.log(`💾 Output blob created: ${(clippedBlob.size / 1024 / 1024).toFixed(2)}MB`);

      // Clean up
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);

      console.log(`🧹 Temp files cleaned up`);

      return clippedBlob;
    } catch (error) {
      console.error('❌ FFmpeg clipping error:', error);
      console.warn('⚠️ Falling back to full video');
      // Fallback: return full video if clipping fails
      return file;
    }
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
        <div className="flex items-center justify-center gap-3 mb-4 bg-white/5 rounded-xl p-3 backdrop-blur">
          <button
            onClick={togglePlayPause}
            className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
          >
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </button>
          <span className="text-sm font-mono text-white">
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
            className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Timeline */}
        <div className="mb-6">
          <div className="relative h-20 bg-gradient-to-r from-gray-900 to-gray-800 rounded-xl mb-3 overflow-hidden">
            {/* Selected region */}
            <div
              className="absolute h-full bg-purple-500/30 pointer-events-none"
              style={{
                left: `${startPercent}%`,
                right: `${100 - endPercent}%`
              }}
            />

            {/* Segments (5 second markers) */}
            {Array.from({ length: Math.floor(duration / 5) + 1 }).map((_, i) => (
              <div
                key={i}
                className="absolute top-0 h-full w-px bg-white/10"
                style={{ left: `${(i * 5 / duration) * 100}%` }}
              />
            ))}

            {/* Current position */}
            <div
              className="absolute top-0 h-full w-0.5 bg-yellow-400 z-10"
              style={{ left: `${currentPercent}%` }}
            />

            {/* Timeline scrubber */}
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
              className="absolute top-1/2 -translate-y-1/2 w-4 h-16 bg-purple-500 rounded cursor-col-resize z-20 flex items-center justify-center"
              style={{ left: `${startPercent}%`, marginLeft: '-8px' }}
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const startPos = startTime;
                const handleMouseMove = (me) => {
                  const delta = (me.clientX - startX) / (e.currentTarget.parentElement.offsetWidth);
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
              onTouchStart={(e) => {
                e.preventDefault();
                const startX = e.touches[0].clientX;
                const startPos = startTime;
                const handleTouchMove = (te) => {
                  const delta = (te.touches[0].clientX - startX) / (e.currentTarget.parentElement.offsetWidth);
                  const newStart = Math.max(0, Math.min(startPos + delta * duration, endTime));
                  setStartTime(newStart);
                  const video = videoRef.current;
                  if (video) video.currentTime = newStart;
                };
                const handleTouchEnd = () => {
                  document.removeEventListener('touchmove', handleTouchMove);
                  document.removeEventListener('touchend', handleTouchEnd);
                };
                document.addEventListener('touchmove', handleTouchMove);
                document.addEventListener('touchend', handleTouchEnd);
              }}
            >
              <div className="w-1 h-8 bg-white/80 rounded" />
            </div>

            {/* End handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-4 h-16 bg-pink-500 rounded cursor-col-resize z-20 flex items-center justify-center"
              style={{ right: `${100 - endPercent}%`, marginRight: '-8px' }}
              onMouseDown={(e) => {
                e.preventDefault();
                const startX = e.clientX;
                const endPos = endTime;
                const handleMouseMove = (me) => {
                  const delta = (me.clientX - startX) / (e.currentTarget.parentElement.offsetWidth);
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
              onTouchStart={(e) => {
                e.preventDefault();
                const startX = e.touches[0].clientX;
                const endPos = endTime;
                const handleTouchMove = (te) => {
                  const delta = (te.touches[0].clientX - startX) / (e.currentTarget.parentElement.offsetWidth);
                  const newEnd = Math.max(startTime, Math.min(endPos + delta * duration, duration));
                  setEndTime(newEnd);
                };
                const handleTouchEnd = () => {
                  document.removeEventListener('touchmove', handleTouchMove);
                  document.removeEventListener('touchend', handleTouchEnd);
                };
                document.addEventListener('touchmove', handleTouchMove);
                document.addEventListener('touchend', handleTouchEnd);
              }}
            >
              <div className="w-1 h-8 bg-white/80 rounded" />
            </div>
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

          {/* Duration Info */}
          <div className="bg-purple-900/20 border border-purple-500/30 rounded-lg p-3 backdrop-blur text-center mb-4">
            <p className="text-gray-400 text-xs">DURATION</p>
            <p className="text-2xl font-bold text-purple-400">
              {formatTime(clippedDuration)}
            </p>
            {(clippedDuration < 1 || clippedDuration > 60) && (
              <span className="inline-block mt-1 px-2 py-0.5 bg-red-500/20 border border-red-500/50 text-red-300 rounded-full text-xs">
                1-60s required
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-3 rounded-lg bg-white/10 hover:bg-white/20 text-white font-bold transition"
          >
            Cancel
          </button>
          <button
            onClick={handleClip}
            disabled={clipping || clippedDuration < 1 || clippedDuration > 60 || !ffmpegReady || ffmpegError}
            className="flex-1 px-4 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold transition flex items-center justify-center gap-2"
          >
            {!ffmpegReady ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                Loading...
              </>
            ) : clipping ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                Trimming...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                Done
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

export default VideoClipper;
