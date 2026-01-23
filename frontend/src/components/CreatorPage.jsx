import React, { useState } from 'react';
import { X, Camera, Smartphone, Download, Radio } from 'lucide-react';
import PitchVideoRecorder from './PitchVideoRecorder';
import PitchDetailsForm from './PitchDetailsForm';

const CreatorPage = ({ onClose, onPitchCreated }) => {
  const [cameraMode, setCameraMode] = useState('front'); // 'front' or 'back'
  const [recordingMethod, setRecordingMethod] = useState('record'); // 'record' or 'upload'
  const [showDetailsForm, setShowDetailsForm] = useState(false);

  const handlePitchSubmit = (formData) => {
    console.log('Pitch submitted:', formData);
    // Here you would typically send the data to your backend
    setShowDetailsForm(false);
    if (onPitchCreated) {
      onPitchCreated(formData);
    }
  };

  return (
    <div className="fixed inset-0 w-screen h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 z-[9999] flex flex-col">
      {/* Header - Ultra Compact on Mobile */}
      <div className="flex-shrink-0 bg-slate-900/90 backdrop-blur-md border-b border-pink-500/30">
        <div className="w-full px-2 py-1 flex items-center justify-between gap-1">
          <button
            onClick={onClose}
            className="flex-shrink-0 p-1 hover:bg-white/10 rounded-lg transition"
          >
            <X className="w-4 h-4 text-white" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-sm font-bold text-white truncate">Create Pitch</h1>
          </div>
          <div className="text-lg flex-shrink-0">🚀</div>
        </div>
      </div>

      {/* Camera & Recording Mode Selector - Compact Horizontal Bar */}
      <div className="flex-shrink-0 flex items-center justify-center gap-2 px-3 py-2 bg-slate-800/80 border-b border-pink-500/30">
        {/* Camera Selection */}
        <button
          onClick={() => setCameraMode('front')}
          title="Front Camera"
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-all border-2 text-sm flex-shrink-0 ${
            cameraMode === 'front'
              ? 'border-pink-500 bg-pink-500/50 text-pink-200'
              : 'border-white/30 bg-white/10 text-gray-300 hover:border-pink-500/50'
          }`}
        >
          📱
        </button>
        <button
          onClick={() => setCameraMode('back')}
          title="Back Camera"
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-all border-2 text-sm flex-shrink-0 ${
            cameraMode === 'back'
              ? 'border-purple-500 bg-purple-500/50 text-purple-200'
              : 'border-white/30 bg-white/10 text-gray-300 hover:border-purple-500/50'
          }`}
        >
          📸
        </button>

        {/* Separator */}
        <div className="w-px h-5 bg-white/20 flex-shrink-0"></div>

        {/* Recording Method Selection */}
        <button
          onClick={() => setRecordingMethod('record')}
          title="Record Live"
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-all border-2 text-sm flex-shrink-0 ${
            recordingMethod === 'record'
              ? 'border-pink-500 bg-pink-500/50 text-pink-200'
              : 'border-white/30 bg-white/10 text-gray-300 hover:border-pink-500/50'
          }`}
        >
          🎥
        </button>
        <button
          onClick={() => setRecordingMethod('upload')}
          title="Upload Video"
          className={`w-7 h-7 rounded-md flex items-center justify-center transition-all border-2 text-sm flex-shrink-0 ${
            recordingMethod === 'upload'
              ? 'border-purple-500 bg-purple-500/50 text-purple-200'
              : 'border-white/30 bg-white/10 text-gray-300 hover:border-purple-500/50'
          }`}
        >
          📤
        </button>
      </div>

      {/* Recorder Component - Full remaining space */}
      <div className="flex-1 bg-slate-900 overflow-hidden border-t border-pink-500/30 flex flex-col relative">
        <PitchVideoRecorder 
          cameraMode={cameraMode}
          recordingMethod={recordingMethod}
          hideControls={true}
          onPitchCreated={onPitchCreated}
          onClose={onClose}
        />
        
        {/* Submit Button - Floating on Video */}
        <button
          onClick={() => setShowDetailsForm(true)}
          className="absolute bottom-4 right-4 px-4 py-2 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-bold rounded-lg transition flex items-center gap-2 shadow-lg"
        >
          <span>🚀</span>
          <span className="hidden sm:inline">Submit</span>
        </button>
      </div>

      {/* Pitch Details Form - Dropdown Modal */}
      <PitchDetailsForm 
        isOpen={showDetailsForm}
        onClose={() => setShowDetailsForm(false)}
        onSubmit={handlePitchSubmit}
      />
    </div>
  );
};

export default CreatorPage;
