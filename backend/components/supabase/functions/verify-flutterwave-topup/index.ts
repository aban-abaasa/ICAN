import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Verifies a Flutterwave payment server-side and records it in
// wallet_transactions — this is ICAN's general currency wallet (top-ups),
// distinct from the ICAN-coin wallet handled by verify-flutterwave-payment.
// Replaces momoService.js's direct MTN MOMO request-payment call.

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

    const { transaction_id, tx_ref, amount, currency, phone_number, description } = await req.json();

    if (!transaction_id || !tx_ref || !(amount > 0)) {
      return jsonResponse(
        { success: false, error: "transaction_id, tx_ref, and a positive amount are required." },
        400,
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const flutterwaveSecretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");

    if (!supabaseUrl || !serviceRoleKey || !flutterwaveSecretKey) {
      return jsonResponse(
        { success: false, error: "Server is missing required configuration." },
        500,
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Resolve the caller's identity from their own session token — never
    // trust a user_id in the request body.
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

    const isValid =
      paymentData.status === "successful" &&
      amountSettled > 0 &&
      amountSettled >= Number(amount) - 1 && // small tolerance for currency rounding
      paymentData.tx_ref === tx_ref;

    if (!isValid) {
      console.error("Flutterwave verification failed:", {
        status: paymentData.status,
        amountSettled,
        expected: amount,
        txRefMatch: paymentData.tx_ref === tx_ref,
      });
      return jsonResponse({ success: false, error: "Payment could not be verified." }, 400);
    }

    // Step 2: record the transaction. tx_ref is both reference_id and
    // transaction_id's uniqueness guard (see
    // FIX_WALLET_TRANSACTIONS_FOR_FLUTTERWAVE.sql) — a retried call with the
    // same tx_ref hits the unique index and is reported as already processed
    // rather than double-recorded.
    const { error: insertError } = await adminClient.from("wallet_transactions").insert([
      {
        user_id: currentUser.id,
        type: "topup",
        provider: "flutterwave",
        amount: Number(amount),
        currency: currency || paymentData.currency || "UGX",
        reference_id: tx_ref,
        transaction_id: String(transaction_id),
        phone_number: phone_number || paymentData.customer?.phone_number || null,
        description: description || "ICAN Wallet Top-Up via Flutterwave",
        status: "completed",
        metadata: { flutterwave_response: paymentData },
      },
    ]);

    if (insertError) {
      if (insertError.code === "23505") {
        return jsonResponse({
          success: true,
          already_processed: true,
          message: "This payment was already processed.",
        });
      }
      console.error("wallet_transactions insert error:", insertError);
      return jsonResponse(
        { success: false, error: "Payment verified but recording the transaction failed. Contact support." },
        500,
      );
    }

    return jsonResponse({
      success: true,
      transactionId: String(transaction_id),
      amount: Number(amount),
      currency: currency || paymentData.currency || "UGX",
      status: "COMPLETED",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error.";
    console.error("verify-flutterwave-topup error:", error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
