import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Verifies a Flutterwave payment server-side (secret key never leaves this
// function) and only then credits the buyer's ICAN wallet via buy_ican_coins
// — which is no longer callable directly by any client, see
// ICAN/backend/CLOSE_BUY_ICAN_DIRECT_CALL_HOLE.sql. Called the same way from
// all four apps (ican, digital-city-era, mybodaguy, farm-agent).

const ICAN_UGX_FLOOR_PRICE = 5000;
const VALID_SOURCE_APPS = ["ican", "digital-city-era", "farm-agent", "mybodaguy"];

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed." }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ success: false, error: "Missing authorization token." }, 401);
    }
    const accessToken = authHeader.replace("Bearer ", "").trim();

    const { transaction_id, tx_ref, ican_amount, source_app } = await req.json();

    if (!transaction_id || !tx_ref || !(ican_amount > 0)) {
      return jsonResponse(
        { success: false, error: "transaction_id, tx_ref, and a positive ican_amount are required." },
        400,
      );
    }

    if (!VALID_SOURCE_APPS.includes(source_app)) {
      return jsonResponse({ success: false, error: "Invalid source_app." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey;
    const flutterwaveSecretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");

    if (!supabaseUrl || !serviceRoleKey || !anonKey || !flutterwaveSecretKey) {
      return jsonResponse(
        { success: false, error: "Server is missing required configuration." },
        500,
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resolve the caller's identity from their own session token — never
    // trust a user_id in the request body, or one client could credit
    // another user's wallet.
    const { data: tokenUserData, error: tokenUserError } =
      await adminClient.auth.getUser(accessToken);
    const currentUser = tokenUserData?.user;

    if (tokenUserError || !currentUser) {
      return jsonResponse({ success: false, error: "Invalid or expired session." }, 401);
    }

    // Step 1: verify the transaction with Flutterwave's API.
    const verifyResponse = await fetch(
      `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
      { headers: { Authorization: `Bearer ${flutterwaveSecretKey}` } },
    );
    const verifyBody = await verifyResponse.json().catch(() => null);
    const paymentData = verifyBody?.data;

    if (!verifyResponse.ok || !paymentData) {
      return jsonResponse(
        { success: false, error: verifyBody?.message || "Flutterwave verification request failed." },
        502,
      );
    }

    const amountSettled = Number(paymentData.amount_settled ?? paymentData.amount ?? 0);
    const expectedUgx = Number(ican_amount) * ICAN_UGX_FLOOR_PRICE;

    const isValid =
      paymentData.status === "successful" &&
      amountSettled > 0 &&
      // Guards against a client requesting more ICAN than it actually paid
      // for. Small tolerance for currency rounding.
      amountSettled >= expectedUgx - 1 &&
      paymentData.tx_ref === tx_ref;

    if (!isValid) {
      console.error("Flutterwave verification failed:", {
        status: paymentData.status,
        amountSettled,
        expectedUgx,
        txRefMatch: paymentData.tx_ref === tx_ref,
      });
      return jsonResponse(
        { success: false, error: "Payment could not be verified." },
        400,
      );
    }

    // Step 2: credit the wallet. buy_ican_coins is service_role-only now, so
    // this is the only path that can reach it.
    const { data: buyResult, error: buyError } = await adminClient.rpc(
      "buy_ican_coins",
      {
        p_user_id: currentUser.id,
        p_ican_amount: ican_amount,
        p_source_app: source_app,
        p_payment_ref: tx_ref,
      },
    );

    if (buyError) {
      // Unique-index conflict on reference_id means this transaction_id was
      // already credited by an earlier (possibly retried) call — report it
      // as success rather than an opaque failure.
      if (buyError.code === "23505") {
        return jsonResponse({
          success: true,
          already_processed: true,
          message: "This payment was already processed.",
        });
      }
      console.error("buy_ican_coins error:", buyError);
      return jsonResponse(
        { success: false, error: "Payment verified but wallet credit failed. Contact support." },
        500,
      );
    }

    return jsonResponse(buyResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error.";
    console.error("verify-flutterwave-payment error:", error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
