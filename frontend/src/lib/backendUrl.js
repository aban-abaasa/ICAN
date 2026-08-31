// Resolves the base URL for calls to this project's Vercel serverless
// functions (ICAN/api/**), which is the only backend that's ever actually
// running — there is no local Express server to fall back to.
//
// On Vercel, those functions are deployed at the SAME origin as the built
// frontend, so a relative fetch ('' + path) is what reaches them there.
// In local dev the Vite origin (localhost:3001) has no such functions, so
// local dev must point at the deployed origin instead.
//
// VITE_BACKEND_URL wins when explicitly set (e.g. pointing at a preview
// deployment instead of production).
export const getBackendUrl = () => {
  if (import.meta.env.VITE_BACKEND_URL !== undefined) return import.meta.env.VITE_BACKEND_URL;
  return import.meta.env.DEV ? (import.meta.env.VITE_APP_URL || '') : '';
};

export default getBackendUrl;
