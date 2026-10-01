import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

// Sign-in "Forgot password?" email. Replaces supabase.auth.resetPasswordForEmail,
// which relies on Supabase's own mailer (500s when SMTP isn't set up). Here the
// recovery link is generated server-side and delivered through Resend, the same
// way request-pin-reset does it. The link lands on /reset-password, which the
// frontend already handles as a recovery session.

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

// Same reply whether or not the email has an account, so this can't be used
// to discover which emails are registered.
const SENT_MESSAGE = "If an account exists for that email, a reset link is on its way.";

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
        message: "Password reset email is not configured on the Supabase project.",
      }, 500);
    }

    const request = await req.json().catch(() => ({}));
    const email = String(request?.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ success: false, message: "Please enter a valid email address." }, 400);
    }

    const siteUrl = Deno.env.get("APP_URL") || "https://icanera.space";
    let redirectTo = new URL("/reset-password", siteUrl);
    try {
      const requested = new URL(String(request?.redirectTo || ""));
      if (allowedOrigins.has(requested.origin) && requested.pathname === "/reset-password") {
        redirectTo = requested;
      }
    } catch {
      // Fall back to the canonical app URL if the client omitted a valid target.
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: generated, error: linkError } = await admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: redirectTo.toString() },
    });
    const actionLink = generated?.properties?.action_link;
    if (linkError || !actionLink) {
      // Unknown email (or generation failure): answer identically, send nothing.
      console.warn("Password recovery link not generated:", linkError?.message);
      return jsonResponse({ success: true, message: SENT_MESSAGE });
    }

    const safeLink = escapeHtml(actionLink);
    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("SENDER_EMAIL") || "IcanEra <noreply@icanera.space>",
        to: [email],
        subject: "Reset your IcanEra password",
        html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#1f2937"><h1>Reset your password</h1><p>We received a request to reset the password for your IcanEra account.</p><p><a href="${safeLink}" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 22px;border-radius:6px;text-decoration:none">Reset password</a></p><p>This secure link expires shortly and can only be used once. If you did not request this, ignore this email; your password will remain unchanged.</p><p style="font-size:12px;color:#6b7280">If the button does not work, copy this link into your browser:<br>${safeLink}</p></div>`,
      }),
    });

    if (!emailResponse.ok) {
      const responseBody = await emailResponse.json().catch(() => ({}));
      console.error("Password reset email delivery failed:", responseBody);
      return jsonResponse({ success: false, message: "Could not send the reset email. Please try again." }, 502);
    }

    return jsonResponse({ success: true, message: SENT_MESSAGE });
  } catch (error) {
    console.error("request-password-reset function error:", error);
    return jsonResponse({ success: false, message: "Failed to send the reset email." }, 500);
  }
});
