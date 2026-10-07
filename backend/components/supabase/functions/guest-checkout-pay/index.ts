import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Finishes a guest (no IcanEra wallet) dropship / business-website order that
// was paid with Flutterwave Mobile Money, card or bank.
//
// Public on purpose (verify_jwt = false, see config.toml): the guest has no
// session. It is safe because nothing in the request is trusted — the order
// (price, items, rider) was fixed server-side by guest_checkout_start(), and
// this function only proceeds after Flutterwave itself confirms a successful
// payment of at least that order's charge in UGX under that order's tx_ref.
// The tx_ref is an unguessable random token, and all it can ever reveal is the
// receipt of the order it belongs to.
//
// Flow: verify payment -> guest_checkout_fulfil() (funds the guest payer wallet
// and runs dropship_checkout atomically) -> on failure, refund the payment.
// Re-callable with the same tx_ref (a guest who closed the tab can resume): a
// fulfilled order just returns its stored receipt, and a failed one retries
// the refund.

const FLW = "https://api.flutterwave.com/v3";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// The internal account that "pays" dropship_checkout on a guest's behalf (see
// guest_checkout_fulfil). Created automatically the first time it is needed,
// through the normal Auth admin API so every signup trigger runs as usual, and
// remembered in guest_checkout_config.payer_user_id. It has a random password
// nobody knows and a non-deliverable email, so nobody can ever sign in to it.
async function ensureGuestPayer(admin: ReturnType<typeof createClient>): Promise<string> {
  const read = async () => {
    const { data } = await admin.from("guest_checkout_config").select("value").eq("key", "payer_user_id").maybeSingle();
    return (data?.value as string | undefined) || null;
  };
  const existing = await read();
  if (existing) return existing;

  const randomPassword = crypto.randomUUID() + crypto.randomUUID();
  const { data, error } = await admin.auth.admin.createUser({
    email: "guest-checkout@system.icanera.invalid",
    password: randomPassword,
    email_confirm: true,
    user_metadata: { full_name: "Guest Checkout", system_account: true },
  });
  if (error || !data?.user) {
    // Another order may have created it a moment ago.
    const raced = await read();
    if (raced) return raced;
    throw new Error(error?.message || "Could not create the guest payer account");
  }

  // First writer wins; a concurrent order that lost the race re-reads.
  await admin.from("guest_checkout_config").upsert(
    { key: "payer_user_id", value: data.user.id, note: "Internal Guest Checkout account (auto-created)" },
    { onConflict: "key", ignoreDuplicates: true },
  );
  return (await read()) || data.user.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed." }, 405);

  try {
    const { tx_ref, transaction_id } = await req.json();
    if (typeof tx_ref !== "string" || !/^GCO-[A-Z0-9]{20}$/.test(tx_ref)) {
      return jsonResponse({ success: false, error: "Invalid order reference." }, 400);
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

    const { data: order, error: orderError } = await admin
      .from("guest_checkout_orders").select("*").eq("tx_ref", tx_ref).maybeSingle();
    if (orderError || !order) return jsonResponse({ success: false, error: "Order not found." }, 404);

    if (order.status === "fulfilled") {
      return jsonResponse({ ...(order.result ?? {}), success: true, already_processed: true });
    }
    if (order.status === "refunded") {
      return jsonResponse({
        success: false,
        error: order.error || "This order could not be completed and your payment was refunded.",
      });
    }

    // ── 1. Ask Flutterwave whether this order was really paid. ──────────────
    const verifyUrl = transaction_id
      ? `${FLW}/transactions/${encodeURIComponent(String(transaction_id))}/verify`
      : `${FLW}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(tx_ref)}`;
    const verifyRes = await fetch(verifyUrl, { headers: flwHeaders });
    const verifyBody = await verifyRes.json().catch(() => null);
    const payment = verifyBody?.data;

    const paid = verifyRes.ok && payment &&
      payment.status === "successful" &&
      payment.tx_ref === tx_ref &&
      (payment.currency ?? "UGX") === "UGX" &&
      Number(payment.amount ?? 0) >= Number(order.charge_ugx) - 1;
    if (!paid) {
      return jsonResponse({
        success: false,
        error: "We couldn't confirm a payment for this order. If money left your account it will be returned automatically — otherwise just try again.",
      });
    }
    const flwId = String(payment.id);
    const paidUgx = Number(payment.amount);

    // ── 2. Fulfil (skipped when a previous attempt already failed). ─────────
    let result: Record<string, unknown>;
    let payerError: string | null = null;
    if (order.status !== "failed") {
      try {
        await ensureGuestPayer(admin);
      } catch (err) {
        console.error("ensureGuestPayer failed:", err);
        payerError = "We couldn't set up the payment account for this order";
      }
    }
    if (order.status === "failed") {
      result = { success: false, error: order.error, refund_required: true };
    } else if (payerError) {
      result = { success: false, error: payerError, refund_required: true };
    } else {
      const { data, error } = await admin.rpc("guest_checkout_fulfil", {
        p_tx_ref: tx_ref,
        p_flw_transaction_id: flwId,
        p_paid_ugx: paidUgx,
      });
      if (error) {
        console.error("guest_checkout_fulfil error:", error);
        return jsonResponse({
          success: false,
          error: "Your payment went through but we couldn't finish the order. Please retry in a minute — you won't be charged twice.",
        }, 500);
      }
      result = data as Record<string, unknown>;
    }

    if (result.success) {
      // Fare came in under the quote: hand the difference back (best effort).
      const diff = Number(result.refund_difference_ugx ?? 0);
      if (diff >= 100) {
        const r = await fetch(`${FLW}/transactions/${flwId}/refund`, {
          method: "POST", headers: flwHeaders, body: JSON.stringify({ amount: diff }),
        }).catch(() => null);
        if (!r?.ok) console.error("partial refund failed", tx_ref, diff);
      }
      return jsonResponse(result);
    }

    if (!result.refund_required) {
      return jsonResponse({ success: false, error: String(result.error ?? "Order could not be completed.") });
    }

    // ── 3. Order couldn't be fulfilled after payment: refund it in full. ────
    const refundRes = await fetch(`${FLW}/transactions/${flwId}/refund`, {
      method: "POST", headers: flwHeaders, body: JSON.stringify({ amount: paidUgx }),
    }).catch(() => null);
    const refundBody = await refundRes?.json().catch(() => null);
    if (refundRes?.ok && refundBody?.status === "success") {
      await admin.rpc("guest_checkout_mark_refunded", {
        p_tx_ref: tx_ref,
        p_note: `Flutterwave refund of UGX ${paidUgx} requested`,
      });
      return jsonResponse({
        success: false,
        refunded: true,
        error: `${result.error ?? "The order could not be completed"}. Your payment of UGX ${paidUgx.toLocaleString()} is being refunded.`,
      });
    }
    console.error("refund failed", tx_ref, flwId, refundBody);
    return jsonResponse({
      success: false,
      error: `${result.error ?? "The order could not be completed"}. We could not return your payment automatically — contact support with reference ${tx_ref}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error.";
    console.error("guest-checkout-pay error:", error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
