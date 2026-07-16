import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Receives async transfer confirmations from Flutterwave and finalizes (or
// refunds) the matching ican_payout_requests row via resolve_ican_payout().
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

    const { data: result, error } = await adminClient.rpc("resolve_ican_payout", {
      p_reference: reference,
      p_success: succeeded,
      p_flutterwave_transfer_id: data?.id ? String(data.id) : null,
      p_failure_reason: succeeded ? null : (data?.complete_message || `Transfer status: ${status}`),
    });

    if (error) {
      console.error("flutterwave-transfer-webhook: resolve_ican_payout error:", error);
      return jsonResponse({ success: false, error: "Failed to resolve payout." }, 500);
    }

    // "already resolved" is expected on webhook retries — acknowledge either way.
    return jsonResponse({ success: true, resolved: result?.success ?? false });
  } catch (error) {
    console.error("flutterwave-transfer-webhook error:", error);
    const message = error instanceof Error ? error.message : "Internal server error.";
    return jsonResponse({ success: false, error: message }, 500);
  }
});
