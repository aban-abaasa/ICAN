import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, message: "Method not allowed." },
      405,
    );
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) {
      return jsonResponse(
        { success: false, message: "Missing authorization token." },
        401,
      );
    }

    const accessToken = authHeader.replace("Bearer ", "").trim();

    const requestBody = await req.json().catch(() => ({}));
    const password = String(requestBody?.password || "").trim();

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || serviceRoleKey;

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return jsonResponse(
        {
          success: false,
          message: "Server is missing Supabase configuration.",
        },
        500,
      );
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: tokenUserData, error: tokenUserError } =
      await adminClient.auth.getUser(accessToken);
    const currentUser = tokenUserData?.user;

    if (tokenUserError || !currentUser) {
      return jsonResponse(
        { success: false, message: "Invalid or expired session." },
        401,
      );
    }

    if (!currentUser.email) {
      return jsonResponse(
        {
          success: false,
          message: "User email is missing. Cannot verify password.",
        },
        400,
      );
    }

    const providers = currentUser.app_metadata?.providers || [];
    const hasEmailPasswordProvider =
      providers.includes("email") || providers.length === 0;

    if (hasEmailPasswordProvider) {
      if (!password) {
        return jsonResponse(
          { success: false, message: "Password is required for this account." },
          400,
        );
      }

      const { data: reauthData, error: reauthError } =
        await authClient.auth.signInWithPassword({
          email: currentUser.email,
          password,
        });

      if (
        reauthError ||
        !reauthData?.user ||
        reauthData.user.id !== currentUser.id
      ) {
        const authMessage = reauthError?.message || "Password verification failed.";
        return jsonResponse(
          {
            success: false,
            message: `Password verification failed: ${authMessage}`,
          },
          401,
        );
      }
    } else if (!password) {
      return jsonResponse(
        {
          success: false,
          message: "Please enter your confirmation credential to continue.",
        },
        400,
      );
    }

    await adminClient.from("profiles").delete().eq("id", currentUser.id);

    const { error: deleteError } = await adminClient.auth.admin.deleteUser(
      currentUser.id,
    );
    if (deleteError) {
      console.error("Delete user error:", deleteError);
      return jsonResponse(
        {
          success: false,
          message: deleteError.message || "Failed to delete account.",
        },
        500,
      );
    }

    return jsonResponse(
      { success: true, message: "Your account has been deleted." },
      200,
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Internal server error while deleting account.";
    console.error("Delete account function error:", error);
    return jsonResponse({ success: false, message }, 500);
  }
});
