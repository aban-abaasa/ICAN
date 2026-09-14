import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Sends real money from a user's IcanEra fiat wallet balance (wallet_accounts,
// distinct from the ICAN-coin balance) straight to someone else's mobile
// money account, through the Flutterwave Transfers API. Replaces the old
// handleSendViaMOMO() path in ICANWallet.jsx, which called MTN MOMO directly
// and never touched Flutterwave or confirmed the transfer actually landed.
//
// Money-safety invariants (same as flutterwave-payout):
//  - The wallet is only ever debited for the caller's own auth.uid(),
//    resolved server-side from their access token — never a client-supplied
//    id.
//  - If the Flutterwave transfer call itself fails (bad request, network
//    error, unresolvable mobile-money code), the debit is reversed in the
//    same request before responding.
//  - If the transfer is *accepted* by Flutterwave, final settlement is
//    confirmed or refunded asynchronously by flutterwave-transfer-webhook —
//    Transfers are not synchronous, so this function cannot know the final
//    outcome by the time it returns.
//
// Account verification note: Flutterwave has no pre-transfer "resolve
// account name" endpoint for Uganda mobile money (unlike Nigerian bank
// accounts via /accounts/resolve), so a phone number cannot be proven to
// belong to a named person before money moves. The frontend is expected to
// have the sender explicitly confirm the phone number + network first: the
// real verification here is Flutterwave's own acceptance/rejection of the
// transfer, plus the webhook-confirmed final outcome with automatic refund
// on failure.

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

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const flutterwaveSecretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");

  if (!supabaseUrl || !serviceRoleKey || !flutterwaveSecretKey) {
    return jsonResponse({ success: false, error: "Server is missing required configuration." }, 500);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Set once a send-request row exists, so a mid-flight failure after that
  // point can be reversed from the catch block too.
  let reference: string | null = null;

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ success: false, error: "Missing authorization token." }, 401);
    }
    const accessToken = authHeader.replace("Bearer ", "").trim();

    const { data: tokenUserData, error: tokenUserError } = await adminClient.auth.getUser(accessToken);
    const currentUser = tokenUserData?.user;
    if (tokenUserError || !currentUser) {
      return jsonResponse({ success: false, error: "Invalid or expired session." }, 401);
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return jsonResponse({ success: false, error: "Invalid JSON body." }, 400);
    }

    const {
      amount,
      currency,
      recipient_phone,
      recipient_network,
      note,
    } = body;

    const finalCurrency = String(currency || "UGX").toUpperCase();
    if (finalCurrency !== "UGX") {
      return jsonResponse({ success: false, error: "Only UGX mobile money sends are supported right now." }, 400);
    }

    if (!(Number(amount) > 0)) {
      return jsonResponse({ success: false, error: "amount must be a positive number." }, 400);
    }

    if (!recipient_phone || !["MTN", "AIRTEL"].includes(recipient_network)) {
      return jsonResponse(
        { success: false, error: "recipient_phone and recipient_network (MTN or AIRTEL) are required." },
        400,
      );
    }

    const normalizedPhone = String(recipient_phone).trim();

    // Refuse to send to your own registered phone number — an accidental
    // self-send should fail loudly rather than round-trip real money.
    const { data: senderAccount } = await adminClient
      .from("user_accounts")
      .select("phone_number")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (senderAccount?.phone_number && senderAccount.phone_number === normalizedPhone) {
      return jsonResponse({ success: false, error: "Cannot send money to your own phone number." }, 400);
    }

    // Resolve the Flutterwave account_bank code live, same as
    // flutterwave-payout — never a hardcoded guess.
    const banksResponse = await fetch(
      "https://api.flutterwave.com/v3/banks/UG?include_provider_type=1",
      { headers: { Authorization: `Bearer ${flutterwaveSecretKey}` } },
    );
    const banksBody = await banksResponse.json().catch(() => null);
    const banks: Array<{ code: string; name: string }> = banksBody?.data ?? [];

    if (!banksResponse.ok || !Array.isArray(banks) || banks.length === 0) {
      return jsonResponse({ success: false, error: "Could not resolve mobile money network right now." }, 502);
    }

    const match = banks.find((b) => b.name?.toUpperCase().includes(recipient_network));
    if (!match) {
      return jsonResponse({ success: false, error: `${recipient_network} mobile money is not currently supported.` }, 400);
    }
    const accountBank = match.code;

    // Debit the sender's fiat wallet and open the send-request row. Nothing
    // has been sent to Flutterwave yet.
    const { data: requestResult, error: requestError } = await adminClient.rpc("request_fiat_momo_send", {
      p_user_id: currentUser.id,
      p_amount: Number(amount),
      p_currency: finalCurrency,
      p_recipient_phone: normalizedPhone,
      p_recipient_network: recipient_network,
      p_note: note || null,
    });

    if (requestError || !requestResult?.success) {
      return jsonResponse(
        { success: false, error: requestResult?.error || requestError?.message || "Could not start transfer." },
        400,
      );
    }

    reference = requestResult.reference as string;
    const netAmount = Number(requestResult.net_amount);

    const webhookUrl = `${supabaseUrl}/functions/v1/flutterwave-transfer-webhook`;

    const transferResponse = await fetch("https://api.flutterwave.com/v3/transfers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${flutterwaveSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_bank: accountBank,
        account_number: normalizedPhone,
        amount: netAmount,
        currency: finalCurrency,
        narration: note || `IcanEra wallet transfer from ${currentUser.email || "a user"}`,
        reference,
        beneficiary_name: note || "IcanEra mobile money recipient",
        callback_url: webhookUrl,
      }),
    });

    const transferBody = await transferResponse.json().catch(() => null);
    const transferData = transferBody?.data;
    const accepted = transferResponse.ok && transferBody?.status === "success" && transferData?.id;

    if (!accepted) {
      const reason = transferBody?.message || "Flutterwave rejected the transfer request.";
      await adminClient.rpc("resolve_fiat_momo_send", {
        p_reference: reference,
        p_success: false,
        p_failure_reason: reason,
      });
      return jsonResponse({ success: false, error: reason }, 502);
    }

    await adminClient.rpc("mark_fiat_momo_send_processing", {
      p_reference: reference,
      p_flutterwave_transfer_id: String(transferData.id),
    });

    return jsonResponse({
      success: true,
      request_id: requestResult.request_id,
      reference,
      status: "processing",
      amount: requestResult.amount,
      fee: requestResult.fee,
      net_amount: requestResult.net_amount,
      message: "Transfer submitted. It will confirm shortly — if it fails, you'll be refunded automatically.",
    });
  } catch (error) {
    console.error("flutterwave-momo-send error:", error);
    if (reference) {
      try {
        await adminClient.rpc("resolve_fiat_momo_send", {
          p_reference: reference,
          p_success: false,
          p_failure_reason: "Internal server error during transfer initiation.",
        });
      } catch (refundError) {
        console.error("flutterwave-momo-send: refund-on-error also failed:", refundError);
      }
    }
    const message = error instanceof Error ? error.message : "Internal server error.";
    return jsonResponse({ success: false, error: message }, 500);
  }
});
