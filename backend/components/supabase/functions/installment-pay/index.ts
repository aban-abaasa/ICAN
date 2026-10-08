import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Finishes an instalment (or delivery-fee) payment on an installment plan that
// was paid with Flutterwave Mobile Money, card or bank.
//
// Public on purpose (verify_jwt = false, see config.toml), exactly like
// guest-checkout-pay: nothing in the request is trusted. The plan, the amount
// and the customer were fixed server-side by installment_pay_start() when the
// customer was signed in; this function only proceeds after Flutterwave itself
// confirms a successful UGX payment of at least that charge under that
// payment's tx_ref. The tx_ref is an unguessable random token, and all it can
// ever reveal is the outcome of the one payment it belongs to.
//
// Flow: verify payment -> installment_fulfil_payment() (turns the verified
// money into wallet coins and applies them to the plan, atomically; for a
// delivery fare it also sends the order out) -> on failure, refund the payment.
// Re-callable with the same tx_ref (a customer who closed the tab can resume):
// a paid one just reports its plan, a failed one retries the refund.

const FLW = "https://api.flutterwave.com/v3";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed." }, 405);

  try {
    const { tx_ref, transaction_id } = await req.json();
    if (typeof tx_ref !== "string" || !/^INS-[A-Z0-9]{20}$/.test(tx_ref)) {
      return jsonResponse({ success: false, error: "Invalid payment reference." }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const flwSecret = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
    if (!supabaseUrl || !serviceRoleKey || !flwSecret) {
      return jsonResponse({ success: false, error: "Server is missing required configuration." }, 500);
    }
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const flwHeaders = { Authorization: `Bearer ${flwSecret}`, "Content-Type": "application/json" };

    const { data: payment, error: payError } = await admin
      .from("installment_payments").select("*").eq("tx_ref", tx_ref).maybeSingle();
    if (payError || !payment) return jsonResponse({ success: false, error: "Payment not found." }, 404);

    if (payment.status === "paid") {
      const { data: plan } = await admin.from("installment_plans").select("code, status").eq("id", payment.plan_id).maybeSingle();
      return jsonResponse({ success: true, already_processed: true, code: plan?.code, status: plan?.status });
    }
    if (payment.status === "refunded") {
      return jsonResponse({
        success: false,
        error: payment.error || "This payment could not be applied and has been refunded.",
      });
    }

    // ── 1. Ask Flutterwave whether this payment was really made. ───────────
    const verifyUrl = transaction_id
      ? `${FLW}/transactions/${encodeURIComponent(String(transaction_id))}/verify`
      : `${FLW}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx_ref)}`;
    const verifyRes = await fetch(verifyUrl, { headers: flwHeaders });
    const verifyBody = await verifyRes.json().catch(() => null);
    const flw = verifyBody?.data;

    const paid = verifyRes.ok && flw &&
      flw.status === "successful" &&
      flw.tx_ref === tx_ref &&
      (flw.currency ?? "UGX") === "UGX" &&
      Number(flw.amount ?? 0) >= Number(payment.charge_ugx) - 1;
    if (!paid) {
      return jsonResponse({
        success: false,
        error: "We couldn't confirm this payment. If money left your account it will be returned automatically — otherwise just try again.",
      });
    }
    const flwId = String(flw.id);
    const paidUgx = Number(flw.amount);

    // ── 2. Apply it to the plan (atomic; on failure nothing is kept). ──────
    const { data: result, error: fulfilError } = await admin.rpc("installment_fulfil_payment", {
      p_tx_ref: tx_ref,
      p_flw_transaction_id: flwId,
      p_paid_ugx: paidUgx,
    });
    if (fulfilError) {
      console.error("installment_fulfil_payment error:", fulfilError);
      return jsonResponse({
        success: false,
        error: "Your payment went through but we couldn't apply it yet. Please retry in a minute — you won't be charged twice.",
      }, 500);
    }
    if (result?.success) return jsonResponse(result);

    if (!result?.refund_required) {
      return jsonResponse({ success: false, error: String(result?.error ?? "Payment could not be applied.") });
    }

    // ── 3. It could not be applied after being paid: refund it in full. ────
    const refundRes = await fetch(`${FLW}/transactions/${flwId}/refund`, {
      method: "POST", headers: flwHeaders, body: JSON.stringify({ amount: paidUgx }),
    }).catch(() => null);
    const refundBody = await refundRes?.json().catch(() => null);
    if (refundRes?.ok && refundBody?.status === "success") {
      await admin.rpc("installment_mark_refunded", {
        p_tx_ref: tx_ref,
        p_note: `Flutterwave refund of UGX ${paidUgx} requested`,
      });
      return jsonResponse({
        success: false,
        refunded: true,
        error: `${result.error ?? "The payment could not be applied"}. Your payment of UGX ${paidUgx.toLocaleString()} is being refunded.`,
      });
    }
    console.error("refund failed", tx_ref, flwId, refundBody);
    return jsonResponse({
      success: false,
      error: `${result.error ?? "The payment could not be applied"}. We could not return your payment automatically — contact support with reference ${tx_ref}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error.";
    console.error("installment-pay error:", error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
