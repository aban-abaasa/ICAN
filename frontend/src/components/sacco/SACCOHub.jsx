/**
 * SACCOHub Component - Main SACCO Management Interface
 * Creative WhatsApp-style UI for savings group management
 */

import React, { useState, useEffect } from 'react'
import { Plus, Users, TrendingUp, Lock, Eye, EyeOff } from 'lucide-react'
import SACCOList from './SACCOList'
import SACCOCreate from './SACCOCreate'
import MySACCOs from './MySACCOs'
import SACCODetails from './SACCODetails'

export default function SACCOHub() {
  const [activeTab, setActiveTab] = useState('explore') // explore, my-saccos, create
  const [selectedSacco, setSelectedSacco] = useState(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header with gradient */}
      <div className="sticky top-0 z-40 backdrop-blur-xl bg-black/40 border-b border-emerald-500/20">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600">
                <Users className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white">SACCO Hub</h1>
                <p className="text-xs text-emerald-400">Cooperative Savings & Lending</p>
              </div>
            </div>
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-medium hover:shadow-lg hover:shadow-emerald-500/50 transition-all active:scale-95"
            >
              <Plus className="w-5 h-5" />
              Start SACCO
            </button>
          </div>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="sticky top-16 z-30 backdrop-blur-xl bg-black/40 border-b border-slate-700/50">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex gap-8">
            <button
              onClick={() => {
                setActiveTab('explore')
                setSelectedSacco(null)
              }}
              className={`px-4 py-3 font-medium text-sm border-b-2 transition-all ${
                activeTab === 'explore'
                  ? 'text-emerald-400 border-emerald-400'
                  : 'text-slate-400 border-transparent hover:text-slate-300'
              }`}
            >
              Explore
            </button>
            <button
              onClick={() => {
                setActiveTab('my-saccos')
                setSelectedSacco(null)
              }}
              className={`px-4 py-3 font-medium text-sm border-b-2 transition-all ${
                activeTab === 'my-saccos'
                  ? 'text-emerald-400 border-emerald-400'
                  : 'text-slate-400 border-transparent hover:text-slate-300'
              }`}
            >
              My SACCOs
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        {selectedSacco ? (
          <SACCODetails
            saccoId={selectedSacco}
            onBack={() => setSelectedSacco(null)}
          />
        ) : activeTab === 'explore' ? (
          <SACCOList onSelect={setSelectedSacco} />
        ) : (
          <MySACCOs onSelect={setSelectedSacco} />
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <SACCOCreate
          onClose={() => setShowCreateModal(false)}
          onCreated={() => {
            setShowCreateModal(false)
            setActiveTab('my-saccos')
          }}
        />
      )}

      {/* Floating Info Card */}
      <div className="fixed bottom-6 right-6 max-w-xs p-4 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-600/20 border border-emerald-500/40 backdrop-blur-sm">
        <h4 className="text-white font-semibold mb-2 flex items-center gap-2">
          <Lock className="w-4 h-4 text-emerald-400" />
          Privacy First
        </h4>
        <p className="text-xs text-slate-300">Your financial details stay private. Only approved members see what you choose to share.</p>
      </div>
    </div>
  )
}
