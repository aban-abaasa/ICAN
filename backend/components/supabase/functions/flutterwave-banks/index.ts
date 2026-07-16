import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Public, read-only proxy for Flutterwave's Uganda bank/mobile-money list —
// used by the "Send Out" UI to populate a bank picker for the bank payout
// channel. No auth required: bank codes and names are not sensitive, and the
// Flutterwave secret key never leaves this function.

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "GET") {
    return jsonResponse({ success: false, error: "Method not allowed." }, 405);
  }

  const flutterwaveSecretKey = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!flutterwaveSecretKey) {
    return jsonResponse({ success: false, error: "Server is missing required configuration." }, 500);
  }

  try {
    const response = await fetch("https://api.flutterwave.com/v3/banks/UG?include_provider_type=1", {
      headers: { Authorization: `Bearer ${flutterwaveSecretKey}` },
    });
    const body = await response.json().catch(() => null);
    const banks: Array<{ code: string; name: string; provider_type?: string }> = body?.data ?? [];

    if (!response.ok || !Array.isArray(banks)) {
      return jsonResponse({ success: false, error: "Could not load bank list." }, 502);
    }

    // Exclude the mobile money entries here — those are resolved
    // automatically by flutterwave-payout from the network name, and
    // showing them in a "bank" picker would just be confusing.
    const bankOnly = banks.filter((b) => (b.provider_type ?? "bank") === "bank");

    return jsonResponse({ success: true, banks: bankOnly });
  } catch (error) {
    console.error("flutterwave-banks error:", error);
    return jsonResponse({ success: false, error: "Could not load bank list." }, 502);
  }
});
