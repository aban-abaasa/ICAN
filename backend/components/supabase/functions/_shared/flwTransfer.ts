// Flutterwave only accepts live transfers from IP addresses registered in its
// dashboard, and Supabase Edge Functions have no fixed outgoing IP -- hence
// "Please enable IP Whitelisting to access this service".
//
// If FLUTTERWAVE_RELAY_URL (and FLUTTERWAVE_RELAY_KEY) are set as Edge Function
// secrets, the transfer call is sent through the relay in
// backend/flutterwave-relay, which runs on a fixed IP you whitelist in
// Flutterwave. If they are not set, it calls Flutterwave directly (works in
// test mode or when Flutterwave whitelisting is off).
export const flwCreateTransfer = (secretKey: string, payload: Record<string, unknown>): Promise<Response> => {
  const relayUrl = Deno.env.get("FLUTTERWAVE_RELAY_URL");
  const relayKey = Deno.env.get("FLUTTERWAVE_RELAY_KEY") ?? "";
  const url = relayUrl
    ? `${relayUrl.replace(/\/+$/, "")}/transfers`
    : "https://api.flutterwave.com/v3/transfers";
  return fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...(relayUrl ? { "x-relay-key": relayKey } : {}),
    },
    body: JSON.stringify(payload),
  });
};
