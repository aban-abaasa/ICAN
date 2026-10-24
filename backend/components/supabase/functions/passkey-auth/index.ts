import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  WebAuthnError,
  b64urlDecode,
  b64urlEncode,
  newChallenge,
  resolveOrigin,
  verifyAssertion,
  verifyRegistration,
} from "../_shared/webauthn.js";

// Fingerprint / face sign-in. The device does the biometric check and signs a one-time challenge; this function only verifies
// that signature against the PUBLIC key stored in public.user_passkeys, then hands back a magic-link token the browser redeems
// into a real session - exactly the way wallet-login does for a wallet PIN. Nothing biometric ever reaches the server.
//
//   register-options  (signed in)  challenge for creating a passkey on this device
//   register-verify   (signed in)  checks the new passkey and stores its public key
//   login-options     (anyone)     challenge for signing in
//   login-verify      (anyone)     checks the device's signature and returns { token_hash }
//
// Setting (optional): PASSKEY_ALLOWED_ORIGINS - comma-separated, e.g. https://app.example.com. Unset = any https site (and
// localhost) may ask; a passkey is still only ever usable on the exact site it was created for.
// Logic that decides whether a signature is good lives in ../_shared/webauthn.js (unit-tested in frontend/tests/webauthn.test.js).

const RP_NAME = "IcanEra";
const CHALLENGE_TTL_MS = 3 * 60 * 1000;
const MAX_LIVE_CHALLENGES = 5000;
const MAX_PASSKEYS_PER_USER = 10;
const TRANSPORTS = ["internal", "hybrid", "usb", "nfc", "ble", "smart-card"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const fail = (error: string, status = 400, extra: Record<string, unknown> = {}) =>
  jsonResponse({ success: false, error, ...extra }, status);

/** A string field within a sane length, or "" - nothing the client sends is trusted to be the right shape. */
const field = (value: unknown, max: number): string =>
  typeof value === "string" && value.length <= max ? value : "";

const allowedOrigins = (Deno.env.get("PASSKEY_ALLOWED_ORIGINS") || "")
  .split(",")
  .map((o) => o.trim().replace(/\/$/, ""))
  .filter(Boolean);

type Admin = ReturnType<typeof createClient>;

async function signedInUser(admin: Admin, req: Request) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error || !data?.user ? null : data.user;
}

/**
 * Turning this on opens a way into the account that outlives the current session, so a session alone is not enough: the
 * person must also prove the password. Otherwise a stolen session could quietly enrol the thief's own device.
 * (Accounts that never had a password - Google-only - rely on the device's own fingerprint/face/PIN check.)
 */
const hasPassword = (user: { email?: string; app_metadata?: Record<string, unknown> }) =>
  Boolean(user.email) && Array.isArray(user.app_metadata?.providers) && (user.app_metadata!.providers as string[]).includes("email");

async function passwordIsCorrect(url: string, anonKey: string, email: string, password: string) {
  const probe = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await probe.auth.signInWithPassword({ email, password });
  if (error || !data?.session) return false;
  // Only this throwaway session - never the default "global" scope, which would sign the person out everywhere.
  await probe.auth.signOut({ scope: "local" }).catch(() => {});
  return true;
}

