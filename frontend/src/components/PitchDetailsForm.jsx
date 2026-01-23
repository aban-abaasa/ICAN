import React, { useState } from 'react';
import { ChevronUp, Plus, X } from 'lucide-react';

const PitchDetailsForm = ({ isOpen, onClose, onSubmit }) => {
  const [formData, setFormData] = useState({
    title: '',
    creator: '',
    description: '',
    category: 'Technology',
    pitchType: 'Equity',
    targetGoal: '$500K',
    equityOffering: '10%',
    currentlyRaised: '$0',
    hasIP: false,
    teamMembers: []
  });
  const [newMember, setNewMember] = useState('');

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const addTeamMember = () => {
    if (newMember.trim()) {
      setFormData(prev => ({
        ...prev,
        teamMembers: [...prev.teamMembers, newMember]
      }));
      setNewMember('');
    }
  };

  const removeTeamMember = (index) => {
    setFormData(prev => ({
      ...prev,
      teamMembers: prev.teamMembers.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[99999] flex items-end sm:items-center justify-center">
      <div className="bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 w-full sm:w-full sm:max-w-2xl sm:rounded-2xl rounded-t-3xl border border-pink-500/30 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-slate-900/80 backdrop-blur-md border-b border-pink-500/30 p-4 sm:p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-pink-500 to-purple-500 rounded-lg flex items-center justify-center">
              <span className="text-lg">✨</span>
            </div>
            <h2 className="text-lg sm:text-2xl font-bold text-white">Pitch Details</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-white/10 rounded-lg transition"
          >
            <X className="w-5 h-5 text-white" />
          </button>
        </div>

        {/* Form Content */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Pitch Title */}
          <div>
            <label className="block text-white font-semibold mb-2 flex items-center gap-2">
              <span>✨</span> Pitch Title <span className="text-pink-400">*</span>
            </label>
            <input
              type="text"
              name="title"
              value={formData.title}
              onChange={handleInputChange}
              placeholder="e.g., AI-Powered Supply Chain Platform"
              className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 transition"
              required
            />
          </div>

          {/* Creator/Company Name */}
          <div>
            <label className="block text-white font-semibold mb-2 flex items-center gap-2">
              <span>👤</span> Creator/Company Name <span className="text-pink-400">*</span>
            </label>
            <input
              type="text"
              name="creator"
              value={formData.creator}
              onChange={handleInputChange}
              placeholder="Your name or company"
              className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 transition"
              required
            />
          </div>

          {/* Pitch Description */}
          <div>
            <label className="block text-white font-semibold mb-2 flex items-center gap-2">
              <span>📝</span> Pitch Description <span className="text-pink-400">*</span>
            </label>
            <textarea
              name="description"
              value={formData.description}
              onChange={handleInputChange}
              placeholder="Describe your idea, business model, and what you're seeking. Be compelling and clear!"
              rows="4"
              className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 transition resize-none"
              required
            />
          </div>

          {/* Two Column Layout */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Category */}
            <div>
              <label className="block text-white font-semibold mb-2 flex items-center gap-2">
                <span>🎯</span> Category
              </label>
              <select
                name="category"
                value={formData.category}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 transition"
              >
                <option value="Technology">Technology</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Finance">Finance</option>
                <option value="Retail">Retail</option>
                <option value="Energy">Energy</option>
                <option value="Other">Other</option>
              </select>
            </div>

            {/* Pitch Type */}
            <div>
              <label className="block text-white font-semibold mb-2 flex items-center gap-2">
                <span>💼</span> Pitch Type
              </label>
              <select
                name="pitchType"
                value={formData.pitchType}
                onChange={handleInputChange}
                className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 transition"
              >
                <option value="Equity">Equity</option>
                <option value="Debt">Debt</option>
                <option value="Revenue Share">Revenue Share</option>
                <option value="Donation">Donation</option>
              </select>
            </div>
          </div>

          {/* Three Column Layout */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Target Goal */}
            <div>
              <label className="block text-white font-semibold mb-2 flex items-center gap-2">
                <span>🎯</span> Target Goal
              </label>
              <input
                type="text"
                name="targetGoal"
                value={formData.targetGoal}
                onChange={handleInputChange}
                placeholder="$500K"
                className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 transition"
              />
            </div>

            {/* Equity Offering */}
            <div>
              <label className="block text-white font-semibold mb-2 flex items-center gap-2">
                <span>📊</span> Equity Offering
              </label>
              <input
                type="text"
                name="equityOffering"
                value={formData.equityOffering}
                onChange={handleInputChange}
                placeholder="10%"
                className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 transition"
              />
            </div>

            {/* Currently Raised */}
            <div>
              <label className="block text-white font-semibold mb-2 flex items-center gap-2">
                <span>💵</span> Currently Raised
              </label>
              <input
                type="text"
                name="currentlyRaised"
                value={formData.currentlyRaised}
                onChange={handleInputChange}
                placeholder="$0"
                className="w-full px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 transition"
              />
            </div>
          </div>

          {/* IP Checkbox */}
          <div className="bg-white/5 border border-white/10 rounded-lg p-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                name="hasIP"
                checked={formData.hasIP}
                onChange={handleInputChange}
                className="w-5 h-5 rounded border-white/20 bg-white/10 text-pink-500 focus:ring-pink-500 cursor-pointer"
              />
              <span className="text-white font-semibold flex items-center gap-2">
                <span>🔐</span> This pitch includes Intellectual Property (IP)
              </span>
            </label>
          </div>

          {/* Team Members */}
          <div>
            <label className="block text-white font-semibold mb-3 flex items-center gap-2">
              <span>👥</span> Team Members
            </label>
            <div className="space-y-2 mb-3">
              {formData.teamMembers.map((member, index) => (
                <div key={index} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-lg p-3">
                  <span className="text-gray-300">{member}</span>
                  <button
                    type="button"
                    onClick={() => removeTeamMember(index)}
                    className="p-1 hover:bg-white/10 rounded transition text-gray-400 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={newMember}
                onChange={(e) => setNewMember(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTeamMember())}
                placeholder="Add team member name"
                className="flex-1 px-4 py-2.5 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-pink-500/50 focus:ring-2 focus:ring-pink-500/20 transition"
              />
              <button
                type="button"
                onClick={addTeamMember}
                className="px-4 py-2.5 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-semibold rounded-lg transition flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Add</span>
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            className="w-full mt-6 px-6 py-3 bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white font-bold rounded-lg transition flex items-center justify-center gap-2 group"
          >
            <span>🚀</span>
            <span>Launch Your Pitch & Connect With Investors</span>
            <ChevronUp className="w-4 h-4 group-hover:-translate-y-1 transition" />
          </button>
        </form>
      </div>
    </div>
  );
};

export default PitchDetailsForm;
