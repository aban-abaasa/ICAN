import React, { useMemo } from 'react';

// A time zone must be a real IANA name such as "Africa/Kampala": the database
// runs `now() AT TIME ZONE <value>` for the CMMS dashboard and attendance
// payroll, and a value like "africa" made those calls fail outright (Postgres
// error 22023, shown as an HTTP 400 on the home-screen Business Activity card).
// A picker instead of a free-text box means only names the database accepts can
// be saved. See CMMS_TIMEZONE_VALIDATION.sql for the matching database check.

const FALLBACK_ZONES = [
  'UTC', 'Africa/Kampala', 'Africa/Nairobi', 'Africa/Dar_es_Salaam', 'Africa/Kigali', 'Africa/Lagos',
  'Africa/Accra', 'Africa/Johannesburg', 'Africa/Cairo', 'Europe/London', 'Asia/Dubai', 'America/New_York'
];

// Very new zones a current browser lists before the database's tz data has them
// (checked against the live database: America/Coyhaique). Picking one would be
// rejected on save, so it is left out until the database catches up.
const NOT_YET_IN_DATABASE = new Set(['America/Coyhaique']);

const listZones = () => {
  try {
    const zones = Intl.supportedValuesOf('timeZone').filter((zone) => !NOT_YET_IN_DATABASE.has(zone));
    return zones.includes('UTC') ? zones : ['UTC', ...zones];
  } catch {
    return FALLBACK_ZONES;
  }
};

export default function TimeZoneSelect({ value, onChange, className = '', required = true }) {
  const zones = useMemo(listZones, []);
  const isKnown = zones.includes(value);

  return (
    <select
      required={required}
      value={isKnown ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      className={className}
    >
      {!isKnown && (
        <option value="">
          {value ? `"${value}" is not a valid time zone — choose one` : 'Choose a time zone'}
        </option>
      )}
      {zones.map((zone) => (
        <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>
      ))}
    </select>
  );
}
