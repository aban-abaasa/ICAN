import React, { useEffect, useState } from 'react';
import jsPDF from 'jspdf';
import { X, Clock, CheckCircle, Download, FileText } from 'lucide-react';
import { getSupabase } from '../services/pitchingService';
import { reconcileInvestorShareholderStatus } from '../services/investorPromotionService';

// Shown instead of the full ShareSigningFlow when the current user already
// has a submitted investment_agreements row ('signing' or 'sealed') for this
// pitch -- so tapping the business profile again doesn't restart the whole
// investment flow, it just reports where their existing investment stands.
const InvestmentProgressView = ({ pitch, agreement, currentUser, onClose }) => {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mouContent, setMouContent] = useState(null);
  const [businessName, setBusinessName] = useState(pitch?.business_profiles?.business_name || pitch?.title || 'Business');
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    loadProgress(true);
    const interval = setInterval(() => loadProgress(false), 5000);
    return () => clearInterval(interval);
  }, []);

  const loadProgress = async (isInitialLoad = false) => {
    try {
      if (isInitialLoad) setLoading(true);
      const supabase = getSupabase();
      const businessProfileId = agreement.business_profile_id;

      // Count real shareholder signatures for THIS agreement, not
      // notification read-receipts (which track whether a shareholder
      // opened the notification, not whether they approved it, and
      // weren't even scoped to this specific investment).
      const { data: signedSignatures } = await supabase
        .from('investment_signatures')
        .select('id', { count: 'exact' })
        .eq('agreement_id', agreement.id)
        .eq('signature_status', 'signed');

      const { data: totalMembers } = await supabase
        .from('business_co_owners')
        .select('id', { count: 'exact' })
        .eq('business_profile_id', businessProfileId)
        .in('status', ['active', null])
        .gt('ownership_share', 0);

      const totalCount = totalMembers?.length || 1;
      const approvedCount = signedSignatures?.length || 0;
      // agreement.status is flipped to 'sealed' server-side the moment the
      // threshold is met (see check_and_seal_investment_agreement trigger),
      // so trust it directly rather than risk a rounding/timing mismatch
      // with the live percent below.
      const percent = agreement.status === 'sealed' ? 100 : (approvedCount / totalCount) * 100;

      setStats({ approvedCount, totalCount, percent });

      // Self-heal: if the threshold is met but this investor never got
      // written into business_co_owners (e.g. they weren't watching this
      // screen live when the last shareholder signed), promote them now.
      if (percent >= 60) {
        reconcileInvestorShareholderStatus(agreement, pitch, currentUser)
          .then((result) => {
            if (result.promoted) {
              console.log('✅ Investor promoted to shareholder on reconcile:', result);
            }
          })
          .catch((err) => console.warn('Shareholder reconcile failed:', err?.message));
      }

      if (isInitialLoad) {
        const { data: business } = await supabase
          .from('business_profiles')
          .select('business_name')
          .eq('id', businessProfileId)
          .maybeSingle();
        if (business?.business_name) setBusinessName(business.business_name);

        const { data: docs } = await supabase
          .from('business_documents')
          .select('mou_content')
          .eq('business_profile_id', businessProfileId)
          .maybeSingle();
        setMouContent(docs?.mou_content || null);
      }
    } catch (err) {
      console.error('Error loading investment progress:', err);
    } finally {
      setLoading(false);
    }
  };

  const downloadMou = () => {
    setDownloading(true);
    try {
      const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 18;
      const contentWidth = pageWidth - margin * 2;
      let y = 20;

      const ensureSpace = (needed) => {
        if (y + needed > pageHeight - margin) {
          pdf.addPage();
          y = 20;
        }
      };

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.text('Investment Agreement (MOU)', pageWidth / 2, y, { align: 'center' });
      y += 8;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.setTextColor(90);
      pdf.text(businessName, pageWidth / 2, y, { align: 'center' });
      y += 10;
      pdf.setDrawColor(200);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 9;
      pdf.setTextColor(30);

      const addField = (label, value) => {
        ensureSpace(7);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(10);
        pdf.text(`${label}:`, margin, y);
        pdf.setFont('helvetica', 'normal');
        const valueLines = pdf.splitTextToSize(String(value ?? 'N/A'), contentWidth - 50);
        pdf.text(valueLines, margin + 50, y);
        y += 7 * valueLines.length;
      };

      addField('Pitch', pitch?.title);
      addField('Investor', currentUser?.user_metadata?.full_name || currentUser?.email);
      addField('Investment Amount', `${agreement.total_investment ?? 'N/A'}`);
      addField('Shares', agreement.shares_amount || 'N/A');
      addField('Shareholder Approval', `${stats.approvedCount}/${stats.totalCount} shareholders - ${stats.percent.toFixed(1)}% (60% required)`);
      addField('Generated', new Date().toLocaleString());
      y += 3;

      ensureSpace(14);
      pdf.setDrawColor(200);
      pdf.line(margin, y, pageWidth - margin, y);
      y += 9;
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(13);
      pdf.text('Memorandum of Understanding', margin, y);
      y += 8;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(10);
      const mouLines = pdf.splitTextToSize(String(mouContent || 'No MOU text available.'), contentWidth);
      mouLines.forEach((line) => {
        ensureSpace(5.5);
        pdf.text(line, margin, y);
        y += 5.5;
      });

      const safeName = businessName.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'agreement';
      pdf.save(`ican-mou-${safeName}.pdf`);
    } catch (err) {
      console.error('Error downloading MOU:', err);
      alert('❌ Error downloading MOU: ' + (err?.message || 'Unknown error'));
    } finally {
      setDownloading(false);
    }
  };

  const sealed = agreement.status === 'sealed' || (stats && stats.percent >= 60);
  const expired = agreement.status === 'expired';

  const formatTimeRemaining = (deadline) => {
    if (!deadline) return null;
    const msRemaining = new Date(deadline).getTime() - Date.now();
    if (msRemaining <= 0) return 'Deadline passed';
    const days = Math.floor(msRemaining / (24 * 60 * 60 * 1000));
    const hours = Math.floor((msRemaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    return `${days}d ${hours}h remaining`;
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-white transition"
        >
          <X className="w-6 h-6" />
        </button>

        <div className="text-center mb-6">
          {expired ? (
            <Clock className="w-14 h-14 text-red-400 mx-auto mb-3" />
          ) : sealed ? (
            <CheckCircle className="w-14 h-14 text-green-400 mx-auto mb-3" />
          ) : (
            <Clock className="w-14 h-14 text-yellow-400 mx-auto mb-3 animate-pulse" />
          )}
          <h2 className="text-2xl font-bold text-white">
            {expired ? 'Investment Refunded' : sealed ? 'Investment Sealed!' : 'Awaiting Shareholder Approval'}
          </h2>
          <p className="text-slate-400 mt-1">{businessName}</p>
        </div>

        {loading && !stats ? (
          <div className="text-center py-8 text-slate-400">Loading progress...</div>
        ) : expired ? (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 text-center mb-4">
            <p className="text-red-300 text-sm">
              The 3-day shareholder approval window passed without reaching 60% approval.
              Your {agreement.total_investment ?? ''} IcanEra investment has been refunded to the account you paid from.
            </p>
          </div>
        ) : (
          <>
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-4 mb-4">
              <div className="flex justify-between text-sm text-slate-300 mb-2">
                <span>{stats.approvedCount} of {stats.totalCount} shareholders approved</span>
                <span className="font-bold">{stats.percent.toFixed(0)}%</span>
              </div>
              <div className="w-full h-3 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${sealed ? 'bg-green-500' : 'bg-yellow-500'}`}
                  style={{ width: `${Math.min(100, stats.percent)}%` }}
                ></div>
              </div>
              <p className="text-xs text-slate-500 mt-2">60% shareholder approval releases the funds to the business.</p>
              {!sealed && agreement.approval_deadline && (
                <p className="text-xs text-yellow-400 mt-2 font-semibold">
                  ⏳ {formatTimeRemaining(agreement.approval_deadline)} to reach 60% approval, or it's refunded automatically.
                </p>
              )}
            </div>

            {sealed ? (
              <button
                onClick={downloadMou}
                disabled={downloading}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-br from-purple-600 to-purple-700 hover:from-purple-500 hover:to-purple-600 disabled:opacity-60 text-white font-bold py-3 px-4 rounded-lg transition shadow-lg"
              >
                <Download className="w-5 h-5" />
                {downloading ? 'Preparing PDF...' : 'Download MOU (PDF)'}
              </button>
            ) : (
              <div className="bg-yellow-500/10 border border-yellow-500/50 rounded-lg p-4 text-center">
                <FileText className="w-8 h-8 text-yellow-400 mx-auto mb-2 opacity-70" />
                <p className="text-yellow-300 text-sm">The MOU will be downloadable here once 60% of shareholders approve.</p>
              </div>
            )}
          </>
        )}

        <button
          onClick={onClose}
          className="w-full mt-3 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white font-semibold rounded-lg transition"
        >
          Back to Feed
        </button>
      </div>
    </div>
  );
};

export default InvestmentProgressView;
