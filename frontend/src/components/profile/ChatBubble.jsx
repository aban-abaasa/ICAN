import React, { useEffect, useState } from 'react';
import { Loader2, FileText, Pin, PinOff, Download } from 'lucide-react';
import { resolveAttachmentUrl } from '../../services/portfolioChatService';
import { resolveDownloadUrl } from '../../services/r2StorageService';

// Shared bubble for portfolio direct-message threads — used by both the
// visitor-facing PortfolioChatPanel (public page) and the owner's Messages
// inbox in PortfolioTab.jsx (dashboard), so a thread looks identical from
// either side.
//
// Messages disappear 24h after they're sent unless the owner keeps them
// (see ADD_PORTFOLIO_MESSAGE_EXPIRY.sql) — canManage/onToggleKeep (owner
// view only; a visitor can't keep a message) render the countdown/pin
// control that lets the owner exempt one from that sweep.
export default function ChatBubble({ message, isMine, canManage = false, onToggleKeep }) {
  const [attachmentUrl, setAttachmentUrl] = useState(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Only images need an inline-preview URL — a file attachment only ever
    // needs the on-demand forced-download URL from handleDownload below.
    if (message.attachment_url && message.attachment_type === 'image') {
      resolveAttachmentUrl(message.attachment_url).then((url) => { if (!cancelled) setAttachmentUrl(url); });
    }
    return () => { cancelled = true; };
  }, [message.attachment_url, message.attachment_type]);

  const handleDownload = async () => {
    if (isDownloading) return;
    setIsDownloading(true);
    try {
      const url = await resolveDownloadUrl(message.attachment_url, message.attachment_name);
      if (!url) return;
      // A forced Content-Disposition: attachment response downloads
      // straight away rather than navigating, so a hidden click — not
      // target="_blank" — is enough; no extra blank tab left behind.
      const link = document.createElement('a');
      link.href = url;
      link.download = message.attachment_name || 'download';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${isMine ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-100'}`}>
        {!isMine && message.sender_name && (
          <p className="text-[10px] font-semibold text-indigo-300/80 mb-0.5">{message.sender_name}</p>
        )}
        {message.attachment_url && (
          message.attachment_type === 'image' ? (
            attachmentUrl ? (
              <div className="relative mb-1.5 group/img">
                <img src={attachmentUrl} alt={message.attachment_name || 'Attachment'} className="rounded-lg max-h-52 object-cover" />
                <button
                  onClick={handleDownload}
                  disabled={isDownloading}
                  className="absolute top-1.5 right-1.5 p-1.5 rounded-lg bg-black/60 hover:bg-black/80 text-white opacity-0 group-hover/img:opacity-100 focus:opacity-100 transition-opacity"
                  title="Download image"
                >
                  {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                </button>
              </div>
            ) : (
              <div className="w-32 h-32 rounded-lg bg-black/20 flex items-center justify-center mb-1.5">
                <Loader2 className="w-4 h-4 animate-spin opacity-60" />
              </div>
            )
          ) : (
            <button
              onClick={handleDownload}
              disabled={isDownloading}
              className="flex items-center gap-1.5 mb-1.5 px-2 py-1.5 rounded-lg bg-black/20 hover:bg-black/30 text-xs transition-colors w-full text-left disabled:opacity-60"
            >
              <FileText className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate flex-1">{message.attachment_name || 'File'}</span>
              {isDownloading ? <Loader2 className="w-3.5 h-3.5 flex-shrink-0 animate-spin" /> : <Download className="w-3.5 h-3.5 flex-shrink-0" />}
            </button>
          )
        )}
        {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}

        {canManage && (
          <button
            onClick={() => onToggleKeep?.(!message.kept_by_owner)}
            className={`mt-1 flex items-center gap-1 text-[10px] ${isMine ? 'text-white/60 hover:text-white' : 'text-slate-400 hover:text-white'} transition-colors`}
            title={message.kept_by_owner ? 'Kept — will not auto-delete. Click to undo.' : 'Keep this message so it does not auto-delete after 24h'}
          >
            {message.kept_by_owner ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
            {message.kept_by_owner ? 'Kept' : `Expires in ${hoursUntil(message.expires_at)}`}
          </button>
        )}
      </div>
    </div>
  );
}

function hoursUntil(dateStr) {
  if (!dateStr) return '—';
  const hours = Math.max(0, Math.ceil((new Date(dateStr) - new Date()) / (1000 * 60 * 60)));
  return hours <= 1 ? '<1h' : `${hours}h`;
}
