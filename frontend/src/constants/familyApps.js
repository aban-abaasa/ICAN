// The IcanEra family of apps as the "Ask us" chat on the GODMINDERA website names them. Ids are the ones the assistant API uses
// (api/_lib/familyKnowledge.js, kept equal by tests/familySupport.test.js); the addresses come back from the API as vetted links.
export const FAMILY_APPS = Object.freeze([
  { id: 'icanera', name: 'IcanEra' },
  { id: 'supermartkera', name: 'SupermartKera' },
  { id: 'bodagoera', name: 'BodaGoEra' },
  { id: 'agribone', name: 'AgriBone' },
]);

export const familyAppName = (id) => FAMILY_APPS.find((app) => app.id === id)?.name || null;

/** ?ask=bodagoera on the GODMINDERA site opens the chat about that app; ?ask (or ?ask=1) just opens it. */
export const parseAskParam = (search) => {
  try {
    const params = new URLSearchParams(search || '');
    if (!params.has('ask')) return null;
    const value = String(params.get('ask') || '').trim().toLowerCase();
    return { open: true, app: FAMILY_APPS.some((app) => app.id === value) ? value : null };
  } catch {
    return null;
  }
};
