import React, { useState, useRef } from 'react';
import { ChevronUp, X, AlertCircle } from 'lucide-react';
import BusinessProfileDocuments from './BusinessProfileDocuments';

const PitchDetailsForm = ({ isOpen, onClose, onSubmit, currentBusinessProfile }) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [allDocumentsComplete, setAllDocumentsComplete] = useState(false);
  const businessDocRef = useRef(null);

  const handleDocumentsComplete = (isComplete) => {
    setAllDocumentsComplete(isComplete);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!currentBusinessProfile) {
      setSubmitError('No business profile found');
      return;
    }

    if (!allDocumentsComplete) {
      setSubmitError('Please complete all required document fields before submitting');
      return;
    }

    try {
      setIsSubmitting(true);
      setSubmitError('');
      
      console.log('📤 Submitting with business profile:', currentBusinessProfile);
      
      if (!onSubmit) {
        throw new Error('onSubmit callback is not defined');
      }
      
      await onSubmit(currentBusinessProfile);
      
      console.log('✅ Pitch submitted successfully');
    } catch (error) {
      console.error('❌ Error submitting pitch:', error);
      setSubmitError(error.message || 'Failed to submit pitch. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
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
          {currentBusinessProfile ? (
            <BusinessProfileDocuments 
              ref={businessDocRef}
              businessProfile={currentBusinessProfile} 
              onDocumentsComplete={handleDocumentsComplete}
            />
          ) : (
            <div className="text-center py-8">
              <p className="text-red-400 text-sm">⚠️ No business profile found. Please create one first.</p>
            </div>
          )}

          {/* Error Message */}
          {submitError && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-red-200 text-sm">{submitError}</p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || !currentBusinessProfile || !allDocumentsComplete}
            className={`w-full mt-6 px-6 py-3 rounded-lg font-bold transition flex items-center justify-center gap-2 group ${
              isSubmitting || !currentBusinessProfile || !allDocumentsComplete
                ? 'bg-gray-600 cursor-not-allowed opacity-60 text-gray-300'
                : 'bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 text-white hover:shadow-lg hover:shadow-pink-500/50 transform hover:scale-105 active:scale-95'
            }`}
            title={!currentBusinessProfile ? 'Please create a business profile first' : !allDocumentsComplete ? 'Please complete all document fields' : 'Click to launch your pitch'}
          >
            <span>{isSubmitting ? '⏳' : '🚀'}</span>
            <span>{isSubmitting ? 'Going Live...' : 'Go Live'}</span>
            <ChevronUp className={`w-4 h-4 transition ${isSubmitting ? '' : 'group-hover:-translate-y-1'}`} />
          </button>
        </form>
      </div>
    </div>
  );
};

export default PitchDetailsForm;
