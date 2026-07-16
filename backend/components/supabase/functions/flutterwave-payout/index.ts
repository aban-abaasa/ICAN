import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Sends ICAN out of the platform: debits the shared ican_user_wallets balance
// (via request_ican_payout, which itself calls sell_ican_coins) then pays UGX
// out to the caller's mobile money or bank account through the Flutterwave
// Transfers API. Callable from all four apps — they all share this Supabase
// project, so one Edge Function serves every frontend.
//
// Money-safety invariants:
//  - The wallet is only ever debited for the caller's own auth.uid(), resolved
//    server-side from their access token — never from a client-supplied id.
//  - If the Flutterwave transfer call itself fails (bad request, network
//    error, unresolvable bank/mobile-money code), the debit is reversed
//    in the same request before responding.
//  - If the transfer is *accepted* by Flutterwave, final settlement is
//    confirmed or refunded asynchronously by flutterwave-transfer-webhook —
//    Transfers are not synchronous, so this function cannot know the final
//    outcome by the time it returns.

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// The 3% cash-out fee is applied inside sell_ican_coins() itself (see
// ICAN_FEE_STRUCTURE_UPDATE.sql) so it's identical whether ICAN is sold via
// the offline "Sell" UI or an automated payout here — no separate fee is
// computed in this function anymore.

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

  // Reference is set once a payout request row exists, so a mid-flight
  // failure after that point can be reversed from the catch block too.
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
      ican_amount,
      channel,
      source_app,
      phone_number,
      network,
      account_number,
      bank_code,
      beneficiary_name,
    } = body;

    const validApps = ["ican", "digital-city-era", "farm-agent", "mybodaguy"];
    if (!validApps.includes(source_app)) {
      return jsonResponse({ success: false, error: "Invalid source_app." }, 400);
    }

    if (!(Number(ican_amount) > 0)) {
      return jsonResponse({ success: false, error: "ican_amount must be a positive number." }, 400);
    }

    if (channel !== "mobilemoneyuganda" && channel !== "bank") {
      return jsonResponse({ success: false, error: "channel must be mobilemoneyuganda or bank." }, 400);
    }

    let destination: Record<string, unknown>;
    if (channel === "mobilemoneyuganda") {
      if (!phone_number || !["MTN", "AIRTEL"].includes(network)) {
        return jsonResponse(
          { success: false, error: "phone_number and network (MTN or AIRTEL) are required." },
          400,
        );
      }
      destination = { type: "mobilemoneyuganda", phone_number, network };
    } else {
      if (!account_number || !bank_code || !beneficiary_name) {
        return jsonResponse(
          { success: false, error: "account_number, bank_code, and beneficiary_name are required." },
          400,
        );
      }
      destination = { type: "bank", account_number, bank_code, beneficiary_name };
    }

    // Resolve the Flutterwave account_bank code live rather than trusting a
    // hardcoded table — Uganda mobile money / bank codes are looked up from
    // Flutterwave's own bank list so a wrong guess never misroutes a payout.
    const banksResponse = await fetch(
      "https://api.flutterwave.com/v3/banks/UG?include_provider_type=1",
      { headers: { Authorization: `Bearer ${flutterwaveSecretKey}` } },
    );
    const banksBody = await banksResponse.json().catch(() => null);
    const banks: Array<{ code: string; name: string }> = banksBody?.data ?? [];

    if (!banksResponse.ok || !Array.isArray(banks) || banks.length === 0) {
      return jsonResponse({ success: false, error: "Could not resolve payout destination codes right now." }, 502);
    }

    let accountBank: string | undefined;
    let accountNumberForTransfer: string;

    if (channel === "mobilemoneyuganda") {
      const match = banks.find((b) => b.name?.toUpperCase().includes(network));
      if (!match) {
        return jsonResponse({ success: false, error: `${network} mobile money is not currently supported.` }, 400);
      }
      accountBank = match.code;
      accountNumberForTransfer = String(phone_number);
    } else {
      const match = banks.find((b) => b.code === String(bank_code));
      if (!match) {
        return jsonResponse({ success: false, error: "Unrecognized bank_code." }, 400);
      }
      accountBank = match.code;
      accountNumberForTransfer = String(account_number);
    }

    // Debit the wallet (via sell_ican_coins under the hood, which applies
    // the 3% cash-out fee itself) and open the payout request row. Nothing
    // has been sent to Flutterwave yet.
    const { data: requestResult, error: requestError } = await adminClient.rpc("request_ican_payout", {
      p_user_id: currentUser.id,
      p_ican_amount: Number(ican_amount),
      p_channel: channel,
      p_destination: destination,
      p_source_app: source_app,
    });

    if (requestError || !requestResult?.success) {
      return jsonResponse(
        { success: false, error: requestResult?.error || requestError?.message || "Could not start payout." },
        400,
      );
    }

    reference = requestResult.reference as string;
    const ugxNet = Number(requestResult.ugx_net);

    const webhookUrl = `${supabaseUrl}/functions/v1/flutterwave-transfer-webhook`;

    const transferResponse = await fetch("https://api.flutterwave.com/v3/transfers", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${flutterwaveSecretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_bank: accountBank,
        account_number: accountNumberForTransfer,
        amount: ugxNet,
        currency: "UGX",
        narration: `ICAN wallet payout (${source_app})`,
        reference,
        beneficiary_name: channel === "bank" ? beneficiary_name : (currentUser.user_metadata?.full_name || currentUser.email),
        callback_url: webhookUrl,
      }),
    });

    const transferBody = await transferResponse.json().catch(() => null);
    const transferData = transferBody?.data;
    const accepted = transferResponse.ok && transferBody?.status === "success" && transferData?.id;

    if (!accepted) {
      const reason = transferBody?.message || "Flutterwave rejected the transfer request.";
      await adminClient.rpc("resolve_ican_payout", {
        p_reference: reference,
        p_success: false,
        p_failure_reason: reason,
      });
      return jsonResponse({ success: false, error: reason }, 502);
    }

    await adminClient.rpc("mark_ican_payout_processing", {
      p_reference: reference,
      p_flutterwave_transfer_id: String(transferData.id),
    });

    return jsonResponse({
      success: true,
      request_id: requestResult.request_id,
      reference,
      status: "processing",
      ugx_gross: requestResult.ugx_gross,
      fee_ugx: requestResult.fee_ugx,
      ugx_net: requestResult.ugx_net,
      message: "Payout submitted. It will complete shortly once Flutterwave confirms.",
    });
  } catch (error) {
    console.error("flutterwave-payout error:", error);
    if (reference) {
      try {
        await adminClient.rpc("resolve_ican_payout", {
          p_reference: reference,
          p_success: false,
          p_failure_reason: "Internal server error during payout initiation.",
        });
      } catch (refundError) {
        console.error("flutterwave-payout: refund-on-error also failed:", refundError);
      }
    }
    const message = error instanceof Error ? error.message : "Internal server error.";
    return jsonResponse({ success: false, error: message }, 500);
  }
});
