import React, { useState, useRef, useEffect } from 'react';
import { Camera, Mic, Square, Play, Upload, X } from 'lucide-react';
import { uploadVideo } from '../services/pitchingService';

const PitchVideoRecorder = ({ onPitchCreated }) => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const animationFrameRef = useRef(null);
  const streamRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedChunks, setRecordedChunks] = useState([]);
  const [videoBlob, setVideoBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    creator: '',
    category: 'Technology',
    raised: '$0',
    goal: '$500K',
    equity: '10%',
    pitchType: 'Equity',
    hasIP: false,
    members: []
  });

  const startRecording = async () => {
    try {
      console.log('Requesting camera permissions...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          facingMode: 'user'
        },
        audio: true
      });

      console.log('Camera stream obtained:', stream);
      console.log('Video tracks:', stream.getVideoTracks());

      streamRef.current = stream;

      // Set up canvas rendering as fallback
      if (canvasRef.current) {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        console.log('Canvas context obtained:', ctx);
        
        // Set canvas dimensions to match video
        canvas.width = 1280;
        canvas.height = 720;
        console.log('Canvas dimensions set to:', canvas.width, 'x', canvas.height);
        
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          
          // Draw video frames to canvas
          const drawFrame = () => {
            // Clear canvas first
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Try to draw video frame - drawImage handles not-ready videos gracefully
            try {
              if (videoRef.current) {
                ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
              }
            } catch (e) {
              // Silently handle drawImage errors when video isn't ready
            }
            animationFrameRef.current = requestAnimationFrame(drawFrame);
          };
          
          videoRef.current.onplay = () => {
            console.log('Video element play event fired');
            // Canvas dimensions already set above, just start drawing
            if (videoRef.current) {
              drawFrame();
              setIsRecording(true);
            }
          };

          videoRef.current.onerror = (e) => {
            console.error('Video element error:', e);
          };

          // Try to play
          videoRef.current.play().catch(err => {
            console.error('Play error:', err);
            // Still try to record if play fails
            setIsRecording(true);
          });
        }
      }

      // Use a MIME type with better browser support
      // Try MP4 first, then WebM as fallback
      let mimeType = 'video/webm';
      const supportedTypes = [
        'video/mp4;codecs=h264',
        'video/mp4;codecs=avc1',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm'
      ];
      
      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type;
          break;
        }
      }
      
      console.log('🎥 Using MIME type:', mimeType);
      const mediaRecorder = new MediaRecorder(stream, { mimeType });

      const chunks = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        console.log('MediaRecorder stopped, creating blob...');
        const blob = new Blob(chunks, { type: mimeType });
        console.log('Blob created:', blob.size, 'bytes');
        const url = URL.createObjectURL(blob);
        console.log('Preview URL created:', url);
        setVideoBlob(blob);
        setPreviewUrl(url);
        setRecordedChunks(chunks);
        console.log('Preview state updated');
        
        // Stop animation frame
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          console.log('Animation frame cancelled');
        }
        
        // Stop all tracks
        stream.getTracks().forEach(track => {
          track.stop();
          console.log('Track stopped:', track.kind);
        });
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      console.log('Recording started');
    } catch (error) {
      console.error('Error accessing camera:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      alert(`Unable to access camera: ${error.message}. Please check permissions and try again.`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleUploadVideo = (e) => {
    const file = e.target.files[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      setVideoBlob(file);
      setRecordedChunks([file]);
    }
  };

  const handleAddMember = (memberName) => {
    if (memberName.trim() && !formData.members.includes(memberName.trim())) {
      setFormData({
        ...formData,
        members: [...formData.members, memberName.trim()]
      });
    }
  };

  const handleRemoveMember = (memberName) => {
    setFormData({
      ...formData,
      members: formData.members.filter(m => m !== memberName)
    });
  };

  const handleSubmit = async () => {
    if (!videoBlob || !formData.title || !formData.description || !formData.creator) {
      setSubmitError('Please fill in all required fields and record/upload a video');
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError(null);
      console.log('Submitting pitch with data:', {
        title: formData.title,
        creator: formData.creator,
        videoBlob: videoBlob ? `${videoBlob.size} bytes` : 'missing'
      });

      const pitchData = {
        ...formData,
        videoBlob: videoBlob,
        category: formData.category,
        timestamp: 'just now'
      };

      console.log('Calling onPitchCreated...');
      await onPitchCreated(pitchData);
      
      console.log('Pitch created successfully');
      setSubmitSuccess(true);
      
      // Show success message for 2 seconds then close
      setTimeout(() => {
        setSubmitSuccess(false);
      }, 2000);
    } catch (error) {
      console.error('Error submitting pitch:', error);
      setSubmitError(error.message || 'Failed to create pitch');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="bg-slate-800 rounded-2xl p-8 border border-slate-700">
        <h2 className="text-3xl font-bold text-white mb-6">
          Create Your Professional Pitch
        </h2>
        <p className="text-slate-400 mb-8">
          Record a 3-minute professional pitch video. Be clear, compelling, and creative!
        </p>

        {/* Video Preview/Recording */}
        <div className="mb-8">
          <div style={{
            backgroundColor: '#000',
            borderRadius: '0.75rem',
            overflow: 'hidden',
            aspectRatio: '16 / 9',
            marginBottom: '1rem',
            position: 'relative',
            width: '100%'
          }}>
            {!previewUrl ? (
              <>
                {/* Hidden video element for stream capture */}
                <video
                  ref={videoRef}
                  style={{
                    display: 'none'
                  }}
                  autoPlay
                  playsInline
                  muted
                />
                {/* Canvas for displaying video stream */}
                <canvas
                  ref={canvasRef}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    display: 'block',
                    backgroundColor: '#000'
                  }}
                />
                {!isRecording && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    pointerEvents: 'none',
                    zIndex: 10
                  }}>
                    <Camera className="w-16 h-16 text-slate-300 mb-4" />
                    <p style={{ color: '#e2e8f0', fontSize: '1.125rem', fontWeight: '600' }}>Click "Start Recording" to begin</p>
                    <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginTop: '0.5rem' }}>If video doesn't appear, check camera permissions</p>
                  </div>
                )}
              </>
            ) : (
              <>
                {console.log('Rendering preview video with URL:', previewUrl)}
                <video
                  src={previewUrl}
                  controls
                  autoPlay
                  playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  backgroundColor: '#000',
                  display: 'block'
                }}
                />
              </>
            )}
          </div>

          {/* Controls */}
          <div className="flex gap-4 mb-6">
            {!previewUrl ? (
              <>
                <button
                  onClick={startRecording}
                  disabled={isRecording}
                  className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-slate-600 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition"
                >
                  <Camera className="w-5 h-5" />
                  {isRecording ? 'Recording...' : 'Start Recording'}
                </button>
                {isRecording && (
                  <button
                    onClick={stopRecording}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition"
                  >
                    <Square className="w-5 h-5" />
                    Stop Recording
                  </button>
                )}
                <label className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition cursor-pointer">
                  <Upload className="w-5 h-5" />
                  Upload Video
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleUploadVideo}
                    className="hidden"
                  />
                </label>
              </>
            ) : (
              <button
                onClick={() => setPreviewUrl(null)}
                className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 rounded-lg font-semibold flex items-center justify-center gap-2 transition"
              >
                <X className="w-5 h-5" />
                Re-record
              </button>
            )}
          </div>
        </div>

        {/* Form Fields */}
        <div className="space-y-4">
          {/* Title */}
          <div>
            <label className="block text-slate-300 font-semibold mb-2">
              Pitch Title *
            </label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="e.g., AI-Powered Supply Chain Platform"
              className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-purple-500 focus:outline-none"
            />
          </div>

          {/* Creator Name */}
          <div>
            <label className="block text-slate-300 font-semibold mb-2">
              Creator/Company Name *
            </label>
            <input
              type="text"
              value={formData.creator}
              onChange={(e) => setFormData({ ...formData, creator: e.target.value })}
              placeholder="Your name or company"
              className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-purple-500 focus:outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-slate-300 font-semibold mb-2">
              Pitch Description *
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="Describe your idea, business model, and what you're seeking..."
              rows={4}
              className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-purple-500 focus:outline-none"
            />
          </div>

          {/* Grid: Category, Pitch Type */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-slate-300 font-semibold mb-2">
                Category
              </label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-purple-500 focus:outline-none"
              >
                <option>Technology</option>
                <option>Healthcare</option>
                <option>Finance</option>
                <option>Agriculture</option>
                <option>Education</option>
                <option>Sustainability</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-2">
                Pitch Type
              </label>
              <select
                value={formData.pitchType}
                onChange={(e) => setFormData({ ...formData, pitchType: e.target.value })}
                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-purple-500 focus:outline-none"
              >
                <option>Equity</option>
                <option>Partnership</option>
                <option>Debt</option>
                <option>Grant</option>
              </select>
            </div>
          </div>

          {/* Grid: Funding Details */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-slate-300 font-semibold mb-2">
                Target Goal
              </label>
              <input
                type="text"
                value={formData.goal}
                onChange={(e) => setFormData({ ...formData, goal: e.target.value })}
                placeholder="$500K"
                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-2">
                Equity Offering
              </label>
              <input
                type="text"
                value={formData.equity}
                onChange={(e) => setFormData({ ...formData, equity: e.target.value })}
                placeholder="10%"
                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-2">
                Currently Raised
              </label>
              <input
                type="text"
                value={formData.raised}
                onChange={(e) => setFormData({ ...formData, raised: e.target.value })}
                placeholder="$0"
                className="w-full bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-purple-500 focus:outline-none"
              />
            </div>
          </div>

          {/* IP Checkbox */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={formData.hasIP}
              onChange={(e) => setFormData({ ...formData, hasIP: e.target.checked })}
              className="w-5 h-5 rounded border-slate-600 cursor-pointer"
            />
            <label className="text-slate-300 font-semibold cursor-pointer">
              This pitch includes Intellectual Property (IP)
            </label>
          </div>

          {/* Team Members */}
          <div>
            <label className="block text-slate-300 font-semibold mb-2">
              Team Members
            </label>
            <div className="flex gap-2 mb-2">
              <input
                type="text"
                id="memberInput"
                placeholder="Add team member name"
                className="flex-1 bg-slate-700 text-white rounded-lg px-4 py-2 border border-slate-600 focus:border-purple-500 focus:outline-none"
              />
              <button
                onClick={() => {
                  const input = document.getElementById('memberInput');
                  handleAddMember(input.value);
                  input.value = '';
                }}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-semibold transition"
              >
                Add
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {formData.members.map((member, idx) => (
                <div
                  key={idx}
                  className="bg-purple-600/30 text-purple-300 px-3 py-1 rounded-full text-sm flex items-center gap-2 border border-purple-500/50"
                >
                  {member}
                  <button
                    onClick={() => handleRemoveMember(member)}
                    className="hover:text-purple-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Error Message */}
          {submitError && (
            <div style={{
              backgroundColor: '#dc2626',
              color: 'white',
              padding: '1rem',
              borderRadius: '0.5rem',
              marginBottom: '1rem'
            }}>
              {submitError}
            </div>
          )}

          {/* Success Message */}
          {submitSuccess && (
            <div style={{
              backgroundColor: '#10b981',
              color: 'white',
              padding: '1rem',
              borderRadius: '0.5rem',
              marginBottom: '1rem',
              textAlign: 'center'
            }}>
              ✅ Pitch created successfully! Redirecting...
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className={`w-full py-3 rounded-lg font-bold text-lg transition shadow-lg ${
              isSubmitting
                ? 'bg-slate-600 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white hover:shadow-purple-500/50'
            }`}
          >
            {isSubmitting ? 'Launching...' : 'Launch Your Pitch'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PitchVideoRecorder;
