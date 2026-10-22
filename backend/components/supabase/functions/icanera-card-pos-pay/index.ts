import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// "IcanEra Digital Card" at a SupermartKera (digital-city-era) till: a customer who comes with the digital card
// from their IcanEra wallet (Wallet -> Cards) pays the sale on screen. The cashier scans the card's QR, the customer
// types their wallet transaction PIN on the till, and the sale is paid from their wallet to the store's wallet.
//
// It is the card QR's "tap-to-pay" (card-pay-with-pin) pointed at ONE specific sale instead of a free amount and
// destination: the cashier's screen sends only { tx_ref, token, pin }. The amount, the store and the recipient were
// fixed server-side by imc_pay_create() when the sale was opened, so the till cannot pay itself an amount of its own
// choosing, and the card holder pays no fee.
//
// Safety:
//  - The caller must be signed in (Authorization bearer) AND be the cashier who opened that sale (or the store
//    owner): imc_card_begin() checks it, that the sale is still open, that the card is not the store's own, and
//    caps card tries at 5 per sale.
//  - The QR token only identifies the card; money moves ONLY if the holder's transaction PIN is correct. The PIN is
//    checked here, server-side, with the same 3-wrong-attempts / 30-minute lock the wallet uses everywhere (shared
//    with card-pay-with-pin, so guessing across both is counted together).
//  - The holder can switch this off per card (ican_digital_cards.pin_pay_enabled) or switch the QR off entirely.
//  - The debit and credit are one atomic transfer (imc_pay_with_card): either both happen or neither does, so there
//    is never anything to refund. The holder is told what was taken in their wallet inbox.
//
// Response shape:  { success: true, ...the settled sale (tx_ref, amount_ugx, channel, payer_name, ican_tx_id, ...) }
//                  { success: false, error }   (HTTP 4xx/5xx: wrong PIN, card off, not enough coins, sale closed, ...)

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Must match hashPIN() in agentService.js / walletAccountService.js (and card-pay-with-pin) exactly.
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
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ success: false, error: "Server is missing required configuration." }, 500);
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // ── who is asking: a signed-in cashier ───────────────────────────────
    const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: userData } = bearer ? await admin.auth.getUser(bearer) : { data: { user: null } };
    const user = userData?.user;
    if (!user) return jsonResponse({ success: false, error: "Sign in as the cashier to take a card payment." }, 401);

    const body = await req.json().catch(() => null);
    if (!body) return jsonResponse({ success: false, error: "Invalid JSON body." }, 400);

    const txRef = String(body.tx_ref || "");
    const token = String(body.token || "");
    const pin = String(body.pin || "");
    if (!/^IMC-[A-Z0-9]{20}$/.test(txRef)) return jsonResponse({ success: false, error: "Invalid payment reference." }, 400);
    if (!/^[A-Za-z0-9]{20,100}$/.test(token)) {
      return jsonResponse({ success: false, error: "This card QR is not valid. Ask the customer to open their card again." }, 400);
    }
    if (!/^[0-9]{4,6}$/.test(pin)) return jsonResponse({ success: false, error: "Enter the 4-6 digit card PIN." }, 400);

    // ── the card ─────────────────────────────────────────────────────────
    const { data: card } = await admin
      .from("ican_digital_cards")
      .select("id, user_id, card_number, qr_enabled, status, pin_pay_enabled")
      .eq("qr_token", token)
      .maybeSingle();
    if (!card || !card.qr_enabled || card.status !== "active") {
      return jsonResponse({ success: false, error: "This card QR is not active. Ask the customer to open their card again in the IcanEra app." }, 400);
    }
    if (!card.pin_pay_enabled) {
      return jsonResponse({ success: false, error: "The card owner has turned off PIN approval on this card. Use another way to pay." }, 403);
    }
    const last4 = String(card.card_number || "").slice(-4);

    // ── the gate: right cashier, sale still open, not the store's own card, few tries ──
    const { data: gate, error: gateError } = await admin.rpc("imc_card_begin", {
      p_tx_ref: txRef, p_user_id: user.id, p_payer_user_id: card.user_id,
    });
    if (gateError) {
      console.error("imc_card_begin error:", gateError);
      return jsonResponse({ success: false, error: "Could not start the card payment right now. Please try again." }, 500);
    }
    if (!gate?.success) return jsonResponse({ success: false, error: String(gate?.error ?? "This sale is not open for payment.") }, 400);

    // ── PIN check with lockout ───────────────────────────────────────────
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

    // ── pay the sale: holder's wallet -> store wallet, atomic ────────────
    const { data: paid, error: payError } = await admin.rpc("imc_pay_with_card", {
      p_tx_ref: txRef, p_payer_user_id: card.user_id, p_card_last4: last4,
    });
    if (payError) {
      console.error("imc_pay_with_card error:", payError);
      return jsonResponse({ success: false, error: "The payment could not be completed. Nothing was taken — please try again." }, 500);
    }
    if (!paid?.success) return jsonResponse({ success: false, error: String(paid?.error ?? "The payment could not be completed.") }, 400);

    return jsonResponse({ ...paid, success: true, card_last4: last4 });
  } catch (error) {
    console.error("icanera-card-pos-pay error:", error);
    return jsonResponse({ success: false, error: "Something went wrong. Nothing was taken — check the sale before trying again." }, 500);
  }
});
