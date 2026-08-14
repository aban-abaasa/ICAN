// QR codes must always target the deployed site. During local development,
// window.location.origin would otherwise embed localhost, which a visitor's
// phone cannot reach.
export const publicAppUrl = () => 'https://icanera.space';
