import React, { useEffect, useMemo, useState } from 'react';
import { CountryService } from '../services/countryService';
import { getNationalIdRule } from '../services/nationalIdService';
import { checkNationalIdFormat, nationalIdFormatMessage } from '../utils/nationalId';

// Class names for the places this field appears. The default skin is the "Wallet Access" card
// (wallet-access-classic.css); callers on other skins pass their own.
const WALLET_ACCESS_CLASSES = {
  label: 'wa-label',
  input: 'wa-input',
  hint: 'wa-small mt-1',
  error: 'wa-alert mt-1',
  wrap: 'space-y-3'
};

/**
 * The national-ID question, in whichever country's terms apply ("NIN" in Uganda, "National ID
 * number" in Kenya, a generic ID elsewhere). The format rule comes from the database, so adding
 * or changing a country needs no app release.
 *
 *   country / onCountryChange   ISO code; the picker is shown unless `countryLocked`
 *   value / onChange            what is typed (normalised and checked again server-side)
 *   classes                     optional { label, input, hint, error, wrap } override
 */
export default function NationalIdField({
  country,
  onCountryChange,
  countryLocked = false,
  value,
  onChange,
  disabled = false,
  idPrefix = 'nid',
  classes
}) {
  const k = { ...WALLET_ACCESS_CLASSES, ...(classes || {}) };
  const [rule, setRule] = useState(null);
  const [touched, setTouched] = useState(false);

  const countries = useMemo(
    () => Object.entries(CountryService.getCountries()).map(([code, c]) => ({ code, name: c.name })).sort((a, b) => a.name.localeCompare(b.name)),
    []
  );

  useEffect(() => {
    let cancelled = false;
    setRule(null);
    if (!country) return undefined;
    getNationalIdRule(country).then((r) => { if (!cancelled) setRule(r); });
    return () => { cancelled = true; };
  }, [country]);

  const check = checkNationalIdFormat(rule, value);
  const showError = touched && !check.empty && !check.ok;
  const countryName = CountryService.getCountry?.(country)?.name || country;

  return (
    <div className={k.wrap}>
      {countryLocked ? (
        country ? <p className={k.hint}>Country: <b>{countryName}</b></p> : null
      ) : (
        <div>
          <label className={k.label} htmlFor={`${idPrefix}-country`}>Country of your ID *</label>
          <select
            id={`${idPrefix}-country`}
            value={country || ''}
            disabled={disabled}
            onChange={(e) => onCountryChange?.(e.target.value)}
            className={k.input}
          >
            <option value="">Choose your country…</option>
            {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </select>
        </div>
      )}

      <div>
        <label className={k.label} htmlFor={`${idPrefix}-value`}>{rule?.label || 'National ID'} *</label>
        <input
          id={`${idPrefix}-value`}
          type="text"
          value={value || ''}
          disabled={disabled || !country}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={() => setTouched(true)}
          placeholder={country ? (rule?.example || 'Enter your ID number') : 'Choose your country first'}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          aria-invalid={showError || undefined}
          aria-describedby={`${idPrefix}-help`}
          className={k.input}
        />
        <p id={`${idPrefix}-help`} className={k.hint}>
          {showError
            ? <span role="alert">{nationalIdFormatMessage(rule)}</span>
            : (rule?.hint ? `${rule.hint}. ` : '')}
          Stored only as a one-way code (we keep just the last 4 characters) and used to protect your wallet.
        </p>
      </div>
    </div>
  );
}
