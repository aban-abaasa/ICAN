/**
 * Media Quality Selector Component
 * Shows compression preview like WhatsApp
 * Allows user to choose quality vs size tradeoff
 */

import React, { useState, useEffect } from 'react';
import { Zap, Gauge, Eye } from 'lucide-react';
import { compressImage, getVideoCompressionInfo, formatFileSize } from '../../services/mediaOptimizationService';

export const MediaQualitySelector = ({ file, onQualitySelected, onCancel }) => {
  const [loading, setLoading] = useState(true);
  const [selectedQuality, setSelectedQuality] = useState('balanced');
  const [compressionInfo, setCompressionInfo] = useState(null);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    const loadCompressionInfo = async () => {
      try {
        if (file.type.startsWith('image')) {
          const info = await compressImage(file);
          setCompressionInfo({
            type: 'image',
            original: info.originalSize,
            compressed: info.compressedSize,
            ratio: info.compressionRatio,
            details: `${info.dimensions.width}x${info.dimensions.height}px`
          });
          
          // Create preview
          const reader = new FileReader();
          reader.onload = (e) => setPreview(e.target.result);
          reader.readAsDataURL(info.blob);
        } else {
          const info = await getVideoCompressionInfo(file);
          setCompressionInfo({
            type: 'video',
            original: info.videoInfo.originalSize,
            compressed: info.recommendations.estimatedSize,
            ratio: info.recommendations.estimatedCompressionRatio,
            details: `${info.videoInfo.currentResolution} → ${info.recommendations.resolution}`,
            duration: info.videoInfo.duration,
            bitrate: info.recommendations.bitrate
          });
        }
      } catch (error) {
        console.error('Failed to load compression info:', error);
      } finally {
        setLoading(false);
      }
    };

    loadCompressionInfo();
  }, [file]);

  const qualityOptions = [
    {
      id: 'high',
      name: 'High Quality',
      description: 'Larger file, best visual quality',
      compression: 30,
      icon: '🎬',
      color: 'from-blue-500 to-cyan-500'
    },
    {
      id: 'balanced',
      name: 'Balanced',
      description: 'WhatsApp recommended - great quality, smaller size',
      compression: 60,
      icon: '⚡',
      color: 'from-purple-500 to-pink-500',
      recommended: true
    },
    {
      id: 'compact',
      name: 'Compact',
      description: 'Small file, still good quality for mobile',
      compression: 80,
      icon: '📦',
      color: 'from-orange-500 to-red-500'
    }
  ];

  const handleSelect = () => {
    onQualitySelected({
      quality: selectedQuality,
      compressionInfo
    });
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-b from-black/80 to-black/90 backdrop-blur-lg flex items-center justify-center z-50">
      <style>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .quality-selector {
          animation: slideDown 0.4s ease-out;
        }
        .quality-card {
          transition: all 0.3s ease;
        }
        .quality-card:hover {
          transform: translateY(-4px);
        }
        .quality-card.selected {
          ring: 2px;
        }
      `}</style>

      <div className="quality-selector bg-gradient-to-br from-gray-900 via-gray-800 to-black rounded-2xl shadow-2xl p-8 max-w-2xl w-full mx-4 border border-purple-500/20">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-600">
            Media Quality
          </h2>
          <p className="text-gray-400 text-sm mt-2">
            Choose quality vs file size - optimized like WhatsApp
          </p>
        </div>

        {/* File Info */}
        {compressionInfo && (
          <div className="mb-8 bg-gray-800/50 rounded-lg p-4 backdrop-blur">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">FILE TYPE</p>
                <p className="text-lg font-bold text-white capitalize">
                  {compressionInfo.type === 'image' ? '📸 Image' : '🎥 Video'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">ORIGINAL SIZE</p>
                <p className="text-lg font-bold text-white">
                  {compressionInfo.original > 1024 
                    ? `${(compressionInfo.original / 1024 / 1024).toFixed(1)}MB`
                    : `${(compressionInfo.original / 1024).toFixed(1)}KB`}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 uppercase tracking-wider">DETAILS</p>
                <p className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                  {compressionInfo.details}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Quality Options */}
        <div className="space-y-3 mb-8">
          {qualityOptions.map((option) => {
            const estimatedSize = compressionInfo 
              ? (compressionInfo.original * (100 - option.compression) / 100) / 1024 / 1024
              : 0;
            const savings = Math.round(option.compression);

            return (
              <button
                key={option.id}
                onClick={() => setSelectedQuality(option.id)}
                className={`quality-card w-full p-4 rounded-lg border-2 transition ${
                  selectedQuality === option.id
                    ? `border-purple-500 bg-purple-500/10`
                    : 'border-gray-700 bg-gray-800/30 hover:border-gray-600'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-4 flex-1">
                    <div className="text-3xl">{option.icon}</div>
                    <div className="text-left flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-bold text-white">{option.name}</h3>
                        {option.recommended && (
                          <span className="px-2 py-1 bg-purple-500/20 border border-purple-500/50 text-purple-300 text-xs rounded-full font-bold">
                            RECOMMENDED
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-400 mt-1">{option.description}</p>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm text-gray-400">Est. Size</p>
                    <p className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-400">
                      {estimatedSize.toFixed(1)}MB
                    </p>
                    <p className="text-xs text-green-400 font-bold mt-1">
                      💾 {savings}% smaller
                    </p>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="mt-3 h-1 bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${option.color} transition-all duration-300`}
                    style={{ width: `${option.compression}%` }}
                  />
                </div>
              </button>
            );
          })}
        </div>

        {/* Quality Guide */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-center">
            <p className="text-2xl">📱</p>
            <p className="text-xs text-blue-300 font-bold mt-1">Mobile Share</p>
            <p className="text-xs text-gray-400">Fast upload</p>
          </div>
          <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-3 text-center">
            <p className="text-2xl">⚖️</p>
            <p className="text-xs text-purple-300 font-bold mt-1">Balanced</p>
            <p className="text-xs text-gray-400">Best choice</p>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-center">
            <p className="text-2xl">🎬</p>
            <p className="text-xs text-amber-300 font-bold mt-1">Archive</p>
            <p className="text-xs text-gray-400">Full quality</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 px-4 py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-bold transition"
          >
            CANCEL
          </button>
          <button
            onClick={handleSelect}
            disabled={loading}
            className="flex-1 px-4 py-3 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 disabled:opacity-50 text-white font-bold transition flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                ANALYZING...
              </>
            ) : (
              <>
                <Zap className="w-5 h-5" />
                CONTINUE
              </>
            )}
          </button>
        </div>

        {/* Info Footer */}
        <p className="text-xs text-gray-500 text-center mt-4">
          💡 We auto-compress videos server-side after upload for best quality-to-size ratio
        </p>
      </div>
    </div>
  );
};

export default MediaQualitySelector;
