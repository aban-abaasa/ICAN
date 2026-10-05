// Pure helpers for the Security Center: no network, no React, easy to test.

// ------------------------------------------------------------------ devices

/** "Mozilla/5.0 (iPhone; ...) Safari/..." -> { browser, os, kind, label } */
export function describeUserAgent(userAgent) {
  const ua = String(userAgent || '');
  if (!ua.trim()) return { browser: 'Unknown browser', os: 'Unknown system', kind: 'desktop', label: 'Unknown device' };

  let browser = 'Browser';
  if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  else if (/^node|axios|curl|okhttp|python-requests/i.test(ua)) browser = 'App or script';

  let os = 'Unknown system';
  if (/iPhone|iPad|iPod/.test(ua)) os = 'iOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X|Macintosh/.test(ua)) os = 'macOS';
  else if (/CrOS/.test(ua)) os = 'ChromeOS';
  else if (/Linux|X11/.test(ua)) os = 'Linux';

  let kind = 'desktop';
  if (/iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))) kind = 'tablet';
  else if (/iPhone|iPod|Mobile/.test(ua)) kind = 'phone';

  return { browser, os, kind, label: `${browser} on ${os}` };
}

// ----------------------------------------------------------------- activity

const ACTIONS = {
  login: { label: 'Signed in', tone: 'ok' },
  logout: { label: 'Signed out', tone: 'info' },
  user_signedup: { label: 'Account created', tone: 'ok' },
  user_updated_password: { label: 'Password changed', tone: 'info' },
  user_recovery_requested: { label: 'Password reset requested', tone: 'warn' },
  user_reauthenticate_requested: { label: 'Identity check requested', tone: 'info' },
  factor_in_progress: { label: 'Two-step setup started', tone: 'info' },
  factor_unenrolled: { label: 'Two-step verification turned off', tone: 'warn' },
  factor_deleted: { label: 'Two-step verification removed', tone: 'warn' },
  verification_attempted: { label: 'Two-step code entered', tone: 'info' },
  mfa_code_login: { label: 'Signed in with a verification code', tone: 'ok' },
};

export function describeAction(action) {
  return ACTIONS[action] || { label: String(action || 'Activity').replace(/_/g, ' '), tone: 'info' };
}

// ----------------------------------------------------------------- password

const COMMON = ['password', 'qwerty', '123456', 'letmein', 'welcome', 'iloveyou', 'admin', 'abc123', 'ican', 'icanera', 'uganda', 'kampala'];

/**
 * A quick, honest estimate (not a guarantee): length first, then variety, with
 * penalties for obvious words, repeats and sequences.
 * @returns {{ score: 0|1|2|3|4, label: string, tips: string[] }}
 */
export function passwordStrength(password, personal = []) {
  const pw = String(password || '');
  if (!pw) return { score: 0, label: 'Too short', tips: [] };
  const tips = [];
  let points = 0;

  if (pw.length >= 8) points += 1;
  if (pw.length >= 12) points += 1;
  if (pw.length >= 16) points += 1;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(pw)).length;
  if (classes >= 3) points += 1;
  if (classes === 4 && pw.length >= 10) points += 1;

  const lower = pw.toLowerCase();
  const words = [...COMMON, ...personal.map((p) => String(p || '').toLowerCase()).filter((p) => p.length >= 3)];
  if (words.some((w) => lower.includes(w))) { points -= 2; tips.push('Avoid common words and anything about you.'); }
  if (/(.)\1{3,}/.test(pw)) { points -= 1; tips.push('Avoid long runs of the same character.'); }
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|wert|erty)/i.test(pw)) { points -= 1; tips.push('Avoid simple sequences.'); }

  if (pw.length < 8) tips.unshift('Use at least 8 characters.');
  else if (pw.length < 12) tips.push('Longer is stronger: try 12 or more.');
  if (classes < 3) tips.push('Mix upper and lower case, numbers and symbols.');

  const score = pw.length < 8 ? 0 : Math.max(0, Math.min(4, points - 1));
  return { score, label: ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][score], tips: [...new Set(tips)].slice(0, 3) };
}

// ------------------------------------------------------------------- posture

/**
 * Account protection score from real signals. Weights add to 100.
 * @param {{ emailVerified: boolean, mfaEnabled: boolean, pushEnabled: boolean,
 *           passwordAgeDays: (number|null), sessionCount: number, hasPhone: boolean }} s
 */
export function securityPosture(s) {
  const passwordFresh = s.passwordAgeDays !== null && s.passwordAgeDays !== undefined && s.passwordAgeDays <= 365;
  const checks = [
    { key: 'email', weight: 20, ok: Boolean(s.emailVerified), title: 'Email verified',
      good: 'Your email is confirmed, so recovery links reach you.', bad: 'Confirm your email so you can always recover your account.' },
    { key: 'mfa', weight: 30, ok: Boolean(s.mfaEnabled), title: 'Authenticator-app verification',
      good: 'A code from your authenticator app is needed at sign-in.', bad: 'Add a second step so a stolen password alone is not enough.' },
    { key: 'password', weight: 15, ok: passwordFresh, title: 'Recently set password',
      good: 'Your password was set or changed within the last year.', bad: 'Change your password. It is over a year old, or its age is unknown.' },
    { key: 'sessions', weight: 15, ok: s.sessionCount <= 3, title: 'Few signed-in devices',
      good: `${s.sessionCount} device${s.sessionCount === 1 ? '' : 's'} signed in.`, bad: `${s.sessionCount} devices are signed in. Sign out the ones you do not use.` },
    { key: 'push', weight: 10, ok: Boolean(s.pushEnabled), title: 'Alerts on this phone',
      good: 'You will see account alerts even when the app is closed.', bad: 'Turn on phone alerts so important notices reach you.' },
    { key: 'phone', weight: 10, ok: Boolean(s.hasPhone), title: 'Recovery phone number',
      good: 'A phone number is on file for account recovery.', bad: 'Add a phone number to your profile for recovery.' },
  ];
  const score = checks.reduce((sum, c) => sum + (c.ok ? c.weight : 0), 0);
  return { score, checks, level: score >= 85 ? 'Excellent' : score >= 65 ? 'Good' : score >= 40 ? 'Fair' : 'At risk' };
}

/** Days since the newest of the given dates, or null when none is usable. */
export function daysSinceNewest(dates, now = Date.now()) {
  const times = dates.map((d) => (d ? new Date(d).getTime() : NaN)).filter(Number.isFinite);
  if (!times.length) return null;
  return Math.floor((now - Math.max(...times)) / 86400000);
}
