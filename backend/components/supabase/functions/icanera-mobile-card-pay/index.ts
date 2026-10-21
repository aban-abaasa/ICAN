import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Finishes a SupermartKera (digital-city-era) POS sale that a customer paid with Flutterwave Mobile
// Money or card — the customer needs no IcanEra account — by crediting the store's IcanEra wallet.
//
// Public on purpose (verify_jwt = false, see config.toml): the payer has no session, and the till
// polls this function while it waits. It is safe because nothing in the request is trusted — the
// amount, the store and the recipient were fixed server-side by imc_pay_create(), and this function
// only proceeds after Flutterwave itself confirms a successful UGX payment of at least that charge
// under that charge's tx_ref. The tx_ref is an unguessable random token.
//
// Flow: verify with Flutterwave -> imc_pay_fulfil() (credits the store wallet, atomically) -> if that
// fails (e.g. the cashier cancelled the sale while the payment was in flight), refund the payment in
// full. Re-callable with the same tx_ref: the till polls it, a payer who closed the tab can resume,
// a paid charge just returns its details again, and a failed one retries the refund.
//
// A second action, { action: "request_momo", tx_ref, phone, network?, name? }, lets the CASHIER ask a customer who is
// not at the till to pay: Flutterwave sends a Mobile Money approval prompt (MTN / Airtel Uganda) to that phone. It needs
// the cashier's own session (Authorization bearer), and imc_pay_begin_momo() only lets the cashier who opened the sale (or
// the store owner) do it, only while the sale is open, and only a few times per sale. The charge, amount and fee are the
// ones fixed by imc_pay_create(); the customer approves with their Mobile Money PIN and the polling below credits the store.
//
// Response shape:  { success: true, ... }                        paid and credited
//                  { success: false, pending: true }             nothing successful at Flutterwave yet — keep waiting
//                  { success: false, terminal: true, error }     will never succeed (cancelled / refunded / failed)
//                  { success: false, error }                     transient problem — safe to retry

const FLW = "https://api.flutterwave.com/v3";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });


// Ugandan mobile prefixes -> network, same table as the app's detectUgandaMobileNetwork().
const MTN_PREFIXES = ["77", "78", "76", "39"];
const AIRTEL_PREFIXES = ["70", "74", "75", "20"];

// '0772 123 456', '+256772123456', '256772123456' or '772123456' -> '772123456' (null when it isn't one).
const ugandaNational = (raw: unknown): string | null => {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("256")) return digits.slice(3);
  if (digits.length === 10 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 9 && !digits.startsWith("0")) return digits; // a truncated 0772... is not a number
  return null;
};

const detectNetwork = (national: string): "MTN" | "AIRTEL" | null => {
  const prefix = national.slice(0, 2);
  if (MTN_PREFIXES.includes(prefix)) return "MTN";
  if (AIRTEL_PREFIXES.includes(prefix)) return "AIRTEL";
  return null;
};

