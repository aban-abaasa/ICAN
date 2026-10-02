// Display handle for a person: the part of their email before the "@" (the
// mail provider is never shown). Falls back to the input when it has no "@".
export const usernameOf = (value) => {
  const text = String(value || '').trim();
  if (!text) return 'member';
  const at = text.indexOf('@');
  return at > 0 ? text.slice(0, at) : text;
};

export const usernameInitial = (value) => usernameOf(value).charAt(0).toUpperCase() || '?';
