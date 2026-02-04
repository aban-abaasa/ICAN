import React, { useState, useEffect } from 'react';
import {
  FileText,
  Upload,
  X,
  Check,
  AlertCircle,
  DollarSign,
  Lock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { getSupabase } from '../services/pitchingService';

const BusinessProfileDocuments = ({ businessProfile, onDocumentsComplete, onCancel }) => {
  const [documents, setDocuments] = useState({
    businessPlan: { content: '', file: null, completed: false },
    financialProjection: { content: '', file: null, completed: false },
    valueProposition: {
      content: '',
      wants: '',
      fears: '',
      needs: '',
      file: null,
      completed: false
    },
    mou: { content: '', file: null, completed: false },
    shareAllocation: {
      content: '',
      shares: '',
      sharePrice: '',
      totalAmount: '',
      file: null,
      completed: false
    }
  });

  const [noDisclosure, setNoDisclosure] = useState(false);
  const [disclosureNotes, setDisclosureNotes] = useState('');
  const [expandedSections, setExpandedSections] = useState({
    businessPlan: true,
    financialProjection: false,
    valueProposition: false,
    mou: false,
    shareAllocation: false
  });
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  // Load existing documents
  useEffect(() => {
    loadDocuments();
  }, [businessProfile?.id]);

  // Check if all documents are complete and notify parent
  useEffect(() => {
    // Helper function to check if content has meaningful text (more lenient)
    const hasMinimumContent = (text) => {
      const trimmedText = text.trim();
      // Accept content if it's longer than 10 characters and not completely empty placeholders
      return trimmedText.length > 10 && 
             !trimmedText.startsWith('[Enter ') && 
             trimmedText !== '[amount]' && 
             trimmedText !== '[percentage]' &&
             trimmedText !== '[description]' &&
             trimmedText !== '[details]' &&
             trimmedText !== '[breakdown]';
    };

    // More lenient validation - allow most auto-populated content
    const businessPlanValid = documents.businessPlan.content.trim().length > 20;
    const financialProjectionValid = documents.financialProjection.content.trim().length > 20;
    const valuePropositionWantsValid = documents.valueProposition.wants.trim().length > 10;
    const valuePropositionFearsValid = documents.valueProposition.fears.trim().length > 10;
    const valuePropositionNeedsValid = documents.valueProposition.needs.trim().length > 10;
    const mouValid = documents.mou.content.trim().length > 20;
    const shareAllocationSharesValid = documents.shareAllocation.shares !== '' && documents.shareAllocation.shares !== null;
    const shareAllocationPriceValid = documents.shareAllocation.sharePrice !== '' && documents.shareAllocation.sharePrice !== null;
    
    const allComplete = 
      businessPlanValid &&
      financialProjectionValid &&
      valuePropositionWantsValid &&
      valuePropositionFearsValid &&
      valuePropositionNeedsValid &&
      mouValid &&
      shareAllocationSharesValid &&
      shareAllocationPriceValid;

    // Debug logging to show which fields are missing
    if (!allComplete) {
      console.log('📋 Document validation status (lenient):');
      console.log('Business Plan:', businessPlanValid ? '✅' : '❌', 'Length:', documents.businessPlan.content.length, '(need >20)');
      console.log('Financial Projection:', financialProjectionValid ? '✅' : '❌', 'Length:', documents.financialProjection.content.length, '(need >20)');
      console.log('Value Proposition - Wants:', valuePropositionWantsValid ? '✅' : '❌', 'Length:', documents.valueProposition.wants.length, '(need >10)');
      console.log('Value Proposition - Fears:', valuePropositionFearsValid ? '✅' : '❌', 'Length:', documents.valueProposition.fears.length, '(need >10)');
      console.log('Value Proposition - Needs:', valuePropositionNeedsValid ? '✅' : '❌', 'Length:', documents.valueProposition.needs.length, '(need >10)');
      console.log('MOU:', mouValid ? '✅' : '❌', 'Length:', documents.mou.content.length, '(need >20)');
      console.log('Share Allocation - Shares:', shareAllocationSharesValid ? '✅' : '❌', 'Value:', documents.shareAllocation.shares);
      console.log('Share Allocation - Price:', shareAllocationPriceValid ? '✅' : '❌', 'Value:', documents.shareAllocation.sharePrice);
    } else {
      console.log('✅ All documents pass lenient validation!');
    }

    if (onDocumentsComplete) {
      if (allComplete) {
        // Pass the actual documents data when complete
        const documentsData = {
          business_profile_id: businessProfile.id,
          business_plan_content: documents.businessPlan.content,
          business_plan_completed: documents.businessPlan.completed,
          financial_projection_content: documents.financialProjection.content,
          financial_projection_completed: documents.financialProjection.completed,
          value_proposition_wants: documents.valueProposition.wants,
          value_proposition_fears: documents.valueProposition.fears,
          value_proposition_needs: documents.valueProposition.needs,
          value_proposition_completed: documents.valueProposition.completed,
          mou_content: documents.mou.content,
          mou_completed: documents.mou.completed,
          share_allocation_shares: documents.shareAllocation.shares,
          share_allocation_share_price: documents.shareAllocation.sharePrice,
          share_allocation_completed: documents.shareAllocation.completed,
          all_documents_completed: allComplete
        };
        onDocumentsComplete(documentsData);
      } else {
        onDocumentsComplete(false);
      }
    }
  }, [documents, onDocumentsComplete]);

  const loadDocuments = async () => {
    try {
      const supabase = getSupabase();
      console.log('📄 Loading documents for business profile:', businessProfile.id);
      
      if (!businessProfile?.id) {
        console.warn('⚠️ Business profile ID is missing, cannot load documents');
        return;
      }

      if (!supabase) {
        console.warn('⚠️ Supabase not available');
        return;
      }

      const { data, error } = await supabase
        .from('business_documents')
        .select('*')
        .eq('business_profile_id', businessProfile.id)
        .limit(1);  // Use limit instead of single() for better error handling

      if (error) {
        console.warn('⚠️ Load error:', error.message, error.code);
      }

      if (data && data.length > 0) {
        console.log('✅ Documents loaded successfully:', data[0]);
        setDocuments({
          businessPlan: {
            content: data[0].business_plan_content || '',
            file: null,
            completed: data[0].business_plan_completed
          },
          financialProjection: {
            content: data[0].financial_projection_content || '',
            file: null,
            completed: data[0].financial_projection_completed
          },
          valueProposition: {
            content: data[0].value_proposition_content || '',
            wants: data[0].value_proposition_wants || '',
            fears: data[0].value_proposition_fears || '',
            needs: data[0].value_proposition_needs || '',
            file: null,
            completed: data[0].value_proposition_completed
          },
          mou: {
            content: data[0].mou_content || '',
            file: null,
            completed: data[0].mou_completed
          },
          shareAllocation: {
            content: data[0].share_allocation_content || '',
            shares: data[0].share_allocation_shares || '',
            sharePrice: data[0].share_allocation_share_price || '',
            totalAmount: data[0].share_allocation_total_amount || '',
            file: null,
            completed: data[0].share_allocation_completed
          }
        });
        setNoDisclosure(data[0].no_disclosure_enabled || false);
        setDisclosureNotes(data[0].disclosure_notes || '');
      } else {
        // No existing documents - auto-populate from business profile
        console.log('No existing documents found. Auto-populating from business profile:', businessProfile);
        
        const autoPopulatedDocs = {
          businessPlan: {
            content: businessProfile.business_description 
              ? `Business Overview:\n${businessProfile.business_description}\n\nBusiness Type: ${businessProfile.business_type || 'Not specified'}\n\nTarget Market:\n[Please describe your target market and customer base]\n\nCompetitive Advantage:\n[Please describe what sets your business apart]\n\nGrowth Strategy:\n[Please outline your growth and expansion plans]`
              : `Business Plan for ${businessProfile.business_name || 'Your Business'}\n\n[Please describe your business model, target market, and growth strategy]`,
            file: null,
            completed: false
          },
          financialProjection: {
            content: businessProfile.current_revenue 
              ? `Current Financial Status:\nRevenue: ${businessProfile.current_revenue}\nFunding Stage: ${businessProfile.funding_stage || 'Seed'}\n\nProjected Revenue:\nYear 1: [Enter projected revenue]\nYear 2: [Enter projected revenue]\nYear 3: [Enter projected revenue]\n\nKey Assumptions:\n[List your financial assumptions and projections]`
              : 'Financial Projections:\n\nRevenue Projections:\nYear 1: $[amount]\nYear 2: $[amount]\nYear 3: $[amount]\n\nExpenses:\n- Personnel: $[amount]\n- Marketing: $[amount]\n- Operations: $[amount]\n- Other: $[amount]\n\nFunding Requirements:\nTotal needed: $[amount]\nUse of funds: [breakdown]',
            file: null,
            completed: false
          },
          valueProposition: {
            content: '',
            wants: businessProfile.value_proposition || '[What does your target customer want or desire?]',
            fears: '[What problems or pain points does your customer face?]',
            needs: '[What essential needs does your product/service fulfill?]',
            file: null,
            completed: false
          },
          mou: {
            content: `Memorandum of Understanding\n\nBusiness: ${businessProfile.business_name || '[Business Name]'}\nContact: ${businessProfile.contact_person || '[Contact Person]'}\nEmail: ${businessProfile.email || '[Email Address]'}\n\nInvestment Terms:\n- Investment Amount: $[amount]\n- Equity Offered: [percentage]%\n- Use of Funds: [description]\n- Expected Returns: [details]\n\nKey Terms and Conditions:\n[Please outline the key terms of the investment agreement]`,
            file: null,
            completed: false
          },
          shareAllocation: {
            content: '',
            shares: '10', // Default 10% equity
            sharePrice: '1.00', // Default $1 per share
            totalAmount: '',
            file: null,
            completed: false
          }
        };
        
        setDocuments(autoPopulatedDocs);
        console.log('✅ Auto-populated documents from business profile');
      }
    } catch (error) {
      console.log('No existing documents found', error);
    }
  };

  const toggleSection = (section) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const handleFileUpload = (section, file) => {
    setDocuments(prev => ({
      ...prev,
      [section]: { ...prev[section], file }
    }));
  };

  const handleContentChange = (section, value, subfield = null) => {
    if (subfield) {
      setDocuments(prev => ({
        ...prev,
        [section]: {
          ...prev[section],
          [subfield]: value
        }
      }));
    } else {
      setDocuments(prev => ({
        ...prev,
        [section]: { ...prev[section], content: value }
      }));
    }
  };

  const markComplete = (section) => {
    setDocuments(prev => ({
      ...prev,
      [section]: { ...prev[section], completed: !prev[section].completed }
    }));
  };

  const calculateShareAllocation = (shares = null, price = null) => {
    const sharesValue = shares !== null ? parseFloat(shares) : parseFloat(documents.shareAllocation.shares) || 0;
    const priceValue = price !== null ? parseFloat(price) : parseFloat(documents.shareAllocation.sharePrice) || 0;
    const total = sharesValue * priceValue;

    setDocuments(prev => ({
      ...prev,
      shareAllocation: {
        ...prev.shareAllocation,
        totalAmount: total.toFixed(2)
      }
    }));
  };

  const saveDocuments = async () => {
    setLoading(true);
    setSaveStatus('Saving...');

    try {
      const supabase = getSupabase();

      const documentData = {
        business_profile_id: businessProfile.id,
        business_plan_content: documents.businessPlan.content,
        business_plan_completed: documents.businessPlan.completed,
        financial_projection_content: documents.financialProjection.content,
        financial_projection_completed: documents.financialProjection.completed,
        value_proposition_content: documents.valueProposition.content,
        value_proposition_wants: documents.valueProposition.wants,
        value_proposition_fears: documents.valueProposition.fears,
        value_proposition_needs: documents.valueProposition.needs,
        value_proposition_completed: documents.valueProposition.completed,
        mou_content: documents.mou.content,
        mou_completed: documents.mou.completed,
        share_allocation_content: documents.shareAllocation.content,
        share_allocation_shares: parseFloat(documents.shareAllocation.shares) || null,
        share_allocation_share_price: parseFloat(documents.shareAllocation.sharePrice) || null,
        share_allocation_total_amount: parseFloat(documents.shareAllocation.totalAmount) || null,
        share_allocation_completed: documents.shareAllocation.completed,
        no_disclosure_enabled: noDisclosure,
        disclosure_notes: disclosureNotes,
        all_documents_completed:
          documents.businessPlan.completed &&
          documents.financialProjection.completed &&
          documents.valueProposition.completed &&
          documents.mou.completed &&
          documents.shareAllocation.completed,
        completed_at: (
          documents.businessPlan.completed &&
          documents.financialProjection.completed &&
          documents.valueProposition.completed &&
          documents.mou.completed &&
          documents.shareAllocation.completed
        ) ? new Date().toISOString() : null
      };

      console.log('💾 Saving documents to database...');
      console.log('Business Profile ID:', businessProfile.id);
      console.log('Document data being saved:', documentData);

      if (!businessProfile?.id) {
        throw new Error('Business Profile ID is missing!');
      }

      if (!supabase) {
        throw new Error('Supabase connection not available!');
      }

      // Check if document exists - use regular select, not single()
      console.log('🔍 Checking if documents already exist...');
      const { data: existing, error: selectError } = await supabase
        .from('business_documents')
        .select('id')
        .eq('business_profile_id', businessProfile.id);

      if (selectError) {
        console.warn('Select error (may be normal if no records):', selectError);
      } else {
        console.log('✅ Query successful. Existing records:', existing?.length || 0);
      }

      let result;
      if (existing && existing.length > 0) {
        console.log('📝 Updating existing document...');
        // Update
        const updateResult = await supabase
          .from('business_documents')
          .update(documentData)
          .eq('business_profile_id', businessProfile.id)
          .select();
        result = updateResult;
        if (updateResult.error) {
          console.error('❌ Update failed:', updateResult.error);
        } else {
          console.log('✅ Update successful:', updateResult.data);
        }
      } else {
        console.log('✨ Creating new document...');
        // Insert
        const insertResult = await supabase
          .from('business_documents')
          .insert([documentData])
          .select();
        result = insertResult;
        if (insertResult.error) {
          console.error('❌ Insert failed:', insertResult.error);
        } else {
          console.log('✅ Insert successful:', insertResult.data);
        }
      }

      if (result?.error) {
        console.error('❌ Save error:', result.error);
        console.error('Error message:', result.error.message);
        console.error('Error code:', result.error.code);
        throw result.error;
      }

      console.log('✅ Documents saved successfully to database!', result?.data);
      setSaveStatus('✅ Saved successfully! Documents stored in database.');
      setTimeout(() => setSaveStatus(''), 3000);

      if (onDocumentsComplete) {
        onDocumentsComplete(documentData);
      }
    } catch (error) {
      console.error('❌ Error saving documents:', error);
      setSaveStatus('❌ ERROR: ' + (error.message || 'Failed to save documents to database'));
    } finally {
      setLoading(false);
    }
  };

  const completedCount = [
    documents.businessPlan.completed,
    documents.financialProjection.completed,
    documents.valueProposition.completed,
    documents.mou.completed,
    documents.shareAllocation.completed
  ].filter(Boolean).length;

  const progressPercent = (completedCount / 5) * 100;

  return (
    <div className="space-y-6">
          {/* Progress Bar */}
          <div className="bg-slate-700/50 rounded-lg p-4 border border-slate-600">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-white">Overall Progress</h3>
              <span className="text-sm text-slate-300">{completedCount}/5 documents</span>
            </div>
            <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          {/* Document Sections */}

          {/* 1. Business Plan */}
          <DocumentSection
            title="Business Plan"
            description="Your strategic foundation and business model"
            icon={<FileText className="w-5 h-5" />}
            isExpanded={expandedSections.businessPlan}
            onToggle={() => toggleSection('businessPlan')}
            isCompleted={documents.businessPlan.completed}
            onToggleComplete={() => markComplete('businessPlan')}
          >
            <textarea
              value={documents.businessPlan.content}
              onChange={(e) => handleContentChange('businessPlan', e.target.value)}
              placeholder="Enter your business plan or paste content..."
              className="w-full h-40 p-4 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none resize-none"
            />
            <FileUploadBox
              label="Or upload file"
              onChange={(file) => handleFileUpload('businessPlan', file)}
            />
          </DocumentSection>

          {/* 2. Financial Projection */}
          <DocumentSection
            title="Financial Projection"
            description="Revenue and expense estimates"
            icon={<DollarSign className="w-5 h-5" />}
            isExpanded={expandedSections.financialProjection}
            onToggle={() => toggleSection('financialProjection')}
            isCompleted={documents.financialProjection.completed}
            onToggleComplete={() => markComplete('financialProjection')}
          >
            <textarea
              value={documents.financialProjection.content}
              onChange={(e) => handleContentChange('financialProjection', e.target.value)}
              placeholder="Enter financial projections, growth estimates, revenue models..."
              className="w-full h-40 p-4 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none resize-none"
            />
            <FileUploadBox
              label="Or upload spreadsheet/document"
              onChange={(file) => handleFileUpload('financialProjection', file)}
            />
          </DocumentSection>

          {/* 3. Value Proposition */}
          <DocumentSection
            title="Value Proposition"
            description="What you offer: Wants, Fears, and Needs"
            icon={<AlertCircle className="w-5 h-5" />}
            isExpanded={expandedSections.valueProposition}
            onToggle={() => toggleSection('valueProposition')}
            isCompleted={documents.valueProposition.completed}
            onToggleComplete={() => markComplete('valueProposition')}
          >
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Wants (What customers want)
                </label>
                <textarea
                  value={documents.valueProposition.wants}
                  onChange={(e) => handleContentChange('valueProposition', e.target.value, 'wants')}
                  placeholder="List customer desires and aspirations..."
                  className="w-full h-24 p-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Fears (Customer concerns)
                </label>
                <textarea
                  value={documents.valueProposition.fears}
                  onChange={(e) => handleContentChange('valueProposition', e.target.value, 'fears')}
                  placeholder="What are customer pain points and concerns?..."
                  className="w-full h-24 p-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Needs (Essential requirements)
                </label>
                <textarea
                  value={documents.valueProposition.needs}
                  onChange={(e) => handleContentChange('valueProposition', e.target.value, 'needs')}
                  placeholder="What do customers absolutely need?..."
                  className="w-full h-24 p-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>

              <FileUploadBox
                label="Or upload document"
                onChange={(file) => handleFileUpload('valueProposition', file)}
              />
            </div>
          </DocumentSection>

          {/* 4. Memorandum of Understanding (MoU) */}
          <DocumentSection
            title="Memorandum of Understanding"
            description="Legal and collaborative agreements"
            icon={<FileText className="w-5 h-5" />}
            isExpanded={expandedSections.mou}
            onToggle={() => toggleSection('mou')}
            isCompleted={documents.mou.completed}
            onToggleComplete={() => markComplete('mou')}
          >
            <textarea
              value={documents.mou.content}
              onChange={(e) => handleContentChange('mou', e.target.value)}
              placeholder="Enter MoU terms, agreements, and collaboration details..."
              className="w-full h-40 p-4 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none resize-none"
            />
            <FileUploadBox
              label="Or upload MoU document"
              onChange={(file) => handleFileUpload('mou', file)}
            />
          </DocumentSection>

          {/* 5. Share Allocation */}
          <DocumentSection
            title="Share Allocation"
            description="Ownership structure and equity distribution"
            icon={<DollarSign className="w-5 h-5" />}
            isExpanded={expandedSections.shareAllocation}
            onToggle={() => toggleSection('shareAllocation')}
            isCompleted={documents.shareAllocation.completed}
            onToggleComplete={() => markComplete('shareAllocation')}
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Number of Shares
                  </label>
                  <input
                    type="number"
                    value={documents.shareAllocation.shares}
                    onChange={(e) => {
                      handleContentChange('shareAllocation', e.target.value, 'shares');
                      calculateShareAllocation(e.target.value, documents.shareAllocation.sharePrice);
                    }}
                    placeholder="e.g., 1000"
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Share Price ($)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={documents.shareAllocation.sharePrice}
                    onChange={(e) => {
                      handleContentChange('shareAllocation', e.target.value, 'sharePrice');
                      calculateShareAllocation(documents.shareAllocation.shares, e.target.value);
                    }}
                    placeholder="e.g., 1000000"
                    className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-2">
                    Total Valuation
                  </label>
                  <div className="w-full px-4 py-2 bg-gradient-to-r from-green-900/30 to-emerald-900/30 border-2 border-green-500/50 rounded-lg text-green-300 font-bold text-lg">
                    ${documents.shareAllocation.totalAmount || '0'}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Additional Notes
                </label>
                <textarea
                  value={documents.shareAllocation.content}
                  onChange={(e) => handleContentChange('shareAllocation', e.target.value)}
                  placeholder="Enter share allocation details, vesting schedules, etc..."
                  className="w-full h-24 p-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-blue-500 focus:outline-none resize-none"
                />
              </div>

              <FileUploadBox
                label="Or upload share allocation document"
                onChange={(file) => handleFileUpload('shareAllocation', file)}
              />
            </div>
          </DocumentSection>

          {/* Privacy & No Disclosure */}
          <div className="bg-slate-700/30 border border-slate-600 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={noDisclosure}
                onChange={(e) => setNoDisclosure(e.target.checked)}
                className="mt-1 w-4 h-4 rounded cursor-pointer"
              />
              <div className="flex-1">
                <label className="block font-semibold text-white mb-2 cursor-pointer flex items-center gap-2">
                  <Lock className="w-4 h-4 text-purple-400" />
                  No Disclosure - Privacy Boundary
                </label>
                <p className="text-sm text-slate-400 mb-3">
                  Apply privacy restrictions to sensitive business information
                </p>
                <textarea
                  value={disclosureNotes}
                  onChange={(e) => setDisclosureNotes(e.target.value)}
                  placeholder="Add any privacy notes or restrictions..."
                  className="w-full h-24 p-3 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:border-purple-500 focus:outline-none resize-none"
                />
              </div>
            </div>
          </div>

          {/* Save Status */}
          {saveStatus && (
            <div className={`p-3 rounded-lg text-sm font-medium flex items-center gap-2 ${
              saveStatus.includes('✅')
                ? 'bg-green-600/20 text-green-300 border border-green-600/50'
                : saveStatus.includes('❌')
                ? 'bg-red-600/20 text-red-300 border border-red-600/50'
                : 'bg-blue-600/20 text-blue-300 border border-blue-600/50'
            }`}>
              {saveStatus.includes('Saving') && <div className="animate-spin">⟳</div>}
              {saveStatus}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 justify-end">
            <button
              onClick={onCancel}
              className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition"
            >
              Back
            </button>
            <button
              onClick={saveDocuments}
              disabled={loading}
              className="px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white rounded-lg font-medium transition disabled:opacity-50 flex items-center gap-2"
            >
              {loading ? '💾 Saving to Database...' : '💾 Save Documents to Database'}
            </button>
          </div>
        </div>
      );
    };

// Document Section Component
const DocumentSection = ({
  title,
  description,
  icon,
  isExpanded,
  onToggle,
  isCompleted,
  onToggleComplete,
  children
}) => {
  return (
    <div className="bg-slate-700/30 border border-slate-600 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-700/50 transition"
      >
        <div className="flex items-center gap-4 flex-1 text-left">
          <div className="text-blue-400">{icon}</div>
          <div>
            <h3 className="font-semibold text-white flex items-center gap-2">
              {title}
              {isCompleted && <Check className="w-4 h-4 text-green-400" />}
            </h3>
            <p className="text-sm text-slate-400">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={isCompleted}
            onChange={onToggleComplete}
            onClick={(e) => e.stopPropagation()}
            className="w-5 h-5 rounded cursor-pointer"
            title="Mark as complete"
          />
          {isExpanded ? (
            <ChevronUp className="w-5 h-5 text-slate-400" />
          ) : (
            <ChevronDown className="w-5 h-5 text-slate-400" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="px-6 py-4 border-t border-slate-600 space-y-4 bg-slate-800/50">
          {children}
        </div>
      )}
    </div>
  );
};

// File Upload Box Component
const FileUploadBox = ({ label, onChange }) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleDrag = (e) => {
    e.preventDefault();
    setIsDragging(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onChange(file);
  };

  return (
    <div
      onDragEnter={handleDrag}
      onDragOver={handleDrag}
      onDragLeave={handleDrag}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition ${
        isDragging
          ? 'border-blue-500 bg-blue-500/10'
          : 'border-slate-600 hover:border-slate-500'
      }`}
    >
      <label className="flex flex-col items-center gap-2 cursor-pointer">
        <Upload className="w-5 h-5 text-slate-400" />
        <span className="text-sm text-slate-400">
          {label} or <span className="text-blue-400 font-medium">click to browse</span>
        </span>
        <input
          type="file"
          onChange={(e) => {
            if (e.target.files?.[0]) {
              onChange(e.target.files[0]);
            }
          }}
          className="hidden"
        />
      </label>
    </div>
  );
};

export default BusinessProfileDocuments;
