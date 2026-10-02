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

// ---------------------------------------------------------------------------
// Extra actions that reuse this function's Resend + service-role setup so no
// additional Vercel/Supabase function is needed:
//   action "account-otp"            -> 6-digit email code before wallet creation
//   action "delete-account-now"     -> deletes the signed-in user's account after
//                                      re-checking their password (no email sent)
// Expected failures are returned as HTTP 200 { success: false, message } so the
// client can show the message without parsing a non-2xx response body.
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
type AdminClient = any;
type AuthedUser = { id: string; email: string };

const sha256Hex = async (raw: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
};

const sendResendEmail = async (resendApiKey: string, to: string, subject: string, html: string) => {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("SENDER_EMAIL") || "IcanEra <noreply@icanera.space>",
      to: [to],
      subject,
      html,
    }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    console.error("Resend delivery failed:", body);
    return false;
  }
  return true;
};

const handleAccountOtp = async (
  admin: AdminClient,
  resendApiKey: string,
  user: AuthedUser,
  request: Record<string, unknown>,
) => {
  const email = String(request?.email || "").trim().toLowerCase();
  const accountType = request?.accountType === "business" ? "business" : "personal";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return jsonResponse({ success: false, message: "Enter a valid email address." });
  }

  const { data: recent } = await admin
    .from("account_creation_otps")
    .select("id, created_at")
    .eq("user_id", user.id)
    .eq("account_type", accountType)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  const recentRow = recent?.[0];
  if (recentRow && Date.now() - new Date(recentRow.created_at).getTime() < 60 * 1000) {
    return jsonResponse({ success: true, message: "A code was already sent — check your email." });
  }

  const code = (crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).toString().padStart(6, "0");
  const codeHash = await sha256Hex(code);
  const { error: insertError } = await admin.from("account_creation_otps").insert({
    user_id: user.id,
    email,
    account_type: accountType,
    code_hash: codeHash,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  });
  if (insertError) {
    console.error("account-otp insert failed:", insertError);
    return jsonResponse({ success: false, message: "Could not create a verification code." });
  }

  const label = accountType === "business" ? "Business" : "Personal";
  const sent = await sendResendEmail(
    resendApiKey,
    email,
    `Your IcanEra ${label} wallet verification code`,
    `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937"><h1>Verify your email</h1><p>Enter this code to continue setting up your IcanEra ${label} wallet:</p><p style="font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;color:#4f46e5">${code}</p><p>This code expires in 10 minutes. If you did not request it, ignore this email.</p></div>`,
  );
  if (!sent) return jsonResponse({ success: false, message: "Could not send the verification email." });
  return jsonResponse({ success: true, message: "Verification code sent — check your email." });
};

const handleDeleteAccountNow = async (
  admin: AdminClient,
  supabaseUrl: string,
  user: AuthedUser & { providers: string[] },
  request: Record<string, unknown>,
) => {
  const confirmEmail = String(request?.confirmEmail || "").trim().toLowerCase();
  if (confirmEmail !== user.email.trim().toLowerCase()) {
    return jsonResponse({ success: false, message: "That email does not match your account email." });
  }

  if (user.providers.includes("email")) {
    // Password accounts: re-verify the password server-side before deleting.
    const password = String(request?.password || "");
    if (!password) {
      return jsonResponse({ success: false, message: "Enter your password to delete your account." });
    }
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!anonKey) {
      console.error("delete-account-now: SUPABASE_ANON_KEY is not available");
      return jsonResponse({ success: false, message: "Account deletion is not configured." });
    }
    const verifier = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: passwordError } = await verifier.auth.signInWithPassword({
      email: user.email,
      password,
    });
    if (passwordError) {
      return jsonResponse({ success: false, message: "Incorrect password." });
    }
  } else if (String(request?.confirmPhrase || "").trim().toLowerCase() !== "delete") {
    // Google-only accounts have no password to check; require the typed word instead.
    return jsonResponse({ success: false, message: 'Please type "delete" to confirm.' });
  }

  // profiles (and other owned rows) cascade from auth.users, so deleting the
  // auth user is enough. Nothing is removed beforehand: if the database refuses
  // the delete the account must be left fully intact.
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    console.error("Delete user error:", deleteError);
    const blocked = /database error deleting user/i.test(deleteError.message || "");
    return jsonResponse({
      success: false,
      message: blocked
        ? "This account has payment, trust or coin transaction history that must be kept, so it can't be deleted automatically. Please contact support."
        : deleteError.message || "Failed to delete account.",
    });
  }
  return jsonResponse({ success: true, message: "Your account has been deleted." });
};

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

    const request = await req.json().catch(() => ({}));
    const action = typeof request?.action === "string" ? request.action : "";

    // Deleting an account needs no email, so it only requires the Supabase keys.
    const needsResend = action !== "delete-account-now";
    if (!supabaseUrl || !serviceRoleKey || (needsResend && !resendApiKey)) {
      const missing = [
        !supabaseUrl && "SUPABASE_URL",
        !serviceRoleKey && "SUPABASE_SERVICE_ROLE_KEY",
        needsResend && !resendApiKey && "RESEND_API_KEY",
      ].filter(Boolean).join(", ");
      console.error(`request-pin-reset is missing function secrets: ${missing}`);
      const isNewAction = ["account-otp", "delete-account-now"].includes(action);
      return jsonResponse({
        success: false,
        message: `Email is not configured on the Supabase project (missing secret: ${missing}).`,
      }, isNewAction ? 200 : 500);
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse({ success: false, message: "Sign in before requesting a PIN reset link." }, 401);
    }
    const accessToken = authHeader.slice(7).trim();
    const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
    const user = userData?.user;
    if (userError || !user?.id || !user.email) {
      return jsonResponse({ success: false, message: "Your session expired. Sign in and try again." }, 401);
    }

    if (action === "delete-account-now") {
      const providers = Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers as string[] : [];
      return await handleDeleteAccountNow(admin, supabaseUrl, { id: user.id, email: user.email, providers }, request);
    }
    if (action === "account-otp") {
      return await handleAccountOtp(admin, resendApiKey!, { id: user.id, email: user.email }, request);
    }

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
