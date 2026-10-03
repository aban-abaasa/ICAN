import React, { useEffect, useRef } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { classifyGoogleUrl } from '../../../utils/googleLinks';

/**
 * Shows a Google Form / Drive file inside the app. The address is re-validated here (never
 * trusted from storage), only Google's own embed addresses are ever framed, and the frame
 * is sandboxed with no referrer so nothing about the app leaks to the embedded page.
 */
export default function FramePreview({ link, onClose }) {
  const closeRef = useRef(null);
  const c = classifyGoogleUrl(link.url);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = previous; };
  }, [onClose]);

  if (!c.ok) return null;

  return (
    <div className="gr-modal" role="dialog" aria-modal="true" aria-label={link.title} onClick={onClose}>
      <div className="gr-modal__sheet" onClick={(e) => e.stopPropagation()}>
        <div className="gr-modal__head">
          <div style={{ minWidth: 0 }}>
            <p className="gr-eyebrow">{c.label}</p>
            <h3 className="gr-title gr-h" style={{ overflowWrap: 'anywhere' }}>{link.title}</h3>
          </div>
          <div className="gr-block__actions">
            <a className="gr-icon-btn" href={c.url} target="_blank" rel="noopener noreferrer" aria-label="Open in Google" title="Open in Google"><ExternalLink aria-hidden="true" /></a>
            <button ref={closeRef} type="button" className="gr-icon-btn" onClick={onClose} aria-label="Close"><X aria-hidden="true" /></button>
          </div>
        </div>
        <div className="gr-modal__body">
          {c.embedUrl ? (
            <iframe
              className="gr-frame"
              title={link.title}
              src={c.embedUrl}
              style={{ height: 'min(70dvh, 720px)' }}
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          ) : (
            <div className="gr-empty">
              <ExternalLink aria-hidden="true" />
              <p className="gr-sub">This link type opens in Google, not inside the app.</p>
              <a className="gr-btn gr-btn--primary" href={c.url} target="_blank" rel="noopener noreferrer">Open in Google</a>
            </div>
          )}
          <p className="gr-hint" style={{ marginTop: 8 }}>
            If the page stays blank, its owner has not shared it with you. Open it in Google, or ask them to set sharing to &quot;Anyone with the link&quot;.
          </p>
        </div>
      </div>
    </div>
  );
}
