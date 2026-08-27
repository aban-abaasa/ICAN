// Resolves the base URL for calls to the Express dev backend
// (ICAN/backend/server.js) and to this project's Vercel serverless
// functions (ICAN/api/**).
//
// The two run in genuinely different places:
// - Locally, Vite (frontend) and the Express server run on different
//   ports/origins, so local dev needs an absolute http://localhost:5000.
// - On Vercel, the serverless functions under ICAN/api/** are deployed at
//   the SAME origin as the built frontend — a relative fetch ('' + path)
//   is what actually reaches them. Defaulting to 'http://localhost:5000'
//   in production, like the old inline fallbacks did, resolves to nothing
//   on a real visitor's machine and fails with a bare "Failed to fetch".
//
// VITE_BACKEND_URL still wins when explicitly set (e.g. pointing a local
// frontend at a separately-hosted backend instead of localhost:5000).
export const getBackendUrl = () => {
  if (import.meta.env.VITE_BACKEND_URL !== undefined) return import.meta.env.VITE_BACKEND_URL;
  return import.meta.env.DEV ? 'http://localhost:5000' : '';
};

export default getBackendUrl;
