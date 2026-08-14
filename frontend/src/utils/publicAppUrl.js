// QR codes must always target the deployed site. During local development,
// window.location.origin would otherwise embed localhost, which a visitor's
// phone cannot reach.
export const publicAppUrl = () => {
  const configuredUrl = import.meta.env.VITE_APP_URL?.trim();
  if (configuredUrl) {
    return (/^https?:\/\//i.test(configuredUrl) ? configuredUrl : `https://${configuredUrl}`).replace(/\/+$/, '');
  }
  return window.location.origin;
};
