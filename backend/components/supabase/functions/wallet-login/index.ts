import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Byte-for-byte port of hashPIN()/verifyPIN() from
// frontend/src/services/walletAccountService.js — must stay identical so
// this re-verifies PINs users already set through that service. Not a real
// cryptographic hash; see the wallet-login plan's "known limitation" note.
const hashPIN = (pin: string): string => {
  const string = `pin-${pin}-salt-ican-hash`;
  let hash = 0;
  for (let i = 0; i < string.length; i++) {
    const char = string.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return btoa(`hash-${Math.abs(hash)}-${pin.length}`);
};

const verifyPIN = (pin: string, hash: string) => hashPIN(pin) === hash;

const PIN_LOCK_ATTEMPTS = 3;
const PIN_LOCK_MINUTES = 30;

// phone_number is stored exactly as the user typed it at account setup
// (walletAccountService.js applies no normalization), so a login attempt
// typed in a different but equivalent format — "0771234567" vs "256771234567"
// vs "+256771234567" — would silently miss an exact-match lookup and surface
// to the user as a bare "Edge Function returned a non-2xx status code."
// Widen the lookup to the equivalent local/international forms instead.
const phoneLookupVariants = (raw: string): string[] => {
  const digits = raw.replace(/\D/g, "");
  const variants = new Set<string>([raw]);
  if (!digits) return Array.from(variants);
  variants.add(digits);

  if (digits.startsWith("256") && digits.length > 3) {
    const local = digits.slice(3);
    variants.add(`0${local}`);
    variants.add(`+256${local}`);
  } else if (digits.startsWith("0") && digits.length > 1) {
    const local = digits.slice(1);
    variants.add(`256${local}`);
    variants.add(`+256${local}`);
  } else if (digits.length === 9) {
    variants.add(`0${digits}`);
    variants.add(`256${digits}`);
    variants.add(`+256${digits}`);
  }

  return Array.from(variants);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed." }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const identifier = String(body?.identifier || "").trim();
    const pin = String(body?.pin || "").trim();

    if (!identifier || !/^\d{4,6}$/.test(pin)) {
      return jsonResponse({ success: false, error: "Enter your account number (or phone) and PIN." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ success: false, error: "Server is missing Supabase configuration." }, 500);
    }

    // Pre-auth caller has no auth.uid() to satisfy user_accounts' RLS
    // policies, and pin_hash must never reach the client anyway — every
    // read/write below goes through the service-role client, same as
    // delete-account's token-proves-ownership flow.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let account: Record<string, unknown> | null = null;

    const { data: byNumber, error: byNumberError } = await adminClient
      .from("user_accounts")
      .select("id, user_id, email, status, pin_hash, pin_attempts, pin_locked_until")
      .eq("account_number", identifier)
      .maybeSingle();

    if (byNumberError) {
      console.error("wallet-login account_number lookup error:", byNumberError);
      return jsonResponse({ success: false, error: "Failed to look up account." }, 500);
    }

    if (byNumber) {
      account = byNumber;
    } else {
      const { data: byPhone, error: byPhoneError } = await adminClient
        .from("user_accounts")
        .select("id, user_id, email, status, pin_hash, pin_attempts, pin_locked_until")
        .in("phone_number", phoneLookupVariants(identifier))
        .eq("status", "active");

      if (byPhoneError) {
        console.error("wallet-login phone lookup error:", byPhoneError);
        return jsonResponse({ success: false, error: "Failed to look up account." }, 500);
      }

      if (byPhone && byPhone.length === 1) {
        account = byPhone[0];
      } else if (byPhone && byPhone.length > 1) {
        return jsonResponse(
          { success: false, error: "Multiple accounts share that phone number — sign in with your account number instead." },
          400,
        );
      }
    }

    if (!account) {
      return jsonResponse({ success: false, error: "No wallet account found for that account number or phone." }, 404);
    }

    if (account.status !== "active") {
      return jsonResponse({ success: false, error: "This wallet account is not active." }, 403);
    }

    if (account.pin_locked_until && new Date(account.pin_locked_until as string) > new Date()) {
      return jsonResponse({ success: false, error: "Account locked due to too many failed PIN attempts. Try again later." }, 423);
    }

    if (!account.pin_hash) {
      return jsonResponse({ success: false, error: "PIN not set up yet for this wallet account." }, 400);
    }

    if (!verifyPIN(pin, account.pin_hash as string)) {
      const newAttempts = ((account.pin_attempts as number) || 0) + 1;
      const lockedUntil =
        newAttempts >= PIN_LOCK_ATTEMPTS
          ? new Date(Date.now() + PIN_LOCK_MINUTES * 60 * 1000).toISOString()
          : null;

      await adminClient
        .from("user_accounts")
        .update({ pin_attempts: newAttempts, pin_locked_until: lockedUntil })
        .eq("id", account.id);

      return jsonResponse(
        {
          success: false,
          error: lockedUntil
            ? "Account locked due to too many failed PIN attempts. Try again later."
            : `Incorrect PIN. Attempts remaining: ${PIN_LOCK_ATTEMPTS - newAttempts}`,
        },
        401,
      );
    }

    if (!account.email) {
      return jsonResponse({ success: false, error: "This wallet account has no email on file — contact support." }, 400);
    }

    await adminClient
      .from("user_accounts")
      .update({ pin_attempts: 0, pin_locked_until: null })
      .eq("id", account.id);

    const { data: linkData, error: linkError } = await adminClient.auth.admin.generateLink({
      type: "magiclink",
      email: account.email as string,
    });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error("wallet-login generateLink error:", linkError);
      return jsonResponse({ success: false, error: "Could not start a session. Try again." }, 500);
    }

    return jsonResponse({
      success: true,
      email: account.email,
      token_hash: linkData.properties.hashed_token,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error during wallet login.";
    console.error("wallet-login function error:", error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
