import React, { useEffect, useState } from 'react';
import { Loader2, FileText } from 'lucide-react';
import { resolveAttachmentUrl } from '../../services/portfolioChatService';

// Shared bubble for portfolio direct-message threads — used by both the
// visitor-facing PortfolioChatPanel (public page) and the owner's Messages
// inbox in PortfolioTab.jsx (dashboard), so a thread looks identical from
// either side.
export default function ChatBubble({ message, isMine }) {
  const [attachmentUrl, setAttachmentUrl] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (message.attachment_url) {
      resolveAttachmentUrl(message.attachment_url).then((url) => { if (!cancelled) setAttachmentUrl(url); });
    }
    return () => { cancelled = true; };
  }, [message.attachment_url]);

  return (
    <div className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${isMine ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-100'}`}>
        {!isMine && message.sender_name && (
          <p className="text-[10px] font-semibold text-indigo-300/80 mb-0.5">{message.sender_name}</p>
        )}
        {message.attachment_url && (
          message.attachment_type === 'image' ? (
            attachmentUrl ? (
              <img src={attachmentUrl} alt={message.attachment_name || 'Attachment'} className="rounded-lg max-h-52 mb-1.5 object-cover" />
            ) : (
              <div className="w-32 h-32 rounded-lg bg-black/20 flex items-center justify-center mb-1.5">
                <Loader2 className="w-4 h-4 animate-spin opacity-60" />
              </div>
            )
          ) : (
            <a
              href={attachmentUrl || '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 mb-1.5 px-2 py-1.5 rounded-lg bg-black/20 hover:bg-black/30 text-xs transition-colors"
            >
              <FileText className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{message.attachment_name || 'File'}</span>
            </a>
          )
        )}
        {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}
      </div>
    </div>
  );
}
