import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Same SHA-256-of-the-raw-token scheme as redeem_pin_reset_token() in
// PIN_RESET_EMAIL_SELFSERVICE.sql, just computed here with Deno's Web Crypto
// API instead of Postgres's pgcrypto.
const sha256Hex = async (raw: string) => {
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, message: "Method not allowed." },
      405,
    );
  }

  try {
    const requestBody = await req.json().catch(() => ({}));
    const token = String(requestBody?.token || "").trim();

    if (!token) {
      return jsonResponse(
        {
          success: false,
          message:
            "Missing deletion token. Request a deletion link from your account's Danger Zone first.",
        },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        {
          success: false,
          message: "Server is missing Supabase configuration.",
        },
        500,
      );
    }

    // This link is opened from the account owner's email inbox, which may be
    // a fresh browser tab with no Supabase session at all — the token itself
    // (mailed only to the account's registered address, see
    // backend/routes/emailRoutes.js POST /api/email/request-account-deletion)
    // is the proof of ownership, exactly like Supabase's own recovery links.
    // Every read/write below therefore goes through the service-role client.
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const tokenHash = await sha256Hex(token);

    const { data: tokenRow, error: tokenLookupError } = await adminClient
      .from("account_deletion_tokens")
      .select("id, user_id, used_at, expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (tokenLookupError) {
      console.error("Deletion token lookup error:", tokenLookupError);
      return jsonResponse(
        { success: false, message: "Failed to verify deletion link." },
        500,
      );
    }

    if (
      !tokenRow ||
      tokenRow.used_at ||
      new Date(tokenRow.expires_at).getTime() <= Date.now()
    ) {
      return jsonResponse(
        {
          success: false,
          message:
            "This deletion link is invalid or has expired. Request a new one from your account's Danger Zone.",
        },
        400,
      );
    }

    const userId = tokenRow.user_id as string;

    // Burn this token (and any other still-live ones for the same user) up
    // front so a slow double-click or a replayed link can't redeem twice.
    await adminClient
      .from("account_deletion_tokens")
      .update({ used_at: new Date().toISOString() })
      .eq("user_id", userId)
      .is("used_at", null);

    await adminClient.from("profiles").delete().eq("id", userId);

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(
      userId,
    );
    if (deleteError) {
      console.error("Delete user error:", deleteError);
      return jsonResponse(
        {
          success: false,
          message: deleteError.message || "Failed to delete account.",
        },
        500,
      );
    }

    return jsonResponse(
      { success: true, message: "Your account has been deleted." },
      200,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Internal server error while deleting account.";
    console.error("Delete account function error:", error);
    return jsonResponse({ success: false, message }, 500);
  }
});
