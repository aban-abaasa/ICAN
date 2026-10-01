import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
}[char] || char));

const allowedOrigins = new Set([
  "https://icanera.space",
  "http://localhost:3001",
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
]);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ success: false, message: "Method not allowed." }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!supabaseUrl || !serviceRoleKey || !resendApiKey) {
      return jsonResponse({
        success: false,
        message: "PIN reset email is not configured on the Supabase project.",
      }, 500);
    }

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ success: false, message: "Sign in before requesting a PIN reset link." }, 401);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const accessToken = authHeader.slice(7).trim();
    const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
    const user = userData?.user;
    if (userError || !user?.id || !user.email) {
      return jsonResponse({ success: false, message: "Your session expired. Sign in and try again." }, 401);
    }

    const request = await req.json().catch(() => ({}));
    const accountType = request?.accountType === "business" ? "business" : "personal";
    const requestedAccountId = accountType === "business" && typeof request?.accountId === "string"
      ? request.accountId
      : null;
    // Business wallet PINs belong to a business profile (the chosen id is a
    // business_profiles.id). The reset RPC enforces the real authority rule
    // (highest-ownership shareholder); here we just confirm involvement.
    let account: { id: string; account_holder_name: string | null } | null = null;
    let accountError: unknown = null;
    if (accountType === "business") {
      if (!requestedAccountId) {
        return jsonResponse({ success: false, message: "Choose which business to reset." }, 400);
      }
      const { data: profile, error } = await admin
        .from("business_profiles")
        .select("id, business_name, user_id")
        .eq("id", requestedAccountId)
        .maybeSingle();
      accountError = error;
      if (profile) {
        let involved = profile.user_id === user.id;
        if (!involved) {
          const { data: co } = await admin
            .from("business_co_owners")
            .select("id")
            .eq("business_profile_id", profile.id)
            .eq("user_id", user.id)
            .limit(1);
          involved = !!co?.length;
        }
        if (involved) account = { id: profile.id, account_holder_name: profile.business_name };
      }
    } else {
      const { data: rows, error } = await admin
        .from("user_accounts")
        .select("id, account_holder_name")
        .eq("account_type", "personal")
        .eq("user_id", user.id)
        .limit(1);
      accountError = error;
      account = rows?.[0] ?? null;
    }

    if (accountError) {
      console.error("PIN reset account lookup failed:", accountError);
      return jsonResponse({ success: false, message: "Could not verify this wallet account." }, 500);
    }
    if (!account) {
      return jsonResponse({ success: false, message: `No ${accountType} wallet account was found.` }, 404);
    }

    const siteUrl = Deno.env.get("APP_URL") || "https://icanera.space";
    let redirectTo = new URL("/reset-password", siteUrl);
    redirectTo.searchParams.set("accountType", accountType);
    redirectTo.searchParams.set("flow", "pin");
    if (requestedAccountId) redirectTo.searchParams.set("accountId", account.id);
    try {
      const requested = new URL(String(request?.redirectTo || ""));
      if (
        allowedOrigins.has(requested.origin) &&
        requested.pathname === "/reset-password" &&
        requested.searchParams.get("flow") === "pin"
      ) {
        redirectTo = requested;
        redirectTo.searchParams.set("accountType", accountType);
        if (requestedAccountId) redirectTo.searchParams.set("accountId", account.id);
      }
    } catch {
      // Fall back to the canonical app URL if the client omitted a valid target.
    }

    const { data: generated, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email: user.email,
      options: { redirectTo: redirectTo.toString() },
    });
    const actionLink = generated?.properties?.action_link;
    if (linkError || !actionLink) {
      console.error("PIN recovery link generation failed:", linkError);
      return jsonResponse({ success: false, message: "Could not create a PIN reset link." }, 500);
    }

    const accountLabel = accountType === "business" ? "business" : "personal";
    const displayName = escapeHtml(String(account.account_holder_name || user.email));
    const safeLink = escapeHtml(actionLink);
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("SENDER_EMAIL") || "IcanEra <noreply@icanera.space>",
        to: [user.email],
        subject: `Reset your IcanEra ${accountLabel} wallet PIN`,
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937"><h1>Reset your wallet PIN</h1><p>Hello ${displayName},</p><p>We received a request to reset the PIN for your IcanEra ${accountLabel} wallet.</p><p><a href="${safeLink}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none">Reset wallet PIN</a></p><p>This secure link expires shortly and can only be used once. If you did not request this, ignore this email; your PIN will remain unchanged.</p><p style="font-size:12px;color:#6b7280">If the button does not work, copy this link into your browser:<br>${safeLink}</p></div>`,
      }),
    });

    if (!emailResponse.ok) {
      const responseBody = await emailResponse.json().catch(() => ({}));
      console.error("PIN reset email delivery failed:", responseBody);
      return jsonResponse({ success: false, message: "Could not send the PIN reset email." }, 502);
    }

    return jsonResponse({ success: true, message: "PIN reset link sent. Check your email." });
  } catch (error) {
    console.error("request-pin-reset function error:", error);
    return jsonResponse({ success: false, message: "Failed to request a PIN reset link." }, 500);
  }
});
