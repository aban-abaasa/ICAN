import React, { useEffect, useRef, useState } from 'react';
import { Check, Clipboard, ExternalLink, Globe, Loader2, Pencil, X } from 'lucide-react';
import { InfoTip } from './CmmsFold.jsx';
import { checkSiteSlug, saveSiteSlug } from '../services/businessSiteLinkService';
import { buildBusinessSiteUrl, displayBusinessSiteUrl, siteSlugProblem, suggestSiteSlug } from '../utils/businessSiteUrl';

/**
 * "Your website address": the business's public site at icanera.space/<business-name>, with a box to choose another one.
 *
 * The address is made once from the business name and then stays put (renaming the business never breaks a printed QR). Choosing a
 * different one is checked live (3-60 letters/numbers/hyphens, not an app page, not someone else's) and the old address keeps opening
 * the same site. The database repeats every check; this only explains them early.
 *
 * Props: company { id, company_name }, slug (current address or null), onSaved(newSlug).
 */
export default function BusinessSiteAddress({ company, slug, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState({ state: 'idle', message: '' }); // idle | checking | ok | bad
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const checkToken = useRef(0);

  const link = buildBusinessSiteUrl({ slug, companyId: company?.id });

  const startEditing = () => {
    setDraft(slug || suggestSiteSlug(company?.company_name));
    setStatus({ state: 'idle', message: '' });
    setError('');
    setEditing(true);
  };

  // Live check, a moment after the person stops typing. The local rules answer instantly; the database answers "is it taken?".
  useEffect(() => {
    if (!editing) return undefined;
    const value = draft.trim().toLowerCase();
    if (!value || value === slug) { setStatus({ state: 'idle', message: '' }); return undefined; }
    const local = siteSlugProblem(value);
    if (local) { setStatus({ state: 'bad', message: local }); return undefined; }
    setStatus({ state: 'checking', message: 'Checking…' });
    const token = ++checkToken.current;
    const timer = setTimeout(async () => {
      const result = await checkSiteSlug(value, company?.id);
      if (token !== checkToken.current) return;
      setStatus(result.available ? { state: 'ok', message: 'Available' } : { state: 'bad', message: result.reason || 'Not available.' });
    }, 400);
    return () => clearTimeout(timer);
  }, [draft, editing, slug, company?.id]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', link);
    }
  };

  const save = async () => {
    const value = draft.trim().toLowerCase();
    setSaving(true);
    setError('');
    const result = await saveSiteSlug(company.id, value);
    setSaving(false);
    if (!result.success) { setError(result.error); return; }
    setEditing(false);
    onSaved?.(result.slug);
  };

  const canSave = status.state === 'ok' && !saving;

  return (
    <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'rgba(196,160,82,0.28)' }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="cmms-classic-label flex-1 flex items-center gap-1.5"><Globe className="h-4 w-4" /> Your website address</span>
        <InfoTip label="About your website address">
          This is the public page of your business: your announcements, jobs, products and contact details. Share it, print it on receipts and QR codes, or give it to Google as your website. It is made from your business name and stays the same if you rename the business. If you choose another one, the old address keeps working.
        </InfoTip>
      </div>

      {!editing && (
        <>
          <a href={link} target="_blank" rel="noreferrer" className="cmms-classic-text block break-all text-sm font-semibold underline">
            {slug ? displayBusinessSiteUrl(slug) : link.replace(/^https?:\/\//, '')}
          </a>
          {!slug && (
            <p className="cmms-classic-muted text-xs">Your readable address is being set up. This link already opens your site.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copy} className="cmms-classic-btn-secondary flex items-center gap-1.5 !px-3 !py-1.5 text-xs">
              {copied ? <><Check className="h-3.5 w-3.5" /> Copied</> : <><Clipboard className="h-3.5 w-3.5" /> Copy link</>}
            </button>
            <a href={link} target="_blank" rel="noreferrer" className="cmms-classic-btn-secondary flex items-center gap-1.5 !px-3 !py-1.5 text-xs">
              <ExternalLink className="h-3.5 w-3.5" /> Open
            </a>
            {slug && (
              <button type="button" onClick={startEditing} className="cmms-classic-btn-secondary flex items-center gap-1.5 !px-3 !py-1.5 text-xs">
                <Pencil className="h-3.5 w-3.5" /> Change
              </button>
            )}
          </div>
        </>
      )}

      {editing && (
        <div className="space-y-2">
          <div className="flex items-stretch">
            <span className="cmms-classic-muted flex items-center rounded-l-[10px] border border-r-0 px-2 text-sm" style={{ borderColor: 'rgba(196, 160, 82, 0.45)' }}>icanera.space/</span>
            <input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value.toLowerCase().replace(/\s+/g, '-'))}
              maxLength={60}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              aria-label="Website address"
              className="cmms-classic-field min-w-0 flex-1 !rounded-l-none"
            />
          </div>
          <p className={`flex items-center gap-1.5 text-xs ${status.state === 'ok' ? 'cmms-tone-ok' : status.state === 'bad' ? 'cmms-tone-bad' : 'cmms-classic-muted'}`} role="status">
            {status.state === 'checking' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {status.state === 'ok' && <Check className="h-3.5 w-3.5" />}
            {status.state === 'bad' && <X className="h-3.5 w-3.5" />}
            {status.message || 'Letters, numbers and single hyphens, 3 to 60 characters.'}
          </p>
          <p className="cmms-classic-muted text-xs">Your current address will keep opening your site, so printed QR codes and shared links keep working.</p>
          {error && <p className="cmms-tone-bad text-xs">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={save} disabled={!canSave} className="cmms-classic-btn-primary flex items-center gap-1.5 !px-3 !py-1.5 text-xs disabled:opacity-40">
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save address
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={saving} className="cmms-classic-btn-secondary !px-3 !py-1.5 text-xs">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
