import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Finishes a payment made by scanning a digital card's QR (/card-pay/<token>, personal or business)
// with Flutterwave Mobile Money, card or bank — no IcanEra account.
//
// Public on purpose (verify_jwt = false, see config.toml): the payer has no session. It is safe
// because nothing in the request is trusted — the amount, the card and the recipient were fixed
// server-side by card_qr_pay_start(), and this function only proceeds after Flutterwave itself
// confirms a successful UGX payment of at least that charge under that payment's tx_ref. The
// tx_ref is an unguessable random token.
//
// Flow: verify with Flutterwave -> card_qr_fulfil() (credits the holder's wallet and records the
// income, atomically) -> if that fails (e.g. the holder switched the QR off mid-payment), refund
// the payment in full. Re-callable with the same tx_ref: a payer who closed the tab can resume; a
// paid one just gets its receipt back, a failed one retries the refund.

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

    if (typeof tx_ref !== "string" || !/^CQP-[A-Z0-9]{20}$/.test(tx_ref)) {
      return jsonResponse({ success: false, error: "Invalid payment reference." }, 400);
    }

    const { data: payment, error: paymentError } = await admin
      .from("card_qr_payments").select("*").eq("tx_ref", tx_ref).maybeSingle();
    if (paymentError || !payment) return jsonResponse({ success: false, error: "Payment not found." }, 404);

    if (payment.status === "paid") {
      const { data } = await admin.rpc("card_qr_fulfil", {
        p_tx_ref: tx_ref, p_flw_transaction_id: payment.flw_transaction_id ?? "", p_paid_ugx: payment.paid_ugx ?? payment.charge_ugx,
      });
      return jsonResponse({ ...(data ?? {}), success: true, already_processed: true });
    }
    if (payment.status === "refunded") {
      return jsonResponse({
        success: false,
        error: payment.error || "This payment could not be completed and your money was refunded.",
      });
    }

    // ── 1. Ask Flutterwave whether this was really paid. ────────────────────
    const verifyUrl = transaction_id
      ? `${FLW}/transactions/${encodeURIComponent(String(transaction_id))}/verify`
      : `${FLW}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx_ref)}`;
    const verifyRes = await fetch(verifyUrl, { headers: flwHeaders });
    const verifyBody = await verifyRes.json().catch(() => null);
    const paid = verifyBody?.data;

    const confirmed = verifyRes.ok && paid &&
      paid.status === "successful" &&
      paid.tx_ref === tx_ref &&
      (paid.currency ?? "UGX") === "UGX" &&
      Number(paid.amount ?? 0) >= Number(payment.charge_ugx) - 1;
    if (!confirmed) {
      return jsonResponse({
        success: false,
        error: "We couldn't confirm a payment yet. If money left your account it will be returned automatically — otherwise just try again.",
      });
    }
    const flwId = String(paid.id);
    const paidUgx = Number(paid.amount);

    // ── 2. Fulfil (skipped when a previous attempt already failed). ─────────
    let result: Record<string, unknown>;
    if (payment.status === "failed") {
      result = { success: false, error: payment.error, refund_required: true };
    } else {
      const { data, error } = await admin.rpc("card_qr_fulfil", {
        p_tx_ref: tx_ref,
        p_flw_transaction_id: flwId,
        p_paid_ugx: paidUgx,
      });
      if (error) {
        console.error("card_qr_fulfil error:", error);
        return jsonResponse({
          success: false,
          error: "Your payment went through but we couldn't finish recording it. Please retry in a minute — you won't be charged twice.",
        }, 500);
      }
      result = data as Record<string, unknown>;
    }

    if (result.success) return jsonResponse(result);

    if (!result.refund_required) {
      return jsonResponse({ success: false, error: String(result.error ?? "Payment could not be completed.") });
    }

    // ── 3. Couldn't be applied after payment: refund it in full. ────────────
    const refundRes = await fetch(`${FLW}/transactions/${flwId}/refund`, {
      method: "POST", headers: flwHeaders, body: JSON.stringify({ amount: paidUgx }),
    }).catch(() => null);
    const refundBody = await refundRes?.json().catch(() => null);
    if (refundRes?.ok && refundBody?.status === "success") {
      await admin.rpc("card_qr_mark_refunded", {
        p_tx_ref: tx_ref,
        p_note: `Flutterwave refund of UGX ${paidUgx} requested`,
      });
      return jsonResponse({
        success: false,
        refunded: true,
        error: `${result.error ?? "The payment could not be completed"}. Your payment of UGX ${paidUgx.toLocaleString()} is being refunded.`,
      });
    }
    console.error("refund failed", tx_ref, flwId, refundBody);
    return jsonResponse({
      success: false,
      error: `${result.error ?? "The payment could not be completed"}. We could not return your money automatically — contact support with reference ${tx_ref}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error.";
    console.error("card-qr-pay error:", error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
