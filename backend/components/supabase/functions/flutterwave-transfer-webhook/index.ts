import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Receives async transfer confirmations from Flutterwave and finalizes (or
// refunds) the matching request row — either an ICAN cash-out
// (ican_payout_requests, via resolve_ican_payout) or a fiat mobile-money
// send to another person (ican_fiat_send_requests, via
// resolve_fiat_momo_send), disambiguated by the reference prefix each of
// those tables' request functions generates ("PAYOUT-" / "MOMOSEND-").
// Configure this URL in Flutterwave Dashboard > Settings > Webhooks, and set
// the same secret there and in FLUTTERWAVE_WEBHOOK_SECRET.
//
// Uses timing-safe signature comparison — a straight `===` on a webhook
// secret would leak timing information an attacker could use to forge it.

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed." }, 405);
  }

  const webhookSecret = Deno.env.get("FLUTTERWAVE_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!webhookSecret || !supabaseUrl || !serviceRoleKey) {
    console.error("flutterwave-transfer-webhook: missing server configuration.");
    return jsonResponse({ success: false, error: "Server misconfigured." }, 500);
  }

  const signature = req.headers.get("verif-hash");
  if (!signature || !timingSafeEqual(signature, webhookSecret)) {
    console.warn("flutterwave-transfer-webhook: invalid or missing signature.");
    return jsonResponse({ success: false, error: "Invalid signature." }, 401);
  }

  try {
    const payload = await req.json().catch(() => null);
    if (!payload) {
      return jsonResponse({ success: false, error: "Invalid JSON body." }, 400);
    }

    // Flutterwave sends this event for both successful and failed transfers.
    if (payload.event !== "transfer.completed") {
      return jsonResponse({ success: true, message: "Event ignored." });
    }

    const data = payload.data;
    const reference: string | undefined = data?.reference;
    const status: string | undefined = data?.status;

    if (!reference || !status) {
      return jsonResponse({ success: false, error: "Missing reference or status in webhook payload." }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const succeeded = status === "SUCCESSFUL";
    const failureReason = succeeded ? null : (data?.complete_message || `Transfer status: ${status}`);

    // Route to the right resolver by reference prefix — the two request
    // functions (request_ican_payout / request_fiat_momo_send) each stamp
    // their own prefix, so this never has to guess or check both tables.
    const isFiatSend = reference.startsWith("MOMOSEND-");
    const rpcName = isFiatSend ? "resolve_fiat_momo_send" : "resolve_ican_payout";

    const { data: result, error } = await adminClient.rpc(rpcName, {
      p_reference: reference,
      p_success: succeeded,
      p_flutterwave_transfer_id: data?.id ? String(data.id) : null,
      p_failure_reason: failureReason,
    });

    if (error) {
      console.error(`flutterwave-transfer-webhook: ${rpcName} error:`, error);
      return jsonResponse({ success: false, error: "Failed to resolve transfer." }, 500);
    }

    // "already resolved" is expected on webhook retries — acknowledge either way.
    return jsonResponse({ success: true, resolved: result?.success ?? false });
  } catch (error) {
    console.error("flutterwave-transfer-webhook error:", error);
    const message = error instanceof Error ? error.message : "Internal server error.";
    return jsonResponse({ success: false, error: message }, 500);
  }
});