async function issueChallenge(admin: Admin, p: { purpose: "register" | "login"; userId: string | null; origin: string }) {
  await admin.from("passkey_challenges").delete().lt("expires_at", new Date().toISOString());
  const { count } = await admin.from("passkey_challenges").select("id", { count: "exact", head: true });
  if ((count ?? 0) >= MAX_LIVE_CHALLENGES) throw new WebAuthnError("Too many people are signing in right now. Try again in a minute.");

  const challenge = newChallenge();
  const { data, error } = await admin
    .from("passkey_challenges")
    .insert({
      challenge,
      purpose: p.purpose,
      user_id: p.userId,
      origin: p.origin,
      expires_at: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`could not store challenge: ${error?.message}`);
  return { challengeId: data.id as string, challenge };
}

/** Single use: the row is deleted as it is read, so a challenge can never be answered twice. */
async function consumeChallenge(admin: Admin, p: { id: string; purpose: "register" | "login"; userId: string | null; origin: string }) {
  const outOfDate = new WebAuthnError("That request is out of date. Please try again.");
  if (!UUID.test(p.id)) throw outOfDate;
  const { data } = await admin
    .from("passkey_challenges")
    .delete()
    .eq("id", p.id)
    .select("challenge, purpose, user_id, origin, expires_at")
    .maybeSingle();
  if (
    !data ||
    data.purpose !== p.purpose ||
    data.origin !== p.origin ||
    (data.user_id ?? null) !== p.userId ||
    new Date(data.expires_at as string).getTime() < Date.now()
  ) throw outOfDate;
  return data.challenge as string;
}

const cleanLabel = (value: unknown) =>
  field(value, 80).replace(/[\u0000-\u001f<>]/g, "").trim() || "This device";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return fail("Method not allowed.", 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return fail("Server is missing Supabase configuration.", 500);
    }

    let site: { origin: string; rpId: string };
    try {
      site = resolveOrigin(req.headers.get("origin"), allowedOrigins);
    } catch (error) {
      return fail((error as Error).message, 400);
    }

    // The caller is signed out during sign-in and has no RLS rights on these tables; every read and write goes through the
    // service-role client, the same way wallet-login and delete-account do.
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ------------------------------------------------------------------ register-options
    if (action === "register-options") {
      const user = await signedInUser(admin, req);
      if (!user) return fail("Sign in first, then turn on fingerprint or face sign-in.", 401);

      if (hasPassword(user)) {
        const password = field(body?.password, 256);
        if (!password) return fail("Enter your password to turn this on.", 401, { code: "password_required" });
        if (!(await passwordIsCorrect(supabaseUrl, anonKey, user.email!, password))) {
          return fail("That password is not right.", 401, { code: "wrong_password" });
        }
      }

      const { data: existing, error: existingError } = await admin
        .from("user_passkeys")
        .select("credential_id, transports")
        .eq("user_id", user.id);
      if (existingError) {
        console.error("passkey-auth register-options lookup error:", existingError);
        return fail("Fingerprint and face sign-in is not switched on for this server yet.", 503, { code: "not_installed" });
      }
      if ((existing?.length ?? 0) >= MAX_PASSKEYS_PER_USER) {
        return fail(`You can use fingerprint or face sign-in on up to ${MAX_PASSKEYS_PER_USER} devices. Remove one first.`, 400);
      }

      const { challengeId, challenge } = await issueChallenge(admin, { purpose: "register", userId: user.id, origin: site.origin });
      return jsonResponse({
        success: true,
        challengeId,
        options: {
          challenge,
          rp: { id: site.rpId, name: RP_NAME },
          user: {
            id: b64urlEncode(new TextEncoder().encode(user.id)),
            name: user.email || user.id,
            displayName: (user.user_metadata?.full_name as string) || user.email || "IcanEra member",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: {
            authenticatorAttachment: "platform", // this device's own fingerprint / face
            residentKey: "required", // discoverable: lets sign-in start from nothing but a fingerprint or face
            requireResidentKey: true,
            userVerification: "required",
          },
          attestation: "none",
          timeout: 60000,
          excludeCredentials: (existing || []).map((c) => ({
            type: "public-key",
            id: c.credential_id,
            transports: c.transports || [],
          })),
        },
      });
    }

    // ------------------------------------------------------------------ register-verify
    if (action === "register-verify") {
      const user = await signedInUser(admin, req);
      if (!user) return fail("Sign in first, then turn on fingerprint or face sign-in.", 401);

      const challenge = await consumeChallenge(admin, {
        id: field(body?.challengeId, 64), purpose: "register", userId: user.id, origin: site.origin,
      });

      const credentialId = b64urlDecode(field(body?.credentialId, 2048));
      const publicKey = b64urlDecode(field(body?.publicKey, 2048));
      const alg = Number(body?.publicKeyAlgorithm);

      const { backedUp, signCount } = await verifyRegistration({
        clientDataJSON: b64urlDecode(field(body?.clientDataJSON, 4096)),
        authenticatorData: b64urlDecode(field(body?.authenticatorData, 4096)),
        credentialId,
        publicKey,
        alg,
        expected: { challenge, origin: site.origin, rpId: site.rpId },
      });

      const transports = (Array.isArray(body?.transports) ? body.transports : [])
        .filter((t: unknown) => typeof t === "string" && TRANSPORTS.includes(t));

      const { data: saved, error: saveError } = await admin
        .from("user_passkeys")
        .insert({
          user_id: user.id,
          credential_id: b64urlEncode(credentialId),
          public_key: b64urlEncode(publicKey),
          alg,
          rp_id: site.rpId,
          sign_count: signCount,
          transports,
          backed_up: backedUp,
          label: cleanLabel(body?.label),
        })
        .select("id, label, created_at")
        .single();

      if (saveError) {
        if (saveError.code === "23505") return fail("This device is already set up.", 409);
        console.error("passkey-auth register-verify insert error:", saveError);
        return fail("Could not save this device. Try again.", 500);
      }
      return jsonResponse({ success: true, passkey: saved });
    }

    // ------------------------------------------------------------------ login-options
    if (action === "login-options") {
      const { challengeId, challenge } = await issueChallenge(admin, { purpose: "login", userId: null, origin: site.origin });
      return jsonResponse({
        success: true,
        challengeId,
        options: {
          challenge,
          rpId: site.rpId,
          timeout: 60000,
          userVerification: "required",
          allowCredentials: [], // discoverable credentials: the device offers its own accounts, nothing to type first
        },
      });
    }

    // ------------------------------------------------------------------ login-verify
    if (action === "login-verify") {
      const challenge = await consumeChallenge(admin, {
        id: field(body?.challengeId, 64), purpose: "login", userId: null, origin: site.origin,
      });

      const credentialId = b64urlEncode(b64urlDecode(field(body?.credentialId, 2048)));
      const { data: passkey, error: lookupError } = await admin
        .from("user_passkeys")
        .select("id, user_id, public_key, alg, rp_id, sign_count")
        .eq("credential_id", credentialId)
        .maybeSingle();

      if (lookupError) {
        console.error("passkey-auth login-verify lookup error:", lookupError);
        return fail("Fingerprint and face sign-in is not switched on for this server yet.", 503, { code: "not_installed" });
      }
      if (!passkey || passkey.rp_id !== site.rpId) {
        return fail(
          "This device is not set up for fingerprint or face sign-in. Sign in another way, then turn it on in Security.",
          404,
          { code: "unknown_credential" },
        );
      }

      // The device also names the account it signed in for; it must be the owner of this key.
      const userHandle = field(body?.userHandle, 256);
      if (userHandle && new TextDecoder().decode(b64urlDecode(userHandle)) !== passkey.user_id) {
        return fail("That fingerprint or face could not be verified.", 401);
      }

      let verified;
      try {
        verified = await verifyAssertion({
          clientDataJSON: b64urlDecode(field(body?.clientDataJSON, 4096)),
          authenticatorData: b64urlDecode(field(body?.authenticatorData, 4096)),
          signature: b64urlDecode(field(body?.signature, 4096)),
          credential: {
            publicKey: b64urlDecode(passkey.public_key as string),
            alg: passkey.alg as number,
            rpId: passkey.rp_id as string,
            signCount: Number(passkey.sign_count) || 0,
          },
          expected: { challenge, origin: site.origin },
        });
      } catch (error) {
        if (error instanceof WebAuthnError) return fail(error.message, 401);
        throw error;
      }

      const { data: owner, error: ownerError } = await admin.auth.admin.getUserById(passkey.user_id as string);
      if (ownerError || !owner?.user?.email) {
        return fail("This account has no email on file — contact support.", 400);
      }

      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: "magiclink",
        email: owner.user.email,
      });
      if (linkError || !linkData?.properties?.hashed_token) {
        console.error("passkey-auth generateLink error:", linkError);
        return fail("Could not start a session. Try again.", 500);
      }

      await admin
        .from("user_passkeys")
        .update({ sign_count: verified.signCount, backed_up: verified.backedUp, last_used_at: new Date().toISOString() })
        .eq("id", passkey.id);

      return jsonResponse({
        success: true,
        email: owner.user.email,
        token_hash: linkData.properties.hashed_token,
      });
    }

    return fail("Unknown request.", 400);
  } catch (error) {
    if (error instanceof WebAuthnError) return fail(error.message, 400);
    console.error("passkey-auth function error:", error);
    return fail("Something went wrong. Try again.", 500);
  }
});
