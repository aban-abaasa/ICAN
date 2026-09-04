/**
 * Shared caption renderer for status viewers (FullscreenStatusViewer,
 * PublicStatusViewer). Fixes three things that plain `{caption}` text had:
 *  - A fixed huge font (text-4xl) with no width cap or word-wrap overflowed
 *    the card on anything longer than a short quote, visually clipping text.
 *  - Raw URLs/phone numbers rendered as unbroken literal text instead of
 *    real inline links.
 *  - No way to collapse a long caption (a full announcement/job body) to a
 *    few lines with a "See more"/"See less" toggle.
 */
import React from 'react';

// URLs are matched and pulled out first so the phone regex (run only on the
// leftover plain-text segments) never mistakes digits inside a URL for a
// phone number.
const URL_RE = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
const PHONE_RE = /(\+?\d[\d\s-]{7,}\d)/g;

const linkifyPlainSegment = (text, keyPrefix) => {
  const parts = text.split(PHONE_RE);
  if (parts.length === 1) return text;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <a
        key={`${keyPrefix}-tel-${i}`}
        href={`tel:${part.replace(/[^\d+]/g, '')}`}
        className="underline underline-offset-2"
        onClick={(e) => e.stopPropagation()}
      >
        {part}
      </a>
    ) : (
      part
    )
  );
};

/** Turns URLs/phone numbers in plain text into real inline links, everything
 * else stays as normal wrapped sentence text. */
export const linkifyCaption = (text) => {
  if (!text) return null;
  return String(text)
    .split(URL_RE)
    .map((segment, i) =>
      i % 2 === 1 ? (
        <a
          key={`url-${i}`}
          href={segment.startsWith('http') ? segment : `https://${segment}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 break-all"
          onClick={(e) => e.stopPropagation()}
        >
          {segment}
        </a>
      ) : (
        <React.Fragment key={`text-${i}`}>{linkifyPlainSegment(segment, i)}</React.Fragment>
      )
    );
};

// A caption only reads well as a giant centered "quote" when it's actually
// short -- once it runs to a paragraph (a job posting, an announcement
// body), a fixed huge font just overflows the card, so size steps down as
// length grows instead of staying fixed regardless of content.
const sizeClassFor = (length, variant) => {
  if (variant === 'overlay') return 'text-xl';
  if (variant !== 'big') return 'text-base sm:text-lg';
  if (length <= 60) return 'text-4xl';
  if (length <= 140) return 'text-2xl';
  if (length <= 320) return 'text-lg';
  return 'text-base';
};

const StatusCaptionText = ({
  text,
  expanded = false,
  onToggle,
  variant = 'plain', // 'overlay' (fixed text-xl, for captions over media) | 'big' (steps 4xl->base, for background-only) | 'plain'
  clampLines = 2,
  className = ''
}) => {
  if (!text) return null;
  const collapsible = text.length > 80;

  return (
    <div className={className} onClick={onToggle ? (e) => { e.stopPropagation(); onToggle(); } : undefined}>
      <p
        className={`${sizeClassFor(text.length, variant)} font-bold text-white text-center leading-snug whitespace-pre-wrap break-words [overflow-wrap:anywhere]`}
        style={
          collapsible && !expanded
            ? { display: '-webkit-box', WebkitLineClamp: clampLines, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
            : undefined
        }
      >
        {linkifyCaption(text)}
      </p>
      {collapsible && (
        <span className="inline-block mt-1 text-xs font-semibold text-white/80 bg-black/40 backdrop-blur-sm px-3 py-0.5 rounded-full">
          {expanded ? 'See less' : 'See more'}
        </span>
      )}
    </div>
  );
};

export default StatusCaptionText;