// Cashier asks Flutterwave to send a Mobile Money approval prompt for an open sale.
async function requestMomo(
  admin: ReturnType<typeof createClient>,
  flwHeaders: Record<string, string>,
  req: Request,
  body: Record<string, unknown>,
  txRef: string,
): Promise<Response> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  const { data: userData } = token ? await admin.auth.getUser(token) : { data: { user: null } };
  const user = userData?.user;
  if (!user) return jsonResponse({ success: false, error: "Sign in as the cashier to send a payment request." }, 401);

  const national = ugandaNational(body.phone);
  if (!national) {
    return jsonResponse({ success: false, error: "Enter a valid Ugandan mobile number, e.g. 0772 123 456." }, 400);
  }
  const requested = String(body.network ?? "").toUpperCase();
  const network = requested === "MTN" || requested === "AIRTEL" ? requested : detectNetwork(national);
  if (!network) {
    return jsonResponse({ success: false, error: "Could not tell if that number is MTN or Airtel — pick the network." }, 400);
  }

  // The gate: right person, sale still open, not too many prompts. It also reads the amount to charge.
  const { data: gate, error: gateError } = await admin.rpc("imc_pay_begin_momo", { p_tx_ref: txRef, p_user_id: user.id });
  if (gateError) {
    console.error("imc_pay_begin_momo error:", gateError);
    return jsonResponse({ success: false, error: "Could not send the request right now. Please try again." }, 500);
  }
  if (!gate?.success) return jsonResponse({ success: false, error: String(gate?.error ?? "This sale is not open for payment.") });

  const chargeRes = await fetch(`${FLW}/charges?type=mobile_money_uganda`, {
    method: "POST",
    headers: flwHeaders,
    body: JSON.stringify({
      tx_ref: txRef,
      amount: Number(gate.charge_ugx),
      currency: "UGX",
      email: user.email || "customer@supermartkera.app",
      phone_number: `256${national}`,
      network,
      fullname: String(body.name ?? "").trim().slice(0, 80) || "SupermartKera customer",
    }),
  }).catch(() => null);
  const chargeBody = await chargeRes?.json().catch(() => null);
  if (!chargeRes || !chargeRes.ok || chargeBody?.status !== "success") {
    console.error("momo charge failed", txRef, chargeBody);
    return jsonResponse({
      success: false,
      error: String(chargeBody?.message ?? "Flutterwave could not send the request to that number. Check it and try again."),
    });
  }
  return jsonResponse({ success: true, requested: true, network, message: `Payment request sent to the ${network} number — ask the customer to approve it on their phone.` });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed." }, 405);

  try {
    const body = await req.json();
    const { tx_ref, transaction_id } = body;

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

    if (typeof tx_ref !== "string" || !/^IMC-[A-Z0-9]{20}$/.test(tx_ref)) {
      return jsonResponse({ success: false, error: "Invalid payment reference." }, 400);
    }

    if (body.action === "request_momo") return await requestMomo(admin, flwHeaders, req, body, tx_ref);

    const { data: payment, error: paymentError } = await admin
      .from("icanera_mobile_card_payments").select("*").eq("tx_ref", tx_ref).maybeSingle();
    if (paymentError || !payment) return jsonResponse({ success: false, error: "Payment not found." }, 404);

    // Already settled: answer from our own record without bothering Flutterwave.
    if (payment.status === "paid") {
      const { data } = await admin.rpc("imc_pay_fulfil", {
        p_tx_ref: tx_ref,
        p_flw_transaction_id: payment.flw_transaction_id ?? "",
        p_paid_ugx: payment.paid_ugx ?? payment.charge_ugx,
      });
      return jsonResponse({ ...(data ?? {}), success: true, already_processed: true });
    }
    if (payment.status === "refunded") {
      return jsonResponse({
        success: false,
        terminal: true,
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
      // Nothing successful (yet). A cancelled charge will never be paid; an open one may still be
      // waiting on the customer's Mobile Money approval, so the till keeps asking.
      if (payment.status === "cancelled") {
        return jsonResponse({ success: false, terminal: true, error: "This sale was cancelled." });
      }
      if (new Date(payment.expires_at).getTime() + 30 * 60 * 1000 < Date.now()) {
        return jsonResponse({ success: false, terminal: true, error: "This sale expired before a payment arrived." });
      }
      return jsonResponse({ success: false, pending: true, status: payment.status });
    }
    const flwId = String(paid.id);
    const paidUgx = Number(paid.amount);

    // ── 2. Fulfil (skipped when a previous attempt already failed). ─────────
    let result: Record<string, unknown>;
    if (payment.status === "failed") {
      result = { success: false, error: payment.error, refund_required: true };
    } else {
      const { data, error } = await admin.rpc("imc_pay_fulfil", {
        p_tx_ref: tx_ref,
        p_flw_transaction_id: flwId,
        p_paid_ugx: paidUgx,
        p_channel: paid.payment_type ?? null,
        p_payer_name: paid.customer?.name ?? null,
        p_payer_phone: paid.customer?.phone_number ?? null,
      });
      if (error) {
        console.error("imc_pay_fulfil error:", error);
        return jsonResponse({
          success: false,
          error: "The payment went through but we couldn't finish recording it. Please retry in a minute — the customer won't be charged twice.",
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
      await admin.rpc("imc_pay_mark_refunded", {
        p_tx_ref: tx_ref,
        p_note: `Flutterwave refund of UGX ${paidUgx} requested`,
      });
      return jsonResponse({
        success: false,
        refunded: true,
        terminal: true,
        error: `${result.error ?? "The payment could not be completed"}. The payment of UGX ${paidUgx.toLocaleString()} is being refunded.`,
      });
    }
    console.error("refund failed", tx_ref, flwId, refundBody);
    return jsonResponse({
      success: false,
      terminal: true,
      error: `${result.error ?? "The payment could not be completed"}. We could not return the money automatically — contact support with reference ${tx_ref}.`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error.";
    console.error("icanera-mobile-card-pay error:", error);
    return jsonResponse({ success: false, error: message }, 500);
  }
});
