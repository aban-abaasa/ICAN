import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Finishes a payment made by scanning the public QR on a recorded transaction's receipt
// (/r/<code>) with Flutterwave Mobile Money, card or bank — no IcanEra account.
//
// Public on purpose (verify_jwt = false, see config.toml): the payer has no session. It is safe
// because nothing in the request is trusted — the amount, the entry and the recipient were fixed
// server-side by public_tx_pay_start(), and this function only proceeds after Flutterwave itself
// confirms a successful UGX payment of at least that charge under that payment's tx_ref. The
// tx_ref is an unguessable random token.
//
// Flow: verify with Flutterwave -> public_tx_fulfil() (credits the owner and closes the entry,
// atomically) -> if that fails (e.g. someone else paid first), refund the payment in full.
// Re-callable with the same tx_ref: a payer who closed the tab can resume; a paid one just gets
// its receipt back, a failed one retries the refund.

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
    const { tx_ref, transaction_id, action, request_id } = await req.json();

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

    // ── Refund after an approver REJECTED a Mobile Money / card / bank payment ─────────────────
    // The only call in this function that needs a signed-in user: it must be someone allowed to
    // manage that bill (public_tx_request_get checks that as the caller). The refund itself only
    // ever covers payments the approver's reject marked "Not approved".
    if (action === "refund") {
      const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (!token || !anonKey || typeof request_id !== "string" || !/^[0-9a-f-]{36}$/i.test(request_id)) {
        return jsonResponse({ success: false, error: "Sign in as the seller to refund this payment." }, 401);
      }
      const asUser = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: allowed } = await asUser.rpc("public_tx_request_get", { p_id: request_id });
      if (!allowed?.success) return jsonResponse({ success: false, error: "You cannot refund this bill." }, 403);

      const { data: rejected } = await admin
        .from("public_tx_payments")
        .select("tx_ref, flw_transaction_id, paid_ugx")
        .eq("request_id", request_id).eq("status", "failed").eq("paid_via", "guest")
        .not("flw_transaction_id", "is", null).like("error", "Not approved%");
      let refunded = 0;
      let failed = 0;
      for (const row of rejected ?? []) {
        const res = await fetch(`${FLW}/transactions/${encodeURIComponent(String(row.flw_transaction_id))}/refund`, {
          method: "POST", headers: flwHeaders, body: JSON.stringify({ amount: Number(row.paid_ugx) }),
        }).catch(() => null);
        const body = await res?.json().catch(() => null);
        if (res?.ok && body?.status === "success") {
          await admin.rpc("public_tx_mark_refunded", { p_tx_ref: row.tx_ref, p_note: `Flutterwave refund of UGX ${row.paid_ugx} requested (payment not approved)` });
          refunded += 1;
        } else {
          console.error("approval refund failed", row.tx_ref, body);
          failed += 1;
        }
      }
      return jsonResponse({ success: failed === 0, refunded, failed,
        error: failed ? "The refund could not be sent automatically — contact support with the payment reference." : undefined });
    }

    if (typeof tx_ref !== "string" || !/^PTX-[A-Z0-9]{20}$/.test(tx_ref)) {
      return jsonResponse({ success: false, error: "Invalid payment reference." }, 400);
    }

    const { data: payment, error: paymentError } = await admin
      .from("public_tx_payments").select("*").eq("tx_ref", tx_ref).maybeSingle();
    if (paymentError || !payment) return jsonResponse({ success: false, error: "Payment not found." }, 404);

    // paid, or held waiting for an approver (fulfil returns the stored receipt either way)
    if (payment.status === "paid" || payment.status === "held") {
      const { data } = await admin.rpc("public_tx_fulfil", { p_tx_ref: tx_ref, p_flw_transaction_id: payment.flw_transaction_id ?? "", p_paid_ugx: payment.paid_ugx ?? payment.charge_ugx });
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
      const { data, error } = await admin.rpc("public_tx_fulfil", {
        p_tx_ref: tx_ref,
        p_flw_transaction_id: flwId,
        p_paid_ugx: paidUgx,
      });
      if (error) {
        console.error("public_tx_fulfil error:", error);
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
      await admin.rpc("public_tx_mark_refunded", {
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
    console.error("public-tx-pay error:", error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
