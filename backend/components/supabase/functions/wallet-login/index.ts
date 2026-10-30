import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// RETIRED. This endpoint used to trade a wallet account number (or phone) + a
// 4-6 digit PIN for a full Supabase session (a magic-link token_hash), across
// ICAN, digital-city-era and mybodaguy. That is not safe enough to sign in
// with: a 4-digit PIN has only 10,000 possibilities, the stored PIN hash is a
// weak 32-bit checksum (not a real password hash), the lockout let anyone
// lock a victim out, the replies revealed which numbers have accounts, and a
// session minted this way skipped the account's two-step verification.
//
// Sign in with ICANera instead: the ICANera email + password (rate-limited
// and hashed by Supabase Auth), plus the authenticator-app code when two-step
// verification is on. The wallet PIN stays what it was meant for - approving
// payments from inside a signed-in session.
//
// Kept as a stub, not deleted, so old app builds that still call it get a
// clear 410 instead of a confusing "function not found", and so it can never
// be redeployed with the old behaviour by mistake.
serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return new Response(
    JSON.stringify({
      success: false,
      error: "Wallet PIN sign-in has been retired. Sign in with your ICANera email and password.",
    }),
    { status: 410, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
