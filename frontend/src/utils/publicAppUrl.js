// QR codes must always target the deployed site. During local development,
// window.location.origin would otherwise embed localhost, which a visitor's
// phone cannot reach.
export const publicAppUrl = () => 'https://icanera.space';

// Helper function to get the full public URL with a path
export const getPublicAppUrl = (path = '') => {
  const baseUrl = publicAppUrl();
  return path ? `${baseUrl}${path.startsWith('/') ? path : '/' + path}` : baseUrl;
};
