import React, { useState } from 'react';
import { Check, Paperclip, X } from 'lucide-react';
import { uploadBookingAttachment } from '../../services/siteBookingService';

const INPUT = 'w-full rounded-lg nb-input px-3 py-2 text-sm';

/**
 * The business's own booking questions for a service (its booking form, built in digital-city-era's admin), rendered inline.
 * Answers go back as { field_key: value }: a file answer is the uploaded file's public URL, a multiselect an array of the
 * chosen options, a checkbox a boolean. A file can only be uploaded by a signed-in visitor (`canUpload`), because that is
 * what the storage bucket allows.
 */
export default function SiteBookingFields({ fields, values, onChange, productId, canUpload, onNeedSignIn }) {
  const [uploading, setUploading] = useState({});
  const [uploadErrors, setUploadErrors] = useState({});
  if (!fields || fields.length === 0) return null;

  const setValue = (key, value) => onChange({ ...values, [key]: value });
  const toggle = (key, option) => {
    const current = Array.isArray(values[key]) ? values[key] : [];
    setValue(key, current.includes(option) ? current.filter((o) => o !== option) : [...current, option]);
  };
  const pickFile = async (key, file) => {
    if (!file) return;
    setUploadErrors((e) => ({ ...e, [key]: '' }));
    setUploading((u) => ({ ...u, [key]: true }));
    try {
      setValue(key, await uploadBookingAttachment(productId, file));
    } catch (err) {
      setUploadErrors((e) => ({ ...e, [key]: err.message || 'Upload failed' }));
    } finally {
      setUploading((u) => ({ ...u, [key]: false }));
    }
  };

  return (
    <div className="space-y-2.5">
      {fields.map((f) => {
        const value = values[f.field_key] ?? '';
        const label = `${f.label}${f.is_required ? ' *' : ''}`;

        if (f.field_type === 'checkbox') {
          return (
            <label key={f.id} className="flex items-center gap-2 text-sm nb-text">
              <input type="checkbox" checked={value === true || value === 'true'} onChange={(e) => setValue(f.field_key, e.target.checked)} className="w-4 h-4" />
              {label}
            </label>
          );
        }
        if (f.field_type === 'multiselect') {
          const chosen = Array.isArray(values[f.field_key]) ? values[f.field_key] : [];
          return (
            <div key={f.id} className="space-y-1.5">
              <p className="text-sm nb-text">{label}</p>
              <div className="flex flex-wrap gap-1.5">
                {(f.options || []).map((opt) => (
                  <button key={opt} type="button" aria-pressed={chosen.includes(opt)} onClick={() => toggle(f.field_key, opt)}
                    className={`text-xs px-2.5 py-1.5 rounded-full border transition-colors ${chosen.includes(opt) ? 'nb-option-selected' : 'nb-surface-alt nb-border nb-text-muted'}`}>
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          );
        }
        if (f.field_type === 'select') {
          return (
            <select key={f.id} value={value} onChange={(e) => setValue(f.field_key, e.target.value)} aria-label={f.label} className={INPUT}>
              <option value="">{label}</option>
              {(f.options || []).map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          );
        }
        if (f.field_type === 'textarea') {
          return <textarea key={f.id} value={value} onChange={(e) => setValue(f.field_key, e.target.value)} placeholder={label} aria-label={f.label} rows={2} className={`${INPUT} resize-none`} />;
        }
        if (f.field_type === 'file') {
          const busy = !!uploading[f.field_key];
          if (!canUpload) {
            return (
              <button key={f.id} type="button" onClick={onNeedSignIn} className="w-full flex items-center gap-2 text-sm rounded-lg border border-dashed nb-border nb-surface-alt nb-text-muted px-3 py-2 text-left">
                <Paperclip className="w-4 h-4 shrink-0" /><span className="flex-1">{label}</span><span className="text-xs font-semibold nb-link">Sign in to attach</span>
              </button>
            );
          }
          return (
            <div key={f.id} className="space-y-1">
              <label className={`flex items-center gap-2 text-sm rounded-lg border px-3 py-2 cursor-pointer ${value ? 'nb-option-selected' : 'nb-surface-alt nb-border nb-text-muted'}`}>
                {value ? <Check className="w-4 h-4 shrink-0" /> : <Paperclip className="w-4 h-4 shrink-0" />}
                <span className="truncate flex-1">{busy ? 'Uploading…' : value ? `${f.label}: attached` : label}</span>
                {value && !busy && (
                  <button type="button" aria-label="Remove the file" onClick={(e) => { e.preventDefault(); setValue(f.field_key, ''); }} className="nb-text-faint"><X className="w-4 h-4" /></button>
                )}
                <input type="file" accept="image/*,application/pdf" disabled={busy} onChange={(e) => pickFile(f.field_key, e.target.files?.[0])} className="hidden" />
              </label>
              {uploadErrors[f.field_key] && <p className="text-xs text-rose-500" role="alert">{uploadErrors[f.field_key]}</p>}
            </div>
          );
        }
        const type = { number: 'number', date: 'date', phone: 'tel', email: 'email' }[f.field_type] || 'text';
        return <input key={f.id} type={type} value={value} onChange={(e) => setValue(f.field_key, e.target.value)} placeholder={label} aria-label={f.label} className={INPUT} />;
      })}
    </div>
  );
}
