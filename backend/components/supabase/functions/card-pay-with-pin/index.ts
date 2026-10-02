import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { flwCreateTransfer } from "../_shared/flwTransfer.ts";

// "Tap-to-pay style" payout for the ICANera digital card: whoever scans the
// card's QR (a shop terminal, an agent's phone, a friend's phone) enters the
// payout number, amount and the CARD OWNER'S transaction PIN right on the scan
// page. The owner needs no phone and no login.
//
// Safety:
//  - The QR token only identifies the card; money moves ONLY if the owner's
//    transaction PIN is correct. The PIN is checked here, server-side, with
//    the same 3-wrong-attempts / 30-minute lock the wallet uses everywhere.
//  - Owner can switch this off per card (ican_digital_cards.pin_pay_enabled).
//  - Debit + refund-on-failure reuse request_fiat_momo_send /
//    resolve_fiat_momo_send, exactly like flutterwave-momo-send; final
//    settlement is confirmed or refunded by flutterwave-transfer-webhook.
//  - The scan history is written to ican_card_qr_requests so the owner sees it
//    in Wallet -> Cards.

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Must match hashPIN() in agentService.js / walletAccountService.js exactly.
const hashPIN = (pin: string) => {
  let hash = 0;
  const str = `pin-${pin}-salt-ican-hash`;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return btoa(`hash-${Math.abs(hash)}-${pin.length}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ success: false, error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const flutterwaveSecretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!supabaseUrl || !serviceRoleKey || !flutterwaveSecretKey) {
    return jsonResponse({ success: false, error: "Server is missing required configuration." }, 500);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let reference: string | null = null;
  let scanId: string | null = null;

  try {
    const body = await req.json().catch(() => null);
    if (!body) return jsonResponse({ success: false, error: "Invalid JSON body." }, 400);

    const token = String(body.token || "");
    const pin = String(body.pin || "");
    // Where the money goes: 'momo' (default), 'icanera' account, or 'bank'.
    const destType = String(body.dest_type || "momo");
    const bankCode = String(body.bank_code || "").trim();
    const beneficiary = String(body.beneficiary_name || "").trim().slice(0, 80);
    // phone = mobile money number, ICANera account number, or bank account number.
    const phone = String(body.phone || "").replace(/[^0-9]/g, "");
    const network = destType === "icanera" ? "ICANERA" : destType === "bank" ? "BANK" : String(body.network || "").toUpperCase();
    const amount = Number(body.amount);
    const note = body.note ? String(body.note).slice(0, 140) : null;

    if (!/^[A-Za-z0-9]{20,100}$/.test(token)) return jsonResponse({ success: false, error: "This QR code is not active." }, 400);
    if (!/^[0-9]{4,6}$/.test(pin)) return jsonResponse({ success: false, error: "Enter the 4-6 digit card PIN." }, 400);
    if (!["momo", "icanera", "bank"].includes(destType)) return jsonResponse({ success: false, error: "Choose where to send the money." }, 400);
    if (destType === "momo") {
      if (!["MTN", "AIRTEL"].includes(network)) return jsonResponse({ success: false, error: "Choose MTN or Airtel." }, 400);
      if (!/^(256[0-9]{9}|0[0-9]{9})$/.test(phone)) return jsonResponse({ success: false, error: "Enter a valid Uganda mobile number." }, 400);
    } else if (destType === "icanera") {
      if (!/^[0-9]{16}$/.test(phone)) return jsonResponse({ success: false, error: "ICANera account numbers are 16 digits." }, 400);
    } else {
      if (!/^[0-9]{5,20}$/.test(phone)) return jsonResponse({ success: false, error: "Enter a valid bank account number." }, 400);
      if (!bankCode) return jsonResponse({ success: false, error: "Choose the bank." }, 400);
      if (beneficiary.length < 2) return jsonResponse({ success: false, error: "Enter the account holder's name." }, 400);
    }
    if (!(amount >= 1000 && amount <= 5000000)) {
      return jsonResponse({ success: false, error: "Amount must be between 1,000 and 5,000,000 UGX." }, 400);
    }

    const { data: card } = await admin
      .from("ican_digital_cards")
      .select("id, user_id, holder_name, qr_enabled, status, pin_pay_enabled")
      .eq("qr_token", token)
      .maybeSingle();
    if (!card || !card.qr_enabled || card.status !== "active") {
      return jsonResponse({ success: false, error: "This QR code is not active." }, 400);
    }
    if (!card.pin_pay_enabled) {
      return jsonResponse({ success: false, error: "The owner has turned off PIN approval on this card." }, 403);
    }

    // ── PIN check with lockout ──────────────────────────────────────────
    const { data: account } = await admin
      .from("user_accounts")
      .select("pin_hash, pin_attempts, pin_locked_until")
      .eq("user_id", card.user_id)
      .maybeSingle();
    if (!account?.pin_hash) {
      return jsonResponse({ success: false, error: "The card owner has not set a transaction PIN yet." }, 400);
    }
    if (account.pin_locked_until && new Date(account.pin_locked_until) > new Date()) {
      return jsonResponse({ success: false, error: "Too many wrong PIN attempts. This card is locked for a while." }, 429);
    }
    if (hashPIN(pin) !== account.pin_hash) {
      const attempts = (account.pin_attempts || 0) + 1;
      await admin.from("user_accounts").update({
        pin_attempts: attempts,
        pin_locked_until: attempts >= 3 ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null,
      }).eq("user_id", card.user_id);
      return jsonResponse({
        success: false,
        error: attempts >= 3 ? "Wrong PIN. The card is now locked for 30 minutes." : `Wrong PIN. Attempts remaining: ${3 - attempts}`,
      }, 401);
    }
    await admin.from("user_accounts").update({ pin_attempts: 0, pin_locked_until: null }).eq("user_id", card.user_id);

    // Double-tap guard: same card, number and amount within 30 seconds.
    const since = new Date(Date.now() - 30 * 1000).toISOString();
    const { count: recent } = await admin
      .from("ican_card_qr_requests")
      .select("id", { count: "exact", head: true })
      .eq("card_id", card.id).eq("recipient_phone", phone).eq("amount", amount)
      .in("status", ["processing", "completed"]).gte("created_at", since);
    if ((recent || 0) > 0) {
      return jsonResponse({ success: false, error: "That payment was just sent. Wait a moment before repeating it." }, 409);
    }

    // ── Resolve the Flutterwave code (momo network or chosen bank) ──────
    let accountBankCode = "";
    if (destType !== "icanera") {
      const banksResponse = await fetch(
        "https://api.flutterwave.com/v3/banks/UG?include_provider_type=1",
        { headers: { Authorization: `Bearer ${flutterwaveSecretKey}` } },
      );
      const banksBody = await banksResponse.json().catch(() => null);
      const banks: Array<{ code: string; name: string }> = banksBody?.data ?? [];
      const match = Array.isArray(banks)
        ? (destType === "bank" ? banks.find((b) => b.code === bankCode) : banks.find((b) => b.name?.toUpperCase().includes(network)))
        : null;
      if (!banksResponse.ok || !match) {
        return jsonResponse({ success: false, error: destType === "bank" ? "That bank is not supported right now." : "Could not resolve mobile money network right now." }, 502);
      }
      accountBankCode = match.code;
    }

    // History row first; marked processing so it is visible even if we crash.
    const { data: scanRow } = await admin.from("ican_card_qr_requests").insert({
      card_id: card.id,
      owner_user_id: card.user_id,
      requester_name: "PIN approved at scan",
      recipient_phone: phone,
      recipient_network: network,
      dest_type: destType,
      bank_code: destType === "bank" ? accountBankCode : null,
      beneficiary_name: destType === "bank" ? beneficiary : null,
      amount,
      note,
      status: "processing",
    }).select("id").single();
    scanId = scanRow?.id ?? null;

    const failScan = async (reason: string) => {
      if (scanId) await admin.from("ican_card_qr_requests").update({ status: "failed", failure_reason: reason.slice(0, 300), resolved_at: new Date().toISOString() }).eq("id", scanId);
    };

    // ── ICANera account: atomic wallet-to-wallet, nothing to refund ─────
    if (destType === "icanera") {
      const { data: sent, error: sendError } = await admin.rpc("card_pin_send_to_account", {
        p_from_user: card.user_id, p_account_number: phone, p_amount: amount, p_request_id: scanId,
      });
      if (sendError || !sent?.success) {
        const reason = sent?.error || sendError?.message || "Could not send to that account.";
        await failScan(reason);
        return jsonResponse({ success: false, error: reason }, 400);
      }
      if (scanId) await admin.from("ican_card_qr_requests").update({ status: "completed", resolved_at: new Date().toISOString() }).eq("id", scanId);
      return jsonResponse({ success: true, dest_type: "icanera", recipient_name: sent.recipient_name ?? null, amount, fee: 0, message: "Approved. The money is already in the ICANera account." });
    }

    // ── Debit wallet + open send request (mobile money or bank) ─────────
    // The card_pin_request_* wrappers also record the payment in the owner's
    // wallet transactions in the same database transaction as the debit.
    const { data: requestResult, error: requestError } = destType === "bank"
      ? await admin.rpc("card_pin_request_bank_send", {
        p_user_id: card.user_id, p_amount: amount, p_account_number: phone,
        p_bank_code: accountBankCode, p_beneficiary: beneficiary,
        p_note: note || "Card payment (PIN approved at scan)",
        p_request_id: scanId,
      })
      : await admin.rpc("card_pin_request_momo_send", {
        p_user_id: card.user_id,
        p_amount: amount,
        p_phone: phone,
        p_network: network,
        p_note: note || "Card payment (PIN approved at scan)",
        p_request_id: scanId,
      });
    if (requestError || !requestResult?.success) {
      const reason = requestResult?.error || requestError?.message || "Could not start transfer.";
      if (scanId) await admin.from("ican_card_qr_requests").update({ status: "failed", failure_reason: reason.slice(0, 300), resolved_at: new Date().toISOString() }).eq("id", scanId);
      return jsonResponse({ success: false, error: reason }, 400);
    }
    reference = requestResult.reference as string;

    const transferResponse = await flwCreateTransfer(flutterwaveSecretKey, {
      account_bank: accountBankCode,
      account_number: phone,
      amount: Number(requestResult.net_amount),
      currency: "UGX",
      narration: note || "ICANera card payment",
      reference,
      beneficiary_name: destType === "bank" ? beneficiary : "ICANera mobile money recipient",
      callback_url: `${supabaseUrl}/functions/v1/flutterwave-transfer-webhook`,
    });
    const transferBody = await transferResponse.json().catch(() => null);
    const transferData = transferBody?.data;
    const accepted = transferResponse.ok && transferBody?.status === "success" && transferData?.id;

    if (!accepted) {
      const reason = transferBody?.message || "Flutterwave rejected the transfer request.";
      await admin.rpc("resolve_fiat_momo_send", { p_reference: reference, p_success: false, p_failure_reason: reason });
      if (scanId) await admin.from("ican_card_qr_requests").update({ status: "failed", failure_reason: reason.slice(0, 300), resolved_at: new Date().toISOString() }).eq("id", scanId);
      return jsonResponse({ success: false, error: reason }, 502);
    }

    await admin.rpc("mark_fiat_momo_send_processing", {
      p_reference: reference,
      p_flutterwave_transfer_id: String(transferData.id),
    });
    if (scanId) await admin.from("ican_card_qr_requests").update({ status: "completed", fiat_reference: reference, resolved_at: new Date().toISOString() }).eq("id", scanId);

    return jsonResponse({
      success: true,
      reference,
      amount: requestResult.amount,
      fee: requestResult.fee,
      message: "Approved. The money is on its way and is refunded automatically if the network rejects it.",
    });
  } catch (error) {
    console.error("card-pay-with-pin error:", error);
    if (reference) {
      try {
        await admin.rpc("resolve_fiat_momo_send", {
          p_reference: reference, p_success: false, p_failure_reason: "Internal server error during transfer initiation.",
        });
      } catch (e) { console.error("card-pay-with-pin: refund-on-error also failed:", e); }
    }
    if (scanId) {
      await admin.from("ican_card_qr_requests").update({ status: "failed", failure_reason: "Internal error", resolved_at: new Date().toISOString() }).eq("id", scanId);
    }
    return jsonResponse({ success: false, error: error instanceof Error ? error.message : "Internal server error." }, 500);
  }
});
